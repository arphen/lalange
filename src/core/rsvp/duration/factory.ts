/**
 * Duration Strategy Factory
 * 
 * Factory for creating duration strategy instances.
 * Provides a central point for strategy registration and instantiation.
 */

import type { DurationStrategy, DurationStrategyId } from './types';
import { createLegacyStrategy } from './legacy';
import { createSentenceBudgetStrategy } from './sentence-budget';
import { createConstantStrategy } from './constant';

/**
 * Registry of available strategy factories.
 */
const strategyFactories: Record<DurationStrategyId, () => DurationStrategy> = {
    'legacy': createLegacyStrategy,
    'sentence-budget': createSentenceBudgetStrategy,
    'constant': createConstantStrategy,
};

/**
 * Create a duration strategy by ID.
 * 
 * @param id - The strategy identifier
 * @returns A new strategy instance
 * @throws Error if the strategy ID is unknown
 */
export const createDurationStrategy = (id: DurationStrategyId): DurationStrategy => {
    const factory = strategyFactories[id];
    if (!factory) {
        throw new Error(`Unknown duration strategy: ${id}`);
    }
    return factory();
};

/**
 * Get all available strategy IDs with their metadata.
 */
export const getAvailableStrategies = (): Array<{
    id: DurationStrategyId;
    name: string;
    description: string;
}> => {
    return Object.keys(strategyFactories).map(id => {
        const strategy = strategyFactories[id as DurationStrategyId]();
        return {
            id: strategy.id,
            name: strategy.name,
            description: strategy.description,
        };
    });
};

/**
 * Default strategy ID when none is specified.
 */
export const DEFAULT_STRATEGY_ID: DurationStrategyId = 'legacy';
