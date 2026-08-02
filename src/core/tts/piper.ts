/**
 * Piper TTS Service
 *
 * Non-English speech synthesis using Piper's VITS voices via
 * @mintplex-labs/piper-tts-web. Like Kokoro, this runs entirely in the
 * browser — text never leaves the device.
 *
 * Slovenian voice: sl_SI-artur-medium
 * - ~63MB model, downloaded once from HuggingFace and kept in OPFS
 * - 22.05kHz mono audio output
 * - Inference on ONNX Runtime (WASM); phonemization via espeak-ng (WASM)
 */

import { useTTSStore } from '../store/tts';
import { decodeWavToSamples, getTTSAudioValidationError, type TTSAudioResult } from './audio';

type PiperModule = typeof import('@mintplex-labs/piper-tts-web');
type PiperSession = InstanceType<PiperModule['TtsSession']>;

/**
 * ONNX Runtime ships its WASM binaries separately from its JavaScript, and the
 * two must be the same build. package.json therefore pins onnxruntime-web to an
 * exact version; bumping that dependency means bumping this URL in the same
 * commit. Both CDNs below send permissive CORS/CORP headers, which the app's
 * cross-origin isolation (COEP: require-corp) requires.
 */
const ORT_VERSION = '1.18.0';
const PIPER_PHONEMIZE_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

const PIPER_WASM_PATHS = {
    onnxWasm: `https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/${ORT_VERSION}/`,
    piperData: `${PIPER_PHONEMIZE_BASE}.data`,
    piperWasm: `${PIPER_PHONEMIZE_BASE}.wasm`,
};

export interface PiperVoiceInfo {
    id: string;
    name: string;
    gender: 'female' | 'male';
    /** Approximate model download size, for the settings UI */
    downloadMB: number;
    description?: string;
}

export const PIPER_VOICES: PiperVoiceInfo[] = [
    {
        id: 'sl_SI-artur-medium',
        name: 'Artur',
        gender: 'male',
        downloadMB: 63,
        description: 'Slovenian, medium quality',
    },
];

export function isPiperVoiceId(voiceId: string | undefined): boolean {
    return PIPER_VOICES.some((voice) => voice.id === voiceId);
}

// Singleton session. The library keeps its own static instance, but it only
// swaps the voice id on reuse without reloading the weights, so this module
// tracks the loaded voice and forces a rebuild whenever the voice changes.
let session: PiperSession | null = null;
let loadedVoiceId: string | null = null;
let initPromise: Promise<void> | null = null;
let initVoiceId: string | null = null;

let piperModule: PiperModule | null = null;

async function loadPiperLibrary(): Promise<PiperModule> {
    if (!piperModule) {
        piperModule = await import('@mintplex-labs/piper-tts-web');
    }
    return piperModule;
}

/**
 * Initialize the Piper engine for a voice, downloading the model if needed.
 */
export async function initPiper(
    voiceId: string,
    onProgress?: (progress: number, status: string) => void,
): Promise<void> {
    const store = useTTSStore.getState();

    if (session && loadedVoiceId === voiceId) {
        store.setReady(true);
        store.setProgress(1, 'Ready · Piper / WASM');
        return;
    }

    // Reuse an in-flight initialization for the same voice.
    if (initPromise && initVoiceId === voiceId) {
        return initPromise;
    }

    // Serialize voice changes so two model sessions are never built at once.
    if (initPromise) {
        await initPromise.catch(() => undefined);
        return initPiper(voiceId, onProgress);
    }

    const promise: Promise<void> = (async () => {
        try {
            store.setLoading(true);
            store.setError(null);
            store.setProgress(0, 'Loading Piper runtime');
            onProgress?.(0, 'Loading Piper runtime...');

            const piper = await loadPiperLibrary();

            // Drop the library's cached session so the new voice actually loads.
            await unloadPiper();

            const loadingStatus = `Loading ${voiceId}`;
            store.setProgress(0.05, loadingStatus);
            onProgress?.(0.05, loadingStatus);

            const loadedSession = await piper.TtsSession.create({
                voiceId,
                wasmPaths: PIPER_WASM_PATHS,
                progress: ({ url, loaded, total }) => {
                    if (!total) return;
                    // Reserve the head and tail of the bar for runtime setup and
                    // for building the inference session after the download.
                    const pct = 0.05 + Math.max(0, Math.min(1, loaded / total)) * 0.9;
                    const file = url.split('/').pop() ?? 'model';
                    const status = `Loading ${file}`;
                    store.setProgress(pct, status);
                    onProgress?.(pct, status);
                },
            });

            session = loadedSession;
            loadedVoiceId = voiceId;

            const readyStatus = 'Ready · Piper / WASM';
            store.setReady(true);
            store.setProgress(1, readyStatus);
            onProgress?.(1, readyStatus);

            console.log(`[TTS] Piper initialized: ${voiceId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize Piper';
            store.setError(message);
            console.error('[TTS] Piper initialization failed:', error);
            throw error;
        } finally {
            initPromise = null;
            initVoiceId = null;
            store.setLoading(false);
        }
    })();

    initPromise = promise;
    initVoiceId = voiceId;
    return promise;
}

/**
 * Release the Piper session so the next init loads a fresh model.
 */
export async function unloadPiper(): Promise<void> {
    session = null;
    loadedVoiceId = null;

    const piper = await loadPiperLibrary();
    piper.TtsSession._instance = null;

    useTTSStore.getState().setReady(false);
}

export function isPiperReady(): boolean {
    return session !== null;
}

/**
 * Piper synthesises one utterance at a time — it rebuilds the phonemizer for
 * every call — so overlapping requests are queued rather than run in parallel.
 */
let generationChain: Promise<unknown> = Promise.resolve();

function enqueueGeneration<T>(task: () => Promise<T>): Promise<T> {
    const result = generationChain.then(task, task);
    generationChain = result.catch(() => undefined);
    return result;
}

/**
 * Generate speech for a single text segment.
 *
 * Piper has no speed parameter, so the requested speed is handed to the player
 * as a playback rate instead of being baked into the samples.
 */
export async function generatePiperSpeech(
    text: string,
    options: {
        voice: string;
        speed?: number;
    },
): Promise<TTSAudioResult> {
    const { voice, speed = 1.0 } = options;

    if (!session || loadedVoiceId !== voice) {
        await initPiper(voice);
    }

    const activeSession = session;
    if (!activeSession) {
        throw new Error('Piper TTS not initialized');
    }

    const store = useTTSStore.getState();
    store.setGenerating(true);

    try {
        const wav = await enqueueGeneration(() => activeSession.predict(text));
        const { samples, sampleRate } = decodeWavToSamples(await wav.arrayBuffer());

        const validationError = getTTSAudioValidationError(samples);
        if (validationError) {
            throw new Error(`Piper generated invalid audio: ${validationError}`);
        }

        const playbackRate = Math.max(0.5, Math.min(2, speed));

        return {
            samples,
            sampleRate,
            duration: samples.length / sampleRate / playbackRate,
            text,
            playbackRate,
        };
    } finally {
        store.setGenerating(false);
    }
}

/**
 * Check whether a voice's weights are already stored on device (OPFS).
 */
export async function isPiperVoiceCached(voiceId: string): Promise<boolean> {
    try {
        const piper = await loadPiperLibrary();
        return (await piper.stored()).includes(voiceId);
    } catch (error) {
        // Browsers without OPFS cannot cache, and re-download on every load.
        console.warn('[TTS] Could not read Piper voice cache:', error);
        return false;
    }
}

/**
 * Remove a downloaded Piper voice, forcing a fresh download on next use.
 */
export async function clearPiperCache(voiceId?: string): Promise<void> {
    await unloadPiper();

    const piper = await loadPiperLibrary();
    if (voiceId) {
        await piper.remove(voiceId);
    } else {
        await piper.flush();
    }

    console.log(`[TTS] Cleared Piper cache${voiceId ? `: ${voiceId}` : ''}`);
}
