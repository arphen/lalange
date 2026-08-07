/**
 * Tests for sentence segmentation and reading/listening position mapping.
 */

import { describe, it, expect } from 'vitest';
import {
    splitIntoSentences,
    findSentenceForWord,
    estimateAudioTimeForWord,
    findWordForAudioTime,
    type SentenceBoundary,
} from './sentences';

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

    it('recognizes terminal punctuation before EPUB closing marks', () => {
        const words = ['She', 'asked,', '“Really?”', 'Then', 'she', 'laughed.)', 'Next.'];
        const sentences = splitIntoSentences(words);

        expect(sentences.map((sentence) => sentence.text)).toEqual([
            'She asked, “Really?”',
            'Then she laughed.)',
            'Next.',
        ]);
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

    it('keeps a normal-length sentence intact past 50 words', () => {
        const words = Array(60).fill('word');
        const sentences = splitIntoSentences(words);

        expect(sentences).toHaveLength(1);
        expect(sentences[0].startWordIndex).toBe(0);
        expect(sentences[0].endWordIndex).toBe(59);
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

    it('ends an unpunctuated utterance at an authored paragraph boundary', () => {
        const words = ['A', 'short', 'heading', 'The', 'paragraph', 'begins', 'here.'];
        const sentences = splitIntoSentences(words, [2]);

        expect(sentences.map((sentence) => sentence.text)).toEqual([
            'A short heading.',
            'The paragraph begins here.',
        ]);
        expect(sentences[0].endWordIndex).toBe(2);
        expect(sentences[1].startWordIndex).toBe(3);
    });

    it('infers the end of a numbered title in flattened EPUB text', () => {
        const words = '3. The Obligation to Give and the Obligation to Receive To appreciate fully the institutions of total prestation and the potlatch we must seek to explain two complementary factors.'.split(' ');
        const sentences = splitIntoSentences(words);

        expect(sentences.map((sentence) => sentence.text)).toEqual([
            '3.',
            'The Obligation to Give and the Obligation to Receive.',
            'To appreciate fully the institutions of total prestation and the potlatch we must seek to explain two complementary factors.',
        ]);
        expect(sentences[1].endWordIndex).toBe(9);
        expect(sentences[2].startWordIndex).toBe(10);
    });

    it('recognizes common non-ASCII terminal punctuation', () => {
        const words = ['Really؟', 'Yes。', 'Again！', 'Why？'];
        const sentences = splitIntoSentences(words);

        expect(sentences.map((sentence) => sentence.text)).toEqual(words);
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
