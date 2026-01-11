/**
 * Legacy Duration Strategy
 * 
 * The original per-word calculation approach. Uses additive delays for
 * punctuation and visual processing on top of the surprisal-based timing.
 * 
 * Formula: T_display = T_floor + (baseInterval * density) + visualDelay
 * 
 * This approach tends to run slower than the target WPM because every
 * cognitive factor adds time, never subtracts it.
 */

import type { 
    DurationStrategy, 
    WordMeta, 
    DurationContext, 
    DurationResult 
} from './types';

/**
 * Delay for standalone dash tokens.
 * 
 * From a psychoanalytic perspective, the dash is the signifier of absence—
 * it marks a cognitive pause, a moment of suspension where meaning is
 * organized by what is NOT said. We honor this with significant pause time.
 */
const DASH_TOKEN_DELAY = 400; // ms - significant pause for cognitive gap

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
    readonly name = 'Legacy (Additive)';
    readonly description = 'Original per-word calculation. Adds extra time for ' +
        'punctuation and word complexity. Effective WPM will be lower than the dial setting.';

    calculateDuration(meta: WordMeta, context: DurationContext): DurationResult {
        const { wpm, tFloor } = context;
        const { word, density, isDashToken } = meta;

        // Base interval from WPM setting (ms per word at nominal speed)
        const baseInterval = 60000 / wpm;

        // For dash tokens, use minimal info time (they have no semantic content)
        // The pause comes from the visual delay instead
        const infoTime = isDashToken ? 0 : baseInterval * density;

        // Visual & punctuation component (extracted from original timing.ts)
        const visualDelay = calculateVisualDelay(word, isDashToken);

        // Total duration = floor + info + visual
        const duration = tFloor + infoTime + visualDelay;

        return {
            duration,
            breakdown: {
                base: tFloor,
                info: infoTime,
                visual: isDashToken ? DASH_TOKEN_DELAY : visualDelay - this.getPunctuationDelay(word),
                punctuation: isDashToken ? 0 : this.getPunctuationDelay(word),
            }
        };
    }

    private getPunctuationDelay(word: string): number {
        const lastChar = word.slice(-1);
        const lastTwoChars = word.slice(-2);

        if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
            return 300;
        } else if ([';', ':'].includes(lastChar)) {
            return 200;
        } else if ([',', '—', '-'].includes(lastChar)) {
            return 150;
        }
        return 0;
    }
}

/**
 * Create a new legacy duration strategy instance.
 */
export const createLegacyStrategy = (): DurationStrategy => new LegacyDurationStrategy();
