import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyDatabase } from '../sync/db';
import { persistListeningHandoff } from './handoff';

const mockInitDB = vi.hoisted(() => vi.fn());

vi.mock('../sync/db', () => ({
    initDB: mockInitDB,
}));

describe('persistListeningHandoff', () => {
    const incrementalPatch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        incrementalPatch.mockResolvedValue(undefined);
        mockInitDB.mockResolvedValue({
            reading_states: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue({ incrementalPatch }),
                }),
            },
        } as unknown as MyDatabase);
    });

    it('updates the canonical Reader position with the audio cursor', async () => {
        const position = {
            bookId: 'book-1',
            chapterId: 'chapter-2',
            sentenceIndex: 4,
            wordIndex: 17,
            audioTime: 8.5,
            timestamp: 1234,
        };

        await persistListeningHandoff({
            position,
            voice: 'af_heart',
            speed: 1,
        });

        expect(incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({
            currentChapterId: 'chapter-2',
            currentWordIndex: 17,
            lastRead: 1234,
            ttsPosition: expect.objectContaining({
                sentenceIndex: 4,
                wordIndex: 17,
            }),
        }));
    });
});