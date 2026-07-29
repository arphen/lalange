/**
 * Tests for TTS utility functions
 * 
 * These tests cover the pure utility functions that don't require
 * loading the actual Kokoro model.
 */

import { describe, it, expect } from 'vitest';
import {
    splitIntoSentences,
    findSentenceForWord,
    estimateAudioTimeForWord,
    findWordForAudioTime,
    listVoices,
    getVoice,
    resolveVoiceId,
    resolveTTSRuntimeConfig,
    getTTSAudioValidationError,
    VOICES,
    DEFAULT_VOICE,
    type SentenceBoundary,
} from './kokoro';

describe('splitIntoSentences', () => {
    it('should split simple sentences correctly', () => {
        const words = ['Hello', 'world.', 'How', 'are', 'you?'];
        const sentences = splitIntoSentences(words);
        
        expect(sentences).toHaveLength(2);
        expect(sentences[0]).toEqual({
            index: 0,
            text: 'Hello world.',
            startWordIndex: 0,
            endWordIndex: 1,
        });
        expect(sentences[1]).toEqual({
            index: 1,
            text: 'How are you?',
            startWordIndex: 2,
            endWordIndex: 4,
        });
    });
    
    it('should handle exclamation marks', () => {
        const words = ['Wow!', 'That', 'is', 'amazing.'];
        const sentences = splitIntoSentences(words);
        
        expect(sentences).toHaveLength(2);
        expect(sentences[0].text).toBe('Wow!');
        expect(sentences[1].text).toBe('That is amazing.');
    });
    
    it('should handle sentences ending with quotes', () => {
        const words = ['He', 'said', '"Hello."', 'Then', 'left.'];
        const sentences = splitIntoSentences(words);
        
        expect(sentences).toHaveLength(2);
        expect(sentences[0].text).toBe('He said "Hello."');
        expect(sentences[1].text).toBe('Then left.');
    });
    
    it('should handle empty input', () => {
        const sentences = splitIntoSentences([]);
        expect(sentences).toHaveLength(0);
    });
    
    it('should handle single word', () => {
        const sentences = splitIntoSentences(['Hello']);
        expect(sentences).toHaveLength(1);
        expect(sentences[0].text).toBe('Hello');
    });
    
    it('should handle text without sentence-ending punctuation', () => {
        const words = ['This', 'has', 'no', 'ending'];
        const sentences = splitIntoSentences(words);
        
        expect(sentences).toHaveLength(1);
        expect(sentences[0].startWordIndex).toBe(0);
        expect(sentences[0].endWordIndex).toBe(3);
    });
    
    it('should break long sentences at 50 words', () => {
        // Create 60 words without punctuation
        const words = Array(60).fill('word');
        const sentences = splitIntoSentences(words);
        
        // Should break into at least 2 sentences
        expect(sentences.length).toBeGreaterThanOrEqual(2);
        expect(sentences[0].endWordIndex - sentences[0].startWordIndex + 1).toBeLessThanOrEqual(50);
    });
    
    it('should maintain correct word indices across sentences', () => {
        const words = ['First.', 'Second.', 'Third.'];
        const sentences = splitIntoSentences(words);
        
        expect(sentences).toHaveLength(3);
        expect(sentences[0].startWordIndex).toBe(0);
        expect(sentences[0].endWordIndex).toBe(0);
        expect(sentences[1].startWordIndex).toBe(1);
        expect(sentences[1].endWordIndex).toBe(1);
        expect(sentences[2].startWordIndex).toBe(2);
        expect(sentences[2].endWordIndex).toBe(2);
    });
});

describe('findSentenceForWord', () => {
    const sentences: SentenceBoundary[] = [
        { index: 0, text: 'First sentence.', startWordIndex: 0, endWordIndex: 1 },
        { index: 1, text: 'Second sentence.', startWordIndex: 2, endWordIndex: 3 },
        { index: 2, text: 'Third sentence.', startWordIndex: 4, endWordIndex: 5 },
    ];
    
    it('should find sentence for word at start', () => {
        const result = findSentenceForWord(0, sentences);
        expect(result?.index).toBe(0);
    });
    
    it('should find sentence for word in middle', () => {
        const result = findSentenceForWord(3, sentences);
        expect(result?.index).toBe(1);
    });
    
    it('should find sentence for word at end', () => {
        const result = findSentenceForWord(5, sentences);
        expect(result?.index).toBe(2);
    });
    
    it('should return null for out-of-range word index', () => {
        const result = findSentenceForWord(10, sentences);
        expect(result).toBeNull();
    });
    
    it('should return null for negative word index', () => {
        const result = findSentenceForWord(-1, sentences);
        expect(result).toBeNull();
    });
    
    it('should return null for empty sentences array', () => {
        const result = findSentenceForWord(0, []);
        expect(result).toBeNull();
    });
});

describe('estimateAudioTimeForWord', () => {
    it('should interpolate based on total duration when no audio times set', () => {
        const sentences: SentenceBoundary[] = [
            { index: 0, text: 'Test', startWordIndex: 0, endWordIndex: 9 },
        ];
        
        // Word 5 out of 10 words (indices 0-9), endWordIndex is 9
        const time = estimateAudioTimeForWord(5, sentences, 10);
        // Linear: (5/9) * 10 ≈ 5.56
        expect(time).toBeCloseTo(5.56, 1);
    });
    
    it('should use audio times when available', () => {
        const sentences: SentenceBoundary[] = [
            { index: 0, text: 'First.', startWordIndex: 0, endWordIndex: 1, audioStartTime: 0, audioEndTime: 2 },
            { index: 1, text: 'Second.', startWordIndex: 2, endWordIndex: 3, audioStartTime: 2, audioEndTime: 4 },
        ];
        
        // Word 2 is at start of second sentence
        const time = estimateAudioTimeForWord(2, sentences, 4);
        expect(time).toBe(2);
    });
    
    it('should interpolate within a sentence', () => {
        const sentences: SentenceBoundary[] = [
            { index: 0, text: 'Word1 Word2 Word3 Word4.', startWordIndex: 0, endWordIndex: 3, audioStartTime: 0, audioEndTime: 4 },
        ];
        
        // Word 1 (second word) should be at 25% into the sentence
        const time = estimateAudioTimeForWord(1, sentences, 4);
        expect(time).toBe(1); // 0 + (1/4) * 4 = 1
    });
});

describe('findWordForAudioTime', () => {
    const sentences: SentenceBoundary[] = [
        { index: 0, text: 'First.', startWordIndex: 0, endWordIndex: 1, audioStartTime: 0, audioEndTime: 2 },
        { index: 1, text: 'Second.', startWordIndex: 2, endWordIndex: 3, audioStartTime: 2, audioEndTime: 4 },
        { index: 2, text: 'Third.', startWordIndex: 4, endWordIndex: 5, audioStartTime: 4, audioEndTime: 6 },
    ];
    
    it('should find word at start', () => {
        const wordIndex = findWordForAudioTime(0, sentences);
        expect(wordIndex).toBe(0);
    });
    
    it('should find word in middle of sentence', () => {
        const wordIndex = findWordForAudioTime(1, sentences);
        // At time 1, we're 50% into first sentence (0-2s, words 0-1)
        // Progress = 1/2 = 0.5, wordCount = 2, offset = floor(0.5 * 2) = 1
        expect(wordIndex).toBe(1);
    });
    
    it('should find word at sentence boundary', () => {
        // At time 2, we're at the boundary - could be end of first or start of second
        // The function matches [audioStartTime, audioEndTime] inclusive
        // Time 2 falls within first sentence (0-2) AND second sentence (2-4)
        // Since first sentence is checked first and matches, it returns word 1
        const wordIndex = findWordForAudioTime(2, sentences);
        expect(wordIndex).toBe(1); // End of first sentence
    });
    
    it('should handle time beyond all sentences', () => {
        const wordIndex = findWordForAudioTime(10, sentences);
        // Should return end of last sentence
        expect(wordIndex).toBe(5);
    });
    
    it('should return 0 for empty sentences', () => {
        const wordIndex = findWordForAudioTime(5, []);
        expect(wordIndex).toBe(0);
    });
    
    it('should handle sentences without audio times', () => {
        const noAudioSentences: SentenceBoundary[] = [
            { index: 0, text: 'Test', startWordIndex: 0, endWordIndex: 5 },
        ];
        const wordIndex = findWordForAudioTime(2, noAudioSentences);
        expect(wordIndex).toBe(0); // Falls back to first sentence
    });
});

describe('Voice utilities', () => {
    describe('listVoices', () => {
        it('should return array of voices', () => {
            const voices = listVoices();
            expect(Array.isArray(voices)).toBe(true);
            expect(voices.length).toBeGreaterThan(0);
        });
        
        it('should include default voice', () => {
            const voices = listVoices();
            const defaultVoice = voices.find(v => v.id === DEFAULT_VOICE);
            expect(defaultVoice).toBeDefined();
        });
        
        it('should have required properties on each voice', () => {
            const voices = listVoices();
            for (const voice of voices) {
                expect(voice).toHaveProperty('id');
                expect(voice).toHaveProperty('name');
                expect(voice).toHaveProperty('gender');
                // Note: language may not be present on all voices
            }
        });
    });
    
    describe('getVoice', () => {
        it('should return voice for valid ID', () => {
            const voice = getVoice(DEFAULT_VOICE);
            expect(voice).toBeDefined();
            expect(voice?.id).toBe(DEFAULT_VOICE);
        });
        
        it('should return undefined for invalid ID', () => {
            const voice = getVoice('invalid-voice-id');
            expect(voice).toBeUndefined();
        });
    });

    describe('resolveVoiceId', () => {
        it('keeps a current English voice', () => {
            expect(resolveVoiceId('bf_emma')).toBe('bf_emma');
        });

        it('replaces an unknown legacy voice with the English default', () => {
            expect(resolveVoiceId('zf_xiaobei')).toBe(DEFAULT_VOICE);
        });
    });
    
    describe('VOICES constant', () => {
        it('should be a non-empty array', () => {
            expect(Array.isArray(VOICES)).toBe(true);
            expect(VOICES.length).toBeGreaterThan(0);
        });
    });
});

describe('resolveTTSRuntimeConfig', () => {
    it('falls back to wasm for auto-selected webgpu + q8', () => {
        const runtime = resolveTTSRuntimeConfig('q8', undefined, 'webgpu');
        expect(runtime).toEqual({
            dtype: 'q8',
            device: 'wasm',
            compatibilityMode: true,
        });
    });

    it('keeps explicit device requests unchanged', () => {
        const runtime = resolveTTSRuntimeConfig('q8', 'webgpu', 'webgpu');
        expect(runtime).toEqual({
            dtype: 'q8',
            device: 'webgpu',
            compatibilityMode: false,
        });
    });

    it('keeps auto-selected wasm unchanged', () => {
        const runtime = resolveTTSRuntimeConfig('q8', undefined, 'wasm');
        expect(runtime).toEqual({
            dtype: 'q8',
            device: 'wasm',
            compatibilityMode: false,
        });
    });
});

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
