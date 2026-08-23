import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import { initDB } from '../sync/db';
import { acceptRepairProposal, activateRepairRevision } from './repair';
import type { TextIssueCandidate } from './anomalyScanner';

vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

describe('repair acceptance persistence', () => {
    const issuePatch = vi.fn();
    const mockDb = {
        content_revisions: {
            findOne: vi.fn(),
            bulkUpsert: vi.fn(),
        },
        repair_annotations: {
            bulkUpsert: vi.fn(),
            findOne: vi.fn(),
        },
        text_issues: {
            findOne: vi.fn(),
        },
        chapters: {
            findOne: vi.fn(),
        },
        reading_states: {
            findOne: vi.fn(),
        },
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(initDB).mockResolvedValue(mockDb as never);
        mockDb.content_revisions.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue({
                id: 'revision-id',
                state: 'active',
                textHash: 'revision-hash',
            }),
        });
        mockDb.text_issues.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue({
                incrementalPatch: issuePatch,
            }),
        });
    });

    it('writes a prepared revision and annotation without replacing the source record', async () => {
        const sourceText = 'The th3 fox.';
        const sourceHash = await fingerprintValue(sourceText);
        mockDb.content_revisions.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue({
                id: 'revision-id',
                state: 'active',
                textHash: sourceHash,
            }),
        });
        const candidate: TextIssueCandidate = {
            id: 'chapter-1:4:7:hash',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash: sourceHash,
            startOffset: 4,
            endOffset: 7,
            originalHash: await fingerprintValue('th3'),
            detectorIds: ['numeric-alphanumeric-intrusion'],
            evidence: { value: 'th3' },
            severity: 'medium',
            ambiguity: 'high',
        };
        mockDb.chapters.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue({
                id: 'chapter-1',
                content: ['The', 'th3', 'fox.'],
            }),
        });

        const result = await acceptRepairProposal({
            candidate,
            proposal: {
                candidateId: candidate.id,
                action: 'replace',
                replacement: 'the',
                reasonCode: 'ocr-substitution',
            },
            sourceText,
            sourceRevisionId: 'revision-id',
            currentRevisionId: 'revision-id',
            pipelineFingerprint: 'repair-v1',
            validatorFingerprint: 'validator-v1',
            modelFingerprint: 'qwen-test',
        });

        expect(result.nextText).toBe('The the fox.');
        expect(mockDb.content_revisions.bulkUpsert).toHaveBeenCalledWith([
            expect.objectContaining({
                parentRevisionId: 'revision-id',
                state: 'prepared',
                acceptedPatchIds: [candidate.id],
            }),
        ]);
        expect(mockDb.repair_annotations.bulkUpsert).toHaveBeenCalledWith([
            expect.objectContaining({
                proposalState: 'accepted',
                originalText: 'th3',
                replacementText: 'the',
                canonicalRevisionId: result.revision.id,
            }),
        ]);
        expect(issuePatch).toHaveBeenCalledWith(expect.objectContaining({
            state: 'accepted',
            proposal: expect.objectContaining({ action: 'replace' }),
        }));
    });

    it('rejects acceptance when the active revision moved on', async () => {
        mockDb.content_revisions.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue({
                id: 'revision-id',
                state: 'active',
                textHash: 'different-hash',
            }),
        });
        const candidate: TextIssueCandidate = {
            id: 'candidate',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash: await fingerprintValue('th3'),
            startOffset: 0,
            endOffset: 3,
            originalHash: await fingerprintValue('th3'),
            detectorIds: ['numeric-alphanumeric-intrusion'],
            evidence: {},
            severity: 'medium',
            ambiguity: 'high',
        };

        await expect(acceptRepairProposal({
            candidate,
            proposal: { candidateId: candidate.id, action: 'delete', reasonCode: 'stray-page-marker' },
            sourceText: 'th3',
            sourceRevisionId: 'revision-id',
            currentRevisionId: 'revision-id',
            pipelineFingerprint: 'repair-v1',
            validatorFingerprint: 'validator-v1',
        })).rejects.toThrow('stale for the active revision');
        expect(mockDb.content_revisions.bulkUpsert).not.toHaveBeenCalled();
    });

    it('activates a prepared repair and remaps reader anchors', async () => {
        const chapterPatch = vi.fn();
        const readingStatePatch = vi.fn();
        const activeRevisionPatch = vi.fn();
        const preparedRevisionPatch = vi.fn();
        const annotationPatch = vi.fn();
        const sourceText = 'The th3 fox.';
        const nextText = 'The the fox.';
        const sourceHash = await fingerprintValue(sourceText);
        const nextHash = await fingerprintValue(nextText);
        const candidate: TextIssueCandidate = {
            id: 'chapter-1:4:7:hash',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash: sourceHash,
            startOffset: 4,
            endOffset: 7,
            originalHash: await fingerprintValue('th3'),
            detectorIds: ['numeric-alphanumeric-intrusion'],
            evidence: { value: 'th3' },
            severity: 'medium',
            ambiguity: 'high',
        };
        const revision = {
            id: 'prepared-revision',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            parentRevisionId: 'revision-id',
            sourceHash,
            textHash: nextHash,
            pipelineVersion: 'repair-v1',
            acceptedPatchIds: [candidate.id],
            createdAt: 2,
            state: 'prepared' as const,
        };
        const annotation = {
            id: 'annotation-1',
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            sourceRevisionId: 'revision-id',
            canonicalRevisionId: revision.id,
            sourceAnchor: { startOffset: 4, endOffset: 7, contextHash: 'context' },
            canonicalAnchor: { startOffset: 4, endOffset: 7, anchorHash: 'anchor' },
            originalText: 'th3',
            replacementText: 'the',
            action: 'replace' as const,
            detectorIds: candidate.detectorIds,
            detectorEvidence: candidate.evidence,
            validatorFingerprint: 'validator-v1',
            pipelineFingerprint: 'repair-v1',
            proposalState: 'accepted' as const,
            renderRange: { kind: 'text-range' as const, startOffset: 4, endOffset: 7, anchorHash: 'anchor' },
        };
        const activeRevision = { id: 'revision-id', state: 'active' as const, textHash: sourceHash, incrementalPatch: activeRevisionPatch };
        const preparedDocument = { ...revision, incrementalPatch: preparedRevisionPatch };
        const chapter = {
            id: 'chapter-1',
            content: ['The', 'th3', 'fox.'],
            densities: [1, 2, 3],
            analysisData: [
                { tokens: ['The'], surprisals: [1] },
                { tokens: ['th3'], surprisals: [2] },
                { tokens: ['fox.'], surprisals: [3] },
            ],
            subchapters: [{ title: 'Part 1', summary: 'old', startWordIndex: 0, endWordIndex: 3 }],
            incrementalPatch: chapterPatch,
        };
        const readingState = {
            currentChapterId: 'chapter-1',
            currentWordIndex: 2,
            highlights: [{ id: 'highlight-1', chapterId: 'chapter-1', startWordIndex: 1, endWordIndex: 3 }],
            ttsPosition: { chapterId: 'chapter-1', sentenceIndex: 0, wordIndex: 2, audioTime: 1, timestamp: 1 },
            incrementalPatch: readingStatePatch,
        };

        mockDb.content_revisions.findOne
            .mockReset()
            .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(preparedDocument) })
            .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(activeRevision) });
        mockDb.chapters.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(chapter) });
        mockDb.reading_states.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(readingState) });
        mockDb.repair_annotations.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({ incrementalPatch: annotationPatch }) });

        await expect(activateRepairRevision({ candidate, nextText, revision, annotation })).resolves.toMatchObject({
            nextText,
            revision: { state: 'active' },
        });
        expect(chapterPatch).toHaveBeenCalledWith(expect.objectContaining({
            content: ['The', 'the', 'fox.'],
            densities: [1, 0, 3],
        }));
        expect(readingStatePatch).toHaveBeenCalledWith(expect.objectContaining({
            currentWordIndex: 2,
            highlights: [expect.objectContaining({ startWordIndex: 1, endWordIndex: 3 })],
            ttsPosition: expect.objectContaining({ wordIndex: 2 }),
        }));
        expect(activeRevisionPatch).toHaveBeenCalledWith({ state: 'superseded' });
        expect(preparedRevisionPatch).toHaveBeenCalledWith({ state: 'active' });
        expect(annotationPatch).toHaveBeenCalledWith(expect.objectContaining({ proposalState: 'accepted' }));
    });
});
