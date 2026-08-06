import { initDB, type BookDocType } from '../../core/sync/db';

const READER_LOAD_TIMEOUT_MS = 10_000;
export const READER_LOAD_TIMEOUT_MESSAGE = 'The local library is taking too long to open. Close other XYZ tabs left open before the update, then reload this page.';

export const loadReaderBook = async (
    bookId: string,
    timeoutMs = READER_LOAD_TIMEOUT_MS,
): Promise<BookDocType | null> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(READER_LOAD_TIMEOUT_MESSAGE)), timeoutMs);
    });

    try {
        const db = await Promise.race([initDB(), timeout]);
        const bookDoc = await db.books.findOne(bookId).exec();
        return bookDoc ? bookDoc.toJSON() as BookDocType : null;
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
};