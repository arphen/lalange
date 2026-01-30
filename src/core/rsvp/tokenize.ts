/**
 * Word Tokenization for RSVP Display
 * 
 * Handles intelligent tokenization of text for Rapid Serial Visual Presentation.
 * The key insight is that certain punctuation marks—particularly dashes—represent
 * significant cognitive pauses that deserve their own moment in the visual stream.
 * 
 * From a psychoanalytic perspective, the dash is the signifier of absence:
 * it marks a gap, a break, a moment where thought suspends. Like the Lacanian
 * concept of the phallus as master signifier, the dash organizes meaning by
 * its very absence—it's what isn't said that structures what is.
 * 
 * When an author writes "perhaps—I would not say it—perhaps", the dashes
 * create a parenthetical aside, a whispered confession, a moment of hesitation.
 * In RSVP, we honor this by giving the dash its own display moment, allowing
 * the reader's mind to register the pause before proceeding.
 * 
 * Similarly, hyphens and slashes create compound constructions that can be
 * impossibly long for RSVP display (e.g., "self-aware", "and/or", 
 * "nineteenth-century-style"). We split these at their natural boundaries,
 * keeping the punctuation attached to the first part to preserve meaning.
 */

/**
 * Dash characters that should be treated as standalone tokens.
 * These represent significant pauses/breaks in thought.
 */
export const STANDALONE_DASHES = [
    '—',  // Em-dash (U+2014) - primary, indicates strong pause
    '–',  // En-dash (U+2013) - secondary, used for ranges but also pauses
    '―',  // Horizontal bar (U+2015) - used in some texts
];

/**
 * Combined dash pattern for splitting.
 * Matches one or more consecutive em-dashes, en-dashes, horizontal bars,
 * or double/triple hyphens. Groups consecutive dashes together.
 */
const DASH_PATTERN = /([—–―]+|--+)/g;

/**
 * Pattern for splitting on hyphens (compound words like "self-aware").
 * Captures the hyphen so we can keep it attached to the preceding word.
 * Only matches single hyphens between word characters.
 */
const HYPHEN_SPLIT_PATTERN = /(\w+-)(?=\w)/g;

/**
 * Pattern for splitting on slashes (alternatives like "and/or").
 * Captures the slash so we can keep it attached to the preceding word.
 */
const SLASH_SPLIT_PATTERN = /(\w+\/)(?=\w)/g;

/**
 * Check if a token is a standalone dash.
 */
export const isStandaloneDash = (token: string): boolean => {
    const trimmed = token.trim();
    return STANDALONE_DASHES.includes(trimmed) || /^--+$/.test(trimmed);
};

/**
 * Check if a token ends with a hyphen (was split from a compound word).
 */
export const isHyphenatedPart = (token: string): boolean => {
    return token.endsWith('-') && token.length > 1;
};

/**
 * Check if a token ends with a slash (was split from an alternative).
 */
export const isSlashPart = (token: string): boolean => {
    return token.endsWith('/') && token.length > 1;
};

/**
 * Result of tokenization with metadata.
 */
export interface TokenizeResult {
    /** The tokenized words */
    tokens: string[];
    /** Metadata about the tokenization */
    metadata: {
        /** Number of dash tokens extracted */
        dashesExtracted: number;
        /** Original word count (before dash extraction) */
        originalWordCount: number;
        /** Final token count */
        finalTokenCount: number;
    };
}

/**
 * Split a word on hyphens, keeping the hyphen attached to the preceding part.
 * 
 * Examples:
 *   "self-aware" → ["self-", "aware"]
 *   "nineteenth-century-style" → ["nineteenth-", "century-", "style"]
 *   "hello" → ["hello"]
 */
const splitOnHyphens = (word: string): string[] => {
    // Only split if there's a hyphen between word characters
    // Use includes() instead of .test() to avoid global regex lastIndex issues
    if (!word.includes('-')) {
        return [word];
    }
    
    // Reset and test the pattern
    HYPHEN_SPLIT_PATTERN.lastIndex = 0;
    if (!HYPHEN_SPLIT_PATTERN.test(word)) {
        return [word];
    }
    
    HYPHEN_SPLIT_PATTERN.lastIndex = 0;
    const parts: string[] = [];
    let lastIndex = 0;
    
    let match: RegExpExecArray | null;
    while ((match = HYPHEN_SPLIT_PATTERN.exec(word)) !== null) {
        // Add the part including the hyphen
        parts.push(match[1]);
        lastIndex = match.index + match[1].length;
    }
    
    // Add remaining text after last hyphen
    const remaining = word.slice(lastIndex);
    if (remaining.length > 0) {
        parts.push(remaining);
    }
    
    return parts.length > 0 ? parts : [word];
};

/**
 * Split a word on slashes, keeping the slash attached to the preceding part.
 * 
 * Examples:
 *   "and/or" → ["and/", "or"]
 *   "yes/no/maybe" → ["yes/", "no/", "maybe"]
 *   "hello" → ["hello"]
 */
const splitOnSlashes = (word: string): string[] => {
    // Only split if there's a slash between word characters
    // Use includes() instead of .test() to avoid global regex lastIndex issues
    if (!word.includes('/')) {
        return [word];
    }
    
    // Reset and test the pattern
    SLASH_SPLIT_PATTERN.lastIndex = 0;
    if (!SLASH_SPLIT_PATTERN.test(word)) {
        return [word];
    }
    
    SLASH_SPLIT_PATTERN.lastIndex = 0;
    const parts: string[] = [];
    let lastIndex = 0;
    
    let match: RegExpExecArray | null;
    while ((match = SLASH_SPLIT_PATTERN.exec(word)) !== null) {
        // Add the part including the slash
        parts.push(match[1]);
        lastIndex = match.index + match[1].length;
    }
    
    // Add remaining text after last slash
    const remaining = word.slice(lastIndex);
    if (remaining.length > 0) {
        parts.push(remaining);
    }
    
    return parts.length > 0 ? parts : [word];
};

/**
 * Tokenize a single word, extracting embedded dashes as separate tokens
 * and splitting on hyphens and slashes for readability.
 * 
 * Examples:
 *   "perhaps—I" → ["perhaps", "—", "I"]
 *   "word——word" → ["word", "——", "word"]
 *   "hello--world" → ["hello", "--", "world"]
 *   "end—" → ["end", "—"]
 *   "—start" → ["—", "start"]
 *   "normal" → ["normal"]
 *   "self-aware" → ["self-", "aware"] (hyphen splits for readability)
 *   "and/or" → ["and/", "or"] (slash splits for readability)
 *   "nineteenth-century-style" → ["nineteenth-", "century-", "style"]
 * 
 * @param word - A single word that may contain embedded dashes, hyphens, or slashes
 * @returns Array of tokens (word parts and dashes)
 */
export const tokenizeWord = (word: string): string[] => {
    if (!word || word.trim().length === 0) {
        return [];
    }

    // First, extract em-dashes/en-dashes as standalone tokens
    let tokens: string[] = [word];
    
    if (DASH_PATTERN.test(word)) {
        // Reset regex state (it's global)
        DASH_PATTERN.lastIndex = 0;

        const newTokens: string[] = [];
        let lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = DASH_PATTERN.exec(word)) !== null) {
            // Add text before the dash (if any)
            const before = word.slice(lastIndex, match.index);
            if (before.length > 0) {
                newTokens.push(before);
            }

            // Add the dash itself
            newTokens.push(match[0]);

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text after the last dash (if any)
        const after = word.slice(lastIndex);
        if (after.length > 0) {
            newTokens.push(after);
        }

        tokens = newTokens.filter(t => t.length > 0);
    }
    
    // Then, split each non-dash token on hyphens and slashes
    const finalTokens: string[] = [];
    for (const token of tokens) {
        if (isStandaloneDash(token)) {
            // Keep dashes as-is
            finalTokens.push(token);
        } else {
            // Split on hyphens first, then slashes
            const hyphenParts = splitOnHyphens(token);
            for (const part of hyphenParts) {
                const slashParts = splitOnSlashes(part);
                finalTokens.push(...slashParts);
            }
        }
    }

    return finalTokens.filter(t => t.length > 0);
};

/**
 * Tokenize text for RSVP display.
 * 
 * This function takes raw text and produces a token stream optimized for
 * rapid serial visual presentation. Key behaviors:
 * 
 * 1. Splits on whitespace (standard word boundaries)
 * 2. Extracts embedded dashes (em-dash, en-dash) as standalone tokens
 * 3. Preserves other punctuation attached to words
 * 4. Handles edge cases (empty strings, multiple dashes, etc.)
 * 
 * The result is a token stream where dashes appear as their own "words",
 * giving them dedicated display time in the RSVP visualization.
 * 
 * @param text - Raw text to tokenize
 * @returns TokenizeResult with tokens and metadata
 */
export const tokenizeForRSVP = (text: string): TokenizeResult => {
    if (!text || text.trim().length === 0) {
        return {
            tokens: [],
            metadata: {
                dashesExtracted: 0,
                originalWordCount: 0,
                finalTokenCount: 0,
            },
        };
    }

    // First, split on whitespace to get initial words
    const initialWords = text.trim().split(/\s+/).filter(w => w.length > 0);
    const originalWordCount = initialWords.length;

    // Then, process each word to extract embedded dashes
    const allTokens: string[] = [];
    let dashesExtracted = 0;

    for (const word of initialWords) {
        const wordTokens = tokenizeWord(word);
        
        // Count how many dash tokens we extracted
        for (const token of wordTokens) {
            if (isStandaloneDash(token)) {
                dashesExtracted++;
            }
        }

        allTokens.push(...wordTokens);
    }

    return {
        tokens: allTokens,
        metadata: {
            dashesExtracted,
            originalWordCount,
            finalTokenCount: allTokens.length,
        },
    };
};

/**
 * Check if a token represents a pause/break (dash or similar).
 * Used by the display logic to apply special rendering.
 */
export const isPauseToken = (token: string): boolean => {
    return isStandaloneDash(token);
};

/**
 * Get display properties for a token.
 * Dashes get special treatment (displayed alone, possibly with visual styling).
 * Hyphenated and slash parts get pause time.
 * Very long words get extra time for visual processing.
 */
export interface TokenDisplayProps {
    /** Whether this is a pause token (dash) */
    isPause: boolean;
    /** Suggested additional display time multiplier (1.0 = normal) */
    displayTimeMultiplier: number;
    /** Whether to render with saccade gradient styling */
    useSaccadeRendering: boolean;
    /** Custom CSS class for special tokens */
    cssClass?: string;
}

/** Threshold for "long word" extra time (characters) */
const LONG_WORD_THRESHOLD = 10;

/** Extra time per character beyond the threshold */
const LONG_WORD_MS_PER_CHAR = 15;

export const getTokenDisplayProps = (token: string): TokenDisplayProps => {
    if (isPauseToken(token)) {
        return {
            isPause: true,
            // Dashes should pause longer - they represent cognitive gaps
            displayTimeMultiplier: 1.5,
            // Dashes don't need saccade rendering (they're already simple)
            useSaccadeRendering: false,
            cssClass: 'rsvp-pause-token',
        };
    }
    
    // Hyphenated parts (e.g., "self-") get a pause after them
    if (isHyphenatedPart(token)) {
        return {
            isPause: false,
            // Slight pause to process the hyphen and anticipate continuation
            displayTimeMultiplier: 1.3,
            useSaccadeRendering: true,
            cssClass: 'rsvp-hyphenated-part',
        };
    }
    
    // Slash parts (e.g., "and/") get similar pause treatment
    if (isSlashPart(token)) {
        return {
            isPause: false,
            // Pause to process the alternative construction
            displayTimeMultiplier: 1.3,
            useSaccadeRendering: true,
            cssClass: 'rsvp-slash-part',
        };
    }

    // Calculate extra time for long words
    // Strip punctuation for length calculation
    const strippedToken = token.replace(/[^\w]/g, '');
    const extraChars = Math.max(0, strippedToken.length - LONG_WORD_THRESHOLD);
    
    if (extraChars > 0) {
        // Add extra time for visual processing of long words
        // This is a multiplier, so we convert ms to a ratio based on typical display time (~200ms)
        const extraMultiplier = 1 + (extraChars * LONG_WORD_MS_PER_CHAR) / 200;
        return {
            isPause: false,
            displayTimeMultiplier: extraMultiplier,
            useSaccadeRendering: true,
            cssClass: undefined,
        };
    }

    return {
        isPause: false,
        displayTimeMultiplier: 1.0,
        useSaccadeRendering: true,
        cssClass: undefined,
    };
};
