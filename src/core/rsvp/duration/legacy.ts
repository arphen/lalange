/**
 * Legacy Duration Strategy
 * 
 * The original strategy identifier, updated to use a speed-relative cadence.
 * Punctuation, visual complexity, and surprisal adjust the base interval
 * without stacking large fixed delays on every word.
 * 
 * Formula: T_display = max(T_floor, baseInterval * cadenceWeight)
 * 
 * This keeps timing differences perceptible while preventing punctuation and
 * density from dominating the rhythm at high WPM.
 */

import type { 
    DurationStrategy, 
    WordMeta, 
    DurationContext, 
    DurationResult 
} from './types';
import { calculateTargetTiming, isLikelyProperNoun as detectLikelyProperNoun } from '../timing';

/**
 * Delay for standalone dash tokens.
 * 
 * From a psychoanalytic perspective, the dash is the signifier of absence—
 * it marks a cognitive pause, a moment of suspension where meaning is
 * organized by what is NOT said. We honor this with significant pause time.
 */
const DASH_TOKEN_DELAY = 400; // ms - significant pause for cognitive gap

/**
 * Delay for hyphenated word parts (e.g., "self-" in "self-aware").
 * These need a pause to process the compound construction.
 */
const HYPHEN_PART_DELAY = 150; // ms - pause before continuation

/**
 * Delay for slash parts (e.g., "and/" in "and/or").
 * Similar to hyphens, marks an alternative construction.
 */
const SLASH_PART_DELAY = 150; // ms - pause for alternative

/**
 * Threshold for extra long word penalty (characters).
 */
const LONG_WORD_THRESHOLD = 10;

/**
 * Extra milliseconds per character beyond the threshold.
 */
const LONG_WORD_MS_PER_CHAR = 15;

export const isLikelyProperNoun = (word: string, sentenceIndex: number): boolean => {
    return sentenceIndex > 0 && detectLikelyProperNoun(word, 'previous');
};

/**
 * Calculate visual processing delay based on word characteristics.
 * Includes punctuation penalties and length-based visual gain.
 * 
 * This is extracted from the original timing.ts logic.
 */
export const calculateVisualDelay = (word: string, isDashToken: boolean = false): number => {
    // Standalone dash tokens get special treatment
    if (isDashToken) {
        return DASH_TOKEN_DELAY;
    }
    
    // Check for hyphenated parts (e.g., "self-")
    if (word.endsWith('-') && word.length > 1) {
        // Add hyphen delay plus normal visual processing
        return HYPHEN_PART_DELAY + 25 * Math.sqrt(word.length);
    }
    
    // Check for slash parts (e.g., "and/")
    if (word.endsWith('/') && word.length > 1) {
        // Add slash delay plus normal visual processing
        return SLASH_PART_DELAY + 25 * Math.sqrt(word.length);
    }

    let delay = 0;
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);

    // Punctuation Penalties (Wrap-up time)
    // Values derived from "RSVP App Design_ Patents & Cognition.md"
    if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
        delay += 300; // Period/Sentence End: +300ms
    } else if ([';', ':'].includes(lastChar)) {
        delay += 200; // Clause End: +200ms
    } else if ([',', '—', '-'].includes(lastChar)) {
        delay += 150; // Pause: +150ms
    }

    // Visual Gain (Length Penalty)
    // Formula: 25ms * sqrt(length)
    const lengthPenalty = 25 * Math.sqrt(word.length);
    delay += lengthPenalty;
    
    // Extra penalty for very long words (like "phenomenology")
    // Strip punctuation for length calculation
    const strippedWord = word.replace(/[^\w]/g, '');
    const extraChars = Math.max(0, strippedWord.length - LONG_WORD_THRESHOLD);
    if (extraChars > 0) {
        delay += extraChars * LONG_WORD_MS_PER_CHAR;
    }

    return delay;
};

/**
 * Legacy duration strategy - the original additive approach.
 * 
 * Characteristics:
 * - Always adds time for cognitive load, never subtracts
 * - Results in effective WPM lower than dial setting
 * - Simple and predictable behavior
 * - No sentence-level lookahead
 * - Standalone dash tokens get significant pause time
 */
export class LegacyDurationStrategy implements DurationStrategy {
    readonly id = 'legacy' as const;
    readonly name = 'Adaptive Cadence';
    readonly description = 'Smooth, speed-relative timing with extra space for punctuation, ' +
        'complex words, and likely names.';

    calculateDuration(meta: WordMeta, context: DurationContext): DurationResult {
        const { wpm, tFloor } = context;
        const { word, density, isDashToken, sentenceIndex } = meta;
        const timing = calculateTargetTiming(word, density, wpm, {
            isLikelyProperNoun: isLikelyProperNoun(word, sentenceIndex),
            minimumDisplayMs: tFloor,
        });

        return {
            duration: timing.duration,
            breakdown: {
                base: Math.min(timing.duration, timing.baseInterval),
                info: isDashToken ? 0 : timing.infoTime,
                visual: timing.properNounTime + timing.tokenAdjustmentTime,
                punctuation: timing.punctuationTime,
            }
        };
    }
}

/**
 * Create a new legacy duration strategy instance.
 */
export const createLegacyStrategy = (): DurationStrategy => new LegacyDurationStrategy();
