import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Moon, Sun } from 'lucide-react';
import { type BookDocType, type ChapterDocType, type ReadingStateDocType, type GlobalSummaryType, initDB } from '../../core/sync/db';
import { getDisplayPlugin, type DisplayPlugin, getVelocireaderORPIndex } from '../../core/rsvp/display';
import { getVisualProcessingDelay, getSpeedFactor } from '../../core/rsvp/timing';
import { getTokenDisplayProps, isReferenceToken, splitLongWordForRSVP } from '../../core/rsvp/tokenize';
import { Sidebar } from './Sidebar';
import { TTSPlayer } from './TTSPlayer';
import {
    clampLensScale,
    getTouchDistance,
    getWheelPinchDelta,
    LENS_SCALE_DEFAULT,
    mergeTransformWithScale,
} from './lensGestures';
import { useSettingsStore } from '../../core/store/settings';
import { useTTSStore } from '../../core/store/tts';
import { useFullscreen } from '../../hooks/useFullscreen';
import { findNextReadableChapter, getGlobalWordIndex, isReadableChapter } from './readerNavigation';

import { scheduler } from '../../core/ingest/scheduler';
import { processChaptersInBackground, resumeIncompleteAnalysis } from '../../core/ingest/pipeline';

interface ReaderProps {
    book: BookDocType;
    onBack?: () => void;
}

const getDensityColor = (score: number) => {
    if (score === 0) return 'text-gray-700 opacity-50'; // Pending
    if (score <= 0.6) return 'text-blue-400'; // Fast
    if (score <= 0.8) return 'text-blue-300'; // Brisk
    if (score <= 1.0) return 'text-gray-400'; // Normal
    if (score <= 1.2) return 'text-yellow-200'; // Deliberate
    if (score <= 1.5) return 'text-yellow-500'; // Slow
    if (score <= 2.0) return 'text-orange-500'; // Very Slow
    return 'text-white font-bold'; // Profound
};

const COMPACT_LANDSCAPE_MEDIA_QUERY = '(orientation: landscape) and (max-height: 640px)';
const LONG_WORD_SPLIT_MIN_LENGTH = 12;
const LONG_WORD_SPLIT_SEGMENT_LENGTH = 8;
const TOUCH_TAP_MAX_MOVEMENT_PX = 10;
const TOUCH_WORD_STEP_PX = 28;
const RIVER_SCROLL_CLICK_SUPPRESSION_MS = 180;
const CHAPTER_DRAWER_SWIPE_CLOSE_DISTANCE_PX = 72;
const CHAPTER_DRAWER_SWIPE_MAX_VERTICAL_PX = 56;

export const Reader: React.FC<ReaderProps> = ({ book, onBack }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [fullscreenTarget, setFullscreenTarget] = useState<HTMLDivElement | null>(null);
    const [fullscreenHint, setFullscreenHint] = useState<string | null>(null);
    const [isCompactLandscape, setIsCompactLandscape] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(COMPACT_LANDSCAPE_MEDIA_QUERY).matches;
    });
    const [lensScale, setLensScale] = useState(LENS_SCALE_DEFAULT);
    
    // Use individual selectors for all settings to minimize re-renders
    const wpm = useSettingsStore((s) => s.wpm);
    const setWpm = useSettingsStore((s) => s.setWpm);
    const summaryWpm = useSettingsStore((s) => s.summaryWpm);
    const displayPluginId = useSettingsStore((s) => s.displayPlugin);
    const theme = useSettingsStore((s) => s.theme);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const isDayTheme = theme === 'day' || theme === 'dunes';
    
    // River (context panel) toggles - use selectors for performance
    const riverTopEnabled = useSettingsStore((s) => s.riverTopEnabled);
    const riverBottomEnabled = useSettingsStore((s) => s.riverBottomEnabled);
    const setRiverTopEnabled = useSettingsStore((s) => s.setRiverTopEnabled);
    const setRiverBottomEnabled = useSettingsStore((s) => s.setRiverBottomEnabled);
    
    // Focus mode - hides rivers and sidebars for distraction-free reading
    const focusModeEnabled = useSettingsStore((s) => s.focusModeEnabled);
    const setFocusModeEnabled = useSettingsStore((s) => s.setFocusModeEnabled);
    const setNavSidebarCollapsed = useSettingsStore((s) => s.setNavSidebarCollapsed);
    
    // Ref to store previous state before entering focus mode
    const preFocusStateRef = useRef<{
        riverTop: boolean;
        riverBottom: boolean;
        showChapters: boolean;
        showTTSPlayer: boolean;
    } | null>(null);
    
    // AI toggle - disable AI features to save battery
    const aiEnabled = useSettingsStore((s) => s.aiEnabled);
    const setAiEnabled = useSettingsStore((s) => s.setAiEnabled);
    
    // Get the active display plugin
    const displayPlugin = useMemo(() => getDisplayPlugin(displayPluginId), [displayPluginId]);
    const displayPluginRef = useRef<DisplayPlugin>(displayPlugin);
    
    // Keep plugin ref in sync
    useEffect(() => {
        displayPluginRef.current = displayPlugin;
    }, [displayPlugin]);

    // Actual WPM tracking (words displayed in last 60 seconds)
    const wordTimestampsRef = useRef<number[]>([]);
    const [actualWpm, setActualWpm] = useState(0);

    // Active reading time accumulator (to handle pauses correctly)
    const processTimeRef = useRef(0);

    // Speed control momentum (exponential decay integration)
    // Each press adds to accumulated intensity, which decays over time
    const speedMomentumRef = useRef<{ lastPress: number; intensity: number }>({ lastPress: 0, intensity: 0 });

    // State for current chapter and reading position
    const [currentChapter, setCurrentChapter] = useState<ChapterDocType | null>(null);
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [readingState, setReadingState] = useState<ReadingStateDocType | null>(null);
    const [loading, setLoading] = useState(true);

    // Sidebar & Chapters
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [globalSummaries, setGlobalSummaries] = useState<GlobalSummaryType[]>([]);
    const [showChapters, setShowChapters] = useState(() => (
        typeof window === 'undefined' || window.innerWidth >= 768
    ));
    const [inspectingChapterId, setInspectingChapterId] = useState<string | null>(null);
    const inspectingChapter = chapters.find(c => c.id === inspectingChapterId);
    const [now, setNow] = useState(Date.now()); // Force re-render for live time updates

    // TTS State
    const [showTTSPlayer, setShowTTSPlayer] = useState(false);
    const ttsPlaybackState = useTTSStore((s) => s.playbackState);

    const { isFullscreen, isFullscreenSupported, toggleFullscreen } = useFullscreen(fullscreenTarget);

    const prevContainerRef = useRef<HTMLDivElement>(null);
    const nextContainerRef = useRef<HTMLDivElement>(null);
    const rsvpRef = useRef<HTMLDivElement>(null);
    
    // Track if initial render has been done (to trigger full render once all refs are mounted)
    const initialRenderDoneRef = useRef(false);
    // Tracks which book.id has had its initial reading-state load applied. Prevents the
    // mount effect from re-invoking loadChapter() with a stale (up-to-5s-old) saved
    // currentWordIndex when its deps change mid-playback, which would rewind by a
    // sentence/paragraph until playback caught back up.
    const initialLoadAppliedForBookRef = useRef<string | null>(null);
    const waitingForReadableChapterRef = useRef(false);
    
    const requestRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    const isCompactLandscapeRef = useRef(isCompactLandscape);
    const lensScaleRef = useRef(lensScale);
    const pinchGestureRef = useRef<{ distance: number; scale: number } | null>(null);
    const suppressNextRsvpTapRef = useRef(false);
    const rsvpTapStartRef = useRef<{ x: number; y: number } | null>(null);
    const rsvpTapMovedRef = useRef(false);
    const riverLastScrollAtRef = useRef(0);
    const chapterDrawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
    const chapterDrawerSwipeDeltaRef = useRef(0);
    const chapterDrawerSwipeActiveRef = useRef(false);
    const currentWordSegmentsRef = useRef<string[]>([]);
    const currentSegmentIndexRef = useRef(0);
    const segmentedWordSourceRef = useRef('');

    const syncSchedulerCursor = useCallback((chapterId: string, wordIndex: number) => {
        scheduler.setCursor(
            book.id,
            chapterId,
            wordIndex,
            getGlobalWordIndex(chaptersRef.current, chapterId, wordIndex),
        );
    }, [book.id]);

    // Summary Mode Refs
    const [isSummaryActive, setIsSummaryActive] = useState(false);
    const [activeGlobalSummaryId, setActiveGlobalSummaryId] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [transitionLabel, setTransitionLabel] = useState<string | null>(null); // To show "Chunk Summary:" or "Resuming Text:"
    const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const isSummaryActiveRef = useRef(false);
    const savedChapterIndexRef = useRef(0);
    const summaryWordsRef = useRef<string[]>([]);
    // Track the last boundary we triggered to prevent re-triggering on restore
    const lastTriggeredBoundaryRef = useRef<number>(-1);

    useEffect(() => {
        isCompactLandscapeRef.current = isCompactLandscape;
    }, [isCompactLandscape]);

    useEffect(() => {
        lensScaleRef.current = lensScale;
    }, [lensScale]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        const mediaQuery = window.matchMedia(COMPACT_LANDSCAPE_MEDIA_QUERY);
        const onChange = (event: MediaQueryListEvent) => {
            setIsCompactLandscape(event.matches);
        };

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onChange);
            return () => mediaQuery.removeEventListener('change', onChange);
        }

        mediaQuery.addListener(onChange);
        return () => mediaQuery.removeListener(onChange);
    }, []);

    const getDisplaySegmentsForWord = useCallback((word: string): string[] => {
        if (!word) return [''];

        if (!isCompactLandscapeRef.current) {
            return [word];
        }

        const segments = splitLongWordForRSVP(word, {
            minLength: LONG_WORD_SPLIT_MIN_LENGTH,
            maxSegmentLength: LONG_WORD_SPLIT_SEGMENT_LENGTH,
            continuationMarker: '-',
        });

        return segments.length > 0 ? segments : [word];
    }, []);

    const resetDisplaySegments = useCallback((word: string): string => {
        segmentedWordSourceRef.current = word;
        currentWordSegmentsRef.current = getDisplaySegmentsForWord(word);
        currentSegmentIndexRef.current = 0;
        return currentWordSegmentsRef.current[0] ?? word;
    }, [getDisplaySegmentsForWord]);

    const getDisplayWordForCurrentSegment = useCallback((word: string): string => {
        if (
            segmentedWordSourceRef.current !== word ||
            currentWordSegmentsRef.current.length === 0
        ) {
            return resetDisplaySegments(word);
        }

        const safeIndex = Math.min(
            currentSegmentIndexRef.current,
            Math.max(0, currentWordSegmentsRef.current.length - 1),
        );
        return currentWordSegmentsRef.current[safeIndex] ?? word;
    }, [resetDisplaySegments]);

    const updateLensScale = useCallback((updater: number | ((current: number) => number)) => {
        setLensScale((previous) => {
            const next = typeof updater === 'function' ? updater(previous) : updater;
            return clampLensScale(next);
        });
    }, []);

    const applyLensScaleToElement = useCallback((element: HTMLDivElement) => {
        element.style.transform = mergeTransformWithScale(element.style.transform, lensScaleRef.current);
        element.style.transformOrigin = 'center center';
    }, []);
    
    // Define renderWord early, before it's used in startTransition or other callbacks
    // Performance: renderContext=false skips the expensive prev/next context panel updates
    const renderWord = useCallback((idx: number, words: string[], renderContext: boolean = true, displayWordOverride?: string) => {
        const plugin = displayPluginRef.current;
        
        // Update RSVP Display
        if (rsvpRef.current) {
            const currentWord = displayWordOverride ?? words[idx];
            if (currentWord) {
                const referenceWord = isReferenceToken(currentWord);

                if (referenceWord) {
                    rsvpRef.current.innerHTML = '<span class="uppercase tracking-[0.35em] text-sm md:text-base font-semibold text-gray-400">REF</span>';
                } else {
                    // Use the active display plugin for rendering
                    rsvpRef.current.innerHTML = plugin.renderWord(currentWord);
                }
                
                // Reset common style properties potentially set by other plugins
                rsvpRef.current.style.transform = '';
                rsvpRef.current.style.marginLeft = '';
                rsvpRef.current.style.paddingLeft = '';
                rsvpRef.current.style.fontFamily = '';
                rsvpRef.current.style.width = '';
                rsvpRef.current.style.textAlign = '';

                if (referenceWord) {
                    rsvpRef.current.style.letterSpacing = '';
                }

                // Apply plugin-specific container styling
                if (!referenceWord) {
                    const containerStyle = plugin.getContainerStyle?.(currentWord);
                    if (containerStyle) {
                        Object.assign(rsvpRef.current.style, containerStyle);
                    }
                }

                applyLensScaleToElement(rsvpRef.current);
            }
        }

        // Render Previous Context (Last ~150 words for better vertical fill)
        // Performance: Skip when renderContext=false (during rapid playback) or riverTopEnabled=false
        if (renderContext && riverTopEnabled && prevContainerRef.current) {
            const start = Math.max(0, idx - 150);
            const end = idx;
            const prevWords = words.slice(start, end);
            const html = prevWords.map((w, i) => {
                const actualIndex = start + i;
                
                // Gradient Bolding Logic
                const orp = getVelocireaderORPIndex(w);
                let innerHtml = '';
                for (let j = 0; j < w.length; j++) {
                    const d = Math.abs(j - orp);
                    let c = 'font-light opacity-60 group-hover:opacity-100';
                    if (d === 0) c = 'font-extrabold opacity-100';
                    // Neighbors: Medium weight (less than bold), slightly reduced opacity
                    else if (d === 1) c = 'font-medium opacity-80 group-hover:opacity-100';
                    innerHtml += `<span class="${c}">${w[j]}</span>`;
                }
                
                // Add line break after punctuation to simulate structure
                const isEnd = /[.!?]$/.test(w);
                const breakHtml = isEnd ? '<div class="w-full h-2"></div>' : '';

                const density = densitiesRef.current[actualIndex] || 1.0;
                const colorClass = getDensityColor(density);

                return `
                    <span 
                        class="word-span group inline-block mr-1.5 mb-1 transition-all duration-300 cursor-pointer ${colorClass} hover:text-white"
                        data-index="${actualIndex}"
                    >
                        ${innerHtml}
                    </span>
                    ${breakHtml}
                `;
            }).join('');
            prevContainerRef.current.innerHTML = html;
            // Scroll to bottom
            prevContainerRef.current.scrollTop = prevContainerRef.current.scrollHeight;
        }

        // Render Next Context (Next ~150 words)
        // Performance: Skip when renderContext=false (during rapid playback) or riverBottomEnabled=false
        if (renderContext && riverBottomEnabled && nextContainerRef.current) {
            const start = idx + 1;
            const end = Math.min(words.length, idx + 151);
            const nextWords = words.slice(start, end);
            const html = nextWords.map((w, i) => {
                const actualIndex = start + i;
                
                // Gradient Bolding Logic
                const orp = getVelocireaderORPIndex(w);
                let innerHtml = '';
                for (let j = 0; j < w.length; j++) {
                    const d = Math.abs(j - orp);
                    let c = 'font-light opacity-60 group-hover:opacity-100';
                    if (d === 0) c = 'font-extrabold opacity-100';
                    // Neighbors: Medium weight (less than bold), slightly reduced opacity
                    else if (d === 1) c = 'font-medium opacity-80 group-hover:opacity-100';
                    innerHtml += `<span class="${c}">${w[j]}</span>`;
                }
                
                const isEnd = /[.!?]$/.test(w);
                const breakHtml = isEnd ? '<div class="w-full h-2"></div>' : '';

                const density = densitiesRef.current[actualIndex] || 1.0;
                const colorClass = getDensityColor(density);

                return `
                    <span 
                        class="word-span group inline-block mr-1.5 mb-1 transition-all duration-300 cursor-pointer ${colorClass} hover:text-white"
                        data-index="${actualIndex}"
                    >
                        ${innerHtml}
                    </span>
                    ${breakHtml}
                `;
            }).join('');
            nextContainerRef.current.innerHTML = html;
            // Scroll to top (default)
        }
    }, [riverTopEnabled, riverBottomEnabled, applyLensScaleToElement]);

    useEffect(() => {
        if (!rsvpRef.current) return;
        applyLensScaleToElement(rsvpRef.current);
    }, [lensScale, applyLensScaleToElement]);

    // Clear river content when disabled
    useEffect(() => {
        if (!riverTopEnabled && prevContainerRef.current) {
            prevContainerRef.current.innerHTML = '';
        }
    }, [riverTopEnabled]);

    useEffect(() => {
        if (!riverBottomEnabled && nextContainerRef.current) {
            nextContainerRef.current.innerHTML = '';
        }
    }, [riverBottomEnabled]);

    useEffect(() => {
        if (!fullscreenHint) return;
        const timeout = setTimeout(() => setFullscreenHint(null), 3200);
        return () => clearTimeout(timeout);
    }, [fullscreenHint]);

    const handleToggleFullscreen = useCallback(async () => {
        const didToggle = await toggleFullscreen();
        if (didToggle) {
            setFullscreenHint(null);
            return;
        }

        if (isFullscreenSupported) {
            setFullscreenHint('Fullscreen was blocked. Tap again after interacting with the page.');
        } else {
            setFullscreenHint('For true edge-to-edge on this browser, install the app to your home screen.');
        }
    }, [isFullscreenSupported, toggleFullscreen]);

    const startTransition = useCallback((label: string, onComplete: () => void) => {
        // Stop playback immediately
        setIsPlaying(false);
        isPlayingRef.current = false;
        
        // Open sidebar to show context
        setShowChapters(true);

        // Clear RSVP display
        if (rsvpRef.current) {
            rsvpRef.current.innerHTML = '';
        }
        
        let count = 3;
        setCountdown(count);
        setTransitionLabel(label);
        
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        
        countdownIntervalRef.current = setInterval(() => {
            count--;
            if (count > 0) {
                setCountdown(count);
            } else {
                if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
                setCountdown(null);
                setTransitionLabel(null);
                onComplete();
                // Resume playback
                setIsPlaying(true); 
            }
        }, 1000);
    }, [setIsPlaying, setCountdown, setTransitionLabel, setShowChapters]);

    const handleSkipSummary = useCallback(() => {
        // Clear countdown if running
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        setCountdown(null);
        setTransitionLabel(null);

        // Logic to skip directly to post-summary state
        if (isSummaryActiveRef.current || countdown) {
            // Restore from summary mode
            isSummaryActiveRef.current = false;
            setIsSummaryActive(false);
            setActiveGlobalSummaryId(null);

            // Restore index
            indexRef.current = savedChapterIndexRef.current;
            wpmRef.current = wpm; // Restore user WPM
            
            // Render correct word
            const displayWord = resetDisplaySegments(wordsRef.current[indexRef.current] || '');
            renderWord(indexRef.current, wordsRef.current, true, displayWord);
            setCurrentWordIndex(indexRef.current);
            
            // Resume if we were playing, or just ready up
            accumulatorRef.current = 0;
            setIsPlaying(true);
        }
    }, [wpm, renderWord, countdown, setIsPlaying, setCountdown, setTransitionLabel, resetDisplaySegments]);

    const handlePlayGlobalSummary = useCallback((summary: GlobalSummaryType) => {
        // Stop current playback
        setIsPlaying(false);
        
        // Save current position if not already in summary mode
        if (!isSummaryActiveRef.current) {
            savedChapterIndexRef.current = indexRef.current;
        }
        
        // Set up summary playback
        summaryWordsRef.current = summary.summary.split(' ');
        isSummaryActiveRef.current = true;
        setIsSummaryActive(true);
        setActiveGlobalSummaryId(summary.id);
        indexRef.current = 0;
        wpmRef.current = summaryWpm;
        
        // Render the first word
        const displayWord = resetDisplaySegments(summaryWordsRef.current[0] || '');
        renderWord(0, summaryWordsRef.current, true, displayWord);
        
        // Close sidebar and start playing
        setShowChapters(false);
        accumulatorRef.current = 0;
        setIsPlaying(true);
    }, [summaryWpm, renderWord, setIsPlaying, setShowChapters, resetDisplaySegments]);

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

            if (!isReadableChapter(chapterDoc)) {
                return;
            }

            if (isFirstEmission) {
                isFirstEmission = false;
                setCurrentChapter(chapterDoc);
                wordsRef.current = chapterDoc.content;
                densitiesRef.current = chapterDoc.densities || [];

                indexRef.current = initialIndex;
                setCurrentWordIndex(initialIndex);
                resetDisplaySegments(wordsRef.current[initialIndex] || '');
                // Reset boundary tracking for new chapter
                lastTriggeredBoundaryRef.current = -1;
                // Don't call renderWord here - refs may not be mounted yet
                // The useLayoutEffect will call renderWord once React has rendered the DOM
                setLoading(false);
                // Reset initial render flag so effects can trigger fresh render
                initialRenderDoneRef.current = false;
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
                // Live update - ONLY update refs to avoid re-render stutter during playback
                // The playback loop reads from refs, so this is sufficient.
                // We intentionally do NOT call setCurrentChapter or renderWord here
                // to prevent flickering/stuttering during LLM density updates.
                
                // Update words ref only if content actually changed (rare, but possible)
                if (chapterDoc.content.length !== wordsRef.current.length) {
                    wordsRef.current = chapterDoc.content;
                }
                
                // Always update densities - this is the main thing that changes during processing
                densitiesRef.current = chapterDoc.densities || [];
                
                // Update currentChapterRef for subchapter boundary checks (without triggering re-render)
                currentChapterRef.current = chapterDoc;
                
                // Only re-render context windows if NOT playing (user is paused and wants to see updates)
                if (!isPlayingRef.current) {
                    setCurrentChapter(chapterDoc);
                    const displayWord = resetDisplaySegments(wordsRef.current[indexRef.current] || '');
                    renderWord(indexRef.current, wordsRef.current, true, displayWord);
                }
            }
        });
    }, [renderWord, book.id, resetDisplaySegments]);

    const moveToWord = useCallback((wordIndex: number) => {
        const nextIndex = Math.max(0, Math.min(wordsRef.current.length - 1, wordIndex));
        if (nextIndex === indexRef.current) return;

        indexRef.current = nextIndex;
        setCurrentWordIndex(nextIndex);
        const displayWord = resetDisplaySegments(wordsRef.current[nextIndex] || '');
        renderWord(nextIndex, wordsRef.current, true, displayWord);
    }, [renderWord, resetDisplaySegments]);

    // Wheel/touchpad scroll handler for navigating through words.
    // This is intentionally used only on the center RSVP lane.
    const handleWordNavigationWheel = useCallback((e: React.WheelEvent) => {
        // Prevent default page scroll
        e.preventDefault();
        
        // Stop playback when user scrolls
        if (isPlayingRef.current) {
            setIsPlaying(false);
        }
        
        // Calculate scroll amount - normalize for different input devices
        // deltaY is positive for scroll down (forward), negative for scroll up (back)
        const delta = e.deltaY;
        
        // Use deltaMode to handle different scroll units
        // 0 = pixels, 1 = lines, 2 = pages
        let scrollAmount: number;
        if (e.deltaMode === 1) {
            // Line mode (some mice)
            scrollAmount = Math.sign(delta) * Math.ceil(Math.abs(delta));
        } else if (e.deltaMode === 2) {
            // Page mode
            scrollAmount = Math.sign(delta) * 10;
        } else {
            // Pixel mode (trackpad, most common)
            // Scale down for smooth scrolling - ~50 pixels = 1 word
            scrollAmount = Math.sign(delta) * Math.ceil(Math.abs(delta) / 50);
        }
        
        // Clamp to reasonable range
        scrollAmount = Math.max(-20, Math.min(20, scrollAmount));
        
        if (scrollAmount === 0) return;
        
        moveToWord(indexRef.current + scrollAmount);
    }, [moveToWord, setIsPlaying]);

    const handleRsvpWheel = useCallback((e: React.WheelEvent) => {
        // Trackpad pinch is typically exposed as wheel + ctrlKey in Chromium/WebKit.
        if (e.ctrlKey) {
            e.preventDefault();

            const pinchDelta = getWheelPinchDelta(e.deltaY);
            updateLensScale((previous) => previous + pinchDelta);
            return;
        }

        handleWordNavigationWheel(e);
    }, [handleWordNavigationWheel, updateLensScale]);

    const handleRsvpTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            rsvpTapStartRef.current = { x: touch.clientX, y: touch.clientY };
            rsvpTapMovedRef.current = false;
            return;
        }

        if (e.touches.length !== 2) return;

        const [firstTouch, secondTouch] = [e.touches[0], e.touches[1]];
        pinchGestureRef.current = {
            distance: getTouchDistance(firstTouch, secondTouch),
            scale: lensScaleRef.current,
        };
        suppressNextRsvpTapRef.current = true;
    }, []);

    const handleRsvpTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 1 && rsvpTapStartRef.current) {
            const touch = e.touches[0];
            const movement = Math.hypot(
                touch.clientX - rsvpTapStartRef.current.x,
                touch.clientY - rsvpTapStartRef.current.y,
            );

            if (movement > TOUCH_TAP_MAX_MOVEMENT_PX) {
                rsvpTapMovedRef.current = true;
                suppressNextRsvpTapRef.current = true;
            }
            return;
        }

        if (e.touches.length !== 2 || !pinchGestureRef.current) return;

        const [firstTouch, secondTouch] = [e.touches[0], e.touches[1]];
        const currentDistance = getTouchDistance(firstTouch, secondTouch);

        if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;

        e.preventDefault();
        const ratio = currentDistance / pinchGestureRef.current.distance;
        updateLensScale(pinchGestureRef.current.scale * ratio);
        suppressNextRsvpTapRef.current = true;
    }, [updateLensScale]);

    const handleRsvpTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const wasPinching = pinchGestureRef.current !== null;
        if (e.touches.length < 2) {
            pinchGestureRef.current = null;
        }

        if (e.touches.length === 0) {
            const start = rsvpTapStartRef.current;
            const end = e.changedTouches[0];

            if (!wasPinching && start && end && rsvpTapMovedRef.current) {
                const deltaX = end.clientX - start.x;
                const deltaY = end.clientY - start.y;

                if (Math.abs(deltaY) > Math.abs(deltaX)) {
                    if (isPlayingRef.current) setIsPlaying(false);
                    const wordDelta = Math.sign(-deltaY) * Math.max(1, Math.round(Math.abs(deltaY) / TOUCH_WORD_STEP_PX));
                    moveToWord(indexRef.current + wordDelta);
                }
            }

            if (rsvpTapMovedRef.current) {
                suppressNextRsvpTapRef.current = true;
                window.setTimeout(() => {
                    suppressNextRsvpTapRef.current = false;
                }, 0);
            }

            rsvpTapStartRef.current = null;
            rsvpTapMovedRef.current = false;
        }
    }, [moveToWord]);

    const handleRsvpClick = useCallback(() => {
        if (suppressNextRsvpTapRef.current) {
            suppressNextRsvpTapRef.current = false;
            return;
        }

        setIsPlaying(!isPlayingRef.current);
    }, []);

    const handleRiverScroll = useCallback(() => {
        riverLastScrollAtRef.current = performance.now();
    }, []);

    const handleRiverClick = (e: React.MouseEvent) => {
        if (performance.now() - riverLastScrollAtRef.current < RIVER_SCROLL_CLICK_SUPPRESSION_MS) {
            return;
        }

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
                        // Jump to new word while preserving current playback state.
                        indexRef.current = newIndex;
                        setCurrentWordIndex(newIndex);
                        const displayWord = resetDisplaySegments(wordsRef.current[newIndex] || '');
                        renderWord(newIndex, wordsRef.current, true, displayWord);
                    }
                    saveProgress();
                }
            }
        }
    };

    const resetChapterDrawerSwipe = useCallback(() => {
        chapterDrawerTouchStartRef.current = null;
        chapterDrawerSwipeDeltaRef.current = 0;
        chapterDrawerSwipeActiveRef.current = false;
    }, []);

    const handleChapterDrawerTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!showChapters || e.touches.length !== 1) return;

        const touch = e.touches[0];
        chapterDrawerTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
        chapterDrawerSwipeDeltaRef.current = 0;
        chapterDrawerSwipeActiveRef.current = true;
    }, [showChapters]);

    const handleChapterDrawerTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (
            !chapterDrawerSwipeActiveRef.current ||
            !chapterDrawerTouchStartRef.current ||
            e.touches.length !== 1
        ) {
            return;
        }

        const touch = e.touches[0];
        const deltaX = touch.clientX - chapterDrawerTouchStartRef.current.x;
        const deltaY = touch.clientY - chapterDrawerTouchStartRef.current.y;

        if (Math.abs(deltaY) > CHAPTER_DRAWER_SWIPE_MAX_VERTICAL_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
            chapterDrawerSwipeActiveRef.current = false;
            return;
        }

        if (deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
            chapterDrawerSwipeDeltaRef.current = deltaX;
            e.preventDefault();
        }
    }, []);

    const handleChapterDrawerTouchEnd = useCallback(() => {
        const shouldClose =
            chapterDrawerSwipeActiveRef.current &&
            chapterDrawerSwipeDeltaRef.current >= CHAPTER_DRAWER_SWIPE_CLOSE_DISTANCE_PX;

        if (shouldClose) {
            setShowChapters(false);
        }

        resetChapterDrawerSwipe();
    }, [resetChapterDrawerSwipe]);

    // === BATTERY-OPTIMIZED PLAYBACK LOOP ===
    // Instead of polling at 60fps with rAF, we use setTimeout to sleep until
    // close to the next word, then use rAF for precise final timing.
    // This reduces CPU wake-ups from ~60/sec to ~5-10/sec (80-90% reduction).
    
    const calculateTargetInterval = useCallback((displayWord: string, densityFactor: number, isSegmentedToken: boolean) => {
        const speedFactor = getSpeedFactor(wpmRef.current);
        const baseInterval = 60000 / wpmRef.current;
        const tokenProps = getTokenDisplayProps(displayWord);

        const T_floor = 75 * speedFactor;
        const infoTime = baseInterval * densityFactor;
        const visualDelay = getVisualProcessingDelay(displayWord, speedFactor);

        if (!isSegmentedToken) {
            return (T_floor + infoTime + visualDelay) * tokenProps.displayTimeMultiplier;
        }

        // Segmented tokens need extra dwell for easier reconstruction of long words.
        const segmentedMultiplier = Math.max(1.15, tokenProps.displayTimeMultiplier);
        const segmentedBonusMs = 45 * speedFactor;

        return (T_floor + infoTime + visualDelay) * segmentedMultiplier + segmentedBonusMs;
    }, []);

    const loop = React.useCallback(function loopInternal(time: number) {
        if (!isPlayingRef.current) return;

        if (!lastTimeRef.current) lastTimeRef.current = time;
        const deltaTime = time - lastTimeRef.current;
        lastTimeRef.current = time;

        accumulatorRef.current += deltaTime;
        processTimeRef.current += deltaTime;

        const activeWords = isSummaryActiveRef.current ? summaryWordsRef.current : wordsRef.current;
        const activeDensities = isSummaryActiveRef.current ? [] : densitiesRef.current;

        const activeWord = activeWords[indexRef.current] || '';
        if (!activeWord) {
            setIsPlaying(false);
            return;
        }

        if (
            segmentedWordSourceRef.current !== activeWord ||
            currentWordSegmentsRef.current.length === 0
        ) {
            resetDisplaySegments(activeWord);
        }

        const segmentCount = currentWordSegmentsRef.current.length;
        const segmentIndex = Math.min(currentSegmentIndexRef.current, Math.max(0, segmentCount - 1));
        const displayWord = currentWordSegmentsRef.current[segmentIndex] || activeWord;

        const density = activeDensities[indexRef.current];
        const currentDensity = (density !== undefined && density > 0) ? density : 1.0;
        const densityFactor = segmentCount > 1 ? currentDensity / segmentCount : currentDensity;
        const targetInterval = calculateTargetInterval(displayWord, densityFactor, segmentCount > 1);

        // Cap accumulator to prevent huge jumps
        if (accumulatorRef.current > Math.max(1000, targetInterval * 10)) {
            accumulatorRef.current = targetInterval;
        }

        const timeRemaining = targetInterval - accumulatorRef.current;

        // If we have significant time remaining, use setTimeout to sleep
        // This is the key battery optimization - don't poll at 60fps!
        if (timeRemaining > 50) {
            // Sleep for most of the remaining time, leaving 40ms for rAF precision
            const sleepTime = Math.max(10, timeRemaining - 40);
            timeoutRef.current = setTimeout(() => {
                if (isPlayingRef.current) {
                    requestRef.current = requestAnimationFrame(loopInternal);
                }
            }, sleepTime);
            return;
        }

        // We're close to the target - process word advancement
        if (accumulatorRef.current >= targetInterval) {
            // If current long word is segmented, advance through its segments first.
            if (segmentCount > 1 && segmentIndex < segmentCount - 1) {
                currentSegmentIndexRef.current = segmentIndex + 1;
                accumulatorRef.current -= targetInterval;

                const nextDisplayWord = currentWordSegmentsRef.current[currentSegmentIndexRef.current] || activeWord;
                renderWord(indexRef.current, activeWords, false, nextDisplayWord);
                requestRef.current = requestAnimationFrame(loopInternal);
                return;
            }

            if (indexRef.current < activeWords.length - 1) {
                indexRef.current++;
                accumulatorRef.current -= targetInterval;

                if (
                    !isSummaryActiveRef.current &&
                    indexRef.current % 20 === 0 &&
                    currentChapterRef.current
                ) {
                    syncSchedulerCursor(currentChapterRef.current.id, indexRef.current);
                }

                // Track word timestamp for actual WPM calculation
                wordTimestampsRef.current.push(processTimeRef.current);

                // Check for Subchapter Boundary (only if NOT in summary mode)
                // Also skip if we already triggered this exact boundary (prevents loops)
                if (!isSummaryActiveRef.current) {
                    const sub = currentChapterRef.current?.subchapters?.find(
                        s => s.endWordIndex === indexRef.current && s.endWordIndex !== lastTriggeredBoundaryRef.current
                    );
                    if (sub && sub.summary) {
                        isPlayingRef.current = false;
                        lastTriggeredBoundaryRef.current = sub.endWordIndex;
                        
                        startTransition('next: summary', () => {
                            isSummaryActiveRef.current = true;
                            setIsSummaryActive(true);
                            savedChapterIndexRef.current = indexRef.current;
                            summaryWordsRef.current = sub.summary!.split(' ');
                            indexRef.current = 0;
                            wpmRef.current = summaryWpm;
                            const summaryDisplayWord = resetDisplaySegments(summaryWordsRef.current[0] || '');
                            renderWord(0, summaryWordsRef.current, true, summaryDisplayWord);
                            accumulatorRef.current = 0;
                        });
                        return;
                    }
                }

                // Render the new word
                const shouldRenderContext = indexRef.current % 3 === 0;
                const nextWord = activeWords[indexRef.current] || '';
                const nextDisplayWord = resetDisplaySegments(nextWord);
                renderWord(indexRef.current, activeWords, shouldRenderContext, nextDisplayWord);

            } else {
                // End of words
                if (isSummaryActiveRef.current) {
                    isPlayingRef.current = false;
                    
                    startTransition('next: text', () => {
                        isSummaryActiveRef.current = false;
                        setIsSummaryActive(false);
                        setActiveGlobalSummaryId(null);
                        indexRef.current = savedChapterIndexRef.current;
                        wpmRef.current = wpm;
                        const restoredDisplayWord = resetDisplaySegments(wordsRef.current[indexRef.current] || '');
                        renderWord(indexRef.current, wordsRef.current, true, restoredDisplayWord);
                        accumulatorRef.current = 0;
                    });
                    return;
                }

                // End of Chapter - find next
                const chapters = chaptersRef.current;
                const currentChapter = currentChapterRef.current;
                const nextChapter = currentChapter
                    ? findNextReadableChapter(chapters, currentChapter.id)
                    : null;

                if (nextChapter) {
                    loadChapter(nextChapter.id, 0, true);
                } else {
                    setIsPlaying(false);
                    setShowChapters(true);
                }
                return;
            }
        }

        // Continue loop - use rAF for precision timing in final approach
        requestRef.current = requestAnimationFrame(loopInternal);
    }, [wpm, renderWord, loadChapter, summaryWpm, startTransition, calculateTargetInterval, resetDisplaySegments, syncSchedulerCursor]);

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
        if (currentChapter) {
            syncSchedulerCursor(currentChapter.id, currentWordIndex);
        }
    }, [chapters, currentChapter, currentWordIndex, syncSchedulerCursor]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (!isPlaying) {
            saveProgress();
            setCurrentWordIndex(indexRef.current);
            // When pausing, sync the chapter state and re-render context windows
            // to reflect any density updates that occurred during playback
            if (currentChapterRef.current) {
                setCurrentChapter(currentChapterRef.current);
                const displayWord = getDisplayWordForCurrentSegment(wordsRef.current[indexRef.current] || '');
                renderWord(indexRef.current, wordsRef.current, true, displayWord);
            }
        } else {
            lastTimeRef.current = undefined;
            accumulatorRef.current = 0;
            requestRef.current = requestAnimationFrame(loop);
        }
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isPlaying, saveProgress, loop, renderWord, getDisplayWordForCurrentSegment]);

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

    // Calculate actual WPM from word timestamps (every 500ms)
    useEffect(() => {
        const calculateActualWpm = () => {
            const now = processTimeRef.current;
            const measureWindow = 5000; // 5 seconds window for responsiveness
            const oldTime = now - measureWindow;
            
            // Filter to words displayed in the last window
            const recentTimestamps = wordTimestampsRef.current.filter(t => t > oldTime);
            wordTimestampsRef.current = recentTimestamps; // Prune old entries
            
            // Calculate WPM based on words in last window
            if (recentTimestamps.length >= 2) {
                const oldestTimestamp = recentTimestamps[0];
                const newestTimestamp = recentTimestamps[recentTimestamps.length - 1];
                
                // Effective duration over the span of words
                const timeSpanMs = newestTimestamp - oldestTimestamp;
                
                // Need at least 1 second of data to be stable
                if (timeSpanMs > 1000) {
                    const timeSpanMinutes = timeSpanMs / 60000;
                    // Count words (intervals = length - 1, but we want rate of consumption)
                    // length is number of words displayed.
                    const wordsPerMinute = Math.round(recentTimestamps.length / timeSpanMinutes);
                    setActualWpm(wordsPerMinute);
                }
            } else if (recentTimestamps.length <= 1) {
                setActualWpm(0);
            }
        };

        if (isPlaying) {
            const interval = setInterval(calculateActualWpm, 500);
            return () => clearInterval(interval);
        }
    }, [isPlaying]);

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
            const chapterQuery = db.chapters.find({
                selector: { bookId: book.id },
                sort: [{ index: 'asc' }]
            });
            sub = chapterQuery.$.subscribe(docs => {
                setChapters(docs.map(d => d.toJSON() as ChapterDocType));
            });

            // Subscribe to book document for globalSummaries updates
            let bookSub: { unsubscribe: () => void } | null = null;
            if (db.books) {
                bookSub = db.books.findOne(book.id).$.subscribe(bookDoc => {
                    if (bookDoc) {
                        const bookData = bookDoc.toJSON() as BookDocType;
                        setGlobalSummaries(bookData.globalSummaries || []);
                    }
                });
            }

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

            // Only run the initial chapter load once per book.id. Subsequent re-runs of
            // this effect (e.g. when book.chapterIds reference or loadChapter identity
            // changes during playback) must NOT call loadChapter again, otherwise the
            // reader rewinds to the last persisted currentWordIndex (saveProgress is
            // throttled to 5s).
            if (initialLoadAppliedForBookRef.current !== book.id) {
                initialLoadAppliedForBookRef.current = book.id;
                const requestedChapterId = stateDoc.currentChapterId || book.chapterIds?.[0];
                const requestedChapterDoc = requestedChapterId
                    ? await db.chapters.findOne(requestedChapterId).exec()
                    : null;
                const requestedChapter = requestedChapterDoc?.toJSON() as ChapterDocType | undefined;

                if (requestedChapter && isReadableChapter(requestedChapter)) {
                    loadChapter(requestedChapter.id, stateDoc.currentWordIndex);
                } else {
                    const chapterDocs = await chapterQuery.exec();
                    const firstReadableChapter = chapterDocs
                        .map(doc => doc.toJSON() as ChapterDocType)
                        .find(isReadableChapter);

                    if (firstReadableChapter) {
                        loadChapter(firstReadableChapter.id, 0);
                    } else {
                        waitingForReadableChapterRef.current = true;
                    }
                }
            }
            
            // Return cleanup for book subscription
            return () => bookSub?.unsubscribe();
        };
        const bookSubCleanup = loadState();
        return () => {
            if (sub) sub.unsubscribe();
            bookSubCleanup.then(cleanup => cleanup?.());
        };
    }, [book.id, book.chapterIds, loadChapter]);

    useEffect(() => {
        if (!waitingForReadableChapterRef.current || currentChapter) return;

        const firstReadableChapter = chapters.find(isReadableChapter);
        if (!firstReadableChapter) return;

        waitingForReadableChapterRef.current = false;
        loadChapter(firstReadableChapter.id, 0);
    }, [chapters, currentChapter, loadChapter]);

    // Speed control handlers with momentum (must be before any conditional returns)
    // Rapid repeated presses accumulate intensity for larger jumps
    const calculateMomentumDelta = useCallback(() => {
        const now = performance.now();
        const momentum = speedMomentumRef.current;
        
        // Time since last press in seconds
        const timeSinceLastPress = (now - momentum.lastPress) / 1000;
        
        // Decay the existing intensity (half-life of ~300ms)
        const decayFactor = Math.exp(-timeSinceLastPress / 0.3);
        const decayedIntensity = momentum.intensity * decayFactor;
        
        // Add new impulse (1.0 base)
        const newIntensity = decayedIntensity + 1.0;
        
        // Update state
        speedMomentumRef.current = { lastPress: now, intensity: newIntensity };
        
        // Calculate delta: base of 25, scaled by intensity (clamped to reasonable range)
        // intensity 1 = 25, intensity 2 = 50, intensity 4 = 100, etc.
        const baseDelta = 25;
        const delta = Math.round(baseDelta * Math.min(newIntensity, 8));
        
        return delta;
    }, []);

    const handleSlower = useCallback(() => {
        const delta = calculateMomentumDelta();
        setWpm(Math.max(50, wpm - delta));
    }, [wpm, setWpm, calculateMomentumDelta]);

    const handleFaster = useCallback(() => {
        const delta = calculateMomentumDelta();
        setWpm(wpm + delta); // No max limit
    }, [wpm, setWpm, calculateMomentumDelta]);

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
    // This handles two cases:
    // 1. New books: processChaptersInBackground schedules initial tasks
    // 2. Reopened books: resumeIncompleteAnalysis re-schedules tasks lost on reload
    useEffect(() => {
        processChaptersInBackground(book.id).catch(console.error);
    }, [book.id]);
    
    // Resume incomplete analysis when chapter changes (not on every word)
    // This re-schedules density/summary tasks that were lost when the page was reloaded
    useEffect(() => {
        if (currentChapter) {
            resumeIncompleteAnalysis(book.id, currentChapter.id, currentWordIndex).catch(console.error);
        }
    // Intentionally only depend on currentChapter?.id, not currentWordIndex
    // We don't want to re-schedule on every word - the scheduler handles cursor updates separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [book.id, currentChapter?.id]);

    // Effect to render word when chapter or index changes, ensuring ref is available
    // Use useLayoutEffect to render synchronously after DOM mutations, before browser paint
    // This ensures the first word AND context windows are visible immediately when the component mounts
    useLayoutEffect(() => {
        if (!loading && currentChapter && wordsRef.current.length > 0) {
            // Check if all required refs are mounted before rendering
            if (rsvpRef.current && prevContainerRef.current && nextContainerRef.current) {
                const displayWord = getDisplayWordForCurrentSegment(wordsRef.current[currentWordIndex] || '');
                renderWord(currentWordIndex, wordsRef.current, true, displayWord);
                initialRenderDoneRef.current = true;
            }
        }
    }, [loading, currentChapter, currentWordIndex, renderWord, getDisplayWordForCurrentSegment, isCompactLandscape]);

    // Fallback effect: if the above didn't trigger (refs not ready), 
    // use a microtask to try again after React finishes its work
    useEffect(() => {
        if (!loading && currentChapter && wordsRef.current.length > 0 && !initialRenderDoneRef.current) {
            // Schedule render on next tick to ensure refs are available
            const timer = requestAnimationFrame(() => {
                if (rsvpRef.current) {
                    const displayWord = getDisplayWordForCurrentSegment(wordsRef.current[currentWordIndex] || '');
                    renderWord(currentWordIndex, wordsRef.current, true, displayWord);
                    initialRenderDoneRef.current = true;
                }
            });
            return () => cancelAnimationFrame(timer);
        }
    }, [loading, currentChapter, currentWordIndex, renderWord, getDisplayWordForCurrentSegment, isCompactLandscape]);

    if (loading && !currentChapter) {
        return <div className="flex items-center justify-center h-full font-mono text-dune-gold animate-pulse">INITIALIZING COCKPIT...</div>;
    }

    // Calculate Subchapter Progress
    const currentSubchapter = currentChapter?.subchapters?.find(s => currentWordIndex >= s.startWordIndex && currentWordIndex < s.endWordIndex);
    let subchapterProgress = 0;
    
    // If playing summary, use index from saved ref because indexRef is 0
    // But logically, if isSummaryActive is TRUE, we are "at" the end of the subchapter we just finished.
    // The loop finds the subchapter by `s.endWordIndex === indexRef.current`.
    // So while reading summary, we are theoretically associated with the subchapter that just ended.
    // Wait, `savedChapterIndexRef` holds the index where we triggered summary.
    // That index equals `sub.endWordIndex`.
    // So we can find the subchapter index using that.
    
    let activeSummaryId: string | null = activeGlobalSummaryId;
    if (!activeSummaryId && isSummaryActive && currentChapter) {
         const chapterId = currentChapter.id;
         // Find sub whose end index matches saved ref
         const subIdx = currentChapter.subchapters?.findIndex(s => s.endWordIndex === savedChapterIndexRef.current);
         if (subIdx !== undefined && subIdx !== -1) {
             activeSummaryId = `${chapterId}_${subIdx}`;
         }
    }

    if (currentSubchapter) {
        const total = currentSubchapter.endWordIndex - currentSubchapter.startWordIndex;
        const current = currentWordIndex - currentSubchapter.startWordIndex;
        subchapterProgress = Math.min(1, Math.max(0, current / total));
    }

    // Color based on actual speed vs target
    const speedColor = actualWpm === 0 ? 'text-gray-500' : 
        actualWpm < wpm * 0.8 ? 'text-blue-400' : 
        actualWpm > wpm * 1.2 ? 'text-red-400' : 'text-dune-gold';

    // Calculate word to render for React (to avoid stale content on re-renders)
    // When playing, the loop updates the DOM directly.
    // When paused or when state changes (like isSummaryActive), React re-renders.
    // We need to ensure React renders the correct word so it doesn't overwrite the loop's work with stale data.
    // Use currentChapter.content for React rendering (state-driven) rather than wordsRef (which doesn't trigger re-renders)
    const wordToRender = isSummaryActive 
        ? (summaryWordsRef.current[indexRef.current] || '')
        : (currentChapter?.content?.[currentWordIndex] || wordsRef.current[currentWordIndex] || '');
    const displayWordToRender = getDisplayWordForCurrentSegment(wordToRender);
    const rsvpTypographyClass = isCompactLandscape ? 'text-4xl sm:text-5xl md:text-6xl' : 'text-6xl md:text-8xl';
    const rsvpContainerStyle = {
        ...(displayPlugin.getContainerStyle?.(displayWordToRender) || {}),
    } as React.CSSProperties;
    rsvpContainerStyle.transform = mergeTransformWithScale(
        typeof rsvpContainerStyle.transform === 'string' ? rsvpContainerStyle.transform : undefined,
        lensScale,
    );
    rsvpContainerStyle.transformOrigin = 'center center';

    return (
        <div ref={setFullscreenTarget} className="relative w-full h-full min-h-0 bg-basalt text-white overflow-hidden flex">
            {/* Floating Header / Controls */}
            <div className="absolute top-0 left-0 right-0 z-[60] p-4 flex justify-between items-start pointer-events-none">
                {onBack ? (
                    <button
                        onClick={onBack}
                        className="pointer-events-auto p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        title="Back to Archive"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                ) : (
                    <div className="w-12" />
                )}

                {/* Chapter Title (Centered) - hidden on mobile/small-screens to prevent layout collision */}
                <div className="hidden md:block mt-2 px-6 py-2 bg-black/20 backdrop-blur-sm rounded-full border border-white/5 shadow-lg">
                    <h3 className="font-mono text-xs text-gray-400 tracking-widest uppercase">{currentChapter?.title}</h3>
                </div>

                <div className="pointer-events-auto relative flex items-start gap-3">
                    {/* Fullscreen Button */}
                    <button
                        onClick={handleToggleFullscreen}
                        className={`hidden md:inline-flex p-3 backdrop-blur-md rounded-full border transition-colors shadow-lg ${
                            isFullscreen
                                ? 'bg-dune-gold/80 border-dune-gold text-black'
                                : 'bg-black/40 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                        } ${!isFullscreenSupported ? 'opacity-75' : ''}`}
                        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isFullscreen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 9V4.5H9M15 4.5h4.5V9M4.5 15v4.5H9M15 19.5h4.5V15" />
                            )}
                        </svg>
                    </button>

                    {/* Focus Mode Button */}
                    <button
                        onClick={() => {
                            const newFocusMode = !focusModeEnabled;
                            setFocusModeEnabled(newFocusMode);
                            if (newFocusMode) {
                                // Save current state before entering focus mode
                                preFocusStateRef.current = {
                                    riverTop: riverTopEnabled,
                                    riverBottom: riverBottomEnabled,
                                    showChapters: showChapters,
                                    showTTSPlayer: showTTSPlayer,
                                };
                                // Enter focus mode: hide all distractions
                                setRiverTopEnabled(false);
                                setRiverBottomEnabled(false);
                                setShowChapters(false);
                                setShowTTSPlayer(false);
                                setNavSidebarCollapsed(true);
                            } else {
                                // Exit focus mode: restore previous state
                                const prev = preFocusStateRef.current;
                                if (prev) {
                                    setRiverTopEnabled(prev.riverTop);
                                    setRiverBottomEnabled(prev.riverBottom);
                                    setShowChapters(prev.showChapters);
                                    setShowTTSPlayer(prev.showTTSPlayer);
                                } else {
                                    // Fallback if no saved state
                                    setRiverTopEnabled(true);
                                    setRiverBottomEnabled(true);
                                }
                                setNavSidebarCollapsed(false);
                                preFocusStateRef.current = null;
                            }
                        }}
                        className={`hidden md:inline-flex p-3 backdrop-blur-md rounded-full border transition-colors shadow-lg ${
                            focusModeEnabled 
                                ? 'bg-dune-gold/80 border-dune-gold text-black' 
                                : 'bg-black/40 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                        title={focusModeEnabled ? 'Exit Focus Mode' : 'Focus Mode (hide distractions)'}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {focusModeEnabled ? (
                                // Expand icon (restore full UI)
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                            ) : (
                                // Compress icon (enter focus mode)
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                            )}
                        </svg>
                    </button>

                    {/* AI Toggle Button */}
                    <button
                        onClick={() => setAiEnabled(!aiEnabled)}
                        className={`hidden md:inline-flex p-3 backdrop-blur-md rounded-full border transition-colors shadow-lg ${
                            aiEnabled 
                                ? 'bg-green-600/60 border-green-400/50 text-green-200' 
                                : 'bg-black/40 border-white/10 text-white/30 hover:bg-white/10 hover:text-white/50'
                        }`}
                        title={aiEnabled ? 'AI On (tap to disable for battery saving)' : 'AI Off (tap to enable density analysis)'}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {!aiEnabled && (
                            <span className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-8 h-8 text-red-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                            </span>
                        )}
                    </button>

                    {/* TTS / Listen Button */}
                    <button
                        onClick={() => setShowTTSPlayer(!showTTSPlayer)}
                        className={`hidden md:inline-flex p-3 backdrop-blur-md rounded-full border transition-colors shadow-lg ${
                            ttsPlaybackState === 'playing' 
                                ? 'bg-purple-600/80 border-purple-400 text-white' 
                                : showTTSPlayer
                                    ? 'bg-purple-900/60 border-purple-500/50 text-purple-300'
                                    : 'bg-black/40 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                        title="Listen (Text to Speech)"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                d="M12 3c-4.97 0-9 4.03-9 9v7a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-1a2 2 0 00-2 2v3a2 2 0 002 2h1a2 2 0 002-2v-7c0-4.97-4.03-9-9-9z" />
                        </svg>
                        {ttsPlaybackState === 'playing' && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setTheme(isDayTheme ? 'volcanic' : 'day')}
                        className="inline-flex p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors shadow-lg"
                        title={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
                        aria-label={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
                    >
                        {isDayTheme ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
                    </button>
                    
                    {/* Chapters Button */}
                    <button
                        onClick={() => setShowChapters(!showChapters)}
                        data-testid="toggle-chapters"
                        className="p-3 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-dune-gold hover:bg-white/10 transition-colors shadow-lg"
                        title="Chapters"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {showChapters ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            )}
                        </svg>
                    </button>

                    {fullscreenHint && (
                        <div className="absolute top-full right-0 mt-2 w-64 p-2 bg-black/70 backdrop-blur-md border border-white/10 rounded-md text-[10px] uppercase tracking-wide font-mono text-dune-gold/90 leading-relaxed">
                            {fullscreenHint}
                        </div>
                    )}
                </div>
            </div>

            {/* Backdrop click-shield for sidebar on mobile/small-screens */}
            {showChapters && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[75] md:hidden"
                    onClick={() => setShowChapters(false)}
                />
            )}

            {/* Chapters Drawer (Right) - responsive width so it doesn't crowd small mobile viewports */}
            <div
                data-testid="sidebar-container"
                className={`fixed inset-y-0 right-0 z-[80] w-[88vw] max-w-sm sm:w-80 bg-basalt border-l border-white/10 transform transition-transform duration-300 ${showChapters ? 'translate-x-0' : 'translate-x-full'}`}
                onTouchStart={handleChapterDrawerTouchStart}
                onTouchMove={handleChapterDrawerTouchMove}
                onTouchEnd={handleChapterDrawerTouchEnd}
                onTouchCancel={handleChapterDrawerTouchEnd}
                style={{ willChange: 'transform', touchAction: 'pan-y' }}
            >
                <Sidebar
                    chapters={chapters}
                    currentChapter={currentChapter}
                    onLoadChapter={(id, index) => {
                        loadChapter(id, index || 0);
                        setShowChapters(false);
                    }}
                    onInspectChapter={(chapter) => setInspectingChapterId(chapter.id)}
                    wpm={wpm}
                    currentWordIndex={currentWordIndex}
                    now={now}
                    activeSummaryId={activeSummaryId}
                    globalSummaries={globalSummaries}
                    onPlayGlobalSummary={handlePlayGlobalSummary}
                    onClose={() => setShowChapters(false)}
                />
            </div>

            {/* Main Reader Area (Full Screen) - uses responsive margins to prevent shifting/squishing text on mobile */}
            <div
                className={`flex-1 h-full relative flex flex-col min-w-0 pb-20 md:pb-0 transition-all duration-300 ${showChapters ? 'md:mr-80 mr-0' : 'mr-0'}`}
            >
                <div className="w-full h-full flex flex-col relative group">

                    {/* Top Zone: Previous Context */}
                    <div 
                        className="flex-1 w-full overflow-hidden relative mask-gradient-top flex justify-center"
                    >
                        <div 
                            ref={prevContainerRef} 
                            data-testid="reader-context-top"
                            className={`reader-context-panel w-full max-w-2xl h-full flex flex-wrap content-end justify-start p-8 md:p-16 font-mono text-lg md:text-xl leading-relaxed select-none overflow-y-auto overflow-x-hidden overscroll-contain border-x border-white/5 cursor-text ${riverTopEnabled ? '' : 'invisible'}`}
                            onClick={handleRiverClick}
                            onScroll={handleRiverScroll}
                            style={{ touchAction: 'pan-y pinch-zoom' }}
                        ></div>
                        {/* River Toggle - Top */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setRiverTopEnabled(!riverTopEnabled); }}
                            className="hidden md:block absolute top-2 right-2 z-40 p-1.5 bg-black/40 backdrop-blur-sm rounded border border-white/10 hover:border-white/30 text-white/40 hover:text-white/80 transition-all opacity-0 group-hover:opacity-100"
                            title={riverTopEnabled ? 'Hide previous context (saves battery)' : 'Show previous context'}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {riverTopEnabled ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                )}
                            </svg>
                        </button>
                    </div>

                    {/* Middle Zone: RSVP (Click to Toggle) */}
                    <div
                        data-testid="rsvp-container"
                        className="relative h-48 w-full flex items-center justify-center z-30"
                        onClick={handleRsvpClick}
                    >
                        {/* Text area container with border */}
                        <div 
                            className="w-full max-w-2xl h-full flex items-center justify-center bg-black/20 border border-white/5 hover:border-white/10 transition-colors cursor-zoom-in"
                            onWheel={handleRsvpWheel}
                            onTouchStart={handleRsvpTouchStart}
                            onTouchMove={handleRsvpTouchMove}
                            onTouchEnd={handleRsvpTouchEnd}
                            onTouchCancel={handleRsvpTouchEnd}
                            style={{ touchAction: 'none' }}
                        >
                        {/* Display Plugin Word - Content is set by renderWord via ref, not React JSX */}
                        {/* This allows the playback loop to update the display at 60fps without React re-renders */}
                            <div 
                                ref={rsvpRef} 
                                className={`${rsvpTypographyClass} font-mono tracking-tight whitespace-nowrap drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] ${displayPlugin.getContainerClass()} ${isSummaryActive ? 'text-cyan-300 italic opacity-80' : 'text-white'}`}
                                style={rsvpContainerStyle}
                            />
                        </div>

                        <div className="absolute top-2 right-2 px-2 py-1 rounded border border-white/10 bg-black/35 backdrop-blur-sm text-[10px] font-mono uppercase tracking-wider text-white/70 pointer-events-none">
                            lens {Math.round(lensScale * 100)}%
                        </div>

                        {/* Subchapter Progress Lights */}
                        {currentSubchapter && (
                            <div className="absolute bottom-2 flex flex-col items-center gap-2 pointer-events-none">
                                <div className="flex gap-3">
                                    {[...Array(5)].map((_, i) => {
                                        const isLit = subchapterProgress >= (i / 5);
                                        return (
                                            <div
                                                key={i}
                                                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isLit ? 'bg-white/20' : 'bg-white/5'}`}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Play/Pause Overlay - positioned over the RSVP container */}
                        {(!isPlaying && !countdown) && (
                            <div data-testid="play-overlay" className="absolute bottom-3 left-3 pointer-events-none animate-in fade-in duration-200">
                                <div className="bg-black/50 backdrop-blur-sm p-2 rounded-full border border-white/10 shadow-lg">
                                    <svg className="w-5 h-5 text-white/70 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
                            </div>
                        )}
                        
                        {/* Countdown Overlay */}
                        {countdown && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-50 animate-in fade-in duration-200 gap-4">
                                {transitionLabel && (
                                    <div className="font-mono text-sm tracking-widest uppercase text-dune-gold/70 bg-black/40 px-3 py-1 rounded backdrop-blur-sm border border-white/5">
                                        {transitionLabel}
                                    </div>
                                )}
                                <div className="font-mono text-8xl font-bold text-dune-gold drop-shadow-lg animate-pulse">
                                    {countdown}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Bottom Zone: Next Context */}
                    <div 
                        className="flex-1 w-full overflow-hidden relative mask-gradient-bottom flex justify-center"
                    >
                        <div 
                            ref={nextContainerRef} 
                            data-testid="reader-context-bottom"
                            className={`reader-context-panel w-full max-w-2xl h-full flex flex-wrap content-start justify-start p-8 md:p-16 font-mono text-lg md:text-xl leading-relaxed select-none overflow-y-auto overflow-x-hidden overscroll-contain border-x border-white/5 cursor-text ${riverBottomEnabled ? '' : 'invisible'}`}
                            onClick={handleRiverClick}
                            onScroll={handleRiverScroll}
                            style={{ touchAction: 'pan-y pinch-zoom' }}
                        ></div>
                        {/* River Toggle - Bottom */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setRiverBottomEnabled(!riverBottomEnabled); }}
                            className="hidden md:block absolute bottom-2 right-2 z-40 p-1.5 bg-black/40 backdrop-blur-sm rounded border border-white/10 hover:border-white/30 text-white/40 hover:text-white/80 transition-all opacity-0 group-hover:opacity-100"
                            title={riverBottomEnabled ? 'Hide next context (saves battery)' : 'Show next context'}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {riverBottomEnabled ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                )}
                            </svg>
                        </button>
                    </div>

                </div>
            </div>

            {/* Speed Control Overlay */}
            <div className="absolute inset-x-0 bottom-0 z-[70] h-20 px-4 flex items-center justify-center gap-3 bg-basalt/95 border-t border-white/10 md:inset-x-auto md:bottom-8 md:right-8 md:h-auto md:px-0 md:bg-transparent md:border-0 md:opacity-40 md:hover:opacity-100 transition-opacity duration-300">
                
                {/* Skip Summary Button (Only Visible when relevant) */}
                {(isSummaryActive || (countdown && transitionLabel?.includes('summary'))) && (
                    <button
                        onClick={handleSkipSummary}
                        className="p-2 mr-2 bg-black/60 backdrop-blur-sm rounded-full border border-purple-500/30 text-purple-300 hover:text-white hover:bg-purple-900/50 hover:border-purple-400 transition-all active:scale-95 animate-in fade-in slide-in-from-right-4"
                        title="Skip Summary"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                    </button>
                )}

                {/* Slower Button */}
                <button
                    onClick={handleSlower}
                    className="p-2 bg-black/60 backdrop-blur-sm rounded-full border border-white/10 text-white/60 hover:text-white hover:bg-black/80 hover:border-white/30 transition-all active:scale-95"
                    title="Slower (-50 WPM)"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                </button>

                {/* WPM Display */}
                <div className="flex flex-col items-center px-4 py-2 bg-black/60 backdrop-blur-sm rounded-lg border border-white/10 min-w-[100px]">
                    {/* Target Speed (The setting) - Prominent for feedback */}
                    <div className="flex items-baseline gap-1 animate-in fade-in zoom-in duration-300">
                        <span className="text-2xl font-mono font-bold text-dune-gold tabular-nums transition-all filter drop-shadow-[0_0_5px_rgba(217,119,6,0.5)]">
                            {wpm}
                        </span>
                        <span className="text-[10px] text-dune-gold/70 font-bold uppercase">WPM</span>
                    </div>
                    
                    {/* Real-time Velocity (The result) - Secondary */}
                    {actualWpm > 0 && (
                        <div className="flex items-center gap-2 mt-1 border-t border-white/10 pt-1 w-full justify-center">
                            <span className={`text-xs font-mono tabular-nums ${speedColor}`}>
                                {actualWpm}
                            </span>
                            <span className="text-[8px] text-gray-500 tracking-widest uppercase">
                                REAL
                            </span>
                        </div>
                    )}
                    
                    {actualWpm === 0 && (
                         <span className="text-[9px] text-gray-500 tracking-widest uppercase mt-1">
                            PAUSED
                        </span>
                    )}
                </div>

                {/* Faster Button */}
                <button
                    onClick={handleFaster}
                    className="p-2 bg-black/60 backdrop-blur-sm rounded-full border border-white/10 text-white/60 hover:text-white hover:bg-black/80 hover:border-white/30 transition-all active:scale-95"
                    title="Faster (+50 WPM)"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </button>
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

            {/* TTS Player */}
            {showTTSPlayer && currentChapter && (
                <TTSPlayer
                    words={currentChapter.content}
                    currentWordIndex={currentWordIndex}
                    onPositionChange={(wordIndex) => {
                        // Sync TTS position to RSVP reader
                        indexRef.current = wordIndex;
                        setCurrentWordIndex(wordIndex);
                        const displayWord = resetDisplaySegments(wordsRef.current[wordIndex] || '');
                        renderWord(wordIndex, wordsRef.current, true, displayWord);
                    }}
                    bookId={book.id}
                    chapterId={currentChapter.id}
                    compact={false}
                />
            )}

        </div>
    );
};
