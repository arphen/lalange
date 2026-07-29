import type { ChapterDocType } from '../../core/sync/db';

const NON_READING_CLASSIFICATIONS = new Set(['license', 'toc', 'cover', 'image']);

export const isReadingChapter = (chapter: ChapterDocType): boolean => (
    !NON_READING_CLASSIFICATIONS.has(chapter.metadata?.classificationType ?? '')
);

export const isReadableChapter = (chapter: ChapterDocType): boolean => (
    isReadingChapter(chapter) &&
    chapter.content.length > 0 &&
    (chapter.status === 'ready' || chapter.status === 'processing')
);

export const findNextReadableChapter = (
    chapters: ChapterDocType[],
    currentChapterId: string,
): ChapterDocType | null => {
    const currentIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    if (currentIndex < 0) return null;

    return chapters.slice(currentIndex + 1).find(isReadableChapter) ?? null;
};

export const findPreviousReadableChapter = (
    chapters: ChapterDocType[],
    currentChapterId: string,
): ChapterDocType | null => {
    const currentIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    if (currentIndex <= 0) return null;

    return chapters.slice(0, currentIndex).reverse().find(isReadableChapter) ?? null;
};

export const getGlobalWordIndex = (
    chapters: ChapterDocType[],
    currentChapterId: string,
    currentWordIndex: number,
): number => {
    let globalWordIndex = 0;

    for (const chapter of chapters) {
        if (chapter.id === currentChapterId) {
            return globalWordIndex + Math.max(0, currentWordIndex);
        }
        globalWordIndex += chapter.content.length;
    }

    return Math.max(0, currentWordIndex);
};