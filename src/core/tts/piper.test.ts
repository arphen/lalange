/**
 * Tests for the Piper engine wrapper.
 *
 * @mintplex-labs/piper-tts-web is mocked: these cover session reuse across
 * voice changes, WAV decoding, and how the missing speed parameter is handled.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const predict = vi.hoisted(() => vi.fn());

const sessions = vi.hoisted(() => ({
    createdVoiceIds: [] as string[],
    lastProgress: undefined as ((p: unknown) => void) | undefined,
}));

interface FakeSession {
    voiceId: string;
    predict: typeof predict;
}

const createSession = vi.hoisted(() => vi.fn(
    async (options: { voiceId: string; progress?: (p: unknown) => void }): Promise<FakeSession> => {
        sessions.createdVoiceIds.push(options.voiceId);
        sessions.lastProgress = options.progress;
        return { voiceId: options.voiceId, predict };
    },
));

const piperLibrary = vi.hoisted(() => ({
    TtsSession: class {
        static _instance: unknown = null;
        static create = createSession;
    },
    stored: vi.fn(async () => [] as string[]),
    remove: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
}));

const ttsState = vi.hoisted(() => ({
    setReady: vi.fn(),
    setLoading: vi.fn(),
    setGenerating: vi.fn(),
    setError: vi.fn(),
    setProgress: vi.fn(),
}));

vi.mock('@mintplex-labs/piper-tts-web', () => piperLibrary);

vi.mock('../store/tts', () => ({
    useTTSStore: { getState: () => ttsState },
}));

const {
    PIPER_VOICES,
    clearPiperCache,
    generatePiperSpeech,
    initPiper,
    isPiperReady,
    isPiperVoiceCached,
    isPiperVoiceId,
    unloadPiper,
} = await import('./piper');

const SLOVENIAN_VOICE = 'sl_SI-artur-medium';

/** A one-sample 22.05kHz mono WAV, matching what the library returns. */
function wavBlob(value = 16384, sampleCount = 4): Blob {
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const writeTag = (offset: number, tag: string) => {
        for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
    };

    writeTag(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    writeTag(8, 'WAVE');
    writeTag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 22050, true);
    view.setUint32(28, 44100, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeTag(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i++) {
        view.setInt16(44 + i * 2, value, true);
    }

    return new Blob([buffer], { type: 'audio/x-wav' });
}

beforeEach(async () => {
    await unloadPiper();
    vi.clearAllMocks();
    sessions.createdVoiceIds.length = 0;
    piperLibrary.TtsSession._instance = null;
    predict.mockResolvedValue(wavBlob());
});

describe('PIPER_VOICES', () => {
    it('offers the Slovenian voice', () => {
        expect(PIPER_VOICES.map((voice) => voice.id)).toContain(SLOVENIAN_VOICE);
    });

    it('recognises its own voice ids only', () => {
        expect(isPiperVoiceId(SLOVENIAN_VOICE)).toBe(true);
        expect(isPiperVoiceId('af_heart')).toBe(false);
        expect(isPiperVoiceId(undefined)).toBe(false);
    });
});

describe('initPiper', () => {
    it('builds a session for the requested voice', async () => {
        await initPiper(SLOVENIAN_VOICE);

        expect(sessions.createdVoiceIds).toEqual([SLOVENIAN_VOICE]);
        expect(isPiperReady()).toBe(true);
        expect(ttsState.setReady).toHaveBeenCalledWith(true);
    });

    it('reuses the loaded session for the same voice', async () => {
        await initPiper(SLOVENIAN_VOICE);
        await initPiper(SLOVENIAN_VOICE);

        expect(piperLibrary.TtsSession.create).toHaveBeenCalledTimes(1);
    });

    it('clears the library singleton so a voice change reloads the weights', async () => {
        await initPiper(SLOVENIAN_VOICE);
        piperLibrary.TtsSession._instance = { stale: true };

        await initPiper('de_DE-thorsten-medium');

        expect(sessions.createdVoiceIds).toEqual([SLOVENIAN_VOICE, 'de_DE-thorsten-medium']);
        expect(piperLibrary.TtsSession._instance).toBeNull();
    });

    it('shares one in-flight initialization between concurrent callers', async () => {
        await Promise.all([initPiper(SLOVENIAN_VOICE), initPiper(SLOVENIAN_VOICE)]);

        expect(piperLibrary.TtsSession.create).toHaveBeenCalledTimes(1);
    });

    it('reports download progress', async () => {
        await initPiper(SLOVENIAN_VOICE);
        sessions.lastProgress?.({ url: 'https://host/sl_SI-artur-medium.onnx', loaded: 50, total: 100 });

        expect(ttsState.setProgress).toHaveBeenCalledWith(0.5, 'Loading sl_SI-artur-medium.onnx');
    });

    it('surfaces initialization failures', async () => {
        piperLibrary.TtsSession.create.mockRejectedValueOnce(new Error('network down'));

        await expect(initPiper(SLOVENIAN_VOICE)).rejects.toThrow('network down');
        expect(ttsState.setError).toHaveBeenCalledWith('network down');
        expect(isPiperReady()).toBe(false);
    });
});

describe('generatePiperSpeech', () => {
    it('decodes the WAV into samples with the model sample rate', async () => {
        await initPiper(SLOVENIAN_VOICE);

        const result = await generatePiperSpeech('Dober dan', { voice: SLOVENIAN_VOICE });

        expect(result.sampleRate).toBe(22050);
        expect(Array.from(result.samples)).toEqual([0.5, 0.5, 0.5, 0.5]);
        expect(result.text).toBe('Dober dan');
    });

    it('initializes on demand when nothing is loaded', async () => {
        await generatePiperSpeech('Dober dan', { voice: SLOVENIAN_VOICE });

        expect(piperLibrary.TtsSession.create).toHaveBeenCalledTimes(1);
    });

    it('passes speed to the player as a playback rate', async () => {
        const result = await generatePiperSpeech('Dober dan', { voice: SLOVENIAN_VOICE, speed: 2 });

        expect(result.playbackRate).toBe(2);
        // Four samples at 22050Hz, heard twice as fast.
        expect(result.duration).toBeCloseTo(4 / 22050 / 2);
    });

    it('clamps an out-of-range speed', async () => {
        const result = await generatePiperSpeech('Dober dan', { voice: SLOVENIAN_VOICE, speed: 9 });

        expect(result.playbackRate).toBe(2);
    });

    it('rejects silent output rather than playing nothing', async () => {
        predict.mockResolvedValue(wavBlob(0));

        await expect(generatePiperSpeech('Dober dan', { voice: SLOVENIAN_VOICE }))
            .rejects.toThrow('Piper generated invalid audio: audio is effectively silent');
    });

    it('serialises overlapping requests', async () => {
        await initPiper(SLOVENIAN_VOICE);

        let running = 0;
        let maxConcurrent = 0;
        predict.mockImplementation(async () => {
            running += 1;
            maxConcurrent = Math.max(maxConcurrent, running);
            await Promise.resolve();
            running -= 1;
            return wavBlob();
        });

        await Promise.all([
            generatePiperSpeech('Ena', { voice: SLOVENIAN_VOICE }),
            generatePiperSpeech('Dve', { voice: SLOVENIAN_VOICE }),
            generatePiperSpeech('Tri', { voice: SLOVENIAN_VOICE }),
        ]);

        expect(maxConcurrent).toBe(1);
    });
});

describe('voice storage', () => {
    it('reports a downloaded voice as cached', async () => {
        piperLibrary.stored.mockResolvedValueOnce([SLOVENIAN_VOICE]);

        expect(await isPiperVoiceCached(SLOVENIAN_VOICE)).toBe(true);
    });

    it('treats unreadable storage as not cached', async () => {
        piperLibrary.stored.mockRejectedValueOnce(new Error('no OPFS here'));

        expect(await isPiperVoiceCached(SLOVENIAN_VOICE)).toBe(false);
    });

    it('removes a single voice and unloads the session', async () => {
        await initPiper(SLOVENIAN_VOICE);

        await clearPiperCache(SLOVENIAN_VOICE);

        expect(piperLibrary.remove).toHaveBeenCalledWith(SLOVENIAN_VOICE);
        expect(piperLibrary.flush).not.toHaveBeenCalled();
        expect(isPiperReady()).toBe(false);
    });

    it('flushes every voice when none is named', async () => {
        await clearPiperCache();

        expect(piperLibrary.flush).toHaveBeenCalled();
        expect(piperLibrary.remove).not.toHaveBeenCalled();
    });
});
