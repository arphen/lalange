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

// Configuration for incremental generation
const SENTENCES_AHEAD_BUFFER = 5; // Generate this many sentences ahead of current
const CHECK_BUFFER_INTERVAL_MS = 2000; // How often to check if we need more audio

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
        setVolume,
        setSpeed,
        setVoice,
        setDuration,
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
    const bufferCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const currentGenerationStartIndexRef = useRef<number>(0);
    
    // Split words into sentences on mount/change
    useEffect(() => {
        // Detect if words actually changed (chapter navigation)
        const wordsChanged = wordsRef.current !== words && 
            (wordsRef.current.length !== words.length || 
             wordsRef.current[0] !== words[0]);
        
        if (wordsChanged) {
            console.log('[TTS UI] Words changed, clearing queue and stopping generation');
            
            // Stop any ongoing generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            generatorRef.current = null;
            
            // Clear the audio queue to free memory
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
            console.log('[TTS UI] Unmounting, cleaning up resources');
            
            // Stop buffer check interval
            if (bufferCheckIntervalRef.current) {
                clearInterval(bufferCheckIntervalRef.current);
            }
            
            // Abort any ongoing generation
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            isGeneratingRef.current = false;
            
            // Stop playback and clear queue
            ttsPlayer.stop();
            ttsPlayer.clearQueue();
        };
    }, []);
    
    // Generate and queue audio incrementally (only sentences ahead of current)
    const startGeneration = useCallback(async (fromSentenceIndex: number = 0) => {
        if (isGeneratingRef.current || sentences.length === 0) return;
        
        // Create abort controller for this generation session
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
        
        isGeneratingRef.current = true;
        currentGenerationStartIndexRef.current = fromSentenceIndex;
        
        // Only generate a window of sentences, not all of them
        const endIndex = Math.min(fromSentenceIndex + SENTENCES_AHEAD_BUFFER, sentences.length);
        const sentencesToGenerate = sentences.slice(fromSentenceIndex, endIndex);
        
        console.log(`[TTS UI] Starting generation from sentence ${fromSentenceIndex} to ${endIndex - 1} (${sentencesToGenerate.length} sentences)`);
        
        generatorRef.current = streamSpeech(sentencesToGenerate, {
            voice,
            speed,
            onSentenceStart: (sentence) => {
                if (signal.aborted) return;
                console.log(`[TTS] Generating sentence ${sentence.index}: "${sentence.text.slice(0, 50)}..."`);
            },
            onSentenceComplete: (sentence, audio) => {
                if (signal.aborted) return;
                ttsPlayer.queueAudio(audio, sentence);
                setDuration(ttsPlayer.getState().duration);
            },
        });
        
        try {
            // Start generating the window of sentences
            for await (const { sentence } of generatorRef.current) {
                if (signal.aborted) {
                    console.log('[TTS UI] Generation aborted');
                    break;
                }
                
                // Start playing as soon as first sentence is ready
                if (sentence.index === fromSentenceIndex && playbackState !== 'playing') {
                    await ttsPlayer.play();
                }
            }
        } catch (err) {
            if (!signal.aborted) {
                console.error('[TTS] Generation error:', err);
            }
        } finally {
            isGeneratingRef.current = false;
            generatorRef.current = null;
        }
    }, [sentences, voice, speed, playbackState, setDuration]);
    
    // Check if we need to generate more audio ahead
    const checkAndGenerateAhead = useCallback(async () => {
        if (isGeneratingRef.current || sentences.length === 0) return;
        if (playbackState !== 'playing') return;
        
        const currentIdx = ttsPlayer.getState().currentSentenceIndex;
        const neededAheadIdx = currentIdx + SENTENCES_AHEAD_BUFFER;
        
        // Check if we have audio for sentences ahead
        let needsMoreAudio = false;
        for (let i = currentIdx; i < Math.min(neededAheadIdx, sentences.length); i++) {
            if (!ttsPlayer.hasAudioForSentence(i)) {
                needsMoreAudio = true;
                break;
            }
        }
        
        if (needsMoreAudio && currentIdx + 1 < sentences.length) {
            console.log(`[TTS UI] Buffer running low at sentence ${currentIdx}, generating more`);
            await startGeneration(currentIdx + 1);
        }
    }, [sentences, playbackState, startGeneration]);
    
    // Set up interval to check if we need more audio
    useEffect(() => {
        if (playbackState === 'playing') {
            bufferCheckIntervalRef.current = setInterval(checkAndGenerateAhead, CHECK_BUFFER_INTERVAL_MS);
        } else {
            if (bufferCheckIntervalRef.current) {
                clearInterval(bufferCheckIntervalRef.current);
                bufferCheckIntervalRef.current = null;
            }
        }
        
        return () => {
            if (bufferCheckIntervalRef.current) {
                clearInterval(bufferCheckIntervalRef.current);
            }
        };
    }, [playbackState, checkAndGenerateAhead]);
    
    // Handle play/pause toggle
    const handleToggle = useCallback(async () => {
        if (!isReady) {
            await handleInit();
        }
        
        if (playbackState === 'idle' || playbackState === 'loading') {
            // Find sentence containing current word
            const sentenceIndex = sentences.findIndex(
                s => currentWordIndex >= s.startWordIndex && currentWordIndex <= s.endWordIndex
            );
            await startGeneration(Math.max(0, sentenceIndex));
        } else {
            await ttsPlayer.toggle();
        }
    }, [isReady, playbackState, sentences, currentWordIndex, handleInit, startGeneration]);
    
    // Sync word position from audio playback
    useEffect(() => {
        ttsPlayer.setOptions({
            onTimeUpdate: () => {
                if (onPositionChange) {
                    const wordIndex = ttsPlayer.getCurrentWordIndex();
                    onPositionChange(wordIndex);
                }
            },
            onSentenceChange: (sentenceIndex) => {
                // Update reading position
                const sentence = sentences[sentenceIndex];
                if (sentence && onPositionChange) {
                    onPositionChange(sentence.startWordIndex);
                }
            },
            onEnded: () => {
                console.log('[TTS] Playback ended');
            },
        });
    }, [sentences, onPositionChange]);
    
    // Handle stop
    const handleStop = useCallback(() => {
        // Abort any ongoing generation
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        isGeneratingRef.current = false;
        
        ttsPlayer.stop();
        ttsPlayer.clearQueue();
        
        console.log(`[TTS UI] Stopped. Queue size: ${ttsPlayer.getQueueSize()}`);
    }, []);
    
    // Handle seek from slider
    const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        ttsPlayer.seekTo(time);
    }, []);
    
    // Calculate progress
    const progress = useTTSStore(s => s.duration > 0 ? (s.currentTime / s.duration) * 100 : 0);
    
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
    
    // Render states
    const getButtonContent = () => {
        if (isLoading) {
            return <LoadingSpinner />;
        }
        if (isGenerating && playbackState !== 'playing') {
            return <LoadingSpinner />;
        }
        if (playbackState === 'playing') {
            return <PauseIcon />;
        }
        return <PlayIcon />;
    };
    
    const getStatusText = () => {
        if (isLoading) {
            return `${loadStatus} (${Math.round(loadProgress * 100)}%)`;
        }
        if (isGenerating) {
            return 'Generating audio...';
        }
        if (playbackState === 'playing') {
            return `${currentTimeStr} / ${durationStr}`;
        }
        if (playbackState === 'paused') {
            return `Paused at ${currentTimeStr}`;
        }
        if (error) {
            return error;
        }
        return 'Tap to listen';
    };
    
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
                            playbackState === 'playing'
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
                
                {/* Progress Bar */}
                {(playbackState === 'playing' || playbackState === 'paused') && (
                    <div className="space-y-1">
                        <input
                            type="range"
                            min="0"
                            max={useTTSStore.getState().duration || 100}
                            value={useTTSStore.getState().currentTime}
                            onChange={handleSeek}
                            className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                                       [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer
                                       [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-purple-500/50"
                            style={{
                                background: `linear-gradient(to right, rgb(168, 85, 247) ${progress}%, rgba(255,255,255,0.2) ${progress}%)`
                            }}
                        />
                        <div className="flex justify-between text-[10px] text-white/40 font-mono">
                            <span>{currentTimeStr}</span>
                            <span>{durationStr}</span>
                        </div>
                    </div>
                )}
                
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
