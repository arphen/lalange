
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
