import { generateUUID } from '../../utils/uuid';
import {
    initDB,
    type BookDocType,
    type ChapterDocType,
    type HighlightType,
    type ImageDocType,
    type RawFileDocType,
    type ReadingStateDocType,
} from '../sync/db';
import { recordExchangeLedger } from './device';
import { getLocalExchangeHashes } from './planner';
import type {
    ExchangeBookPayload,
    ExchangeBookResolution,
    ExchangeBundle,
    ExchangeEntityHashes,
    ExchangeLedgerEntry,
} from './types';
import { validateExchangeBundle } from './validate';

export interface ApplyExchangeOptions {
    resolutions: Record<string, ExchangeBookResolution>;
}

export interface ApplyExchangeResult {
    importedBookIds: string[];
    updatedBookIds: string[];
}

interface RemappedPayload {
    payload: ExchangeBookPayload;
    bookId: string;
}

function uniqueBookId(originalId: string): string {
    return `${originalId.slice(0, 54)}-${generateUUID()}`;
}

function uniqueChildId(bookId: string, kind: string, index: number): string {
    return `${bookId.slice(0, 76)}-${kind}-${index}`;
}

function remapHighlights(
    highlights: HighlightType[] | undefined,
    chapterIds: Map<string, string>,
): HighlightType[] | undefined {
    return highlights?.map((highlight) => ({
        ...highlight,
        id: generateUUID(),
        chapterId: chapterIds.get(highlight.chapterId) ?? highlight.chapterId,
    }));
}

function remapIncomingBook(payload: ExchangeBookPayload): RemappedPayload {
    if (!payload.content) {
        throw new Error(`Cannot keep ${payload.title} as a separate copy without book content.`);
    }

    const bookId = uniqueBookId(payload.bookId);
    const chapterIds = new Map(payload.content.chapters.map((chapter, index) => (
        [chapter.id, uniqueChildId(bookId, 'chapter', index)]
    )));
    const imageIds = new Map(payload.content.images.map((image, index) => (
        [image.id, uniqueChildId(bookId, 'image', index)]
    )));
    const copyTitle = `${payload.title} (copy)`;
    const book: BookDocType = {
        ...payload.content.book,
        id: bookId,
        title: copyTitle,
        chapterIds: payload.content.book.chapterIds.map((id) => chapterIds.get(id) ?? id),
        globalSummaries: payload.content.book.globalSummaries?.map((summary) => ({
            ...summary,
            id: generateUUID(),
            startChapterId: chapterIds.get(summary.startChapterId) ?? summary.startChapterId,
            endChapterId: chapterIds.get(summary.endChapterId) ?? summary.endChapterId,
        })),
    };
    const chapters: ChapterDocType[] = payload.content.chapters.map((chapter) => ({
        ...chapter,
        id: chapterIds.get(chapter.id)!,
        bookId,
    }));
    const images: ImageDocType[] = payload.content.images.map((image) => ({
        ...image,
        id: imageIds.get(image.id)!,
        bookId,
    }));
    const rawFile: RawFileDocType | undefined = payload.content.rawFile
        ? { ...payload.content.rawFile, id: bookId }
        : undefined;
    const progress = payload.reading?.progress;

    return {
        bookId,
        payload: {
            ...payload,
            bookId,
            title: copyTitle,
            content: { book, chapters, images, rawFile },
            reading: payload.reading ? {
                progress: progress ? {
                    ...progress,
                    currentChapterId: progress.currentChapterId
                        ? chapterIds.get(progress.currentChapterId) ?? progress.currentChapterId
                        : undefined,
                    ttsPosition: progress.ttsPosition ? {
                        ...progress.ttsPosition,
                        chapterId: chapterIds.get(progress.ttsPosition.chapterId)
                            ?? progress.ttsPosition.chapterId,
                    } : undefined,
                } : undefined,
                highlights: remapHighlights(payload.reading.highlights, chapterIds),
            } : undefined,
        },
    };
}

async function writeContent(payload: ExchangeBookPayload): Promise<void> {
    if (!payload.content) return;
    const db = await initDB();
    const existingChapters = await db.chapters.find({ selector: { bookId: payload.bookId } }).exec();
    const existingImages = await db.images.find({ selector: { bookId: payload.bookId } }).exec();
    const existingRawFile = await db.raw_files.findOne(payload.bookId).exec();

    for (const chapter of payload.content.chapters) await db.chapters.upsert(chapter);
    for (const image of payload.content.images) await db.images.upsert(image);
    if (payload.content.rawFile) await db.raw_files.upsert(payload.content.rawFile);
    await db.books.upsert(payload.content.book);

    const incomingChapterIds = new Set(payload.content.chapters.map((chapter) => chapter.id));
    const incomingImageIds = new Set(payload.content.images.map((image) => image.id));
    await Promise.all(existingChapters
        .filter((chapter) => !incomingChapterIds.has(chapter.id))
        .map((chapter) => chapter.remove()));
    await Promise.all(existingImages
        .filter((image) => !incomingImageIds.has(image.id))
        .map((image) => image.remove()));
    if (!payload.content.rawFile && existingRawFile) await existingRawFile.remove();
}

async function ensureReadingState(payload: ExchangeBookPayload, resetProgress: boolean): Promise<void> {
    if (!payload.content) return;
    const db = await initDB();
    const stateDoc = await db.reading_states.findOne(payload.bookId).exec();
    const firstChapterId = payload.content.book.chapterIds[0] ?? payload.content.chapters[0]?.id;

    if (stateDoc) {
        if (resetProgress) {
            await stateDoc.incrementalPatch({
                currentChapterId: firstChapterId,
                currentWordIndex: 0,
                lastRead: Date.now(),
                ttsPosition: undefined,
            });
        }
        return;
    }

    await db.reading_states.insert({
        bookId: payload.bookId,
        currentChapterId: firstChapterId,
        currentWordIndex: 0,
        lastRead: Date.now(),
        highlights: [],
    });
}

function mergeHighlights(
    local: HighlightType[],
    incoming: HighlightType[],
    preferIncoming: boolean,
): HighlightType[] {
    const merged = new Map(local.map((highlight) => [highlight.id, highlight]));
    for (const highlight of incoming) {
        if (!merged.has(highlight.id) || preferIncoming) merged.set(highlight.id, highlight);
    }
    return [...merged.values()].sort((left, right) => left.createdAt - right.createdAt);
}

async function writeReadingState(
    payload: ExchangeBookPayload,
    resolution: ExchangeBookResolution,
): Promise<void> {
    if (!payload.reading) return;
    const db = await initDB();
    const stateDoc = await db.reading_states.findOne(payload.bookId).exec();
    const current = stateDoc?.toJSON() as ReadingStateDocType | undefined;
    const patch: Partial<ReadingStateDocType> = {};

    if (resolution.progress === 'take-incoming' && payload.reading.progress) {
        Object.assign(patch, payload.reading.progress);
    }

    if (payload.reading.highlights) {
        if (resolution.highlights === 'take-incoming') {
            patch.highlights = payload.reading.highlights;
        } else if (resolution.highlights === 'merge-prefer-local'
            || resolution.highlights === 'merge-prefer-incoming') {
            patch.highlights = mergeHighlights(
                current?.highlights ?? [],
                payload.reading.highlights,
                resolution.highlights === 'merge-prefer-incoming',
            );
        }
    }

    if (Object.keys(patch).length === 0) return;
    if (stateDoc) {
        await stateDoc.incrementalPatch(patch);
        return;
    }

    await db.reading_states.insert({
        bookId: payload.bookId,
        currentChapterId: patch.currentChapterId,
        currentWordIndex: patch.currentWordIndex ?? 0,
        lastRead: patch.lastRead ?? Date.now(),
        highlights: patch.highlights ?? [],
        ttsPosition: patch.ttsPosition,
        ttsSettings: patch.ttsSettings,
    });
}

function ledgerHashes(
    payload: ExchangeBookPayload,
    local: ExchangeEntityHashes,
): ExchangeEntityHashes {
    return {
        content: local.content === payload.fingerprints.content ? local.content : undefined,
        progress: local.progress === payload.fingerprints.progress ? local.progress : undefined,
        highlights: local.highlights === payload.fingerprints.highlights ? local.highlights : undefined,
    };
}

export async function applyExchangeBundle(
    bundle: ExchangeBundle,
    options: ApplyExchangeOptions,
): Promise<ApplyExchangeResult> {
    await validateExchangeBundle(bundle, bundle.manifest.createdAt);
    const result: ApplyExchangeResult = { importedBookIds: [], updatedBookIds: [] };
    const ledgerEntries: ExchangeLedgerEntry[] = [];

    for (const originalPayload of bundle.books) {
        const resolution = options.resolutions[originalPayload.bookId];
        if (!resolution) throw new Error(`Missing review decision for ${originalPayload.title}.`);

        let payload = originalPayload;
        const keepBoth = resolution.content === 'keep-both';
        if (keepBoth) payload = remapIncomingBook(originalPayload).payload;

        if (resolution.content === 'take-incoming' || keepBoth) {
            await writeContent(payload);
            await ensureReadingState(payload, resolution.content === 'take-incoming' && !payload.reading?.progress);
            result.importedBookIds.push(payload.bookId);
        }
        await writeReadingState(payload, keepBoth ? {
            content: 'take-incoming',
            progress: payload.reading?.progress ? 'take-incoming' : 'keep-local',
            highlights: payload.reading?.highlights ? 'take-incoming' : 'keep-local',
        } : resolution);

        if (!keepBoth) result.updatedBookIds.push(payload.bookId);
        const localHashes = keepBoth
            ? {}
            : await getLocalExchangeHashes(originalPayload.bookId, bundle.manifest.selection);
        ledgerEntries.push({
            peerDeviceId: bundle.manifest.sourceDevice.id,
            bookId: originalPayload.bookId,
            exchangeId: bundle.manifest.exchangeId,
            completedAt: Date.now(),
            hashes: ledgerHashes(originalPayload, localHashes),
        });
    }

    recordExchangeLedger(ledgerEntries);
    return result;
}
