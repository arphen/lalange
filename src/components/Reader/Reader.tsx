import React, { useEffect, useRef, useState } from 'react';
import { type BookDocType, type ChapterDocType, type ReadingStateDocType, initDB } from '../../core/sync/db';
import { getBionicSplit, getBionicGradientHtml } from '../../core/rsvp/bionic';
import { getVisualProcessingDelay } from '../../core/rsvp/timing';
import { Sidebar } from './Sidebar';
import { useSettingsStore } from '../../core/store/settings';

import { scheduler } from '../../core/ingest/scheduler';
import { processChaptersInBackground } from '../../core/ingest/pipeline';

interface ReaderProps {
    book: BookDocType;
    onBack?: () => void;
    onOpenSettings?: () => void;
}

const getDensityColor = (score: number) => {
    if (score === 0) return 'text-gray-700 opacity-50'; // Pending
    if (score <= 0.6) return 'text-blue-400'; // Fast
    if (score <= 0.8) return 'text-blue-300'; // Brisk
    if (score <= 1.0) return 'text-gray-400'; // Normal
    if (score <= 1.2) return 'text-yellow-200'; // Deliberate
    if (score <= 1.5) return 'text-yellow-500'; // Slow
    if (score <= 2.0) return 'text-orange-500'; // Very Slow
    return 'text-red-500 font-bold'; // Profound
};

export const Reader: React.FC<ReaderProps> = ({ book, onOpenSettings }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const { wpm, setWpm, summaryWpm } = useSettingsStore();
    const [isHoveringDial, setIsHoveringDial] = useState(false);

    // State for current chapter and reading position
    const [currentChapter, setCurrentChapter] = useState<ChapterDocType | null>(null);
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [readingState, setReadingState] = useState<ReadingStateDocType | null>(null);
    const [loading, setLoading] = useState(true);

    // Update Scheduler Cursor
    useEffect(() => {
        if (currentChapter) {
            scheduler.setCursor(book.id, currentChapter.id, currentWordIndex);
        }
    }, [book.id, currentChapter, currentWordIndex]);

    // Sidebar & Chapters
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [showSidebar, setShowSidebar] = useState(true);
    const [inspectingChapterId, setInspectingChapterId] = useState<string | null>(null);
    const inspectingChapter = chapters.find(c => c.id === inspectingChapterId);
    const [now, setNow] = useState(Date.now()); // Force re-render for live time updates

    const prevContainerRef = useRef<HTMLDivElement>(null);
    const nextContainerRef = useRef<HTMLDivElement>(null);
    const rsvpRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<number | undefined>(undefined);
    const lastTimeRef = useRef<number | undefined>(undefined);
    const accumulatorRef = useRef<number>(0);

    // Refs for loop access
    const indexRef = useRef(0);
    const wpmRef = useRef(wpm);
    const isPlayingRef = useRef(isPlaying);
    const wordsRef = useRef<string[]>([]);
    const densitiesRef = useRef<number[]>([]);
    const chaptersRef = useRef(chapters);
    const currentChapterRef = useRef(currentChapter);

    // Summary Mode Refs
    const [isSummaryActive, setIsSummaryActive] = useState(false);
    const isSummaryActiveRef = useRef(false);
    const savedChapterIndexRef = useRef(0);
    const summaryWordsRef = useRef<string[]>([]);

    const saveProgress = React.useCallback(async () => {
        if (loading || !readingState || !currentChapter) return;
        const db = await initDB();
        const doc = await db.reading_states.findOne(book.id).exec();
        if (doc) {
            await doc.incrementalPatch({
                currentChapterId: currentChapter.id,
                currentWordIndex: indexRef.current,
                lastRead: Date.now()
            });
        }
    }, [loading, readingState, currentChapter, book.id]);

    const renderWord = React.useCallback((idx: number, words: string[]) => {
        // Update RSVP Display
        if (rsvpRef.current) {
            const currentWord = words[idx];
            if (currentWord) {
                // Use gradient for the main RSVP display
                rsvpRef.current.innerHTML = getBionicGradientHtml(currentWord);
            }
        }

        // Render Previous Context (Last ~150 words for better vertical fill)
        if (prevContainerRef.current) {
            const start = Math.max(0, idx - 150);
            const end = idx;
            const prevWords = words.slice(start, end);
            const html = prevWords.map((w, i) => {
                const actualIndex = start + i;
                const { bold, light } = getBionicSplit(w);
                // Add line break after punctuation to simulate structure
                const isEnd = /[.!?]$/.test(w);
                const breakHtml = isEnd ? '<div class="w-full h-2"></div>' : '';

                const density = densitiesRef.current[actualIndex] || 1.0;
                const colorClass = getDensityColor(density);

                return `
                    <span 
                        class="word-span inline-block mr-1.5 mb-1 transition-all duration-300 cursor-pointer ${colorClass} opacity-60 hover:opacity-100 hover:text-white"
                        data-index="${actualIndex}"
                    >
                        <span class="font-bold">${bold}</span><span class="font-light opacity-80">${light}</span>
                    </span>
                    ${breakHtml}
                `;
            }).join('');
            prevContainerRef.current.innerHTML = html;
            // Scroll to bottom
            prevContainerRef.current.scrollTop = prevContainerRef.current.scrollHeight;
        }

        // Render Next Context (Next ~150 words)
        if (nextContainerRef.current) {
            const start = idx + 1;
            const end = Math.min(words.length, idx + 151);
            const nextWords = words.slice(start, end);
            const html = nextWords.map((w, i) => {
                const actualIndex = start + i;
                const { bold, light } = getBionicSplit(w);
                const isEnd = /[.!?]$/.test(w);
                const breakHtml = isEnd ? '<div class="w-full h-2"></div>' : '';

                const density = densitiesRef.current[actualIndex] || 1.0;
                const colorClass = getDensityColor(density);

                return `
                    <span 
                        class="word-span inline-block mr-1.5 mb-1 transition-all duration-300 cursor-pointer ${colorClass} opacity-60 hover:opacity-100 hover:text-white"
                        data-index="${actualIndex}"
                    >
                        <span class="font-bold">${bold}</span><span class="font-light opacity-80">${light}</span>
                    </span>
                    ${breakHtml}
                `;
            }).join('');
            nextContainerRef.current.innerHTML = html;
            // Scroll to top (default)
        }
    }, []);

    // Ref to hold the current chapter subscription
    const chapterSubRef = useRef<{ unsubscribe: () => void } | null>(null);

    const loadChapter = React.useCallback(async (chapterId: string, initialIndex: number = 0, autoPlay: boolean = false) => {
        setIsPlaying(false);
        setLoading(true);
        // Use a local flag to track if this is the first emission (load) or subsequent (update)
        let isFirstEmission = true;

        const db = await initDB();

        // Unsubscribe previous
        if (chapterSubRef.current) {
            chapterSubRef.current.unsubscribe();
            chapterSubRef.current = null;
        }

        // Subscribe to the chapter document
        chapterSubRef.current = db.chapters.findOne(chapterId).$.subscribe(async (doc) => {
            if (!doc) return;
            const chapterDoc = doc.toJSON() as ChapterDocType;

            // Allow loading if ready OR if processing but has content
            const isReadable = chapterDoc.status === 'ready' || (chapterDoc.status === 'processing' && chapterDoc.content.length > 0);

            if (!isReadable) {
                return;
            }

            if (isFirstEmission) {
                isFirstEmission = false;
                setCurrentChapter(chapterDoc);
                wordsRef.current = chapterDoc.content;
                densitiesRef.current = chapterDoc.densities || [];

                indexRef.current = initialIndex;
                setCurrentWordIndex(initialIndex);
                renderWord(initialIndex, chapterDoc.content);
                setLoading(false);
                // setShowSidebar(false); // Keep sidebar open by default

                // Update state immediately if starting fresh
                if (initialIndex === 0) {
                    const stateDoc = await db.reading_states.findOne(book.id).exec();
                    if (stateDoc) {
                        await stateDoc.incrementalPatch({
                            currentChapterId: chapterId,
                            currentWordIndex: 0
                        });
                    }
                }

                if (autoPlay) {
                    setIsPlaying(true);
                }
            } else {
                // Live update
                setCurrentChapter(chapterDoc);
                wordsRef.current = chapterDoc.content;
                densitiesRef.current = chapterDoc.densities || [];
                renderWord(indexRef.current, chapterDoc.content);
            }
        });
    }, [renderWord, book.id]);

    const scrollIntervalRef = useRef<number | null>(null);
    const scrollStartTimeRef = useRef<number>(0);

    const startScrolling = (direction: 'back' | 'fwd') => {
        if (scrollIntervalRef.current) return;

        scrollStartTimeRef.current = Date.now();

        const scrollLoop = () => {
            const now = Date.now();
            const elapsed = now - scrollStartTimeRef.current;

            // Exponential speed increase:
            // Start slow (1 word per tick) for first 1s
            // Then ramp up speed
            let speed = 1;
            if (elapsed > 1000) {
                // After 1s, speed increases based on time
                // e.g. at 2s -> speed 5, at 3s -> speed 10
                speed = Math.floor(1 + (elapsed - 1000) / 200);
            }

            const newIndex = direction === 'back'
                ? Math.max(0, indexRef.current - speed)
                : Math.min(wordsRef.current.length - 1, indexRef.current + speed);

            if (newIndex !== indexRef.current) {
                indexRef.current = newIndex;
                setCurrentWordIndex(newIndex);
                renderWord(newIndex, wordsRef.current);
                scrollIntervalRef.current = requestAnimationFrame(scrollLoop);
            } else {
                scrollIntervalRef.current = null; // Stop if hit boundary
            }
        };

        scrollIntervalRef.current = requestAnimationFrame(scrollLoop);
    };

    const stopScrolling = () => {
        if (scrollIntervalRef.current) {
            cancelAnimationFrame(scrollIntervalRef.current);
            scrollIntervalRef.current = null;
        }
    };

    const handleRiverClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        // Check if clicked on a word span or its children
        const wordSpan = target.closest('[data-index]');
        if (wordSpan) {
            const indexStr = wordSpan.getAttribute('data-index');
            if (indexStr) {
                const newIndex = parseInt(indexStr, 10);
                if (!isNaN(newIndex)) {
                    // If clicking the current word, toggle play/pause
                    if (newIndex === indexRef.current) {
                        setIsPlaying(!isPlayingRef.current);
                    } else {
                        // Jump to new word and PAUSE so user can read context
                        setIsPlaying(false);
                        indexRef.current = newIndex;
                        setCurrentWordIndex(newIndex);
                        renderWord(newIndex, wordsRef.current);
                    }
                    saveProgress();
                }
            }
        } else {
            // Clicked background of stream - Toggle Play/Pause
            setIsPlaying(!isPlayingRef.current);
        }
    };

    const loop = React.useCallback(function loopInternal(time: number) {
        if (!isPlayingRef.current) return;

        if (!lastTimeRef.current) lastTimeRef.current = time;
        const deltaTime = time - lastTimeRef.current;
        lastTimeRef.current = time;

        accumulatorRef.current += deltaTime;
        const baseInterval = 60000 / wpmRef.current;

        let shouldRender = false;

        if (accumulatorRef.current > Math.max(1000, baseInterval * 10)) {
            accumulatorRef.current = baseInterval;
        }

        while (true) {
            const activeWords = isSummaryActiveRef.current ? summaryWordsRef.current : wordsRef.current;
            const activeDensities = isSummaryActiveRef.current ? [] : densitiesRef.current;

            const currentWord = activeWords[indexRef.current] || '';
            const density = activeDensities[indexRef.current];
            
            // Use density if available, otherwise default to 1.0 (Normal)
            const currentDensity = (density !== undefined && density > 0) ? density : 1.0;
            
            // === COGNITIVE STACK IMPLEMENTATION ===
            // T_display = T_floor + (K_info * Surprisal) + (K_vis * sqrt(L)) + P_punc
            
            // 1. T_floor (Physiological minimum)
            const T_floor = 75;

            // 2. Information component (Surprisal)
            // baseInterval represents the user's preferred "beat". 
            // currentDensity is the multiplier derived from LLM surprisal (around 1.0).
            const infoTime = baseInterval * currentDensity;

            // 3. Visual & Punctuation component
            const visualDelay = getVisualProcessingDelay(currentWord);

            // Total Duration
            const targetInterval = T_floor + infoTime + visualDelay;

            if (accumulatorRef.current >= targetInterval) {
                if (indexRef.current < activeWords.length - 1) {
                    indexRef.current++;
                    accumulatorRef.current -= targetInterval;
                    shouldRender = true;

                    // Check for Subchapter Boundary (only if NOT in summary mode)
                    if (!isSummaryActiveRef.current) {
                        const sub = currentChapterRef.current?.subchapters?.find(s => s.endWordIndex === indexRef.current);
                        if (sub && sub.summary) {
                            // Enter Summary Mode
                            isSummaryActiveRef.current = true;
                            setIsSummaryActive(true);

                            savedChapterIndexRef.current = indexRef.current;

                            // Swap words
                            summaryWordsRef.current = sub.summary.split(' ');
                            indexRef.current = 0;

                            // Slow down WPM
                            wpmRef.current = summaryWpm;

                            // Force render first word of summary
                            renderWord(0, summaryWordsRef.current);
                            return; // Continue loop next frame
                        }
                    }
                } else {
                    // End of words
                    if (isSummaryActiveRef.current) {
                        // End of Summary -> Resume Chapter
                        isSummaryActiveRef.current = false;
                        setIsSummaryActive(false);

                        // Restore
                        indexRef.current = savedChapterIndexRef.current;
                        wpmRef.current = wpm; // Restore user WPM

                        renderWord(indexRef.current, wordsRef.current);
                        return;
                    }

                    // End of Chapter
                    shouldRender = true;

                    // Find next chapter
                    const chapters = chaptersRef.current;
                    const currentChapter = currentChapterRef.current;
                    const currentIndex = chapters.findIndex(c => c.id === currentChapter?.id);

                    if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
                        const nextChapter = chapters[currentIndex + 1];
                        // Auto-play next chapter
                        loadChapter(nextChapter.id, 0, true);
                        // Break loop, loadChapter will restart it via setIsPlaying(true)
                        break;
                    } else {
                        setIsPlaying(false);
                        break;
                    }
                }
            } else {
                break;
            }
        }

        if (shouldRender) {
            const activeWords = isSummaryActiveRef.current ? summaryWordsRef.current : wordsRef.current;
            renderWord(indexRef.current, activeWords);
        }

        requestRef.current = requestAnimationFrame(loopInternal);
    }, [wpm, renderWord, loadChapter]);

    // Sync refs
    useEffect(() => {
        if (!isSummaryActiveRef.current) {
            wpmRef.current = wpm;
        }
    }, [wpm]);

    useEffect(() => {
        chaptersRef.current = chapters;
    }, [chapters]);

    useEffect(() => {
        currentChapterRef.current = currentChapter;
    }, [currentChapter]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (!isPlaying) {
            saveProgress();
            setCurrentWordIndex(indexRef.current);
        } else {
            lastTimeRef.current = undefined;
            accumulatorRef.current = 0;
            requestRef.current = requestAnimationFrame(loop);
        }
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [isPlaying, saveProgress, loop]);

    // Spacebar to toggle play/pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault(); // Prevent scrolling
                setIsPlaying(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Auto-save progress every 5 seconds while playing
    useEffect(() => {
        if (!isPlaying) return;
        const interval = setInterval(() => {
            saveProgress();
        }, 5000);
        return () => clearInterval(interval);
    }, [isPlaying, saveProgress]);

    // Save on unmount
    useEffect(() => {
        return () => {
            saveProgress();
        };
    }, [saveProgress]);

    // Load initial state & Subscribe to chapters
    useEffect(() => {
        let sub: { unsubscribe: () => void };
        const loadState = async () => {
            setLoading(true);
            const db = await initDB();

            // Subscribe to chapters
            sub = db.chapters.find({
                selector: { bookId: book.id },
                sort: [{ index: 'asc' }]
            }).$.subscribe(docs => {
                setChapters(docs.map(d => d.toJSON() as ChapterDocType));
            });

            // Get reading state
            let state = await db.reading_states.findOne(book.id).exec();
            if (!state) {
                // Create default state if missing
                state = await db.reading_states.insert({
                    bookId: book.id,
                    currentChapterId: book.chapterIds[0],
                    currentWordIndex: 0,
                    lastRead: Date.now(),
                    highlights: []
                });
            }

            const stateDoc = state.toJSON() as ReadingStateDocType;
            setReadingState(stateDoc);

            // Load chapter
            if (stateDoc.currentChapterId) {
                loadChapter(stateDoc.currentChapterId, stateDoc.currentWordIndex);
            } else {
                setLoading(false);
            }
        };
        loadState();
        return () => {
            if (sub) sub.unsubscribe();
        };
    }, [book.id, book.chapterIds, loadChapter]);

    // Live update sidebar for processing chapters
    useEffect(() => {
        const hasProcessing = chapters.some(c => c.status === 'processing');
        if (hasProcessing) {
            const interval = setInterval(() => {
                setNow(Date.now());
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [chapters]);

    // Trigger background processing when book is opened
    // This ensures density/summary tasks are processed even for previously ingested books
    useEffect(() => {
        processChaptersInBackground(book.id).catch(console.error);
    }, [book.id]);

    // Effect to render word when chapter or index changes, ensuring ref is available
    useEffect(() => {
        if (!loading && currentChapter && wordsRef.current.length > 0) {
            renderWord(currentWordIndex, wordsRef.current);
        }
    }, [loading, currentChapter, currentWordIndex, renderWord]);

    if (loading && !currentChapter) {
        return <div className="flex items-center justify-center h-full font-mono text-dune-gold animate-pulse">INITIALIZING COCKPIT...</div>;
    }

    // Calculate Subchapter Progress
    const currentSubchapter = currentChapter?.subchapters?.find(s => currentWordIndex >= s.startWordIndex && currentWordIndex < s.endWordIndex);
    let subchapterProgress = 0;
    let timeLeftStr = '';
    
    if (currentSubchapter) {
        const total = currentSubchapter.endWordIndex - currentSubchapter.startWordIndex;
        const current = currentWordIndex - currentSubchapter.startWordIndex;
        subchapterProgress = Math.min(1, Math.max(0, current / total));

        const wordsLeft = currentSubchapter.endWordIndex - currentWordIndex;
        const minutesLeft = wordsLeft / wpm;
        timeLeftStr = minutesLeft < 1 ? '< 1m' : `${Math.round(minutesLeft)}m`;
    }

    // WPM Dial Logic
    const dialColor = wpm < 300 ? 'text-blue-400' : wpm < 500 ? 'text-dune-gold' : 'text-red-500';
    const dialGlow = isHoveringDial ? 'drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]' : 'opacity-30 hover:opacity-100';

    // Calculate word to render for React (to avoid stale content on re-renders)
    // When playing, the loop updates the DOM directly.
    // When paused or when state changes (like isSummaryActive), React re-renders.
    // We need to ensure React renders the correct word so it doesn't overwrite the loop's work with stale data.
    const wordToRender = isSummaryActive 
        ? (summaryWordsRef.current[indexRef.current] || '')
        : (wordsRef.current[currentWordIndex] || '');

    return (
        <div className="relative w-full h-screen bg-basalt text-white overflow-hidden flex">
            {/* Floating Header / Controls */}
            <div className="absolute top-0 left-0 right-0 z-[60] p-4 flex justify-between items-start pointer-events-none">
                {/* Menu Button */}
                <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className="pointer-events-auto p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-dune-gold hover:bg-white/10 transition-colors shadow-lg"
                    title="Chapters"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {showSidebar ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                    </svg>
                </button>

                {/* Chapter Title (Centered) */}
                <div className="mt-2 px-6 py-2 bg-black/20 backdrop-blur-sm rounded-full border border-white/5 shadow-lg">
                    <h3 className="font-mono text-xs text-gray-400 tracking-widest uppercase">{currentChapter?.title}</h3>
                </div>

                {/* Settings Button */}
                <button data-testid="settings-button" onClick={onOpenSettings}
                    className="pointer-events-auto p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-dune-gold hover:bg-white/10 transition-colors shadow-lg"
                    title="Settings"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            </div>

            {/* Sidebar (Chapters) */}
            <div
                data-testid="sidebar-container"
                className={`fixed inset-y-0 left-0 z-50 w-80 bg-basalt border-r border-white/10 transform transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ willChange: 'transform' }}
            >
                <Sidebar
                    chapters={chapters}
                    currentChapter={currentChapter}
                    onLoadChapter={(id, index) => {
                        loadChapter(id, index || 0);
                        setShowSidebar(false);
                    }}
                    onInspectChapter={(chapter) => setInspectingChapterId(chapter.id)}
                    wpm={wpm}
                    currentWordIndex={currentWordIndex}
                    now={now}
                />
            </div>

            {/* Backdrop for sidebar - Removed to prevent blocking view */}

            {/* Main Reader Area (Full Screen) */}
            <div
                className={`flex-1 h-full relative flex flex-col min-w-0 transition-all duration-300 ${showSidebar ? 'ml-80' : 'ml-0'}`}
                style={{ marginLeft: showSidebar ? '20rem' : '0' }}
            >
                <div className="w-full h-full flex flex-col relative group">

                    {/* Top Zone: Previous Context */}
                    <div className="flex-1 w-full overflow-hidden relative mask-gradient-top flex justify-center">
                        <div ref={prevContainerRef} className="w-full max-w-2xl h-full flex flex-wrap content-end justify-start p-8 md:p-16 font-mono text-lg md:text-xl leading-relaxed select-none overflow-hidden" onClick={handleRiverClick}></div>
                    </div>

                    {/* Middle Zone: RSVP (Click to Toggle) */}
                    <div
                        data-testid="rsvp-container"
                        className="relative h-48 w-full flex items-center justify-center bg-black/20 border-y border-white/5 z-30 cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() => setIsPlaying(!isPlayingRef.current)}
                    >
                        {/* Bionic Word */}
                        <div ref={rsvpRef} className={`text-6xl md:text-8xl font-mono tracking-tight whitespace-nowrap drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] ${isSummaryActive ? 'text-amber-400 italic' : 'text-white'}`}>
                            {wordToRender && (
                                <span dangerouslySetInnerHTML={{ __html: getBionicGradientHtml(wordToRender) }} />
                            )}
                        </div>

                        {/* Subchapter Progress Lights */}
                        {currentSubchapter && (
                            <div className="absolute bottom-6 flex flex-col items-center gap-2 pointer-events-none">
                                <div className="flex gap-3">
                                    {[...Array(5)].map((_, i) => {
                                        const isLit = subchapterProgress >= (i / 5);
                                        return (
                                            <div
                                                key={i}
                                                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isLit ? 'bg-dune-gold shadow-[0_0_8px_var(--color-dune-gold)]' : 'bg-white/10'}`}
                                            />
                                        );
                                    })}
                                </div>
                                <div className="text-[10px] font-mono text-white/30 tracking-widest uppercase animate-pulse">
                                    {timeLeftStr} REMAINING
                                </div>
                            </div>
                        )}

                        {/* Play/Pause Overlay */}
                        {!isPlaying && (
                            <div data-testid="play-overlay" className="absolute inset-0 flex items-center justify-center pointer-events-none animate-in fade-in duration-200">
                                <div className="bg-black/40 backdrop-blur-sm p-6 rounded-full border border-white/10 shadow-2xl">
                                    <svg className="w-12 h-12 text-white/80 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Bottom Zone: Next Context */}
                    <div className="flex-1 w-full overflow-hidden relative mask-gradient-bottom flex justify-center">
                        <div ref={nextContainerRef} className="w-full max-w-2xl h-full flex flex-wrap content-start justify-start p-8 md:p-16 font-mono text-lg md:text-xl leading-relaxed select-none overflow-hidden" onClick={handleRiverClick}></div>
                    </div>

                    {/* Scroll Zones */}
                    <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-12 z-40 opacity-30 hover:opacity-100 transition-opacity flex items-center justify-center cursor-n-resize bg-gradient-to-b from-black/80 to-transparent pointer-events-auto group/scroll"
                        onMouseEnter={() => startScrolling('back')}
                        onMouseLeave={stopScrolling}
                    >
                        <svg className="w-6 h-6 text-white/50 group-hover/scroll:text-white transition-colors animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                    </div>
                    <div
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-12 z-40 opacity-30 hover:opacity-100 transition-opacity flex items-center justify-center cursor-s-resize bg-gradient-to-t from-black/80 to-transparent pointer-events-auto group/scroll"
                        onMouseEnter={() => startScrolling('fwd')}
                        onMouseLeave={stopScrolling}
                    >
                        <svg className="w-6 h-6 text-white/50 group-hover/scroll:text-white transition-colors animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>

                </div>
            </div>

            {/* WPM Dial Overlay */}
            <div 
                className={`absolute bottom-8 right-8 z-[70] flex flex-col items-center transition-all duration-500 ${dialGlow}`}
                onMouseEnter={() => setIsHoveringDial(true)}
                onMouseLeave={() => setIsHoveringDial(false)}
            >
                <div className="relative w-24 h-24 flex items-center justify-center">
                    {/* Dial Ring */}
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/10" />
                        <circle 
                            cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" 
                            className={`${dialColor} transition-all duration-300`}
                            strokeDasharray="283"
                            strokeDashoffset={283 - (283 * (wpm / 1000))}
                        />
                    </svg>
                    
                    {/* Value Display */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-2xl font-mono font-bold ${dialColor}`}>{wpm}</span>
                        <span className="text-[8px] text-gray-500 tracking-widest">WPM</span>
                    </div>

                    {/* Invisible Range Input for Interaction */}
                    <input 
                        type="range" 
                        min="100" max="1000" step="10"
                        value={wpm}
                        onChange={(e) => setWpm(parseInt(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
                        title="Adjust Speed"
                    />
                </div>
            </div>

            {/* Inspection Modal */}
            {inspectingChapter && (
                <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 md:p-12">
                    <div className="bg-basalt w-full h-full max-w-4xl rounded-lg border border-magma-vent/30 flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                        <div className="flex justify-between items-center p-4 border-b border-white/10">
                            <h2 className="font-mono text-xl font-bold text-dune-gold tracking-widest uppercase">{inspectingChapter.title} // DENSITY_MAP</h2>
                            <button
                                onClick={() => setInspectingChapterId(null)}
                                className="text-gray-400 hover:text-magma-vent transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 font-mono text-lg leading-relaxed selection:bg-magma-vent selection:text-white">
                            {inspectingChapter.content.map((word, i) => {
                                const density = inspectingChapter.densities?.[i] || 1.0;
                                const analysis = inspectingChapter.analysisData?.[i];
                                
                                let title = `Density: ${density}`;
                                if (analysis && analysis.tokens && analysis.tokens.length > 0) {
                                    const tokensStr = analysis.tokens.map(t => `"${t}"`).join(', ');
                                    const surpStr = analysis.surprisals.map(s => s?.toFixed(2)).join(', ');
                                    const totalSurp = analysis.surprisals.reduce((a, b) => a + (b || 0), 0).toFixed(2);
                                    title = `Word: "${word}"\nTokens: [${tokensStr}]\nSurprisals: [${surpStr}]\nTotal Surprisal: ${totalSurp}\nDensity Factor: ${density}`;
                                }

                                return (
                                    <span key={i} className={`${getDensityColor(density)} inline-block mr-1.5 mb-1 transition-colors hover:text-white cursor-crosshair`} title={title}>
                                        {word}
                                    </span>
                                );
                            })}
                        </div>
                        <div className="p-4 border-t border-white/10 flex gap-6 text-xs font-mono flex-wrap uppercase tracking-wider bg-black/20">
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-400 rounded-full"></span> Fast (&lt;0.8)</div>
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-gray-400 rounded-full"></span> Normal</div>
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-yellow-500 rounded-full"></span> Slow (1.2-1.5)</div>
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span> Profound (&gt;2.0)</div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
