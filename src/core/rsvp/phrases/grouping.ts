import {
    COMMON_BIGRAM_RANKS,
    COMMON_TRIGRAM_RANKS,
} from './commonEnglishNgrams';
import {
    isHyphenatedPart,
    isPauseToken,
    isReferenceToken,
    isSlashPart,
    splitLongWordForRSVP,
} from '../tokenize';

export interface RsvpFrame {
    startIndex: number;
    sourceWordCount: 1 | 2 | 3;
    tokens: string[];
    displayText: string;
}

export interface PhraseRankMaps {
    bigrams: ReadonlyMap<string, number>;
    trigrams: ReadonlyMap<string, number>;
}

export interface PlanRsvpFrameOptions {
    phraseRankLimit: number;
    blockedIndexes?: ReadonlySet<number>;
    ranks?: PhraseRankMaps;
}

const DEFAULT_RANKS: PhraseRankMaps = {
    bigrams: COMMON_BIGRAM_RANKS,
    trigrams: COMMON_TRIGRAM_RANKS,
};

const LEADING_QUOTE_OR_BRACKET = /^[\s"'`“‘([{]+/u;
const TRAILING_LOOKUP_PUNCTUATION = /[.!?,;:"'”’)}\]]+$/u;
const INTERNAL_BOUNDARY_PUNCTUATION = /[.!?;:,]["'”’)}\]]*$/u;
const NUMERALS_ONLY = /^\p{N}+$/u;
const MALFORMED_OCR_MARKER = /[�]/u;

/** Normalize only the text used for phrase lookup; source tokens remain untouched. */
export const normalizePhraseToken = (token: string): string => token
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘]/gu, "'")
    .replace(LEADING_QUOTE_OR_BRACKET, '')
    .replace(TRAILING_LOOKUP_PUNCTUATION, '');

export const normalizePhrase = (tokens: readonly string[]): string => tokens
    .map(normalizePhraseToken)
    .join(' ')
    .trim();

const isEligibleToken = (token: string): boolean => {
    const normalized = normalizePhraseToken(token);
    if (!normalized || !/\p{L}/u.test(normalized)) return false;
    if (NUMERALS_ONLY.test(normalized) || MALFORMED_OCR_MARKER.test(token)) return false;
    if (isReferenceToken(token) || isPauseToken(token) || isHyphenatedPart(token) || isSlashPart(token)) {
        return false;
    }

    const lexicalCharacters = Array.from(normalized).filter((character) => /[\p{L}\p{N}'-]/u.test(character));
    if (lexicalCharacters.length === 0 || lexicalCharacters.length > 12) return false;

    return splitLongWordForRSVP(token, {
        minLength: 12,
        maxSegmentLength: 8,
    }).length === 1;
};

const candidateIsUsable = (
    words: readonly string[],
    startIndex: number,
    count: 2 | 3,
    rankLimit: number,
    rankMap: ReadonlyMap<string, number>,
    blockedIndexes: ReadonlySet<number>,
): boolean => {
    if (rankLimit <= 0 || startIndex + count > words.length) return false;

    const tokens = words.slice(startIndex, startIndex + count);
    if (tokens.some((token, offset) => (
        !isEligibleToken(token)
        || blockedIndexes.has(startIndex + offset)
        || (offset < tokens.length - 1 && INTERNAL_BOUNDARY_PUNCTUATION.test(token))
    ))) {
        return false;
    }

    const normalizedPhrase = normalizePhrase(tokens);
    if (!normalizedPhrase || normalizedPhrase.length > 24) return false;

    const rank = rankMap.get(normalizedPhrase);
    return rank !== undefined && rank < rankLimit;
};

export const planRsvpFrame = (
    words: readonly string[],
    startIndex: number,
    options: PlanRsvpFrameOptions,
): RsvpFrame => {
    const safeStartIndex = Math.max(0, startIndex);
    const firstToken = words[safeStartIndex] ?? '';
    const blockedIndexes = options.blockedIndexes ?? new Set<number>();
    const ranks = options.ranks ?? DEFAULT_RANKS;
    const phraseRankLimit = Math.max(0, Math.floor(options.phraseRankLimit));

    if (candidateIsUsable(words, safeStartIndex, 3, phraseRankLimit, ranks.trigrams, blockedIndexes)) {
        const tokens = words.slice(safeStartIndex, safeStartIndex + 3);
        return {
            startIndex: safeStartIndex,
            sourceWordCount: 3,
            tokens,
            displayText: tokens.join(' '),
        };
    }

    if (candidateIsUsable(words, safeStartIndex, 2, phraseRankLimit, ranks.bigrams, blockedIndexes)) {
        const tokens = words.slice(safeStartIndex, safeStartIndex + 2);
        return {
            startIndex: safeStartIndex,
            sourceWordCount: 2,
            tokens,
            displayText: tokens.join(' '),
        };
    }

    return {
        startIndex: safeStartIndex,
        sourceWordCount: 1,
        tokens: [firstToken],
        displayText: firstToken,
    };
};