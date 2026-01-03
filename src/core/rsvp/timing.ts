
export const getStructuralDelay = (word: string, baseInterval: number): number => {
    let delay = 0;
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);

    // Strong punctuation (Sentence end)
    if (['.', '!', '?'].includes(lastChar) || ['."', '!"', '?"'].includes(lastTwoChars)) {
        delay += baseInterval * 1.5; // Add 1.5x extra delay (total 2.5x)
    }
    // Medium punctuation (Clause end)
    else if ([';', ':'].includes(lastChar)) {
        delay += baseInterval * 1.0; // Add 1x extra delay (total 2x)
    }
    // Weak punctuation (Pause)
    else if ([',', '—', '-'].includes(lastChar)) {
        delay += baseInterval * 0.5; // Add 0.5x extra delay (total 1.5x)
    }

    // Long Word Rule (> 12 chars)
    if (word.length > 12) {
        delay += baseInterval * 0.5;
    }

    // Hyphenated Word Rule (internal hyphen)
    // We check if it has a hyphen that is NOT the last character
    if (word.includes('-') && !word.endsWith('-')) {
        delay += baseInterval * 0.5;
    }

    return delay;
};
