import React, { useState, useEffect } from 'react';
import { initDB, type BookDocType } from '../../core/sync/db';
import { initialIngest, processChaptersInBackground, stopProcessing, estimateBookDensity } from '../../core/ingest/pipeline';
import { useAIStore } from '../../core/store/ai';
import { BookCard } from './BookCard';

interface ArchiveProps {
    onOpenBook: (book: BookDocType) => void;
}

export const Archive: React.FC<ArchiveProps> = ({ onOpenBook }) => {
    const [books, setBooks] = useState<BookDocType[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const aiState = useAIStore();

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
    };

    const handleLoadDemo = async () => {
        setLoading(true);
        setStatus('Fetching demo book...');
        try {
            const res = await fetch('/test_book.epub');
            if (!res.ok) throw new Error('Failed to fetch demo book');
            const blob = await res.blob();
            const file = new File([blob], 'test_book.epub', { type: 'application/epub+zip' });
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

    const handleEstimateDensity = async (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
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
            if (file.type === 'application/epub+zip' || file.name.endsWith('.epub')) {
                await ingestBook(file);
            } else {
                alert('Please drop an EPUB file.');
            }
        }
    };

    return (
        <div
            className="flex h-screen overflow-hidden bg-basalt text-white"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4 border-b border-white/10 pb-8">
                        <div>
                            <h2 className="text-4xl font-mono font-bold text-dune-gold tracking-widest mb-2">ARCHIVE</h2>
                            <p className="text-gray-500 font-mono text-sm uppercase tracking-wider">
                                {books.length} TEXTS // {books.reduce((acc, b) => acc + b.totalWords, 0).toLocaleString()} WORDS
                            </p>
                        </div>

                        <div className="flex items-center gap-6 w-full md:w-auto">
                            {(status || aiState.isLoading) && (
                                <div className="flex items-center gap-2 text-magma-vent font-mono text-xs animate-pulse">
                                    <span className="w-2 h-2 bg-magma-vent rounded-full"></span>
                                    {aiState.isLoading ? (aiState.progress || 'Initializing AI...') : status}
                                </div>
                            )}
                            <button
                                onClick={handleLoadDemo}
                                disabled={loading}
                                className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-sm font-mono text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            >
                                [ LOAD DEMO ]
                            </button>
                            <label className="group relative cursor-pointer flex items-center justify-center px-6 py-3 font-mono font-bold text-sm tracking-widest transition-all bg-dune-gold text-black hover:bg-white w-full md:w-auto">
                                <span className="relative z-10 flex items-center gap-2">
                                    {loading ? 'INGESTING...' : 'UPLOAD EPUB'}
                                    {!loading && (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                    )}
                                </span>
                                <input
                                    type="file"
                                    accept=".epub"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                    disabled={loading}
                                />
                            </label>
                        </div>
                    </div>

                    {books.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-32 border border-dashed border-white/10 rounded-lg bg-white/5">
                            <div className="w-16 h-16 mb-6 text-gray-600">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                            </div>
                            <p className="font-mono text-gray-500 mb-2">ARCHIVE EMPTY</p>
                            <p className="text-xs text-gray-600 font-mono">UPLOAD EPUB TO BEGIN INGESTION</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {books.map(book => (
                                <BookCard
                                    key={book.id}
                                    book={book}
                                    onOpen={() => handleBookClick(book)}
                                    onDelete={(e) => handleDelete(e, book.id)}
                                    onStop={(e) => handleStopProcessing(e, book.id)}
                                    onEstimateDensity={(e) => handleEstimateDensity(e, book.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
