/**
 * Constant Duration Strategy
 * 
 * Fixed duration per word regardless of complexity.
 * Useful for debugging, testing, and as a baseline comparison.
 */

import type { 
    DurationStrategy, 
    WordMeta, 
    DurationContext, 
    DurationResult,
    DurationStrategyId
} from './types';

/**
 * Constant duration strategy - ignores all cognitive factors.
 * Simply calculates duration from WPM with a floor constraint.
 */
export class ConstantDurationStrategy implements DurationStrategy {
    readonly id: DurationStrategyId = 'constant';
    readonly name = 'Constant (Debug)';
    readonly description = 'Fixed duration per word based purely on WPM setting. ' +
        'Ignores surprisal, punctuation, and word length. For testing only.';

    calculateDuration(_meta: WordMeta, context: DurationContext): DurationResult {
        const { wpm, tFloor } = context;

        // Simple: 60000ms / wpm = ms per word
        const baseInterval = 60000 / wpm;
        const duration = Math.max(tFloor, baseInterval);

        return {
            duration,
            breakdown: {
                base: duration,
                info: 0,
                visual: 0,
                punctuation: 0,
            }
        };
    }
}

/**
 * Create a new constant duration strategy instance.
 */
export const createConstantStrategy = (): DurationStrategy => new ConstantDurationStrategy();
