/**
 * TTS Engine Router
 *
 * The app speaks through two local engines: Kokoro for English and Piper for
 * Slovenian. Both are addressed through a single voice list — the selected
 * voice id decides which engine runs, so the rest of the app (player, reader,
 * settings) never branches on the engine itself.
 */

import { type TTSAudioResult } from './audio';
import { type SentenceBoundary } from './sentences';
import type { GenerationSample } from './realtimePacer';
import {
    generateKokoroSpeech,
    initKokoro,
    isKokoroModelCached,
    isKokoroReady,
    clearKokoroCache,
    unloadKokoro,
    KOKORO_DEFAULT_VOICE,
    getKokoroDownloadMB,
    KOKORO_VOICES,
    type TTSDevice,
} from './kokoro';
import {
    clearPiperCache,
    generatePiperSpeech,
    initPiper,
    isPiperReady,
    isPiperVoiceCached,
    isPiperVoiceId,
    PIPER_VOICES,
    unloadPiper,
} from './piper';
import {
    getTTSDefaultVoice,
    getTTSFallbackCandidates,
    registerTTSModelPlugin,
} from './modelRegistry';

export type TTSEngineId = 'kokoro' | 'piper';

export interface VoiceInfo {
    id: string;
    name: string;
    engine: TTSEngineId;
    gender: 'female' | 'male';
    /** BCP-47 tag, used to group voices in the UI */
    language: string;
    languageLabel: string;
    flag: string;
    quality: 'A' | 'B' | 'C' | 'D';
    /**
     * Synthesis cost, not sound quality. Kokoro is one 82M-parameter model for
     * every English voice and needs a fast device to generate faster than it
     * speaks; Piper's per-voice models are small enough to keep up on a phone.
     * Download size does not separate them — they are 88 MB and 60 MB — so this
     * is the only thing that tells a listener which will actually work.
     */
    weight: 'light' | 'heavy';
    downloadMB?: number;
    description?: string;
}

const KOKORO_ACCENTS = {
    american: { language: 'en-US', languageLabel: 'American English', flag: '🇺🇸' },
    british: { language: 'en-GB', languageLabel: 'British English', flag: '🇬🇧' },
} as const;

export const VOICES: VoiceInfo[] = [
    ...KOKORO_VOICES.map((voice): VoiceInfo => ({
        id: voice.id,
        name: voice.name,
        engine: 'kokoro',
        gender: voice.gender,
        quality: voice.quality,
        weight: 'heavy',
        downloadMB: getKokoroDownloadMB(),
        description: voice.description,
        ...KOKORO_ACCENTS[voice.accent],
    })),
    ...PIPER_VOICES.map((voice): VoiceInfo => ({
        id: voice.id,
        name: voice.name,
        engine: 'piper',
        gender: voice.gender,
        quality: 'B',
        weight: 'light',
        downloadMB: voice.downloadMB,
        description: voice.description,
        language: voice.language,
        languageLabel: voice.languageLabel,
        flag: voice.flag,
    })),
];

registerTTSModelPlugin({
    id: 'kokoro',
    getDefaultVoice: (availableVoices) => availableVoices.some((voice) => voice.id === KOKORO_DEFAULT_VOICE)
        ? KOKORO_DEFAULT_VOICE
        : undefined,
});

registerTTSModelPlugin({
    id: 'piper',
    getFallbackCandidates: (preferredVoice, availableVoices) => {
        if (preferredVoice.engine === 'piper') return [];
        return availableVoices.filter((candidate) => (
            candidate.engine === 'piper'
            && candidate.language === preferredVoice.language
            && candidate.gender === preferredVoice.gender
        ));
    },
});

export const DEFAULT_VOICE = getTTSDefaultVoice(VOICES) ?? KOKORO_DEFAULT_VOICE;

export function listVoices(): VoiceInfo[] {
    return VOICES;
}

export function getVoice(voiceId: string): VoiceInfo | undefined {
    return VOICES.find((voice) => voice.id === voiceId);
}

/**
 * Fall back to the default voice for ids this build no longer knows, so a
 * persisted setting from an older version can never wedge playback.
 */
export function resolveVoiceId(voiceId: string | undefined): string {
    return VOICES.some((voice) => voice.id === voiceId) ? voiceId as string : DEFAULT_VOICE;
}

export function getVoiceEngine(voiceId: string | undefined): TTSEngineId {
    return isPiperVoiceId(voiceId) ? 'piper' : 'kokoro';
}

export function getFallbackVoice(preferredVoiceId: string | undefined): VoiceInfo | undefined {
    const preferredVoice = getVoice(resolveVoiceId(preferredVoiceId));
    if (!preferredVoice || preferredVoice.engine !== 'kokoro') return undefined;

    return getTTSFallbackCandidates(preferredVoice, VOICES)[0];
}

/**
 * Keep only the engine in use resident — both hold hundreds of megabytes of
 * weights, and nothing plays two languages at once.
 */
async function unloadOtherEngine(engine: TTSEngineId): Promise<void> {
    if (engine === 'kokoro' && isPiperReady()) {
        await unloadPiper();
    } else if (engine === 'piper' && isKokoroReady()) {
        await unloadKokoro();
    }
}

let initializationChain: Promise<void> = Promise.resolve();

/**
 * Initialize the engine that owns the given voice.
 * `device` only applies to Kokoro; Piper always runs on WASM.
 */
export async function initTTS(
    voiceId: string | undefined,
    device?: TTSDevice,
    onProgress?: (progress: number, status: string) => void,
): Promise<void> {
    const initialize = async () => {
        const voice = resolveVoiceId(voiceId);
        const engine = getVoiceEngine(voice);

        await unloadOtherEngine(engine);

        if (engine === 'piper') {
            await initPiper(voice, onProgress);
            return;
        }

        await initKokoro(device, onProgress);
    };

    const result = initializationChain.then(initialize, initialize);
    initializationChain = result.catch(() => undefined);
    return result;
}

export async function unloadTTS(): Promise<void> {
    await unloadKokoro();
    await unloadPiper();
}

export function isTTSReady(voiceId?: string): boolean {
    return getVoiceEngine(resolveVoiceId(voiceId)) === 'piper' ? isPiperReady() : isKokoroReady();
}

/**
 * Whether the voice's weights are already on device. Distinct from
 * `isTTSReady()`, which describes the in-memory model.
 */
export async function isTTSModelCached(voiceId: string | undefined, device?: TTSDevice): Promise<boolean> {
    const voice = resolveVoiceId(voiceId);
    return getVoiceEngine(voice) === 'piper'
        ? isPiperVoiceCached(voice)
        : isKokoroModelCached(device);
}

/**
 * Drop the cached weights for a voice's engine, forcing a fresh download.
 */
export async function clearTTSCache(voiceId?: string): Promise<void> {
    const voice = resolveVoiceId(voiceId);
    if (getVoiceEngine(voice) === 'piper') {
        await clearPiperCache(voice);
        return;
    }
    await clearKokoroCache();
}

/**
 * Generate speech for a single text segment
 */
export async function generateSpeech(
    text: string,
    options: {
        voice?: string;
        speed?: number;
    } = {},
): Promise<TTSAudioResult> {
    const voice = resolveVoiceId(options.voice);
    const speed = options.speed ?? 1.0;

    return getVoiceEngine(voice) === 'piper'
        ? generatePiperSpeech(text, { voice, speed })
        : generateKokoroSpeech(text, { voice, speed });
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
        getSpeed?: (sentence: SentenceBoundary) => number;
        onSentenceStart?: (sentence: SentenceBoundary) => void;
        onSentenceComplete?: (sentence: SentenceBoundary, audio: TTSAudioResult) => void;
        onGenerationSample?: (sample: GenerationSample) => void;
    } = {},
): AsyncGenerator<{ sentence: SentenceBoundary; audio: TTSAudioResult }> {
    const {
        voice: requestedVoice,
        speed = 1.0,
        getSpeed,
        onSentenceStart,
        onSentenceComplete,
        onGenerationSample,
    } = options;
    const voice = resolveVoiceId(requestedVoice);

    if (!isTTSReady(voice)) {
        await initTTS(voice);
    }

    let cumulativeTime = 0;

    for (const sentence of sentences) {
        onSentenceStart?.(sentence);

        try {
            const sentenceSpeed = getSpeed?.(sentence) ?? speed;
            const startedAt = performance.now();
            const audio = await generateSpeech(sentence.text, { voice, speed: sentenceSpeed });
            const generationSeconds = Math.max(0.0001, (performance.now() - startedAt) / 1000);
            onGenerationSample?.({
                generationSeconds,
                audioSeconds: audio.duration,
            });

            // Track where each sentence lands in the chapter's audio timeline
            // so reading and listening positions stay convertible.
            sentence.audioStartTime = cumulativeTime;
            sentence.audioEndTime = cumulativeTime + audio.duration;
            cumulativeTime += audio.duration;

            onSentenceComplete?.(sentence, audio);

            yield { sentence, audio };
        } catch (error) {
            console.error(`[TTS] Failed to generate sentence ${sentence.index}:`, error);
            throw error;
        }
    }
}
