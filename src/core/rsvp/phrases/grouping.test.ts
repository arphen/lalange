import { describe, expect, it } from 'vitest';
import {
    COMMON_BIGRAMS,
    COMMON_BIGRAM_RANKS,
    COMMON_NGRAM_RANK_LIMIT,
    COMMON_TRIGRAMS,
    COMMON_TRIGRAM_RANKS,
} from './commonEnglishNgrams';
import { planRsvpFrame, type PhraseRankMaps } from './grouping';

const ranks = (bigrams: string[] = [], trigrams: string[] = []): PhraseRankMaps => ({
    bigrams: new Map(bigrams.map((phrase, rank) => [phrase, rank])),
    trigrams: new Map(trigrams.map((phrase, rank) => [phrase, rank])),
});

describe('planRsvpFrame', () => {
    it('keeps one source token when grouping is off', () => {
        expect(planRsvpFrame(['in', 'the'], 0, {
            phraseRankLimit: 0,
            ranks: ranks(['in the']),
        })).toEqual({
            startIndex: 0,
            sourceWordCount: 1,
            tokens: ['in'],
            displayText: 'in',
        });
    });

    it('applies rank cutoffs at N - 1 and N', () => {
        const phraseRanks = ranks(['in the', 'of a']);
        expect(planRsvpFrame(['in', 'the'], 0, { phraseRankLimit: 1, ranks: phraseRanks }).sourceWordCount).toBe(2);
        expect(planRsvpFrame(['of', 'a'], 0, { phraseRankLimit: 1, ranks: phraseRanks }).sourceWordCount).toBe(1);
    });

    it('prefers an eligible trigram over an overlapping bigram', () => {
        const frame = planRsvpFrame(['one', 'of', 'the'], 0, {
            phraseRankLimit: 10,
            ranks: ranks(['one of'], ['one of the']),
        });

        expect(frame.sourceWordCount).toBe(3);
        expect(frame.displayText).toBe('one of the');
    });

    it('matches sentence-initial capitalization and normalizes apostrophes', () => {
        const frame = planRsvpFrame(['In', 'the'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(["in the"]),
        });
        const possessive = planRsvpFrame(['reader’s', 'mind'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(["reader's mind"]),
        });

        expect(frame.sourceWordCount).toBe(2);
        expect(possessive.sourceWordCount).toBe(2);
    });

    it('preserves source casing, punctuation, and spacing in the display text', () => {
        const frame = planRsvpFrame(['“In', 'the', 'end.”'], 0, {
            phraseRankLimit: 1,
            ranks: ranks([], ['in the end']),
        });

        expect(frame.displayText).toBe('“In the end.”');
    });

    it('rejects internal sentence and clause boundaries', () => {
        expect(planRsvpFrame(['in,', 'the'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(['in the']),
        }).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['in.', 'the'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(['in the']),
        }).sourceWordCount).toBe(1);
    });

    it('rejects pauses, references, continuations, long words, and blocked indexes', () => {
        const options = { phraseRankLimit: 1, ranks: ranks(['in the']) };
        expect(planRsvpFrame(['in', '—'], 0, options).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['in', '[1]'], 0, options).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['in-', 'the'], 0, options).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['characteristically', 'the'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(['characteristically the']),
        }).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['in', 'the'], 0, {
            ...options,
            blockedIndexes: new Set([1]),
        }).sourceWordCount).toBe(1);
    });

    it('caps a candidate at the remaining source length', () => {
        expect(planRsvpFrame(['one', 'of'], 0, {
            phraseRankLimit: 1,
            ranks: ranks([], ['one of the']),
        }).sourceWordCount).toBe(1);
        expect(planRsvpFrame(['in', 'the'], 0, {
            phraseRankLimit: 1,
            ranks: ranks(['in the']),
        }).sourceWordCount).toBe(2);
    });
});

describe('production phrase artifact', () => {
    it('contains the configured ranked lists and synchronized lookup maps', () => {
        expect(COMMON_BIGRAMS).toHaveLength(COMMON_NGRAM_RANK_LIMIT);
        expect(COMMON_TRIGRAMS).toHaveLength(COMMON_NGRAM_RANK_LIMIT);
        expect(COMMON_BIGRAM_RANKS.get('in the')).toBeLessThan(COMMON_NGRAM_RANK_LIMIT);

        COMMON_BIGRAMS.forEach((phrase, rank) => expect(COMMON_BIGRAM_RANKS.get(phrase)).toBe(rank));
        COMMON_TRIGRAMS.forEach((phrase, rank) => expect(COMMON_TRIGRAM_RANKS.get(phrase)).toBe(rank));
    });
});