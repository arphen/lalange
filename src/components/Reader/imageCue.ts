import type { ChapterDocType, ImageDocType } from '../../core/sync/db';
import { isReadableChapter } from './readerNavigation';

export interface ImageCueAsset {
    chapterId: string;
    chapterTitle: string;
    filename?: string;
    src?: string;
}

export interface ImageBreakCue {
    imageChapterIds: string[];
    imageCount: number;
    primaryImage?: ImageCueAsset;
    nextReadableChapterId: string | null;
}

const imageTitleFilePattern = /([a-z0-9._-]+\.(?:png|jpe?g|gif|webp))/i;

const normalizeFileName = (value: string): string => value.trim().toLowerCase();

const toDataUrl = (image: ImageDocType): string => (
    `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`
);

const extractFilenameFromTitle = (title: string): string | null => {
    const match = title.match(imageTitleFilePattern);
    if (!match || !match[1]) return null;
    return normalizeFileName(match[1]);
};

export const buildImageCueAssignments = (
    chapters: ChapterDocType[],
    images: ImageDocType[],
): Map<string, ImageCueAsset> => {
    const imageChapters = chapters
        .filter((chapter) => chapter.metadata?.classificationType === 'image')
        .sort((a, b) => a.index - b.index);

    const byFilename = new Map<string, ImageDocType>();
    for (const image of images) {
        byFilename.set(normalizeFileName(image.filename), image);
    }

    const unassigned = [...images];
    const consumeImage = (image: ImageDocType | undefined): ImageDocType | undefined => {
        if (!image) return undefined;
        const index = unassigned.findIndex((candidate) => candidate.id === image.id);
        if (index >= 0) unassigned.splice(index, 1);
        return image;
    };

    const assignments = new Map<string, ImageCueAsset>();
    for (const chapter of imageChapters) {
        const candidateFilename = extractFilenameFromTitle(chapter.title || '');
        const matched = consumeImage(candidateFilename ? byFilename.get(candidateFilename) : undefined) || unassigned.shift();

        assignments.set(chapter.id, {
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            filename: matched?.filename,
            src: matched ? toDataUrl(matched) : undefined,
        });
    }

    return assignments;
};

export const findImageBreakAfterChapter = (
    chapters: ChapterDocType[],
    currentChapterId: string,
    assignments: Map<string, ImageCueAsset>,
): ImageBreakCue | null => {
    const currentIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    if (currentIndex < 0) return null;

    const imageChapterIds: string[] = [];

    for (let index = currentIndex + 1; index < chapters.length; index += 1) {
        const chapter = chapters[index];

        if (chapter.metadata?.classificationType === 'image') {
            imageChapterIds.push(chapter.id);
            continue;
        }

        if (imageChapterIds.length > 0 && isReadableChapter(chapter)) {
            return {
                imageChapterIds,
                imageCount: imageChapterIds.length,
                primaryImage: assignments.get(imageChapterIds[0]),
                nextReadableChapterId: chapter.id,
            };
        }

        if (isReadableChapter(chapter)) {
            return null;
        }
    }

    if (imageChapterIds.length === 0) return null;

    return {
        imageChapterIds,
        imageCount: imageChapterIds.length,
        primaryImage: assignments.get(imageChapterIds[0]),
        nextReadableChapterId: null,
    };
};