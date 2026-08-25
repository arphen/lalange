/**
 * TTS Player Controls Component
 * 
 * Floating audio player for seamless reading/listening transitions.
 * Shows current playback state, progress, and controls.
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { formatTTSPlaybackTime, useTTSStore } from '../../core/store/tts';
import { useShallow } from 'zustand/react/shallow';
import {
    initTTS,
    streamSpeech,
    splitIntoSentences,
    getVoice,
    getFallbackVoice,
    getVoiceEngine,
    isTTSModelCached,
    listVoices,
    predownloadPiperVoice,
    resolveVoiceId,
    type SentenceBoundary,
    type TTSAudioResult,
    type VoiceInfo,
} from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';
import { persistListeningHandoff } from '../../core/exchange/handoff';
import { FallbackAdvisor, type FallbackAdvisorSnapshot } from '../../core/tts/fallbackAdvisor';
import { RealtimePacer, type BufferSnapshot, type RealtimePacerSnapshot } from '../../core/tts/realtimePacer';
import { useTTSMediaSession } from '../../core/tts/useMediaSession';

// Configuration
const DEFAULT_BUFFER_AHEAD = 5;
const EMPTY_PARAGRAPH_BREAKS: number[] = [];

const findNearestSentenceIndex = (
    sentences: SentenceBoundary[],
    wordIndex: number,
): number => {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
        const sentence = sentences[sentenceIndex];
        if (wordIndex >= sentence.startWordIndex && wordIndex <= sentence.endWordIndex) {
            return sentenceIndex;
        }

        const distance = wordIndex < sentence.startWordIndex
            ? sentence.startWordIndex - wordIndex
            : wordIndex - sentence.endWordIndex;
        if (distance < nearestDistance) {
            nearestIndex = sentenceIndex;
            nearestDistance = distance;
        }
    }

    return nearestIndex;
};

const PlayIcon: React.FC = () => (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon: React.FC = () => (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
    </svg>
);

const StopIcon: React.FC = () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" />
    </svg>
);

const HeadphonesIcon: React.FC = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3c-4.97 0-9 4.03-9 9v7a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-1a2 2 0 00-2 2v3a2 2 0 002 2h1a2 2 0 002-2v-7c0-4.97-4.03-9-9-9z"
        />
    </svg>
);

const LoadingSpinner: React.FC = () => (
    <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
);

interface TTSPlayerProps {
    /** The words to speak */
    words: string[];
    /** Word indices after which an authored paragraph ends */
    paragraphBreaks?: number[];
    /** Current reading position (word index) */
    currentWordIndex: number;
    /** Returns the reader's imperative cursor when React state is intentionally throttled */
    getCurrentWordIndex?: () => number;
    /** Called when TTS position changes (for syncing reading position) */
    onPositionChange?: (wordIndex: number) => void;
    /** Called before the audio runtime resets its cursor during teardown or refresh */
    onPositionCommit?: (wordIndex: number) => void;
    /** Book and chapter IDs for position tracking */
    bookId?: string;
    chapterId?: string;
    /** Displayed in the OS media session (lock screen, notification, headset) */
    bookTitle?: string;
    bookAuthor?: string;
    chapterTitle?: string;
    coverImage?: string;
    /** Chapter ID requested by the reader for automatic continuation */
    autoPlayChapterId?: string | null;
    /** Called when the final sentence in this chapter has finished */
    onChapterEnd?: () => void;
    /** Compact mode for smaller screens */
    compact?: boolean;
    /** Optional placement overrides from parent layout */
    dockClassName?: string;
}

export const TTSPlayer: React.FC<TTSPlayerProps> = ({
    words,
    paragraphBreaks = EMPTY_PARAGRAPH_BREAKS,
    currentWordIndex,
    getCurrentWordIndex,
    onPositionChange,
    onPositionCommit,
    bookId,
    chapterId,
    bookTitle,
    bookAuthor,
    chapterTitle,
    coverImage,
    autoPlayChapterId = null,
    onChapterEnd,
    compact = false,
    dockClassName = '',
}) => {
    const {
        isLoading,
        error,
        playbackState,
        loadProgress,
        loadStatus,
        volume,
        speed,
        voice,
        activeVoiceOverride,
        backendPreference,
        bufferAhead,
        currentTime,
        continuityMode,
        pacingSnapshot,
        setVolume,
        setVoice,
        setActiveVoiceOverride,
        setPacingSnapshot,
        setContinuityMode,
        duration,
    } = useTTSStore(useShallow((state) => ({
        isLoading: state.isLoading,
        error: state.error,
        playbackState: state.playbackState,
        loadProgress: state.loadProgress,
        loadStatus: state.loadStatus,
        volume: state.volume,
        speed: state.speed,
        voice: state.voice,
        activeVoiceOverride: state.activeVoiceOverride,
        backendPreference: state.backendPreference,
        bufferAhead: state.bufferAhead,
        currentTime: state.currentTime,
        continuityMode: state.continuityMode,
        pacingSnapshot: state.pacingSnapshot,
        duration: state.duration,
        setVolume: state.setVolume,
        setVoice: state.setVoice,
        setActiveVoiceOverride: state.setActiveVoiceOverride,
        setPacingSnapshot: state.setPacingSnapshot,
        setContinuityMode: state.setContinuityMode,
    })));

    const currentTimeStr = formatTTSPlaybackTime(currentTime);
    const durationStr = formatTTSPlaybackTime(duration);
    
    const sentences = useMemo(
        () => splitIntoSentences(words, paragraphBreaks),
        [words, paragraphBreaks],
    );
    const [showVoiceMenu, setShowVoiceMenu] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [bufferedSentenceCount, setBufferedSentenceCount] = useState(0);
    const preferredVoice = resolveVoiceId(voice);
    const effectiveVoice = resolveVoiceId(activeVoiceOverride ?? preferredVoice);
    const fallbackCandidate = getFallbackVoice(preferredVoice);
    const selectedDevice = backendPreference === 'auto' ? undefined : backendPreference;
    const safeBufferAhead = Math.max(3, Math.min(12, bufferAhead || DEFAULT_BUFFER_AHEAD));
    const bufferSlotCount = Math.min(6, safeBufferAhead + 1);
    
    const generatorRef = useRef<AsyncGenerator<{ sentence: SentenceBoundary; audio: TTSAudioResult }> | null>(null);
    const isGeneratingRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const generationIdRef = useRef(0);
    const activeVoiceRef = useRef(effectiveVoice);
    const wordsRef = useRef<string[]>(words);
    const startSentenceIndexRef = useRef<number>(0);
    const hasStartedPlaybackRef = useRef(false); // Track if we've started with a valid position
    const lastHandoffPersistedAtRef = useRef(0);
    const bookIdRef = useRef<string | undefined>(bookId);
    const chapterIdRef = useRef<string | undefined>(chapterId);
    const chapterEndHandledRef = useRef(false);
    const autoPlayRequestHandledRef = useRef<string | null>(null);
    const wordsChapterIdRef = useRef(chapterId);
    const onPositionCommitRef = useRef(onPositionCommit);
    const pacerRef = useRef<RealtimePacer | null>(null);
    const activeDeviceRef = useRef(selectedDevice);
    const appliedSpeedRef = useRef(speed);
    const generationTaskRef = useRef<Promise<void> | null>(null);
    const fallbackAdvisorRef = useRef<FallbackAdvisor | null>(null);
    const lastBufferSnapshotRef = useRef<BufferSnapshot>({
        bufferedAudioSeconds: 0,
        isShrinking: false,
        nextAudioReady: false,
        deliveredWpm: null,
    });
    const fallbackTrialBaselineRef = useRef<RealtimePacerSnapshot | null>(null);
    const fallbackTrialAudioSecondsRef = useRef(0);
    const fallbackTrialSamplesRef = useRef(0);
    const fallbackTrialUnderrunsRef = useRef(0);
    const fallbackTransitionIdRef = useRef(0);
    const fallbackDownloadWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [fallbackAdvisorSnapshot, setFallbackAdvisorSnapshot] = useState<FallbackAdvisorSnapshot>(() => ({
        eligible: false,
        stableAudioSeconds: 0,
        lowSpeedSamplesInWindow: 0,
        underrunsInWindow: 0,
        dismissed: false,
        trialFailed: false,
        reason: 'measuring',
    }));
    const [fallbackCached, setFallbackCached] = useState<boolean | null>(null);
    const [fallbackCachedVoiceId, setFallbackCachedVoiceId] = useState<string | null>(null);
    const [fallbackDownloadVoiceId, setFallbackDownloadVoiceId] = useState<string | null>(null);
    const [fallbackDownloadState, setFallbackDownloadState] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
    const [fallbackDownloadProgress, setFallbackDownloadProgress] = useState(0);
    const [fallbackDownloadStatus, setFallbackDownloadStatus] = useState('');
    const [fallbackDownloadError, setFallbackDownloadError] = useState<string | null>(null);
    const [fallbackTrialState, setFallbackTrialState] = useState<'idle' | 'measuring' | 'not-better'>('idle');

    if (pacerRef.current === null) {
        pacerRef.current = new RealtimePacer(speed, continuityMode);
    }
    if (fallbackAdvisorRef.current === null) {
        fallbackAdvisorRef.current = new FallbackAdvisor();
    }
    const currentFallbackCached = fallbackCachedVoiceId === fallbackCandidate?.id ? fallbackCached : null;
    const currentFallbackDownloadState = fallbackDownloadVoiceId === fallbackCandidate?.id
        ? fallbackDownloadState
        : 'idle';
    const currentFallbackDownloadError = fallbackDownloadVoiceId === fallbackCandidate?.id
        ? fallbackDownloadError
        : null;

    const observeFallback = useCallback((
        snapshot: RealtimePacerSnapshot,
        measuredAudioSeconds = 0,
        isGenerationSample = false,
    ) => {
        const advisor = fallbackAdvisorRef.current;
        if (!advisor) return;

        const buffer = lastBufferSnapshotRef.current;
        const result = advisor.observe(snapshot, {
            engine: getVoiceEngine(activeVoiceRef.current),
            hasCandidate: fallbackCandidate !== undefined,
            isPlaying: ttsPlayer.getState().isPlaying,
            isWarmup: !hasStartedPlaybackRef.current,
            isGenerationSample,
            isBufferShrinking: buffer.isShrinking,
            bufferedAudioSeconds: buffer.bufferedAudioSeconds,
            measuredAudioSeconds,
            audibleTimeSeconds: ttsPlayer.getAudibleTime?.(),
        });
        setFallbackAdvisorSnapshot(result);
    }, [fallbackCandidate]);

    const resetFallbackAdvisor = useCallback((preserveTrialFailure = false) => {
        const advisor = fallbackAdvisorRef.current;
        if (advisor) setFallbackAdvisorSnapshot(advisor.reset({ preserveTrialFailure }));
        fallbackTrialBaselineRef.current = null;
        fallbackTrialAudioSecondsRef.current = 0;
        fallbackTrialSamplesRef.current = 0;
        fallbackTrialUnderrunsRef.current = 0;
        setFallbackTrialState('idle');
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!fallbackCandidate) return () => {
            cancelled = true;
        };

        void isTTSModelCached(fallbackCandidate.id).then((cached) => {
            if (!cancelled) {
                setFallbackCachedVoiceId(fallbackCandidate.id);
                setFallbackCached(cached);
            }
        }).catch(() => {
            if (!cancelled) {
                setFallbackCachedVoiceId(fallbackCandidate.id);
                setFallbackCached(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [fallbackCandidate]);

    const refreshBufferedSentenceCount = useCallback((sentenceIndex?: number) => {
        const currentSentenceIndex = sentenceIndex ?? useTTSStore.getState().currentSentence ?? 0;
        const hasCurrentSentence = ttsPlayer.hasAudioForSentence(currentSentenceIndex);
        const nextCount = hasCurrentSentence
            ? 1 + ttsPlayer.getBufferedAheadCount(currentSentenceIndex)
            : 0;
        setBufferedSentenceCount((previousCount) => (
            previousCount === nextCount ? previousCount : nextCount
        ));
    }, []);

    useEffect(() => {
        onPositionCommitRef.current = onPositionCommit;
    }, [onPositionCommit]);

    useEffect(() => {
        const pacer = pacerRef.current;
        if (!pacer) return;
        setPacingSnapshot(pacer.setPreferredSpeed(speed));
    }, [setPacingSnapshot, speed]);

    useEffect(() => {
        const pacer = pacerRef.current;
        if (!pacer) return;
        setPacingSnapshot(pacer.setContinuityMode(continuityMode));
    }, [continuityMode, setPacingSnapshot]);

    const commitCurrentPosition = useCallback(() => {
        if (!hasStartedPlaybackRef.current) return;
        onPositionCommitRef.current?.(useTTSStore.getState().currentWordIndex);
    }, []);

    useEffect(() => {
        const repairedInvalidVoice = voice !== preferredVoice;
        const voiceChanged = activeVoiceRef.current !== effectiveVoice;
        const deviceChanged = activeDeviceRef.current !== selectedDevice;
        activeVoiceRef.current = effectiveVoice;
        activeDeviceRef.current = selectedDevice;

        if (repairedInvalidVoice) setVoice(preferredVoice);
        if (!repairedInvalidVoice && !voiceChanged && !deviceChanged) return;

        generationIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        generatorRef.current = null;
        isGeneratingRef.current = false;
        hasStartedPlaybackRef.current = false;
        useTTSStore.getState().setGenerating(false);
        if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
    }, [effectiveVoice, preferredVoice, selectedDevice, setPacingSnapshot, setVoice, voice]);
    
    useEffect(() => {
        if (!bookId || !chapterId || !hasStartedPlaybackRef.current) return;
        if (playbackState !== 'playing' && playbackState !== 'generating' && playbackState !== 'paused') return;

        const now = Date.now();
        const shouldPersist = playbackState === 'paused' || now - lastHandoffPersistedAtRef.current >= 2000;
        if (!shouldPersist) return;
        lastHandoffPersistedAtRef.current = now;

        const { currentSentence, currentWordIndex: ttsWordIndex } = useTTSStore.getState();

        const position = {
            bookId,
            chapterId,
            sentenceIndex: currentSentence,
            wordIndex: ttsWordIndex,
            audioTime: currentTime,
            timestamp: now,
        };
        useTTSStore.getState().updatePosition(position);
        void persistListeningHandoff({ position, voice: preferredVoice, speed }).catch((error) => {
            console.error('[TTS UI] Failed to persist handoff position:', error);
        });
    }, [
        bookId,
        chapterId,
        currentTime,
        preferredVoice,
        playbackState,
        speed,
    ]);
    
    // Full reset when book or chapter changes - this MUST come before words effect
    useEffect(() => {
        const bookChanged = bookIdRef.current !== bookId;
        const chapterChanged = chapterIdRef.current !== chapterId;
        
        if (bookChanged || chapterChanged) {
            generationIdRef.current += 1;
            fallbackTransitionIdRef.current += 1;
            activeVoiceRef.current = preferredVoice;
            setActiveVoiceOverride(null);
            resetFallbackAdvisor();

            // Abort any ongoing generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            
            // Reset all refs
            isGeneratingRef.current = false;
            generatorRef.current = null;
            hasStartedPlaybackRef.current = false;
            startSentenceIndexRef.current = 0;
            chapterEndHandledRef.current = false;
            useTTSStore.getState().setGenerating(false);
            if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());
            
            // Full player reset - stop, clear queue, reset state
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
            setBufferedSentenceCount(0);
        }
        
        bookIdRef.current = bookId;
        chapterIdRef.current = chapterId;
    }, [bookId, chapterId, preferredVoice, resetFallbackAdvisor, setActiveVoiceOverride, setPacingSnapshot]);
    
    // Split words into sentences on mount/change
    useEffect(() => {
        const prev = wordsRef.current;
        // Detect changes: different length, different first word, or different last word
        const wordsChanged = prev !== words && (
            prev.length !== words.length || 
            prev[0] !== words[0] || 
            prev[prev.length - 1] !== words[words.length - 1]
        );
        
        if (wordsChanged) {
            if (wordsChapterIdRef.current === chapterId) {
                commitCurrentPosition();
            }
            generationIdRef.current += 1;
            fallbackTransitionIdRef.current += 1;
            activeVoiceRef.current = preferredVoice;
            setActiveVoiceOverride(null);
            resetFallbackAdvisor();

            // Stop generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            if (fallbackDownloadWarningTimerRef.current !== null) {
                clearTimeout(fallbackDownloadWarningTimerRef.current);
                fallbackDownloadWarningTimerRef.current = null;
            }
            isGeneratingRef.current = false;
            generatorRef.current = null;
            hasStartedPlaybackRef.current = false;
            chapterEndHandledRef.current = false;
            useTTSStore.getState().setGenerating(false);
            if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());
            
            // Clear player
            ttsPlayer.clearQueue();
            ttsPlayer.stop();
            setBufferedSentenceCount(0);
        }
        
        wordsRef.current = words;
        wordsChapterIdRef.current = chapterId;
    }, [chapterId, commitCurrentPosition, preferredVoice, resetFallbackAdvisor, setActiveVoiceOverride, setPacingSnapshot, words]);
    
    // Initialize TTS engine
    const handleInit = useCallback(async (): Promise<boolean> => {
        try {
            await initTTS(effectiveVoice, selectedDevice, () => undefined);
            return true;
        } catch (err) {
            console.error('[TTS UI] Init failed:', err);
            const message = err instanceof Error ? err.message : 'Failed to initialize audio mode.';
            const store = useTTSStore.getState();
            store.setError(message);
            store.setPlaybackState('idle');
            return false;
        }
    }, [effectiveVoice, selectedDevice]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            commitCurrentPosition();
            generationIdRef.current += 1;
            fallbackTransitionIdRef.current += 1;
            setActiveVoiceOverride(null);
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            ttsPlayer.dispose();
        };
    }, [commitCurrentPosition, setActiveVoiceOverride]);

    // Register with the OS media session as soon as the panel opens, so the system
    // Play button is already there and ready before the user taps play in-app.
    useEffect(() => {
        void ttsPlayer.armMediaSession().catch(() => {
            // Non-fatal: the in-app play button still starts playback normally.
        });
    }, []);

    // Generate audio starting from a sentence index
    const generateFrom = useCallback(async (fromSentenceIndex: number, sentenceCount: number) => {
        if (isGeneratingRef.current || sentences.length === 0) return;
        if (fromSentenceIndex >= sentences.length) return;
        if (sentenceCount <= 0) return;
        const task = (async () => {
            const generationId = generationIdRef.current + 1;
            generationIdRef.current = generationId;
            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            const signal = abortController.signal;

            isGeneratingRef.current = true;
            useTTSStore.getState().setGenerating(true);

            const endIndex = Math.min(fromSentenceIndex + sentenceCount, sentences.length);
            const sentencesToGenerate = sentences.slice(fromSentenceIndex, endIndex);

            const generator = streamSpeech(sentencesToGenerate, {
                voice: activeVoiceRef.current,
                speed,
                getSpeed: () => pacerRef.current?.snapshot().effectiveSpeed ?? speed,
                onGenerationSample: (sample) => {
                    const pacer = pacerRef.current;
                    if (!pacer) return;

                    const updatedSnapshot = pacer.observeGeneration(sample);
                    setPacingSnapshot(updatedSnapshot);
                    observeFallback(updatedSnapshot, sample.audioSeconds, true);

                    if (fallbackTrialState !== 'measuring' || getVoiceEngine(activeVoiceRef.current) !== 'piper') return;
                    fallbackTrialAudioSecondsRef.current += sample.audioSeconds;
                    fallbackTrialSamplesRef.current += 1;
                    if (
                        fallbackTrialAudioSecondsRef.current < 10
                        || fallbackTrialSamplesRef.current < 3
                    ) return;

                    const baseline = fallbackTrialBaselineRef.current;
                    const isMateriallyBetter = Boolean(
                        baseline
                        && updatedSnapshot.sustainableSpeed >= baseline.sustainableSpeed + 0.15
                        && fallbackTrialUnderrunsRef.current === 0,
                    );
                    if (!isMateriallyBetter) {
                        setFallbackTrialState('not-better');
                        const advisor = fallbackAdvisorRef.current;
                        if (advisor) setFallbackAdvisorSnapshot(advisor.markTrialFailed());
                    } else {
                        setFallbackTrialState('idle');
                    }
                },
            });
            generatorRef.current = generator;

            try {
                for await (const { sentence, audio } of generator) {
                    if (signal.aborted) break;
                    await ttsPlayer.queueAudio(audio, sentence);
                    refreshBufferedSentenceCount(sentence.index);
                }
            } catch (err) {
                if (!signal.aborted) {
                    console.error('[TTS] Generation error:', err);
                    const message = err instanceof Error ? err.message : 'Failed to generate audio.';
                    const store = useTTSStore.getState();
                    store.setError(message);
                    ttsPlayer.stop();
                }
            } finally {
                if (generationIdRef.current === generationId) {
                    isGeneratingRef.current = false;
                    useTTSStore.getState().setGenerating(false);
                    generatorRef.current = null;
                    if (abortControllerRef.current === abortController) {
                        abortControllerRef.current = null;
                    }
                    ttsPlayer.checkBuffer();
                }
            }
        })();

        generationTaskRef.current = task;
        try {
            await task;
        } finally {
            if (generationTaskRef.current === task) generationTaskRef.current = null;
        }
    }, [observeFallback, refreshBufferedSentenceCount, sentences, setPacingSnapshot, speed, fallbackTrialState]);

    const cancelGeneration = useCallback(async () => {
        generationIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        generatorRef.current = null;
        isGeneratingRef.current = false;
        useTTSStore.getState().setGenerating(false);

        const pendingGeneration = generationTaskRef.current;
        await pendingGeneration?.catch(() => undefined);
    }, []);

    const transitionToVoice = useCallback(async (
        targetVoice: string,
        targetOverride: string | null,
        preserveTrialFailure = false,
    ) => {
        if (sentences.length === 0 || targetVoice === activeVoiceRef.current) return;

        const transitionId = ++fallbackTransitionIdRef.current;
        const baseline = pacerRef.current?.snapshot() ?? pacingSnapshot;
        const currentSentenceIndex = ttsPlayer.getState().currentSentenceIndex;
        const bridgeEndSentenceIndex = Math.min(currentSentenceIndex + 2, sentences.length - 1);
        const firstMissingSentenceIndex = bridgeEndSentenceIndex + 1;

        await cancelGeneration();
        if (fallbackTransitionIdRef.current !== transitionId) return;

        ttsPlayer.discardQueuedAudioAfter(bridgeEndSentenceIndex);

        try {
            const targetDevice = getVoiceEngine(targetVoice) === 'piper' ? undefined : selectedDevice;
            await initTTS(targetVoice, targetDevice, () => undefined);
            if (fallbackTransitionIdRef.current !== transitionId) return;

            activeVoiceRef.current = targetVoice;
            setActiveVoiceOverride(targetOverride);
            if (targetOverride) {
                fallbackTrialBaselineRef.current = baseline;
                fallbackTrialAudioSecondsRef.current = 0;
                fallbackTrialSamplesRef.current = 0;
                fallbackTrialUnderrunsRef.current = 0;
                setFallbackTrialState('measuring');
            } else {
                resetFallbackAdvisor(preserveTrialFailure);
            }
            if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());
            ttsPlayer.resetTelemetry();

            const sentenceCount = Math.min(
                safeBufferAhead,
                sentences.length - firstMissingSentenceIndex,
            );
            if (sentenceCount > 0) void generateFrom(firstMissingSentenceIndex, sentenceCount);
        } catch (error) {
            if (fallbackTransitionIdRef.current !== transitionId) return;
            let transitionError: unknown = error;

            if (targetOverride) {
                try {
                    await initTTS(preferredVoice, selectedDevice, () => undefined);
                    if (fallbackTransitionIdRef.current !== transitionId) return;
                    activeVoiceRef.current = preferredVoice;
                    setActiveVoiceOverride(null);
                    resetFallbackAdvisor(preserveTrialFailure);
                    if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());
                    ttsPlayer.resetTelemetry();
                    const sentenceCount = Math.min(
                        safeBufferAhead,
                        sentences.length - firstMissingSentenceIndex,
                    );
                    if (sentenceCount > 0) void generateFrom(firstMissingSentenceIndex, sentenceCount);
                    setFallbackDownloadError('The lighter voice could not be prepared. Continuing with the preferred voice.');
                    return;
                } catch (restoreError) {
                    transitionError = restoreError;
                }
            }

            const message = transitionError instanceof Error ? transitionError.message : 'Audio playback failed.';
            useTTSStore.getState().setError(message);
            ttsPlayer.stop();
        }
    }, [
        cancelGeneration,
        generateFrom,
        pacingSnapshot,
        preferredVoice,
        resetFallbackAdvisor,
        safeBufferAhead,
        selectedDevice,
        sentences.length,
        setActiveVoiceOverride,
        setPacingSnapshot,
    ]);

    const handleDownloadFallback = useCallback(async () => {
        if (!fallbackCandidate || currentFallbackDownloadState === 'downloading') return;

        const scheduleWarning = () => {
            if (fallbackDownloadWarningTimerRef.current !== null) {
                clearTimeout(fallbackDownloadWarningTimerRef.current);
            }
            fallbackDownloadWarningTimerRef.current = setTimeout(() => {
                setFallbackDownloadStatus('Download is taking longer than expected');
            }, 30_000);
        };

        setFallbackDownloadVoiceId(fallbackCandidate.id);
        setFallbackDownloadState('downloading');
        setFallbackDownloadProgress(0);
        setFallbackDownloadStatus('Preparing lighter voice download');
        setFallbackDownloadError(null);
        scheduleWarning();

        try {
            await predownloadPiperVoice(fallbackCandidate.id, (progress, status) => {
                setFallbackDownloadProgress(progress);
                setFallbackDownloadStatus(status);
                scheduleWarning();
            });
            setFallbackCached(true);
            setFallbackDownloadState('ready');
        } catch (error) {
            setFallbackDownloadState('error');
            setFallbackDownloadError(error instanceof Error ? error.message : 'Download failed.');
        } finally {
            if (fallbackDownloadWarningTimerRef.current !== null) {
                clearTimeout(fallbackDownloadWarningTimerRef.current);
                fallbackDownloadWarningTimerRef.current = null;
            }
        }
    }, [currentFallbackDownloadState, fallbackCandidate]);

    const handleTryFallback = useCallback(() => {
        if (!fallbackCandidate || currentFallbackCached !== true) return;
        void transitionToVoice(fallbackCandidate.id, fallbackCandidate.id);
    }, [currentFallbackCached, fallbackCandidate, transitionToVoice]);

    const handleReturnToPreferred = useCallback(() => {
        if (activeVoiceRef.current === preferredVoice) return;
        void transitionToVoice(preferredVoice, null, fallbackTrialState === 'not-better');
    }, [fallbackTrialState, preferredVoice, transitionToVoice]);

    const handleKeepPreferred = useCallback(() => {
        const advisor = fallbackAdvisorRef.current;
        if (advisor) setFallbackAdvisorSnapshot(advisor.dismiss());
    }, []);

    const handleClosePanel = useCallback(() => {
        setIsExpanded(false);
        if (activeVoiceRef.current === preferredVoice) return;
        void transitionToVoice(preferredVoice, null, true);
    }, [preferredVoice, transitionToVoice]);

    useEffect(() => {
        const speedChanged = appliedSpeedRef.current !== speed;
        appliedSpeedRef.current = speed;
        if (!speedChanged) return;
        if (!hasStartedPlaybackRef.current) return;
        if (playbackState !== 'playing' && playbackState !== 'generating' && playbackState !== 'preparing') return;
        if (sentences.length === 0) return;

        generationIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        generatorRef.current = null;
        isGeneratingRef.current = false;
        useTTSStore.getState().setGenerating(false);

        const currentSentenceIndex = ttsPlayer.getState().currentSentenceIndex;
        const safetySentenceIndex = currentSentenceIndex + 1;
        ttsPlayer.discardQueuedAudioAfter(safetySentenceIndex);

        const firstMissingSentenceIndex = ttsPlayer.hasAudioForSentence(currentSentenceIndex)
            ? ttsPlayer.hasAudioForSentence(safetySentenceIndex)
                ? safetySentenceIndex + 1
                : safetySentenceIndex
            : currentSentenceIndex;
        const sentenceCount = Math.min(
            safeBufferAhead,
            sentences.length - firstMissingSentenceIndex,
        );
        if (sentenceCount > 0) {
            void generateFrom(firstMissingSentenceIndex, sentenceCount);
        }
    }, [generateFrom, playbackState, safeBufferAhead, sentences.length, speed]);

    const startFromSentence = useCallback(async (requestedSentenceIndex: number) => {
        if (sentences.length === 0) return;
        if (!await handleInit()) return;

        const sentenceIndex = Math.max(0, Math.min(sentences.length - 1, requestedSentenceIndex));
        const startSentence = sentences[sentenceIndex];
        if (!startSentence) return;

        startSentenceIndexRef.current = sentenceIndex;
        useTTSStore.getState().setCurrentWordIndex(startSentence.startWordIndex);
        hasStartedPlaybackRef.current = true;
        useTTSStore.getState().setPlaybackState('preparing');

        const startupBufferSize = Math.min(
            safeBufferAhead + 1,
            sentences.length - sentenceIndex,
        );
        await ttsPlayer.play(sentenceIndex, 1);
        void generateFrom(sentenceIndex, startupBufferSize);
    }, [generateFrom, handleInit, safeBufferAhead, sentences]);

    // Move the reading position forward/backward by a number of words, e.g. from
    // OS media session seek buttons. Restarts audio from the new sentence if playing.
    const skipWords = useCallback((deltaWords: number) => {
        if (words.length === 0 || sentences.length === 0) return;

        const readerWordIndex = getCurrentWordIndex?.() ?? currentWordIndex;
        const targetIndex = Math.max(0, Math.min(words.length - 1, readerWordIndex + deltaWords));
        if (targetIndex === readerWordIndex) return;

        const wasActive = playbackState === 'playing' || playbackState === 'generating' || playbackState === 'preparing';
        if (wasActive) ttsPlayer.pause();

        onPositionCommit?.(targetIndex);

        if (wasActive) {
            // startFromSentence() below sets ttsStore.currentWordIndex itself. Leaving it
            // untouched while paused keeps it pointing at the old position, so the next
            // resume (handleToggle) notices the reader has moved and reseeks instead of
            // continuing from ttsPlayer's stale internal position.
            const sentenceIndex = findNearestSentenceIndex(sentences, targetIndex);
            if (sentenceIndex >= 0) {
                ttsPlayer.clearQueue();
                void startFromSentence(sentenceIndex).catch((err) => {
                    console.error('[TTS UI] Skip failed:', err);
                    const message = err instanceof Error ? err.message : 'Audio playback failed.';
                    useTTSStore.getState().setError(message);
                    ttsPlayer.stop();
                });
            }
        }
    }, [words.length, sentences, getCurrentWordIndex, currentWordIndex, playbackState, onPositionCommit, startFromSentence]);

    // Set up player callbacks
    useEffect(() => {
        ttsPlayer.setOptions({
            onWordChange: (wordIndex) => {
                if (onPositionChange && hasStartedPlaybackRef.current) onPositionChange(wordIndex);
            },
            onSentenceChange: refreshBufferedSentenceCount,
            onAudioQueued: (sentenceIndex) => refreshBufferedSentenceCount(sentenceIndex),
            onBufferSnapshot: (snapshot) => {
                lastBufferSnapshotRef.current = snapshot;
                const pacer = pacerRef.current;
                if (!pacer) return;
                const updatedSnapshot = pacer.observeBuffer(snapshot);
                setPacingSnapshot(updatedSnapshot);
                observeFallback(updatedSnapshot);
            },
            onUnderrun: (sentenceIndex) => {
                if (sentenceIndex >= sentences.length - 1) return;
                const pacer = pacerRef.current;
                if (!pacer) return;
                if (fallbackTrialState === 'measuring' && getVoiceEngine(activeVoiceRef.current) === 'piper') {
                    fallbackTrialUnderrunsRef.current += 1;
                }
                const updatedSnapshot = pacer.reportUnderrun();
                setPacingSnapshot(updatedSnapshot);
                fallbackAdvisorRef.current?.reportUnderrun(ttsPlayer.getAudibleTime?.());
                observeFallback(updatedSnapshot);
            },
            onBufferLow: (currentSentenceIndex) => {
                refreshBufferedSentenceCount(currentSentenceIndex);
                if (currentSentenceIndex >= sentences.length) {
                    if (!isGeneratingRef.current && !chapterEndHandledRef.current) {
                        chapterEndHandledRef.current = true;
                        ttsPlayer.pause();
                        onChapterEnd?.();
                    }
                    return;
                }
                if (isGeneratingRef.current) return;

                const hasCurrentAudio = ttsPlayer.hasAudioForSentence(currentSentenceIndex);
                const bufferedAhead = hasCurrentAudio
                    ? ttsPlayer.getBufferedAheadCount(currentSentenceIndex)
                    : 0;
                const firstMissing = hasCurrentAudio
                    ? currentSentenceIndex + bufferedAhead + 1
                    : currentSentenceIndex;
                const finalTargetIndex = Math.min(
                    currentSentenceIndex + safeBufferAhead,
                    sentences.length - 1,
                );
                const missingCount = finalTargetIndex - firstMissing + 1;

                if (missingCount > 0) {
                    void generateFrom(firstMissing, missingCount);
                }
            },
        });
    }, [
        safeBufferAhead,
        sentences,
        onPositionChange,
        onChapterEnd,
        generateFrom,
        playbackState,
        refreshBufferedSentenceCount,
        setPacingSnapshot,
        observeFallback,
        fallbackTrialState,
    ]);
    
    // Handle stop - full reset of all TTS resources
    const handleStop = useCallback(() => {
        generationIdRef.current += 1;

        // Abort any ongoing generation
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // Reset all generation state
        isGeneratingRef.current = false;
        generatorRef.current = null;
        hasStartedPlaybackRef.current = false;
        startSentenceIndexRef.current = 0;
        chapterEndHandledRef.current = false;
        useTTSStore.getState().setGenerating(false);
        if (pacerRef.current) setPacingSnapshot(pacerRef.current.reset());

        // Full player reset
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
        setBufferedSentenceCount(0);
    }, [setPacingSnapshot]);

    useEffect(() => {
        if (!autoPlayChapterId || !chapterId || autoPlayChapterId !== chapterId) return;

        const requestKey = `${autoPlayChapterId}:${chapterId}`;
        if (autoPlayRequestHandledRef.current === requestKey) return;
        autoPlayRequestHandledRef.current = requestKey;

        const readerWordIndex = getCurrentWordIndex?.() ?? currentWordIndex;
        const sentenceIndex = findNearestSentenceIndex(sentences, readerWordIndex);

        void startFromSentence(Math.max(0, sentenceIndex)).catch((err) => {
            console.error('[TTS UI] Automatic chapter continuation failed:', err);
            const message = err instanceof Error ? err.message : 'Audio playback failed.';
            useTTSStore.getState().setError(message);
            ttsPlayer.stop();
        });
    }, [autoPlayChapterId, chapterId, currentWordIndex, getCurrentWordIndex, sentences, startFromSentence]);

    // Handle play/pause toggle - PAUSE MUST BE INSTANT
    const handleToggle = useCallback(async () => {
        // PAUSE PATH - synchronous, instant response
        if (playbackState === 'playing') {
            ttsPlayer.pause();
            return; // Exit immediately, no async operations
        }

        if (playbackState === 'preparing' || playbackState === 'generating') {
            handleStop();
            return;
        }

        try {
            // PLAY PATHS - these can be async. Always run init guard so quality/device
            // changes are applied before speaking.
            if (!await handleInit()) return;
            const readerWordIndex = getCurrentWordIndex?.() ?? currentWordIndex;

            if (playbackState === 'idle') {
                const sentenceIndex = findNearestSentenceIndex(sentences, readerWordIndex);

                // Mark that we're starting from a valid position
                await startFromSentence(sentenceIndex);
            } else if (playbackState === 'paused') {
                const currentTTSWordIndex = useTTSStore.getState().currentWordIndex;

                if (readerWordIndex !== currentTTSWordIndex) {
                    const sentenceIndex = findNearestSentenceIndex(sentences, readerWordIndex);

                    if (sentenceIndex >= 0) {
                        startSentenceIndexRef.current = sentenceIndex;

                        // Update position and start fresh from this sentence
                        hasStartedPlaybackRef.current = true;

                        // Clear old queued audio and regenerate from new position
                        ttsPlayer.clearQueue();
                        await startFromSentence(sentenceIndex);
                        return;
                    }
                }

                // User didn't read ahead (or read back) - just resume from where we were
                await ttsPlayer.play();
            }
        } catch (err) {
            console.error('[TTS UI] Playback failed:', err);
            const message = err instanceof Error ? err.message : 'Audio playback failed.';
            const store = useTTSStore.getState();
            store.setError(message);
            ttsPlayer.stop();
        }
    }, [playbackState, sentences, currentWordIndex, getCurrentWordIndex, handleInit, startFromSentence, handleStop]);
    
    // Voice options, grouped by language so the Slovenian voice is easy to find
    const voiceGroups = useMemo(() => {
        const groups = new Map<string, VoiceInfo[]>();
        for (const voice of listVoices()) {
            if (voice.quality === 'D') continue;
            const group = groups.get(voice.languageLabel) ?? [];
            group.push(voice);
            groups.set(voice.languageLabel, group);
        }
        // Kokoro is registered first, which buried the only voices a phone can
        // actually keep up with at the bottom of their language. Light first.
        return Array.from(groups, ([label, groupVoices]) => ({
            label,
            voices: [...groupVoices].sort((left, right) => (
                left.weight === right.weight ? 0 : left.weight === 'light' ? -1 : 1
            )),
        }));
    }, []);
    // Every Kokoro voice shares one download, so a second Kokoro voice is free
    // once the first is cached, while each Piper voice costs its own 60 MB.
    // Showing this beats printing a size the listener has already paid.
    const [cachedVoiceIds, setCachedVoiceIds] = useState<Record<string, boolean>>({});
    useEffect(() => {
        if (!showVoiceMenu) return undefined;
        let cancelled = false;
        void Promise.all(listVoices().map(async (voice) => [
            voice.id,
            await isTTSModelCached(voice.id).catch(() => false),
        ] as const)).then((entries) => {
            if (!cancelled) setCachedVoiceIds(Object.fromEntries(entries));
        });
        return () => { cancelled = true; };
    }, [showVoiceMenu]);

    const currentVoice = getVoice(effectiveVoice);
    const preferredVoiceInfo = getVoice(preferredVoice);
    const isFallbackActive = activeVoiceOverride !== null && effectiveVoice !== preferredVoice;
    const showFallbackRecommendation = fallbackAdvisorSnapshot.eligible
        && fallbackCandidate !== undefined
        && !isFallbackActive;

    const handlePlayAction = useCallback(() => {
        if (playbackState === 'playing') return;
        void handleToggle();
    }, [playbackState, handleToggle]);

    const handlePauseAction = useCallback(() => {
        ttsPlayer.pause();
    }, []);

    useTTSMediaSession({
        playbackState,
        title: bookTitle || chapterTitle || currentVoice?.name || 'Listening',
        artist: bookAuthor || currentVoice?.name,
        album: chapterTitle && chapterTitle !== bookTitle ? chapterTitle : undefined,
        artwork: coverImage,
        onPlay: handlePlayAction,
        onPause: handlePauseAction,
        onStop: handleStop,
        onSkip: skipWords,
    });

    // Button content
    const getButtonContent = () => {
        if (isLoading) return <LoadingSpinner />;
        if (playbackState === 'preparing') return <LoadingSpinner />;
        if (playbackState === 'generating') return <LoadingSpinner />;
        if (playbackState === 'playing') return <PauseIcon />;
        return <PlayIcon />;
    };
    
    // Status text
    const getStatusText = () => {
        if (isLoading) return `${loadStatus} (${Math.round(loadProgress * 100)}%)`;
        if (playbackState === 'preparing') return 'Preparing audio...';
        if (playbackState === 'generating') return `${currentTimeStr} / ${durationStr} (buffering...)`;
        if (playbackState === 'playing') return `${currentTimeStr} / ${durationStr}`;
        if (playbackState === 'paused') return `Paused at ${currentTimeStr}`;
        if (error) return error;
        return 'Tap to listen';
    };
    
    // Is button currently showing action?
    const isButtonActive = playbackState === 'playing' || playbackState === 'generating';
    
    // Compact player (minimized)
    const dockClasses = `fixed bottom-[calc(7rem+var(--safe-bottom))] right-inset-right z-[90] ${dockClassName}`;

    if (compact && !isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                data-testid="tts-player-fab"
                className={`${dockClasses} p-3.5 rounded-2xl bg-cyan-500/90 text-black shadow-[0_14px_40px_-18px_rgba(34,211,238,0.85)] hover:bg-cyan-400 transition-all duration-200 group`}
                title="Text to Speech"
            >
                <HeadphonesIcon />
                {playbackState === 'playing' && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
                )}
            </button>
        );
    }
    
    return (
        <div
            data-testid="tts-player-panel"
            className={`${dockClasses} ${compact ? 'w-72' : 'w-72 max-w-[calc(100vw-2rem)]'} overflow-visible border border-cyan-300/20 bg-[#080d14]/95 shadow-[0_24px_60px_-32px_rgba(14,165,233,0.75)] backdrop-blur-xl transition-all duration-300`}
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-cyan-200/10 px-3 py-2">
                <div className="flex items-center gap-2">
                    <HeadphonesIcon />
                    <span className="font-mono text-xs text-cyan-100 uppercase tracking-[0.18em]">Listen Mode</span>
                </div>
                {compact && (
                    <button
                        onClick={handleClosePanel}
                        className="text-cyan-100/60 hover:text-cyan-100 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
            
            {/* Main Controls */}
            <div className="space-y-3 p-3">
                {/* Play/Pause + Status */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleToggle}
                        disabled={isLoading}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                            isButtonActive
                                ? 'bg-cyan-400 text-black shadow-[0_10px_28px_-16px_rgba(34,211,238,0.9)] hover:bg-cyan-300'
                                : 'bg-white/8 text-cyan-50 hover:bg-white/16'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {getButtonContent()}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-semibold tracking-wide text-white">
                            {isFallbackActive
                                ? `${currentVoice?.name ?? 'Lighter voice'} - lighter voice`
                                : currentVoice?.name ?? 'Select Voice'}
                        </p>
                        <p className="truncate text-xs text-cyan-100/65">
                            {getStatusText()}
                        </p>
                    </div>
                    
                    {playbackState !== 'idle' && (
                        <button
                            onClick={handleStop}
                            className="p-2 text-cyan-100/55 hover:text-cyan-50 transition-colors"
                            title="Stop"
                        >
                            <StopIcon />
                        </button>
                    )}
                </div>
                
                <div className="flex items-center gap-1" role="status" aria-live="polite" aria-label={`${Math.min(bufferedSentenceCount, bufferSlotCount)} of ${bufferSlotCount} upcoming sentences buffered`}>
                    {Array.from({ length: bufferSlotCount }, (_, index) => (
                        <span
                            key={index}
                            className={`h-1.5 flex-1 transition-colors duration-300 ${
                                index < bufferedSentenceCount
                                    ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.65)]'
                                    : 'bg-cyan-100/12'
                            }`}
                        />
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-xs">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-cyan-200/50">Speech</span>
                        <span className="font-semibold tabular-nums text-cyan-100">{pacingSnapshot.effectiveSpeed.toFixed(1)}x</span>
                        {pacingSnapshot.effectiveSpeed < speed && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-200/80" title="This device is slowing speech to keep audio continuous">
                                limited
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={continuityMode === 'continuous'}
                        onClick={() => setContinuityMode(continuityMode === 'continuous' ? 'prefer-speed' : 'continuous')}
                        className="border border-white/15 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70 transition-colors hover:border-cyan-200/50 hover:text-white"
                        title="Keep audio continuous; the device may slow it down"
                    >
                        {continuityMode === 'continuous' ? 'Continuous audio' : 'Prefer speed'}
                    </button>
                </div>

                {/* Voice and volume */}
                <div className="space-y-3">
                    {/* Voice Selector */}
                    <div className="relative">
                        <button
                            onClick={() => {
                                setShowVoiceMenu(!showVoiceMenu);
                            }}
                            className="w-full border border-white/10 bg-white/5 px-2.5 py-2 text-left transition-colors hover:bg-white/10"
                        >
                            <span className="text-[10px] text-cyan-200/50 uppercase tracking-[0.16em] block">Voice</span>
                            <span className="text-sm text-white">
                                {currentVoice ? `${currentVoice.flag} ${currentVoice.name}` : 'Default'}
                            </span>
                        </button>

                        {showVoiceMenu && (
                            <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#05080f]/95 border border-cyan-200/15 rounded-lg shadow-2xl max-h-56 overflow-y-auto z-30">
                                <p className="px-3 pt-2.5 pb-1 text-[10px] leading-4 text-white/45">
                                    <span className="text-cyan-100/80">Light</span> voices generate faster than they speak on most phones.
                                    {' '}<span className="text-amber-100/80">Heavy</span> voices sound better but need a quick device.
                                </p>
                                {voiceGroups.map(group => (
                                    <div key={group.label}>
                                        <div className="px-3 pt-2 pb-1 text-[10px] text-cyan-200/45 uppercase tracking-[0.16em] sticky top-0 bg-[#05080f]/95">
                                            {group.voices[0].flag} {group.label}
                                        </div>
                                        {group.voices.map(v => (
                                            <button
                                                key={v.id}
                                                onClick={() => {
                                                    setActiveVoiceOverride(null);
                                                    setVoice(v.id);
                                                    setShowVoiceMenu(false);
                                                }}
                                                className={`w-full px-3 py-2 text-left text-sm hover:bg-cyan-300/10 transition-colors flex items-center justify-between ${
                                                    v.id === effectiveVoice ? 'bg-cyan-300/20 text-cyan-100' : 'text-white/80'
                                                }`}
                                            >
                                                <span className="flex min-w-0 items-center gap-1.5">
                                                    <span className="truncate">{v.name}</span>
                                                    <span className="text-[10px] text-white/40">
                                                        {v.gender === 'female' ? '♀' : '♂'}
                                                    </span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
                                                    <span className={v.weight === 'light'
                                                        ? 'border border-cyan-200/25 px-1 py-0.5 uppercase tracking-wide text-cyan-100/80'
                                                        : 'border border-amber-200/25 px-1 py-0.5 uppercase tracking-wide text-amber-100/80'}
                                                    >
                                                        {v.weight}
                                                    </span>
                                                    <span className="w-12 text-right text-white/40">
                                                        {cachedVoiceIds[v.id] ? 'Ready' : v.downloadMB ? `${v.downloadMB} MB` : ''}
                                                    </span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Volume */}
                    <div className="space-y-1.5 border-t border-white/10 pt-2">
                        <div className="flex items-center justify-between px-1">
                            <span className="text-[10px] text-cyan-200/50 uppercase tracking-[0.16em]">Volume</span>
                            <span className="text-xs text-cyan-100 font-semibold">{Math.round(volume * 100)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-cyan-100/60" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                            </svg>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer
                                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                                           [&::-webkit-slider-thumb]:bg-cyan-100 [&::-webkit-slider-thumb]:rounded-full"
                            />
                        </div>
                    </div>
                </div>

                {isFallbackActive && (
                    <div
                        data-testid="tts-fallback-active"
                        className="space-y-2 border border-cyan-200/15 bg-cyan-300/5 px-2.5 py-2"
                    >
                        <p className="text-xs text-cyan-50">
                            Preferred voice: {preferredVoiceInfo?.name ?? 'selected voice'}
                        </p>
                        {fallbackTrialState === 'not-better' && (
                            <p className="text-xs text-amber-100/85">
                                This voice is not keeping up better on this device.
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleReturnToPreferred}
                                className="border border-cyan-200/30 px-2 py-1 text-[10px] uppercase tracking-wide text-cyan-50 transition-colors hover:border-cyan-100"
                            >
                                Return to {preferredVoiceInfo?.name ?? 'preferred voice'}
                            </button>
                            {fallbackTrialState === 'not-better' && (
                                <button
                                    type="button"
                                    onClick={() => setFallbackTrialState('idle')}
                                    className="border border-white/15 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70 transition-colors hover:border-white/40 hover:text-white"
                                >
                                    Keep {currentVoice?.name ?? 'lighter voice'}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {showFallbackRecommendation && fallbackCandidate && (
                    <div
                        data-testid="tts-fallback-recommendation"
                        role="status"
                        className="space-y-2 border border-amber-200/20 bg-amber-100/5 px-2.5 py-2"
                    >
                        <p className="text-xs leading-5 text-amber-50">
                            This voice is running very slowly on this device. A lighter local voice may keep up better.
                        </p>
                        {currentFallbackDownloadState === 'downloading' ? (
                            <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-[10px] text-amber-100/75">
                                    <span>{fallbackDownloadStatus || 'Downloading lighter voice'}</span>
                                    <span>{Math.round(fallbackDownloadProgress * 100)}%</span>
                                </div>
                                <div className="h-1 bg-white/10">
                                    <div
                                        className="h-full bg-amber-200 transition-[width] duration-300"
                                        style={{ width: `${fallbackDownloadProgress * 100}%` }}
                                    />
                                </div>
                            </div>
                        ) : currentFallbackCached === true ? (
                            <button
                                type="button"
                                onClick={handleTryFallback}
                                className="border border-amber-100/40 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-50 transition-colors hover:border-amber-50"
                            >
                                Try lighter voice
                            </button>
                        ) : currentFallbackCached === false ? (
                            <div className="space-y-2">
                                <p className="text-[11px] leading-4 text-amber-100/65">
                                    The voice will change. Text and speech stay on this device.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleDownloadFallback}
                                    className="border border-amber-100/40 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-50 transition-colors hover:border-amber-50"
                                >
                                    {currentFallbackDownloadState === 'error'
                                        ? `Retry download - ${fallbackCandidate.downloadMB ?? 63} MB`
                                        : `Download lighter voice - ${fallbackCandidate.downloadMB ?? 63} MB`}
                                </button>
                                {currentFallbackDownloadError && (
                                    <p className="text-[11px] leading-4 text-rose-200/80">{currentFallbackDownloadError}</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-[11px] text-amber-100/65">Checking lighter voice availability...</p>
                        )}
                        <button
                            type="button"
                            onClick={handleKeepPreferred}
                            className="border border-white/15 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70 transition-colors hover:border-white/40 hover:text-white"
                        >
                            Keep {preferredVoiceInfo?.name ?? 'preferred voice'}
                        </button>
                    </div>
                )}
            </div>
            
            {/* Loading progress bar */}
            {isLoading && (
                <div className="h-1 bg-white/10">
                    <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                        style={{ width: `${loadProgress * 100}%` }}
                    />
                </div>
            )}
        </div>
    );
};

export default TTSPlayer;
