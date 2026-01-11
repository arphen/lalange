/**
 * Sentence-Level Budgeting Duration Strategy
 * 
 * Treats the WPM setting as a "total time budget" for each sentence.
 * The algorithm "borrows" time from easy words (low surprisal) to "pay" for
 * cognitively expensive punctuation pauses and high-surprisal words.
 * 
 * Key insight: Instead of always adding time for complexity, we redistribute
 * a fixed budget so the average WPM matches the user's dial setting.
 * 
 * Algorithm:
 * 1. Calculate total sentence budget: sentenceLength * (60000 / wpm)
 * 2. Calculate raw weights for each word: density + punctuationWeight
 * 3. Normalize weights so they sum to 1.0
 * 4. Distribute budget proportionally: budget * normalizedWeight
 * 5. Apply floor constraint: each word gets at least tFloor ms
 */

import type { 
    DurationStrategy, 
    WordMeta, 
    DurationContext, 
    DurationResult,
    DurationStrategyId
} from './types';
import { isPauseToken } from '../tokenize';

/**
 * Configuration for the sentence budgeting algorithm.
 */
interface SentenceBudgetConfig {
    /** Weight multiplier for sentence-ending punctuation (. ! ?) */
    sentenceEndWeight: number;
    /** Weight multiplier for clause-ending punctuation (; :) */
    clauseEndWeight: number;
    /** Weight multiplier for pause punctuation (, — -) */
    pauseWeight: number;
    /** Weight multiplier for standalone dash tokens (cognitive gaps) */
    dashTokenWeight: number;
    /** Minimum density floor to prevent words from getting near-zero time */
    minDensityFloor: number;
    /** Factor for visual length penalty (applied to sqrt(length)) */
    lengthFactor: number;
}

const DEFAULT_CONFIG: SentenceBudgetConfig = {
    // These weights represent how much "extra share" punctuation gets
    // A sentence end with weight 2.0 gets twice the allocation of a normal word
    sentenceEndWeight: 2.5,  // ~300ms at 300 WPM (base = 200ms)
    clauseEndWeight: 1.75,   // ~350ms at 300 WPM
    pauseWeight: 1.5,        // ~300ms at 300 WPM
    dashTokenWeight: 2.0,    // Standalone dashes get significant pause weight
    minDensityFloor: 0.3,    // Fastest words still get 30% of average time
    lengthFactor: 0.05,      // Subtle length influence within budget
};

/**
 * Sentence-level budgeting strategy.
 * 
 * Maintains the target WPM by redistributing time within sentences
 * rather than always adding delays.
 */
export class SentenceBudgetStrategy implements DurationStrategy {
    readonly id: DurationStrategyId = 'sentence-budget';
    readonly name = 'Sentence Budgeting';
    readonly description = 'Redistributes time within each sentence to maintain target WPM. ' +
        'Easy words go faster to "pay" for complex words and pauses.';

    private config: SentenceBudgetConfig;
    
    // Pre-computed allocations for the current sentence
    private sentenceAllocations: number[] = [];
    private currentSentenceHash: string = '';

    constructor(config: Partial<SentenceBudgetConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    prepareSentence(words: string[], densities: number[], context: DurationContext): void {
        const sentenceHash = words.join('|');
        
        // Skip if we've already prepared this sentence
        if (sentenceHash === this.currentSentenceHash) {
            return;
        }
        
        this.currentSentenceHash = sentenceHash;
        const { wpm, tFloor } = context;
        const n = words.length;

        if (n === 0) {
            this.sentenceAllocations = [];
            return;
        }

        // Total time budget for this sentence at target WPM
        const baseInterval = 60000 / wpm;
        const totalBudget = n * baseInterval;

        // Calculate raw weights for each word
        const rawWeights: number[] = [];
        
        for (let i = 0; i < n; i++) {
            const word = words[i];
            const density = densities[i] ?? 1.0;
            
            // Check if this is a standalone dash token
            const isDash = isPauseToken(word);
            
            // Dash tokens get their weight from config, not density
            // (they have no semantic content, only cognitive pause)
            if (isDash) {
                rawWeights.push(this.config.dashTokenWeight);
                continue;
            }
            
            // Start with density (surprisal-based), floored to prevent near-zero
            let weight = Math.max(density, this.config.minDensityFloor);
            
            // Add punctuation weights
            const lastChar = word.slice(-1);
            const lastTwoChars = word.slice(-2);
            
            if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
                weight *= this.config.sentenceEndWeight;
            } else if ([';', ':'].includes(lastChar)) {
                weight *= this.config.clauseEndWeight;
            } else if ([',', '—', '-'].includes(lastChar)) {
                weight *= this.config.pauseWeight;
            }
            
            // Subtle length influence (longer words get slightly more time)
            weight += this.config.lengthFactor * Math.sqrt(word.length);
            
            rawWeights.push(weight);
        }

        // Normalize weights
        const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
        const normalizedWeights = rawWeights.map(w => w / totalWeight);

        // Distribute budget with floor constraints
        // Phase 1: Calculate initial allocations
        const allocations = normalizedWeights.map(w => totalBudget * w);
        
        // Phase 2: Apply floor constraints and redistribute excess
        const floorViolations: number[] = [];
        let excessFromFloor = 0;
        
        for (let i = 0; i < n; i++) {
            if (allocations[i] < tFloor) {
                excessFromFloor += tFloor - allocations[i];
                allocations[i] = tFloor;
                floorViolations.push(i);
            }
        }
        
        // Redistribute the excess from floor-constrained words to others
        // proportionally based on their weights (only to non-constrained words)
        if (excessFromFloor > 0) {
            const nonConstrainedIndices = allocations
                .map((_, i) => i)
                .filter(i => !floorViolations.includes(i));
            
            if (nonConstrainedIndices.length > 0) {
                // Take proportionally from non-constrained words
                const nonConstrainedTotalWeight = nonConstrainedIndices
                    .reduce((sum, i) => sum + normalizedWeights[i], 0);
                
                for (const i of nonConstrainedIndices) {
                    const share = normalizedWeights[i] / nonConstrainedTotalWeight;
                    allocations[i] -= excessFromFloor * share;
                    // Re-apply floor if needed (shouldn't happen often)
                    allocations[i] = Math.max(allocations[i], tFloor);
                }
            }
        }

        this.sentenceAllocations = allocations;
    }

    calculateDuration(meta: WordMeta, context: DurationContext): DurationResult {
        const { sentenceIndex, word, density } = meta;
        const { tFloor } = context;

        // If we have a pre-computed allocation, use it
        if (sentenceIndex < this.sentenceAllocations.length) {
            const duration = this.sentenceAllocations[sentenceIndex];
            
            return {
                duration,
                breakdown: {
                    base: tFloor,
                    info: duration * (density / (density + 1)),
                    visual: 0,
                    punctuation: this.getPunctuationContribution(word, duration),
                    budget: this.sentenceAllocations.reduce((a, b) => a + b, 0),
                }
            };
        }

        // Fallback: no pre-computed allocation (shouldn't happen in normal use)
        // Use a simplified calculation
        const baseInterval = 60000 / context.wpm;
        const duration = Math.max(tFloor, baseInterval * density);
        
        return {
            duration,
            breakdown: {
                base: tFloor,
                info: baseInterval * density,
                visual: 0,
                punctuation: 0,
            }
        };
    }

    reset(): void {
        this.sentenceAllocations = [];
        this.currentSentenceHash = '';
    }

    private getPunctuationContribution(word: string, totalDuration: number): number {
        const lastChar = word.slice(-1);
        const lastTwoChars = word.slice(-2);
        
        // Estimate what portion of duration came from punctuation weighting
        if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
            return totalDuration * (1 - 1 / this.config.sentenceEndWeight);
        } else if ([';', ':'].includes(lastChar)) {
            return totalDuration * (1 - 1 / this.config.clauseEndWeight);
        } else if ([',', '—', '-'].includes(lastChar)) {
            return totalDuration * (1 - 1 / this.config.pauseWeight);
        }
        return 0;
    }
}

/**
 * Create a new sentence budget strategy instance.
 */
export const createSentenceBudgetStrategy = (
    config?: Partial<SentenceBudgetConfig>
): DurationStrategy => new SentenceBudgetStrategy(config);
