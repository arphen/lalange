import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ttsPlayer } from './player';

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

    currentTime = 0;
    state: AudioContextState = 'running';
    destination = {} as AudioDestinationNode;

    constructor() {
        FakeAudioContext.current = this;
    }

    createGain(): GainNode {
        return {
            gain: { value: 1 },
            connect: vi.fn(),
        } as unknown as GainNode;
    }

    createBuffer(): AudioBuffer {
        return { copyToChannel: vi.fn() } as unknown as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
        return {
            buffer: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        } as unknown as AudioBufferSourceNode;
    }

    resume(): Promise<void> {
        return Promise.resolve();
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
});