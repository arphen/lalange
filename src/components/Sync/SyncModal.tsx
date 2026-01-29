import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { initDB, type BookDocType, type ChapterDocType } from '../../core/sync/db';
import { generateUUID } from '../../utils/uuid';
import { startBookSync, type ReplicationState } from '../../core/sync/replication';
import { estimateBookDensityWithProgress, stopProcessing, type DensityProgress } from '../../core/ingest/pipeline';

type PreparePhase = 'checking' | 'estimating' | 'ready' | 'error';

interface SyncModalProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookDocType | null;
}

// Calculate density completion for a book
const calculateDensityCompletion = (chapters: ChapterDocType[]): { completed: number; total: number; percent: number } => {
    let totalWords = 0;
    let completedWords = 0;

    for (const chapter of chapters) {
        const wordCount = chapter.content.length;
        totalWords += wordCount;

        // Count words with density > 0 (0 means pending/unprocessed)
        const densities = chapter.densities || [];
        const processed = densities.filter(d => d > 0).length;
        completedWords += Math.min(processed, wordCount);
    }

    const percent = totalWords > 0 ? (completedWords / totalWords) * 100 : 100;
    return { completed: completedWords, total: totalWords, percent };
};

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose, book }) => {
    const [status, setStatus] = useState<string>('Waiting for connection...');
    const [preparePhase, setPreparePhase] = useState<PreparePhase>('checking');
    const [densityProgress, setDensityProgress] = useState<{ completed: number; total: number; percent: number }>({ completed: 0, total: 0, percent: 0 });
    const [currentChapter, setCurrentChapter] = useState<string>('');
    const replicationStatesRef = useRef<ReplicationState[]>([]);
    const preparingBookIdRef = useRef<string | null>(null);
    
    // Generate stable room/secret IDs per book session
    const syncIds = useMemo(() => {
        if (!book) return null;
        return { roomId: generateUUID(), secret: generateUUID() };
    }, [book?.id]);
    
    // Compute QR URL without setState
    const qrUrl = useMemo(() => {
        if (!book || !syncIds) return '';
        const url = new URL(window.location.origin);
        url.pathname = '/sync';
        url.searchParams.set('room', syncIds.roomId);
        url.searchParams.set('key', syncIds.secret);
        url.searchParams.set('bookId', book.id);
        return url.toString();
    }, [book, syncIds]);

    // Handle close with cleanup
    const handleClose = useCallback(() => {
        if (preparingBookIdRef.current) {
            stopProcessing(preparingBookIdRef.current);
            preparingBookIdRef.current = null;
        }
        onClose();
    }, [onClose]);

    // Check density and prepare book
    useEffect(() => {
        if (!isOpen || !book) {
            return;
        }

        let cancelled = false;

        const prepareBook = async () => {
            // Reset state when opening for a new book (inside async to satisfy linter)
            setPreparePhase('checking');
            setDensityProgress({ completed: 0, total: 0, percent: 0 });
            setCurrentChapter('');

            const db = await initDB();
            const chapters = await db.chapters.find({ selector: { bookId: book.id } }).exec();
            const chapterData = chapters.map(c => c.toJSON() as ChapterDocType);

            if (cancelled) return;

            const completion = calculateDensityCompletion(chapterData);
            setDensityProgress(completion);

            // If density is already complete (>95%), skip to ready
            if (completion.percent >= 95) {
                setPreparePhase('ready');
                return;
            }

            // Need to estimate density first
            setPreparePhase('estimating');
            preparingBookIdRef.current = book.id;

            try {
                await estimateBookDensityWithProgress(book.id, (progress: DensityProgress) => {
                    if (cancelled) return;
                    setDensityProgress({
                        completed: progress.processedWords,
                        total: progress.totalWords,
                        percent: progress.totalWords > 0 ? (progress.processedWords / progress.totalWords) * 100 : 0
                    });
                    setCurrentChapter(progress.currentChapter || '');
                });

                if (!cancelled) {
                    setPreparePhase('ready');
                    preparingBookIdRef.current = null;
                }
            } catch (err) {
                console.error('Density estimation failed:', err);
                if (!cancelled) {
                    setPreparePhase('error');
                    preparingBookIdRef.current = null;
                }
            }
        };

        prepareBook();

        return () => {
            cancelled = true;
            if (preparingBookIdRef.current) {
                stopProcessing(preparingBookIdRef.current);
                preparingBookIdRef.current = null;
            }
        };
    }, [isOpen, book]);

    // Start sync once ready
    useEffect(() => {
        if (!isOpen || !book || !syncIds || preparePhase !== 'ready') {
            // Cleanup on close
            replicationStatesRef.current.forEach(rs => rs.cancel());
            replicationStatesRef.current = [];
            return;
        }

        const start = async () => {
            try {
                const states = await startBookSync(syncIds.roomId, syncIds.secret, (isActive) => {
                    setStatus(isActive ? 'Client Connected. Syncing...' : 'Waiting for connection...');
                }, (err) => {
                    console.error('Sync Error:', err);
                    setStatus('Error connecting. Check console.');
                });
                replicationStatesRef.current = states;
            } catch (e) {
                console.error(e);
                setStatus('Failed to start sync service.');
            }
        };
        start();

        return () => {
            replicationStatesRef.current.forEach(rs => rs.cancel());
            replicationStatesRef.current = [];
        };
    }, [isOpen, book, syncIds, preparePhase]);

    if (!isOpen || !book) return null;

    // Render preparation phase UI
    const renderPrepareContent = () => {
        if (preparePhase === 'checking') {
            return (
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-2 border-dune-gold border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-mono text-gray-400">Checking book readiness...</p>
                </div>
            );
        }

        if (preparePhase === 'estimating') {
            return (
                <div className="flex flex-col items-center gap-4 w-full">
                    <div className="w-16 h-16 relative">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                            <circle
                                cx="18" cy="18" r="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="text-white/10"
                            />
                            <circle
                                cx="18" cy="18" r="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray={`${densityProgress.percent} 100`}
                                strokeLinecap="round"
                                className="text-dune-gold transition-all duration-300"
                            />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-dune-gold">
                            {Math.round(densityProgress.percent)}%
                        </span>
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-mono text-gray-300 mb-1">Preparing book for sync...</p>
                        <p className="text-xs font-mono text-gray-500">
                            Estimating reading density
                        </p>
                        {currentChapter && (
                            <p className="text-xs font-mono text-gray-600 mt-2 truncate max-w-[250px]">
                                {currentChapter}
                            </p>
                        )}
                    </div>
                    <div className="w-full max-w-[200px] h-1 bg-white/10 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-dune-gold transition-all duration-300"
                            style={{ width: `${densityProgress.percent}%` }}
                        />
                    </div>
                    <p className="text-[10px] font-mono text-gray-600">
                        {densityProgress.completed.toLocaleString()} / {densityProgress.total.toLocaleString()} words
                    </p>
                </div>
            );
        }

        if (preparePhase === 'error') {
            return (
                <div className="flex flex-col items-center gap-4">
                    <div className="text-magma-vent">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <p className="text-sm font-mono text-gray-400">Failed to prepare book</p>
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-sm font-mono rounded transition-colors"
                    >
                        Close
                    </button>
                </div>
            );
        }

        // preparePhase === 'ready' - show QR code
        return (
            <>
                <p className="text-sm font-mono text-gray-400 mb-6">
                    Scan with your phone to sync "{book.title}"
                </p>

                {qrUrl && (
                    <div className="bg-white p-4 rounded-lg inline-block mb-6 relative group">
                         <QRCodeSVG
                            value={qrUrl}
                            size={200}
                            level="L"
                            includeMargin={true}
                        />
                        {/* Overlay to click-to-copy or dev usage */}
                        <a 
                            href={qrUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity text-white font-mono text-xs font-bold cursor-pointer"
                        >
                            OPEN LINK (DEBUG)
                        </a>
                    </div>
                )}

                <p className="text-xs font-mono text-magma-vent uppercase tracking-wider mb-2">
                    {status}
                </p>

                <p className="text-xs font-mono text-gray-500 max-w-xs mx-auto">
                    Keep this window open. Your phone will connect via local peer-to-peer sync.
                </p>
            </>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-basalt border border-white/10 p-6 md:p-8 rounded-lg shadow-2xl max-w-md w-full relative">
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="text-center">
                    <h3 className="text-xl font-mono font-bold text-dune-gold mb-2">
                        {preparePhase === 'ready' ? 'SYNC TO COMPANION' : 'PREPARING BOOK'}
                    </h3>
                    {renderPrepareContent()}
                </div>
            </div>
        </div>
    );
};
