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
 * Check if a token is a standalone dash.
 */
export const isStandaloneDash = (token: string): boolean => {
    const trimmed = token.trim();
    return STANDALONE_DASHES.includes(trimmed) || /^--+$/.test(trimmed);
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
 * Tokenize a single word, extracting embedded dashes as separate tokens.
 * 
 * Examples:
 *   "perhaps—I" → ["perhaps", "—", "I"]
 *   "word——word" → ["word", "——", "word"]
 *   "hello--world" → ["hello", "--", "world"]
 *   "end—" → ["end", "—"]
 *   "—start" → ["—", "start"]
 *   "normal" → ["normal"]
 *   "self-aware" → ["self-aware"] (hyphen is not a dash)
 * 
 * @param word - A single word that may contain embedded dashes
 * @returns Array of tokens (word parts and dashes)
 */
export const tokenizeWord = (word: string): string[] => {
    if (!word || word.trim().length === 0) {
        return [];
    }

    // Check if the word contains any dash characters we care about
    if (!DASH_PATTERN.test(word)) {
        return [word];
    }

    // Reset regex state (it's global)
    DASH_PATTERN.lastIndex = 0;

    const tokens: string[] = [];
    let lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = DASH_PATTERN.exec(word)) !== null) {
        // Add text before the dash (if any)
        const before = word.slice(lastIndex, match.index);
        if (before.length > 0) {
            tokens.push(before);
        }

        // Add the dash itself
        tokens.push(match[0]);

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text after the last dash (if any)
    const after = word.slice(lastIndex);
    if (after.length > 0) {
        tokens.push(after);
    }

    // Filter out empty tokens and return
    return tokens.filter(t => t.length > 0);
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
 */
export interface TokenDisplayProps {
    /** Whether this is a pause token (dash) */
    isPause: boolean;
    /** Suggested additional display time multiplier (1.0 = normal) */
    displayTimeMultiplier: number;
    /** Whether to render with bionic styling */
    useBionicRendering: boolean;
    /** Custom CSS class for special tokens */
    cssClass?: string;
}

export const getTokenDisplayProps = (token: string): TokenDisplayProps => {
    if (isPauseToken(token)) {
        return {
            isPause: true,
            // Dashes should pause longer - they represent cognitive gaps
            displayTimeMultiplier: 1.5,
            // Dashes don't need bionic rendering (they're already simple)
            useBionicRendering: false,
            cssClass: 'rsvp-pause-token',
        };
    }

    return {
        isPause: false,
        displayTimeMultiplier: 1.0,
        useBionicRendering: true,
        cssClass: undefined,
    };
};
