/**
 * Kokoro TTS Service
 * 
 * Local text-to-speech using the Kokoro-82M model via kokoro-js.
 * Runs entirely in the browser using ONNX Runtime (WASM or WebGPU).
 * 
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX
 * - 82M parameters, frontier quality for size
 * - q8 quantization: ~92MB download
 * - 24kHz mono audio output
 * - Generation speed depends on model, backend, browser, and hardware
 */

// Type-only import for the store (avoids circular deps at runtime)
import type { useTTSStore as TTSStoreType } from '../store/tts';
import {
    clearTransformersModelCache,
    isTransformersFileCached,
    transformersModelCache,
} from './modelCache';

// Lazy store getter to avoid circular dependency issues  
let _ttsStore: typeof TTSStoreType | null = null;
async function getTTSStore(): Promise<typeof TTSStoreType> {
    if (!_ttsStore) {
        const module = await import('../store/tts');
        _ttsStore = module.useTTSStore;
    }
    return _ttsStore;
}

// Lazy import to avoid loading the large library until needed
let KokoroTTS: typeof import('kokoro-js').KokoroTTS | null = null;
let TextSplitterStream: typeof import('kokoro-js').TextSplitterStream | null = null;

// Singleton instance
let ttsInstance: InstanceType<typeof import('kokoro-js').KokoroTTS> | null = null;
let currentLoadedConfig: { dtype: TTSQuantization; device: TTSDevice } | null = null;
let ttsInitPromise: Promise<void> | null = null;
let ttsInitConfigKey: string | null = null;
let ttsLifecycleGeneration = 0;

// Model configuration
export const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type TTSQuantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
export type TTSDevice = 'wasm' | 'webgpu';

export interface TTSRuntimeConfig {
    dtype: TTSQuantization;
    device: TTSDevice;
    compatibilityMode: boolean;
}

export interface TTSModelInfo {
    quantization: TTSQuantization;
    sizeBytes: number;
    quality: 'best' | 'great' | 'good' | 'acceptable';
    recommended: boolean;
}

export const TTS_MODEL_OPTIONS: Record<TTSQuantization, TTSModelInfo> = {
    fp32: { quantization: 'fp32', sizeBytes: 326_000_000, quality: 'best', recommended: true },
    fp16: { quantization: 'fp16', sizeBytes: 163_000_000, quality: 'best', recommended: false },
    q8: { quantization: 'q8', sizeBytes: 92_400_000, quality: 'great', recommended: false },
    q4f16: { quantization: 'q4f16', sizeBytes: 154_000_000, quality: 'great', recommended: false },
    q4: { quantization: 'q4', sizeBytes: 305_000_000, quality: 'good', recommended: false },
};

const TTS_MODEL_FILENAMES: Record<TTSQuantization, string> = {
    fp32: 'model.onnx',
    fp16: 'model_fp16.onnx',
    q8: 'model_quantized.onnx',
    q4: 'model_q4.onnx',
    q4f16: 'model_q4f16.onnx',
};

// Voice definitions with metadata
export interface VoiceInfo {
    id: string;
    name: string;
    gender: 'female' | 'male';
    accent: 'american' | 'british';
    quality: 'A' | 'B' | 'C' | 'D';
    description?: string;
}

export const VOICES: VoiceInfo[] = [
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

export const DEFAULT_VOICE = 'af_heart';

export function resolveVoiceId(voiceId: string | undefined): string {
    return VOICES.some((voice) => voice.id === voiceId) ? voiceId as string : DEFAULT_VOICE;
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
 * Resolve runtime config used for model initialization.
 *
 * Kokoro's q8 + WebGPU path can be unstable on some browser/GPU combinations,
 * often producing unnatural or garbled speech. When device selection is
 * automatic, prefer q8 on WASM for stability.
 */
export function resolveTTSRuntimeConfig(
    quantization: TTSQuantization,
    requestedDevice: TTSDevice | undefined,
    detectedDevice: TTSDevice,
): TTSRuntimeConfig {
    if (requestedDevice) {
        return {
            dtype: quantization,
            device: requestedDevice,
            compatibilityMode: false,
        };
    }

    if (detectedDevice === 'webgpu' && quantization === 'q8') {
        return {
            dtype: quantization,
            device: 'wasm',
            compatibilityMode: true,
        };
    }

    return {
        dtype: quantization,
        device: detectedDevice,
        compatibilityMode: false,
    };
}

/**
 * Load the Kokoro TTS library dynamically
 */
async function loadKokoroLibrary(): Promise<void> {
    if (KokoroTTS && TextSplitterStream) return;

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

    KokoroTTS = module.KokoroTTS;
    TextSplitterStream = module.TextSplitterStream;
}

/**
 * Initialize the TTS engine
 */
export async function initTTS(
    quantization: TTSQuantization = 'q8',
    device?: TTSDevice,
    onProgress?: (progress: number, status: string) => void
): Promise<void> {
    // Get store using lazy getter to avoid circular dependency
    const useTTSStore = await getTTSStore();
    const store = useTTSStore.getState();
    
    // Determine runtime config before deciding whether we can reuse the model.
    const detectedDevice = device ?? await getOptimalDevice();
    const runtimeConfig = resolveTTSRuntimeConfig(quantization, device, detectedDevice);
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
        return initTTS(quantization, device, onProgress);
    }

    const lifecycleGeneration = ttsLifecycleGeneration;
    const initPromise: Promise<void> = (async () => {
        try {
            store.setLoading(true);
            store.setError(null);
            store.setProgress(0, 'Loading TTS library');

            onProgress?.(0, 'Loading TTS library...');
            await loadKokoroLibrary();

            if (!KokoroTTS) {
                throw new Error('Failed to load Kokoro library');
            }

            if (runtimeConfig.compatibilityMode) {
                const compatibilityStatus = 'Using compatibility mode (q8 on WASM) for stable speech output';
                onProgress?.(0.08, compatibilityStatus);
                store.setProgress(0.08, compatibilityStatus);
                console.warn('[TTS] Auto-switched q8 from WebGPU to WASM for output stability.');
            }

            const initializingStatus = `Loading model (${runtimeConfig.dtype}, ${runtimeConfig.device})`;
            onProgress?.(0.1, initializingStatus);
            store.setProgress(0.1, initializingStatus);

            // For explicit WebGPU + q8 requests, keep behavior but warn.
            if (runtimeConfig.device === 'webgpu' && runtimeConfig.dtype === 'q8') {
                console.warn('[TTS] Using q8 quantization on WebGPU. This may be slower; consider using fp32 for best performance.');
            }

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
                        onProgress?.(pct, status);
                        store.setProgress(pct, status);
                    }
                },
            });

            if (lifecycleGeneration !== ttsLifecycleGeneration) {
                return;
            }

            ttsInstance = loadedInstance;
            currentLoadedConfig = { dtype: runtimeConfig.dtype, device: runtimeConfig.device };
            const readyStatus = `Ready · ${runtimeConfig.dtype.toUpperCase()} / ${runtimeConfig.device.toUpperCase()}`;
            store.setReady(true);
            store.setProgress(1, readyStatus);
            onProgress?.(1, readyStatus);

            console.log(`[TTS] Kokoro initialized: ${runtimeConfig.dtype} on ${runtimeConfig.device}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to initialize TTS';
            store.setError(message);
            console.error('[TTS] Initialization failed:', error);
            throw error;
        } finally {
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
export async function unloadTTS(): Promise<void> {
    ttsLifecycleGeneration += 1;
    ttsInstance = null;
    currentLoadedConfig = null;
    const useTTSStore = await getTTSStore();
    useTTSStore.getState().setReady(false);
    console.log('[TTS] Unloaded');
}

/**
 * Check whether the selected model weights are present in browser Cache Storage.
 * This is distinct from `isTTSReady()`, which only describes the in-memory model.
 */
export async function isTTSModelCached(quantization: TTSQuantization): Promise<boolean> {
    const modelFilename = TTS_MODEL_FILENAMES[quantization];
    const modelUrl = `https://huggingface.co/${TTS_MODEL_ID}/resolve/main/onnx/${modelFilename}`;
    return isTransformersFileCached(modelUrl);
}

/**
 * Clear the TTS model cache from browser storage.
 * This forces a fresh download on next initialization.
 * Useful for fixing corrupted model downloads that cause gibberish output.
 */
export async function clearTTSCache(): Promise<void> {
    // First unload the current instance
    await unloadTTS();
    
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
export function isTTSReady(): boolean {
    return ttsInstance !== null;
}

/**
 * Audio result from TTS generation
 */
export interface TTSAudioResult {
    /** Raw audio samples (Float32Array) */
    samples: Float32Array;
    /** Sample rate (24000 Hz) */
    sampleRate: number;
    /** Duration in seconds */
    duration: number;
    /** Original text */
    text: string;
    /** Phonemes used for generation */
    phonemes?: string;
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

        if (currentLoadedConfig?.dtype === 'q8' && currentLoadedConfig.device === 'wasm') {
            throw new Error(`TTS generated invalid audio on stable fallback: ${validationError}`);
        }

        console.error(`[TTS] Rejected invalid ${failedConfig} output: ${validationError}. Retrying with q8/WASM.`);
        const useTTSStore = await getTTSStore();
        const store = useTTSStore.getState();
        store.setProgress(0, `Invalid ${failedConfig} audio · switching to q8/WASM`);

        await initTTS('q8', 'wasm');

        if (!ttsInstance) throw new Error('TTS fallback failed to initialize');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await ttsInstance.generate(text, { voice: voice as any, speed });
        samples = result.audio as Float32Array;
        validationError = getTTSAudioValidationError(samples);

        if (validationError) {
            throw new Error(`TTS fallback generated invalid audio: ${validationError}`);
        }

        const fallbackStore = useTTSStore.getState();
        fallbackStore.setQuantization('q8');
        fallbackStore.setBackendPreference('wasm');
        fallbackStore.setProgress(1, 'Ready · Q8 / WASM · stable fallback');
    }

    // phonemes may exist on result depending on kokoro-js version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phonemes = (result as any).phonemes as string | undefined;
    return { samples, phonemes };
}

/**
 * Generate speech for a single text segment
 */
export async function generateSpeech(
    text: string,
    options: {
        voice?: string;
        speed?: number;
    } = {}
): Promise<TTSAudioResult> {
    if (!ttsInstance) {
        await initTTS();
    }
    
    if (!ttsInstance) {
        throw new Error('TTS not initialized');
    }
    
    const { voice: requestedVoice, speed = 1.0 } = options;
    const voice = resolveVoiceId(requestedVoice);
    
    // Get store using lazy getter
    const useTTSStore = await getTTSStore();
    const store = useTTSStore.getState();
    store.setGenerating(true);
    
    try {
        const { samples, phonemes } = await generateValidatedAudio(text, voice, speed);
        const sampleRate = 24000;
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

/**
 * Sentence boundary information for sync
 */
export interface SentenceBoundary {
    index: number;
    text: string;
    startWordIndex: number;
    endWordIndex: number;
    audioStartTime?: number;
    audioEndTime?: number;
}

/**
 * Split text into sentences for TTS processing
 * This enables smooth reading <-> listening transitions
 */
export function splitIntoSentences(words: string[]): SentenceBoundary[] {
    const sentences: SentenceBoundary[] = [];
    let currentSentence: string[] = [];
    let sentenceStartIndex = 0;
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        currentSentence.push(word);
        
        // Check for sentence-ending punctuation
        const isEnd = /[.!?]["']?$/.test(word) || 
                      /[.!?]$/.test(word) ||
                      // Also break on very long sentences (for better streaming)
                      currentSentence.length >= 50;
        
        if (isEnd || i === words.length - 1) {
            sentences.push({
                index: sentences.length,
                text: currentSentence.join(' '),
                startWordIndex: sentenceStartIndex,
                endWordIndex: i,
            });
            currentSentence = [];
            sentenceStartIndex = i + 1;
        }
    }
    
    return sentences;
}

/**
 * Find the sentence containing a given word index
 */
export function findSentenceForWord(
    wordIndex: number,
    sentences: SentenceBoundary[]
): SentenceBoundary | null {
    return sentences.find(
        s => wordIndex >= s.startWordIndex && wordIndex <= s.endWordIndex
    ) ?? null;
}

/**
 * Calculate audio timestamp from word index (approximate)
 */
export function estimateAudioTimeForWord(
    wordIndex: number,
    sentences: SentenceBoundary[],
    totalAudioDuration: number
): number {
    const sentence = findSentenceForWord(wordIndex, sentences);
    if (!sentence || sentence.audioStartTime === undefined) {
        // Fallback: linear interpolation based on total words
        const totalWords = sentences[sentences.length - 1]?.endWordIndex ?? 0;
        return (wordIndex / totalWords) * totalAudioDuration;
    }
    
    // Interpolate within the sentence
    const sentenceWordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
    const wordOffsetInSentence = wordIndex - sentence.startWordIndex;
    const sentenceDuration = (sentence.audioEndTime ?? 0) - sentence.audioStartTime;
    
    return sentence.audioStartTime + (wordOffsetInSentence / sentenceWordCount) * sentenceDuration;
}

/**
 * Find word index from audio timestamp
 */
export function findWordForAudioTime(
    audioTime: number,
    sentences: SentenceBoundary[]
): number {
    // Find the sentence containing this timestamp
    for (const sentence of sentences) {
        if (
            sentence.audioStartTime !== undefined &&
            sentence.audioEndTime !== undefined &&
            audioTime >= sentence.audioStartTime &&
            audioTime <= sentence.audioEndTime
        ) {
            // Interpolate within sentence
            const progress = (audioTime - sentence.audioStartTime) / 
                           (sentence.audioEndTime - sentence.audioStartTime);
            const sentenceWordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
            const wordOffset = Math.floor(progress * sentenceWordCount);
            return Math.min(sentence.startWordIndex + wordOffset, sentence.endWordIndex);
        }
    }
    
    // Fallback: find closest sentence by time and handle out-of-range audioTime
    if (sentences.length === 0) {
        return 0;
    }
    
    let closestSentence: SentenceBoundary | undefined;
    let maxEndTime = -Infinity;
    
    for (const sentence of sentences) {
        if (sentence.audioStartTime === undefined) {
            continue;
        }
        
        const endTime = sentence.audioEndTime ?? sentence.audioStartTime;
        
        // Track the furthest point in time covered by any sentence
        if (endTime > maxEndTime) {
            maxEndTime = endTime;
        }
        
        // Find the last sentence that starts before or at audioTime
        if (sentence.audioStartTime <= audioTime) {
            closestSentence = sentence;
        }
    }
    
    if (!closestSentence) {
        // No sentences with timing information; fall back to first sentence or index 0
        return sentences[0]?.startWordIndex ?? 0;
    }
    
    // If audioTime is beyond all sentences, snap to the end of the last sentence
    if (audioTime > maxEndTime && maxEndTime !== -Infinity) {
        return closestSentence.endWordIndex;
    }
    
    return closestSentence.startWordIndex;
}

/**
 * Streaming TTS generator for long texts
 * Yields audio chunks as they're generated
 */
export async function* streamSpeech(
    sentences: SentenceBoundary[],
    options: {
        voice?: string;
        speed?: number;
        onSentenceStart?: (sentence: SentenceBoundary) => void;
        onSentenceComplete?: (sentence: SentenceBoundary, audio: TTSAudioResult) => void;
    } = {}
): AsyncGenerator<{ sentence: SentenceBoundary; audio: TTSAudioResult }> {
    if (!ttsInstance) {
        await initTTS();
    }
    
    if (!ttsInstance) {
        throw new Error('TTS not initialized');
    }
    
    const { voice: requestedVoice, speed = 1.0, onSentenceStart, onSentenceComplete } = options;
    const voice = resolveVoiceId(requestedVoice);
    const useTTSStore = await getTTSStore();
    const store = useTTSStore.getState();
    
    let cumulativeTime = 0;
    
    for (const sentence of sentences) {
        onSentenceStart?.(sentence);
        store.setCurrentSentence(sentence.index);
        
        try {
            const { samples, phonemes } = await generateValidatedAudio(sentence.text, voice, speed);
            const sampleRate = 24000;
            const duration = samples.length / sampleRate;
            
            // Update sentence timing
            sentence.audioStartTime = cumulativeTime;
            sentence.audioEndTime = cumulativeTime + duration;
            cumulativeTime += duration;
            
            const audio: TTSAudioResult = {
                samples,
                sampleRate,
                duration,
                text: sentence.text,
                phonemes,
            };
            
            onSentenceComplete?.(sentence, audio);
            
            yield { sentence, audio };
            
        } catch (error) {
            console.error(`[TTS] Failed to generate sentence ${sentence.index}:`, error);
            throw error;
        }
    }
}

/**
 * Get list of available voices
 */
export function listVoices(): VoiceInfo[] {
    return VOICES;
}

/**
 * Get voice info by ID
 */
export function getVoice(voiceId: string): VoiceInfo | undefined {
    return VOICES.find(v => v.id === voiceId);
}
