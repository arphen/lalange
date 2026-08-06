/**
 * Tests for shared TTS audio validation and WAV decoding.
 */

import { describe, it, expect } from 'vitest';
import { decodeWavToSamples, getTTSAudioValidationError, trimTTSAudioSilence } from './audio';

describe('getTTSAudioValidationError', () => {
    it('accepts finite audible samples', () => {
        expect(getTTSAudioValidationError(new Float32Array([0.1, -0.2, 0.3]))).toBeNull();
    });

    it('rejects non-finite samples from a corrupt backend', () => {
        expect(getTTSAudioValidationError(new Float32Array([0.1, Number.NaN, -0.1])))
            .toBe('audio contains non-finite samples');
    });

    it('rejects effectively silent output', () => {
        expect(getTTSAudioValidationError(new Float32Array(2400)))
            .toBe('audio is effectively silent');
    });

    it('rejects pathological amplitude', () => {
        expect(getTTSAudioValidationError(new Float32Array([0.1, 2, -0.1])))
            .toBe('audio peak is out of range (2.00)');
    });
});

describe('trimTTSAudioSilence', () => {
    it('removes generated edge silence while retaining safe speech padding', () => {
        const samples = new Float32Array(600);
        samples.fill(0.2, 100, 300);

        const trimmed = trimTTSAudioSilence(samples, 1000);

        expect(trimmed).toHaveLength(340);
        expect(trimmed[19]).toBe(0);
        expect(trimmed[20]).toBeCloseTo(0.2);
        expect(trimmed[trimmed.length - 121]).toBeCloseTo(0.2);
        expect(trimmed[trimmed.length - 120]).toBe(0);
    });

    it('leaves ambiguous quiet audio untouched', () => {
        const samples = new Float32Array(200).fill(0.0005);

        expect(trimTTSAudioSilence(samples, 1000)).toBe(samples);
    });
});

/**
 * Build a mono RIFF/WAVE buffer the way Piper does, optionally padding an
 * extra chunk in front of "data" to prove the decoder walks the chunk list.
 */
function buildWav(
    samples: number[],
    { sampleRate = 22050, extraChunk = false }: { sampleRate?: number; extraChunk?: boolean } = {},
): ArrayBuffer {
    const extraSize = extraChunk ? 10 : 0; // odd payload + pad byte
    const extraTotal = extraChunk ? 8 + extraSize : 0;
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + extraTotal + dataSize);
    const view = new DataView(buffer);
    const writeTag = (offset: number, tag: string) => {
        for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
    };

    writeTag(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    writeTag(8, 'WAVE');

    writeTag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    let offset = 36;
    if (extraChunk) {
        writeTag(offset, 'LIST');
        view.setUint32(offset + 4, extraSize - 1, true); // odd size, one pad byte
        offset += 8 + extraSize;
    }

    writeTag(offset, 'data');
    view.setUint32(offset + 4, dataSize, true);
    offset += 8;

    for (const sample of samples) {
        view.setInt16(offset, sample, true);
        offset += 2;
    }

    return buffer;
}

describe('decodeWavToSamples', () => {
    it('decodes 16-bit PCM to normalised floats', () => {
        const { samples, sampleRate } = decodeWavToSamples(buildWav([0, 16384, -16384, 32767]));

        expect(sampleRate).toBe(22050);
        expect(Array.from(samples)).toEqual([0, 0.5, -0.5, 32767 / 32768]);
    });

    it('reads the sample rate from the fmt chunk', () => {
        expect(decodeWavToSamples(buildWav([1, 2], { sampleRate: 16000 })).sampleRate).toBe(16000);
    });

    it('skips chunks that appear before the data chunk', () => {
        const { samples } = decodeWavToSamples(buildWav([16384, -16384], { extraChunk: true }));
        expect(Array.from(samples)).toEqual([0.5, -0.5]);
    });

    it('rejects a buffer that is not RIFF/WAVE', () => {
        expect(() => decodeWavToSamples(new ArrayBuffer(64)))
            .toThrow('Audio is not a RIFF/WAVE buffer');
    });
});
