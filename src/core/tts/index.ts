/**
 * TTS Module Exports
 */

export {
    // Engine routing
    initTTS,
    unloadTTS,
    clearTTSCache,
    isTTSModelCached,
    isTTSReady,
    generateSpeech,
    streamSpeech,

    // Voice registry
    listVoices,
    getVoice,
    getVoiceEngine,
    resolveVoiceId,
    VOICES,
    DEFAULT_VOICE,

    // Types
    type TTSEngineId,
    type VoiceInfo,
} from './engine';

export {
    // Sentence utilities
    splitIntoSentences,
    findSentenceForWord,
    estimateAudioTimeForWord,
    findWordForAudioTime,
    type SentenceBoundary,
} from './sentences';

export {
    getTTSAudioValidationError,
    type TTSAudioResult,
} from './audio';

export {
    // Device utilities
    isWebGPUAvailable,
    getOptimalDevice,

    // Constants
    TTS_MODEL_ID,

    // Types
    type TTSDevice,
} from './kokoro';

export {
    PIPER_VOICES,
} from './piper';

export {
    ttsPlayer,
    audioToWavBlob,
    estimateAudioDuration,
    type AudioPlayerOptions,
} from './player';
