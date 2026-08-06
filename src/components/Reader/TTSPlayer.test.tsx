import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSPlayer } from './TTSPlayer';
import { initTTS, streamSpeech } from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';

const mocks = vi.hoisted(() => ({
    voice: 'af_heart',
    backendPreference: 'auto' as 'auto' | 'wasm' | 'webgpu',
    bufferAhead: 5,
    setSpeed: vi.fn(),
    setVoice: vi.fn(),
    setGenerating: vi.fn(),
    setError: vi.fn(),
    setPlaybackState: vi.fn(),
    playbackState: 'idle' as 'idle' | 'preparing' | 'playing' | 'paused' | 'generating',
    sentences: [{ index: 0, text: 'Hello world.', startWordIndex: 0, endWordIndex: 1 }],
}));

vi.mock('../../core/store/tts', () => ({
    useTTSStore: Object.assign(
        () => ({
            isReady: true,
            isLoading: false,
            isGenerating: false,
            error: null,
            playbackState: mocks.playbackState,
            loadProgress: 0,
            loadStatus: '',
            volume: 1,
            speed: 1,
            voice: mocks.voice,
            backendPreference: mocks.backendPreference,
            bufferAhead: mocks.bufferAhead,
            currentWordIndex: 0,
            setVolume: vi.fn(),
            setSpeed: mocks.setSpeed,
            setVoice: mocks.setVoice,
        }),
        {
            getState: () => ({
                setGenerating: mocks.setGenerating,
                setError: mocks.setError,
                setPlaybackState: mocks.setPlaybackState,
                setCurrentWordIndex: vi.fn(),
            }),
        },
    ),
    useFormattedTime: () => ({ current: '0:00', duration: '0:00' }),
}));

const VOICES = vi.hoisted(() => [
    { id: 'af_heart', name: 'Heart', engine: 'kokoro', gender: 'female', quality: 'A', language: 'en-US', languageLabel: 'American English', flag: '🇺🇸' },
    { id: 'am_adam', name: 'Adam', engine: 'kokoro', gender: 'male', quality: 'A', language: 'en-US', languageLabel: 'American English', flag: '🇺🇸' },
    { id: 'sl_SI-artur-medium', name: 'Artur', engine: 'piper', gender: 'male', quality: 'B', language: 'sl-SI', languageLabel: 'Slovenian', flag: '🇸🇮' },
]);

vi.mock('../../core/tts', () => ({
    initTTS: vi.fn(),
    isTTSReady: vi.fn(() => true),
    streamSpeech: vi.fn(),
    splitIntoSentences: vi.fn(() => mocks.sentences),
    listVoices: vi.fn(() => VOICES),
    getVoice: vi.fn((voiceId: string) => VOICES.find((voice) => voice.id === voiceId)),
    resolveVoiceId: vi.fn((voice: string) => VOICES.some((entry) => entry.id === voice) ? voice : 'af_heart'),
}));

vi.mock('../../core/tts/player', () => ({
    ttsPlayer: {
        stop: vi.fn(),
        clearQueue: vi.fn(),
        getQueueSize: vi.fn(() => 0),
        getBufferedAheadCount: vi.fn(() => 0),
        checkBuffer: vi.fn(),
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
        mocks.backendPreference = 'auto';
        mocks.bufferAhead = 5;
        mocks.playbackState = 'idle';
        mocks.sentences = [{ index: 0, text: 'Hello world.', startWordIndex: 0, endWordIndex: 1 }];
        mocks.setSpeed.mockReset();
        vi.clearAllMocks();
    });

    it('initializes the fp32-only TTS runtime for the selected voice', async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(initTTS).toHaveBeenCalledWith('af_heart', undefined, expect.any(Function));
        });
    });

    it('initializes the Piper engine when a Slovenian voice is selected', async () => {
        mocks.voice = 'sl_SI-artur-medium';
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(initTTS).toHaveBeenCalledWith('sl_SI-artur-medium', undefined, expect.any(Function));
        });
    });

    it('passes backend preference through TTS init', async () => {
        mocks.backendPreference = 'wasm';
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(initTTS).toHaveBeenCalledWith('af_heart', 'wasm', expect.any(Function));
        });
    });

    it('starts in wait-and-play mode before audio is generated', async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(ttsPlayer.play).toHaveBeenCalledWith(0, 1);
        });
    });

    it('stops pending playback when the main control is clicked while preparing', () => {
        mocks.playbackState = 'preparing';

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        expect(ttsPlayer.stop).toHaveBeenCalled();
        expect(ttsPlayer.clearQueue).toHaveBeenCalled();
        expect(ttsPlayer.pause).not.toHaveBeenCalled();
        expect(initTTS).not.toHaveBeenCalled();
    });

    it('stops before playback when TTS initialization fails', async () => {
        vi.mocked(initTTS).mockRejectedValueOnce(new TypeError('undefined is not a function'));

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(mocks.setError).toHaveBeenCalledWith('undefined is not a function');
        });
        expect(mocks.setPlaybackState).toHaveBeenCalledWith('idle');
        expect(ttsPlayer.play).not.toHaveBeenCalled();
        expect(streamSpeech).not.toHaveBeenCalled();
    });

    it('leaves buffering and exposes queue-time audio failures', async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {
            yield {
                sentence: mocks.sentences[0],
                audio: { samples: new Float32Array(4), sampleRate: 24000, duration: 1, text: 'Hello world.' },
            };
        })());
        vi.mocked(ttsPlayer.queueAudio).mockRejectedValueOnce(new TypeError('undefined is not a function'));

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(mocks.setError).toHaveBeenCalledWith('undefined is not a function');
        });
        expect(ttsPlayer.stop).toHaveBeenCalled();
    });

    it('buffers the current sentence plus the configured number ahead before playback', async () => {
        mocks.sentences = Array.from({ length: 8 }, (_, index) => ({
            index,
            text: `Sentence ${index}.`,
            startWordIndex: index,
            endWordIndex: index,
        }));
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(<TTSPlayer words={['chapter']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(ttsPlayer.play).toHaveBeenCalledWith(0, 1);
            expect(streamSpeech).toHaveBeenCalledWith(
                mocks.sentences.slice(0, 6),
                expect.any(Object),
            );
        });
    });

    it('contains Web Audio startup failures inside the TTS control', async () => {
        vi.mocked(ttsPlayer.play).mockRejectedValueOnce(
            new TypeError("undefined is not a function (near '...AudioContext...')"),
        );

        const { container } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(mocks.setError).toHaveBeenCalledWith(
                "undefined is not a function (near '...AudioContext...')",
            );
        });
        expect(ttsPlayer.stop).toHaveBeenCalled();
        expect(streamSpeech).not.toHaveBeenCalled();
    });

    it('forwards interpolated audio words directly to the reader', async () => {
        const onPositionChange = vi.fn();
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(
            <TTSPlayer
                words={['Hello', 'world.']}
                currentWordIndex={0}
                onPositionChange={onPositionChange}
            />,
        );
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => expect(ttsPlayer.play).toHaveBeenCalled());
        const options = vi.mocked(ttsPlayer.setOptions).mock.calls.at(-1)?.[0];
        act(() => options?.onWordChange?.(1));

        expect(onPositionChange).toHaveBeenCalledWith(1);
    });

    it('continues to the next chapter when the current chapter audio is exhausted', () => {
        const onChapterEnd = vi.fn();
        render(
            <TTSPlayer
                words={['Hello', 'world.']}
                currentWordIndex={0}
                chapterId="chapter-1"
                onChapterEnd={onChapterEnd}
            />,
        );

        const options = vi.mocked(ttsPlayer.setOptions).mock.calls.at(-1)?.[0];
        act(() => options?.onBufferLow?.(1));

        expect(ttsPlayer.pause).toHaveBeenCalled();
        expect(onChapterEnd).toHaveBeenCalledTimes(1);
    });

    it('starts a chapter requested by the reader after a boundary transition', async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        render(
            <TTSPlayer
                words={['Next', 'chapter.']}
                currentWordIndex={0}
                chapterId="chapter-2"
                autoPlayChapterId="chapter-2"
            />,
        );

        await waitFor(() => {
            expect(ttsPlayer.play).toHaveBeenCalledWith(0, 1);
        });
    });

    it('exposes and applies the full speed range including 0.5x', () => {
        const { getByText } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        fireEvent.click(getByText('0.5x'));

        expect(mocks.setSpeed).toHaveBeenCalledWith(0.5);
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