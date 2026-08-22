import { describe, expect, it } from 'vitest';
import { buildLineWrapProfile, repairLineWraps, repairLineWrapsAcrossSegments, type LineWrapProfile } from './lineWrap';

const EMPTY_PROFILE: LineWrapProfile = { intactTokens: new Set(), hyphenatedTokens: new Set() };

const profileFrom = (...texts: string[]): LineWrapProfile => buildLineWrapProfile(texts);

describe('repairLineWraps', () => {
    it('joins an unattested syllabic wrap by dropping the hyphen (the headline case)', () => {
        const result = repairLineWraps('The evo-\nlution of species.', EMPTY_PROFILE);
        expect(result.value).toBe('The evolution of species.');
    });

    it('keeps the hyphen for a compound the book attests as hyphenated', () => {
        const profile = profileFrom('The mind is self-aware and calm.');
        const result = repairLineWraps('A self-\naware mind.', profile);
        expect(result.value).toBe('A self-aware mind.');
    });

    it('does not over-apply the safe-prefix list to ordinary syllables', () => {
        const profile = profileFrom('Please member this and understand it.');
        expect(repairLineWraps('Please re-\nmember this.', profile).value).toBe('Please remember this.');
        expect(repairLineWraps('Please under-\nstand it.', profile).value).toBe('Please understand it.');
    });

    it('keeps the hyphen for a capitalized right side (proper noun)', () => {
        const result = repairLineWraps('The Anglo-\nSaxon settlers.', EMPTY_PROFILE);
        expect(result.value).toBe('The Anglo-Saxon settlers.');
    });

    it('joins a wrapped word inside a Title-Case heading using attestation', () => {
        const profile = profileFrom('A chapter about evolution and its causes.');
        const result = repairLineWraps('The Evo-\nlution Of Man', profile);
        expect(result.value).toBe('The Evolution Of Man');
    });

    it('keeps the hyphen across a digit boundary', () => {
        expect(repairLineWraps('The war of 1914-\n18 began.', EMPTY_PROFILE).value)
            .toBe('The war of 1914-18 began.');
    });

    it('keeps the hyphen for a spelled-out tens compound', () => {
        expect(repairLineWraps('She was twenty-\nfive then.', EMPTY_PROFILE).value)
            .toBe('She was twenty-five then.');
    });

    it('joins a soft hyphen and drops it', () => {
        const result = repairLineWraps('The evo­\nlution of species.', EMPTY_PROFILE);
        expect(result.value).toBe('The evolution of species.');
        expect(result.value).not.toContain('­');
    });

    it('strips a residual mid-word soft hyphen even without a line wrap', () => {
        const result = repairLineWraps('A mid­word example.', EMPTY_PROFILE);
        expect(result.value).toBe('A midword example.');
    });

    it('does not join across an em-dash written as a double hyphen', () => {
        const result = repairLineWraps('She said--\nthen left.', EMPTY_PROFILE);
        expect(result.value).toBe('She said--\nthen left.');
    });

    it('does not join a spaced dash', () => {
        const result = repairLineWraps('She said -\nthen left.', EMPTY_PROFILE);
        expect(result.value).toBe('She said -\nthen left.');
    });

    it('never joins across a blank-line paragraph boundary', () => {
        const profile = profileFrom('Ending thenext paragraph here.');
        const result = repairLineWraps('Ending-\n\nNext paragraph.', profile);
        expect(result.value).toBe('Ending-\n\nNext paragraph.');
    });

    it('does not join an unhyphenated pair across a blank-line boundary even when attested', () => {
        const profile = profileFrom('the thecat is here.');
        const result = repairLineWraps('the\n\ncat sat.', profile);
        expect(result.value).toBe('the\n\ncat sat.');
    });

    it('resolves a wrap spanning three source lines in one pass', () => {
        const profile = profileFrom('The compound word is nineteenthcenturystyle here.');
        const result = repairLineWraps('The nineteenth-\ncentury-\nstyle house.', profile);
        expect(result.value).toBe('The nineteenthcenturystyle house.');
        expect(result.value).not.toContain('\n\n');
    });

    it('does not introduce a paragraph break when repairing a wrap', () => {
        const result = repairLineWraps('a b evo-\nlution c\nd e', EMPTY_PROFILE);
        expect(result.value).toBe('a b evolution c\nd e');
        expect(result.value.includes('\n\n')).toBe(false);
    });

    it('leaves an unattested, unhyphenated wrap split (conservative default)', () => {
        const result = repairLineWraps('The broken everythin\ng token.', EMPTY_PROFILE);
        expect(result.value).toBe('The broken everythin\ng token.');
    });

    it('joins an unattested, unhyphenated wrap when book-attested elsewhere', () => {
        const profile = profileFrom('The complete everything token appears intact.');
        const result = repairLineWraps('The broken everythin\ng token.', profile);
        expect(result.value).toBe('The broken everything token.');
    });

    it('is idempotent', () => {
        const once = repairLineWraps('The evo-\nlution of species.', EMPTY_PROFILE);
        const twice = repairLineWraps(once.value, EMPTY_PROFILE);
        expect(twice.value).toBe(once.value);
    });
});

describe('buildLineWrapProfile', () => {
    it('excludes wrap-participant fragments from the lexicon', () => {
        const profile = buildLineWrapProfile(['An evo-\nlution occurred.']);
        expect(profile.intactTokens.has('evo')).toBe(false);
        expect(profile.intactTokens.has('lution')).toBe(false);
    });

    it('records hyphenated tokens separately from unhyphenated ones', () => {
        const profile = buildLineWrapProfile(['The mind is self-aware.']);
        expect(profile.hyphenatedTokens.has('self-aware')).toBe(true);
        expect(profile.intactTokens.has('self-aware')).toBe(false);
    });
});

describe('repairLineWrapsAcrossSegments', () => {
    it('joins a hyphenated wrap across a segment boundary', () => {
        const result = repairLineWrapsAcrossSegments(['A theory of evo-', 'lution took hold.'], EMPTY_PROFILE);
        expect(result.segments).toEqual(['A theory of evolution', ' took hold.']);
    });

    it('does not join an unhyphenated pair across a segment boundary', () => {
        const profile = profileFrom('the thecat sat.');
        const result = repairLineWrapsAcrossSegments(['stray the', 'cat sat.'], profile);
        expect(result.segments).toEqual(['stray the', 'cat sat.']);
    });

    it('preserves empty segments untouched', () => {
        const result = repairLineWrapsAcrossSegments(['a-', '', 'b'], EMPTY_PROFILE);
        expect(result.segments).toEqual(['a-', '', 'b']);
    });

    it('still repairs intra-segment wraps', () => {
        const result = repairLineWrapsAcrossSegments(['The evo-\nlution of species.', 'Next page.'], EMPTY_PROFILE);
        expect(result.segments[0]).toBe('The evolution of species.');
    });
});
