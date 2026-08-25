/**
 * Kokoro TTS Service
 * 
 * Local text-to-speech using the Kokoro-82M model via kokoro-js.
 * Runs entirely in the browser using ONNX Runtime (WASM or WebGPU).
 * 
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX
 * - 82M parameters, frontier quality for size
 * - fp32 weights on desktop: ~326MB download
 * - q8 weights on iOS: ~92MB download
 * - 24kHz mono audio output
 * - Generation speed depends on model, backend, browser, and hardware
 */

import { useTTSStore } from '../store/tts';
import { getTTSAudioValidationError, trimTTSAudioSilence, type TTSAudioResult } from './audio';
import {
    clearTransformersModelCache,
    isTransformersFileCached,
    transformersModelCache,
} from './modelCache';
import { createTTSProgressReporter } from './progress';

// Lazy import to avoid loading the large library until needed
let KokoroTTS: typeof import('kokoro-js').KokoroTTS | null = null;
let transformersEnv: typeof import('@huggingface/transformers').env | null = null;

// Singleton instance
let ttsInstance: InstanceType<typeof import('kokoro-js').KokoroTTS> | null = null;
let currentLoadedConfig: TTSRuntimeConfig | null = null;
let ttsInitPromise: Promise<void> | null = null;
let ttsInitConfigKey: string | null = null;
let ttsLifecycleGeneration = 0;

const PARENTHETICAL_BOUNDARY = ' — ';
const EXISTING_BOUNDARY_PUNCTUATION = /[,.!?;:\u0589\u061b\u061f\u0964\u0965\u2026\u3001\u3002\uff01\uff0c\uff1a\uff1b\uff1f\u1362\u2013\u2014-]/u;
const TERMINAL_PUNCTUATION = /[.!?\u0589\u061f\u0964\u0965\u2026\u3002\uff01\uff1f\u1362]/u;

export function prepareKokoroTextForSpeech(text: string): string {
    const stack: number[] = [];
    const ranges: Array<{ start: number; end: number }> = [];

    for (let index = 0; index < text.length; index++) {
        if (text[index] === '(') {
            stack.push(index);
        } else if (text[index] === ')' && stack.length > 0) {
            const openingIndex = stack.pop() as number;
            if (stack.length === 0) ranges.push({ start: openingIndex, end: index });
        }
    }

    if (ranges.length === 0) return text;

    let prepared = '';
    let cursor = 0;
    for (const range of ranges) {
        prepared += text.slice(cursor, range.start);

        const source = text.slice(range.start + 1, range.end);
        const content = source.replace(/[()]/gu, '');
        if (!/[\p{L}\p{N}]/u.test(content)) {
            prepared += text.slice(range.start, range.end + 1);
            cursor = range.end + 1;
            continue;
        }

        const previousCharacter = text.slice(0, range.start).match(/\S(?=\s*$)/u)?.[0];
        const nextCharacter = text.slice(range.end + 1).match(/^\s*(\S)/u)?.[1];
        const contentLastCharacter = content.match(/\S(?=\s*$)/u)?.[0];
        const needsOpeningBoundary = previousCharacter !== undefined
            && !EXISTING_BOUNDARY_PUNCTUATION.test(previousCharacter);
        const needsClosingBoundary = nextCharacter !== undefined
            && !EXISTING_BOUNDARY_PUNCTUATION.test(nextCharacter)
            && (contentLastCharacter === undefined || !TERMINAL_PUNCTUATION.test(contentLastCharacter));

        if (needsOpeningBoundary) prepared += PARENTHETICAL_BOUNDARY;
        prepared += content;
        if (needsClosingBoundary) prepared += PARENTHETICAL_BOUNDARY;
        cursor = range.end + 1;
    }
    prepared += text.slice(cursor);

    return prepared.replace(/\s+/gu, ' ').trim();
}

// Model configuration
export const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type TTSDevice = 'wasm' | 'webgpu';
export type TTSDtype = 'fp32' | 'q8';

export interface TTSRuntimeConfig {
    dtype: TTSDtype;
    device: TTSDevice;
}

const TTS_MODEL_FILENAMES: Record<TTSDtype, string> = {
    fp32: 'model.onnx',
    q8: 'model_quantized.onnx',
};

// Voice definitions with metadata
export interface KokoroVoiceInfo {
    id: string;
    name: string;
    gender: 'female' | 'male';
    accent: 'american' | 'british';
    quality: 'A' | 'B' | 'C' | 'D';
    description?: string;
}

export const KOKORO_VOICES: KokoroVoiceInfo[] = [
    // American Female
    { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'american', quality: 'A', description: 'Default, warm voice' },
    { id: 'af_bella', name: 'Bella', gender: 'female', accent: 'american', quality: 'A', description: 'Natural, expressive' },
    { id: 'af_nicole', name: 'Nicole', gender: 'female', accent: 'american', quality: 'B', description: 'Clear audiobook style' },
    { id: 'af_sarah', name: 'Sarah', gender: 'female', accent: 'american', quality: 'B' },
    { id: 'af_sky', name: 'Sky', gender: 'female', accent: 'american', quality: 'B' },
    // American Male
    { id: 'am_adam', name: 'Adam', gender: 'male', accent: 'american', quality: 'D' },
    { id: 'am_michael', name: 'Michael', gender: 'male', accent: 'american', quality: 'B' },
    { id: 'am_fenrir', name: 'Fenrir', gender: 'male', accent: 'american', quality: 'B' },
    { id: 'am_eric', name: 'Eric', gender: 'male', accent: 'american', quality: 'C' },
    // British Female
    { id: 'bf_emma', name: 'Emma', gender: 'female', accent: 'british', quality: 'B' },
    { id: 'bf_isabella', name: 'Isabella', gender: 'female', accent: 'british', quality: 'B' },
    // British Male
    { id: 'bm_george', name: 'George', gender: 'male', accent: 'british', quality: 'B' },
    { id: 'bm_lewis', name: 'Lewis', gender: 'male', accent: 'british', quality: 'C' },
];

/**
 * Download size of the Kokoro weights, per dtype, from the ONNX model repo.
 * Every Kokoro voice shares this one file: picking a second Kokoro voice costs
 * nothing extra, whereas each Piper voice is its own separate download.
 */
export const KOKORO_MODEL_MB = { q8: 88, fp32: 310 } as const;

export function getKokoroDownloadMB(iosRuntime = isIOSRuntime()): number {
    return iosRuntime ? KOKORO_MODEL_MB.q8 : KOKORO_MODEL_MB.fp32;
}

export const KOKORO_DEFAULT_VOICE = 'af_heart';

export function resolveKokoroVoiceId(voiceId: string | undefined): string {
    return KOKORO_VOICES.some((voice) => voice.id === voiceId) ? voiceId as string : KOKORO_DEFAULT_VOICE;
}

/**
 * Check if WebGPU is available for acceleration
 */
export async function isWebGPUAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined') return false;
    if (!('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

/**
 * Get the optimal device for TTS based on hardware
 */
export async function getOptimalDevice(): Promise<TTSDevice> {
    const hasWebGPU = await isWebGPUAvailable();
    return hasWebGPU ? 'webgpu' : 'wasm';
}

/**
 * Detect Apple mobile runtimes, including iPadOS when it requests desktop sites.
 */
export function isIOSRuntime(
    userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
    platform = typeof navigator === 'undefined' ? '' : navigator.platform,
    maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): boolean {
    return /iPad|iPhone|iPod/i.test(userAgent)
        || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/**
 * Keep maximum-quality fp32 on desktop. iOS uses q8 on WASM because creating
 * the fp32 ONNX session exceeds WebKit's practical process memory limit.
 */
export function resolveTTSRuntimeConfig(
    requestedDevice: TTSDevice | undefined,
    detectedDevice: TTSDevice,
    iosRuntime = isIOSRuntime(),
): TTSRuntimeConfig {
    if (iosRuntime) {
        return {
            dtype: 'q8',
            device: 'wasm',
        };
    }

    return {
        dtype: 'fp32',
        device: requestedDevice ?? detectedDevice,
    };
}

/**
 * Load the Kokoro TTS library dynamically
 */
async function loadKokoroLibrary(): Promise<void> {
    if (KokoroTTS) return;

    const [module, transformers] = await Promise.all([
        import('kokoro-js'),
        import('@huggingface/transformers'),
    ]);

    if (typeof indexedDB !== 'undefined') {
        transformers.env.useCustomCache = true;
        transformers.env.customCache = transformersModelCache;
        // The custom cache reads existing Cache Storage entries first and uses
        // IndexedDB for oversized files that Cache Storage refuses to commit.
        transformers.env.useBrowserCache = false;
    }

    transformersEnv = transformers.env;
    KokoroTTS = module.KokoroTTS;
}

/**
 * ONNX Runtime's WASM backend runs inference on whichever thread creates the
 * session, and transformers.js leaves it unproxied by default. On WASM that
 * means every sentence is synthesised on the main thread: the UI stops
 * responding to taps and even the OS media controls go dead until the audio is
 * ready. Proxying moves the session into ONNX Runtime's own worker. WebGPU does
 * not block the main thread and cannot be proxied, so it is left alone.
 */
export function applyOnnxProxyPreference(
    device: TTSDevice,
    env: { backends?: { onnx?: { wasm?: { proxy?: boolean } } } } | null = transformersEnv,
): void {
    const wasmBackend = env?.backends?.onnx?.wasm;
    if (!wasmBackend) return;
    wasmBackend.proxy = device === 'wasm';
}

/**
 * Initialize the TTS engine
 */
export async function initKokoro(
    device?: TTSDevice,
    onProgress?: (progress: number, status: string) => void
): Promise<void> {
    const store = useTTSStore.getState();
    
    // Determine runtime config before deciding whether we can reuse the model.
    const detectedDevice = device ?? await getOptimalDevice();
    const runtimeConfig = resolveTTSRuntimeConfig(device, detectedDevice);
    const configKey = `${runtimeConfig.dtype}:${runtimeConfig.device}`;

    // Check if already loaded with same effective config.
    if (ttsInstance && currentLoadedConfig?.dtype === runtimeConfig.dtype && currentLoadedConfig?.device === runtimeConfig.device) {
        store.setReady(true);
        store.setProgress(1, `Ready · ${runtimeConfig.dtype.toUpperCase()} / ${runtimeConfig.device.toUpperCase()}`);
        return;
    }

    // Reuse an in-flight initialization for the same effective config.
    if (ttsInitPromise && ttsInitConfigKey === configKey) {
        return ttsInitPromise;
    }

    // Serialize config changes so two large model instances are never built at once.
    if (ttsInitPromise) {
        await ttsInitPromise;
        return initKokoro(device, onProgress);
    }

    const lifecycleGeneration = ttsLifecycleGeneration;
    const progressReporter = createTTSProgressReporter((progress, status) => {
        onProgress?.(progress, status);
        store.setProgress(progress, status);
    });
    const initPromise: Promise<void> = (async () => {
        try {
            store.setLoading(true);
            store.setError(null);
            progressReporter.report(0, 'Loading TTS library...');
            await loadKokoroLibrary();

            if (!KokoroTTS) {
                throw new Error('Failed to load Kokoro library');
            }

            applyOnnxProxyPreference(runtimeConfig.device);

            const initializingStatus = `Loading model (${runtimeConfig.dtype}, ${runtimeConfig.device})`;
            progressReporter.report(0.1, initializingStatus);

            const loadedInstance = await KokoroTTS.from_pretrained(TTS_MODEL_ID, {
                dtype: runtimeConfig.dtype,
                device: runtimeConfig.device,
                progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
                    if (progress.progress !== undefined) {
                        // This callback is also emitted while reading cached files, so do not
                        // describe it as a network download.
                        const rawProgress = progress.progress > 1 ? progress.progress / 100 : progress.progress;
                        const normalizedProgress = Math.max(0, Math.min(1, rawProgress));
                        const pct = 0.1 + normalizedProgress * 0.9;
                        const file = progress.file?.split('/').pop();
                        const status = file ? `Loading ${file}` : 'Loading model files';
                        progressReporter.report(pct, status);
                    }
                },
            });

            if (lifecycleGeneration !== ttsLifecycleGeneration) {
                return;
            }

            ttsInstance = loadedInstance;
            currentLoadedConfig = runtimeConfig;
            const readyStatus = `Ready · ${runtimeConfig.dtype.toUpperCase()} / ${runtimeConfig.device.toUpperCase()}`;
            store.setReady(true);
            progressReporter.complete(1, readyStatus);

            console.log(`[TTS] Kokoro initialized: ${runtimeConfig.dtype} on ${runtimeConfig.device}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize TTS';
            store.setError(message);
            console.error('[TTS] Initialization failed:', error);
            throw error;
        } finally {
            progressReporter.dispose();
            ttsInitPromise = null;
            ttsInitConfigKey = null;
            store.setLoading(false);
        }
    })();

    ttsInitPromise = initPromise;
    ttsInitConfigKey = configKey;
    return initPromise;
}

/**
 * Unload the TTS engine to free memory
 */
export async function unloadKokoro(): Promise<void> {
    ttsLifecycleGeneration += 1;
    ttsInstance = null;
    currentLoadedConfig = null;
    useTTSStore.getState().setReady(false);
    console.log('[TTS] Unloaded');
}

/**
 * Check whether the selected model weights are present in browser Cache Storage.
 * This is distinct from `isKokoroReady()`, which only describes the in-memory model.
 */
export async function isKokoroModelCached(device?: TTSDevice): Promise<boolean> {
    const detectedDevice = device ?? await getOptimalDevice();
    const runtimeConfig = resolveTTSRuntimeConfig(device, detectedDevice);
    const modelFilename = TTS_MODEL_FILENAMES[runtimeConfig.dtype];
    const modelUrl = `https://huggingface.co/${TTS_MODEL_ID}/resolve/main/onnx/${modelFilename}`;
    return isTransformersFileCached(modelUrl);
}

/**
 * Clear the TTS model cache from browser storage.
 * This forces a fresh download on next initialization.
 * Useful for fixing corrupted model downloads that cause gibberish output.
 */
export async function clearKokoroCache(): Promise<void> {
    // First unload the current instance
    await unloadKokoro();
    
    // transformers.js (used by kokoro-js) caches models in the Cache API
    // The cache name is "transformers-cache"
    const cacheNames = await caches.keys();
    
    let clearedEntries = 0;
    for (const name of cacheNames) {
        if (name.includes('kokoro')) {
            await caches.delete(name);
            console.log(`[TTS] Cleared cache: ${name}`);
            clearedEntries += 1;
            continue;
        }

        const cache = await caches.open(name);
        const requests = await cache.keys();
        for (const request of requests) {
            if (request.url.includes(TTS_MODEL_ID)) {
                if (await cache.delete(request)) {
                    clearedEntries += 1;
                }
            }
        }
    }

    clearedEntries += await clearTransformersModelCache(TTS_MODEL_ID);
    
    if (clearedEntries > 0) {
        console.log('[TTS] Model cache cleared. Model will re-download on next use.');
    } else {
        console.log('[TTS] No TTS cache found to clear.');
    }
}

/**
 * Check if TTS is ready
 */
export function isKokoroReady(): boolean {
    return ttsInstance !== null;
}

async function generateValidatedAudio(
    text: string,
    voice: string,
    speed: number,
): Promise<{ samples: Float32Array; phonemes?: string }> {
    if (!ttsInstance) throw new Error('TTS not initialized');

    // Voice type is a union of specific strings in kokoro-js, cast to satisfy TS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result = await ttsInstance.generate(text, { voice: voice as any, speed });
    let samples = result.audio as Float32Array;
    let validationError = getTTSAudioValidationError(samples);

    if (validationError) {
        const failedConfig = currentLoadedConfig
            ? `${currentLoadedConfig.dtype}/${currentLoadedConfig.device}`
            : 'unknown runtime';

        if (currentLoadedConfig?.device === 'wasm') {
            throw new Error(`TTS generated invalid ${currentLoadedConfig.dtype} audio on WASM: ${validationError}`);
        }

        console.error(`[TTS] Rejected invalid ${failedConfig} output: ${validationError}. Retrying fp32 on WASM.`);
        const store = useTTSStore.getState();
        store.setProgress(0, `Invalid ${failedConfig} audio · retrying FP32 / WASM`);

        await initKokoro('wasm');

        if (!ttsInstance) throw new Error('TTS fallback failed to initialize');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await ttsInstance.generate(text, { voice: voice as any, speed });
        samples = result.audio as Float32Array;
        validationError = getTTSAudioValidationError(samples);

        if (validationError) {
            throw new Error(`TTS fallback generated invalid audio: ${validationError}`);
        }

        const fallbackStore = useTTSStore.getState();
        fallbackStore.setBackendPreference('wasm');
        fallbackStore.setProgress(1, 'Ready · FP32 / WASM · stable fallback');
    }

    // phonemes may exist on result depending on kokoro-js version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phonemes = (result as any).phonemes as string | undefined;
    return { samples, phonemes };
}

/**
 * Generate speech for a single text segment
 */
export async function generateKokoroSpeech(
    text: string,
    options: {
        voice?: string;
        speed?: number;
    } = {}
): Promise<TTSAudioResult> {
    if (!ttsInstance) {
        await initKokoro();
    }
    
    if (!ttsInstance) {
        throw new Error('TTS not initialized');
    }
    
    const { voice: requestedVoice, speed = 1.0 } = options;
    const voice = resolveKokoroVoiceId(requestedVoice);
    
    const store = useTTSStore.getState();
    store.setGenerating(true);
    
    try {
        const synthesisText = prepareKokoroTextForSpeech(text);
        const { samples: generatedSamples, phonemes } = await generateValidatedAudio(synthesisText, voice, speed);
        const sampleRate = 24000;
        const samples = trimTTSAudioSilence(generatedSamples, sampleRate);
        const duration = samples.length / sampleRate;
        
        return {
            samples,
            sampleRate,
            duration,
            text,
            phonemes,
        };
    } finally {
        store.setGenerating(false);
    }
}
