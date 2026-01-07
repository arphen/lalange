
export const getVisualProcessingDelay = (word: string): number => {
    let delay = 0;
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);

    // Punctuation Penalties (Wrap-up time)
    // Values derived from "RSVP App Design_ Patents & Cognition.md"
    if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
        delay += 300; // Period/Sentence End: +300ms
    }
    else if ([';', ':'].includes(lastChar)) {
        delay += 200; // Clause End: +200ms
    }
    else if ([',', '—', '-'].includes(lastChar)) {
        delay += 150; // Pause: +150ms
    }

    // Visual Gain (Length Penalty)
    // Formula: 25ms * sqrt(length)
    const lengthPenalty = 25 * Math.sqrt(word.length);
    delay += lengthPenalty;

    return delay;
};
