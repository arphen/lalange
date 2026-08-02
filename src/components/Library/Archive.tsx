import React, { useState, useEffect } from 'react';
import { ScanLine } from 'lucide-react';
import { initDB, type BookDocType, type MyDatabase } from '../../core/sync/db';
import { initialIngest, processChaptersInBackground, stopProcessing, estimateBookDensity } from '../../core/ingest/pipeline';
import { decodeRawFilePayload, defaultIngestReaderRegistry } from '../../core/ingest/readers';
import { useAIStore } from '../../core/store/ai';
import { useSettingsStore } from '../../core/store/settings';
import { BookCard } from './BookCard';
import { ExchangeSheet } from '../Exchange/ExchangeSheet';
import { SeoHead } from '../SeoHead';

interface ArchiveProps {
    onOpenBook: (book: BookDocType) => void;
    onScanHandoff: () => void;
}

const normalizeIdentity = (value?: string) => (value || '').trim().toLowerCase();
const uploadAccept = defaultIngestReaderRegistry.getAcceptAttribute();
const supportedFormatsLabel = defaultIngestReaderRegistry.getSupportedExtensionsLabel();

const findDuplicateBook = async (
    db: MyDatabase,
    existingBooks: BookDocType[],
    incomingBook: BookDocType,
    incomingRawData: string
): Promise<BookDocType | null> => {
    const incomingRawPayload = decodeRawFilePayload(incomingRawData).base64Data;
    const incomingTitle = normalizeIdentity(incomingBook.title);
    const incomingAuthor = normalizeIdentity(incomingBook.author || 'Unknown');

    const candidateBooks = existingBooks.filter((book) => {
        const title = normalizeIdentity(book.title);
        const author = normalizeIdentity(book.author || 'Unknown');
        return title === incomingTitle && author === incomingAuthor;
    });

    for (const candidate of candidateBooks) {
        const rawFileDoc = await db.raw_files.findOne(candidate.id).exec();
        const candidateRawPayload = rawFileDoc?.data
            ? decodeRawFilePayload(rawFileDoc.data).base64Data
            : '';
        if (candidateRawPayload && candidateRawPayload === incomingRawPayload) {
            return candidate;
        }
    }

    return null;
};

export const Archive: React.FC<ArchiveProps> = ({ onOpenBook, onScanHandoff }) => {
    const [books, setBooks] = useState<BookDocType[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [exchangeOpen, setExchangeOpen] = useState(false);
    const [exchangeBookIds, setExchangeBookIds] = useState<string[]>([]);
    
    // Only subscribe to the specific AI state properties we need
    const aiIsLoading = useAIStore((s) => s.isLoading);
    const aiProgress = useAIStore((s) => s.progress);
    const requestAISetup = useAIStore((s) => s.requestSetup);
    const aiEnabled = useSettingsStore((s) => s.aiEnabled);

    useEffect(() => {
        let sub: { unsubscribe: () => void };
        const setup = async () => {
            const db = await initDB();
            sub = db.books.find().$.subscribe(docs => {
                setBooks(docs.map(d => d.toJSON() as BookDocType));
            });
        };
        setup();
        return () => {
            if (sub) sub.unsubscribe();
        };
    }, []);

    const ingestBook = async (file: File) => {
        setLoading(true);
        setStatus('Starting ingestion...');
        try {
            const { book, chapters, images, rawFile } = await initialIngest(file, (msg: string) => setStatus(msg));
            const db = await initDB();

            const existingBookDocs = await db.books.find().exec();
            const existingBooks = existingBookDocs.map((doc) => doc.toJSON() as BookDocType);
            const duplicateBook = await findDuplicateBook(db, existingBooks, book, rawFile.data);
            if (duplicateBook) {
                setStatus('Book already exists in archive. Opening existing copy...');
                onOpenBook(duplicateBook);
                return;
            }

            await db.books.insert(book);
            await db.chapters.bulkInsert(chapters);
            if (images.length > 0) {
                await db.images.bulkInsert(images);
            }
            await db.raw_files.insert(rawFile);

            // Initialize reading state
            await db.reading_states.insert({
                bookId: book.id,
                currentChapterId: chapters[0]?.id,
                currentWordIndex: 0,
                lastRead: Date.now(),
                highlights: []
            });

            // Start background processing
            processChaptersInBackground(book.id).catch(console.error);
        } catch (err: unknown) {
            console.error(err);
            alert((err as Error).message || 'Failed to load book');
        } finally {
            setLoading(false);
            setStatus('');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        await ingestBook(e.target.files[0]);
        e.target.value = '';
    };

    const handleLoadDemo = async () => {
        setLoading(true);
        setStatus('Fetching demo book...');
        try {
            const res = await fetch('/pg1952-images.epub');
            if (!res.ok) throw new Error('Failed to fetch demo book');
            const blob = await res.blob();
            const file = new File([blob], 'pg1952-images.epub', { type: 'application/epub+zip' });
            await ingestBook(file);
        } catch (e: unknown) {
            console.error(e);
            alert((e as Error).message);
            setLoading(false);
            setStatus('');
        }
    };

    const handleBookClick = async (book: BookDocType) => {
        // Allow opening even if processing
        onOpenBook(book);
    };

    const handleStopProcessing = (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        if (confirm('Stop ingestion for this book?')) {
            stopProcessing(bookId);
        }
    };

    const handleShare = (e: React.MouseEvent, book: BookDocType) => {
        e.stopPropagation();
        setExchangeBookIds([book.id]);
        setExchangeOpen(true);
    };

    const handleEstimateDensity = async (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        if (!aiEnabled) {
            if (!aiIsLoading) requestAISetup('pacing');
            return;
        }
        if (confirm('Start density estimation for this book? This may take a while.')) {
            estimateBookDensity(bookId).catch(console.error);
        }
    };

    const handleDelete = async (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this book?')) return;

        const db = await initDB();
        await db.books.findOne(bookId).remove();

        // Cleanup related data
        const chapters = await db.chapters.find({ selector: { bookId } }).exec();
        await Promise.all(chapters.map(c => c.remove()));

        const images = await db.images.find({ selector: { bookId } }).exec();
        await Promise.all(images.map(i => i.remove()));

        const rawFile = await db.raw_files.findOne(bookId).exec();
        if (rawFile) await rawFile.remove();

        const readingState = await db.reading_states.findOne({ selector: { bookId } }).exec();
        if (readingState) await readingState.remove();
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (defaultIngestReaderRegistry.isFileSupported(file)) {
                await ingestBook(file);
            } else {
                alert(`Please drop a supported file (${supportedFormatsLabel}).`);
            }
        }
    };

    return (
        <div
            className="archive-shell reader-shell flex h-full w-full overflow-hidden text-white"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <SeoHead
                title="XYZ"
                description="XYZ is a local-first, AI-driven speed reading tool that uses entropy modulation to pace text based on meaning."
                canonicalUrl="https://arphen.xyz/"
                schema={{
                    "@context": "https://schema.org",
                    "@type": "WebApplication",
                    "name": "XYZ",
                    "url": "https://arphen.xyz/",
                    "description": "Local-first AI-driven speed reading tool.",
                    "applicationCategory": "UtilitiesApplication",
                    "operatingSystem": "Web",
                    "offers": {
                        "@type": "Offer",
                        "price": "0",
                        "priceCurrency": "USD"
                    }
                }}
            />
            <div className="archive-main reader-scroll-surface flex-1 overflow-y-auto">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pb-8 pt-16 md:px-8 md:pt-20">
                    <div className="archive-hero calima-glass p-4 md:p-6">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <p className="archive-kicker">ARCHIVE SURFACE</p>
                            {(status || aiIsLoading) && (
                                <div className="archive-status" aria-live="polite">
                                    <span className="archive-status-dot" aria-hidden="true" />
                                    {aiIsLoading ? (aiProgress || 'Initializing AI...') : status}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                            <div>
                                <h1 className="text-gradient-gold text-4xl font-mono font-bold tracking-widest md:text-5xl">ARCHIVE</h1>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className="archive-kpi-chip">{books.length.toLocaleString()} texts</span>
                                    <span className="archive-kpi-chip">{books.reduce((acc, b) => acc + b.totalWords, 0).toLocaleString()} words</span>
                                    <span className="archive-kpi-chip">Drop supported files anywhere to ingest ({supportedFormatsLabel})</span>
                                </div>
                            </div>

                            <div className="reader-toolbar-controls archive-action-rail flex items-center">
                                <button
                                    type="button"
                                    onClick={onScanHandoff}
                                    className="archive-action-btn"
                                >
                                    <span className="flex items-center gap-2">
                                        <ScanLine className="h-4 w-4" aria-hidden />
                                        SCAN HANDOFF
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setExchangeBookIds(books.map((book) => book.id));
                                        setExchangeOpen(true);
                                    }}
                                    disabled={books.length === 0}
                                    className="archive-action-btn"
                                >
                                    EXCHANGE
                                </button>
                                <button
                                    onClick={handleLoadDemo}
                                    disabled={loading}
                                    data-testid="archive-load-demo"
                                    className="archive-action-btn"
                                >
                                    {loading ? 'WORKING' : 'LOAD DEMO'}
                                </button>
                                <label className="archive-action-btn archive-action-btn--primary cursor-pointer">
                                    <span className="flex items-center gap-2">
                                        {loading ? 'INGESTING...' : 'UPLOAD FILE'}
                                        {!loading && (
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                            </svg>
                                        )}
                                    </span>
                                    <input
                                        type="file"
                                        accept={uploadAccept}
                                        className="hidden"
                                        onChange={handleFileUpload}
                                        disabled={loading}
                                    />
                                </label>
                            </div>
                        </div>
                    </div>

                    {books.length === 0 ? (
                        <div className="archive-empty flex flex-col items-center justify-center py-32 text-center">
                            <div className="w-16 h-16 mb-6 text-gray-600">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                            </div>
                            <p className="mb-2 font-mono text-gray-400">ARCHIVE EMPTY</p>
                            <p className="font-mono text-xs text-gray-500">UPLOAD A SUPPORTED FILE TO BEGIN INGESTION ({supportedFormatsLabel})</p>
                        </div>
                    ) : (
                        <div className="archive-grid grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                            {books.map(book => (
                                <BookCard
                                    key={book.id}
                                    book={book}
                                    onOpen={() => handleBookClick(book)}
                                    onDelete={(e) => handleDelete(e, book.id)}
                                    onStop={(e) => handleStopProcessing(e, book.id)}
                                    onEstimateDensity={(e) => handleEstimateDensity(e, book.id)}
                                    onShare={(e) => handleShare(e, book)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <ExchangeSheet
                key={`archive-exchange-${exchangeBookIds.join('-')}`}
                isOpen={exchangeOpen}
                onClose={() => setExchangeOpen(false)}
                books={books}
                initialBookIds={exchangeBookIds}
                initialIntent="give"
                libraryComplete
            />
        </div>
    );
};
