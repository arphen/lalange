import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, BookOpenText, Focus, Gauge, Headphones, List, Moon, Play, Share2, Sun, X } from 'lucide-react';
import { type BookDocType, type ChapterDocType, type ReadingStateDocType, type GlobalSummaryType, type ImageDocType } from '../../core/sync/db';
import { getDisplayPlugin, projectDisplayFrame, type DisplayPlugin } from '../../core/rsvp/display';
import { getFrameTargetInterval, getTargetInterval, isLikelyProperNoun } from '../../core/rsvp/timing';
import { isPauseToken, isReferenceToken, splitLongWordForRSVP } from '../../core/rsvp/tokenize';
import { planRsvpFrame, type RsvpFrame } from '../../core/rsvp/phrases/grouping';
import { Sidebar } from './Sidebar';
import { TTSPlayer } from './TTSPlayer';
import { ExchangeSheet } from '../Exchange/ExchangeSheet';
import {
    clampLensScale,
    getTouchDistance,
    getWheelPinchDelta,
    LENS_SCALE_DEFAULT,
    mergeTransformWithScale,
} from './lensGestures';
import { useSettingsStore } from '../../core/store/settings';
import { useAIStore } from '../../core/store/ai';
import { useTTSStore } from '../../core/store/tts';
import {
    buildChapterWordIndex,
    findNextReadableChapter,
    findPreviousReadableChapter,
    getGlobalWordIndexFromIndex,
    isReadableChapter,
} from './readerNavigation';
import { buildImageCueAssignments, findImageBreakAfterChapter, type ImageBreakCue } from './imageCue';
import { readerPerformanceCounters } from './readerPerformance';
import { ContextWindowProjector } from './contextWindowProjector';
import { createReaderSessionControllerForBook } from '../../core/reader/controller';
import { createRsvpPlaybackClock } from '../../core/reader/rsvpPlaybackClock';
import type { ReaderSessionSequence } from '../../core/reader/sessionSequence';
import { createReaderSessionDataSource } from '../../core/reader/dataSource';

import { scheduler } from '../../core/ingest/scheduler';
import { processChaptersInBackground, resumeIncompleteAnalysis } from '../../core/ingest/pipeline';

interface ReaderProps {
    book: BookDocType;
    onBack?: () => void;
}

interface ChapterHandoffSelection {
    chapterId: string;
    startWordIndex: number | null;
}

type ReadingStatePatch = (
    patch: Partial<Pick<ReadingStateDocType, 'currentChapterId' | 'currentWordIndex' | 'lastRead'>>,
) => Promise<unknown>;

const getDensityColor = (score: number) => {
    if (score === 0) return 'text-gray-700 opacity-50'; // Pending
    if (score <= 0.6) return 'text-sky-500'; // Fast
    if (score <= 0.8) return 'text-sky-300'; // Brisk
    if (score <= 1.0) return 'text-gray-400'; // Normal
    if (score <= 1.2) return 'text-cyan-300'; // Deliberate
    if (score <= 1.5) return 'text-emerald-300'; // Slow
    if (score <= 2.0) return 'text-teal-300'; // Very Slow
    return 'text-blue-100 font-bold'; // Profound
};

const COMPACT_LANDSCAPE_MEDIA_QUERY = '(orientation: landscape) and (max-height: 640px)';
const DESKTOP_READER_MEDIA_QUERY = '(min-width: 768px)';
const LONG_WORD_SPLIT_MIN_LENGTH = 12;
const LONG_WORD_SPLIT_SEGMENT_LENGTH = 8;
const TOUCH_TAP_MAX_MOVEMENT_PX = 10;
const TOUCH_WORD_STEP_PX = 28;
const RIVER_SCROLL_CLICK_SUPPRESSION_MS = 180;
const CHAPTER_DRAWER_SWIPE_CLOSE_DISTANCE_PX = 72;
const CHAPTER_DRAWER_SWIPE_MAX_VERTICAL_PX = 56;
const CHAPTER_BRAKE_DURATION_MS = 720;
const CHAPTER_PAUSED_CROSSING_DELAY_MS = 720;
const CHAPTER_LAUNCH_DURATION_MS = 760;
const CHAPTER_BRAKE_SPEED = 0.06;
const CHAPTER_LAUNCH_SPEED = 0.14;
const CHAPTER_CHOOSER_HIDE_AFTER_PLAYBACK_MS = 320;

type ChapterTransitionPhase = 'braking' | 'crossing' | 'launching';
const TTS_RIVER_REFRESH_INTERVAL_MS = 1000;

const useDeferredResourceDisposal = <Resource extends { dispose: () => void }>(resource: Resource) => {
    const resourceLifecycleRef = useRef({ active: resource, generation: 0 });

    useEffect(() => {
        const resourceLifecycle = resourceLifecycleRef.current;
        resourceLifecycle.active = resource;
        const generation = ++resourceLifecycle.generation;
        return () => {
            queueMicrotask(() => {
                if (resourceLifecycle.active !== resource || resourceLifecycle.generation === generation) {
                    resource.dispose();
                }
            });
        };
    }, [resource]);
};

const buildReaderBlockedIndexes = (
    words: readonly string[],
    chapter: ChapterDocType | null,
): ReadonlySet<number> => {
    const blockedIndexes = new Set<number>();
    words.forEach((word, index) => {
        if (isReferenceToken(word) || isPauseToken(word)) blockedIndexes.add(index);
    });
    chapter?.noteAnchors?.forEach((anchor) => blockedIndexes.add(anchor.wordIndex));
    chapter?.subchapters?.forEach((subchapter) => {
        if (subchapter.summary) blockedIndexes.add(subchapter.endWordIndex);
    });
    return blockedIndexes;
};

const assertFrameDoesNotSkipProtectedIndex = (
    frame: RsvpFrame,
    blockedIndexes: ReadonlySet<number>,
): void => {
    for (let index = frame.startIndex + 1; index < frame.startIndex + frame.sourceWordCount; index++) {
        if (blockedIndexes.has(index)) {
            throw new Error(`RSVP frame skipped protected source index ${index}`);
        }
    }
};

export const Reader: React.FC<ReaderProps> = ({ book, onBack }) => {
    const initialChapterId = book.chapterIds[0] || '';
    const readerSessionController = useMemo(
        () => createReaderSessionControllerForBook(book.id, initialChapterId),
        [book.id, initialChapterId],
    );
    const readerDataSource = useMemo(
        () => createReaderSessionDataSource(book.id),
        [book.id],
    );
    const readerSessionSnapshot = useSyncExternalStore(
        readerSessionController.subscribe,
        readerSessionController.getSnapshot,
        readerSessionController.getSnapshot,
    );
    const isPlaying = readerSessionSnapshot.playing;
    const setIsPlaying = useCallback((next: boolean | ((current: boolean) => boolean)) => {
        const current = readerSessionController.getSnapshot().playing;
        const shouldPlay = typeof next === 'function' ? next(current) : next;
        readerSessionController.dispatch(
            shouldPlay
                ? { type: 'play', transport: 'rsvp' }
                : { type: 'pause' },
        );
    }, [readerSessionController]);
    const [playbackSession, setPlaybackSession] = useState(0);
    const [isCompactLandscape, setIsCompactLandscape] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(COMPACT_LANDSCAPE_MEDIA_QUERY).matches;
    });
    const [lensScale, setLensScale] = useState(LENS_SCALE_DEFAULT);

    useDeferredResourceDisposal(readerSessionController);
    useDeferredResourceDisposal(readerDataSource);

    useEffect(() => {
        readerPerformanceCounters.record('readerCommits');
    });
    
    // Use individual selectors for all settings to minimize re-renders
    const wpm = useSettingsStore((s) => s.wpm);
    const setWpm = useSettingsStore((s) => s.setWpm);
    const summaryWpm = useSettingsStore((s) => s.summaryWpm);
    const commonPhraseRankLimit = useSettingsStore((s) => s.commonPhraseRankLimit);
    const displayPluginId = useSettingsStore((s) => s.displayPlugin);
    const theme = useSettingsStore((s) => s.theme);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const notePresentation = useSettingsStore((s) => s.notePresentation);
    const noteAutoPause = useSettingsStore((s) => s.noteAutoPause);
    const isDayTheme = theme === 'day' || theme === 'dunes';
    
    // River (context panel) toggles - use selectors for performance
    const riverTopEnabled = useSettingsStore((s) => s.riverTopEnabled);
    const riverBottomEnabled = useSettingsStore((s) => s.riverBottomEnabled);
    const setRiverTopEnabled = useSettingsStore((s) => s.setRiverTopEnabled);
    const setRiverBottomEnabled = useSettingsStore((s) => s.setRiverBottomEnabled);
    
    // Focus mode - visually isolates the RSVP lane without changing reader settings
    const focusModeEnabled = useSettingsStore((s) => s.focusModeEnabled);
    const setFocusModeEnabled = useSettingsStore((s) => s.setFocusModeEnabled);
    
    // Ref to restore an open contents drawer after leaving focus mode
    const preFocusStateRef = useRef<{
        showChapters: boolean;
        riverTop: boolean;
        riverBottom: boolean;
    } | null>(null);
    
    // AI toggle - disable AI features to save battery
    const aiEnabled = useSettingsStore((s) => s.aiEnabled);
    const setAiEnabled = useSettingsStore((s) => s.setAiEnabled);
    const aiIsReady = useAIStore((s) => s.lifecycleState === 'ready');
    const aiIsLoading = useAIStore((s) => (
        s.lifecycleState === 'downloading'
        || s.lifecycleState === 'loading'
        || s.lifecycleState === 'unloading'
    ));
    const aiSetupProgress = useAIStore((s) => s.progressValue);
    const requestAiSetup = useAIStore((s) => s.requestSetup);
    const aiSetupPercent = Math.round(aiSetupProgress * 100);
    const pacingControlLabel = aiEnabled
        ? 'Disable adaptive pacing'
        : aiIsLoading
            ? `Adaptive pacing setup ${aiSetupPercent}%`
            : aiIsReady
                ? 'Enable adaptive pacing'
                : 'Set up adaptive pacing';
    
    // Get the active display plugin
    const displayPlugin = useMemo(() => getDisplayPlugin(displayPluginId), [displayPluginId]);
    const displayPluginRef = useRef<DisplayPlugin>(displayPlugin);
    
    // Keep plugin ref in sync
    useEffect(() => {
        displayPluginRef.current = displayPlugin;
    }, [displayPlugin]);

    // Actual WPM tracking, weighted by source words consumed per frame
    const wordTimestampsRef = useRef<Array<{ timeMs: number; sourceWordCount: number }>>([]);
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
    const [contentUnavailable, setContentUnavailable] = useState(false);

    // Sidebar & Chapters
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [bookImages, setBookImages] = useState<ImageDocType[]>([]);
    const [globalSummaries, setGlobalSummaries] = useState<GlobalSummaryType[]>([]);
    const [isDesktopLayout, setIsDesktopLayout] = useState(() => (
        typeof window === 'undefined' || window.innerWidth >= 768
    ));
    const [showChapters, setShowChapters] = useState(() => (
        typeof window === 'undefined' || window.innerWidth >= 768
    ));
    const contentsTriggerRef = useRef<HTMLButtonElement>(null);
    const contentsPanelRef = useRef<HTMLDivElement>(null);
    const previousContentsOpenRef = useRef(false);
    const [chapterHandoffSelection, setChapterHandoffSelection] = useState<ChapterHandoffSelection | null>(null);
    const [inspectingChapterId, setInspectingChapterId] = useState<string | null>(null);
    const inspectingChapter = chapters.find(c => c.id === inspectingChapterId);
    const [now, setNow] = useState(Date.now()); // Force re-render for live time updates
    const [activeImageCue, setActiveImageCue] = useState<ImageBreakCue | null>(null);
    const [showImageCuePreview, setShowImageCuePreview] = useState(false);
    const [openNoteId, setOpenNoteId] = useState<string | null>(null);

    // TTS State
    const [showTTSPlayer, setShowTTSPlayer] = useState(false);
    const [ttsAutoPlayChapterId, setTtsAutoPlayChapterId] = useState<string | null>(null);
    const [showExchange, setShowExchange] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const ttsPlaybackState = useTTSStore((s) => s.playbackState);
    const ttsPosition = useTTSStore((s) => s.currentPosition);
    const ttsPlaybackActive = showTTSPlayer && (
        ttsPlaybackState === 'preparing'
        || ttsPlaybackState === 'generating'
        || ttsPlaybackState === 'playing'
    );

    const prevContainerRef = useRef<HTMLDivElement>(null);
    const nextContainerRef = useRef<HTMLDivElement>(null);
    const previousContextProjectorRef = useRef<ContextWindowProjector | null>(null);
    const nextContextProjectorRef = useRef<ContextWindowProjector | null>(null);
    const rsvpRef = useRef<HTMLDivElement>(null);
    const rsvpTouchSurfaceRef = useRef<HTMLDivElement | null>(null);
    const [rsvpPlaybackClock] = useState(() => createRsvpPlaybackClock());
    const contextHistoryStartRef = useRef(0);

    if (!previousContextProjectorRef.current) {
        previousContextProjectorRef.current = new ContextWindowProjector();
    }
    if (!nextContextProjectorRef.current) {
        nextContextProjectorRef.current = new ContextWindowProjector();
    }
    
    // Track if initial render has been done (to trigger full render once all refs are mounted)
    const initialRenderDoneRef = useRef(false);
    // Tracks which book.id has had its initial reading-state load applied. Prevents the
    // mount effect from re-invoking loadChapter() with a stale (up-to-5s-old) saved
    // currentWordIndex when its deps change mid-playback, which would rewind by a
    // sentence/paragraph until playback caught back up.
    const initialLoadAppliedForBookRef = useRef<string | null>(null);
    const waitingForReadableChapterRef = useRef(false);
    
    const lastTimeRef = useRef<number | undefined>(undefined);
    const accumulatorRef = useRef<number>(0);

    // Refs for loop access
    const indexRef = useRef(0);
    const wpmRef = useRef(wpm);
    const isPlayingRef = useRef(isPlaying);
    const showTTSPlayerRef = useRef(showTTSPlayer);
    const wasTTSPlaybackActiveRef = useRef(false);
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
    const rsvpTouchLastSeekYRef = useRef<number | null>(null);
    const rsvpTouchDidSeekRef = useRef(false);
    const riverLastScrollAtRef = useRef(0);
    const chapterDrawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
    const chapterDrawerSwipeDeltaRef = useRef(0);
    const chapterDrawerSwipeActiveRef = useRef(false);
    const currentWordSegmentsRef = useRef<string[]>([]);
    const currentSegmentIndexRef = useRef(0);
    const segmentedWordSourceRef = useRef('');
    const activeFrameRef = useRef<RsvpFrame | null>(null);
    const blockedIndexesRef = useRef<ReadonlySet<number>>(new Set());
    const readingStatePatchRef = useRef<ReadingStatePatch | null>(null);
    const saveInFlightRef = useRef<Promise<void> | null>(null);
    const lastSavedPositionRef = useRef<{ chapterId: string; wordIndex: number } | null>(null);

    const chapterWordIndex = useMemo(() => buildChapterWordIndex(chapters), [chapters]);
    const readableChapterWordIndex = useMemo(
        () => buildChapterWordIndex(chapters.filter(isReadableChapter)),
        [chapters],
    );
    const chapterWordIndexRef = useRef(chapterWordIndex);
    const readableChapterWordIndexRef = useRef(readableChapterWordIndex);
    chapterWordIndexRef.current = chapterWordIndex;
    readableChapterWordIndexRef.current = readableChapterWordIndex;

    const syncSchedulerCursor = useCallback((chapterId: string, wordIndex: number) => {
        scheduler.setCursor(
            book.id,
            chapterId,
            wordIndex,
            getGlobalWordIndexFromIndex(chapterWordIndexRef.current, chapterId, wordIndex),
        );
        readerPerformanceCounters.record('schedulerCursorPublications');
    }, [book.id]);

    // Summary Mode Refs
    const [isSummaryActive, setIsSummaryActive] = useState(false);
    const [activeGlobalSummaryId, setActiveGlobalSummaryId] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [transitionLabel, setTransitionLabel] = useState<string | null>(null); // To show "Chunk Summary:" or "Resuming Text:"
    const [transitionKind, setTransitionKind] = useState<'chapter' | 'summary' | null>(null);
    const [chapterTransitionPhase, setChapterTransitionPhase] = useState<ChapterTransitionPhase | null>(null);
    const [chapterPulseActive, setChapterPulseActive] = useState(false);
    const [progressReminder, setProgressReminder] = useState<number | null>(null);
    const transitionSequenceRef = useRef<ReaderSessionSequence | null>(null);
    const chapterTransitionActiveRef = useRef(false);
    const pauseAfterChapterTransitionRef = useRef(false);
    const playbackMomentumRef = useRef(1);
    const progressReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastProgressMilestoneRef = useRef<number | null>(null);
    const autoPausedNoteRef = useRef<string | null>(null);

    const isSummaryActiveRef = useRef(false);
    const savedChapterIndexRef = useRef(0);
    const summaryWordsRef = useRef<string[]>([]);
    const activeImageCueRef = useRef<ImageBreakCue | null>(null);
    // Track the last boundary we triggered to prevent re-triggering on restore
    const lastTriggeredBoundaryRef = useRef<number>(-1);

    const imageCueAssignments = useMemo(
        () => buildImageCueAssignments(chapters, bookImages),
        [chapters, bookImages],
    );

    const activeNoteAnchor = useMemo(() => (
        currentChapter?.noteAnchors?.find((anchor) => (
            anchor.chapterId === currentChapter.id && anchor.wordIndex === currentWordIndex
        )) || null
    ), [currentChapter, currentWordIndex]);

    const activeNote = useMemo(() => (
        activeNoteAnchor && currentChapter?.notes?.find((note) => note.id === activeNoteAnchor.noteId)
    ) || null, [activeNoteAnchor, currentChapter]);

    const openNote = useCallback((noteId: string) => {
        setIsPlaying(false);
        setOpenNoteId(noteId);
    }, [setIsPlaying]);

    const openedNote = useMemo(() => (
        currentChapter?.notes?.find((note) => note.id === openNoteId) || null
    ), [currentChapter, openNoteId]);

    const bookNotes = useMemo(() => chapters
        .map((chapter) => chapter.id === currentChapter?.id && currentChapter ? currentChapter : chapter)
        .flatMap((chapter) => (chapter.notes || []).map((note) => ({
            chapter,
            note,
            anchor: chapter.noteAnchors?.find((candidate) => candidate.noteId === note.id) || null,
        })))
        .sort((left, right) => left.chapter.index - right.chapter.index
            || left.note.pageStart - right.note.pageStart
            || (left.note.label || '').localeCompare(right.note.label || '')),
    [chapters, currentChapter]);

    useEffect(() => {
        activeImageCueRef.current = activeImageCue;
    }, [activeImageCue]);

    const updateProgressMilestone = useCallback((chapterId: string, wordIndex: number, announce: boolean) => {
        const readableWordIndex = readableChapterWordIndexRef.current;
        const totalWords = readableWordIndex.totalWords;
        if (totalWords === 0) return;

        const globalIndex = getGlobalWordIndexFromIndex(readableWordIndex, chapterId, wordIndex);
        const milestone = Math.floor((globalIndex / totalWords) * 10) * 10;
        const previousMilestone = lastProgressMilestoneRef.current;

        if (!announce || previousMilestone === null) {
            lastProgressMilestoneRef.current = Math.max(previousMilestone ?? 0, milestone);
            return;
        }

        if (milestone < 10 || milestone <= previousMilestone) return;

        lastProgressMilestoneRef.current = milestone;
        setCurrentWordIndex(wordIndex);
        setProgressReminder(milestone);
        if (progressReminderTimerRef.current) clearTimeout(progressReminderTimerRef.current);
        progressReminderTimerRef.current = setTimeout(() => {
            setProgressReminder(null);
            progressReminderTimerRef.current = null;
        }, 3500);
    }, []);

    useEffect(() => {
        lastProgressMilestoneRef.current = null;
        setProgressReminder(null);
        if (progressReminderTimerRef.current) {
            clearTimeout(progressReminderTimerRef.current);
            progressReminderTimerRef.current = null;
        }
    }, [book.id]);

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
        const frame = planRsvpFrame(words, idx, {
            phraseRankLimit: showTTSPlayerRef.current ? 0 : commonPhraseRankLimit,
            blockedIndexes: isSummaryActiveRef.current ? undefined : blockedIndexesRef.current,
        });
        activeFrameRef.current = frame;
        const frameTokens = frame.sourceWordCount > 1
            ? frame.tokens
            : [displayWordOverride ?? frame.tokens[0] ?? ''];
        const frameDisplayText = frameTokens.join(' ');
        const frameEnd = frame.startIndex + frame.sourceWordCount;
        
        // Update RSVP Display
        if (rsvpRef.current) {
            const currentWord = frameTokens[0] ?? '';
            if (frameDisplayText) {
                const referenceWord = frameTokens.length === 1 && isReferenceToken(currentWord);
                readerPerformanceCounters.record('centerProjections');

                if (referenceWord) {
                    rsvpRef.current.replaceChildren();
                    const referenceLabel = document.createElement('span');
                    referenceLabel.className = 'uppercase tracking-[0.35em] text-sm md:text-base font-semibold text-gray-400';
                    referenceLabel.textContent = 'REF';
                    rsvpRef.current.appendChild(referenceLabel);
                } else {
                    projectDisplayFrame(rsvpRef.current, plugin, frameTokens);
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
                    const containerStyle = plugin.getContainerStyle?.(frameDisplayText);
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
            const start = Math.max(contextHistoryStartRef.current, idx - 150);
            const end = frame.startIndex;
            const prevContainer = prevContainerRef.current;
            const projector = previousContextProjectorRef.current;
            if (projector) {
                const result = projector.project(
                    prevContainer,
                    words,
                    start,
                    end,
                    {
                        getColorClass: (actualIndex) => getDensityColor(densitiesRef.current[actualIndex] || 1.0),
                        modelKey: 'velocireader',
                    },
                );
                if (result.rebuilt) {
                    readerPerformanceCounters.record('riverRebuilds');
                }
                readerPerformanceCounters.record('riverNodesCreated', result.createdNodes);
            }
            // Scroll to bottom
            prevContainer.scrollTop = prevContainer.scrollHeight;
        }

        // Render Next Context (Next ~150 words)
        // Performance: Skip when renderContext=false (during rapid playback) or riverBottomEnabled=false
        if (renderContext && riverBottomEnabled && nextContainerRef.current) {
            const start = frameEnd;
            const end = Math.min(words.length, frameEnd + 150);
            const nextContainer = nextContainerRef.current;
            const projector = nextContextProjectorRef.current;
            if (projector) {
                const result = projector.project(
                    nextContainer,
                    words,
                    start,
                    end,
                    {
                        getColorClass: (actualIndex) => getDensityColor(densitiesRef.current[actualIndex] || 1.0),
                        modelKey: 'velocireader',
                    },
                );
                if (result.rebuilt) {
                    readerPerformanceCounters.record('riverRebuilds');
                }
                readerPerformanceCounters.record('riverNodesCreated', result.createdNodes);
            }
            nextContainer.scrollTop = 0;
        }
    }, [commonPhraseRankLimit, riverTopEnabled, riverBottomEnabled, applyLensScaleToElement]);

    useEffect(() => {
        if (!rsvpRef.current) return;
        applyLensScaleToElement(rsvpRef.current);
    }, [lensScale, applyLensScaleToElement]);

    // Clear river content when disabled
    useEffect(() => {
        if (!riverTopEnabled && prevContainerRef.current) {
            previousContextProjectorRef.current?.reset(prevContainerRef.current);
        }
    }, [riverTopEnabled]);

    useEffect(() => {
        if (!riverBottomEnabled && nextContainerRef.current) {
            nextContextProjectorRef.current?.reset(nextContainerRef.current);
        }
    }, [riverBottomEnabled]);

    const handleToggleFocusMode = useCallback(() => {
        const newFocusMode = !focusModeEnabled;

        if (newFocusMode) {
            preFocusStateRef.current = {
                showChapters,
                riverTop: riverTopEnabled,
                riverBottom: riverBottomEnabled,
            };
            setShowChapters(false);
        } else {
            const previousState = preFocusStateRef.current;
            if (previousState) {
                setShowChapters(previousState.showChapters);
            }
            setRiverTopEnabled(previousState?.riverTop ?? true);
            setRiverBottomEnabled(previousState?.riverBottom ?? true);
            preFocusStateRef.current = null;
        }

        setFocusModeEnabled(newFocusMode);
    }, [focusModeEnabled, riverBottomEnabled, riverTopEnabled, setFocusModeEnabled, setRiverBottomEnabled, setRiverTopEnabled, showChapters]);

    useEffect(() => {
        if (!focusModeEnabled) return;
        setShowChapters(false);
    }, [focusModeEnabled]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        const mediaQuery = window.matchMedia(DESKTOP_READER_MEDIA_QUERY);
        const onChange = (event: MediaQueryListEvent) => setIsDesktopLayout(event.matches);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onChange);
            return () => mediaQuery.removeEventListener('change', onChange);
        }

        mediaQuery.addListener(onChange);
        return () => mediaQuery.removeListener(onChange);
    }, []);

    useEffect(() => {
        if (isDesktopLayout) return;
        setShowChapters(false);
        setChapterHandoffSelection(null);
    }, [isDesktopLayout]);

    useEffect(() => {
        const wasOpen = previousContentsOpenRef.current;
        previousContentsOpenRef.current = showChapters;

        if (wasOpen && !showChapters && !isDesktopLayout) {
            queueMicrotask(() => contentsTriggerRef.current?.focus());
        }
    }, [isDesktopLayout, showChapters]);

    useEffect(() => {
        if (!showChapters) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;

            const focusIsInPanel = contentsPanelRef.current?.contains(document.activeElement) ?? false;
            const focusIsInDocumentBody = document.activeElement === document.body;
            if (!isDesktopLayout || focusIsInPanel || focusIsInDocumentBody) {
                event.preventDefault();
                setShowChapters(false);
                setChapterHandoffSelection(null);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isDesktopLayout, showChapters]);

    useEffect(() => {
        if (!showChapters && chapterHandoffSelection) {
            setChapterHandoffSelection(null);
        }
    }, [showChapters, chapterHandoffSelection]);

    const animatePlaybackMomentum = useCallback((
        sequence: ReaderSessionSequence,
        from: number,
        to: number,
        durationMs: number,
        onComplete: () => void,
        easing: 'easeOut' | 'easeIn' = 'easeOut',
    ) => {
        playbackMomentumRef.current = from;

        void sequence.animate(durationMs, (progress) => {
            const easedProgress = easing === 'easeIn'
                ? Math.pow(progress, 3)
                : 1 - Math.pow(1 - progress, 3);
            playbackMomentumRef.current = from + ((to - from) * easedProgress);
        }).then((completed) => {
            if (!completed || sequence.signal.aborted) return;
            playbackMomentumRef.current = to;
            onComplete();
        });
    }, []);

    const startTransition = useCallback((
        label: string,
        onComplete: () => void | Promise<void>,
        options: {
            kind?: 'chapter' | 'summary';
            closeContents?: boolean;
            resumeAfterComplete?: boolean;
        } = {},
    ) => {
        const {
            kind = 'summary',
            closeContents = false,
            resumeAfterComplete = true,
        } = options;

        if (kind === 'chapter' && chapterTransitionActiveRef.current) return;

        transitionSequenceRef.current?.cancel();
        transitionSequenceRef.current = null;
        const sequence = readerSessionController.createSequence();
        transitionSequenceRef.current = sequence;
        const releaseSequence = () => {
            if (transitionSequenceRef.current !== sequence) return;
            sequence.cancel();
            transitionSequenceRef.current = null;
        };

        if (kind === 'chapter') {
            chapterTransitionActiveRef.current = true;
            pauseAfterChapterTransitionRef.current = false;
            const wasPlaying = isPlayingRef.current;
            const shouldLingerContents = closeContents && showChapters && isDesktopLayout;

            if (closeContents && !shouldLingerContents) {
                setShowChapters(false);
                setChapterHandoffSelection(null);
            }
            setTransitionLabel(label);
            setTransitionKind(kind);
            setChapterTransitionPhase(wasPlaying ? 'braking' : 'crossing');

            const crossIntoChapter = () => {
                if (sequence.signal.aborted) return;
                setIsPlaying(false);
                isPlayingRef.current = false;
                playbackMomentumRef.current = 0;
                setChapterTransitionPhase('crossing');

                Promise.resolve(onComplete())
                    .then(() => {
                        if (sequence.signal.aborted) return;
                        playbackMomentumRef.current = CHAPTER_LAUNCH_SPEED;
                        accumulatorRef.current = 0;
                        lastTimeRef.current = undefined;
                        setChapterTransitionPhase('launching');
                        setChapterPulseActive(true);
                        void sequence.delay(1400).then((completed) => {
                            if (!completed) return;
                            setChapterPulseActive(false);
                        });
                        const shouldPlay = !pauseAfterChapterTransitionRef.current;
                        isPlayingRef.current = shouldPlay;
                        setIsPlaying(shouldPlay);
                        if (shouldPlay) setPlaybackSession((session) => session + 1);

                        if (closeContents) {
                            if (shouldPlay && shouldLingerContents) {
                                void sequence.delay(CHAPTER_CHOOSER_HIDE_AFTER_PLAYBACK_MS).then((completed) => {
                                    if (!completed) return;
                                    setShowChapters(false);
                                    setChapterHandoffSelection(null);
                                });
                            } else {
                                setShowChapters(false);
                                setChapterHandoffSelection(null);
                            }
                        }

                        animatePlaybackMomentum(
                            sequence,
                            CHAPTER_LAUNCH_SPEED,
                            1,
                            CHAPTER_LAUNCH_DURATION_MS,
                            () => {
                                chapterTransitionActiveRef.current = false;
                                setChapterTransitionPhase(null);
                                setTransitionLabel(null);
                                setTransitionKind(null);
                                releaseSequence();
                            },
                            'easeIn',
                        );
                    })
                    .catch((error) => {
                        if (sequence.signal.aborted) return;
                        console.error('Reader transition failed', error);
                        playbackMomentumRef.current = 1;
                        chapterTransitionActiveRef.current = false;
                        readerSessionController.dispatch({ type: 'cancel-transition' });
                        if (closeContents) {
                            setShowChapters(false);
                            setChapterHandoffSelection(null);
                        }
                        setChapterTransitionPhase(null);
                        setTransitionLabel(null);
                        setTransitionKind(null);
                        releaseSequence();
                    });
            };

            if (wasPlaying) {
                animatePlaybackMomentum(sequence, 1, CHAPTER_BRAKE_SPEED, CHAPTER_BRAKE_DURATION_MS, crossIntoChapter);
            } else {
                void sequence.delay(CHAPTER_PAUSED_CROSSING_DELAY_MS).then((completed) => {
                    if (completed) crossIntoChapter();
                });
            }
            return;
        }

        // Stop playback immediately
        setIsPlaying(false);
        isPlayingRef.current = false;

        if (closeContents) {
            setShowChapters(false);
            setChapterHandoffSelection(null);
        }

        // Clear RSVP display
        if (rsvpRef.current) {
            rsvpRef.current.replaceChildren();
        }
        
        let count = 3;
        setCountdown(count);
        setTransitionLabel(label);
        setTransitionKind(kind);

        readerSessionController.dispatch({ type: 'set-mode', mode: 'summary' });
        let stopCountdown: () => void = () => undefined;
        const completeSummaryTransition = () => {
            stopCountdown();
            Promise.resolve(onComplete())
                .then(() => {
                    if (sequence.signal.aborted) return;
                    setCountdown(null);
                    setTransitionLabel(null);
                    setTransitionKind(null);
                    readerSessionController.dispatch({ type: 'set-mode', mode: 'text' });
                    if (resumeAfterComplete) setIsPlaying(true);
                    releaseSequence();
                })
                .catch((error) => {
                    if (sequence.signal.aborted) return;
                    console.error('Reader transition failed', error);
                    setCountdown(null);
                    setTransitionLabel(null);
                    setTransitionKind(null);
                    readerSessionController.dispatch({ type: 'set-mode', mode: 'text' });
                    releaseSequence();
                });
        };

        stopCountdown = sequence.repeat(1000, () => {
            count--;
            if (count > 0) {
                setCountdown(count);
            } else {
                completeSummaryTransition();
            }
        });
    }, [animatePlaybackMomentum, isDesktopLayout, readerSessionController, setIsPlaying, setCountdown, setTransitionLabel, setShowChapters, showChapters]);

    const handleSkipSummary = useCallback(() => {
        transitionSequenceRef.current?.cancel();
        transitionSequenceRef.current = null;
        setCountdown(null);
        setTransitionLabel(null);
        setTransitionKind(null);
        readerSessionController.dispatch({ type: 'set-mode', mode: 'text' });

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
    }, [wpm, renderWord, countdown, readerSessionController, setIsPlaying, setCountdown, setTransitionLabel, resetDisplaySegments]);

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
        const patchReadingState = readingStatePatchRef.current;
        if (!patchReadingState) return;

        while (true) {
            const position = {
                chapterId: currentChapter.id,
                wordIndex: indexRef.current,
            };
            const lastSavedPosition = lastSavedPositionRef.current;
            if (
                lastSavedPosition?.chapterId === position.chapterId
                && lastSavedPosition.wordIndex === position.wordIndex
            ) return;

            const inFlightSave = saveInFlightRef.current;
            if (inFlightSave) {
                await inFlightSave;
                continue;
            }

            const save = (async () => {
                try {
                    await patchReadingState({
                        currentChapterId: position.chapterId,
                        currentWordIndex: position.wordIndex,
                        lastRead: Date.now(),
                    });
                    lastSavedPositionRef.current = position;
                    readerPerformanceCounters.record('persistenceWrites');
                } finally {
                    saveInFlightRef.current = null;
                }
            })();
            saveInFlightRef.current = save;
            await save;
        }
    }, [loading, readingState, currentChapter]);
    const saveProgressRef = useRef(saveProgress);

    useEffect(() => {
        saveProgressRef.current = saveProgress;
    }, [saveProgress]);

    const loadChapter = React.useCallback(async (chapterId: string, initialIndex: number = 0, autoPlay: boolean = false) => {
        setIsPlaying(false);
        setLoading(true);
        await readerDataSource.subscribeToChapter(chapterId, async (chapterDoc, isInitialEmission) => {
                if (!isReadableChapter(chapterDoc)) return;

                if (isInitialEmission) {
                    readerSessionController.dispatch({
                        type: 'seek',
                        chapterId,
                        wordIndex: initialIndex,
                    });
                    setCurrentChapter(chapterDoc);
                    wordsRef.current = chapterDoc.content;
                    densitiesRef.current = chapterDoc.densities || [];
                    blockedIndexesRef.current = buildReaderBlockedIndexes(chapterDoc.content, chapterDoc);

                    indexRef.current = initialIndex;
                    setCurrentWordIndex(initialIndex);
                    updateProgressMilestone(chapterId, initialIndex, false);
                    resetDisplaySegments(wordsRef.current[initialIndex] || '');
                    lastTriggeredBoundaryRef.current = -1;
                    setLoading(false);
                    initialRenderDoneRef.current = false;

                    if (initialIndex === 0) {
                        const stateDoc = await readerDataSource.getOrCreateReadingState(book.id, chapterId);
                        if (stateDoc) {
                            await stateDoc.incrementalPatch({
                                currentChapterId: chapterId,
                                currentWordIndex: 0
                            });
                        }
                    }

                    if (autoPlay) {
                        const pulseSequence = readerSessionController.createSequence();
                        setChapterPulseActive(true);
                        void pulseSequence.delay(1400).then((completed) => {
                            if (!completed) return;
                            setChapterPulseActive(false);
                            pulseSequence.cancel();
                        });
                        setIsPlaying(true);
                    }

                    return;
                }

                // Live updates only refresh refs, avoiding playback flicker during density analysis.
                if (chapterDoc.content.length !== wordsRef.current.length) {
                    wordsRef.current = chapterDoc.content;
                }
                densitiesRef.current = chapterDoc.densities || [];
                currentChapterRef.current = chapterDoc;
                blockedIndexesRef.current = buildReaderBlockedIndexes(wordsRef.current, chapterDoc);

                if (!isPlayingRef.current) {
                    setCurrentChapter(chapterDoc);
                    const displayWord = resetDisplaySegments(wordsRef.current[indexRef.current] || '');
                    renderWord(indexRef.current, wordsRef.current, true, displayWord);
                }
        });
    }, [readerDataSource, readerSessionController, renderWord, book.id, resetDisplaySegments, setIsPlaying, updateProgressMilestone]);

    const beginChapterTransition = useCallback((
        chapterId: string,
        initialIndex: number = 0,
        selectionStartWordIndex?: number | null,
    ) => {
        if (transitionKind === 'summary') {
            transitionSequenceRef.current?.cancel();
            transitionSequenceRef.current = null;
            setCountdown(null);
            setTransitionLabel(null);
            setTransitionKind(null);
            readerSessionController.dispatch({ type: 'set-mode', mode: 'text' });
        }

        if (isSummaryActiveRef.current) {
            isSummaryActiveRef.current = false;
            setIsSummaryActive(false);
            setActiveGlobalSummaryId(null);
            summaryWordsRef.current = [];
            wpmRef.current = wpm;
        }

        if (chapterTransitionActiveRef.current) return;

        setChapterHandoffSelection(selectionStartWordIndex === undefined
            ? null
            : { chapterId, startWordIndex: selectionStartWordIndex });

        const targetChapter = chaptersRef.current.find((chapter) => chapter.id === chapterId);
        if (!targetChapter || !isReadableChapter(targetChapter)) return;
        const targetIndex = Math.max(0, Math.min(targetChapter.content.length - 1, initialIndex));

        readerSessionController.dispatch({
            type: 'begin-transition',
            phase: isPlayingRef.current ? 'braking' : 'crossing',
            targetChapterId: chapterId,
        });

        const currentChapterId = currentChapterRef.current?.id;
        const currentPosition = chaptersRef.current.findIndex((chapter) => chapter.id === currentChapterId);
        const targetPosition = chaptersRef.current.findIndex((chapter) => chapter.id === chapterId);
        const isSameChapter = currentChapterId === chapterId;
        const direction = targetPosition < currentPosition ? 'Previous chapter' : 'Next chapter';
        const targetSection = targetChapter.subchapters?.find((section) => section.startWordIndex === targetIndex);
        const label = isSameChapter
            ? `${targetChapter.title}${targetSection?.title ? ` / ${targetSection.title}` : ''}`
            : `${direction} / ${targetChapter.title}`;
        const activateDestination = (activate: () => void | Promise<void>) => {
            contextHistoryStartRef.current = targetIndex;
            previousContextProjectorRef.current?.reset(prevContainerRef.current);
            nextContextProjectorRef.current?.reset(nextContainerRef.current);
            return activate();
        };
        const activateTarget = isSameChapter
            ? () => activateDestination(() => {
                indexRef.current = targetIndex;
                readerSessionController.dispatch({
                    type: 'seek',
                    chapterId,
                    wordIndex: targetIndex,
                });
                setCurrentWordIndex(targetIndex);
                updateProgressMilestone(chapterId, targetIndex, false);
                lastTriggeredBoundaryRef.current = -1;
                accumulatorRef.current = 0;
                const displayWord = resetDisplaySegments(targetChapter.content[targetIndex] || '');
                renderWord(targetIndex, targetChapter.content, true, displayWord);
                syncSchedulerCursor(chapterId, targetIndex);
            })
            : () => activateDestination(() => loadChapter(chapterId, targetIndex, false));
        const completeTarget = async () => {
            await activateTarget();
            readerSessionController.dispatch({
                type: 'complete-transition',
                chapterId,
                wordIndex: targetIndex,
            });
        };

        startTransition(
            label,
            completeTarget,
            {
                kind: 'chapter',
                closeContents: !isDesktopLayout,
            },
        );
    }, [
        loadChapter,
        readerSessionController,
        renderWord,
        resetDisplaySegments,
        startTransition,
        syncSchedulerCursor,
        transitionKind,
        updateProgressMilestone,
        wpm,
        isDesktopLayout,
    ]);

    const handleTTSChapterEnd = useCallback(() => {
        const currentChapter = currentChapterRef.current;
        const nextChapter = currentChapter
            ? findNextReadableChapter(chaptersRef.current, currentChapter.id)
            : null;

        if (!nextChapter) return;

        setTtsAutoPlayChapterId(nextChapter.id);
        beginChapterTransition(nextChapter.id, 0);
    }, [beginChapterTransition]);

    const continueAfterImageCue = useCallback(() => {
        if (!activeImageCueRef.current) return;

        const nextReadableChapterId = activeImageCueRef.current.nextReadableChapterId;
        setActiveImageCue(null);
        setShowImageCuePreview(false);

        if (nextReadableChapterId) {
            beginChapterTransition(nextReadableChapterId, 0);
            return;
        }

        setShowChapters(true);
    }, [beginChapterTransition]);

    const moveToWord = useCallback((wordIndex: number) => {
        if (wordIndex < 0 && currentChapterRef.current) {
            const previousChapter = findPreviousReadableChapter(chaptersRef.current, currentChapterRef.current.id);
            if (previousChapter) {
                beginChapterTransition(
                    previousChapter.id,
                    Math.max(0, previousChapter.content.length + wordIndex),
                );
            }
            return;
        }

        if (wordIndex >= wordsRef.current.length && currentChapterRef.current) {
            const nextChapter = findNextReadableChapter(chaptersRef.current, currentChapterRef.current.id);
            if (nextChapter) {
                beginChapterTransition(nextChapter.id, Math.max(0, wordIndex - wordsRef.current.length));
            }
            return;
        }

        const nextIndex = Math.max(0, Math.min(wordsRef.current.length - 1, wordIndex));
        if (nextIndex === indexRef.current) return;

        indexRef.current = nextIndex;
        readerSessionController.dispatch({
            type: 'seek',
            chapterId: currentChapterRef.current?.id || '',
            wordIndex: nextIndex,
        });
        setCurrentWordIndex(nextIndex);
        if (currentChapterRef.current) {
            updateProgressMilestone(currentChapterRef.current.id, nextIndex, true);
        }
        const displayWord = resetDisplaySegments(wordsRef.current[nextIndex] || '');
        renderWord(nextIndex, wordsRef.current, true, displayWord);
    }, [beginChapterTransition, readerSessionController, renderWord, resetDisplaySegments, updateProgressMilestone]);

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

    const preventRsvpNativeTouchMove = useCallback((event: TouchEvent) => {
        event.preventDefault();
    }, []);

    const setRsvpTouchSurface = useCallback((node: HTMLDivElement | null) => {
        rsvpTouchSurfaceRef.current?.removeEventListener('touchmove', preventRsvpNativeTouchMove);
        rsvpTouchSurfaceRef.current = node;
        node?.addEventListener('touchmove', preventRsvpNativeTouchMove, { passive: false });
    }, [preventRsvpNativeTouchMove]);

    const handleRsvpTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            rsvpTapStartRef.current = { x: touch.clientX, y: touch.clientY };
            rsvpTapMovedRef.current = false;
            rsvpTouchLastSeekYRef.current = touch.clientY;
            rsvpTouchDidSeekRef.current = false;
            return;
        }

        if (e.touches.length !== 2) return;

        const [firstTouch, secondTouch] = [e.touches[0], e.touches[1]];
        pinchGestureRef.current = {
            distance: getTouchDistance(firstTouch, secondTouch),
            scale: lensScaleRef.current,
        };
        rsvpTapStartRef.current = null;
        rsvpTouchLastSeekYRef.current = null;
        rsvpTouchDidSeekRef.current = false;
        suppressNextRsvpTapRef.current = true;
    }, []);

    const handleRsvpTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 1 && rsvpTapStartRef.current) {
            const touch = e.touches[0];
            const deltaX = touch.clientX - rsvpTapStartRef.current.x;
            const deltaY = touch.clientY - rsvpTapStartRef.current.y;
            const movement = Math.hypot(deltaX, deltaY);

            if (movement > TOUCH_TAP_MAX_MOVEMENT_PX) {
                rsvpTapMovedRef.current = true;
                suppressNextRsvpTapRef.current = true;
            }

            const isVerticalDrag = rsvpTouchDidSeekRef.current || Math.abs(deltaY) > Math.abs(deltaX);
            if (!rsvpTapMovedRef.current || !isVerticalDrag) return;

            e.preventDefault();
            if (isPlayingRef.current) setIsPlaying(false);

            const lastSeekY = rsvpTouchLastSeekYRef.current ?? rsvpTapStartRef.current.y;
            const deltaSinceLastSeek = touch.clientY - lastSeekY;
            let wordDelta = 0;

            if (!rsvpTouchDidSeekRef.current) {
                wordDelta = Math.sign(-deltaY) * Math.max(1, Math.round(Math.abs(deltaY) / TOUCH_WORD_STEP_PX));
            } else if (Math.abs(deltaSinceLastSeek) >= TOUCH_WORD_STEP_PX) {
                wordDelta = Math.sign(-deltaSinceLastSeek) * Math.floor(Math.abs(deltaSinceLastSeek) / TOUCH_WORD_STEP_PX);
            }

            if (wordDelta !== 0) {
                moveToWord(indexRef.current + wordDelta);
                rsvpTouchDidSeekRef.current = true;
                rsvpTouchLastSeekYRef.current = touch.clientY;
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
    }, [moveToWord, setIsPlaying, updateLensScale]);

    const handleRsvpTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const wasPinching = pinchGestureRef.current !== null;
        if (e.touches.length < 2) {
            pinchGestureRef.current = null;
        }

        if (e.touches.length === 0) {
            if (!wasPinching && rsvpTapMovedRef.current) {
                suppressNextRsvpTapRef.current = true;
                window.setTimeout(() => {
                    suppressNextRsvpTapRef.current = false;
                }, 0);
            }

            rsvpTapStartRef.current = null;
            rsvpTapMovedRef.current = false;
            rsvpTouchLastSeekYRef.current = null;
            rsvpTouchDidSeekRef.current = false;
        }
    }, []);

    const handleRsvpClick = useCallback(() => {
        if (countdown !== null) return;
        if (activeImageCueRef.current) return;

        if (chapterTransitionPhase === 'braking' || chapterTransitionPhase === 'crossing') {
            const shouldPauseAfterTransition = !pauseAfterChapterTransitionRef.current;
            pauseAfterChapterTransitionRef.current = shouldPauseAfterTransition;
            if (shouldPauseAfterTransition) {
                isPlayingRef.current = false;
                setIsPlaying(false);
            }
            return;
        }

        if (suppressNextRsvpTapRef.current) {
            suppressNextRsvpTapRef.current = false;
            return;
        }

        if (showTTSPlayerRef.current) return;

        const shouldPlay = !isPlayingRef.current;
        isPlayingRef.current = shouldPlay;
        setIsPlaying(shouldPlay);
    }, [countdown, chapterTransitionPhase, setIsPlaying]);

    const handleRsvpKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        event.stopPropagation();
        handleRsvpClick();
    }, [handleRsvpClick]);

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
                        if (!showTTSPlayerRef.current) setIsPlaying(!isPlayingRef.current);
                    } else {
                        // Jump to new word while preserving current playback state.
                        const wasPlaying = isPlayingRef.current;
                        indexRef.current = newIndex;
                        readerSessionController.dispatch({
                            type: 'seek',
                            chapterId: currentChapterRef.current?.id || '',
                            wordIndex: newIndex,
                        });
                        if (wasPlaying) {
                            readerSessionController.dispatch({ type: 'play', transport: 'rsvp' });
                        }
                        setCurrentWordIndex(newIndex);
                        const displayWord = resetDisplaySegments(wordsRef.current[newIndex] || '');
                        renderWord(newIndex, wordsRef.current, true, displayWord);
                    }
                    saveProgress();
                }
            }
        }
    };

    const closeContents = useCallback(() => {
        setShowChapters(false);
        setChapterHandoffSelection(null);
    }, []);

    const handleContentsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isDesktopLayout || event.key !== 'Tab' || !contentsPanelRef.current) return;

        const focusableElements = Array.from(contentsPanelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ));
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    }, [isDesktopLayout]);

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
            closeContents();
        }

        resetChapterDrawerSwipe();
    }, [closeContents, resetChapterDrawerSwipe]);

    // === BATTERY-OPTIMIZED PLAYBACK LOOP ===
    // Instead of polling at 60fps with rAF, we use setTimeout to sleep until
    // close to the next word, then use rAF for precise final timing.
    // This reduces CPU wake-ups from ~60/sec to ~5-10/sec (80-90% reduction).
    
    const calculateTargetInterval = useCallback((
        displayWord: string,
        densityFactor: number,
        isSegmentedToken: boolean,
        likelyProperNoun: boolean,
    ) => {
        const effectiveWpm = Math.max(1, wpmRef.current * playbackMomentumRef.current);
        return getTargetInterval(displayWord, densityFactor, effectiveWpm, {
            isSegmentedToken,
            isLikelyProperNoun: likelyProperNoun,
        });
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
        const activeFrame = planRsvpFrame(activeWords, indexRef.current, {
            phraseRankLimit: commonPhraseRankLimit,
            blockedIndexes: isSummaryActiveRef.current ? undefined : blockedIndexesRef.current,
        });
        activeFrameRef.current = activeFrame;

        const activeWord = activeWords[indexRef.current] || '';
        if (!activeWord) {
            setIsPlaying(false);
            return;
        }

        const isGroupedFrame = activeFrame.sourceWordCount > 1;
        if (!isGroupedFrame && (
            segmentedWordSourceRef.current !== activeWord ||
            currentWordSegmentsRef.current.length === 0
        )) {
            resetDisplaySegments(activeWord);
        }

        const segmentCount = isGroupedFrame ? 1 : currentWordSegmentsRef.current.length;
        const segmentIndex = Math.min(currentSegmentIndexRef.current, Math.max(0, segmentCount - 1));
        const displayWord = currentWordSegmentsRef.current[segmentIndex] || activeWord;

        const density = activeDensities[indexRef.current];
        const currentDensity = (density !== undefined && density > 0) ? density : 1.0;
        const densityFactor = segmentCount > 1 ? currentDensity / segmentCount : currentDensity;
        const likelyProperNoun = isLikelyProperNoun(activeWord, activeWords[indexRef.current - 1]);
        const effectiveWpm = Math.max(1, wpmRef.current * playbackMomentumRef.current);
        const targetInterval = isGroupedFrame
            ? getFrameTargetInterval(
                activeFrame,
                activeDensities,
                activeWords[activeFrame.startIndex - 1],
                effectiveWpm,
            )
            : calculateTargetInterval(displayWord, densityFactor, segmentCount > 1, likelyProperNoun);

        // Cap accumulator to prevent huge jumps
        if (accumulatorRef.current > Math.max(1000, targetInterval * 10)) {
            accumulatorRef.current = targetInterval;
        }

        const timeRemaining = targetInterval - accumulatorRef.current;

        // If we have significant time remaining, use setTimeout to sleep
        // This is the key battery optimization - don't poll at 60fps!
        if (timeRemaining > 50) {
            // Sleep for most of the remaining time, leaving 40ms for rAF precision
            const normalSleepTime = Math.max(10, timeRemaining - 40);
            const sleepTime = chapterTransitionActiveRef.current
                ? Math.min(50, normalSleepTime)
                : normalSleepTime;
            rsvpPlaybackClock.schedule(loopInternal, sleepTime);
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
                rsvpPlaybackClock.schedule(loopInternal);
                return;
            }

            const nextIndex = activeFrame.startIndex + activeFrame.sourceWordCount;
            if (!isSummaryActiveRef.current) {
                assertFrameDoesNotSkipProtectedIndex(activeFrame, blockedIndexesRef.current);
            }
            wordTimestampsRef.current.push({
                timeMs: processTimeRef.current,
                sourceWordCount: activeFrame.sourceWordCount,
            });

            if (nextIndex < activeWords.length) {
                indexRef.current = nextIndex;
                accumulatorRef.current -= targetInterval;

                if (
                    !isSummaryActiveRef.current &&
                    indexRef.current % 20 === 0 &&
                    currentChapterRef.current
                ) {
                    syncSchedulerCursor(currentChapterRef.current.id, indexRef.current);
                }

                if (!isSummaryActiveRef.current && currentChapterRef.current) {
                    updateProgressMilestone(currentChapterRef.current.id, indexRef.current, true);
                }

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
                indexRef.current = Math.max(0, activeWords.length - 1);
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
                const imageBreak = currentChapter
                    ? findImageBreakAfterChapter(chapters, currentChapter.id, imageCueAssignments)
                    : null;

                if (imageBreak) {
                    isPlayingRef.current = false;
                    setIsPlaying(false);
                    setShowImageCuePreview(false);
                    setActiveImageCue(imageBreak);
                    return;
                }

                const nextChapter = currentChapter
                    ? findNextReadableChapter(chapters, currentChapter.id)
                    : null;

                if (nextChapter) {
                    beginChapterTransition(nextChapter.id, 0);
                } else {
                    setIsPlaying(false);
                    setShowChapters(true);
                }
                return;
            }
        }

        // Continue loop - use rAF for precision timing in final approach
        rsvpPlaybackClock.schedule(loopInternal);
    }, [commonPhraseRankLimit, wpm, renderWord, beginChapterTransition, summaryWpm, startTransition, calculateTargetInterval, resetDisplaySegments, syncSchedulerCursor, setIsPlaying, updateProgressMilestone, imageCueAssignments, rsvpPlaybackClock]);

    // Sync refs
    useEffect(() => {
        if (!isSummaryActiveRef.current) {
            wpmRef.current = wpm;
        }
    }, [wpm]);

    useEffect(() => {
        chaptersRef.current = chapters;
        if (currentChapterRef.current && lastProgressMilestoneRef.current === null) {
            updateProgressMilestone(currentChapterRef.current.id, indexRef.current, false);
        }
    }, [chapters, updateProgressMilestone]);

    useEffect(() => {
        currentChapterRef.current = currentChapter;
        blockedIndexesRef.current = buildReaderBlockedIndexes(wordsRef.current, currentChapter);
        if (currentChapter && lastProgressMilestoneRef.current === null) {
            updateProgressMilestone(currentChapter.id, indexRef.current, false);
        }
    }, [currentChapter, updateProgressMilestone]);

    useEffect(() => {
        setActiveImageCue(null);
        setShowImageCuePreview(false);
    }, [currentChapter?.id]);

    useEffect(() => {
        if (currentChapter) {
            syncSchedulerCursor(currentChapter.id, currentWordIndex);
        }
    }, [chapters, currentChapter, currentWordIndex, syncSchedulerCursor]);

    // Suspend RSVP auto-advance while the TTS listen panel is open. Both the
    // wpm-paced RSVP loop and the audio-timed TTS callback write currentWordIndex
    // independently; without this, the highlight races ahead of speech on its own
    // clock and keeps getting snapped back by the TTS position sync.
    useEffect(() => {
        showTTSPlayerRef.current = showTTSPlayer;
        if (showTTSPlayer && isPlaying) {
            setIsPlaying(false);
        }
    }, [showTTSPlayer, isPlaying, setIsPlaying]);

    useEffect(() => {
        if (ttsPlaybackActive) {
            readerSessionController.dispatch({ type: 'claim-transport', transport: 'tts' });
        } else if (readerSessionSnapshot.transport === 'tts') {
            readerSessionController.dispatch({ type: 'release-transport', transport: 'tts' });
        }
    }, [readerSessionController, readerSessionSnapshot.transport, ttsPlaybackActive]);

    useEffect(() => {
        const wasActive = wasTTSPlaybackActiveRef.current;
        wasTTSPlaybackActiveRef.current = ttsPlaybackActive;

        if (wasActive && !ttsPlaybackActive) {
            setCurrentWordIndex(indexRef.current);
        }
    }, [ttsPlaybackActive]);

    useEffect(() => {
        if (!ttsPlaybackActive) return;

        const interval = window.setInterval(() => {
            const wordIndex = indexRef.current;
            const displayWord = getDisplayWordForCurrentSegment(wordsRef.current[wordIndex] || '');
            renderWord(wordIndex, wordsRef.current, true, displayWord);
        }, TTS_RIVER_REFRESH_INTERVAL_MS);

        return () => window.clearInterval(interval);
    }, [getDisplayWordForCurrentSegment, renderWord, ttsPlaybackActive]);

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
            rsvpPlaybackClock.schedule(loop);
        }
        return () => {
            rsvpPlaybackClock.cancel();
        };
    }, [isPlaying, playbackSession, saveProgress, loop, renderWord, getDisplayWordForCurrentSegment, setIsPlaying, rsvpPlaybackClock]);

    // Spacebar to toggle play/pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [role="button"]')) return;
            if (activeImageCueRef.current) return;

            if (e.code === 'Space') {
                e.preventDefault(); // Prevent scrolling
                if (!showTTSPlayerRef.current) setIsPlaying(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setIsPlaying]);

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
            const recentTimestamps = wordTimestampsRef.current.filter(({ timeMs }) => timeMs > oldTime);
            wordTimestampsRef.current = recentTimestamps; // Prune old entries
            
            // Calculate WPM based on words in last window
            if (recentTimestamps.length >= 2) {
                const oldestTimestamp = recentTimestamps[0].timeMs;
                const newestTimestamp = recentTimestamps[recentTimestamps.length - 1].timeMs;
                const consumedWords = recentTimestamps.reduce(
                    (total, event) => total + event.sourceWordCount,
                    0,
                );
                
                // Effective duration over the span of words
                const timeSpanMs = newestTimestamp - oldestTimestamp;
                
                // Need at least 1 second of data to be stable
                if (timeSpanMs > 1000) {
                    const timeSpanMinutes = timeSpanMs / 60000;
                    const wordsPerMinute = Math.round(consumedWords / timeSpanMinutes);
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
            transitionSequenceRef.current?.cancel();
            if (progressReminderTimerRef.current) clearTimeout(progressReminderTimerRef.current);
            void saveProgressRef.current();
        };
    }, []);

    // Load initial state & Subscribe to chapters
    useEffect(() => {
        const loadState = async () => {
            setLoading(true);
            setContentUnavailable(false);

            void readerDataSource.subscribeToChapters(book.id, setChapters);
            void readerDataSource.subscribeToBook(book.id, (bookData) => {
                setGlobalSummaries(bookData.globalSummaries || []);
            });
            void readerDataSource.subscribeToImages(book.id, setBookImages);

            // Get reading state
            const state = await readerDataSource.getOrCreateReadingState(book.id, book.chapterIds[0]);
            if (!state) return;

            const stateDoc = state.toJSON() as ReadingStateDocType;
            const latestTTSPosition = stateDoc.ttsPosition
                && stateDoc.ttsPosition.timestamp >= stateDoc.lastRead
                ? stateDoc.ttsPosition
                : null;
            setReadingState(stateDoc);
            readingStatePatchRef.current = (patch) => state.incrementalPatch(patch);
            lastSavedPositionRef.current = (latestTTSPosition?.chapterId || stateDoc.currentChapterId)
                ? {
                    chapterId: latestTTSPosition?.chapterId || stateDoc.currentChapterId!,
                    wordIndex: latestTTSPosition?.wordIndex ?? stateDoc.currentWordIndex,
                }
                : null;

            // Only run the initial chapter load once per book.id. Subsequent re-runs of
            // this effect (e.g. when book.chapterIds reference or loadChapter identity
            // changes during playback) must NOT call loadChapter again, otherwise the
            // reader rewinds to the last persisted currentWordIndex (saveProgress is
            // throttled to 5s).
            if (initialLoadAppliedForBookRef.current !== book.id) {
                initialLoadAppliedForBookRef.current = book.id;
                const requestedChapterId = latestTTSPosition?.chapterId
                    || stateDoc.currentChapterId
                    || book.chapterIds?.[0];
                const requestedChapterDoc = requestedChapterId
                    ? await readerDataSource.findChapter(requestedChapterId)
                    : null;
                const requestedChapter = requestedChapterDoc || undefined;

                if (requestedChapter && isReadableChapter(requestedChapter)) {
                    loadChapter(
                        requestedChapter.id,
                        latestTTSPosition?.wordIndex ?? stateDoc.currentWordIndex,
                    );
                } else {
                    const chapterDocs = await readerDataSource.listChapters(book.id);
                    const firstReadableChapter = chapterDocs.find(isReadableChapter);

                    if (firstReadableChapter) {
                        loadChapter(firstReadableChapter.id, 0);
                    } else {
                        waitingForReadableChapterRef.current = true;
                    }
                }
            }
        };
        void loadState();
    }, [book.id, book.chapterIds, loadChapter, readerDataSource]);

    useEffect(() => {
        if (!waitingForReadableChapterRef.current || currentChapter) return;

        const firstReadableChapter = chapters.find(isReadableChapter);
        if (firstReadableChapter) {
            waitingForReadableChapterRef.current = false;
            setContentUnavailable(false);
            loadChapter(firstReadableChapter.id, 0);
            return;
        }

        // Once every chapter has settled (nothing left pending/processing) and still
        // none are readable, background processing isn't going to produce content —
        // stop spinning forever and tell the reader instead of hanging silently.
        const stillProcessing = chapters.some(c => c.status === 'pending' || c.status === 'processing');
        if (chapters.length > 0 && !stillProcessing) {
            setContentUnavailable(true);
        }
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
                renderWord(currentWordIndex, wordsRef.current, !ttsPlaybackActive, displayWord);
                initialRenderDoneRef.current = true;
            }
        }
    }, [loading, currentChapter, currentWordIndex, renderWord, getDisplayWordForCurrentSegment, isCompactLandscape, ttsPlaybackActive]);

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

    useEffect(() => {
        setOpenNoteId(null);
        autoPausedNoteRef.current = null;
    }, [currentChapter?.id]);

    useEffect(() => {
        if (!activeNoteAnchor) {
            autoPausedNoteRef.current = null;
            return;
        }

        if (noteAutoPause && isPlaying && autoPausedNoteRef.current !== activeNoteAnchor.id) {
            autoPausedNoteRef.current = activeNoteAnchor.id;
            setIsPlaying(false);
        }
    }, [activeNoteAnchor, isPlaying, noteAutoPause, setIsPlaying]);

    if (loading && !currentChapter) {
        return (
            <div className="relative flex h-full min-h-0 items-center justify-center bg-basalt text-white">
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="absolute left-4 top-4 inline-flex min-h-11 items-center gap-2 rounded border border-white/15 bg-black/30 px-3 text-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Back to library"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Library</span>
                    </button>
                )}
                <div className="max-w-sm px-6 text-center" role="status" aria-live="polite">
                    {contentUnavailable ? (
                        <>
                            <AlertTriangle className="mx-auto mb-4 h-6 w-6 text-amber-300" />
                            <p className="font-mono text-sm text-white/80">Couldn't extract readable text</p>
                            <p className="mt-1 text-xs text-white/40">
                                This file has no usable text after processing — it may be a scanned or
                                image-only document. Try a different file, or a version with a text layer.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
                            <p className="font-mono text-sm text-white/80">Loading book...</p>
                            <p className="mt-1 text-xs text-white/40">Preparing the text</p>
                        </>
                    )}
                </div>
            </div>
        );
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

    const readableChapters = chapters.filter(isReadableChapter);
    const totalReadableWords = readableChapterWordIndex.totalWords;
    const currentChapterNumber = currentChapter
        ? readableChapters.findIndex((chapter) => chapter.id === currentChapter.id) + 1
        : 0;
    const globalWordIndex = currentChapter
        ? getGlobalWordIndexFromIndex(readableChapterWordIndex, currentChapter.id, currentWordIndex)
        : 0;
    const bookProgress = totalReadableWords > 0
        ? Math.min(100, Math.max(0, Math.round((globalWordIndex / totalReadableWords) * 100)))
        : 0;
    const isTransitioning = countdown !== null || chapterTransitionPhase !== null;
    const hasSeenDestinationHistory = currentWordIndex > contextHistoryStartRef.current;

    // Color based on actual speed vs target
    const speedColor = actualWpm === 0 ? 'text-gray-500' : 
        actualWpm < wpm * 0.8 ? 'text-blue-400' : 
        actualWpm > wpm * 1.2 ? 'text-cyan-300' : 'text-emerald-300';

    // Calculate word to render for React (to avoid stale content on re-renders)
    // When playing, the loop updates the DOM directly.
    // When paused or when state changes (like isSummaryActive), React re-renders.
    // We need to ensure React renders the correct word so it doesn't overwrite the loop's work with stale data.
    // Use currentChapter.content for React rendering (state-driven) rather than wordsRef (which doesn't trigger re-renders)
    const liveWordIndex = ttsPlaybackActive ? indexRef.current : currentWordIndex;
    const wordToRender = isSummaryActive 
        ? (summaryWordsRef.current[indexRef.current] || '')
        : (currentChapter?.content?.[liveWordIndex] || wordsRef.current[liveWordIndex] || '');
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
    const activeNotePreview = activeNote?.text.replace(/\s+/g, ' ').trim().slice(0, 280) || '';
    const activeNoteLabel = activeNote?.label || activeNoteAnchor?.markerText || 'Note';
    const shouldShowNoteCue = !isSummaryActive
        && notePresentation !== 'notes-only'
        && Boolean(activeNote && activeNoteAnchor);
    const openedNoteAnchor = openedNote
        ? currentChapter?.noteAnchors?.find((anchor) => anchor.noteId === openedNote.id) || null
        : null;

    return (
        <div
            data-testid="reader-shell"
            className={clsx(
                'reader-shell relative w-full h-full min-h-0 text-white overflow-hidden flex',
                focusModeEnabled && 'reader-shell--focus',
            )}
        >
            <div
                className="reader-book-progress reader-focus-fade"
                role="progressbar"
                aria-label="Book reading progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={bookProgress}
                aria-hidden={focusModeEnabled}
            >
                <span style={{ width: `${bookProgress}%` }} />
            </div>
            {progressReminder !== null && (
                <div className="reader-progress-reminder reader-focus-fade" aria-live="polite">
                    {progressReminder}% through book
                </div>
            )}
            {activeImageCue && (
                <div className="reader-image-cue" role="status" aria-live="polite">
                    <div className="reader-image-cue__copy">
                        <strong>Illustration nearby</strong>
                        <span>{activeImageCue.imageCount > 1 ? `${activeImageCue.imageCount} images between sections` : 'Image between sections'}</span>
                    </div>
                    <div className="reader-image-cue__actions">
                        <button
                            type="button"
                            onClick={() => setShowImageCuePreview(true)}
                            disabled={!activeImageCue.primaryImage?.src}
                            className="reader-image-cue__button"
                        >
                            View image
                        </button>
                        <button
                            type="button"
                            onClick={continueAfterImageCue}
                            className="reader-image-cue__button reader-image-cue__button--primary"
                        >
                            Continue reading
                        </button>
                    </div>
                </div>
            )}
            {activeImageCue?.primaryImage?.src && showImageCuePreview && (
                <div className="reader-image-preview" role="dialog" aria-modal="true" aria-label="Illustration preview">
                    <button
                        type="button"
                        onClick={() => setShowImageCuePreview(false)}
                        className="reader-image-preview__close"
                        aria-label="Close image preview"
                    >
                        <X className="h-4 w-4" />
                    </button>
                    <div className="reader-image-preview__frame">
                        <img
                            src={activeImageCue.primaryImage.src}
                            alt={activeImageCue.primaryImage.filename || activeImageCue.primaryImage.chapterTitle || 'Illustration'}
                            className="reader-image-preview__image"
                        />
                    </div>
                    <p className="reader-image-preview__caption">
                        {activeImageCue.primaryImage.filename || activeImageCue.primaryImage.chapterTitle || 'Illustration'}
                    </p>
                    <button
                        type="button"
                        onClick={continueAfterImageCue}
                        className="reader-image-preview__resume"
                    >
                        Resume reading
                    </button>
                </div>
            )}
            {/* Floating Header / Controls */}
            <div className={clsx(
                'reader-toolbar absolute top-0 left-0 right-0 z-[90] p-2 md:p-4 flex justify-between items-start pointer-events-none',
                isDesktopLayout && showChapters && 'reader-toolbar--contents-open',
            )}>
                {onBack ? (
                    <button
                        onClick={onBack}
                        className="reader-toolbar-button reader-focus-fade pointer-events-auto bg-black/40 backdrop-blur-md border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-lg"
                        title="Back to Archive"
                        aria-label="Back to Archive"
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                    >
                        <ArrowLeft className="h-5 w-5 md:h-6 md:w-6" />
                    </button>
                ) : (
                    <div className="w-10 md:w-12" />
                )}

                <div
                    data-testid="reader-toolbar-controls"
                    className="reader-toolbar-controls pointer-events-auto relative flex items-start"
                >
                    {/* Focus Mode Button */}
                    <button
                        onClick={handleToggleFocusMode}
                        className={clsx('reader-toolbar-button reader-focus-toggle', focusModeEnabled && 'reader-toolbar-button--active')}
                        title={focusModeEnabled ? 'Exit Focus Mode' : 'Focus Mode (hide distractions)'}
                        aria-label={focusModeEnabled ? 'Exit Focus Mode' : 'Focus Mode'}
                        aria-pressed={focusModeEnabled}
                    >
                        <Focus className="reader-toolbar-icon" />
                        <span className="reader-toolbar-label">Focus</span>
                    </button>

                    {/* AI Toggle Button */}
                    <button
                        onClick={() => {
                            if (aiEnabled) {
                                setAiEnabled(false);
                                return;
                            }
                            if (aiIsLoading) return;
                            if (aiIsReady) {
                                setAiEnabled(true);
                                return;
                            }
                            requestAiSetup('pacing');
                        }}
                        className={clsx(
                            'reader-toolbar-button reader-focus-fade',
                            aiEnabled && 'reader-toolbar-button--active',
                            aiIsLoading && 'reader-toolbar-button--loading',
                        )}
                        title={pacingControlLabel}
                        aria-label={pacingControlLabel}
                        aria-pressed={aiEnabled}
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                        disabled={aiIsLoading}
                    >
                        <span className="reader-pacing-icon" aria-hidden="true">
                            <Gauge className="reader-toolbar-icon" />
                            {aiIsLoading && (
                                <svg className="reader-pacing-progress" viewBox="0 0 24 24" data-testid="pacing-setup-progress">
                                    <circle className="reader-pacing-progress__track" cx="12" cy="12" r="10" pathLength="100" />
                                    <circle
                                        className="reader-pacing-progress__value"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        pathLength="100"
                                        style={{ strokeDashoffset: 100 - aiSetupPercent }}
                                    />
                                </svg>
                            )}
                        </span>
                        <span className="reader-toolbar-label">Pacing</span>
                    </button>

                    {/* TTS / Listen Button */}
                    <button
                        onClick={() => {
                            const next = !showTTSPlayer;
                            setShowTTSPlayer(next);
                            if (next) setIsPlaying(false);
                        }}
                        className={clsx(
                            'reader-toolbar-button reader-focus-fade',
                            (showTTSPlayer || ttsPlaybackState === 'playing') && 'reader-toolbar-button--active',
                        )}
                        title="Listen (Text to Speech)"
                        aria-label="Listen"
                        aria-pressed={showTTSPlayer || ttsPlaybackState === 'playing'}
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                    >
                        <Headphones className="reader-toolbar-icon" />
                        <span className="reader-toolbar-label">Audio</span>
                    </button>

                    {bookNotes.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setShowNotes(true);
                                setShowChapters(false);
                            }}
                            className="reader-toolbar-button reader-focus-fade"
                            title="Open retained notes"
                            aria-label={`Notes${bookNotes.length > 0 ? ` (${bookNotes.length})` : ''}`}
                            aria-hidden={focusModeEnabled}
                            tabIndex={focusModeEnabled ? -1 : undefined}
                        >
                            <BookOpenText className="reader-toolbar-icon" />
                            <span className="reader-toolbar-label">Notes</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setShowExchange(true)}
                        className="reader-toolbar-button reader-focus-fade"
                        title="Continue on another device"
                        aria-label="Continue on another device"
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                    >
                        <Share2 className="reader-toolbar-icon" />
                        <span className="reader-toolbar-label">Share</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setTheme(isDayTheme ? 'volcanic' : 'day')}
                        className="reader-toolbar-button reader-focus-fade"
                        title={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
                        aria-label={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                    >
                        {isDayTheme ? <Moon className="reader-toolbar-icon" /> : <Sun className="reader-toolbar-icon" />}
                        <span className="reader-toolbar-label">Theme</span>
                    </button>
                    
                    {/* Chapters Button */}
                    <button
                        ref={contentsTriggerRef}
                        type="button"
                        onClick={() => setShowChapters(!showChapters)}
                        data-testid="toggle-chapters"
                        className={clsx('reader-toolbar-button reader-focus-fade', showChapters && 'reader-toolbar-button--active')}
                        title="Contents"
                        aria-label="Contents"
                        aria-expanded={showChapters}
                        aria-controls="reader-contents"
                        aria-hidden={focusModeEnabled}
                        tabIndex={focusModeEnabled ? -1 : undefined}
                    >
                        <List className="reader-toolbar-icon" />
                        <span className="reader-toolbar-label">Contents</span>
                    </button>

                </div>
            </div>

            {/* Backdrop click-shield for sidebar on mobile/small-screens */}
            <div
                className={clsx(
                    'reader-contents-backdrop fixed left-0 right-0 bottom-0 bg-black/60 backdrop-blur-xs z-[75] md:hidden transition-opacity',
                    showChapters
                        ? (transitionKind === 'chapter' ? 'opacity-100 pointer-events-none' : 'opacity-100')
                        : 'opacity-0 pointer-events-none',
                )}
                onClick={closeContents}
                aria-hidden="true"
            />

            {/* Contents rail/drawer */}
            <div
                id="reader-contents"
                data-testid="sidebar-container"
                ref={contentsPanelRef}
                className={clsx(
                    'reader-contents-panel fixed right-0 z-[80] transform',
                    showChapters ? 'translate-x-0' : 'translate-x-full pointer-events-none',
                    transitionKind === 'chapter' && chapterTransitionPhase !== null && 'pointer-events-none',
                )}
                role={isDesktopLayout ? 'navigation' : 'dialog'}
                aria-modal={isDesktopLayout ? undefined : true}
                aria-labelledby="reader-contents-title"
                aria-hidden={!showChapters}
                inert={!showChapters}
                onKeyDown={handleContentsKeyDown}
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
                        beginChapterTransition(id, index ?? 0, index ?? null);
                    }}
                    wpm={wpm}
                    currentWordIndex={currentWordIndex}
                    now={now}
                    activeSummaryId={activeSummaryId}
                    globalSummaries={globalSummaries}
                    structureMode={book.structureMode}
                    onPlayGlobalSummary={handlePlayGlobalSummary}
                    onClose={closeContents}
                    isOpen={showChapters}
                    isModal={!isDesktopLayout}
                    chapterHandoffSelection={chapterHandoffSelection}
                    chapterHandoffActive={transitionKind === 'chapter' && chapterTransitionPhase !== null}
                />
            </div>

            {showNotes && (
                <div
                    data-testid="reader-notes-view"
                    className="fixed inset-0 z-[85] flex items-start justify-end bg-black/55 pt-16 backdrop-blur-sm md:pt-20"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reader-notes-title"
                >
                    <button
                        type="button"
                        className="absolute inset-0 cursor-default"
                        onClick={() => setShowNotes(false)}
                        aria-label="Close notes"
                    />
                    <section className="relative flex h-[calc(100%-4rem)] max-h-[48rem] w-full flex-col border-l border-white/10 bg-basalt shadow-2xl md:h-[calc(100%-5rem)] md:w-[min(38rem,92vw)]">
                        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/70">Retained PDF material</p>
                                <h2 id="reader-notes-title" className="mt-1 text-lg font-semibold text-white">Notes</h2>
                                <p className="mt-1 text-xs text-white/45">{bookNotes.length} note{bookNotes.length === 1 ? '' : 's'} kept outside the body stream.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowNotes(false)}
                                className="rounded border border-white/15 p-2 text-white/60 transition-colors hover:border-white/40 hover:text-white"
                                aria-label="Close notes"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4 md:px-6">
                            {bookNotes.length === 0 ? (
                                <p className="py-8 text-sm text-white/50">No retained notes were found in this book.</p>
                            ) : (
                                <div className="divide-y divide-white/10">
                                    {bookNotes.map(({ chapter, note, anchor }) => {
                                        const noteTitle = `Note ${note.label || 'unlabeled'}`;
                                        const noteBody = note.text.replace(/\s+/g, ' ').trim();
                                        const noteRow = (
                                            <div className="py-4 first:pt-1">
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100/70">
                                                    <span>{noteTitle}</span>
                                                    <span className="text-white/35">{note.kind.replace('-', ' ')}</span>
                                                    {anchor ? (
                                                        <span className="text-cyan-200/60">Linked word {anchor.wordIndex + 1}</span>
                                                    ) : (
                                                        <span className="text-white/40">Page {note.pageStart}</span>
                                                    )}
                                                    {anchor && anchor.confidence < 0.8 && <span className="text-white/40">Possible link</span>}
                                                </div>
                                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/70">{noteBody}</p>
                                                <p className="mt-2 text-[11px] text-white/35">{chapter.title} / source page {note.pageStart}</p>
                                            </div>
                                        );

                                        return anchor ? (
                                            <button
                                                type="button"
                                                key={note.id}
                                                className="block w-full text-left transition-colors hover:bg-white/[0.03]"
                                                onClick={() => {
                                                    setShowNotes(false);
                                                    beginChapterTransition(chapter.id, anchor.wordIndex, anchor.wordIndex);
                                                }}
                                                aria-label={`Jump to ${noteTitle}`}
                                            >
                                                {noteRow}
                                            </button>
                                        ) : (
                                            <div key={note.id}>{noteRow}</div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            )}

            {/* Main Reader Area (Full Screen) - uses responsive margins to prevent shifting/squishing text on mobile */}
            <div
                className={clsx(
                    'reader-main-stage flex-1 h-full relative flex flex-col min-w-0 pb-20 md:pb-0 transition-all duration-300',
                    isDesktopLayout && showChapters && 'reader-main-stage--contents-open',
                )}
            >
                <div className={clsx(
                    'reader-reading-plane w-full h-full flex flex-col relative group mx-auto',
                    chapterPulseActive && 'reader-reading-plane--chapter-arrival',
                    chapterTransitionPhase && `reader-reading-plane--${chapterTransitionPhase}`,
                )}>

                    {/* Top Zone: Previous Context */}
                    <div 
                        className="reader-context-region reader-context-region--top reader-focus-fade flex-1 w-full overflow-hidden relative flex justify-center"
                        aria-hidden={focusModeEnabled}
                        inert={focusModeEnabled}
                    >
                        <div 
                            ref={prevContainerRef} 
                            data-testid="reader-context-top"
                            className={`reader-context-panel reader-scroll-surface w-full h-full flex flex-wrap content-end justify-start p-8 md:p-14 font-mono text-lg md:text-xl leading-relaxed select-none overflow-y-auto overflow-x-hidden overscroll-contain cursor-text ${riverTopEnabled ? '' : 'invisible'}`}
                            onClick={handleRiverClick}
                            onScroll={handleRiverScroll}
                            style={{ touchAction: 'pan-y pinch-zoom' }}
                        ></div>
                        {currentChapter && hasSeenDestinationHistory && (
                            <div className="reader-river-marker reader-river-marker--chapter" aria-hidden="true">
                                <span>Chapter {String(currentChapterNumber).padStart(2, '0')}</span>
                                <span className="reader-river-marker__detail">{currentChapter.title}</span>
                            </div>
                        )}
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

                    {transitionKind === 'chapter' && transitionLabel && (
                        <div className="sr-only" role="status" aria-live="polite">
                            {transitionLabel}
                        </div>
                    )}

                    {/* Middle Zone: RSVP (Click to Toggle) */}
                    <div
                        data-testid="rsvp-container"
                        className="reader-focus-region relative h-48 w-full flex items-center justify-center z-30 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"
                        onClick={handleRsvpClick}
                        onKeyDown={handleRsvpKeyDown}
                        role="button"
                        tabIndex={0}
                        aria-label={isPlaying ? 'Pause reading' : 'Play reading'}
                        aria-pressed={isPlaying}
                    >
                        {/* Text area container with border */}
                        <div 
                            ref={setRsvpTouchSurface}
                            className="reader-focus-lane w-full h-full flex items-center justify-center transition-colors cursor-zoom-in"
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
                                className={`${rsvpTypographyClass} pointer-events-none font-mono tracking-tight whitespace-nowrap ${displayPlugin.getContainerClass()} ${isSummaryActive ? 'text-cyan-300 italic opacity-80' : 'text-white'}`}
                                style={rsvpContainerStyle}
                            />
                        </div>

                        {lensScale !== LENS_SCALE_DEFAULT && (
                            <div className="absolute top-2 right-2 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-white/70 pointer-events-none">
                                Zoom {Math.round(lensScale * 100)}%
                            </div>
                        )}

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
                        {(!isPlaying && !isTransitioning) && (
                            <div data-testid="play-overlay" className="reader-focus-fade absolute bottom-3 left-3 pointer-events-none animate-in fade-in duration-200">
                                <div className="flex min-h-11 items-center gap-2 px-3 text-white/70">
                                    <Play className="h-4 w-4 fill-current" />
                                    <span className="text-xs font-semibold">Play</span>
                                </div>
                            </div>
                        )}
                        
                        {/* Summary transitions retain an explicit countdown; chapter handoffs are purely kinetic. */}
                        {isTransitioning && transitionKind !== 'chapter' && (
                            <div
                                className={clsx(
                                    'reader-transition-overlay absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-50 animate-in fade-in duration-200 gap-4',
                                )}
                                role="status"
                                aria-live="polite"
                            >
                                {transitionLabel && (
                                    <div className="reader-transition-label font-mono text-sm uppercase px-3 py-1">
                                        {transitionLabel}
                                    </div>
                                )}
                                <div className="reader-transition-count font-mono text-8xl font-bold">
                                    {countdown}
                                </div>
                            </div>
                        )}
                    </div>

                    {shouldShowNoteCue && activeNote && activeNoteAnchor && (
                        <div
                            data-testid="reader-note-cue"
                            className="relative z-20 mx-auto w-[min(92%,42rem)] shrink-0 border-y border-amber-200/20 bg-black/25 px-4 py-3 text-left backdrop-blur-sm"
                        >
                            <div className="flex items-start gap-3">
                                <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/80" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100/80">
                                        <span>Note {activeNoteLabel}</span>
                                        {activeNoteAnchor.confidence < 0.8 && (
                                            <span className="text-white/40">Possible link</span>
                                        )}
                                        {noteAutoPause && !isPlaying && (
                                            <span className="text-cyan-200/70">RSVP paused</span>
                                        )}
                                    </div>
                                    {notePresentation === 'guided' && (
                                        <p className="mt-1 max-h-10 overflow-hidden text-xs leading-relaxed text-white/65">
                                            {activeNotePreview}{activeNote.text.length > activeNotePreview.length ? '...' : ''}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => openNote(activeNoteAnchor.noteId)}
                                    className="shrink-0 rounded border border-amber-200/30 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100 transition-colors hover:border-amber-100/70 hover:bg-amber-100/10"
                                    aria-label={`Open note ${activeNoteLabel}`}
                                >
                                    Open
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Bottom Zone: Next Context */}
                    <div 
                        className="reader-context-region reader-context-region--bottom reader-focus-fade flex-1 w-full overflow-hidden relative flex justify-center"
                        aria-hidden={focusModeEnabled}
                        inert={focusModeEnabled}
                    >
                        <div 
                            ref={nextContainerRef} 
                            data-testid="reader-context-bottom"
                            className={`reader-context-panel reader-scroll-surface w-full h-full flex flex-wrap content-start justify-start p-8 md:p-14 font-mono text-lg md:text-xl leading-relaxed select-none overflow-y-auto overflow-x-hidden overscroll-contain cursor-text ${riverBottomEnabled ? '' : 'invisible'}`}
                            onClick={handleRiverClick}
                            onScroll={handleRiverScroll}
                            style={{ touchAction: 'pan-y pinch-zoom' }}
                        ></div>
                        <div className="reader-river-marker reader-river-marker--progress" aria-hidden="true">
                            <span>{bookProgress}%</span>
                            <span className="reader-river-marker__detail">Book</span>
                        </div>
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
            <div
                data-testid="speed-controls"
                className={clsx(
                    'reader-speed-dock reader-focus-fade absolute inset-x-0 bottom-0 z-[70] h-20 px-4 flex items-center justify-center gap-2 md:inset-x-auto md:bottom-8 md:right-8 md:h-auto md:px-2 md:py-2 md:opacity-70 md:hover:opacity-100',
                    isDesktopLayout && showChapters && 'reader-speed-dock--contents-open',
                )}
                aria-hidden={focusModeEnabled}
                inert={focusModeEnabled}
            >
                
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
                    className="reader-speed-button p-2 text-white/60 hover:text-white transition-all active:scale-95"
                    title="Slower (-50 WPM)"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                </button>

                {/* WPM Display */}
                <div className="reader-speed-readout flex flex-col items-center px-4 py-1 min-w-[100px]">
                    {/* Target Speed (The setting) - Prominent for feedback */}
                    <div className="flex items-baseline gap-1 animate-in fade-in zoom-in duration-300">
                        <span className="text-2xl font-mono font-bold text-emerald-300 tabular-nums transition-all">
                            {wpm}
                        </span>
                        <span className="text-[10px] text-emerald-300/70 font-bold uppercase">WPM</span>
                    </div>
                    
                    {/* Real-time Velocity (The result) - Secondary */}
                    {actualWpm > 0 && (
                        <div className="flex items-center gap-2 mt-1 w-full justify-center">
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
                    className="reader-speed-button p-2 text-white/60 hover:text-white transition-all active:scale-95"
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
                            <h2 className="font-mono text-xl font-bold text-cyan-200 tracking-widest uppercase">{inspectingChapter.title} // DENSITY_MAP</h2>
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
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-emerald-400 rounded-full"></span> Slow (1.2-1.5)</div>
                            <div className="flex items-center gap-2"><span className="w-2 h-2 bg-blue-200 rounded-full animate-pulse"></span> Profound (&gt;2.0)</div>
                        </div>
                    </div>
                </div>
            )}

            {/* TTS Player */}
            {showTTSPlayer && currentChapter && (
                <div className="reader-focus-fade" aria-hidden={focusModeEnabled} inert={focusModeEnabled}>
                    <TTSPlayer
                        words={currentChapter.content}
                        paragraphBreaks={currentChapter.paragraphBreaks}
                        currentWordIndex={currentWordIndex}
                        getCurrentWordIndex={() => indexRef.current}
                        onPositionChange={(wordIndex) => {
                            indexRef.current = wordIndex;
                            const displayWord = resetDisplaySegments(wordsRef.current[wordIndex] || '');
                            renderWord(wordIndex, wordsRef.current, false, displayWord);
                        }}
                        onPositionCommit={(wordIndex) => {
                            indexRef.current = wordIndex;
                            setCurrentWordIndex(wordIndex);
                            const displayWord = resetDisplaySegments(wordsRef.current[wordIndex] || '');
                            renderWord(wordIndex, wordsRef.current, false, displayWord);
                            void saveProgressRef.current();
                        }}
                        bookId={book.id}
                        chapterId={currentChapter.id}
                        autoPlayChapterId={ttsAutoPlayChapterId}
                        onChapterEnd={handleTTSChapterEnd}
                        compact={false}
                        dockClassName={clsx(
                            isDesktopLayout && showChapters && 'reader-audio-dock--contents-open',
                            showChapters && 'opacity-0 pointer-events-none md:opacity-100 md:pointer-events-auto',
                        )}
                    />
                </div>
            )}

            {openedNote && (
                <div
                    data-testid="reader-note-sheet"
                    className="fixed inset-0 z-[100] flex items-end justify-end bg-black/55 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reader-note-sheet-title"
                >
                    <button
                        type="button"
                        className="absolute inset-0 cursor-default"
                        onClick={() => setOpenNoteId(null)}
                        aria-label="Close note"
                    />
                    <section className="relative flex max-h-[82vh] w-full flex-col border-t border-amber-200/20 bg-basalt shadow-2xl md:h-full md:max-h-none md:w-[min(32rem,92vw)] md:border-l md:border-t-0">
                        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/70">
                                    {openedNote.kind.replace('-', ' ')}
                                </p>
                                <h2 id="reader-note-sheet-title" className="mt-1 text-lg font-semibold text-white">
                                    Note {openedNote.label || openedNoteAnchor?.markerText || ''}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpenNoteId(null)}
                                className="rounded border border-white/15 p-2 text-white/60 transition-colors hover:border-white/40 hover:text-white"
                                aria-label="Close note"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
                            <p className="whitespace-pre-wrap text-sm leading-7 text-white/80">{openedNote.text}</p>
                            <div className="mt-6 border-t border-white/10 pt-4 text-xs text-white/45">
                                <p>Source page {openedNote.pageStart}{openedNote.pageEnd !== openedNote.pageStart ? `-${openedNote.pageEnd}` : ''}</p>
                                {openedNoteAnchor && (
                                    <p className="mt-1">
                                        Linked at body word {openedNoteAnchor.wordIndex + 1}
                                        {openedNoteAnchor.confidence < 0.8 ? ' with tentative confidence' : ''}.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4 md:px-6">
                            <button
                                type="button"
                                onClick={() => setOpenNoteId(null)}
                                className="rounded border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/65 transition-colors hover:border-white/40 hover:text-white"
                            >
                                Keep paused
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setOpenNoteId(null);
                                    setIsPlaying(true);
                                }}
                                className="rounded border border-cyan-200/40 bg-cyan-200/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-cyan-100 transition-colors hover:border-cyan-100 hover:bg-cyan-200/20"
                            >
                                Resume RSVP
                            </button>
                        </div>
                    </section>
                </div>
            )}

            <ExchangeSheet
                isOpen={showExchange}
                onClose={() => setShowExchange(false)}
                books={[book]}
                initialBookIds={[book.id]}
                initialIntent="handoff"
                continuation={currentChapter ? {
                    bookId: book.id,
                    chapterId: currentChapter.id,
                    wordIndex: currentWordIndex,
                    mode: ttsPlaybackState === 'playing' || ttsPlaybackState === 'paused' || ttsPlaybackState === 'generating'
                        ? 'listening'
                        : 'reading',
                    sentenceIndex: ttsPosition?.chapterId === currentChapter.id ? ttsPosition.sentenceIndex : undefined,
                    audioTime: ttsPosition?.chapterId === currentChapter.id ? ttsPosition.audioTime : undefined,
                } : undefined}
            />

        </div>
    );
};
