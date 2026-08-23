import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import { useSettingsStore } from '../store/settings';
import { initDB } from '../sync/db';
import { activateChapterRepairBatch, buildChapterRepairPlan, prepareChapterRepairBatch } from './repairBatch';
import { RepairQueueService } from './repairQueue';

vi.mock('../store/settings', () => ({
    useSettingsStore: { getState: vi.fn() },
}));

vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

vi.mock('./repairBatch', () => ({
    activateChapterRepairBatch: vi.fn(),
    buildChapterRepairPlan: vi.fn(),
    prepareChapterRepairBatch: vi.fn(),
}));

const asDocument = (value: Record<string, unknown>) => ({
    ...value,
    toJSON: () => ({ ...value }),
    incrementalPatch: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(value, patch); }),
});

describe('repair queue bulk application', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSettingsStore.getState).mockReturnValue({ textRepairMode: 'review', repairModelId: 'qwen' } as unknown as ReturnType<typeof useSettingsStore.getState>);
    });

    it('groups ready proposals by chapter and reports a blocked chapter without losing other results', async () => {
        const chapterOneText = 'one th3';
        const chapterTwoText = 'two h0p';
        const revisionOneHash = await fingerprintValue(chapterOneText);
        const revisionTwoHash = await fingerprintValue(chapterTwoText);
        const issues = [
            asDocument({
                id: 'one-issue', bookId: 'book-1', sourceUnitId: 'chapter-1', revisionHash: revisionOneHash,
                startOffset: 4, endOffset: 7, originalHash: await fingerprintValue('th3'), detectorIds: ['numeric-alphanumeric-intrusion'],
                evidence: { value: 'th3' }, severity: 'medium', ambiguity: 'high', state: 'open', proposal: {
                    candidateId: 'one-issue', action: 'replace', replacement: 'the', reasonCode: 'ocr-substitution',
                },
            }),
            asDocument({
                id: 'two-issue', bookId: 'book-1', sourceUnitId: 'chapter-2', revisionHash: revisionTwoHash,
                startOffset: 4, endOffset: 7, originalHash: await fingerprintValue('h0p'), detectorIds: ['numeric-alphanumeric-intrusion'],
                evidence: { value: 'h0p' }, severity: 'medium', ambiguity: 'high', state: 'open', proposal: {
                    candidateId: 'two-issue', action: 'replace', replacement: 'hope', reasonCode: 'ocr-substitution',
                },
            }),
        ];
        const chapters = new Map([
            ['chapter-1', asDocument({ id: 'chapter-1', content: chapterOneText.split(' ') })],
            ['chapter-2', asDocument({ id: 'chapter-2', content: chapterTwoText.split(' ') })],
        ]);
        const revisions = new Map([
            ['chapter-1', asDocument({ id: 'revision-1', textHash: revisionOneHash, state: 'active' })],
            ['chapter-2', asDocument({ id: 'revision-2', textHash: revisionTwoHash, state: 'active' })],
        ]);
        const database = {
            text_issues: {
                find: vi.fn(() => ({ exec: async () => issues })),
            },
            chapters: {
                findOne: vi.fn((id: string) => ({ exec: async () => chapters.get(id) })),
            },
            content_revisions: {
                find: vi.fn((options: { selector: { sourceUnitId: string } }) => ({
                    exec: async () => [revisions.get(options.selector.sourceUnitId)],
                })),
            },
        };
        vi.mocked(initDB).mockResolvedValue(database as never);
        vi.mocked(buildChapterRepairPlan)
            .mockResolvedValueOnce({ valid: true, sourceUnitId: 'chapter-1' } as never)
            .mockRejectedValueOnce(new Error('chapter text changed before apply'));
        vi.mocked(prepareChapterRepairBatch).mockResolvedValue({} as never);
        vi.mocked(activateChapterRepairBatch).mockResolvedValue({} as never);

        const result = await new RepairQueueService().applyReady('book-1');

        expect(result).toMatchObject({ selected: 2, applied: 1, blocked: 1 });
        expect(result.errors).toEqual([{ sourceUnitId: 'chapter-2', message: 'chapter text changed before apply' }]);
        expect(buildChapterRepairPlan).toHaveBeenCalledTimes(2);
        expect(prepareChapterRepairBatch).toHaveBeenCalledTimes(1);
        expect(activateChapterRepairBatch).toHaveBeenCalledTimes(1);
    });
});