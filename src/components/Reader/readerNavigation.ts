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

export interface ChapterWordIndex {
    totalWords: number;
    offsets: ReadonlyMap<string, number>;
}

export const buildChapterWordIndex = (chapters: readonly ChapterDocType[]): ChapterWordIndex => {
    const offsets = new Map<string, number>();
    let totalWords = 0;

    for (const chapter of chapters) {
        offsets.set(chapter.id, totalWords);
        totalWords += chapter.content.length;
    }

    return { totalWords, offsets };
};

export const getGlobalWordIndexFromIndex = (
    chapterWordIndex: ChapterWordIndex,
    currentChapterId: string,
    currentWordIndex: number,
): number => {
    const chapterOffset = chapterWordIndex.offsets.get(currentChapterId);
    return chapterOffset === undefined
        ? Math.max(0, currentWordIndex)
        : chapterOffset + Math.max(0, currentWordIndex);
};

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
    return getGlobalWordIndexFromIndex(
        buildChapterWordIndex(chapters),
        currentChapterId,
        currentWordIndex,
    );
};