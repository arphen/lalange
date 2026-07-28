import { describe, expect, it } from 'vitest';
import type { ChapterDocType } from '../../core/sync/db';
import { findNextReadableChapter, getGlobalWordIndex } from './readerNavigation';

const chapter = (
    id: string,
    content: string[],
    overrides: Partial<ChapterDocType> = {},
): ChapterDocType => ({
    id,
    bookId: 'book-1',
    index: Number(id.split('-').at(-1)) || 0,
    title: id,
    status: 'ready',
    content,
    ...overrides,
} as ChapterDocType);

describe('reader navigation', () => {
    it('skips image and empty placeholders when advancing chapters', () => {
        const chapters = [
            chapter('chapter-1', ['one']),
            chapter('chapter-2', [], { metadata: { classificationType: 'image' } }),
            chapter('chapter-3', ['license'], { metadata: { classificationType: 'license' } }),
            chapter('chapter-4', [], { status: 'pending' }),
            chapter('chapter-5', ['next']),
        ];

        expect(findNextReadableChapter(chapters, 'chapter-1')?.id).toBe('chapter-5');
    });

    it('calculates a book-global cursor from preceding chapter lengths', () => {
        const chapters = [
            chapter('chapter-1', ['one', 'two']),
            chapter('chapter-2', ['three', 'four', 'five']),
        ];

        expect(getGlobalWordIndex(chapters, 'chapter-2', 2)).toBe(4);
    });
});