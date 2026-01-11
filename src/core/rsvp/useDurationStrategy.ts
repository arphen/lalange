/**
 * useDurationStrategy Hook
 * 
 * React hook for managing duration strategy lifecycle and providing
 * sentence-level preparation utilities.
 */

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '../store/settings';
import { 
    createDurationStrategy, 
    type DurationStrategy, 
    type DurationContext,
    type WordMeta,
    type DurationResult
} from './duration';
import { isPauseToken } from './tokenize';

/**
 * Punctuation detection utilities.
 */
const SENTENCE_END_CHARS = ['.', '!', '?'];
const SENTENCE_END_PAIRS = ['."', '!"', '?"', '."', '!"', '?"'];
const CLAUSE_END_CHARS = [';', ':'];
const PAUSE_CHARS = [',', '—', '-', '–'];

const detectPunctuation = (word: string) => {
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);
    
    return {
        isSentenceEnd: SENTENCE_END_CHARS.includes(lastChar) || 
                       SENTENCE_END_PAIRS.some(p => lastTwoChars.endsWith(p)),
        isClauseEnd: CLAUSE_END_CHARS.includes(lastChar),
        isPause: PAUSE_CHARS.includes(lastChar),
        // Standalone dash tokens (em-dash, en-dash) extracted by tokenizer
        isDashToken: isPauseToken(word),
    };
};

/**
 * Split words into sentences based on sentence-ending punctuation.
 * Returns array of { startIndex, words, densities } for each sentence.
 */
export const splitIntoSentences = (
    words: string[], 
    densities: number[]
): Array<{ startIndex: number; words: string[]; densities: number[] }> => {
    const sentences: Array<{ startIndex: number; words: string[]; densities: number[] }> = [];
    let currentSentence: { startIndex: number; words: string[]; densities: number[] } = {
        startIndex: 0,
        words: [],
        densities: [],
    };

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const density = densities[i] ?? 1.0;
        
        currentSentence.words.push(word);
        currentSentence.densities.push(density);

        const { isSentenceEnd } = detectPunctuation(word);
        
        if (isSentenceEnd || i === words.length - 1) {
            sentences.push(currentSentence);
            currentSentence = {
                startIndex: i + 1,
                words: [],
                densities: [],
            };
        }
    }

    return sentences;
};

interface UseDurationStrategyOptions {
    /** Override WPM (defaults to settings store) */
    wpm?: number;
    /** Physiological floor in ms */
    tFloor?: number;
}

interface UseDurationStrategyResult {
    /** Calculate duration for a word at given index */
    getDuration: (wordIndex: number, words: string[], densities: number[]) => DurationResult;
    /** Prepare a sentence for strategies that need lookahead */
    prepareSentence: (words: string[], densities: number[]) => void;
    /** Reset strategy state (call on chapter change) */
    reset: () => void;
    /** Current strategy instance */
    strategy: DurationStrategy;
    /** Duration context being used */
    context: DurationContext;
}

/**
 * Hook for using duration strategies in the Reader component.
 * 
 * Handles strategy lifecycle, sentence detection, and provides
 * a simple interface for getting word durations.
 */
export const useDurationStrategy = (
    options: UseDurationStrategyOptions = {}
): UseDurationStrategyResult => {
    const { tFloor = 75 } = options;
    
    const durationStrategyId = useSettingsStore(s => s.durationStrategy);
    const settingsWpm = useSettingsStore(s => s.wpm);
    const wpm = options.wpm ?? settingsWpm;

    // Memoize strategy instance
    const strategyRef = useRef<DurationStrategy | null>(null);
    
    const strategy = useMemo(() => {
        return createDurationStrategy(durationStrategyId);
    }, [durationStrategyId]);

    useEffect(() => {
        strategyRef.current = strategy;
    }, [strategy]);

    // Reset when strategy changes
    useEffect(() => {
        return () => {
            strategyRef.current?.reset?.();
        };
    }, [durationStrategyId]);

    const context: DurationContext = useMemo(() => ({
        wpm,
        tFloor,
    }), [wpm, tFloor]);

    // Track current sentence boundaries
    const sentenceCacheRef = useRef<{
        words: string[];
        densities: number[];
        boundaries: Array<{ start: number; end: number }>;
    }>({ words: [], densities: [], boundaries: [] });

    /**
     * Rebuild sentence boundaries when words/densities change.
     */
    const rebuildSentenceBoundaries = useCallback((words: string[], densities: number[]) => {
        const cache = sentenceCacheRef.current;
        
        // Quick check if we need to rebuild
        if (cache.words === words && cache.densities === densities) {
            return;
        }

        const boundaries: Array<{ start: number; end: number }> = [];
        let sentenceStart = 0;

        for (let i = 0; i < words.length; i++) {
            const { isSentenceEnd } = detectPunctuation(words[i]);
            if (isSentenceEnd || i === words.length - 1) {
                boundaries.push({ start: sentenceStart, end: i });
                sentenceStart = i + 1;
            }
        }

        sentenceCacheRef.current = { words, densities, boundaries };
    }, []);

    /**
     * Prepare a sentence for the current strategy.
     */
    const prepareSentence = useCallback((words: string[], densities: number[]) => {
        strategy.prepareSentence?.(words, densities, context);
    }, [strategy, context]);

    /**
     * Get duration for a word at a given index.
     * Automatically detects sentence boundaries and prepares as needed.
     */
    const getDuration = useCallback((
        wordIndex: number,
        words: string[],
        densities: number[]
    ): DurationResult => {
        // Rebuild sentence cache if needed
        rebuildSentenceBoundaries(words, densities);
        
        const { boundaries } = sentenceCacheRef.current;
        
        // Find which sentence this word belongs to
        const sentenceBoundary = boundaries.find(
            b => wordIndex >= b.start && wordIndex <= b.end
        );

        if (sentenceBoundary && strategy.prepareSentence) {
            const sentenceWords = words.slice(sentenceBoundary.start, sentenceBoundary.end + 1);
            const sentenceDensities = densities.slice(sentenceBoundary.start, sentenceBoundary.end + 1);
            
            // Prepare sentence (strategy will cache and skip if already prepared)
            strategy.prepareSentence(sentenceWords, sentenceDensities, context);
        }

        const word = words[wordIndex];
        const density = densities[wordIndex] ?? 1.0;
        const { isSentenceEnd, isClauseEnd, isPause, isDashToken } = detectPunctuation(word);
        
        // Calculate sentence-relative index
        const sentenceStartIndex = sentenceBoundary?.start ?? 0;
        const sentenceLength = sentenceBoundary 
            ? sentenceBoundary.end - sentenceBoundary.start + 1 
            : words.length;

        const meta: WordMeta = {
            word,
            sentenceIndex: wordIndex - sentenceStartIndex,
            sentenceLength,
            density,
            isSentenceEnd,
            isClauseEnd,
            isPause,
            isDashToken,
        };

        return strategy.calculateDuration(meta, context);
    }, [strategy, context, rebuildSentenceBoundaries]);

    const reset = useCallback(() => {
        strategy.reset?.();
        sentenceCacheRef.current = { words: [], densities: [], boundaries: [] };
    }, [strategy]);

    return {
        getDuration,
        prepareSentence,
        reset,
        strategy,
        context,
    };
};
