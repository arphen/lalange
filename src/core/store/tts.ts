/**
 * TTS State Management Store
 * 
 * Manages TTS playback state, settings, and sync position.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { useShallow } from 'zustand/react/shallow';

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

interface TTSPersistedSettings {
    voice: string;
    backendPreference: TTSBackendPreference;
    bufferAhead: number;
    autoPlay: boolean;
    volume: number;
    speed: number;
}

interface TTSSettingsStorage {
    getItem: (name: string) => string | null;
    setItem: (name: string, value: string) => void;
    removeItem: (name: string) => void;
}

const TTS_SETTINGS_STORAGE_KEY = 'xyz-tts-settings';
const DEFAULT_TTS_SETTINGS: TTSPersistedSettings = {
    voice: 'af_heart',
    backendPreference: 'auto',
    bufferAhead: 5,
    autoPlay: false,
    volume: 1.0,
    speed: 1.0,
};

function getTTSSettingsStorage(): TTSSettingsStorage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readPersistedTTSSettings(storage: TTSSettingsStorage | null): Partial<TTSPersistedSettings> {
    if (!storage) return {};

    try {
        const raw = storage.getItem(TTS_SETTINGS_STORAGE_KEY);
        if (!raw) return {};

        const parsed: unknown = JSON.parse(raw);
        const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed;
        if (!isRecord(state)) return {};

        const settings: Partial<TTSPersistedSettings> = {};
        if (typeof state.voice === 'string') settings.voice = state.voice;
        if (state.backendPreference === 'auto' || state.backendPreference === 'wasm' || state.backendPreference === 'webgpu') {
            settings.backendPreference = state.backendPreference;
        }
        if (typeof state.bufferAhead === 'number') settings.bufferAhead = state.bufferAhead;
        if (typeof state.autoPlay === 'boolean') settings.autoPlay = state.autoPlay;
        if (typeof state.volume === 'number') settings.volume = state.volume;
        if (typeof state.speed === 'number') settings.speed = state.speed;
        return settings;
    } catch {
        return {};
    }
}

function selectPersistedTTSSettings(state: TTSState): TTSPersistedSettings {
    return {
        voice: state.voice,
        backendPreference: state.backendPreference,
        bufferAhead: state.bufferAhead,
        autoPlay: state.autoPlay,
        volume: state.volume,
        speed: state.speed,
    };
}

let ttsSettingsStorage = getTTSSettingsStorage();
let lastPersistedTTSSettings: string | null = null;

const ttsStore = create<TTSState>()(
    subscribeWithSelector((set) => ({
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
            ...DEFAULT_TTS_SETTINGS,
            
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
            }))
);

    ttsStore.setState({
        ...readPersistedTTSSettings(ttsSettingsStorage),
    });

    ttsStore.subscribe(
        selectPersistedTTSSettings,
        (settings) => {
            const payload = JSON.stringify({ state: settings, version: 0 });
            if (payload === lastPersistedTTSSettings) return;

            try {
                ttsSettingsStorage?.setItem(TTS_SETTINGS_STORAGE_KEY, payload);
                lastPersistedTTSSettings = payload;
            } catch {
                // Storage can be unavailable or full; playback must continue.
            }
        },
        { equalityFn: shallow },
    );

    export const useTTSStore = Object.assign(ttsStore, {
        persist: {
            setOptions: (options: { storage?: TTSSettingsStorage }) => {
                if (options.storage) {
                    ttsSettingsStorage = options.storage;
                    lastPersistedTTSSettings = null;
                }
            },
            rehydrate: async () => {
                ttsStore.setState(readPersistedTTSSettings(ttsSettingsStorage));
            },
        },
    });

/**
 * Helper hook to check if TTS is currently active (playing or generating)
 */
export function useTTSActive(): boolean {
    const playbackState = useTTSStore((s) => s.playbackState);
    return playbackState === 'playing' || playbackState === 'generating';
}

export function formatTTSPlaybackTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Helper hook to get formatted playback time
 */
export function useFormattedTime(): { current: string; duration: string } {
    const { currentTime, duration } = useTTSStore(useShallow((state) => ({
        currentTime: state.currentTime,
        duration: state.duration,
    })));
    
    return {
        current: formatTTSPlaybackTime(currentTime),
        duration: formatTTSPlaybackTime(duration),
    };
}
