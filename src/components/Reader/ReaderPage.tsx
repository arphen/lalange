import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Reader } from './Reader';
import { initDB, type BookDocType } from '../../core/sync/db';

export const ReaderPage = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const [book, setBook] = useState<BookDocType | null>(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!bookId) return;

        const loadBook = async () => {
            try {
                const db = await initDB();
                const bookDoc = await db.books.findOne(bookId).exec();
                if (bookDoc) {
                    setBook(bookDoc.toJSON() as BookDocType);
                } else {
                    // Book not found, redirect to archive
                    navigate('/');
                }
            } catch (error) {
                console.error("Failed to load book:", error);
            } finally {
                setLoading(false);
            }
        };

        loadBook();
        
        // return () => { if (sub) sub.unsubscribe(); }; 
    }, [bookId, navigate]);

    if (loading) {
        return <div className="flex items-center justify-center h-full text-dune-gold font-mono animate-pulse">LOADING BOOK...</div>;
    }

    if (!book) {
        return null; // Will redirect
    }

    return (
        <Reader 
            book={book} 
            onBack={() => navigate('/')}
        />
    );
};
