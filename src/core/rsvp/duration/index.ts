/**
 * Duration Strategy Module
 * 
 * Polymorphic system for calculating RSVP word display durations.
 * 
 * @example
 * ```typescript
 * import { createDurationStrategy, type DurationContext, type WordMeta } from './duration';
 * 
 * const strategy = createDurationStrategy('sentence-budget');
 * const context: DurationContext = { wpm: 300, tFloor: 75 };
 * 
 * // For sentence-level strategies, prepare the sentence first
 * strategy.prepareSentence?.(words, densities, context);
 * 
 * // Calculate duration for each word
 * const meta: WordMeta = {
 *     word: 'example',
 *     sentenceIndex: 0,
 *     sentenceLength: 5,
 *     density: 1.2,
 *     isSentenceEnd: false,
 *     isClauseEnd: false,
 *     isPause: false,
 * };
 * 
 * const { duration } = strategy.calculateDuration(meta, context);
 * ```
 */

// Types
export type { 
    DurationStrategy,
    DurationStrategyId,
    DurationContext,
    DurationResult,
    WordMeta,
} from './types';

// Factory
export { 
    createDurationStrategy,
    getAvailableStrategies,
    DEFAULT_STRATEGY_ID,
} from './factory';

// Individual strategies (for direct instantiation with custom config)
export { createLegacyStrategy, calculateVisualDelay } from './legacy';
export { createSentenceBudgetStrategy } from './sentence-budget';
export { createConstantStrategy } from './constant';
