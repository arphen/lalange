import { fingerprintValue } from '../exchange/fingerprint';
import { completeRepairResponse, createRepairContext, validateRepairProposal, type RepairContext } from './repair';
import type { ModelTier } from '../ai/modelManifest';
import { MODEL_INFO } from '../ai/modelManifest';
import { isLocalAIFeatureEnabled } from '../ai/policy';
import { useSettingsStore } from '../store/settings';
import { initDB, type ProcessingJobDocType, type TextIssueDocType } from '../sync/db';
import type { TextIssueCandidate } from './anomalyScanner';
import {
    buildRepairPrompt,
    buildRepairRetryPrompt,
    parseRepairResponse,
    RepairResponseError,
    REPAIR_RESPONSE_CONTRACT_VERSION,
} from './repairResponse';
import {
    activateChapterRepairBatch,
    buildChapterRepairPlan,
    prepareChapterRepairBatch,
} from './repairBatch';

export const REPAIR_QUEUE_PIPELINE_VERSION = 'repair-queue-v1';
export const REPAIR_PARSER_VERSION = REPAIR_RESPONSE_CONTRACT_VERSION;

export interface RepairCompletionInput {
    candidate: TextIssueCandidate;
    sourceText: string;
    context: RepairContext;
    prompt: string;
    modelTier: ModelTier;
}

export interface RepairCompletionResult {
    response: string;
    finishReason?: string;
}

export interface RepairCompletionClient {
    complete(input: RepairCompletionInput, signal?: AbortSignal): Promise<RepairCompletionResult>;
}

export interface RepairJobCheckpointV1 {
    kind: 'repair-proposal';
    version: 1;
    batchId: string;
    issueId: string;
    promptFingerprint: string;
    parserVersion: string;
    failureCode?: string;
    failureMessage?: string;
}

export interface RepairQueueStatus {
    total: number;
    pending: number;
    running: number;
    blocked: number;
    completed: number;
    failed: number;
    cancelled: number;
    stale: number;
}

export interface RepairApplyResult {
    selected: number;
    applied: number;
    blocked: number;
    errors: { sourceUnitId: string; message: string }[];
}

const FORMAT_FAILURES = new Set<RepairResponseError['code']>([
    'response-too-large',
    'empty-response',
    'multiple-fenced-blocks',
    'invalid-fenced-block',
    'multiple-json-objects',
    'unsupported-json',
    'invalid-legacy-proposal',
    'empty-replacement',
    'replacement-too-long',
]);

const productionCompletionClient: RepairCompletionClient = {
    complete: async (input, signal) => await completeRepairResponse(
        input.candidate,
        input.sourceText,
        input.modelTier,
        signal,
    ),
};

const safeMessage = (error: unknown): string => (
    (error instanceof Error ? error.message : String(error)).slice(0, 240)
);

const parseCheckpoint = (value: string | undefined): RepairJobCheckpointV1 | null => {
    if (!value) return null;
    try {
        const checkpoint = JSON.parse(value) as Partial<RepairJobCheckpointV1>;
        if (
            checkpoint.kind !== 'repair-proposal'
            || checkpoint.version !== 1
            || typeof checkpoint.batchId !== 'string'
            || typeof checkpoint.issueId !== 'string'
            || typeof checkpoint.promptFingerprint !== 'string'
            || typeof checkpoint.parserVersion !== 'string'
        ) return null;
        return checkpoint as RepairJobCheckpointV1;
    } catch {
        return null;
    }
};

const serializeCheckpoint = (checkpoint: RepairJobCheckpointV1): string => JSON.stringify(checkpoint);

const activeRevisionFor = async (db: Awaited<ReturnType<typeof initDB>>, issue: TextIssueDocType) => {
    const revisions = await db.content_revisions.find({
        selector: { bookId: issue.bookId, sourceUnitId: issue.sourceUnitId, state: 'active' },
        sort: [{ createdAt: 'desc' }],
        limit: 1,
    }).exec();
    return revisions[0];
};

const makeJobIdentity = (issueId: string, modelTier: ModelTier): string => (
    `repair:${REPAIR_QUEUE_PIPELINE_VERSION}:${issueId}:${modelTier}`
);

const makeCheckpoint = (
    issueId: string,
    promptFingerprint: string,
    batchId: string,
): RepairJobCheckpointV1 => ({
    kind: 'repair-proposal',
    version: 1,
    batchId,
    issueId,
    promptFingerprint,
    parserVersion: REPAIR_PARSER_VERSION,
});

const isFormatFailure = (error: unknown): error is RepairResponseError => (
    error instanceof RepairResponseError && FORMAT_FAILURES.has(error.code)
);

export class RepairQueueService {
    private readonly workers = new Map<string, Promise<void>>();
    private readonly clients = new Map<string, RepairCompletionClient>();
    private readonly modelTiers = new Map<string, ModelTier>();
    private readonly pausedBooks = new Set<string>();
    private readonly cancelRequestedBooks = new Set<string>();
    private readonly activeControllers = new Map<string, AbortController>();

    public async startBook(
        bookId: string,
        modelTier: ModelTier,
        completionClient: RepairCompletionClient = productionCompletionClient,
    ): Promise<RepairQueueStatus> {
        const db = await initDB();
        const settings = useSettingsStore.getState();
        this.clients.set(bookId, completionClient);
        this.modelTiers.set(bookId, modelTier);
        this.pausedBooks.delete(bookId);
        this.cancelRequestedBooks.delete(bookId);

        if (!isLocalAIFeatureEnabled(settings, 'repair')) {
            return await this.getStatus(bookId);
        }

        const issues = await db.text_issues.find({ selector: { bookId, state: 'open' } }).exec();
        const batchId = `${bookId}:${Date.now()}`;
        for (const issueDocument of issues) {
            const issue = issueDocument.toJSON
                ? issueDocument.toJSON() as TextIssueDocType
                : issueDocument as TextIssueDocType;
            const chapter = await db.chapters.findOne(issue.sourceUnitId).exec();
            const revision = await activeRevisionFor(db, issue);
            if (!chapter || !revision || revision.textHash !== issue.revisionHash) continue;

            const sourceText = chapter.content.join(' ');
            const context = createRepairContext(sourceText, issue);
            const prompt = buildRepairPrompt(issue, context);
            const promptFingerprint = await fingerprintValue({
                contract: REPAIR_RESPONSE_CONTRACT_VERSION,
                prompt,
                model: MODEL_INFO[modelTier].id,
                revisionHash: issue.revisionHash,
            });
            const id = makeJobIdentity(issue.id, modelTier);
            const existing = await db.processing_jobs.findOne(id).exec();
            const checkpoint = makeCheckpoint(issue.id, promptFingerprint, existing ? (parseCheckpoint(existing.checkpoint)?.batchId || batchId) : batchId);
            const now = Date.now();
            const document: ProcessingJobDocType = {
                id,
                dedupeKey: id,
                feature: 'repair',
                bookId,
                sourceUnitId: issue.sourceUnitId,
                inputRevisionHash: issue.revisionHash,
                modelFingerprint: MODEL_INFO[modelTier].id,
                pipelineVersion: REPAIR_QUEUE_PIPELINE_VERSION,
                state: existing?.state === 'completed'
                    && existing.inputRevisionHash === issue.revisionHash
                    && parseCheckpoint(existing.checkpoint)?.promptFingerprint === promptFingerprint
                    && parseCheckpoint(existing.checkpoint)?.parserVersion === REPAIR_PARSER_VERSION
                    && Boolean(issue.proposal)
                    ? 'completed'
                    : 'pending',
                attemptCount: existing?.attemptCount || 0,
                checkpoint: serializeCheckpoint(checkpoint),
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            if (existing) await existing.incrementalModify(() => document);
            else await db.processing_jobs.insert(document);
        }

        this.startWorker(bookId);
        return await this.getStatus(bookId);
    }

    public async resumeBook(bookId: string, modelTier?: ModelTier, completionClient?: RepairCompletionClient): Promise<void> {
        const db = await initDB();
        const settings = useSettingsStore.getState();
        const enabled = isLocalAIFeatureEnabled(settings, 'repair');
        const jobs = await db.processing_jobs.find({
            selector: { bookId, feature: 'repair', state: { $in: ['pending', 'running', 'blocked'] } },
        }).exec();
        for (const job of jobs) {
            if (job.state === 'running') await job.incrementalPatch({ state: 'pending', updatedAt: Date.now() });
            else if (job.state === 'blocked' && enabled) await job.incrementalPatch({ state: 'pending', updatedAt: Date.now() });
            else if (!enabled && job.state !== 'blocked') await job.incrementalPatch({ state: 'blocked', updatedAt: Date.now() });
        }
        if (enabled) {
            this.modelTiers.set(bookId, modelTier || this.modelTiers.get(bookId) || settings.repairModelId || 'qwen');
            if (completionClient) this.clients.set(bookId, completionClient);
            this.startWorker(bookId);
        }
    }

    public async pause(bookId: string): Promise<void> {
        this.pausedBooks.add(bookId);
    }

    public async resume(bookId: string): Promise<void> {
        this.pausedBooks.delete(bookId);
        this.cancelRequestedBooks.delete(bookId);
        await this.resumeBook(bookId);
    }

    public async cancelPending(bookId: string): Promise<void> {
        this.cancelRequestedBooks.add(bookId);
        this.activeControllers.get(bookId)?.abort();
        const db = await initDB();
        const jobs = await db.processing_jobs.find({ selector: { bookId, feature: 'repair', state: 'pending' } }).exec();
        await Promise.all(jobs.map((job) => job.incrementalPatch({ state: 'cancelled', updatedAt: Date.now() })));
    }

    public async cancel(bookId: string): Promise<void> {
        await this.cancelPending(bookId);
    }

    public async retryFailed(bookId: string): Promise<void> {
        const db = await initDB();
        const jobs = await db.processing_jobs.find({ selector: { bookId, feature: 'repair', state: 'failed' } }).exec();
        await Promise.all(jobs.map(async (job) => {
            const checkpoint = parseCheckpoint(job.checkpoint);
            if (!checkpoint) return await job.incrementalPatch({ state: 'stale', updatedAt: Date.now() });
            await job.incrementalPatch({
                state: 'pending',
                checkpoint: serializeCheckpoint(checkpoint),
                updatedAt: Date.now(),
            });
        }));
        this.pausedBooks.delete(bookId);
        this.cancelRequestedBooks.delete(bookId);
        this.startWorker(bookId);
    }

    public async applyReady(bookId: string, issueIds?: string[]): Promise<RepairApplyResult> {
        const db = await initDB();
        const requestedIds = issueIds ? new Set(issueIds) : undefined;
        const issueDocuments = await db.text_issues.find({ selector: { bookId, state: 'open' } }).exec();
        const readyIssues = issueDocuments
            .map((document) => document.toJSON ? document.toJSON() as TextIssueDocType : document as TextIssueDocType)
            .filter((issue) => Boolean(issue.proposal) && (!requestedIds || requestedIds.has(issue.id)));
        const groups = new Map<string, TextIssueDocType[]>();
        for (const issue of readyIssues) {
            const group = groups.get(issue.sourceUnitId) || [];
            group.push(issue);
            groups.set(issue.sourceUnitId, group);
        }
        const result: RepairApplyResult = {
            selected: readyIssues.length,
            applied: 0,
            blocked: 0,
            errors: [],
        };
        for (const [sourceUnitId, group] of groups) {
            try {
                const chapter = await db.chapters.findOne(sourceUnitId).exec();
                const revision = await activeRevisionFor(db, group[0]);
                if (!chapter || !revision) throw new Error('Chapter has no active revision. Scan it again first.');
                const sourceText = chapter.content.join(' ');
                const plan = await buildChapterRepairPlan({
                    sourceText,
                    sourceUnitId,
                    sourceRevisionHash: revision.textHash,
                    selections: group.map((issue) => ({
                        candidate: issue,
                        proposal: issue.proposal!,
                    })),
                });
                if (!plan.valid) throw new Error(plan.errors[0]?.message || 'Selected repairs failed validation.');
                const prepared = await prepareChapterRepairBatch({
                    plan,
                    sourceRevisionId: revision.id,
                    currentRevisionId: revision.id,
                    pipelineFingerprint: REPAIR_QUEUE_PIPELINE_VERSION,
                    validatorFingerprint: REPAIR_PARSER_VERSION,
                    acceptanceAction: 'accept-all-safe',
                    proposalState: 'proposed',
                });
                await activateChapterRepairBatch(prepared);
                result.applied += group.length;
            } catch (error) {
                result.blocked += group.length;
                result.errors.push({ sourceUnitId, message: safeMessage(error) });
            }
        }
        return result;
    }

    public async getStatus(bookId: string): Promise<RepairQueueStatus> {
        const db = await initDB();
        const jobs = await db.processing_jobs.find({ selector: { bookId, feature: 'repair' } }).exec();
        const status: RepairQueueStatus = {
            total: jobs.length,
            pending: 0,
            running: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            stale: 0,
        };
        for (const job of jobs) status[job.state] += 1;
        return status;
    }

    public async waitForIdle(bookId: string): Promise<void> {
        await this.workers.get(bookId);
    }

    private startWorker(bookId: string): void {
        if (this.workers.has(bookId)) return;
        const worker = this.processBook(bookId)
            .catch((error) => console.warn('[RepairQueue] Worker stopped', error))
            .finally(() => this.workers.delete(bookId));
        this.workers.set(bookId, worker);
    }

    private async processBook(bookId: string): Promise<void> {
        while (!this.pausedBooks.has(bookId)) {
            const db = await initDB();
            const settings = useSettingsStore.getState();
            const jobs = await db.processing_jobs.find({
                selector: { bookId, feature: 'repair', state: 'pending' },
            }).exec();
            const job = jobs[0];
            if (!job) return;
            if (!isLocalAIFeatureEnabled(settings, 'repair')) {
                await job.incrementalPatch({ state: 'blocked', updatedAt: Date.now() });
                continue;
            }
            const checkpoint = parseCheckpoint(job.checkpoint);
            if (!checkpoint) {
                await job.incrementalPatch({ state: 'stale', updatedAt: Date.now() });
                continue;
            }
            const issueDocument = await db.text_issues.findOne(checkpoint.issueId).exec();
            const issue = issueDocument?.toJSON
                ? issueDocument.toJSON() as TextIssueDocType
                : issueDocument as TextIssueDocType | undefined;
            const chapter = issue ? await db.chapters.findOne(issue.sourceUnitId).exec() : undefined;
            const revision = issue ? await activeRevisionFor(db, issue) : undefined;
            if (!issueDocument || !issue || issue.state !== 'open' || !chapter || !revision || revision.textHash !== job.inputRevisionHash) {
                await job.incrementalPatch({ state: 'stale', updatedAt: Date.now() });
                continue;
            }

            const sourceText = chapter.content.join(' ');
            const sourceHash = await fingerprintValue(sourceText);
            if (sourceHash !== job.inputRevisionHash || issue.revisionHash !== job.inputRevisionHash) {
                await job.incrementalPatch({ state: 'stale', updatedAt: Date.now() });
                continue;
            }

            const context = createRepairContext(sourceText, issue);
            const prompt = checkpoint.failureMessage
                ? buildRepairRetryPrompt(issue, context, checkpoint.failureMessage)
                : buildRepairPrompt(issue, context);
            const attemptCount = job.attemptCount + 1;
            await job.incrementalPatch({ state: 'running', attemptCount, updatedAt: Date.now() });
            const controller = new AbortController();
            this.activeControllers.set(bookId, controller);
            try {
                const client = this.clients.get(bookId) || productionCompletionClient;
                const result = await client.complete({
                    candidate: issue,
                    sourceText,
                    context,
                    prompt,
                    modelTier: this.modelTiers.get(bookId) || 'qwen',
                }, controller.signal);
                if (result.finishReason === 'length') throw new RepairResponseError('response-too-large', 'Repair model response was truncated.');
                const proposal = parseRepairResponse(result.response, {
                    candidate: issue,
                    candidateText: context.candidateText,
                    leftContext: context.context.slice(0, context.startOffset - context.contextStartOffset),
                    rightContext: context.context.slice(context.endOffset - context.contextStartOffset),
                });
                const validation = await validateRepairProposal(issue, context.candidateText, proposal, job.inputRevisionHash);
                if (!validation.valid || !validation.proposal) throw new Error(validation.reason || 'Repair proposal failed validation.');
                await issueDocument.incrementalPatch({ proposal: validation.proposal, state: 'open', updatedAt: Date.now() });
                await job.incrementalPatch({
                    state: 'completed',
                    checkpoint: serializeCheckpoint(checkpoint),
                    updatedAt: Date.now(),
                });
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    await job.incrementalPatch({
                        state: this.cancelRequestedBooks.has(bookId) ? 'cancelled' : 'pending',
                        updatedAt: Date.now(),
                    });
                } else if (isFormatFailure(error) && attemptCount < 2) {
                    await job.incrementalPatch({
                        state: 'pending',
                        checkpoint: serializeCheckpoint({
                            ...checkpoint,
                            failureCode: error.code,
                            failureMessage: safeMessage(error),
                        }),
                        updatedAt: Date.now(),
                    });
                } else {
                    const failureCode = error instanceof RepairResponseError ? error.code : 'validation-failed';
                    await job.incrementalPatch({
                        state: 'failed',
                        checkpoint: serializeCheckpoint({
                            ...checkpoint,
                            failureCode,
                            failureMessage: safeMessage(error),
                        }),
                        updatedAt: Date.now(),
                    });
                }
            } finally {
                this.activeControllers.delete(bookId);
            }
        }
    }
}

export const repairQueue = new RepairQueueService();