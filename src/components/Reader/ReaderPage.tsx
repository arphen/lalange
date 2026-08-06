import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Reader } from './Reader';
import type { BookDocType } from '../../core/sync/db';
import { SeoHead } from '../SeoHead';
import { loadReaderBook } from './readerBookLoader';

export const ReaderPage = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const [book, setBook] = useState<BookDocType | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!bookId) return;
        let cancelled = false;

        const loadBook = async () => {
            try {
                const loadedBook = await loadReaderBook(bookId);
                if (cancelled) return;
                if (loadedBook) {
                    setBook(loadedBook);
                } else {
                    navigate('/');
                }
            } catch (error) {
                console.error('Failed to load book:', error);
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : 'The local library could not be opened.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadBook();
        return () => {
            cancelled = true;
        };
    }, [bookId, navigate]);

    if (loading) {
        return <div className="flex items-center justify-center h-full text-dune-gold font-mono animate-pulse">LOADING BOOK...</div>;
    }

    if (loadError) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center font-mono">
                <h1 className="text-xl font-bold text-magma-vent">BOOK UNAVAILABLE</h1>
                <p className="max-w-xl text-sm text-gray-300">{loadError}</p>
                <div className="flex flex-wrap justify-center gap-3">
                    <button className="border border-dune-gold px-4 py-2 text-dune-gold" onClick={() => navigate('/')}>BACK TO LIBRARY</button>
                    <button className="border border-gray-500 px-4 py-2 text-gray-200" onClick={() => window.location.reload()}>RELOAD</button>
                </div>
            </div>
        );
    }

    if (!book) {
        return null;
    }

    return (
        <>
            <SeoHead
                title={book.title}
                description={`Read ${book.title} by ${book.author} on XYZ.`}
                robots="noindex, nofollow"
            />
            <Reader 
                book={book} 
                onBack={() => navigate('/')}
            />
        </>
    );
};
