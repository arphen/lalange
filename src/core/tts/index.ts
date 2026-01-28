/**
 * TTS Module Exports
 */

export {
    // Core TTS functions
    initTTS,
    unloadTTS,
    isTTSReady,
    generateSpeech,
    streamSpeech,
    
    // Sentence utilities
    splitIntoSentences,
    findSentenceForWord,
    estimateAudioTimeForWord,
    findWordForAudioTime,
    
    // Voice utilities
    listVoices,
    getVoice,
    VOICES,
    DEFAULT_VOICE,
    
    // Device utilities
    isWebGPUAvailable,
    getOptimalDevice,
    
    // Constants
    TTS_MODEL_ID,
    TTS_MODEL_OPTIONS,
    
    // Types
    type TTSQuantization,
    type TTSDevice,
    type TTSModelInfo,
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
