/**
 * TTS State Management Store
 * 
 * Manages TTS playback state, settings, and sync position.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TTSPlaybackState = 'idle' | 'loading' | 'preparing' | 'playing' | 'paused' | 'generating';
export type TTSBackendPreference = 'auto' | 'wasm' | 'webgpu';

export interface TTSPosition {
    bookId: string;
    chapterId: string;
    sentenceIndex: number;
    wordIndex: number;
    audioTime: number; // Seconds into the audio
    timestamp: number; // When this position was recorded (for sync)
}

interface TTSState {
    // Engine State
    isReady: boolean;
    isLoading: boolean;
    isGenerating: boolean;
    error: string | null;
    loadProgress: number;
    loadStatus: string;
    
    // Playback State
    playbackState: TTSPlaybackState;
    currentTime: number;
    duration: number;
    currentSentence: number;
    currentWordIndex: number;
    volume: number;
    speed: number;
    
    // Settings (persisted)
    voice: string;
    backendPreference: TTSBackendPreference;
    bufferAhead: number;
    autoPlay: boolean;
    
    // Position tracking for sync
    currentPosition: TTSPosition | null;
    
    // Actions - Engine
    setReady: (ready: boolean) => void;
    setLoading: (loading: boolean) => void;
    setGenerating: (generating: boolean) => void;
    setError: (error: string | null) => void;
    setProgress: (progress: number, status: string) => void;
    
    // Actions - Playback
    setPlaybackState: (state: TTSPlaybackState) => void;
    setCurrentTime: (time: number) => void;
    setDuration: (duration: number) => void;
    setCurrentSentence: (index: number) => void;
    setCurrentWordIndex: (index: number) => void;
    setVolume: (volume: number) => void;
    setSpeed: (speed: number) => void;
    
    // Actions - Settings
    setVoice: (voice: string) => void;
    setBackendPreference: (backendPreference: TTSBackendPreference) => void;
    setBufferAhead: (bufferAhead: number) => void;
    setAutoPlay: (autoPlay: boolean) => void;
    
    // Actions - Position
    updatePosition: (position: Partial<TTSPosition>) => void;
    clearPosition: () => void;
}

export const useTTSStore = create<TTSState>()(
    persist(
        (set) => ({
            // Engine State - Initial
            isReady: false,
            isLoading: false,
            isGenerating: false,
            error: null,
            loadProgress: 0,
            loadStatus: '',
            
            // Playback State - Initial
            playbackState: 'idle',
            currentTime: 0,
            duration: 0,
            currentSentence: 0,
            currentWordIndex: 0,
            volume: 1.0,
            speed: 1.0,
            
            // Settings - Initial (persisted)
            voice: 'af_heart',
            backendPreference: 'auto',
            bufferAhead: 5,
            autoPlay: false,
            
            // Position - Initial
            currentPosition: null,
            
            // Actions - Engine
            setReady: (ready) => set({ isReady: ready }),
            setLoading: (loading) => set({ isLoading: loading }),
            setGenerating: (generating) => set({ isGenerating: generating }),
            setError: (error) => set({ error }),
            setProgress: (progress, status) => set({ loadProgress: progress, loadStatus: status }),
            
            // Actions - Playback
            setPlaybackState: (state) => set({ playbackState: state }),
            setCurrentTime: (time) => set({ currentTime: time }),
            setDuration: (duration) => set({ duration }),
            setCurrentSentence: (index) => set({ currentSentence: index }),
            setCurrentWordIndex: (index) => set({ currentWordIndex: index }),
            setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
            setSpeed: (speed) => set({ speed: Math.max(0.5, Math.min(2, speed)) }),
            
            // Actions - Settings
            setVoice: (voice) => set({ voice }),
            setBackendPreference: (backendPreference) => set({ backendPreference }),
            setBufferAhead: (bufferAhead) => set({ bufferAhead: Math.max(3, Math.min(12, Math.round(bufferAhead))) }),
            setAutoPlay: (autoPlay) => set({ autoPlay }),
            
            // Actions - Position
            updatePosition: (position) => set((state) => ({
                currentPosition: {
                    ...state.currentPosition,
                    ...position,
                    timestamp: Date.now(),
                } as TTSPosition
            })),
            clearPosition: () => set({ currentPosition: null }),
        }),
        {
            name: 'xyz-tts-settings',
            // Only persist settings, not runtime state
            partialize: (state) => ({
                voice: state.voice,
                backendPreference: state.backendPreference,
                bufferAhead: state.bufferAhead,
                autoPlay: state.autoPlay,
                volume: state.volume,
                speed: state.speed,
            }),
            merge: (persistedState, currentState) => {
                const settings = { ...(persistedState as Record<string, unknown>) };
                delete settings.quantization;
                return { ...currentState, ...settings } as TTSState;
            },
        }
    )
);

/**
 * Helper hook to check if TTS is currently active (playing or generating)
 */
export function useTTSActive(): boolean {
    const playbackState = useTTSStore((s) => s.playbackState);
    return playbackState === 'playing' || playbackState === 'generating';
}

/**
 * Helper hook to get formatted playback time
 */
export function useFormattedTime(): { current: string; duration: string } {
    const currentTime = useTTSStore((s) => s.currentTime);
    const duration = useTTSStore((s) => s.duration);
    
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    
    return {
        current: formatTime(currentTime),
        duration: formatTime(duration),
    };
}
