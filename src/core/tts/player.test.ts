import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWordProgressBoundaries, ttsPlayer } from './player';

const ttsState = vi.hoisted(() => ({
    currentWordIndex: 0,
    setPlaybackState: vi.fn(),
    setCurrentTime: vi.fn(),
    setDuration: vi.fn(),
    setCurrentSentence: vi.fn(),
    setCurrentWordIndex: vi.fn(),
    setVolume: vi.fn(),
}));

vi.mock('../store/tts', () => ({
    useTTSStore: { getState: () => ttsState },
}));

class FakeAudioContext {
    static current: FakeAudioContext | null = null;
    static supportsCopyToChannel = true;
    static supportsResume = true;
    static supportsSourceStart = true;
    static initialState: AudioContextState = 'running';
    static resumePromise: Promise<void> | null = null;
    static channelData = new Float32Array();
    static noteOn = vi.fn();
    static sources: AudioBufferSourceNode[] = [];

    currentTime = 0;
    state: AudioContextState = FakeAudioContext.initialState;
    destination = {} as AudioDestinationNode;

    constructor() {
        FakeAudioContext.current = this;
        if (!FakeAudioContext.supportsResume) {
            Object.defineProperty(this, 'resume', { value: undefined });
        }
    }

    createGain(): GainNode {
        return {
            gain: { value: 1 },
            connect: vi.fn(),
        } as unknown as GainNode;
    }

    createBuffer(): AudioBuffer {
        FakeAudioContext.channelData = new Float32Array(4);
        return {
            copyToChannel: FakeAudioContext.supportsCopyToChannel ? vi.fn() : undefined,
            getChannelData: vi.fn(() => FakeAudioContext.channelData),
        } as unknown as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
        const source = {
            buffer: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: FakeAudioContext.supportsSourceStart ? vi.fn() : undefined,
            noteOn: FakeAudioContext.noteOn,
            stop: vi.fn(),
            onended: null,
        } as unknown as AudioBufferSourceNode;
        FakeAudioContext.sources.push(source);
        return source;
    }

    resume(): Promise<void> {
        return FakeAudioContext.resumePromise ?? Promise.resolve();
    }

    close(): Promise<void> {
        return Promise.resolve();
    }
}

describe('TTSAudioPlayer word tracking', () => {
    let nextAnimationFrame: FrameRequestCallback | null;

    beforeEach(() => {
        ttsPlayer.dispose();
        ttsPlayer.clearQueue();
        vi.clearAllMocks();
        ttsState.currentWordIndex = 0;
        ttsState.setCurrentWordIndex.mockImplementation((wordIndex: number) => {
            ttsState.currentWordIndex = wordIndex;
        });
        FakeAudioContext.current = null;
        FakeAudioContext.supportsCopyToChannel = true;
        FakeAudioContext.supportsResume = true;
        FakeAudioContext.supportsSourceStart = true;
        FakeAudioContext.initialState = 'running';
        FakeAudioContext.resumePromise = null;
        FakeAudioContext.channelData = new Float32Array();
        FakeAudioContext.noteOn.mockReset();
        FakeAudioContext.sources = [];
        nextAnimationFrame = null;
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            nextAnimationFrame = callback;
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        ttsPlayer.dispose();
        vi.unstubAllGlobals();
    });

    it('emits intermediate word indices as the sentence audio advances', async () => {
        const onWordChange = vi.fn();
        ttsPlayer.setOptions({ onWordChange });
        await ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 4, text: 'One two three four.' },
            { index: 0, text: 'One two three four.', startWordIndex: 10, endWordIndex: 13 },
        );

        await ttsPlayer.play(0);
        expect(onWordChange).toHaveBeenLastCalledWith(10);

        FakeAudioContext.current!.currentTime = 2;
        nextAnimationFrame?.(0);

        expect(onWordChange).toHaveBeenLastCalledWith(12);
        expect(onWordChange).toHaveBeenCalledTimes(2);
    });

    it('keeps long complex middle words active longer than uniform timing', async () => {
        const onWordChange = vi.fn();
        ttsPlayer.setOptions({ onWordChange });

        const sentenceText = 'a supercalifragilisticexpialidocious b c.';
        await ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 4, text: sentenceText },
            { index: 0, text: sentenceText, startWordIndex: 20, endWordIndex: 23 },
        );

        await ttsPlayer.play(0);
        expect(onWordChange).toHaveBeenLastCalledWith(20);

        FakeAudioContext.current!.currentTime = 2;
        nextAnimationFrame?.(0);

        expect(onWordChange).toHaveBeenLastCalledWith(21);
    });

    it('schedules the full contiguous queue before the current source ends', async () => {
        for (let index = 0; index < 4; index++) {
            await ttsPlayer.queueAudio(
                { samples: new Float32Array(4), sampleRate: 24000, duration: 2, text: `Sentence ${index}.` },
                { index, text: `Sentence ${index}.`, startWordIndex: index, endWordIndex: index },
            );
        }

        await ttsPlayer.play(0);

        expect(FakeAudioContext.sources).toHaveLength(4);
        expect(FakeAudioContext.sources[1].start).toHaveBeenCalledWith(2);
        expect(FakeAudioContext.sources[2].start).toHaveBeenCalledWith(4);
        expect(FakeAudioContext.sources[3].start).toHaveBeenCalledWith(6);
    });

    it('continues scheduling from the promoted sentence without a handoff restart', async () => {
        for (let index = 0; index < 3; index++) {
            await ttsPlayer.queueAudio(
                { samples: new Float32Array(4), sampleRate: 24000, duration: 2, text: `Sentence ${index}.` },
                { index, text: `Sentence ${index}.`, startWordIndex: index, endWordIndex: index },
            );
        }

        await ttsPlayer.play(0);
        FakeAudioContext.sources[0].onended?.(new Event('ended'));

        expect(ttsPlayer.getState().currentSentenceIndex).toBe(1);
        expect(FakeAudioContext.sources).toHaveLength(3);
        expect(FakeAudioContext.sources[1].start).toHaveBeenCalledTimes(1);
        expect(FakeAudioContext.sources[2].start).toHaveBeenCalledWith(4);

        FakeAudioContext.sources[1].onended?.(new Event('ended'));

        expect(ttsPlayer.getState().currentSentenceIndex).toBe(2);
        expect(FakeAudioContext.sources).toHaveLength(3);
        expect(FakeAudioContext.sources[2].start).toHaveBeenCalledTimes(1);
    });

    it('does not replay scheduled samples when handoff callbacks are severely delayed', async () => {
        for (let index = 0; index < 3; index++) {
            await ttsPlayer.queueAudio(
                { samples: new Float32Array(4), sampleRate: 24000, duration: 2, text: `Sentence ${index}.` },
                { index, text: `Sentence ${index}.`, startWordIndex: index, endWordIndex: index },
            );
        }

        await ttsPlayer.play(0);
        FakeAudioContext.sources[1].onended?.(new Event('ended'));
        FakeAudioContext.sources[2].onended?.(new Event('ended'));
        FakeAudioContext.sources[0].onended?.(new Event('ended'));

        expect(ttsPlayer.getState().currentSentenceIndex).toBe(3);
        expect(FakeAudioContext.sources).toHaveLength(3);
        for (const source of FakeAudioContext.sources) {
            expect(source.start).toHaveBeenCalledTimes(1);
        }
    });

    it('does not display elapsed time beyond the audible sentence duration', async () => {
        await ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 4, text: 'One two.' },
            { index: 0, text: 'One two.', startWordIndex: 0, endWordIndex: 1 },
        );
        await ttsPlayer.play(0);

        FakeAudioContext.current!.currentTime = 6;
        nextAnimationFrame?.(0);

        expect(ttsState.setCurrentTime).toHaveBeenLastCalledWith(4);
    });

    it('samples the displayed clock instead of updating React every animation frame', async () => {
        await ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 4, text: 'One two.' },
            { index: 0, text: 'One two.', startWordIndex: 0, endWordIndex: 1 },
        );
        await ttsPlayer.play(0);
        ttsState.setCurrentTime.mockClear();

        FakeAudioContext.current!.currentTime = 0.05;
        nextAnimationFrame?.(0);

        expect(ttsState.setCurrentTime).not.toHaveBeenCalled();

        FakeAudioContext.current!.currentTime = 0.2;
        nextAnimationFrame?.(0);

        expect(ttsState.setCurrentTime).toHaveBeenLastCalledWith(0.2);
    });

    it('queues audio when copyToChannel is unavailable', async () => {
        FakeAudioContext.supportsCopyToChannel = false;
        const samples = new Float32Array([0.25, -0.5, 0.75, -1]);

        await expect(ttsPlayer.queueAudio(
            { samples, sampleRate: 24000, duration: 1, text: 'Phone audio.' },
            { index: 0, text: 'Phone audio.', startWordIndex: 0, endWordIndex: 1 },
        )).resolves.toBeUndefined();

        expect(Array.from(FakeAudioContext.channelData)).toEqual(Array.from(samples));
    });

    it('uses the prefixed AudioContext constructor on iOS browsers', async () => {
        vi.stubGlobal('AudioContext', undefined);
        vi.stubGlobal('webkitAudioContext', FakeAudioContext);

        await expect(ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 1, text: 'Phone audio.' },
            { index: 0, text: 'Phone audio.', startWordIndex: 0, endWordIndex: 1 },
        )).resolves.toBeUndefined();

        expect(FakeAudioContext.current).toBeInstanceOf(FakeAudioContext);
    });

    it('does not require resume when a prefixed context omits it', async () => {
        FakeAudioContext.supportsResume = false;

        await expect(ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 1, text: 'Phone audio.' },
            { index: 0, text: 'Phone audio.', startWordIndex: 0, endWordIndex: 1 },
        )).resolves.toBeUndefined();
    });

    it('uses noteOn when a prefixed buffer source omits start', async () => {
        FakeAudioContext.supportsSourceStart = false;

        await ttsPlayer.queueAudio(
            { samples: new Float32Array(4), sampleRate: 24000, duration: 1, text: 'Phone audio.' },
            { index: 0, text: 'Phone audio.', startWordIndex: 0, endWordIndex: 1 },
        );
        await ttsPlayer.play(0);

        expect(FakeAudioContext.noteOn).toHaveBeenCalledWith(0);
    });

    it('does not restart playback when stop interrupts audio context resume', async () => {
        let finishResume: (() => void) | undefined;
        FakeAudioContext.initialState = 'suspended';
        FakeAudioContext.resumePromise = new Promise<void>((resolve) => {
            finishResume = resolve;
        });

        const playPromise = ttsPlayer.play(0);
        await vi.waitFor(() => expect(FakeAudioContext.current).not.toBeNull());

        ttsPlayer.stop();
        finishResume?.();
        await playPromise;

        expect(ttsPlayer.getState().isPlaying).toBe(false);
        expect(ttsState.setPlaybackState).not.toHaveBeenCalledWith('playing');
    });
});

describe('buildWordProgressBoundaries', () => {
    it('returns normalized monotonic boundaries ending at 1', () => {
        const boundaries = buildWordProgressBoundaries('One, two three four.', 4);

        expect(boundaries).toHaveLength(4);
        expect(boundaries[0]).toBeGreaterThan(0);
        expect(boundaries[3]).toBe(1);
        expect(boundaries[1]).toBeGreaterThanOrEqual(boundaries[0]);
        expect(boundaries[2]).toBeGreaterThanOrEqual(boundaries[1]);
    });
});