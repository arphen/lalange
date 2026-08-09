/**
 * Tests for the TTS engine router.
 *
 * The engine modules themselves are mocked — what matters here is that a voice
 * id is dispatched to the right engine and that engines are never co-resident.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const kokoro = vi.hoisted(() => ({
    generateKokoroSpeech: vi.fn(),
    initKokoro: vi.fn(async () => undefined),
    isKokoroModelCached: vi.fn(async () => true),
    isKokoroReady: vi.fn(() => false),
    clearKokoroCache: vi.fn(async () => undefined),
    unloadKokoro: vi.fn(async () => undefined),
}));

const piper = vi.hoisted(() => ({
    generatePiperSpeech: vi.fn(),
    initPiper: vi.fn(async () => undefined),
    isPiperVoiceCached: vi.fn(async () => false),
    isPiperReady: vi.fn(() => false),
    clearPiperCache: vi.fn(async () => undefined),
    unloadPiper: vi.fn(async () => undefined),
}));

const ttsState = vi.hoisted(() => ({
    setCurrentSentence: vi.fn(),
}));

vi.mock('./kokoro', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./kokoro')>();
    return { ...actual, ...kokoro };
});

vi.mock('./piper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./piper')>();
    return { ...actual, ...piper };
});

vi.mock('../store/tts', () => ({
    useTTSStore: { getState: () => ttsState },
}));

const {
    VOICES,
    DEFAULT_VOICE,
    clearTTSCache,
    generateSpeech,
    getVoice,
    getVoiceEngine,
    initTTS,
    isTTSModelCached,
    resolveVoiceId,
    streamSpeech,
} = await import('./engine');

const SLOVENIAN_VOICE = 'sl_SI-artur-medium';

const audio = (duration: number) => ({
    samples: new Float32Array([0.1]),
    sampleRate: 22050,
    duration,
    text: 'x',
});

beforeEach(() => {
    vi.clearAllMocks();
    kokoro.isKokoroReady.mockReturnValue(false);
    piper.isPiperReady.mockReturnValue(false);
    kokoro.generateKokoroSpeech.mockResolvedValue(audio(1));
    piper.generatePiperSpeech.mockResolvedValue(audio(1));
});

describe('voice registry', () => {
    it('lists both the English and Slovenian voices', () => {
        expect(getVoice(DEFAULT_VOICE)?.engine).toBe('kokoro');
        expect(getVoice(SLOVENIAN_VOICE)?.engine).toBe('piper');
    });

    it('labels the Slovenian voice with its language', () => {
        const voice = getVoice(SLOVENIAN_VOICE);
        expect(voice?.language).toBe('sl-SI');
        expect(voice?.languageLabel).toBe('Slovenian');
    });

    it('gives every voice the fields the pickers render', () => {
        for (const voice of VOICES) {
            expect(voice).toMatchObject({
                id: expect.any(String),
                name: expect.any(String),
                flag: expect.any(String),
                languageLabel: expect.any(String),
            });
        }
    });

    it('keeps known voice ids and replaces unknown ones', () => {
        expect(resolveVoiceId(SLOVENIAN_VOICE)).toBe(SLOVENIAN_VOICE);
        expect(resolveVoiceId('bf_emma')).toBe('bf_emma');
        expect(resolveVoiceId('zf_xiaobei')).toBe(DEFAULT_VOICE);
        expect(resolveVoiceId(undefined)).toBe(DEFAULT_VOICE);
    });

    it('routes voice ids to their engine', () => {
        expect(getVoiceEngine(SLOVENIAN_VOICE)).toBe('piper');
        expect(getVoiceEngine('af_heart')).toBe('kokoro');
        expect(getVoiceEngine(undefined)).toBe('kokoro');
    });
});

describe('initTTS', () => {
    it('starts Piper for a Slovenian voice', async () => {
        await initTTS(SLOVENIAN_VOICE);

        expect(piper.initPiper).toHaveBeenCalledWith(SLOVENIAN_VOICE, undefined);
        expect(kokoro.initKokoro).not.toHaveBeenCalled();
    });

    it('starts Kokoro for an English voice and passes the device through', async () => {
        await initTTS('af_heart', 'webgpu');

        expect(kokoro.initKokoro).toHaveBeenCalledWith('webgpu', undefined);
        expect(piper.initPiper).not.toHaveBeenCalled();
    });

    it('unloads Kokoro before loading Piper', async () => {
        kokoro.isKokoroReady.mockReturnValue(true);

        await initTTS(SLOVENIAN_VOICE);

        expect(kokoro.unloadKokoro).toHaveBeenCalled();
    });

    it('unloads Piper before loading Kokoro', async () => {
        piper.isPiperReady.mockReturnValue(true);

        await initTTS('af_heart');

        expect(piper.unloadPiper).toHaveBeenCalled();
    });

    it('does not unload an engine that was never loaded', async () => {
        await initTTS(SLOVENIAN_VOICE);

        expect(kokoro.unloadKokoro).not.toHaveBeenCalled();
    });

    it('serializes language switches while an engine is still initializing', async () => {
        let finishPiper: (() => void) | undefined;
        piper.initPiper.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
            finishPiper = () => {
                piper.isPiperReady.mockReturnValue(true);
                resolve(undefined);
            };
        }));

        const piperInitialization = initTTS(SLOVENIAN_VOICE);
        await vi.waitFor(() => expect(piper.initPiper).toHaveBeenCalledOnce());

        const kokoroInitialization = initTTS('af_heart');
        await Promise.resolve();
        expect(kokoro.initKokoro).not.toHaveBeenCalled();

        finishPiper?.();
        await Promise.all([piperInitialization, kokoroInitialization]);

        expect(piper.unloadPiper).toHaveBeenCalledOnce();
        expect(kokoro.initKokoro).toHaveBeenCalledOnce();
    });

    it('falls back to the default engine for an unknown voice', async () => {
        await initTTS('zf_xiaobei');

        expect(kokoro.initKokoro).toHaveBeenCalled();
        expect(piper.initPiper).not.toHaveBeenCalled();
    });
});

describe('generateSpeech', () => {
    it('sends Slovenian text to Piper with the requested speed', async () => {
        await generateSpeech('Dober dan', { voice: SLOVENIAN_VOICE, speed: 1.25 });

        expect(piper.generatePiperSpeech).toHaveBeenCalledWith('Dober dan', {
            voice: SLOVENIAN_VOICE,
            speed: 1.25,
        });
    });

    it('sends English text to Kokoro', async () => {
        await generateSpeech('Good day', { voice: 'bf_emma' });

        expect(kokoro.generateKokoroSpeech).toHaveBeenCalledWith('Good day', {
            voice: 'bf_emma',
            speed: 1,
        });
    });
});

describe('model cache', () => {
    it('checks Piper storage for a Slovenian voice', async () => {
        await isTTSModelCached(SLOVENIAN_VOICE);

        expect(piper.isPiperVoiceCached).toHaveBeenCalledWith(SLOVENIAN_VOICE);
        expect(kokoro.isKokoroModelCached).not.toHaveBeenCalled();
    });

    it('clears only the selected voice engine', async () => {
        await clearTTSCache(SLOVENIAN_VOICE);

        expect(piper.clearPiperCache).toHaveBeenCalledWith(SLOVENIAN_VOICE);
        expect(kokoro.clearKokoroCache).not.toHaveBeenCalled();
    });
});

describe('streamSpeech', () => {
    const sentences = [
        { index: 0, text: 'Prva poved.', startWordIndex: 0, endWordIndex: 1 },
        { index: 1, text: 'Druga poved.', startWordIndex: 2, endWordIndex: 3 },
    ];

    it('lays sentences out on a cumulative audio timeline', async () => {
        piper.generatePiperSpeech
            .mockResolvedValueOnce(audio(2))
            .mockResolvedValueOnce(audio(3));

        const results = [];
        for await (const result of streamSpeech(sentences, { voice: SLOVENIAN_VOICE })) {
            results.push(result);
        }

        expect(results).toHaveLength(2);
        expect(sentences[0]).toMatchObject({ audioStartTime: 0, audioEndTime: 2 });
        expect(sentences[1]).toMatchObject({ audioStartTime: 2, audioEndTime: 5 });
    });

    it('does not advance the audible sentence while generating ahead', async () => {
        const results = [];
        for await (const result of streamSpeech(sentences, { voice: SLOVENIAN_VOICE })) {
            results.push(result);
        }

        expect(results).toHaveLength(sentences.length);
        expect(ttsState.setCurrentSentence).not.toHaveBeenCalled();
    });

    it('initializes the engine once when it is not ready', async () => {
        const generator = streamSpeech(sentences, { voice: SLOVENIAN_VOICE });
        await generator.next();

        expect(piper.initPiper).toHaveBeenCalledTimes(1);
        await generator.return(undefined as never);
    });

    it('skips initialization when the engine is already loaded', async () => {
        piper.isPiperReady.mockReturnValue(true);

        const generator = streamSpeech(sentences, { voice: SLOVENIAN_VOICE });
        await generator.next();

        expect(piper.initPiper).not.toHaveBeenCalled();
        await generator.return(undefined as never);
    });

    it('propagates generation failures', async () => {
        piper.generatePiperSpeech.mockRejectedValueOnce(new Error('phonemizer exploded'));

        const generator = streamSpeech(sentences, { voice: SLOVENIAN_VOICE });

        await expect(generator.next()).rejects.toThrow('phonemizer exploded');
    });
});
