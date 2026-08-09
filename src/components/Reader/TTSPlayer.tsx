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
    listVoices,
    resolveVoiceId,
    type SentenceBoundary,
    type TTSAudioResult,
    type VoiceInfo,
} from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';
import { persistListeningHandoff } from '../../core/exchange/handoff';

// Configuration
const DEFAULT_BUFFER_AHEAD = 5;
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
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

const formatSpeedLabel = (value: number): string => {
    const fixed = value.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
    return `${fixed}x`;
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
    /** Book and chapter IDs for position tracking */
    bookId?: string;
    chapterId?: string;
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
    bookId,
    chapterId,
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
        backendPreference,
        bufferAhead,
        currentWordIndex: ttsWordIndex,
        currentSentence,
        currentTime,
        setVolume,
        setSpeed,
        setVoice,
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
        backendPreference: state.backendPreference,
        bufferAhead: state.bufferAhead,
        currentWordIndex: state.currentWordIndex,
        currentSentence: state.currentSentence,
        currentTime: state.currentTime,
        duration: state.duration,
        setVolume: state.setVolume,
        setSpeed: state.setSpeed,
        setVoice: state.setVoice,
    })));

    const currentTimeStr = formatTTSPlaybackTime(currentTime);
    const durationStr = formatTTSPlaybackTime(duration);
    
    const sentences = useMemo(
        () => splitIntoSentences(words, paragraphBreaks),
        [words, paragraphBreaks],
    );
    const [showVoiceMenu, setShowVoiceMenu] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const effectiveVoice = resolveVoiceId(voice);
    const selectedDevice = backendPreference === 'auto' ? undefined : backendPreference;
    const safeBufferAhead = Math.max(3, Math.min(12, bufferAhead || DEFAULT_BUFFER_AHEAD));
    
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

    useEffect(() => {
        const repairedInvalidVoice = voice !== effectiveVoice;
        const voiceChanged = activeVoiceRef.current !== effectiveVoice;
        activeVoiceRef.current = effectiveVoice;

        if (repairedInvalidVoice) setVoice(effectiveVoice);
        if (!repairedInvalidVoice && !voiceChanged) return;

        generationIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        generatorRef.current = null;
        isGeneratingRef.current = false;
        hasStartedPlaybackRef.current = false;
        useTTSStore.getState().setGenerating(false);
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
    }, [effectiveVoice, setVoice, voice]);
    
    useEffect(() => {
        if (!bookId || !chapterId || !hasStartedPlaybackRef.current) return;
        if (playbackState !== 'playing' && playbackState !== 'generating' && playbackState !== 'paused') return;

        const now = Date.now();
        const shouldPersist = playbackState === 'paused' || now - lastHandoffPersistedAtRef.current >= 2000;
        if (!shouldPersist) return;
        lastHandoffPersistedAtRef.current = now;

        const position = {
            bookId,
            chapterId,
            sentenceIndex: currentSentence,
            wordIndex: ttsWordIndex,
            audioTime: currentTime,
            timestamp: now,
        };
        useTTSStore.getState().updatePosition(position);
        void persistListeningHandoff({ position, voice: effectiveVoice, speed }).catch((error) => {
            console.error('[TTS UI] Failed to persist handoff position:', error);
        });
    }, [
        bookId,
        chapterId,
        currentSentence,
        currentTime,
        effectiveVoice,
        playbackState,
        speed,
        ttsWordIndex,
    ]);
    
    // Full reset when book or chapter changes - this MUST come before words effect
    useEffect(() => {
        const bookChanged = bookIdRef.current !== bookId;
        const chapterChanged = chapterIdRef.current !== chapterId;
        
        if (bookChanged || chapterChanged) {
            generationIdRef.current += 1;

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
            
            // Full player reset - stop, clear queue, reset state
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
        }
        
        bookIdRef.current = bookId;
        chapterIdRef.current = chapterId;
    }, [bookId, chapterId]);
    
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
            generationIdRef.current += 1;

            // Stop generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            generatorRef.current = null;
            hasStartedPlaybackRef.current = false;
            chapterEndHandledRef.current = false;
            useTTSStore.getState().setGenerating(false);
            
            // Clear player
            ttsPlayer.clearQueue();
            ttsPlayer.stop();
        }
        
        wordsRef.current = words;
    }, [words]);
    
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
            generationIdRef.current += 1;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
        };
    }, []);
    
    // Generate audio starting from a sentence index
    const generateFrom = useCallback(async (fromSentenceIndex: number, sentenceCount: number) => {
        if (isGeneratingRef.current || sentences.length === 0) return;
        if (fromSentenceIndex >= sentences.length) return;
        if (sentenceCount <= 0) return;
        
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
            voice: effectiveVoice,
            speed,
        });
        generatorRef.current = generator;
        
        try {
            for await (const { sentence, audio } of generator) {
                if (signal.aborted) break;
                await ttsPlayer.queueAudio(audio, sentence);
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
    }, [effectiveVoice, sentences, speed]);

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
    
    // Set up player callbacks
    useEffect(() => {
        ttsPlayer.setOptions({
            onWordChange: (wordIndex) => {
                if (onPositionChange && hasStartedPlaybackRef.current) onPositionChange(wordIndex);
            },
            onBufferLow: (currentSentenceIndex) => {
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
    }, [safeBufferAhead, sentences, onPositionChange, onChapterEnd, generateFrom, playbackState]);
    
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

        // Full player reset
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
    }, []);

    useEffect(() => {
        if (!autoPlayChapterId || !chapterId || autoPlayChapterId !== chapterId) return;

        const requestKey = `${autoPlayChapterId}:${chapterId}`;
        if (autoPlayRequestHandledRef.current === requestKey) return;
        autoPlayRequestHandledRef.current = requestKey;

        void startFromSentence(0).catch((err) => {
            console.error('[TTS UI] Automatic chapter continuation failed:', err);
            const message = err instanceof Error ? err.message : 'Audio playback failed.';
            useTTSStore.getState().setError(message);
            ttsPlayer.stop();
        });
    }, [autoPlayChapterId, chapterId, startFromSentence]);

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
        return Array.from(groups, ([label, groupVoices]) => ({ label, voices: groupVoices }));
    }, []);
    const currentVoice = getVoice(effectiveVoice);

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
    const dockClasses = `fixed bottom-20 right-4 z-50 ${dockClassName}`;

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
            className={`${dockClasses} ${compact ? 'w-80' : 'w-96 max-w-[calc(100vw-2rem)]'} bg-[#080d14]/95 backdrop-blur-xl rounded-2xl border border-cyan-300/20 shadow-[0_28px_70px_-35px_rgba(14,165,233,0.75)] overflow-visible transition-all duration-300`}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-200/10 bg-gradient-to-r from-cyan-300/10 via-teal-300/5 to-transparent">
                <div className="flex items-center gap-2">
                    <HeadphonesIcon />
                    <span className="font-mono text-xs text-cyan-100 uppercase tracking-[0.18em]">Listen Mode</span>
                </div>
                {compact && (
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-cyan-100/60 hover:text-cyan-100 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
            
            {/* Main Controls */}
            <div className="p-4 space-y-4">
                {/* Play/Pause + Status */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleToggle}
                        disabled={isLoading}
                        className={`flex items-center justify-center w-14 h-14 rounded-2xl transition-all duration-200 ${
                            isButtonActive
                                ? 'bg-cyan-400 text-black shadow-[0_10px_28px_-16px_rgba(34,211,238,0.9)] hover:bg-cyan-300'
                                : 'bg-white/8 text-cyan-50 hover:bg-white/16'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {getButtonContent()}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-semibold truncate tracking-wide">
                            {currentVoice?.name ?? 'Select Voice'}
                        </p>
                        <p className="text-xs text-cyan-100/65 truncate">
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
                
                {/* Voice & Speed */}
                <div className="space-y-3">
                    {/* Voice Selector */}
                    <div className="relative">
                        <button
                            onClick={() => {
                                setShowVoiceMenu(!showVoiceMenu);
                            }}
                            className="w-full px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-left transition-colors"
                        >
                            <span className="text-[10px] text-cyan-200/50 uppercase tracking-[0.16em] block">Voice</span>
                            <span className="text-sm text-white">
                                {currentVoice ? `${currentVoice.flag} ${currentVoice.name}` : 'Default'}
                            </span>
                        </button>

                        {showVoiceMenu && (
                            <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#05080f]/95 border border-cyan-200/15 rounded-lg shadow-2xl max-h-56 overflow-y-auto z-30">
                                {voiceGroups.map(group => (
                                    <div key={group.label}>
                                        <div className="px-3 pt-2 pb-1 text-[10px] text-cyan-200/45 uppercase tracking-[0.16em] sticky top-0 bg-[#05080f]/95">
                                            {group.voices[0].flag} {group.label}
                                        </div>
                                        {group.voices.map(v => (
                                            <button
                                                key={v.id}
                                                onClick={() => {
                                                    setVoice(v.id);
                                                    setShowVoiceMenu(false);
                                                }}
                                                className={`w-full px-3 py-2 text-left text-sm hover:bg-cyan-300/10 transition-colors flex items-center justify-between ${
                                                    v.id === effectiveVoice ? 'bg-cyan-300/20 text-cyan-100' : 'text-white/80'
                                                }`}
                                            >
                                                <span>{v.name}</span>
                                                <span className="text-[10px] text-white/40">
                                                    {v.gender === 'female' ? '♀' : '♂'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Speed Selector */}
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 space-y-2">
                        <div className="flex items-center justify-between px-1">
                            <span className="text-[10px] text-cyan-200/50 uppercase tracking-[0.16em]">Speed</span>
                            <span className="text-xs text-cyan-100 font-semibold">{formatSpeedLabel(speed)}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                            {SPEED_OPTIONS.map((option) => (
                                <button
                                    key={option}
                                    onClick={() => setSpeed(option)}
                                    className={`px-2 py-1.5 rounded-md text-xs font-semibold transition-colors border ${
                                        Math.abs(option - speed) < 0.001
                                            ? 'bg-cyan-300/25 border-cyan-200/50 text-cyan-100'
                                            : 'bg-black/20 border-white/10 text-white/70 hover:bg-cyan-200/10 hover:text-white'
                                    }`}
                                >
                                    {formatSpeedLabel(option)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Volume */}
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 space-y-2">
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
