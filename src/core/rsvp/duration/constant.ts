/**
 * Constant Duration Strategy
 * 
 * Fixed duration per word regardless of complexity.
 * Useful for debugging, testing, and as a baseline comparison.
 * 
 * Note: Dash tokens still get extra time even in constant mode,
 * because they represent essential cognitive pauses.
 */

import type { 
    DurationStrategy, 
    WordMeta, 
    DurationContext, 
    DurationResult,
    DurationStrategyId
} from './types';

/** Extra time multiplier for standalone dash tokens */
const DASH_TOKEN_MULTIPLIER = 1.5;

/**
 * Constant duration strategy - ignores most cognitive factors.
 * Simply calculates duration from WPM with a floor constraint.
 * Dash tokens still get extra time as they mark essential pauses.
 */
export class ConstantDurationStrategy implements DurationStrategy {
    readonly id: DurationStrategyId = 'constant';
    readonly name = 'Constant (Debug)';
    readonly description = 'Fixed duration per word based purely on WPM setting. ' +
        'Ignores surprisal, punctuation, and word length. Dash tokens get 1.5x time.';

    calculateDuration(meta: WordMeta, context: DurationContext): DurationResult {
        const { wpm, tFloor } = context;
        const { isDashToken } = meta;

        // Simple: 60000ms / wpm = ms per word
        const baseInterval = 60000 / wpm;
        
        // Apply dash token multiplier if applicable
        const multiplier = isDashToken ? DASH_TOKEN_MULTIPLIER : 1;
        const duration = Math.max(tFloor, baseInterval * multiplier);

        return {
            duration,
            breakdown: {
                base: duration,
                info: 0,
                visual: isDashToken ? (baseInterval * (DASH_TOKEN_MULTIPLIER - 1)) : 0,
                punctuation: 0,
            }
        };
    }
}

/**
 * Create a new constant duration strategy instance.
 */
export const createConstantStrategy = (): DurationStrategy => new ConstantDurationStrategy();
