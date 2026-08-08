
import { getTokenDisplayProps } from './tokenize';
import type { RsvpFrame } from './phrases/grouping';

const MIN_DENSITY = 0.5;
const MAX_DENSITY = 2;
const DENSITY_INFLUENCE = 0.45;
const SENTENCE_END_WEIGHT = 0.65;
const CLAUSE_END_WEIGHT = 0.4;
const PAUSE_WEIGHT = 0.25;
const PROPER_NOUN_WEIGHT = 0.2;
const MIN_DISPLAY_MS = 75;

const getLexicalWord = (word: string): string =>
    word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’.-]+$/gu, '');

const endsSentence = (word: string): boolean => /[.!?]["'”’)]*$/u.test(word);

export const isLikelyProperNoun = (word: string, previousWord?: string): boolean => {
    if (!previousWord || endsSentence(previousWord)) {
        return false;
    }

    const lexicalWord = getLexicalWord(word);
    return lexicalWord.length > 1 && /^\p{Lu}[\p{L}\p{M}'’.-]*$/u.test(lexicalWord);
};

const getPunctuationWeight = (word: string): number => {
    if (/[.!?]["'”’)]*$/u.test(word)) {
        return SENTENCE_END_WEIGHT;
    }
    if (/[;:]["'”’)]*$/u.test(word)) {
        return CLAUSE_END_WEIGHT;
    }
    if (/,["'”’)]*$/u.test(word)) {
        return PAUSE_WEIGHT;
    }
    return 0;
};

interface TargetIntervalOptions {
    isSegmentedToken?: boolean;
    isLikelyProperNoun?: boolean;
    minimumDisplayMs?: number;
}

export interface TargetTiming {
    duration: number;
    baseInterval: number;
    infoTime: number;
    punctuationTime: number;
    properNounTime: number;
    tokenAdjustmentTime: number;
}

export const calculateTargetTiming = (
    word: string,
    density: number,
    effectiveWpm: number,
    options: TargetIntervalOptions = {},
): TargetTiming => {
    const baseInterval = 60000 / Math.max(1, effectiveWpm);
    const boundedDensity = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, density));
    const densityWeight = 1 + (boundedDensity - 1) * DENSITY_INFLUENCE;
    const punctuationWeight = options.isSegmentedToken ? 0 : getPunctuationWeight(word);
    const properNounWeight = options.isLikelyProperNoun ? PROPER_NOUN_WEIGHT : 0;
    const tokenProps = getTokenDisplayProps(word);
    const tokenMultiplier = options.isSegmentedToken ? 1.15 : tokenProps.displayTimeMultiplier;
    const infoTime = baseInterval * densityWeight;
    const punctuationTime = baseInterval * punctuationWeight;
    const properNounTime = baseInterval * properNounWeight;
    const weightedInterval = infoTime + punctuationTime + properNounTime;
    const flooredInterval = Math.max(options.minimumDisplayMs ?? MIN_DISPLAY_MS, weightedInterval);
    const duration = flooredInterval * tokenMultiplier;

    return {
        duration,
        baseInterval,
        infoTime,
        punctuationTime,
        properNounTime,
        tokenAdjustmentTime: duration - flooredInterval,
    };
};

export const getTargetInterval = (
    word: string,
    density: number,
    effectiveWpm: number,
    options: TargetIntervalOptions = {},
): number => calculateTargetTiming(word, density, effectiveWpm, options).duration;

export const getFrameTargetInterval = (
    frame: RsvpFrame,
    densities: readonly number[],
    previousSourceToken: string | undefined,
    effectiveWpm: number,
): number => {
    const getEffectiveDensity = (index: number): number => {
        const density = densities[index];
        return density !== undefined && density > 0 ? density : 1;
    };
    const firstDensity = getEffectiveDensity(frame.startIndex);
    if (frame.sourceWordCount === 1) {
        return getTargetInterval(frame.tokens[0] ?? '', firstDensity, effectiveWpm, {
            isLikelyProperNoun: isLikelyProperNoun(frame.tokens[0] ?? '', previousSourceToken),
        });
    }

    return frame.tokens.reduce((total, token, offset) => {
        const previousToken = offset === 0 ? previousSourceToken : frame.tokens[offset - 1];
        const timing = calculateTargetTiming(token, getEffectiveDensity(frame.startIndex + offset), effectiveWpm, {
            isLikelyProperNoun: isLikelyProperNoun(token, previousToken),
        });
        const lexicalTime = timing.duration - timing.punctuationTime;
        return total + (lexicalTime * 0.75) + timing.punctuationTime;
    }, 0);
};

/**
 * Get visual processing delay for a word.
 * 
 * @param word - The word to calculate delay for
 * @param speedFactor - Optional scaling factor (0-1) based on target WPM.
 *                      At 1.0, full cognitive delays apply (slower reading).
 *                      At 0.0, delays are minimal (speed reading mode).
 *                      Defaults to 1.0 for backward compatibility.
 */
export const getVisualProcessingDelay = (word: string, speedFactor: number = 1.0): number => {
    let delay = 0;
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);

    // Punctuation Penalties (Wrap-up time)
    // Values derived from "RSVP App Design_ Patents & Cognition.md"
    // These are BASE values that get scaled by speedFactor
    if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
        delay += 300; // Period/Sentence End: +300ms base
    }
    else if ([';', ':'].includes(lastChar)) {
        delay += 200; // Clause End: +200ms base
    }
    else if ([',', '—', '-'].includes(lastChar)) {
        delay += 150; // Pause: +150ms base
    }

    // Visual Gain (Length Penalty)
    // Formula: 25ms * sqrt(length) base
    const lengthPenalty = 25 * Math.sqrt(word.length);
    delay += lengthPenalty;

    // Scale all delays by speedFactor
    // At high WPM targets, speedFactor approaches 0, minimizing delays
    return delay * speedFactor;
};

/**
 * Calculate the speed factor based on target WPM.
 * Returns a value between 0.1 and 1.0 that scales cognitive delays.
 * 
 * - At 150 WPM (relaxed reading): factor = 1.0 (full delays)
 * - At 300 WPM (normal speed): factor ≈ 0.5 
 * - At 600+ WPM (speed reading): factor ≈ 0.25
 * - At 1000+ WPM (skimming): factor → 0.1 (minimum)
 * 
 * Uses a logarithmic decay for smooth, perceptually linear scaling.
 */
export const getSpeedFactor = (targetWpm: number): number => {
    // Reference WPM where full delays apply
    const referenceWpm = 150;
    // Minimum factor to prevent zero delays
    const minFactor = 0.1;
    
    if (targetWpm <= referenceWpm) {
        return 1.0;
    }
    
    // Logarithmic decay: factor = 1 / (1 + log2(wpm/reference))
    const ratio = targetWpm / referenceWpm;
    const factor = 1 / (1 + Math.log2(ratio));
    
    return Math.max(minFactor, factor);
};
