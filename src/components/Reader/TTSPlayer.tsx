/**
 * TTS Player Controls Component
 * 
 * Floating audio player for seamless reading/listening transitions.
 * Shows current playback state, progress, and controls.
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useTTSStore, useFormattedTime } from '../../core/store/tts';
import {
    initTTS,
    isTTSReady,
    streamSpeech,
    splitIntoSentences,
    listVoices,
    type SentenceBoundary,
    type TTSAudioResult,
} from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';

// Configuration
const SENTENCES_AHEAD_BUFFER = 5; // Generate this many sentences ahead

interface TTSPlayerProps {
    /** The words to speak */
    words: string[];
    /** Current reading position (word index) */
    currentWordIndex: number;
    /** Called when TTS position changes (for syncing reading position) */
    onPositionChange?: (wordIndex: number) => void;
    /** Book and chapter IDs for position tracking */
    bookId?: string;
    chapterId?: string;
    /** Compact mode for smaller screens */
    compact?: boolean;
}

export const TTSPlayer: React.FC<TTSPlayerProps> = ({
    words,
    currentWordIndex,
    onPositionChange,
    bookId,
    chapterId,
    compact = false,
}) => {
    const {
        isReady,
        isLoading,
        isGenerating,
        error,
        playbackState,
        loadProgress,
        loadStatus,
        volume,
        speed,
        voice,
        currentWordIndex: ttsWordIndex,
        setVolume,
        setSpeed,
        setVoice,
    } = useTTSStore();
    
    const { current: currentTimeStr, duration: durationStr } = useFormattedTime();
    
    const [sentences, setSentences] = useState<SentenceBoundary[]>([]);
    const [showVoiceMenu, setShowVoiceMenu] = useState(false);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    
    const generatorRef = useRef<AsyncGenerator<{ sentence: SentenceBoundary; audio: TTSAudioResult }> | null>(null);
    const isGeneratingRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const wordsRef = useRef<string[]>(words);
    const startSentenceIndexRef = useRef<number>(0);
    const hasStartedPlaybackRef = useRef(false); // Track if we've started with a valid position
    const bookIdRef = useRef<string | undefined>(bookId);
    const chapterIdRef = useRef<string | undefined>(chapterId);
    
    // Sync TTS word position to reader - only after playback has properly started
    useEffect(() => {
        if ((playbackState === 'playing' || playbackState === 'generating') && onPositionChange && hasStartedPlaybackRef.current) {
            onPositionChange(ttsWordIndex);
        }
    }, [ttsWordIndex, playbackState, onPositionChange]);
    
    // Full reset when book or chapter changes - this MUST come before words effect
    useEffect(() => {
        const bookChanged = bookIdRef.current !== bookId;
        const chapterChanged = chapterIdRef.current !== chapterId;
        
        if (bookChanged || chapterChanged) {
            console.log(`[TTS UI] Book/chapter changed (book: ${bookIdRef.current} -> ${bookId}, chapter: ${chapterIdRef.current} -> ${chapterId}), full reset`);
            
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
            
            // Full player reset - stop, clear queue, reset state
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
            
            // Reset sentences
            setSentences([]);
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
            console.log('[TTS UI] Words changed, resetting');
            
            // Stop generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            generatorRef.current = null;
            hasStartedPlaybackRef.current = false;
            
            // Clear player
            ttsPlayer.clearQueue();
            ttsPlayer.stop();
        }
        
        wordsRef.current = words;
        const newSentences = splitIntoSentences(words);
        setSentences(newSentences);
    }, [words]);
    
    // Initialize TTS engine
    const handleInit = useCallback(async () => {
        if (isTTSReady()) return;
        
        try {
            await initTTS('q8', undefined, (progress, status) => {
                console.log(`[TTS UI] ${status} (${Math.round(progress * 100)}%)`);
            });
        } catch (err) {
            console.error('[TTS UI] Init failed:', err);
        }
    }, []);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
        };
    }, []);
    
    // Generate audio starting from a sentence index
    const generateFrom = useCallback(async (fromSentenceIndex: number) => {
        if (isGeneratingRef.current || sentences.length === 0) return;
        if (fromSentenceIndex >= sentences.length) return;
        
        // Create abort controller
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
        
        isGeneratingRef.current = true;
        useTTSStore.getState().setGenerating(true);
        
        // Generate a window of sentences
        const endIndex = Math.min(fromSentenceIndex + SENTENCES_AHEAD_BUFFER, sentences.length);
        const sentencesToGenerate = sentences.slice(fromSentenceIndex, endIndex);
        
        console.log(`[TTS UI] Generating sentences ${fromSentenceIndex} to ${endIndex - 1}`);
        
        generatorRef.current = streamSpeech(sentencesToGenerate, {
            voice,
            speed,
            onSentenceStart: (sentence) => {
                if (signal.aborted) return;
                console.log(`[TTS] Generating: "${sentence.text.slice(0, 50)}..."`);
            },
            onSentenceComplete: (sentence, audio) => {
                if (signal.aborted) return;
                ttsPlayer.queueAudio(audio, sentence);
            },
        });
        
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of generatorRef.current) {
                if (signal.aborted) break;
            }
        } catch (err) {
            if (!signal.aborted) {
                console.error('[TTS] Generation error:', err);
            }
        } finally {
            isGeneratingRef.current = false;
            useTTSStore.getState().setGenerating(false);
            generatorRef.current = null;
        }
    }, [sentences, voice, speed]);
    
    // Set up player callbacks
    useEffect(() => {
        ttsPlayer.setOptions({
            onSentenceChange: (sentenceIndex) => {
                const sentence = sentences[sentenceIndex];
                if (sentence && onPositionChange) {
                    onPositionChange(sentence.startWordIndex);
                }
            },
            onBufferLow: (currentSentenceIndex) => {
                // Generate more audio - check current sentence first, then ahead
                if (!isGeneratingRef.current && currentSentenceIndex < sentences.length) {
                    // Find first sentence without audio (starting from current)
                    let firstMissing = currentSentenceIndex;
                    while (firstMissing < sentences.length && ttsPlayer.hasAudioForSentence(firstMissing)) {
                        firstMissing++;
                    }
                    if (firstMissing < sentences.length) {
                        console.log(`[TTS UI] Buffer low, generating from ${firstMissing}`);
                        generateFrom(firstMissing);
                    }
                }
            },
            onAudioQueued: (sentenceIndex, queueSize) => {
                // If this is the first audio and we're waiting to start, play now
                if (sentenceIndex === startSentenceIndexRef.current && playbackState === 'preparing') {
                    console.log(`[TTS UI] First audio ready, starting playback`);
                    ttsPlayer.play(sentenceIndex);
                }
                console.log(`[TTS UI] Audio queued: sentence ${sentenceIndex}, queue size: ${queueSize}`);
            },
            onEnded: () => {
                console.log('[TTS] Playback ended');
            },
        });
    }, [sentences, onPositionChange, generateFrom, playbackState]);
    
    // Handle play/pause toggle - PAUSE MUST BE INSTANT
    const handleToggle = useCallback(async () => {
        // PAUSE PATH - synchronous, instant response
        if (playbackState === 'playing' || playbackState === 'generating') {
            ttsPlayer.pause();
            return; // Exit immediately, no async operations
        }
        
        // PLAY PATHS - these can be async
        if (!isReady) {
            await handleInit();
        }
        
        if (playbackState === 'idle' || playbackState === 'preparing') {
            // Find sentence containing current word
            const sentenceIndex = sentences.findIndex(
                s => currentWordIndex >= s.startWordIndex && currentWordIndex <= s.endWordIndex
            );
            
            console.log(`[TTS UI] Finding sentence for word ${currentWordIndex}, found: ${sentenceIndex}, sentences count: ${sentences.length}`);
            
            if (sentenceIndex === -1 && sentences.length > 0) {
                // Word index might be beyond sentences - find closest
                const lastSentence = sentences[sentences.length - 1];
                if (currentWordIndex > lastSentence.endWordIndex) {
                    console.log(`[TTS UI] Word ${currentWordIndex} beyond last sentence (ends at ${lastSentence.endWordIndex}), using last sentence`);
                }
            }
            
            const startIdx = sentenceIndex >= 0 ? sentenceIndex : 0;
            startSentenceIndexRef.current = startIdx;
            
            // Mark that we're starting from a valid position
            const startSentence = sentences[startIdx];
            if (startSentence) {
                console.log(`[TTS UI] Starting from sentence ${startIdx}: word ${startSentence.startWordIndex} to ${startSentence.endWordIndex}`);
                // Pre-set the word index to avoid jump to 0
                useTTSStore.getState().setCurrentWordIndex(startSentence.startWordIndex);
                hasStartedPlaybackRef.current = true;
            }
            
            // Show preparing state
            useTTSStore.getState().setPlaybackState('preparing');
            
            // Start generating
            await generateFrom(startIdx);
            
            // If audio is already queued, start playing
            if (ttsPlayer.hasAudioForSentence(startIdx)) {
                await ttsPlayer.play(startIdx);
            }
        } else if (playbackState === 'paused') {
            // Check if user has read ahead with RSVP - if so, start from their new position
            const currentTTSWordIndex = useTTSStore.getState().currentWordIndex;
            
            if (currentWordIndex > currentTTSWordIndex) {
                // User read ahead - find the sentence for their current position
                const sentenceIndex = sentences.findIndex(
                    s => currentWordIndex >= s.startWordIndex && currentWordIndex <= s.endWordIndex
                );
                
                console.log(`[TTS UI] User read ahead from word ${currentTTSWordIndex} to ${currentWordIndex}, resuming from sentence ${sentenceIndex}`);
                
                if (sentenceIndex >= 0) {
                    const startSentence = sentences[sentenceIndex];
                    startSentenceIndexRef.current = sentenceIndex;
                    
                    // Update position and start fresh from this sentence
                    useTTSStore.getState().setCurrentWordIndex(startSentence.startWordIndex);
                    useTTSStore.getState().setPlaybackState('preparing');
                    hasStartedPlaybackRef.current = true;
                    
                    // Clear old queued audio and regenerate from new position
                    ttsPlayer.clearQueue();
                    await generateFrom(sentenceIndex);
                    
                    if (ttsPlayer.hasAudioForSentence(sentenceIndex)) {
                        await ttsPlayer.play(sentenceIndex);
                    }
                    return;
                }
            }
            
            // User didn't read ahead (or read back) - just resume from where we were
            await ttsPlayer.play();
        }
    }, [isReady, playbackState, sentences, currentWordIndex, handleInit, generateFrom]);
    
    // Handle stop - full reset of all TTS resources
    const handleStop = useCallback(() => {
        console.log('[TTS UI] Full stop - clearing all resources');
        
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
        
        // Full player reset
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
        
        console.log('[TTS UI] Stopped and cleared all resources');
    }, []);
    
    // Voice options
    const voices = listVoices();
    const currentVoice = voices.find(v => v.id === voice);
    
    // Speed presets
    const speedOptions = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    
    // Icon components
    const PlayIcon = () => (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
    
    const PauseIcon = () => (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
        </svg>
    );
    
    const StopIcon = () => (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" />
        </svg>
    );
    
    const HeadphonesIcon = () => (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M12 3c-4.97 0-9 4.03-9 9v7a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-1a2 2 0 00-2 2v3a2 2 0 002 2h1a2 2 0 002-2v-7c0-4.97-4.03-9-9-9z" />
        </svg>
    );
    
    const LoadingSpinner = () => (
        <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
    );
    
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
        if (playbackState === 'playing') {
            if (isGenerating) return `${currentTimeStr} / ${durationStr} (buffering...)`;
            return `${currentTimeStr} / ${durationStr}`;
        }
        if (playbackState === 'paused') return `Paused at ${currentTimeStr}`;
        if (error) return error;
        return 'Tap to listen';
    };
    
    // Is button currently showing action?
    const isButtonActive = playbackState === 'playing' || playbackState === 'generating';
    
    // Compact player (minimized)
    if (compact && !isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="fixed bottom-20 right-4 z-50 p-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 group"
                title="Text to Speech"
            >
                <HeadphonesIcon />
                {playbackState === 'playing' && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                )}
            </button>
        );
    }
    
    return (
        <div className={`fixed bottom-20 right-4 z-50 ${compact ? 'w-72' : 'w-80'} bg-black/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-purple-900/50 to-indigo-900/50">
                <div className="flex items-center gap-2">
                    <HeadphonesIcon />
                    <span className="font-mono text-xs text-white/80 uppercase tracking-wider">Listen Mode</span>
                </div>
                {compact && (
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-white/50 hover:text-white transition-colors"
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
                        className={`flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 ${
                            isButtonActive
                                ? 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-500/30'
                                : 'bg-white/10 hover:bg-white/20'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {getButtonContent()}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">
                            {currentVoice?.name ?? 'Select Voice'}
                        </p>
                        <p className="text-xs text-white/50 truncate">
                            {getStatusText()}
                        </p>
                    </div>
                    
                    {playbackState !== 'idle' && (
                        <button
                            onClick={handleStop}
                            className="p-2 text-white/50 hover:text-white transition-colors"
                            title="Stop"
                        >
                            <StopIcon />
                        </button>
                    )}
                </div>
                
                {/* Voice & Speed */}
                <div className="flex gap-2">
                    {/* Voice Selector */}
                    <div className="relative flex-1">
                        <button
                            onClick={() => {
                                setShowVoiceMenu(!showVoiceMenu);
                                setShowSpeedMenu(false);
                            }}
                            className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-left transition-colors"
                        >
                            <span className="text-[10px] text-white/40 uppercase tracking-wider block">Voice</span>
                            <span className="text-sm text-white">{currentVoice?.name ?? 'Default'}</span>
                        </button>
                        
                        {showVoiceMenu && (
                            <div className="absolute bottom-full left-0 right-0 mb-2 bg-black/95 border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                {voices.filter(v => v.quality !== 'D').map(v => (
                                    <button
                                        key={v.id}
                                        onClick={() => {
                                            setVoice(v.id);
                                            setShowVoiceMenu(false);
                                        }}
                                        className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors flex items-center justify-between ${
                                            v.id === voice ? 'bg-purple-600/30 text-purple-300' : 'text-white/80'
                                        }`}
                                    >
                                        <span>{v.name}</span>
                                        <span className="text-[10px] text-white/40">
                                            {v.gender === 'female' ? '♀' : '♂'} {v.accent === 'british' ? '🇬🇧' : '🇺🇸'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* Speed Selector */}
                    <div className="relative">
                        <button
                            onClick={() => {
                                setShowSpeedMenu(!showSpeedMenu);
                                setShowVoiceMenu(false);
                            }}
                            className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-left transition-colors min-w-[70px]"
                        >
                            <span className="text-[10px] text-white/40 uppercase tracking-wider block">Speed</span>
                            <span className="text-sm text-white">{speed}x</span>
                        </button>
                        
                        {showSpeedMenu && (
                            <div className="absolute bottom-full right-0 mb-2 bg-black/95 border border-white/10 rounded-lg shadow-xl overflow-hidden">
                                {speedOptions.map(s => (
                                    <button
                                        key={s}
                                        onClick={() => {
                                            setSpeed(s);
                                            setShowSpeedMenu(false);
                                        }}
                                        className={`w-full px-4 py-2 text-sm hover:bg-white/10 transition-colors ${
                                            s === speed ? 'bg-purple-600/30 text-purple-300' : 'text-white/80'
                                        }`}
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {/* Volume */}
                    <div className="flex items-center gap-2 px-2">
                        <svg className="w-4 h-4 text-white/50" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                        </svg>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={volume}
                            onChange={(e) => setVolume(parseFloat(e.target.value))}
                            className="w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 
                                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                        />
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
