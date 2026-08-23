import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTTSStore } from './tts';

const storage = {
    getItem: vi.fn((): string | null => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    useTTSStore.persist.setOptions({ storage });
    useTTSStore.setState({
        voice: 'af_heart',
        activeVoiceOverride: null,
        backendPreference: 'auto',
        bufferAhead: 5,
        autoPlay: false,
        volume: 1,
        speed: 1,
        continuityMode: 'continuous',
        currentTime: 0,
        currentWordIndex: 0,
    });
    storage.setItem.mockClear();
});

describe('TTS settings persistence', () => {
    it('does not write settings during runtime playback updates', () => {
        for (let tick = 0; tick < 300; tick++) {
            useTTSStore.getState().setCurrentTime(tick / 10);
            useTTSStore.getState().setCurrentWordIndex(tick % 20);
            useTTSStore.getState().setProgress(tick / 300, 'Playing');
        }

        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('writes one settings payload for one settings action', () => {
        useTTSStore.getState().setVolume(0.75);

        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({
            state: {
                voice: 'af_heart',
                backendPreference: 'auto',
                bufferAhead: 5,
                autoPlay: false,
                volume: 0.75,
                speed: 1,
                continuityMode: 'continuous',
            },
            version: 0,
        });

        useTTSStore.getState().setVolume(0.75);
        expect(storage.setItem).toHaveBeenCalledTimes(1);
    });

    it('can dispose and restart settings persistence', () => {
        useTTSStore.persist.dispose();
        useTTSStore.getState().setVolume(0.75);
        expect(storage.setItem).not.toHaveBeenCalled();

        useTTSStore.persist.start();
        useTTSStore.getState().setVolume(0.8);

        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.setItem.mock.calls[0][1]).state.volume).toBe(0.8);
    });

    it('hydrates legacy settings and ignores obsolete fields', async () => {
        storage.getItem.mockReturnValue(JSON.stringify({
            state: {
                voice: 'bf_emma',
                backendPreference: 'wasm',
                bufferAhead: 7,
                autoPlay: true,
                volume: 0.5,
                speed: 1.5,
                continuityMode: 'continuous',
                quantization: 'q8',
                currentTime: 99,
            },
            version: 0,
        }));

        await useTTSStore.persist.rehydrate();

        const state = useTTSStore.getState();
        expect({
            voice: state.voice,
            backendPreference: state.backendPreference,
            bufferAhead: state.bufferAhead,
            autoPlay: state.autoPlay,
            volume: state.volume,
            speed: state.speed,
            continuityMode: state.continuityMode,
        }).toEqual({
            voice: 'bf_emma',
            backendPreference: 'wasm',
            bufferAhead: 7,
            autoPlay: true,
            volume: 0.5,
            speed: 1.5,
            continuityMode: 'continuous',
        });
        expect(state.currentTime).toBe(0);
        expect(storage.setItem).toHaveBeenCalledTimes(1);
    });

    it('defaults missing continuity settings to continuous playback', async () => {
        storage.getItem.mockReturnValue(JSON.stringify({ state: { speed: 1.25 }, version: 0 }));

        await useTTSStore.persist.rehydrate();

        expect(useTTSStore.getState().continuityMode).toBe('continuous');
    });

    it('does not persist transient pacing snapshots', () => {
        useTTSStore.getState().setPacingSnapshot({
            preferredSpeed: 1,
            effectiveSpeed: 0.8,
            sustainableSpeed: 0.8,
            generationRtf: 1,
            paceState: 'limited',
            continuityMode: 'continuous',
            hasStableMeasurement: true,
            deliveredWpm: 120,
            reason: 'device-limit',
        });

        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('does not persist an active fallback voice override', () => {
        useTTSStore.getState().setActiveVoiceOverride('en_US-amy-low');

        expect(useTTSStore.getState().activeVoiceOverride).toBe('en_US-amy-low');
        expect(storage.setItem).not.toHaveBeenCalled();
    });
});