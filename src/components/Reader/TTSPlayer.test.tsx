import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSPlayer } from './TTSPlayer';
import {
    initTTS,
    isTTSModelCached,
    predownloadPiperVoice,
    splitIntoSentences,
    streamSpeech,
} from '../../core/tts';
import { ttsPlayer } from '../../core/tts/player';

const mocks = vi.hoisted(() => ({
    voice: 'af_heart',
    backendPreference: 'auto' as 'auto' | 'wasm' | 'webgpu',
    bufferAhead: 5,
    speed: 1,
    continuityMode: 'continuous' as 'continuous' | 'prefer-speed',
    pacingSnapshot: {
        preferredSpeed: 1,
        effectiveSpeed: 1,
        sustainableSpeed: 1,
        generationRtf: null,
        paceState: 'measuring' as const,
        continuityMode: 'continuous' as const,
        hasStableMeasurement: false,
        deliveredWpm: null,
        reason: 'measuring' as const,
    },
    setSpeed: vi.fn(),
    setContinuityMode: vi.fn(),
    setPacingSnapshot: vi.fn(),
    setVoice: vi.fn(),
    setActiveVoiceOverride: vi.fn(),
    activeVoiceOverride: null as string | null,
    setGenerating: vi.fn(),
    setError: vi.fn(),
    setPlaybackState: vi.fn(),
    playbackState: 'idle' as 'idle' | 'preparing' | 'playing' | 'paused' | 'generating',
    ttsWordIndex: 0,
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
            speed: mocks.speed,
            voice: mocks.voice,
            activeVoiceOverride: mocks.activeVoiceOverride,
            backendPreference: mocks.backendPreference,
            bufferAhead: mocks.bufferAhead,
            continuityMode: mocks.continuityMode,
            pacingSnapshot: mocks.pacingSnapshot,
            currentWordIndex: mocks.ttsWordIndex,
            duration: 0,
            setVolume: vi.fn(),
            setSpeed: mocks.setSpeed,
            setContinuityMode: mocks.setContinuityMode,
            setPacingSnapshot: mocks.setPacingSnapshot,
            setVoice: mocks.setVoice,
            setActiveVoiceOverride: mocks.setActiveVoiceOverride,
        }),
        {
            getState: () => ({
                setGenerating: mocks.setGenerating,
                setError: mocks.setError,
                setPlaybackState: mocks.setPlaybackState,
                setCurrentWordIndex: vi.fn(),
                currentWordIndex: mocks.ttsWordIndex,
            }),
        },
    ),
    formatTTSPlaybackTime: (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
    useFormattedTime: () => ({ current: '0:00', duration: '0:00' }),
}));

const VOICES = vi.hoisted(() => [
    { id: 'af_heart', name: 'Heart', engine: 'kokoro', gender: 'female', quality: 'A', language: 'en-US', languageLabel: 'American English', flag: '🇺🇸' },
    { id: 'am_adam', name: 'Adam', engine: 'kokoro', gender: 'male', quality: 'A', language: 'en-US', languageLabel: 'American English', flag: '🇺🇸' },
    { id: 'sl_SI-artur-medium', name: 'Artur', engine: 'piper', gender: 'male', quality: 'B', language: 'sl-SI', languageLabel: 'Slovenian', flag: '🇸🇮' },
    { id: 'en_US-lessac-medium', name: 'Lessac', engine: 'piper', gender: 'female', quality: 'B', language: 'en-US', languageLabel: 'American English', flag: '🇺🇸', downloadMB: 63 },
]);

vi.mock('../../core/tts', () => ({
    initTTS: vi.fn(),
    isTTSReady: vi.fn(() => true),
    streamSpeech: vi.fn(),
    splitIntoSentences: vi.fn(() => mocks.sentences),
    listVoices: vi.fn(() => VOICES),
    getVoice: vi.fn((voiceId: string) => VOICES.find((voice) => voice.id === voiceId)),
    getFallbackVoice: vi.fn((voiceId: string) => voiceId === 'af_heart' ? VOICES[3] : undefined),
    getVoiceEngine: vi.fn((voiceId: string) => VOICES.find((voice) => voice.id === voiceId)?.engine ?? 'kokoro'),
    isTTSModelCached: vi.fn(() => Promise.resolve(false)),
    predownloadPiperVoice: vi.fn(() => Promise.resolve()),
    resolveVoiceId: vi.fn((voice: string) => VOICES.some((entry) => entry.id === voice) ? voice : 'af_heart'),
}));

vi.mock('../../core/tts/player', () => ({
    ttsPlayer: {
        dispose: vi.fn(),
        stop: vi.fn(),
        clearQueue: vi.fn(),
        discardQueuedAudioAfter: vi.fn(),
        getState: vi.fn(() => ({ isPlaying: true, currentSentenceIndex: 0, queueSize: 3 })),
        getQueueSize: vi.fn(() => 0),
        getBufferedAheadCount: vi.fn(() => 0),
        checkBuffer: vi.fn(),
        setOptions: vi.fn(),
        queueAudio: vi.fn(),
        pause: vi.fn(),
        play: vi.fn(),
        hasAudioForSentence: vi.fn(() => false),
        getAudibleTime: vi.fn(() => 0),
        resetTelemetry: vi.fn(),
        armMediaSession: vi.fn(() => Promise.resolve()),
    },
}));

describe('TTSPlayer voice changes', () => {
    beforeEach(() => {
        mocks.voice = 'af_heart';
        mocks.backendPreference = 'auto';
        mocks.bufferAhead = 5;
        mocks.speed = 1;
        mocks.activeVoiceOverride = null;
        mocks.playbackState = 'idle';
        mocks.ttsWordIndex = 0;
        mocks.sentences = [{ index: 0, text: 'Hello world.', startWordIndex: 0, endWordIndex: 1 }];
        mocks.setSpeed.mockReset();
        vi.clearAllMocks();
        mocks.setActiveVoiceOverride.mockImplementation((override: string | null) => {
            mocks.activeVoiceOverride = override;
        });
    });

    const renderLimitedPlayback = async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());
        const rendered = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);
        fireEvent.click(rendered.container.querySelector('button')!);

        await waitFor(() => expect(ttsPlayer.play).toHaveBeenCalled());
        await waitFor(() => expect(isTTSModelCached).toHaveBeenCalledWith('en_US-lessac-medium'));
        await act(async () => {
            await Promise.resolve();
        });
        const playerOptions = vi.mocked(ttsPlayer.setOptions).mock.calls.at(-1)?.[0];
        const generationOptions = vi.mocked(streamSpeech).mock.calls.at(-1)?.[1];
        act(() => {
            playerOptions?.onBufferSnapshot?.({
                bufferedAudioSeconds: 1,
                isShrinking: true,
                nextAudioReady: false,
                deliveredWpm: null,
            });
            for (let sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
                generationOptions?.onGenerationSample?.({ generationSeconds: 8, audioSeconds: 4 });
            }
        });

        return rendered;
    };

    it('shows a fallback recommendation only after the device-limit thresholds are met', async () => {
        const { getByTestId } = await renderLimitedPlayback();

        await waitFor(() => expect(getByTestId('tts-fallback-recommendation')).toBeInTheDocument());
        expect(getByTestId('tts-fallback-recommendation')).toHaveTextContent(
            'A lighter local voice may keep up better.',
        );
    });

    it('requires explicit download consent and does not activate after predownload', async () => {
        vi.mocked(isTTSModelCached).mockResolvedValue(false);
        const { getByRole } = await renderLimitedPlayback();

        const downloadButton = await waitFor(() => getByRole('button', {
            name: 'Download lighter voice - 63 MB',
        }));
        expect(initTTS).toHaveBeenCalledWith('af_heart', undefined, expect.any(Function));

        fireEvent.click(downloadButton);

        await waitFor(() => expect(predownloadPiperVoice).toHaveBeenCalledWith(
            'en_US-lessac-medium',
            expect.any(Function),
        ));
        expect(initTTS).not.toHaveBeenCalledWith(
            'en_US-lessac-medium',
            expect.anything(),
            expect.any(Function),
        );
        expect(mocks.setActiveVoiceOverride).not.toHaveBeenCalled();
        expect(mocks.setVoice).not.toHaveBeenCalled();
    });

    it('activates a cached fallback only after the user chooses to try it', async () => {
        vi.mocked(isTTSModelCached).mockResolvedValue(true);
        const { getByRole } = await renderLimitedPlayback();

        const tryButton = await waitFor(() => getByRole('button', { name: 'Try lighter voice' }));
        expect(initTTS).toHaveBeenCalledWith('af_heart', undefined, expect.any(Function));

        fireEvent.click(tryButton);

        await waitFor(() => expect(initTTS).toHaveBeenCalledWith(
            'en_US-lessac-medium',
            undefined,
            expect.any(Function),
        ));
        expect(mocks.setActiveVoiceOverride).toHaveBeenCalledWith('en_US-lessac-medium');
        expect(mocks.setVoice).not.toHaveBeenCalled();
    });

    it('offers retry after a failed fallback download without switching voices', async () => {
        vi.mocked(isTTSModelCached).mockResolvedValue(false);
        vi.mocked(predownloadPiperVoice)
            .mockRejectedValueOnce(new Error('Network unavailable'))
            .mockResolvedValueOnce(undefined);
        const { getByRole, getByTestId } = await renderLimitedPlayback();

        fireEvent.click(await waitFor(() => getByRole('button', {
            name: 'Download lighter voice - 63 MB',
        })));
        const retryButton = await waitFor(() => getByRole('button', {
            name: 'Retry download - 63 MB',
        }));
        expect(getByTestId('tts-fallback-recommendation')).toHaveTextContent('Network unavailable');

        fireEvent.click(retryButton);

        await waitFor(() => expect(predownloadPiperVoice).toHaveBeenCalledTimes(2));
        expect(mocks.setActiveVoiceOverride).not.toHaveBeenCalled();
    });

    it('warns when a fallback download makes no progress for thirty seconds', async () => {
        vi.mocked(isTTSModelCached).mockResolvedValue(false);
        let finishDownload: (() => void) | undefined;
        vi.mocked(predownloadPiperVoice).mockImplementation(() => new Promise<void>((resolve) => {
            finishDownload = resolve;
        }));
        const { getByRole, getByTestId } = await renderLimitedPlayback();

        vi.useFakeTimers();
        try {
            fireEvent.click(getByRole('button', { name: 'Download lighter voice - 63 MB' }));
            expect(predownloadPiperVoice).toHaveBeenCalledWith(
                'en_US-lessac-medium',
                expect.any(Function),
            );

            act(() => {
                vi.advanceTimersByTime(30_000);
            });

            expect(getByTestId('tts-fallback-recommendation')).toHaveTextContent(
                'Download is taking longer than expected',
            );
            finishDownload?.();
            await act(async () => {
                await Promise.resolve();
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('dismisses the recommendation while preserving the preferred voice', async () => {
        const { getByRole, queryByTestId } = await renderLimitedPlayback();

        fireEvent.click(await waitFor(() => getByRole('button', { name: 'Keep Heart' })));

        await waitFor(() => expect(queryByTestId('tts-fallback-recommendation')).not.toBeInTheDocument());
        expect(mocks.setVoice).not.toHaveBeenCalled();
        expect(mocks.setActiveVoiceOverride).not.toHaveBeenCalled();
    });

    it('returns from an active fallback without changing the preferred voice', async () => {
        mocks.activeVoiceOverride = 'en_US-lessac-medium';
        const { getByRole } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        fireEvent.click(getByRole('button', { name: 'Return to Heart' }));

        await waitFor(() => expect(initTTS).toHaveBeenCalledWith(
            'af_heart',
            undefined,
            expect.any(Function),
        ));
        expect(mocks.setActiveVoiceOverride).toHaveBeenCalledWith(null);
        expect(mocks.setVoice).not.toHaveBeenCalled();
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

    it('starts from the live reader cursor when rendered reader state is stale', async () => {
        mocks.sentences = [
            { index: 0, text: 'First sentence.', startWordIndex: 0, endWordIndex: 1 },
            { index: 1, text: 'Second sentence.', startWordIndex: 2, endWordIndex: 3 },
            { index: 2, text: 'Third sentence.', startWordIndex: 4, endWordIndex: 5 },
        ];
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(
            <TTSPlayer
                words={['chapter']}
                currentWordIndex={0}
                getCurrentWordIndex={() => 4}
            />,
        );
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(ttsPlayer.play).toHaveBeenCalledWith(2, 1);
        });
    });

    it('clamps an out-of-range reader cursor to the nearest sentence', async () => {
        mocks.sentences = [
            { index: 0, text: 'First sentence.', startWordIndex: 0, endWordIndex: 1 },
            { index: 1, text: 'Last sentence.', startWordIndex: 2, endWordIndex: 3 },
        ];
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(
            <TTSPlayer words={['chapter']} currentWordIndex={99} />,
        );
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(ttsPlayer.play).toHaveBeenCalledWith(1, 1);
        });
    });

    it('passes authored paragraph boundaries into sentence segmentation', () => {
        render(
            <TTSPlayer
                words={['A', 'heading', 'Body', 'text.']}
                paragraphBreaks={[1]}
                currentWordIndex={0}
            />,
        );

        expect(splitIntoSentences).toHaveBeenCalledWith(
            ['A', 'heading', 'Body', 'text.'],
            [1],
        );
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

    it('restarts from the reader position after the reader moves backward while paused', async () => {
        mocks.playbackState = 'paused';
        mocks.ttsWordIndex = 5;
        mocks.sentences = [
            { index: 0, text: 'First sentence.', startWordIndex: 0, endWordIndex: 1 },
            { index: 1, text: 'Second sentence.', startWordIndex: 2, endWordIndex: 3 },
            { index: 2, text: 'Third sentence.', startWordIndex: 4, endWordIndex: 5 },
        ];
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container } = render(
            <TTSPlayer words={['chapter']} currentWordIndex={2} />,
        );
        fireEvent.click(container.querySelector('button')!);

        await waitFor(() => {
            expect(ttsPlayer.clearQueue).toHaveBeenCalled();
            expect(ttsPlayer.play).toHaveBeenCalledWith(1, 1);
        });
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

    it('replaces farther-ahead audio when speed changes during playback', async () => {
        mocks.sentences = Array.from({ length: 4 }, (_, index) => ({
            index,
            text: `Sentence ${index}.`,
            startWordIndex: index,
            endWordIndex: index,
        }));
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const { container, rerender } = render(
            <TTSPlayer words={['chapter']} currentWordIndex={0} />,
        );
        fireEvent.click(container.querySelector('button')!);
        await waitFor(() => expect(streamSpeech).toHaveBeenCalledTimes(1));

        mocks.playbackState = 'playing';
        mocks.speed = 1.2;
        rerender(<TTSPlayer words={['chapter']} currentWordIndex={0} />);

        await waitFor(() => {
            expect(ttsPlayer.discardQueuedAudioAfter).toHaveBeenCalledWith(1);
            expect(streamSpeech).toHaveBeenCalledTimes(2);
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

    it('resumes automatic continuation from the live reader cursor after a remount', async () => {
        mocks.sentences = [
            { index: 0, text: 'First sentence.', startWordIndex: 0, endWordIndex: 1 },
            { index: 1, text: 'Second sentence.', startWordIndex: 2, endWordIndex: 3 },
            { index: 2, text: 'Third sentence.', startWordIndex: 4, endWordIndex: 5 },
        ];
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());

        const firstRender = render(
            <TTSPlayer
                words={['Next', 'chapter.']}
                currentWordIndex={0}
                getCurrentWordIndex={() => 0}
                chapterId="chapter-2"
                autoPlayChapterId="chapter-2"
            />,
        );
        await waitFor(() => expect(ttsPlayer.play).toHaveBeenCalledWith(0, 1));

        firstRender.unmount();
        vi.mocked(ttsPlayer.play).mockClear();

        render(
            <TTSPlayer
                words={['Next', 'chapter.']}
                currentWordIndex={0}
                getCurrentWordIndex={() => 4}
                chapterId="chapter-2"
                autoPlayChapterId="chapter-2"
            />,
        );

        await waitFor(() => expect(ttsPlayer.play).toHaveBeenCalledWith(2, 1));
    });

    it('commits the live audio cursor before resetting for a content update', async () => {
        vi.mocked(streamSpeech).mockReturnValue((async function* () {})());
        const onPositionCommit = vi.fn();
        const { container, rerender } = render(
            <TTSPlayer
                words={['Hello', 'world.']}
                currentWordIndex={0}
                onPositionCommit={onPositionCommit}
            />,
        );
        fireEvent.click(container.querySelector('button')!);
        await waitFor(() => expect(ttsPlayer.play).toHaveBeenCalled());

        mocks.ttsWordIndex = 1;
        rerender(
            <TTSPlayer
                words={['Hello', 'updated', 'world.']}
                currentWordIndex={0}
                onPositionCommit={onPositionCommit}
            />,
        );

        expect(onPositionCommit).toHaveBeenCalledWith(1);
    });

    it('shows empty slots for sentences waiting to be buffered', () => {
        const { getByRole } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        expect(getByRole('status')).toHaveAccessibleName('0 of 6 upcoming sentences buffered');
    });

    it('updates the visible buffer status as sentence audio is queued', () => {
        vi.mocked(ttsPlayer.hasAudioForSentence).mockReturnValue(true);
        vi.mocked(ttsPlayer.getBufferedAheadCount).mockReturnValue(2);
        const { getByRole } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        const options = vi.mocked(ttsPlayer.setOptions).mock.calls.at(-1)?.[0];
        act(() => options?.onAudioQueued?.(0, 3));

        expect(getByRole('status')).toHaveAccessibleName('3 of 6 upcoming sentences buffered');
    });

    it('repairs a legacy foreign voice and clears its queued audio', async () => {
        mocks.voice = 'zf_xiaobei';
        render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        await waitFor(() => expect(mocks.setVoice).toHaveBeenCalledWith('af_heart'));
        expect(ttsPlayer.stop).toHaveBeenCalled();
        expect(ttsPlayer.clearQueue).toHaveBeenCalled();
        expect(mocks.setGenerating).toHaveBeenCalledWith(false);
    });

    it('disposes the audio player when unmounted', () => {
        const { unmount } = render(<TTSPlayer words={['Hello', 'world.']} currentWordIndex={0} />);

        unmount();

        expect(ttsPlayer.dispose).toHaveBeenCalledOnce();
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