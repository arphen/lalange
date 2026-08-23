import React, { useEffect, useState } from 'react';
import { ScanLine, Share2 } from 'lucide-react';
import { initDB, type BookDocType, type ChapterDocType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';

interface BookCardProps {
    book: BookDocType;
    onOpen: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onStop?: (e: React.MouseEvent) => void;
    onEstimateDensity?: (e: React.MouseEvent) => void;
    onScan?: (e: React.MouseEvent) => void;
    onShare?: (e: React.MouseEvent) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onOpen, onDelete, onStop, onEstimateDensity, onScan, onShare }) => {
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

        // Update every 5 seconds if there are processing chapters (battery optimization)
        const hasProcessing = chapters.some(c => c.status === 'processing');
        if (hasProcessing) {
            const interval = setInterval(calculateReadingTime, 5000);
            return () => clearInterval(interval);
        }
    }, [chapters]);

    const isReady = chapters.length > 0 && chapters.every(c => c.status === 'ready');
    const isProcessing = chapters.some(c => c.status === 'processing');
    const readyChapterCount = chapters.filter((chapter) => chapter.status === 'ready').length;
    const chapterProgressPercent = chapters.length > 0
        ? Math.round((readyChapterCount / chapters.length) * 100)
        : 0;

    return (
        <div
            onClick={onOpen}
            data-testid="book-card"
            className="archive-card group relative flex h-full cursor-pointer flex-col p-4 transition-all duration-300"
        >
            <div className="absolute right-2 top-2 z-10 flex gap-2">
                {isProcessing && onStop && (
                    <button
                        onClick={onStop}
                        className="archive-card-action text-magma-vent animate-pulse"
                        title="Stop Processing"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                    </button>
                )}
                {onEstimateDensity && isReady && (
                    <button
                        onClick={onEstimateDensity}
                        className="archive-card-action text-gray-500 opacity-0 transition-opacity group-hover:opacity-100"
                        title="Estimate Density"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                    </button>
                )}
                {onScan && isReady && (
                    <button
                        onClick={onScan}
                        className="archive-card-action text-gray-500 opacity-0 transition-opacity group-hover:opacity-100"
                        title="Scan for text anomalies"
                        aria-label={`Scan ${book.title} for text anomalies`}
                    >
                        <ScanLine className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                )}
                {onShare && isReady && (
                    <button
                        onClick={onShare}
                        className="archive-card-action text-dune-gold"
                        title="Share book"
                        aria-label={`Share ${book.title}`}
                    >
                        <Share2 className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                )}
                <button
                    onClick={onDelete}
                    className={`archive-card-action archive-card-action--danger text-gray-500 transition-opacity ${isProcessing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title="Delete Book"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className="archive-card-cover relative mb-4 aspect-[2/3] overflow-hidden border border-white/5">
                {book.cover ? (
                    <img src={book.cover} alt={book.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 font-mono text-xs p-4 text-center border-2 border-dashed border-white/5">
                        <span className="mb-2 text-2xl opacity-20">BOOK</span>
                        NO COVER
                    </div>
                )}

                <div className="reader-progress-track absolute bottom-0 left-0 right-0 h-1">
                    <span style={{ width: `${chapterProgressPercent}%` }} />
                </div>

                <div className="archive-card-chip absolute left-3 top-3">
                    {isReady ? `${chapterProgressPercent}% ready` : isProcessing ? 'Ingesting' : 'Queued'}
                </div>
            </div>

            <div className="flex-1 flex flex-col justify-between gap-2">
                <div>
                    <h3 className="archive-card-title mb-1 line-clamp-2 font-mono text-sm font-bold leading-tight transition-colors">
                        <span data-testid="book-card-title">{book.title}</span>
                    </h3>
                    <p className="archive-card-meta truncate font-mono text-xs uppercase tracking-wider">
                        {book.author || 'UNKNOWN AUTHOR'}
                    </p>
                </div>

                <div className="archive-card-footer flex items-center justify-between border-t border-white/5 pt-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-canarian-pine">
                        {readingTime || 'CALCULATING...'}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="archive-card-meta font-mono text-[10px]">{readyChapterCount}/{chapters.length || 0}</span>
                        {processingStatus && (
                            <div className="w-2 h-2 rounded-full bg-magma-vent animate-pulse" title={processingStatus}></div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
