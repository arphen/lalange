import type { InitialIngestResult } from '../../core/ingest/pipeline';
import type { MyDatabase } from '../../core/sync/db';

const removeIfPresent = async (findDocument: () => Promise<{ remove: () => Promise<unknown> } | null>) => {
    const document = await findDocument();
    if (document) await document.remove();
};

export const persistInitialIngest = async (db: MyDatabase, result: InitialIngestResult): Promise<void> => {
    const { book, chapters, images, rawFile } = result;

    try {
        // Keep the book invisible until its resumable source has been committed.
        await db.raw_files.insert(rawFile);
        await db.books.insert(book);
        await db.chapters.bulkInsert(chapters);
        if (images.length > 0) await db.images.bulkInsert(images);
        await db.reading_states.insert({
            bookId: book.id,
            currentChapterId: chapters[0]?.id,
            currentWordIndex: 0,
            lastRead: Date.now(),
            highlights: []
        });
    } catch (error) {
        await Promise.allSettled([
            removeIfPresent(async () => db.books.findOne(book.id).exec()),
            ...chapters.map((chapter) => removeIfPresent(async () => db.chapters.findOne(chapter.id).exec())),
            ...images.map((image) => removeIfPresent(async () => db.images.findOne(image.id).exec())),
            removeIfPresent(async () => db.raw_files.findOne(rawFile.id).exec()),
            removeIfPresent(async () => db.reading_states.findOne(book.id).exec()),
        ]);
        throw new Error('The book could not be saved locally. No partial copy was kept; select the source file and try again.', { cause: error });
    }
};

export const getBookOpenIssue = async (db: MyDatabase, bookId: string): Promise<string | null> => {
    const rawFile = await db.raw_files.findOne(bookId).exec();
    if (rawFile) return null;

    const chapters = await db.chapters.find({ selector: { bookId } }).exec();
    const isFullyProcessed = chapters.length > 0 && chapters.every((chapter) => chapter.status === 'ready');
    if (isFullyProcessed) return null;

    return 'This import is incomplete and its original source file is missing. Delete this copy, then select the PDF again to restart OCR.';
};