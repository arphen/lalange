import { initDB, type BookDocType, type ChapterDocType } from '../sync/db';
import { compareExchangeFingerprint, suggestExchangeResolution } from './conflicts';
import { findExchangeLedgerEntry } from './device';
import { fingerprintValue } from './fingerprint';
import type {
    ExchangeBookConflict,
    ExchangeBundle,
    ExchangeDataSelection,
    ExchangeEntityHashes,
    ExchangeImportPlan,
} from './types';
import { validateExchangeBundle } from './validate';

export async function getLocalExchangeHashes(
    bookId: string,
    selection: ExchangeDataSelection,
): Promise<ExchangeEntityHashes> {
    const db = await initDB();
    const bookDoc = await db.books.findOne(bookId).exec();
    if (!bookDoc) return {};

    const hashes: ExchangeEntityHashes = {};
    if (selection.content) {
        const chapters = await db.chapters.find({
            selector: { bookId },
            sort: [{ index: 'asc' }],
        }).exec();
        const images = await db.images.find({ selector: { bookId } }).exec();
        const rawFile = await db.raw_files.findOne(bookId).exec();
        const book = bookDoc.toJSON() as BookDocType;
        const chapterData = chapters.map((chapter) => chapter.toJSON() as ChapterDocType);
        const content = selection.analysis
            ? { book, chapters: chapterData, images: images.map((image) => image.toJSON()), rawFile: rawFile?.toJSON() }
            : {
                book: Object.fromEntries(Object.entries(book).filter(([key]) => key !== 'globalSummaries')),
                chapters: chapterData.map((chapter) => {
                    const content = { ...chapter };
                    delete content.densities;
                    delete content.analysisData;
                    delete content.subchapters;
                    return content;
                }),
                images: images.map((image) => image.toJSON()),
                rawFile: rawFile?.toJSON(),
            };
        hashes.content = await fingerprintValue(content);
    }

    const readingState = await db.reading_states.findOne(bookId).exec();
    if (!readingState) return hashes;
    const state = readingState.toJSON();

    if (selection.progress || selection.listening) {
        hashes.progress = await fingerprintValue({
            ...(selection.progress ? {
                currentChapterId: state.currentChapterId,
                currentWordIndex: state.currentWordIndex,
                lastRead: state.lastRead,
            } : {
                currentWordIndex: 0,
                lastRead: 0,
            }),
            ...(selection.listening ? {
                ttsPosition: state.ttsPosition,
                ttsSettings: state.ttsSettings,
            } : {}),
        });
    }
    if (selection.highlights) hashes.highlights = await fingerprintValue(state.highlights);
    return hashes;
}

export async function planExchangeImport(bundle: ExchangeBundle): Promise<ExchangeImportPlan> {
    await validateExchangeBundle(bundle);
    const conflicts: ExchangeBookConflict[] = [];

    for (const incomingBook of bundle.books) {
        const local = await getLocalExchangeHashes(incomingBook.bookId, bundle.manifest.selection);
        const base = findExchangeLedgerEntry(
            bundle.manifest.sourceDevice.id,
            incomingBook.bookId,
        )?.hashes;
        const comparison = {
            content: compareExchangeFingerprint(local.content, incomingBook.fingerprints.content, base?.content),
            progress: compareExchangeFingerprint(local.progress, incomingBook.fingerprints.progress, base?.progress),
            highlights: compareExchangeFingerprint(local.highlights, incomingBook.fingerprints.highlights, base?.highlights),
        };

        conflicts.push({
            bookId: incomingBook.bookId,
            title: incomingBook.title,
            ...comparison,
            suggestedResolution: suggestExchangeResolution(bundle.manifest.intent, comparison),
        });
    }

    return {
        exchangeId: bundle.manifest.exchangeId,
        sourceDevice: bundle.manifest.sourceDevice,
        intent: bundle.manifest.intent,
        books: conflicts,
        hasConflicts: conflicts.some((book) => (
            book.content === 'concurrent-change'
            || book.progress === 'concurrent-change'
            || book.highlights === 'concurrent-change'
        )),
    };
}
