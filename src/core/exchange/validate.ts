import { fingerprintValue } from './fingerprint';
import {
    EXCHANGE_PROTOCOL_VERSION,
    type ExchangeBookPayload,
    type ExchangeBundle,
} from './types';

const MAX_BOOK_COUNT = 500;

async function validateBookPayload(book: ExchangeBookPayload): Promise<void> {
    if (!book.bookId || !book.title) throw new Error('Exchange contains an invalid book.');

    if (book.content) {
        if (book.content.book.id !== book.bookId) {
            throw new Error(`Book identity mismatch for ${book.title}.`);
        }
        if (book.content.chapters.some((chapter) => chapter.bookId !== book.bookId)) {
            throw new Error(`Chapter identity mismatch for ${book.title}.`);
        }
        const contentHash = await fingerprintValue(book.content);
        if (contentHash !== book.fingerprints.content) {
            throw new Error(`Content checksum failed for ${book.title}.`);
        }
    }

    if (book.reading?.progress) {
        const progressHash = await fingerprintValue(book.reading.progress);
        if (progressHash !== book.fingerprints.progress) {
            throw new Error(`Progress checksum failed for ${book.title}.`);
        }
    }

    if (book.reading?.highlights) {
        const highlightsHash = await fingerprintValue(book.reading.highlights);
        if (highlightsHash !== book.fingerprints.highlights) {
            throw new Error(`Highlights checksum failed for ${book.title}.`);
        }
    }
}

export async function validateExchangeBundle(
    bundle: ExchangeBundle,
    now = Date.now(),
): Promise<void> {
    if (bundle.manifest.protocolVersion !== EXCHANGE_PROTOCOL_VERSION) {
        throw new Error(`Unsupported exchange protocol version: ${bundle.manifest.protocolVersion}`);
    }
    if (!bundle.manifest.exchangeId || !bundle.manifest.sourceDevice?.id) {
        throw new Error('Exchange manifest is missing its identity.');
    }
    if (bundle.manifest.expiresAt < now) throw new Error('This exchange invitation has expired.');
    if ((bundle.books.length === 0 && bundle.manifest.intent !== 'reconcile')
        || bundle.books.length > MAX_BOOK_COUNT) {
        throw new Error('Exchange contains an invalid number of books.');
    }
    if (bundle.books.length !== bundle.manifest.books.length) {
        throw new Error('Exchange manifest does not match its payload.');
    }

    const manifestBooks = new Map(bundle.manifest.books.map((book) => [book.bookId, book]));
    for (const book of bundle.books) {
        const manifestBook = manifestBooks.get(book.bookId);
        if (!manifestBook || manifestBook.fingerprints.content !== book.fingerprints.content
            || manifestBook.fingerprints.progress !== book.fingerprints.progress
            || manifestBook.fingerprints.highlights !== book.fingerprints.highlights) {
            throw new Error(`Exchange manifest mismatch for ${book.title}.`);
        }
        await validateBookPayload(book);
    }
}
