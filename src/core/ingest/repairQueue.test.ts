import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import { useSettingsStore } from '../store/settings';
import type { TextIssueCandidate } from './anomalyScanner';
import { RepairQueueService, type RepairCompletionClient } from './repairQueue';

vi.mock('../store/settings', () => ({
    useSettingsStore: {
        getState: vi.fn(),
    },
}));

vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

const { initDB } = await import('../sync/db');

type MutableDocument = Record<string, unknown> & {
    incrementalPatch: (patch: Record<string, unknown>) => Promise<void>;
    incrementalModify: (modify: () => Record<string, unknown>) => Promise<void>;
    toJSON: () => Record<string, unknown>;
};

const asDocument = (value: Record<string, unknown>): MutableDocument => {
    const document = value as MutableDocument;
    document.incrementalPatch = async (patch) => { Object.assign(document, patch); };
    document.incrementalModify = async (modify) => { Object.assign(document, modify()); };
    document.toJSON = () => ({ ...document });
    return document;
};

const query = (documents: MutableDocument[], selector: Record<string, unknown> = {}) => ({
    exec: async () => documents.filter((document) => Object.entries(selector).every(([key, expected]) => {
        if (expected && typeof expected === 'object' && '$in' in expected) {
            const values = expected.$in;
            return Array.isArray(values) && values.includes(document[key]);
        }
        return document[key] === expected;
    })),
});

const makeDatabase = async (issueCount: number) => {
    const sourceText = Array.from({ length: issueCount }, () => 'x').join(' ');
    const revisionHash = await fingerprintValue(sourceText);
    const issues: MutableDocument[] = [];
    for (let index = 0; index < issueCount; index += 1) {
        const startOffset = index * 2;
        const candidate: TextIssueCandidate = {
            id: `issue-${index}`,
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash,
            startOffset,
            endOffset: startOffset + 1,
            originalHash: await fingerprintValue('x'),
            detectorIds: ['numeric-alphanumeric-intrusion'],
            evidence: { value: 'x' },
            severity: 'medium',
            ambiguity: 'high',
        };
        issues.push(asDocument({ ...candidate, state: 'open', createdAt: index, updatedAt: index }));
    }
    const chapter = asDocument({ id: 'chapter-1', bookId: 'book-1', content: sourceText.split(' ') });
    const revision = asDocument({
        id: 'revision-1',
        bookId: 'book-1',
        sourceUnitId: 'chapter-1',
        textHash: revisionHash,
        state: 'active',
        createdAt: 1,
    });
    const jobs: MutableDocument[] = [];
    const database = {
        text_issues: {
            find: vi.fn((options: { selector?: Record<string, unknown> }) => query(issues, options.selector)),
            findOne: vi.fn((id: string) => ({ exec: async () => issues.find((issue) => issue.id === id) })),
        },
        chapters: {
            findOne: vi.fn((id: string) => ({ exec: async () => id === chapter.id ? chapter : undefined })),
        },
        content_revisions: {
            find: vi.fn(() => query([revision])),
        },
        processing_jobs: {
            find: vi.fn((options: { selector?: Record<string, unknown> }) => query(jobs, options.selector)),
            findOne: vi.fn((id: string) => ({ exec: async () => jobs.find((job) => job.id === id) })),
            insert: vi.fn(async (document: Record<string, unknown>) => {
                const stored = asDocument({ ...document });
                jobs.push(stored);
                return stored;
            }),
        },
    };
    vi.mocked(initDB).mockResolvedValue(database as unknown as Awaited<ReturnType<typeof initDB>>);
    return { database, issues, jobs, sourceText, revisionHash };
};

const makeClient = (response: string | ((index: number) => string)): RepairCompletionClient => {
    let calls = 0;
    return {
        complete: vi.fn(async () => ({
            response: typeof response === 'function' ? response(calls++) : (calls++, response),
        })),
    };
};

describe('persistent repair queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSettingsStore.getState).mockReturnValue({ textRepairMode: 'review', repairModelId: 'qwen' } as unknown as ReturnType<typeof useSettingsStore.getState>);
    });

    it('prepares all issues with one serial model call per issue', async () => {
        const { jobs, issues } = await makeDatabase(58);
        let active = 0;
        let maximumActive = 0;
        const client: RepairCompletionClient = {
            complete: vi.fn(async () => {
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                await Promise.resolve();
                active -= 1;
                return { response: 'fixed' };
            }),
        };
        const queue = new RepairQueueService();
        await queue.startBook('book-1', 'qwen', client);
        await queue.waitForIdle('book-1');

        expect(client.complete).toHaveBeenCalledTimes(58);
        expect(maximumActive).toBe(1);
        expect(jobs).toHaveLength(58);
        expect(jobs.every((job) => job.state === 'completed')).toBe(true);
        expect(issues.every((issue) => (issue.proposal as { replacement?: unknown } | undefined)?.replacement === 'fixed')).toBe(true);
    });

    it('deduplicates a second start and reuses completed proposals', async () => {
        await makeDatabase(3);
        const client = makeClient('fixed');
        const queue = new RepairQueueService();
        await queue.startBook('book-1', 'qwen', client);
        await queue.waitForIdle('book-1');
        await queue.startBook('book-1', 'qwen', client);
        await queue.waitForIdle('book-1');

        expect(client.complete).toHaveBeenCalledTimes(3);
    });

    it('retries one malformed response and continues after semantic failure', async () => {
        const { jobs } = await makeDatabase(2);
        const responses = ['```', 'fixed', 'th4'];
        const client = makeClient(() => responses.shift() || 'fixed');
        const queue = new RepairQueueService();
        await queue.startBook('book-1', 'qwen', client);
        await queue.waitForIdle('book-1');

        expect(client.complete).toHaveBeenCalledTimes(3);
        expect(jobs.map((job) => job.state)).toEqual(['completed', 'failed']);
        expect(jobs[1].checkpoint).toContain('validation-failed');
    });

    it('uses the recorded failure when manually retrying a failed job', async () => {
        await makeDatabase(1);
        const prompts: string[] = [];
        let calls = 0;
        const client: RepairCompletionClient = {
            complete: vi.fn(async ({ prompt }) => {
                prompts.push(prompt);
                calls += 1;
                return { response: calls < 3 ? '```' : 'fixed' };
            }),
        };
        const queue = new RepairQueueService();
        await queue.startBook('book-1', 'qwen', client);
        await queue.waitForIdle('book-1');
        await queue.retryFailed('book-1');
        await queue.waitForIdle('book-1');

        expect(client.complete).toHaveBeenCalledTimes(3);
        expect(prompts[2]).toContain('PREVIOUS FORMAT FAILURE:');
    });

    it('pauses after the active request and leaves pending jobs recoverable', async () => {
        const { jobs } = await makeDatabase(3);
        let release: (() => void) | undefined;
        const client: RepairCompletionClient = {
            complete: vi.fn(() => new Promise<{ response: string }>((resolve) => {
                release = () => resolve({ response: 'fixed' });
            })),
        };
        const queue = new RepairQueueService();
        await queue.startBook('book-1', 'qwen', client);
        await vi.waitFor(() => expect(client.complete).toHaveBeenCalledTimes(1));
        await queue.pause('book-1');
        release?.();
        await queue.waitForIdle('book-1');

        expect(client.complete).toHaveBeenCalledTimes(1);
        expect(jobs.filter((job) => job.state === 'pending')).toHaveLength(2);
    });

    it('marks a job stale when its active source revision changed before resume', async () => {
        const { database, jobs, issues, revisionHash } = await makeDatabase(1);
        const issue = issues[0];
        const checkpoint = JSON.stringify({
            kind: 'repair-proposal',
            version: 1,
            batchId: 'batch-1',
            issueId: issue.id,
            promptFingerprint: 'prompt',
            parserVersion: 'repair-response-v2',
        });
        await database.processing_jobs.insert({
            id: 'repair:repair-queue-v1:issue-0:qwen',
            dedupeKey: 'repair:repair-queue-v1:issue-0:qwen',
            feature: 'repair',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            inputRevisionHash: 'old-revision',
            modelFingerprint: 'Qwen2.5-1.5B-logprobs',
            pipelineVersion: 'repair-queue-v1',
            state: 'pending',
            attemptCount: 0,
            checkpoint,
            createdAt: 1,
            updatedAt: 1,
        });
        issue.revisionHash = revisionHash;
        const queue = new RepairQueueService();
        await queue.resumeBook('book-1', 'qwen', makeClient('fixed'));
        await queue.waitForIdle('book-1');

        expect(jobs[0].state).toBe('stale');
    });
});