/**
 * Tests for the Kokoro engine's pure helpers.
 *
 * These cover the runtime selection that happens before the model loads.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    applyOnnxProxyPreference,
    releaseKokoroModel,
    resolveKokoroVoiceId,
    isIOSRuntime,
    prepareKokoroTextForSpeech,
    resolveTTSRuntimeConfig,
    KOKORO_VOICES,
    KOKORO_DEFAULT_VOICE,
} from './kokoro';

describe('prepareKokoroTextForSpeech', () => {
    it('turns an inline parenthetical into an audible aside', () => {
        expect(prepareKokoroTextForSpeech(
            'The vehicle (there are no other roads) is a symbol.',
        )).toBe('The vehicle — there are no other roads — is a symbol.');
    });

    it('does not duplicate punctuation at a parenthetical boundary', () => {
        expect(prepareKokoroTextForSpeech('He left (without warning).')).toBe(
            'He left — without warning.',
        );
        expect(prepareKokoroTextForSpeech('It was (apparently), enough.')).toBe(
            'It was — apparently, enough.',
        );
    });

    it('removes nested parentheses without adding repeated prosody cues', () => {
        expect(prepareKokoroTextForSpeech(
            'It was (as he put it (quietly)) unusual.',
        )).toBe('It was — as he put it quietly — unusual.');
    });

    it('leaves unmatched parentheses untouched', () => {
        expect(prepareKokoroTextForSpeech('An unfinished (aside')).toBe(
            'An unfinished (aside',
        );
        expect(prepareKokoroTextForSpeech('An (unfinished (aside)')).toBe(
            'An (unfinished (aside)',
        );
    });

    it('leaves empty parentheses untouched', () => {
        expect(prepareKokoroTextForSpeech('A pause () remains.')).toBe(
            'A pause () remains.',
        );
    });
});

describe('Kokoro voices', () => {
    it('keeps a current English voice', () => {
        expect(resolveKokoroVoiceId('bf_emma')).toBe('bf_emma');
    });

    it('replaces an unknown legacy voice with the English default', () => {
        expect(resolveKokoroVoiceId('zf_xiaobei')).toBe(KOKORO_DEFAULT_VOICE);
    });

    it('does not claim the Slovenian Piper voice', () => {
        expect(resolveKokoroVoiceId('sl_SI-artur-medium')).toBe(KOKORO_DEFAULT_VOICE);
    });

    it('exposes a non-empty voice list containing the default', () => {
        expect(KOKORO_VOICES.length).toBeGreaterThan(0);
        expect(KOKORO_VOICES.some((voice) => voice.id === KOKORO_DEFAULT_VOICE)).toBe(true);
    });
});

describe('resolveTTSRuntimeConfig', () => {
    it('uses fp32 with an auto-selected WebGPU backend', () => {
        const runtime = resolveTTSRuntimeConfig(undefined, 'webgpu', false);
        expect(runtime).toEqual({
            dtype: 'fp32',
            device: 'webgpu',
        });
    });

    it('keeps explicit backend requests while forcing fp32', () => {
        const runtime = resolveTTSRuntimeConfig('wasm', 'webgpu', false);
        expect(runtime).toEqual({
            dtype: 'fp32',
            device: 'wasm',
        });
    });

    it('uses the lower-memory q8 WASM runtime on iOS', () => {
        expect(resolveTTSRuntimeConfig(undefined, 'wasm', true)).toEqual({
            dtype: 'q8',
            device: 'wasm',
        });
    });

    it('does not let an explicit WebGPU preference bypass the iOS memory guard', () => {
        expect(resolveTTSRuntimeConfig('webgpu', 'webgpu', true)).toEqual({
            dtype: 'q8',
            device: 'wasm',
        });
    });
});

describe('isIOSRuntime', () => {
    it('detects an iPhone user agent', () => {
        expect(isIOSRuntime(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)',
            'iPhone',
            5,
        )).toBe(true);
    });

    it('detects iPadOS desktop browsing mode', () => {
        expect(isIOSRuntime(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
            'MacIntel',
            5,
        )).toBe(true);
    });

    it('does not classify a Mac as iOS', () => {
        expect(isIOSRuntime(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
            'MacIntel',
            0,
        )).toBe(false);
    });
});


describe('applyOnnxProxyPreference', () => {
    const makeEnv = () => ({ backends: { onnx: { wasm: { proxy: false } } } });

    it('proxies WASM inference into a worker so synthesis cannot block the main thread', () => {
        // Unproxied, ONNX Runtime runs the session on the calling thread: taps and
        // the OS media controls stop responding for the whole of each sentence.
        const env = makeEnv();
        applyOnnxProxyPreference('wasm', env);
        expect(env.backends.onnx.wasm.proxy).toBe(true);
    });

    it('leaves WebGPU unproxied, since it does not block and cannot be proxied', () => {
        const env = makeEnv();
        env.backends.onnx.wasm.proxy = true;
        applyOnnxProxyPreference('webgpu', env);
        expect(env.backends.onnx.wasm.proxy).toBe(false);
    });

    it('tolerates an environment without the onnx backend', () => {
        expect(() => applyOnnxProxyPreference('wasm', {})).not.toThrow();
        expect(() => applyOnnxProxyPreference('wasm', null)).not.toThrow();
    });
});

describe('releaseKokoroModel', () => {
    it('disposes the ONNX session so the freed WASM heap can serve the next engine', async () => {
        // Without this the weights stay resident for the life of the page, and
        // Piper allocates on top of them instead of in their place.
        const dispose = vi.fn(async () => undefined);

        await releaseKokoroModel({ model: { dispose } });

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('does not let a failed disposal block the engine switch', async () => {
        const dispose = vi.fn(async () => { throw new Error('already gone'); });

        await expect(releaseKokoroModel({ model: { dispose } })).resolves.toBeUndefined();
    });

    it('tolerates unloading before a model was ever loaded', async () => {
        await expect(releaseKokoroModel(null)).resolves.toBeUndefined();
        await expect(releaseKokoroModel({})).resolves.toBeUndefined();
    });
});
