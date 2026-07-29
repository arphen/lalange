import { generateUUID } from '../../utils/uuid';
import { initDB, type BookDocType, type ChapterDocType } from '../sync/db';
import { getExchangeDeviceIdentity } from './device';
import { fingerprintValue, stableSerialize } from './fingerprint';
import {
    EXCHANGE_PROTOCOL_VERSION,
    type ExchangeBookContent,
    type ExchangeBookPayload,
    type ExchangeBundle,
    type ExchangeContinuation,
    type ExchangeDataSelection,
    type ExchangeIntent,
    type ExchangeScope,
} from './types';

const DEFAULT_EXPIRATION_MS = 10 * 60 * 1000;

export interface CreateExchangeBundleOptions {
    intent: ExchangeIntent;
    bookIds: string[];
    selection?: Partial<ExchangeDataSelection>;
    continuation?: ExchangeContinuation;
    scope?: ExchangeScope;
    now?: number;
}

export function getDefaultExchangeSelection(intent: ExchangeIntent): ExchangeDataSelection {
    if (intent === 'give') {
        return {
            content: true,
            analysis: true,
            progress: false,
            highlights: false,
            listening: false,
        };
    }

    if (intent === 'handoff') {
        return {
            content: true,
            analysis: true,
            progress: true,
            highlights: false,
            listening: true,
        };
    }

    return {
        content: true,
        analysis: true,
        progress: true,
        highlights: true,
        listening: true,
    };
}

function withoutAnalysis(book: BookDocType): BookDocType {
    const content = { ...book };
    delete content.globalSummaries;
    return content;
}

function chapterWithoutAnalysis(chapter: ChapterDocType): ChapterDocType {
    const content = { ...chapter };
    delete content.densities;
    delete content.analysisData;
    delete content.subchapters;
    return content;
}

export async function snapshotExchangeBook(
    bookId: string,
    selection: ExchangeDataSelection,
): Promise<ExchangeBookPayload> {
    const db = await initDB();
    const bookDoc = await db.books.findOne(bookId).exec();
    if (!bookDoc) throw new Error(`Book not found: ${bookId}`);

    const book = bookDoc.toJSON() as BookDocType;
    const chapterDocs = await db.chapters.find({
        selector: { bookId },
        sort: [{ index: 'asc' }],
    }).exec();
    const chapters = chapterDocs.map((chapter) => chapter.toJSON() as ChapterDocType);
    const imageDocs = await db.images.find({ selector: { bookId } }).exec();
    const rawFileDoc = await db.raw_files.findOne(bookId).exec();
    const readingStateDoc = await db.reading_states.findOne(bookId).exec();
    const readingState = readingStateDoc?.toJSON();

    const contentSnapshot: ExchangeBookContent = {
        book: selection.analysis ? book : withoutAnalysis(book),
        chapters: selection.analysis ? chapters : chapters.map(chapterWithoutAnalysis),
        images: imageDocs.map((image) => image.toJSON()),
        rawFile: rawFileDoc?.toJSON(),
    };

    const progress = readingState && (selection.progress || selection.listening)
        ? {
            ...(selection.progress ? {
                currentChapterId: readingState.currentChapterId,
                currentWordIndex: readingState.currentWordIndex,
                lastRead: readingState.lastRead,
            } : {
                currentWordIndex: 0,
                lastRead: 0,
            }),
            ...(selection.listening ? {
                ttsPosition: readingState.ttsPosition,
                ttsSettings: readingState.ttsSettings,
            } : {}),
        }
        : undefined;
    const highlights = readingState && selection.highlights
        ? readingState.highlights.map((highlight) => ({ ...highlight }))
        : undefined;

    const fingerprints = {
        content: selection.content ? await fingerprintValue(contentSnapshot) : undefined,
        progress: progress ? await fingerprintValue(progress) : undefined,
        highlights: highlights ? await fingerprintValue(highlights) : undefined,
    };

    const payload: ExchangeBookPayload = {
        bookId,
        title: book.title,
        author: book.author,
        content: selection.content ? contentSnapshot : undefined,
        reading: progress || highlights ? { progress, highlights } : undefined,
        fingerprints,
        estimatedBytes: 0,
    };
    payload.estimatedBytes = new TextEncoder().encode(stableSerialize(payload)).byteLength;
    return payload;
}

export async function createExchangeBundle(
    options: CreateExchangeBundleOptions,
): Promise<ExchangeBundle> {
    const now = options.now ?? Date.now();
    const selection = {
        ...getDefaultExchangeSelection(options.intent),
        ...options.selection,
    };
    const bookIds = [...new Set(options.bookIds)];

    if (bookIds.length === 0 && options.intent !== 'reconcile') {
        throw new Error('Select at least one book to exchange.');
    }
    if (options.intent === 'handoff' && bookIds.length !== 1) {
        throw new Error('A handoff must contain exactly one book.');
    }
    if (options.continuation && !bookIds.includes(options.continuation.bookId)) {
        throw new Error('The handoff position must belong to the selected book.');
    }

    const books = await Promise.all(bookIds.map((bookId) => snapshotExchangeBook(bookId, selection)));
    if (options.continuation) {
        const handoffBook = books.find((book) => book.bookId === options.continuation!.bookId);
        if (handoffBook && (selection.progress || selection.listening)) {
            const previousProgress = handoffBook.reading?.progress;
            const progress = {
                currentChapterId: selection.progress
                    ? options.continuation.chapterId
                    : previousProgress?.currentChapterId,
                currentWordIndex: selection.progress
                    ? options.continuation.wordIndex
                    : previousProgress?.currentWordIndex ?? 0,
                lastRead: selection.progress ? now : previousProgress?.lastRead ?? 0,
                ttsPosition: selection.listening && options.continuation.mode === 'listening'
                    ? {
                        chapterId: options.continuation.chapterId,
                        sentenceIndex: options.continuation.sentenceIndex ?? 0,
                        wordIndex: options.continuation.wordIndex,
                        audioTime: options.continuation.audioTime ?? 0,
                        timestamp: now,
                    }
                    : previousProgress?.ttsPosition,
                ttsSettings: selection.listening ? previousProgress?.ttsSettings : undefined,
            };
            handoffBook.reading = { ...handoffBook.reading, progress };
            handoffBook.fingerprints.progress = await fingerprintValue(progress);
            handoffBook.estimatedBytes = new TextEncoder().encode(stableSerialize(handoffBook)).byteLength;
        }
    }
    const exchangeId = generateUUID();

    return {
        manifest: {
            protocolVersion: EXCHANGE_PROTOCOL_VERSION,
            exchangeId,
            intent: options.intent,
            scope: options.scope ?? 'selection',
            sourceDevice: getExchangeDeviceIdentity(),
            createdAt: now,
            expiresAt: now + DEFAULT_EXPIRATION_MS,
            selection,
            books: books.map((book) => ({
                bookId: book.bookId,
                title: book.title,
                author: book.author,
                estimatedBytes: book.estimatedBytes,
                fingerprints: book.fingerprints,
            })),
            continuation: options.continuation,
        },
        books,
    };
}
