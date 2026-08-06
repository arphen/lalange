/**
 * Shared audio types and decoding helpers used by every TTS engine.
 */

/**
 * Audio result from TTS generation
 */
export interface TTSAudioResult {
    /** Raw audio samples (Float32Array) */
    samples: Float32Array;
    /** Sample rate of the samples themselves (24000 Hz for Kokoro, 22050 Hz for Piper) */
    sampleRate: number;
    /** Audible duration in seconds, after `playbackRate` is applied */
    duration: number;
    /** Original text */
    text: string;
    /**
     * Rate the player must play these samples at. Engines that synthesise at a
     * requested speed (Kokoro) leave this at 1; engines without a speed
     * parameter (Piper) bake the user's speed in here instead.
     */
    playbackRate?: number;
    /** Phonemes used for generation */
    phonemes?: string;
}

const SILENCE_FRAME_SECONDS = 0.01;
const SILENCE_RMS_THRESHOLD = 0.001;
const LEADING_SPEECH_PADDING_SECONDS = 0.02;
const TRAILING_SPEECH_PADDING_SECONDS = 0.12;

/**
 * Remove synthetic near-zero padding from generated audio without cutting
 * against speech onsets or the short pause that belongs after a sentence.
 */
export function trimTTSAudioSilence(samples: Float32Array, sampleRate: number): Float32Array {
    if (samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return samples;

    const frameSize = Math.max(1, Math.round(sampleRate * SILENCE_FRAME_SECONDS));
    const isAudibleFrame = (start: number, end: number): boolean => {
        let sumSquares = 0;
        for (let index = start; index < end; index++) {
            sumSquares += samples[index] * samples[index];
        }
        return Math.sqrt(sumSquares / Math.max(1, end - start)) >= SILENCE_RMS_THRESHOLD;
    };

    let firstAudibleSample = -1;
    for (let start = 0; start < samples.length; start += frameSize) {
        const end = Math.min(samples.length, start + frameSize);
        if (isAudibleFrame(start, end)) {
            firstAudibleSample = start;
            break;
        }
    }

    if (firstAudibleSample < 0) return samples;

    let lastAudibleSample = samples.length;
    for (let end = samples.length; end > 0; end -= frameSize) {
        const start = Math.max(0, end - frameSize);
        if (isAudibleFrame(start, end)) {
            lastAudibleSample = end;
            break;
        }
    }

    const start = Math.max(
        0,
        firstAudibleSample - Math.round(sampleRate * LEADING_SPEECH_PADDING_SECONDS),
    );
    const end = Math.min(
        samples.length,
        lastAudibleSample + Math.round(sampleRate * TRAILING_SPEECH_PADDING_SECONDS),
    );

    return start === 0 && end === samples.length ? samples : samples.slice(start, end);
}

export function getTTSAudioValidationError(samples: Float32Array): string | null {
    if (samples.length === 0) return 'empty audio buffer';

    let sumSquares = 0;
    let peak = 0;

    for (const sample of samples) {
        if (!Number.isFinite(sample)) return 'audio contains non-finite samples';
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
    }

    if (peak > 1.5) return `audio peak is out of range (${peak.toFixed(2)})`;

    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms < 0.00001) return 'audio is effectively silent';

    return null;
}

const RIFF_TAG = 0x46464952; // "RIFF" little-endian
const WAVE_TAG = 0x45564157; // "WAVE"
const FMT_TAG = 0x20746d66;  // "fmt "
const DATA_TAG = 0x61746164; // "data"

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_FLOAT = 3;

/**
 * Decode a mono RIFF/WAVE buffer into normalised Float32 samples.
 *
 * Piper hands back a WAV blob rather than raw samples, and decoding it here
 * keeps generation free of an AudioContext — the player owns the only one.
 */
export function decodeWavToSamples(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
    const view = new DataView(buffer);

    if (buffer.byteLength < 44 || view.getUint32(0, true) !== RIFF_TAG || view.getUint32(8, true) !== WAVE_TAG) {
        throw new Error('Audio is not a RIFF/WAVE buffer');
    }

    let formatTag = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataLength = 0;

    // Walk the chunk list; encoders are free to insert chunks before "data".
    let offset = 12;
    while (offset + 8 <= buffer.byteLength) {
        const chunkId = view.getUint32(offset, true);
        const chunkSize = view.getUint32(offset + 4, true);
        const chunkStart = offset + 8;

        if (chunkId === FMT_TAG) {
            formatTag = view.getUint16(chunkStart, true);
            channels = view.getUint16(chunkStart + 2, true);
            sampleRate = view.getUint32(chunkStart + 4, true);
            bitsPerSample = view.getUint16(chunkStart + 14, true);
        } else if (chunkId === DATA_TAG) {
            dataOffset = chunkStart;
            dataLength = Math.min(chunkSize, buffer.byteLength - chunkStart);
            break;
        }

        // Chunks are word-aligned, so odd sizes carry a trailing pad byte.
        offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    if (dataOffset < 0 || sampleRate === 0) {
        throw new Error('WAVE buffer is missing a fmt or data chunk');
    }
    if (channels !== 1) {
        throw new Error(`Expected mono audio, got ${channels} channels`);
    }

    if (formatTag === WAVE_FORMAT_FLOAT && bitsPerSample === 32) {
        const samples = new Float32Array(dataLength / 4);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = view.getFloat32(dataOffset + i * 4, true);
        }
        return { samples, sampleRate };
    }

    if (formatTag === WAVE_FORMAT_PCM && bitsPerSample === 16) {
        const samples = new Float32Array(dataLength / 2);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
        }
        return { samples, sampleRate };
    }

    throw new Error(`Unsupported WAVE encoding (format ${formatTag}, ${bitsPerSample}-bit)`);
}
