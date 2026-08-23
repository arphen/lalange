import { fingerprintValue } from '../exchange/fingerprint';
import type { RxDocument } from 'rxdb';
import {
    initDB,
    type MyDatabase,
    type ContentRevisionDocType,
    type RepairAnnotationDocType,
} from '../sync/db';
import {
    applyRepairProposal,
    validateRepairProposal,
    type RepairProposal,
} from './repair';
import type { TextIssueCandidate } from './anomalyScanner';

export interface RepairBatchSelection {
    candidate: TextIssueCandidate;
    proposal: RepairProposal;
    modelFingerprint?: string;
    promptFingerprint?: string;
}

export type RepairBatchErrorCode =
    | 'mixed-source'
    | 'stale-source'
    | 'duplicate-candidate'
    | 'invalid-proposal'
    | 'overlap';

export interface RepairBatchPlanError {
    code: RepairBatchErrorCode;
    candidateIds: string[];
    message: string;
}

export interface RepairBatchDecision extends RepairBatchSelection {
    originalText: string;
    replacementText: string;
    canonicalStartOffset: number;
    canonicalEndOffset: number;
    sourceContextHash: string;
    canonicalAnchorHash: string;
}

export interface RepairBatchPlan {
    bookId: string;
    sourceUnitId: string;
    sourceRevisionHash: string;
    sourceText: string;
    finalText: string;
    finalTextHash: string;
    changingPatches: RepairBatchDecision[];
    keepDecisions: RepairBatchDecision[];
    errors: RepairBatchPlanError[];
    valid: boolean;
}

export interface RepairProjectionPatch {
    sourceStartOffset: number;
    sourceEndOffset: number;
    canonicalStartOffset: number;
    canonicalEndOffset: number;
    replacementText: string;
}

export interface RepairProjectionHighlight {
    chapterId: string;
    startWordIndex: number;
    endWordIndex: number;
    [key: string]: unknown;
}

export interface RepairProjectionInput {
    sourceText: string;
    finalText: string;
    patches: RepairProjectionPatch[];
    densities?: number[];
    analysisData?: { tokens: string[]; surprisals: number[] }[];
    subchapters?: { title: string; startWordIndex: number; endWordIndex: number; summary: string; [key: string]: unknown }[];
    currentWordIndex?: number;
    highlights?: RepairProjectionHighlight[];
    ttsPosition?: { chapterId: string; wordIndex: number; [key: string]: unknown };
}

export interface RepairProjectionResult {
    content: string[];
    densities: number[];
    analysisData: { tokens: string[]; surprisals: number[] }[];
    subchapters: { title: string; startWordIndex: number; endWordIndex: number; summary: string; [key: string]: unknown }[];
    currentWordIndex?: number;
    highlights?: RepairProjectionHighlight[];
    ttsPosition?: { chapterId: string; wordIndex: number; [key: string]: unknown };
}

export interface PreparedChapterRepairBatch {
    plan: RepairBatchPlan;
    sourceRevisionId: string;
    revision?: ContentRevisionDocType;
    annotations: RepairAnnotationDocType[];
}

export interface ActivatedChapterRepairBatch extends PreparedChapterRepairBatch {
    nextText: string;
}

const contextHashFor = async (text: string, startOffset: number, endOffset: number): Promise<string> => (
    fingerprintValue(text.slice(Math.max(0, startOffset - 80), Math.min(text.length, endOffset + 80)))
);

const replacementFor = (sourceText: string, selection: RepairBatchSelection): string => {
    if (selection.proposal.action === 'delete') return '';
    if (selection.proposal.action === 'keep') {
        return sourceText.slice(selection.candidate.startOffset, selection.candidate.endOffset);
    }
    return selection.proposal.replacement ?? '';
};

const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const sourceWordRange = (sourceText: string, patch: RepairProjectionPatch): { start: number; end: number } => ({
    start: countWords(sourceText.slice(0, patch.sourceStartOffset)),
    end: countWords(sourceText.slice(0, patch.sourceEndOffset)),
});

const canonicalWordRange = (finalText: string, patch: RepairProjectionPatch): { start: number; end: number } => ({
    start: countWords(finalText.slice(0, patch.canonicalStartOffset)),
    end: countWords(finalText.slice(0, patch.canonicalEndOffset)),
});

const projectWordIndex = (
    wordIndex: number,
    sourceText: string,
    patches: RepairProjectionPatch[],
): number => {
    let cumulativeDelta = 0;
    for (const patch of patches) {
        const range = sourceWordRange(sourceText, patch);
        const replacementWordCount = countWords(patch.replacementText);
        if (wordIndex <= range.start) return wordIndex + cumulativeDelta;
        if (wordIndex < range.end) return range.start + cumulativeDelta + replacementWordCount;
        cumulativeDelta += replacementWordCount - (range.end - range.start);
    }
    return wordIndex + cumulativeDelta;
};

const sourceIndexForCanonicalWord = (
    wordIndex: number,
    finalText: string,
    sourceText: string,
    patches: RepairProjectionPatch[],
): number | null => {
    let cumulativeDelta = 0;
    for (const patch of patches) {
        const sourceRange = sourceWordRange(sourceText, patch);
        const canonicalRange = canonicalWordRange(finalText, patch);
        if (wordIndex < canonicalRange.start) return wordIndex - cumulativeDelta;
        if (wordIndex < canonicalRange.end) return null;
        cumulativeDelta += (canonicalRange.end - canonicalRange.start) - (sourceRange.end - sourceRange.start);
    }
    return wordIndex - cumulativeDelta;
};

export const projectRepairChapterState = (input: RepairProjectionInput): RepairProjectionResult => {
    const patches = [...input.patches].sort((left, right) => left.sourceStartOffset - right.sourceStartOffset);
    const content = input.finalText.trim().split(/\s+/).filter(Boolean);
    const densities = content.map((_, index) => {
        const sourceIndex = sourceIndexForCanonicalWord(index, input.finalText, input.sourceText, patches);
        return sourceIndex !== null && sourceIndex >= 0 && sourceIndex < (input.densities || []).length
            ? input.densities?.[sourceIndex] ?? 0
            : 0;
    });
    const analysisData = content.map((_, index) => {
        const sourceIndex = sourceIndexForCanonicalWord(index, input.finalText, input.sourceText, patches);
        return sourceIndex !== null && sourceIndex >= 0 && sourceIndex < (input.analysisData || []).length
            ? input.analysisData?.[sourceIndex] ?? { tokens: [], surprisals: [] }
            : { tokens: [], surprisals: [] };
    });
    const subchapters = (input.subchapters || []).map((subchapter) => ({
        ...subchapter,
        startWordIndex: projectWordIndex(subchapter.startWordIndex, input.sourceText, patches),
        endWordIndex: projectWordIndex(subchapter.endWordIndex, input.sourceText, patches),
        summary: '',
    }));
    const result: RepairProjectionResult = {
        content,
        densities,
        analysisData,
        subchapters,
    };
    if (input.currentWordIndex !== undefined) {
        result.currentWordIndex = projectWordIndex(input.currentWordIndex, input.sourceText, patches);
    }
    if (input.highlights) {
        result.highlights = input.highlights.map((highlight) => ({
            ...highlight,
            startWordIndex: projectWordIndex(highlight.startWordIndex, input.sourceText, patches),
            endWordIndex: projectWordIndex(highlight.endWordIndex, input.sourceText, patches),
        }));
    }
    if (input.ttsPosition) {
        result.ttsPosition = {
            ...input.ttsPosition,
            wordIndex: projectWordIndex(input.ttsPosition.wordIndex, input.sourceText, patches),
        };
    }
    return result;
};

const emptyPlan = (input: {
    bookId: string;
    sourceUnitId: string;
    sourceRevisionHash: string;
    sourceText: string;
    sourceTextHash: string;
    errors: RepairBatchPlanError[];
}): RepairBatchPlan => ({
    ...input,
    finalText: input.sourceText,
    finalTextHash: input.sourceTextHash,
    changingPatches: [],
    keepDecisions: [],
    valid: false,
});

export const buildChapterRepairPlan = async (input: {
    sourceText: string;
    sourceUnitId: string;
    sourceRevisionHash: string;
    selections: RepairBatchSelection[];
}): Promise<RepairBatchPlan> => {
    const sourceTextHash = await fingerprintValue(input.sourceText);
    const firstSelection = input.selections[0];
    const bookId = firstSelection?.candidate.bookId || '';
    const base = {
        bookId,
        sourceUnitId: input.sourceUnitId,
        sourceRevisionHash: input.sourceRevisionHash,
        sourceText: input.sourceText,
        sourceTextHash,
    };
    const errors: RepairBatchPlanError[] = [];

    if (sourceTextHash !== input.sourceRevisionHash) {
        errors.push({
            code: 'stale-source',
            candidateIds: input.selections.map(({ candidate }) => candidate.id),
            message: 'Chapter text no longer matches the selected active revision.',
        });
    }

    const candidateIds = new Set<string>();
    for (const selection of input.selections) {
        const { candidate } = selection;
        if (candidate.sourceUnitId !== input.sourceUnitId || candidate.revisionHash !== input.sourceRevisionHash) {
            errors.push({
                code: 'mixed-source',
                candidateIds: [candidate.id],
                message: 'Selected repairs do not belong to one chapter revision.',
            });
        }
        if (candidateIds.has(candidate.id)) {
            errors.push({
                code: 'duplicate-candidate',
                candidateIds: [candidate.id],
                message: 'The same repair candidate was selected more than once.',
            });
        }
        candidateIds.add(candidate.id);
    }

    const validations = await Promise.all(input.selections.map(async (selection) => {
        const originalText = input.sourceText.slice(selection.candidate.startOffset, selection.candidate.endOffset);
        const validation = await validateRepairProposal(
            selection.candidate,
            originalText,
            selection.proposal,
            input.sourceRevisionHash,
        );
        return { selection, originalText, validation };
    }));

    for (const { selection, validation } of validations) {
        if (!validation.valid) {
            errors.push({
                code: 'invalid-proposal',
                candidateIds: [selection.candidate.id],
                message: validation.reason || 'Repair proposal failed validation.',
            });
        }
    }

    const ordered = [...validations].sort((left, right) => (
        left.selection.candidate.startOffset - right.selection.candidate.startOffset
        || left.selection.candidate.endOffset - right.selection.candidate.endOffset
    ));
    for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1].selection.candidate;
        const current = ordered[index].selection.candidate;
        if (current.startOffset < previous.endOffset) {
            errors.push({
                code: 'overlap',
                candidateIds: [previous.id, current.id],
                message: 'Overlapping repair spans require individual review.',
            });
        }
    }

    if (errors.length > 0) return emptyPlan({ ...base, errors });

    let finalText = input.sourceText;
    for (const { selection } of [...validations].sort((left, right) => (
        right.selection.candidate.startOffset - left.selection.candidate.startOffset
    ))) {
        finalText = applyRepairProposal(finalText, selection.candidate, selection.proposal);
    }
    finalText = finalText.trim();

    const sourceOrderedDecisions: RepairBatchDecision[] = [];
    let cumulativeDelta = 0;
    for (const { selection, originalText } of ordered) {
        const replacementText = replacementFor(input.sourceText, selection);
        const canonicalStartOffset = selection.candidate.startOffset + cumulativeDelta;
        const canonicalEndOffset = canonicalStartOffset + replacementText.length;
        const [sourceContextHash, canonicalAnchorHash] = await Promise.all([
            contextHashFor(input.sourceText, selection.candidate.startOffset, selection.candidate.endOffset),
            fingerprintValue(replacementText),
        ]);
        sourceOrderedDecisions.push({
            ...selection,
            originalText,
            replacementText,
            canonicalStartOffset,
            canonicalEndOffset,
            sourceContextHash,
            canonicalAnchorHash,
        });
        cumulativeDelta += replacementText.length - originalText.length;
    }

    const finalTextHash = await fingerprintValue(finalText);
    return {
        ...base,
        finalText,
        finalTextHash,
        changingPatches: sourceOrderedDecisions.filter(({ proposal }) => proposal.action !== 'keep'),
        keepDecisions: sourceOrderedDecisions.filter(({ proposal }) => proposal.action === 'keep'),
        errors: [],
        valid: true,
    };
};

export const prepareChapterRepairBatch = async (options: {
    plan: RepairBatchPlan;
    sourceRevisionId: string;
    currentRevisionId?: string;
    pipelineFingerprint: string;
    validatorFingerprint: string;
    acceptanceAction?: 'accept' | 'accept-all-safe';
    proposalState?: 'proposed' | 'accepted';
    database?: MyDatabase;
}): Promise<PreparedChapterRepairBatch> => {
    if (!options.plan.valid) throw new Error('Repair batch plan failed validation');
    const db = options.database || await initDB();
    const currentRevisionId = options.currentRevisionId || options.sourceRevisionId;
    const currentRevision = await db.content_revisions.findOne(currentRevisionId).exec();
    if (!currentRevision || currentRevision.state !== 'active' || currentRevision.textHash !== options.plan.sourceRevisionHash) {
        throw new Error('Repair batch is stale for the active revision');
    }
    const chapter = await db.chapters.findOne(options.plan.sourceUnitId).exec();
    if (!chapter) throw new Error('Repair batch chapter no longer exists');
    const chapterText = chapter.content.join(' ');
    if (await fingerprintValue(chapterText) !== options.plan.sourceRevisionHash) {
        throw new Error('Repair batch chapter text changed before preparation');
    }

    const now = Date.now();
    const revision = options.plan.changingPatches.length > 0
        ? {
            id: `${options.plan.sourceUnitId}:${options.pipelineFingerprint}:${options.plan.finalTextHash}`,
            bookId: options.plan.bookId,
            sourceUnitId: options.plan.sourceUnitId,
            parentRevisionId: currentRevisionId,
            sourceHash: options.plan.sourceRevisionHash,
            textHash: options.plan.finalTextHash,
            pipelineVersion: options.pipelineFingerprint,
            acceptedPatchIds: options.plan.changingPatches.map(({ candidate }) => candidate.id),
            createdAt: now,
            state: 'prepared' as const,
        }
        : undefined;
    if (revision) await db.content_revisions.bulkUpsert([revision]);

    const decisions = [...options.plan.changingPatches, ...options.plan.keepDecisions];
    const annotations = decisions.map((decision): RepairAnnotationDocType => {
        const canonicalRevisionId = revision?.id || currentRevisionId;
        return {
            id: `${decision.candidate.id}:${options.plan.finalTextHash.slice(0, 12)}`,
            bookId: options.plan.bookId,
            sourceUnitId: options.plan.sourceUnitId,
            sourceRevisionId: options.sourceRevisionId,
            canonicalRevisionId,
            sourceAnchor: {
                startOffset: decision.candidate.startOffset,
                endOffset: decision.candidate.endOffset,
                contextHash: decision.sourceContextHash,
            },
            canonicalAnchor: {
                startOffset: decision.canonicalStartOffset,
                endOffset: decision.canonicalEndOffset,
                anchorHash: decision.canonicalAnchorHash,
            },
            originalText: decision.originalText,
            replacementText: decision.replacementText,
            action: decision.proposal.action,
            detectorIds: decision.candidate.detectorIds,
            detectorEvidence: decision.candidate.evidence,
            ...(decision.modelFingerprint ? { modelFingerprint: decision.modelFingerprint } : {}),
            ...(decision.promptFingerprint ? { promptFingerprint: decision.promptFingerprint } : {}),
            validatorFingerprint: options.validatorFingerprint,
            pipelineFingerprint: options.pipelineFingerprint,
            proposalState: options.proposalState || 'proposed',
            acceptanceAction: options.acceptanceAction || 'accept',
            renderRange: {
                kind: 'text-range',
                startOffset: decision.canonicalStartOffset,
                endOffset: decision.canonicalEndOffset,
                anchorHash: decision.canonicalAnchorHash,
            },
        };
    });
    if (annotations.length > 0) await db.repair_annotations.bulkUpsert(annotations);
    return {
        plan: options.plan,
        sourceRevisionId: options.sourceRevisionId,
        ...(revision ? { revision } : {}),
        annotations,
    };
};

export const activateChapterRepairBatch = async (
    prepared: PreparedChapterRepairBatch,
    database?: MyDatabase,
): Promise<ActivatedChapterRepairBatch> => {
    const db = database || await initDB();
    const chapter = await db.chapters.findOne(prepared.plan.sourceUnitId).exec();
    if (!chapter) throw new Error('Repair batch chapter no longer exists');
    const currentText = chapter.content.join(' ');
    const currentTextHash = await fingerprintValue(currentText);
    const sourceMatches = currentTextHash === prepared.plan.sourceRevisionHash;
    const finalMatches = currentTextHash === prepared.plan.finalTextHash;
    if (!sourceMatches && !finalMatches) throw new Error('Repair batch is stale for the current chapter text');

    const revision = prepared.revision
        ? await db.content_revisions.findOne(prepared.revision.id).exec()
        : undefined;
    if (prepared.revision && !revision) throw new Error('Prepared repair revision no longer exists');
    let sourceRevision: RxDocument<ContentRevisionDocType> | null = null;

    if (prepared.revision && revision?.state !== 'active' && sourceMatches) {
        sourceRevision = await db.content_revisions.findOne(prepared.sourceRevisionId).exec();
        if (!sourceRevision || sourceRevision.state !== 'active' || sourceRevision.textHash !== prepared.plan.sourceRevisionHash) {
            throw new Error('Repair batch is stale for the active revision');
        }
        const projection = projectRepairChapterState({
            sourceText: prepared.plan.sourceText,
            finalText: prepared.plan.finalText,
            patches: prepared.plan.changingPatches.map((patch) => ({
                sourceStartOffset: patch.candidate.startOffset,
                sourceEndOffset: patch.candidate.endOffset,
                canonicalStartOffset: patch.canonicalStartOffset,
                canonicalEndOffset: patch.canonicalEndOffset,
                replacementText: patch.replacementText,
            })),
            densities: chapter.densities,
            analysisData: chapter.analysisData,
            subchapters: chapter.subchapters,
        });
        await chapter.incrementalPatch({
            content: projection.content,
            densities: projection.densities,
            analysisData: projection.analysisData,
            subchapters: projection.subchapters,
        });

        const readingState = await db.reading_states.findOne({ selector: { bookId: prepared.plan.bookId } }).exec();
        if (readingState) {
            const affectedHighlights = readingState.highlights.filter((highlight) => highlight.chapterId === prepared.plan.sourceUnitId);
            const stateProjection = projectRepairChapterState({
                sourceText: prepared.plan.sourceText,
                finalText: prepared.plan.finalText,
                patches: prepared.plan.changingPatches.map((patch) => ({
                    sourceStartOffset: patch.candidate.startOffset,
                    sourceEndOffset: patch.candidate.endOffset,
                    canonicalStartOffset: patch.canonicalStartOffset,
                    canonicalEndOffset: patch.canonicalEndOffset,
                    replacementText: patch.replacementText,
                })),
                currentWordIndex: readingState.currentChapterId === prepared.plan.sourceUnitId
                    ? readingState.currentWordIndex
                    : undefined,
                highlights: affectedHighlights,
                ttsPosition: readingState.ttsPosition?.chapterId === prepared.plan.sourceUnitId
                    ? readingState.ttsPosition
                    : undefined,
            });
            await readingState.incrementalPatch({
                ...(stateProjection.currentWordIndex !== undefined ? { currentWordIndex: stateProjection.currentWordIndex } : {}),
                highlights: readingState.highlights.map((highlight) => (
                    highlight.chapterId === prepared.plan.sourceUnitId
                        ? stateProjection.highlights?.find((projected) => projected.id === highlight.id) || highlight
                        : highlight
                )) as typeof readingState.highlights,
                ...(stateProjection.ttsPosition ? {
                    ttsPosition: stateProjection.ttsPosition as NonNullable<typeof readingState.ttsPosition>,
                } : {}),
            });
        }
    }

    if (prepared.revision && revision?.state === 'prepared') {
        sourceRevision = sourceRevision || await db.content_revisions.findOne(prepared.sourceRevisionId).exec();
        if (sourceRevision && sourceRevision.id !== revision.id && sourceRevision.state === 'active') {
            await sourceRevision.incrementalPatch({ state: 'superseded' });
        }
        await revision.incrementalPatch({ state: 'active' });
    }

    const now = Date.now();
    const decisions = [...prepared.plan.changingPatches, ...prepared.plan.keepDecisions];
    for (const [index, annotation] of prepared.annotations.entries()) {
        const annotationDocument = await db.repair_annotations.findOne(annotation.id).exec();
        if (annotationDocument) {
            await annotationDocument.incrementalPatch({
                proposalState: annotation.action === 'keep' ? 'kept-original' : 'accepted',
                acceptedAt: now,
            });
        }
        const issue = await db.text_issues.findOne(decisions[index]?.candidate.id || '').exec();
        if (issue) {
            await issue.incrementalPatch({
                state: annotation.action === 'keep' ? 'kept-original' : 'accepted',
                updatedAt: now,
            });
        }
    }

    return {
        ...prepared,
        ...(revision ? { revision: { ...prepared.revision!, state: 'active' as const } } : {}),
        nextText: prepared.plan.finalText,
    };
};