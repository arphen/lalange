import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import type { TextIssueCandidate } from './anomalyScanner';

const mocks = vi.hoisted(() => ({
    initDB: vi.fn(),
    scanTextForAnomalies: vi.fn(),
}));

vi.mock('../sync/db', () => ({ initDB: mocks.initDB }));
vi.mock('./anomalyScanner', () => ({ scanTextForAnomalies: mocks.scanTextForAnomalies }));

const candidate: TextIssueCandidate = {
    id: 'chapter-1:4:5:hash',
    bookId: 'book-1',
    sourceUnitId: 'chapter-1',
    revisionHash: 'revision-1',
    startOffset: 4,
    endOffset: 5,
    originalHash: 'original-hash',
    detectorIds: ['encoding-replacement-character'],
    evidence: { kind: 'replacement-character' },
    severity: 'high',
    ambiguity: 'low',
};

type MockDb = {
    books: { findOne: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> };
    chapters: { find: ReturnType<typeof vi.fn> };
    content_revisions: { find: ReturnType<typeof vi.fn>; bulkUpsert: ReturnType<typeof vi.fn> };
    text_issues: { find: ReturnType<typeof vi.fn>; bulkUpsert: ReturnType<typeof vi.fn> };
};

describe('repair anomaly scan commands', () => {
    let db: MockDb;
    let canonicalRevisionHash = '';

    beforeEach(async () => {
        vi.clearAllMocks();
        canonicalRevisionHash = await fingerprintValue('safe � text');
        const scannedCandidate = { ...candidate, revisionHash: canonicalRevisionHash };
        db = {
            books: {
                findOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ id: 'book-1' }) }),
                find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([{ id: 'book-1' }]) }),
            },
            chapters: {
                find: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue([{
                        id: 'chapter-1',
                        bookId: 'book-1',
                        index: 0,
                        content: ['safe', '\uFFFD', 'text'],
                    }]),
                }),
            },
            content_revisions: {
                find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([{
                    textHash: 'revision-1',
                    sourceHash: 'source-hash',
                    incrementalPatch: vi.fn(),
                }]) }),
                bulkUpsert: vi.fn().mockResolvedValue(undefined),
            },
            text_issues: {
                find: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue([{
                        id: candidate.id,
                        state: 'accepted',
                        proposal: { candidateId: candidate.id, action: 'replace', reasonCode: 'encoding-artifact' },
                        createdAt: 10,
                    }]),
                }),
                bulkUpsert: vi.fn().mockResolvedValue(undefined),
            },
        };
        mocks.initDB.mockResolvedValue(db);
        mocks.scanTextForAnomalies.mockResolvedValue({
            candidates: [scannedCandidate],
            circuitBroken: false,
        });
    });

    it('scans a book against its active revision and preserves issue decisions', async () => {
        const { scanBookForAnomalies } = await import('./repair');

        await expect(scanBookForAnomalies('book-1')).resolves.toEqual({
            booksScanned: 1,
            chaptersScanned: 1,
            candidatesFound: 1,
            circuitBroken: false,
        });
        expect(mocks.scanTextForAnomalies).toHaveBeenCalledWith(expect.objectContaining({
            sourceUnitId: 'chapter-1',
            revisionHash: canonicalRevisionHash,
            text: 'safe � text',
        }));
        expect(db.text_issues.bulkUpsert).toHaveBeenCalledWith([
            expect.objectContaining({
                id: candidate.id,
                state: 'accepted',
                proposal: expect.any(Object),
                createdAt: 10,
            }),
        ]);
    });

    it('aggregates a deterministic library scan report', async () => {
        const { scanLibraryForAnomalies } = await import('./repair');

        await expect(scanLibraryForAnomalies()).resolves.toEqual({
            booksScanned: 1,
            chaptersScanned: 1,
            candidatesFound: 1,
            circuitBroken: false,
        });
        expect(db.books.find).toHaveBeenCalledOnce();
    });
});
