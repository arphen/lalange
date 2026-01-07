import React, { useEffect, useState } from 'react';
import { initDB, type BookDocType, type ChapterDocType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';

interface BookCardProps {
    book: BookDocType;
    onOpen: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onStop?: (e: React.MouseEvent) => void;
    onEstimateDensity?: (e: React.MouseEvent) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onOpen, onDelete, onStop, onEstimateDensity }) => {
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [readingTime, setReadingTime] = useState<string>('');
    const [processingStatus, setProcessingStatus] = useState<string>('');

    useEffect(() => {
        let sub: { unsubscribe: () => void };
        const setup = async () => {
            const db = await initDB();
            sub = db.chapters.find({
                selector: { bookId: book.id },
                sort: [{ index: 'asc' }]
            }).$.subscribe(docs => {
                setChapters(docs.map(d => d.toJSON() as ChapterDocType));
            });
        };
        setup();
        return () => {
            if (sub) sub.unsubscribe();
        };
    }, [book.id]);

    useEffect(() => {
        const calculateReadingTime = () => {
            const USER_WPM = 300; // Default reading speed

            // Separate finished and processing chapters
            const finishedChapters = chapters.filter(c => c.status === 'ready');
            const processingChapters = chapters.filter(c => c.status === 'processing');

            // Calculate total words from finished chapters
            let totalWords = 0;
            finishedChapters.forEach(ch => {
                totalWords += ch.content.length;
            });

            // For processing chapters, use linear projection
            let estimatedProcessingWords = 0;
            processingChapters.forEach(ch => {
                const reportedWords = ch.content.length;
                const speed = ch.processingSpeed || 0;
                const lastChunkTime = ch.lastChunkCompletedAt || 0;

                if (speed > 0 && lastChunkTime > 0) {
                    const now = Date.now();
                    const timeSinceLastChunk = (now - lastChunkTime) / 60000; // minutes
                    const projectedNewWords = Math.floor(speed * timeSinceLastChunk);
                    estimatedProcessingWords += reportedWords + projectedNewWords;
                } else {
                    estimatedProcessingWords += reportedWords;
                }
            });

            const totalAvailableWords = totalWords + estimatedProcessingWords;
            const totalMinutes = totalAvailableWords / USER_WPM;

            if (processingChapters.length > 0) {
                const avgSpeed = processingChapters.reduce((sum, ch) => sum + (ch.processingSpeed || 0), 0) / processingChapters.length;
                setReadingTime(formatReadingTime(totalMinutes));
                setProcessingStatus(` • ${Math.round(avgSpeed)} WPM ingest`);
            } else if (finishedChapters.length > 0) {
                setReadingTime(formatReadingTime(totalMinutes));
                setProcessingStatus('');
            } else {
                setReadingTime('Processing...');
                setProcessingStatus('');
            }
        };

        calculateReadingTime();

        // Update every second if there are processing chapters
        const hasProcessing = chapters.some(c => c.status === 'processing');
        if (hasProcessing) {
            const interval = setInterval(calculateReadingTime, 1000);
            return () => clearInterval(interval);
        }
    }, [chapters]);

    const isReady = chapters.length > 0 && chapters.every(c => c.status === 'ready');
    const isProcessing = chapters.some(c => c.status === 'processing');

    return (
        <div
            onClick={onOpen}
            className="cursor-pointer group relative bg-white/5 border border-white/10 hover:border-dune-gold transition-all duration-300 p-4 flex flex-col h-full"
        >
            <div className="absolute top-2 right-2 z-10 flex gap-2">
                {isProcessing && onStop && (
                    <button
                        onClick={onStop}
                        className="text-magma-vent hover:text-red-500 opacity-100 transition-opacity animate-pulse"
                        title="Stop Processing"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                    </button>
                )}
                <button
                    onClick={onDelete}
                    className={`text-gray-500 hover:text-magma-vent transition-opacity ${isProcessing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title="Delete Book"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            {onEstimateDensity && isReady && (
                <button
                    onClick={onEstimateDensity}
                    className="absolute top-2 right-10 z-10 text-gray-500 hover:text-dune-gold opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Estimate Density"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                </button>
            )}

            <div className="aspect-[2/3] bg-black/20 mb-4 overflow-hidden border border-white/5 relative">
                {book.cover ? (
                    <img src={book.cover} alt={book.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 font-mono text-xs p-4 text-center border-2 border-dashed border-white/5">
                        <span className="mb-2 text-2xl opacity-20">EPUB</span>
                        NO COVER
                    </div>
                )}

                {/* Progress Overlay */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                    <div className="h-full bg-dune-gold" style={{ width: '0%' }}></div>
                </div>
            </div>

            <div className="flex-1 flex flex-col justify-between gap-2">
                <div>
                    <h3 className="font-mono text-sm font-bold text-gray-200 group-hover:text-dune-gold transition-colors line-clamp-2 leading-tight mb-1">
                        {book.title}
                    </h3>
                    <p className="font-mono text-xs text-gray-500 truncate uppercase tracking-wider">
                        {book.author || 'UNKNOWN AUTHOR'}
                    </p>
                </div>

                <div className="pt-3 border-t border-white/5 flex justify-between items-center">
                    <div className="font-mono text-[10px] text-canarian-pine uppercase tracking-wider">
                        {readingTime || 'CALCULATING...'}
                    </div>
                    {processingStatus && (
                        <div className="w-2 h-2 bg-magma-vent rounded-full animate-pulse" title={processingStatus}></div>
                    )}
                </div>
            </div>
        </div>
    );
};
