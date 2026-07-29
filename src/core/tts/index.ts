/**
 * TTS Module Exports
 */

export {
    // Core TTS functions
    initTTS,
    unloadTTS,
    clearTTSCache,
    isTTSModelCached,
    isTTSReady,
    generateSpeech,
    getTTSAudioValidationError,
    streamSpeech,
    
    // Sentence utilities
    splitIntoSentences,
    findSentenceForWord,
    estimateAudioTimeForWord,
    findWordForAudioTime,
    
    // Voice utilities
    listVoices,
    getVoice,
    resolveVoiceId,
    VOICES,
    DEFAULT_VOICE,
    
    // Device utilities
    isWebGPUAvailable,
    getOptimalDevice,
    
    // Constants
    TTS_MODEL_ID,
    
    // Types
    type TTSDevice,
    type TTSAudioResult,
    type SentenceBoundary,
    type VoiceInfo,
} from './kokoro';

export {
    ttsPlayer,
    audioToWavBlob,
    estimateAudioDuration,
    type AudioPlayerOptions,
} from './player';
