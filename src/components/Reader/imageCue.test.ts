import { describe, expect, it } from 'vitest';
import type { ChapterDocType, ImageDocType } from '../../core/sync/db';
import { buildImageCueAssignments, findImageBreakAfterChapter } from './imageCue';

const chapter = (
    id: string,
    index: number,
    content: string[],
    metadata?: ChapterDocType['metadata'],
    title?: string,
): ChapterDocType => ({
    id,
    bookId: 'book-1',
    index,
    title: title || id,
    status: 'ready',
    content,
    metadata,
});

const image = (id: string, filename: string): ImageDocType => ({
    id,
    bookId: 'book-1',
    filename,
    data: 'AAA=',
    mimeType: 'image/jpeg',
});

describe('image cue helpers', () => {
    it('detects an image break between readable chapters', () => {
        const chapters = [
            chapter('c1', 0, ['One']),
            chapter('img-1', 1, [], { classificationType: 'image' }, 'plate_1.jpg'),
            chapter('c2', 2, ['Two']),
        ];
        const assignments = buildImageCueAssignments(chapters, [image('i1', 'plate_1.jpg')]);

        const cue = findImageBreakAfterChapter(chapters, 'c1', assignments);
        expect(cue).not.toBeNull();
        expect(cue?.imageCount).toBe(1);
        expect(cue?.nextReadableChapterId).toBe('c2');
        expect(cue?.primaryImage?.filename).toBe('plate_1.jpg');
        expect(cue?.primaryImage?.src?.startsWith('data:image/jpeg;base64,')).toBe(true);
    });

    it('returns null when no image chapter is ahead', () => {
        const chapters = [
            chapter('c1', 0, ['One']),
            chapter('c2', 1, ['Two']),
        ];
        const assignments = buildImageCueAssignments(chapters, []);

        const cue = findImageBreakAfterChapter(chapters, 'c1', assignments);
        expect(cue).toBeNull();
    });

    it('falls back to sequential assignment when title has no filename', () => {
        const chapters = [
            chapter('c1', 0, ['One']),
            chapter('img-1', 1, [], { classificationType: 'image' }, 'Illustration'),
            chapter('img-2', 2, [], { classificationType: 'image' }, 'Plate'),
            chapter('c2', 3, ['Two']),
        ];
        const assignments = buildImageCueAssignments(chapters, [
            image('i1', 'first.jpg'),
            image('i2', 'second.jpg'),
        ]);

        expect(assignments.get('img-1')?.filename).toBe('first.jpg');
        expect(assignments.get('img-2')?.filename).toBe('second.jpg');
    });
});