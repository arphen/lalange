/**
 * Duration Strategy System
 * 
 * A polymorphic factory-style system for determining RSVP word display durations.
 * Allows switching between different algorithms to balance WPM targets with 
 * cognitive load factors like surprisal and punctuation.
 */

/**
 * Metadata for a single word in the RSVP stream.
 */
export interface WordMeta {
    /** The word text */
    word: string;
    /** Index within the current sentence (0-based) */
    sentenceIndex: number;
    /** Total words in the current sentence */
    sentenceLength: number;
    /** Density factor from LLM analysis (surprisal-based, ~1.0 = normal) */
    density: number;
    /** Whether this word ends a sentence (ends with . ! ?) */
    isSentenceEnd: boolean;
    /** Whether this word contains clause-ending punctuation (; :) */
    isClauseEnd: boolean;
    /** Whether this word contains pause punctuation (, — -) */
    isPause: boolean;
    /** Whether this token is a standalone dash (em-dash, en-dash) - deserves its own display moment */
    isDashToken: boolean;
}

/**
 * Context for duration calculation, provided once per playback session.
 */
export interface DurationContext {
    /** User's target words per minute setting */
    wpm: number;
    /** Physiological floor (minimum time for retinal integration) in ms */
    tFloor: number;
}

/**
 * Result from a duration strategy calculation.
 */
export interface DurationResult {
    /** Calculated display duration in milliseconds */
    duration: number;
    /** Optional debug info for telemetry/visualization */
    breakdown?: {
        base: number;
        info: number;
        visual: number;
        punctuation: number;
        budget?: number;
    };
}

/**
 * A duration strategy calculates how long each word should be displayed.
 * 
 * Strategies can operate word-by-word (legacy) or sentence-by-sentence (budgeting).
 */
export interface DurationStrategy {
    /** Unique identifier for this strategy */
    readonly id: DurationStrategyId;
    /** Human-readable name */
    readonly name: string;
    /** Description for settings UI */
    readonly description: string;
    
    /**
     * Calculate the display duration for a single word.
     * 
     * @param meta - Metadata about the current word
     * @param context - Global playback context (WPM, floor)
     * @returns Duration result with calculated milliseconds
     */
    calculateDuration(meta: WordMeta, context: DurationContext): DurationResult;
    
    /**
     * Optional: Pre-process a sentence to compute budgets or other lookahead data.
     * Called once when a new sentence begins.
     * 
     * @param words - All words in the upcoming sentence
     * @param densities - Density values for each word
     * @param context - Global playback context
     */
    prepareSentence?(words: string[], densities: number[], context: DurationContext): void;
    
    /**
     * Optional: Reset any internal state (e.g., sentence budgets).
     * Called when playback is stopped or chapter changes.
     */
    reset?(): void;
}

/**
 * Available duration strategy identifiers.
 */
export type DurationStrategyId = 
    | 'legacy'           // Original per-word calculation with additive delays
    | 'sentence-budget'  // Sentence-level budgeting with weighted distribution
    | 'constant';        // Fixed duration per word (for testing/debugging)
