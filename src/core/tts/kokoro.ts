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
 * - ~10x realtime generation speed
 */

// Type-only import for the store (avoids circular deps at runtime)
import type { useTTSStore as TTSStoreType } from '../store/tts';

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

// Model configuration
export const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type TTSQuantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
export type TTSDevice = 'wasm' | 'webgpu';

export interface TTSModelInfo {
    quantization: TTSQuantization;
    sizeBytes: number;
    quality: 'best' | 'great' | 'good' | 'acceptable';
    recommended: boolean;
}

export const TTS_MODEL_OPTIONS: Record<TTSQuantization, TTSModelInfo> = {
    fp32: { quantization: 'fp32', sizeBytes: 326_000_000, quality: 'best', recommended: false },
    fp16: { quantization: 'fp16', sizeBytes: 163_000_000, quality: 'best', recommended: false },
    q8: { quantization: 'q8', sizeBytes: 92_400_000, quality: 'great', recommended: true },
    q4f16: { quantization: 'q4f16', sizeBytes: 154_000_000, quality: 'great', recommended: false },
    q4: { quantization: 'q4', sizeBytes: 305_000_000, quality: 'good', recommended: false },
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
 * Load the Kokoro TTS library dynamically
 */
async function loadKokoroLibrary(): Promise<void> {
    if (KokoroTTS && TextSplitterStream) return;
    
    const module = await import('kokoro-js');
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
    
    // Check if already loaded with same config
    if (ttsInstance && currentLoadedConfig?.dtype === quantization && currentLoadedConfig?.device === device) {
        return;
    }
    
    try {
        store.setLoading(true);
        store.setError(null);
        
        onProgress?.(0, 'Loading TTS library...');
        await loadKokoroLibrary();
        
        if (!KokoroTTS) {
            throw new Error('Failed to load Kokoro library');
        }
        
        // Determine device
        const targetDevice = device ?? await getOptimalDevice();
        
        onProgress?.(0.1, `Initializing TTS (${quantization}, ${targetDevice})...`);
        
        // For WebGPU, fp32 is recommended for performance; for WASM, q8 is fine.
        // We respect the caller's explicit quantization choice but warn about potential performance.
        if (targetDevice === 'webgpu' && quantization === 'q8') {
            console.warn('[TTS] Using q8 quantization on WebGPU. This may be slower; consider using fp32 for best performance.');
        }
        const dtype = quantization;
        
        ttsInstance = await KokoroTTS.from_pretrained(TTS_MODEL_ID, {
            dtype,
            device: targetDevice,
            progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
                if (progress.progress !== undefined) {
                    // progress.progress is 0-100 or 0-1, normalize to 0-1 and clamp to [0, 1]
                    const rawProgress = progress.progress > 1 ? progress.progress / 100 : progress.progress;
                    const normalizedProgress = Math.max(0, Math.min(1, rawProgress));
                    const pct = 0.1 + normalizedProgress * 0.9;
                    const file = progress.file?.split('/').pop() || '';
                    onProgress?.(pct, `Downloading ${file}...`);
                    store.setProgress(pct, `Downloading ${file}`);
                }
            },
        });
        
        currentLoadedConfig = { dtype, device: targetDevice };
        store.setReady(true);
        store.setProgress(1, 'TTS Ready');
        onProgress?.(1, 'TTS Ready');
        
        console.log(`[TTS] Kokoro initialized: ${dtype} on ${targetDevice}`);
        
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize TTS';
        store.setError(message);
        console.error('[TTS] Initialization failed:', error);
        throw error;
    } finally {
        store.setLoading(false);
    }
}

/**
 * Unload the TTS engine to free memory
 */
export async function unloadTTS(): Promise<void> {
    ttsInstance = null;
    currentLoadedConfig = null;
    const useTTSStore = await getTTSStore();
    useTTSStore.getState().setReady(false);
    console.log('[TTS] Unloaded');
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
    
    let cleared = false;
    for (const name of cacheNames) {
        // Clear transformers cache and any kokoro-related caches
        if (name.includes('transformers') || name.includes('kokoro') || name.includes('onnx')) {
            await caches.delete(name);
            console.log(`[TTS] Cleared cache: ${name}`);
            cleared = true;
        }
    }
    
    if (cleared) {
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
        // Voice type is a union of specific strings in kokoro-js, cast to satisfy TS
        const result = await ttsInstance.generate(text, {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            voice: voice as any,
            speed,
        });
        
        // Extract audio data
        const samples = result.audio as Float32Array;
        const sampleRate = 24000;
        const duration = samples.length / sampleRate;
        
        // phonemes may exist on result depending on kokoro-js version
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phonemes = (result as any).phonemes as string | undefined;
        
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await ttsInstance.generate(sentence.text, { voice: voice as any, speed });
            
            const samples = result.audio as Float32Array;
            const sampleRate = 24000;
            const duration = samples.length / sampleRate;
            
            // Update sentence timing
            sentence.audioStartTime = cumulativeTime;
            sentence.audioEndTime = cumulativeTime + duration;
            cumulativeTime += duration;
            
            // phonemes may exist on result depending on kokoro-js version
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const phonemes = (result as any).phonemes as string | undefined;
            
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
