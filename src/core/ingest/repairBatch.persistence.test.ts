import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import { initDB } from '../sync/db';
import type { TextIssueCandidate } from './anomalyScanner';
import {
    activateChapterRepairBatch,
    buildChapterRepairPlan,
    prepareChapterRepairBatch,
    type RepairBatchSelection,
} from './repairBatch';

vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

const makeSelection = async (
    sourceText: string,
    id: string,
    startOffset: number,
    endOffset: number,
    action: 'replace' | 'delete',
    replacement?: string,
): Promise<RepairBatchSelection> => {
    const revisionHash = await fingerprintValue(sourceText);
    const candidate: TextIssueCandidate = {
        id,
        bookId: 'book-1',
        sourceUnitId: 'chapter-1',
        revisionHash,
        startOffset,
        endOffset,
        originalHash: await fingerprintValue(sourceText.slice(startOffset, endOffset)),
        detectorIds: ['numeric-alphanumeric-intrusion'],
        evidence: { value: sourceText.slice(startOffset, endOffset) },
        severity: 'medium',
        ambiguity: 'high',
    };
    return {
        candidate,
        proposal: {
            candidateId: id,
            action,
            ...(replacement !== undefined ? { replacement } : {}),
            reasonCode: 'ocr-substitution',
        },
    };
};

describe('repair batch persistence', () => {
    beforeEach(() => vi.clearAllMocks());

    it('prepares one revision and activates it idempotently after a chapter write', async () => {
        const sourceText = 'one th3 h0p';
        const sourceHash = await fingerprintValue(sourceText);
        const first = await makeSelection(sourceText, 'first', 4, 7, 'replace', 'the');
        const second = await makeSelection(sourceText, 'second', 8, 11, 'delete');
        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: sourceHash,
            selections: [first, second],
        });
        const sourceRevision = {
            id: 'revision-source',
            state: 'active' as const,
            textHash: sourceHash,
            incrementalPatch: vi.fn(async (patch) => Object.assign(sourceRevision, patch)),
        };
        const chapter = {
            id: 'chapter-1',
            content: sourceText.split(' '),
            densities: [1, 2, 3],
            analysisData: [
                { tokens: ['one'], surprisals: [1] },
                { tokens: ['th3'], surprisals: [2] },
                { tokens: ['h0p'], surprisals: [3] },
            ],
            subchapters: [{ title: 'Part', summary: 'old', startWordIndex: 0, endWordIndex: 3 }],
            incrementalPatch: vi.fn(async (patch) => Object.assign(chapter, patch)),
        };
        const readingState = {
            currentChapterId: 'chapter-1',
            currentWordIndex: 2,
            highlights: [{ id: 'highlight', chapterId: 'chapter-1', startWordIndex: 1, endWordIndex: 3 }],
            ttsPosition: { chapterId: 'chapter-1', sentenceIndex: 0, wordIndex: 2, audioTime: 1, timestamp: 1 },
            incrementalPatch: vi.fn(async (patch) => Object.assign(readingState, patch)),
        };
        const issueDocuments = new Map([
            ['first', { id: 'first', incrementalPatch: vi.fn() }],
            ['second', { id: 'second', incrementalPatch: vi.fn() }],
        ]);
        const annotationDocuments = new Map<string, Record<string, unknown>>();
        const preparedRevisions = new Map<string, Record<string, unknown>>();
        const mockDb = {
            content_revisions: {
                findOne: vi.fn((id: string) => ({
                    exec: async () => id === sourceRevision.id ? sourceRevision : preparedRevisions.get(id),
                })),
                bulkUpsert: vi.fn(async (documents: Record<string, unknown>[]) => {
                    for (const document of documents) {
                        const stored = {
                            ...document,
                            incrementalPatch: vi.fn(async (patch: Record<string, unknown>) => Object.assign(stored, patch)),
                        };
                        preparedRevisions.set(document.id as string, stored);
                    }
                }),
            },
            chapters: {
                findOne: vi.fn(() => ({ exec: async () => chapter })),
            },
            reading_states: {
                findOne: vi.fn(() => ({ exec: async () => readingState })),
            },
            repair_annotations: {
                bulkUpsert: vi.fn(async (documents: Record<string, unknown>[]) => {
                    for (const document of documents) {
                        annotationDocuments.set(document.id as string, {
                            ...document,
                            incrementalPatch: vi.fn(async (patch: Record<string, unknown>) => {
                                const stored = annotationDocuments.get(document.id as string);
                                if (stored) Object.assign(stored, patch);
                            }),
                        });
                    }
                }),
                findOne: vi.fn((id: string) => ({ exec: async () => annotationDocuments.get(id) })),
            },
            text_issues: {
                findOne: vi.fn((id: string) => ({ exec: async () => issueDocuments.get(id) })),
            },
        };
        vi.mocked(initDB).mockResolvedValue(mockDb as never);

        const prepared = await prepareChapterRepairBatch({
            plan,
            sourceRevisionId: sourceRevision.id,
            pipelineFingerprint: 'repair-batch-v1',
            validatorFingerprint: 'validator-v1',
            acceptanceAction: 'accept-all-safe',
        });
        expect(mockDb.content_revisions.bulkUpsert).toHaveBeenCalledTimes(1);
        expect(prepared.revision?.acceptedPatchIds).toEqual(['first', 'second']);
        expect(prepared.annotations).toHaveLength(2);
        if (!prepared.revision) throw new Error('Expected a prepared revision');
        const preparedRevisionId = prepared.revision.id;
        const firstIssue = issueDocuments.get('first');
        const secondIssue = issueDocuments.get('second');
        if (!firstIssue || !secondIssue) throw new Error('Expected both issue documents');

        const activated = await activateChapterRepairBatch(prepared);
        expect(activated.nextText).toBe('one the');
        expect(chapter.content).toEqual(['one', 'the']);
        expect(chapter.incrementalPatch).toHaveBeenCalledTimes(1);
        expect(sourceRevision.incrementalPatch).toHaveBeenCalledWith({ state: 'superseded' });
        expect(preparedRevisions.get(preparedRevisionId)?.state).toBe('active');
        expect(firstIssue.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({ state: 'accepted' }));
        expect(secondIssue.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({ state: 'accepted' }));

        await activateChapterRepairBatch(prepared);
        expect(chapter.incrementalPatch).toHaveBeenCalledTimes(1);
        expect(preparedRevisions.get(preparedRevisionId)?.state).toBe('active');
    });
});