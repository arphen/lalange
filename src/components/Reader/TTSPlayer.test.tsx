import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSPlayer } from './TTSPlayer';
import { streamSpeech } from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';

const mocks = vi.hoisted(() => ({
    voice: 'af_heart',
    setVoice: vi.fn(),
    setGenerating: vi.fn(),
}));

vi.mock('../../core/store/tts', () => ({
    useTTSStore: Object.assign(
        () => ({
            isReady: true,
            isLoading: false,
            isGenerating: false,
            error: null,
            playbackState: 'idle',
            loadProgress: 0,
            loadStatus: '',
            volume: 1,
            speed: 1,
            voice: mocks.voice,
            currentWordIndex: 0,
            setVolume: vi.fn(),
            setSpeed: vi.fn(),
            setVoice: mocks.setVoice,
        }),
        { getState: () => ({ setGenerating: mocks.setGenerating, setPlaybackState: vi.fn(), setCurrentWordIndex: vi.fn() }) },
    ),
    useFormattedTime: () => ({ current: '0:00', duration: '0:00' }),
}));

vi.mock('../../core/tts', () => ({
    initTTS: vi.fn(),
    isTTSReady: vi.fn(() => true),
    streamSpeech: vi.fn(),
    splitIntoSentences: vi.fn(() => [{ index: 0, text: 'Hello world.', startWordIndex: 0, endWordIndex: 1 }]),
    listVoices: vi.fn(() => [
        { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'american', quality: 'A' },
        { id: 'am_adam', name: 'Adam', gender: 'male', accent: 'american', quality: 'A' },
    ]),
    resolveVoiceId: vi.fn((voice: string) => voice === 'af_heart' || voice === 'am_adam' ? voice : 'af_heart'),
}));

vi.mock('../../core/tts/player', () => ({
    ttsPlayer: {
        stop: vi.fn(),
        clearQueue: vi.fn(),
        setOptions: vi.fn(),
        queueAudio: vi.fn(),
        pause: vi.fn(),
        play: vi.fn(),
        hasAudioForSentence: vi.fn(() => false),
    },
}));

describe('TTSPlayer voice changes', () => {
    beforeEach(() => {
        mocks.voice = 'af_heart';
        vi.clearAllMocks();
    });

    it('repairs a legacy foreign voice and clears its queued audio', async () => {
        mocks.voice = 'zf_xiaobei';
        render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        await waitFor(() => expect(mocks.setVoice).toHaveBeenCalledWith('af_heart'));
        expect(ttsPlayer.stop).toHaveBeenCalled();
        expect(ttsPlayer.clearQueue).toHaveBeenCalled();
        expect(mocks.setGenerating).toHaveBeenCalledWith(false);
    });

    it('keeps replacement generation state when an aborted generator finishes', async () => {
        let finishOldGeneration: (() => void) | undefined;
        let holdReplacementGeneration: (() => void) | undefined;
        const oldGenerationReady = new Promise<void>((resolve) => { finishOldGeneration = resolve; });
        const replacementGenerationReady = new Promise<void>((resolve) => { holdReplacementGeneration = resolve; });

        vi.mocked(streamSpeech)
            .mockReturnValueOnce((async function* () {
                await oldGenerationReady;
                yield {
                    sentence: { index: -1, text: '', startWordIndex: 0, endWordIndex: 0 },
                    audio: { samples: new Float32Array(0), sampleRate: 24000, duration: 0, text: '' },
                };
            })())
            .mockReturnValueOnce((async function* () {
                await replacementGenerationReady;
                yield {
                    sentence: { index: -1, text: '', startWordIndex: 0, endWordIndex: 0 },
                    audio: { samples: new Float32Array(0), sampleRate: 24000, duration: 0, text: '' },
                };
            })());

        const { container, rerender, unmount } = render(
            <TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />,
        );
        fireEvent.click(container.querySelector('button')!);
        await waitFor(() => expect(streamSpeech).toHaveBeenCalledTimes(1));

        mocks.voice = 'am_adam';
        rerender(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        await waitFor(() => expect(ttsPlayer.clearQueue).toHaveBeenCalled());

        fireEvent.click(container.querySelector('button')!);
        await waitFor(() => expect(streamSpeech).toHaveBeenCalledTimes(2));
        mocks.setGenerating.mockClear();

        await act(async () => finishOldGeneration?.());
        expect(mocks.setGenerating).not.toHaveBeenCalledWith(false);

        unmount();
        holdReplacementGeneration?.();
    });
});