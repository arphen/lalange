/**
 * Tests for RSVP Word Tokenization
 * 
 * Testing the psychological intuition: dashes are signifiers of absence,
 * marking cognitive pauses that deserve their own moment in the visual stream.
 * Hyphenated and slashed words are split for readability in RSVP.
 */

import { describe, it, expect } from 'vitest';
import {
    tokenizeWord,
    tokenizeForRSVP,
    splitLongWordForRSVP,
    isStandaloneDash,
    isHyphenatedPart,
    isSlashPart,
    isPauseToken,
    getTokenDisplayProps,
    STANDALONE_DASHES,
} from './tokenize';

describe('tokenize', () => {
    describe('STANDALONE_DASHES', () => {
        it('should include em-dash', () => {
            expect(STANDALONE_DASHES).toContain('—');
        });

        it('should include en-dash', () => {
            expect(STANDALONE_DASHES).toContain('–');
        });

        it('should include horizontal bar', () => {
            expect(STANDALONE_DASHES).toContain('―');
        });

        it('should NOT include regular hyphen', () => {
            expect(STANDALONE_DASHES).not.toContain('-');
        });
    });

    describe('isStandaloneDash', () => {
        it('should recognize em-dash', () => {
            expect(isStandaloneDash('—')).toBe(true);
        });

        it('should recognize en-dash', () => {
            expect(isStandaloneDash('–')).toBe(true);
        });

        it('should recognize double hyphen as dash', () => {
            expect(isStandaloneDash('--')).toBe(true);
        });

        it('should recognize triple hyphen as dash', () => {
            expect(isStandaloneDash('---')).toBe(true);
        });

        it('should NOT recognize single hyphen', () => {
            expect(isStandaloneDash('-')).toBe(false);
        });

        it('should NOT recognize regular words', () => {
            expect(isStandaloneDash('hello')).toBe(false);
            expect(isStandaloneDash('perhaps')).toBe(false);
        });

        it('should handle whitespace-padded dashes', () => {
            expect(isStandaloneDash(' — ')).toBe(true);
            expect(isStandaloneDash('  –  ')).toBe(true);
        });
    });

    describe('isHyphenatedPart', () => {
        it('should recognize hyphenated parts', () => {
            expect(isHyphenatedPart('self-')).toBe(true);
            expect(isHyphenatedPart('well-')).toBe(true);
            expect(isHyphenatedPart('nineteenth-')).toBe(true);
        });

        it('should NOT recognize just a hyphen', () => {
            expect(isHyphenatedPart('-')).toBe(false);
        });

        it('should NOT recognize regular words', () => {
            expect(isHyphenatedPart('hello')).toBe(false);
            expect(isHyphenatedPart('aware')).toBe(false);
        });

        it('should NOT recognize words with internal hyphens', () => {
            expect(isHyphenatedPart('self-aware')).toBe(false);
        });
    });

    describe('isSlashPart', () => {
        it('should recognize slash parts', () => {
            expect(isSlashPart('and/')).toBe(true);
            expect(isSlashPart('yes/')).toBe(true);
            expect(isSlashPart('him/')).toBe(true);
        });

        it('should NOT recognize just a slash', () => {
            expect(isSlashPart('/')).toBe(false);
        });

        it('should NOT recognize regular words', () => {
            expect(isSlashPart('hello')).toBe(false);
            expect(isSlashPart('or')).toBe(false);
        });

        it('should NOT recognize words with internal slashes', () => {
            expect(isSlashPart('and/or')).toBe(false);
        });
    });

    describe('tokenizeWord', () => {
        describe('words without dashes', () => {
            it('should return word unchanged for normal words', () => {
                expect(tokenizeWord('hello')).toEqual(['hello']);
                expect(tokenizeWord('world')).toEqual(['world']);
                expect(tokenizeWord('perhaps')).toEqual(['perhaps']);
            });

            it('should handle words with punctuation', () => {
                expect(tokenizeWord('hello!')).toEqual(['hello!']);
                expect(tokenizeWord('world,')).toEqual(['world,']);
                expect(tokenizeWord('"quoted"')).toEqual(['"quoted"']);
            });

            it('should handle hyphenated words (regular hyphens)', () => {
                // Regular hyphens ARE now split for RSVP readability
                expect(tokenizeWord('self-aware')).toEqual(['self-', 'aware']);
                expect(tokenizeWord('well-known')).toEqual(['well-', 'known']);
                expect(tokenizeWord('state-of-the-art')).toEqual(['state-', 'of-', 'the-', 'art']);
            });

            it('should handle slash constructions', () => {
                expect(tokenizeWord('and/or')).toEqual(['and/', 'or']);
                expect(tokenizeWord('yes/no')).toEqual(['yes/', 'no']);
                expect(tokenizeWord('him/her/them')).toEqual(['him/', 'her/', 'them']);
            });

            it('should handle empty input', () => {
                expect(tokenizeWord('')).toEqual([]);
                expect(tokenizeWord('   ')).toEqual([]);
            });
        });

        describe('words with em-dashes', () => {
            it('should extract em-dash from middle of word', () => {
                expect(tokenizeWord('perhaps—I')).toEqual(['perhaps', '—', 'I']);
            });

            it('should extract em-dash from start', () => {
                expect(tokenizeWord('—start')).toEqual(['—', 'start']);
            });

            it('should extract em-dash from end', () => {
                expect(tokenizeWord('end—')).toEqual(['end', '—']);
            });

            it('should handle multiple em-dashes', () => {
                expect(tokenizeWord('a—b—c')).toEqual(['a', '—', 'b', '—', 'c']);
            });

            it('should handle parenthetical construction', () => {
                // Common pattern: "word—(aside)—word"
                expect(tokenizeWord('perhaps—(I')).toEqual(['perhaps', '—', '(I']);
                expect(tokenizeWord('to)—perhaps')).toEqual(['to)', '—', 'perhaps']);
            });

            it('should handle double em-dash', () => {
                expect(tokenizeWord('word——word')).toEqual(['word', '——', 'word']);
            });
        });

        describe('words with en-dashes', () => {
            it('should extract en-dash from middle of word', () => {
                expect(tokenizeWord('perhaps–I')).toEqual(['perhaps', '–', 'I']);
            });

            it('should extract en-dash from start', () => {
                expect(tokenizeWord('–start')).toEqual(['–', 'start']);
            });

            it('should extract en-dash from end', () => {
                expect(tokenizeWord('end–')).toEqual(['end', '–']);
            });
        });

        describe('words with double hyphens (ASCII em-dash substitute)', () => {
            it('should treat double hyphen as dash', () => {
                expect(tokenizeWord('perhaps--I')).toEqual(['perhaps', '--', 'I']);
            });

            it('should treat triple hyphen as dash', () => {
                expect(tokenizeWord('word---word')).toEqual(['word', '---', 'word']);
            });

            it('should handle double hyphen at edges', () => {
                expect(tokenizeWord('--start')).toEqual(['--', 'start']);
                expect(tokenizeWord('end--')).toEqual(['end', '--']);
            });
        });

        describe('edge cases', () => {
            it('should handle standalone dash', () => {
                expect(tokenizeWord('—')).toEqual(['—']);
                expect(tokenizeWord('–')).toEqual(['–']);
                expect(tokenizeWord('--')).toEqual(['--']);
            });

            it('should handle dash with punctuation', () => {
                expect(tokenizeWord('word—,')).toEqual(['word', '—', ',']);
                expect(tokenizeWord('"—')).toEqual(['"', '—']);
            });

            it('should handle consecutive dashes as single token', () => {
                expect(tokenizeWord('word————word')).toEqual(['word', '————', 'word']);
            });
        });
    });

    describe('splitLongWordForRSVP', () => {
        it('keeps short tokens unchanged', () => {
            expect(splitLongWordForRSVP('comfortable')).toEqual(['comfortable']);
        });

        it('splits long words into continuation chunks', () => {
            const parts = splitLongWordForRSVP('characteristically', {
                minLength: 12,
                maxSegmentLength: 8,
                continuationMarker: '-',
            });

            expect(parts).toEqual(['characte-', 'ristical-', 'ly']);
        });

        it('preserves trailing punctuation on the final segment', () => {
            const parts = splitLongWordForRSVP('institutionalization,', {
                minLength: 12,
                maxSegmentLength: 8,
                continuationMarker: '-',
            });

            expect(parts).toEqual(['institut-', 'ionaliza-', 'tion,']);
        });

        it('preserves leading decoration on the first segment', () => {
            const parts = splitLongWordForRSVP('"counterrevolutionary"', {
                minLength: 12,
                maxSegmentLength: 8,
                continuationMarker: '-',
            });

            expect(parts).toEqual(['"counterr-', 'evolutio-', 'nary"']);
        });

        it('does not split pause tokens', () => {
            expect(splitLongWordForRSVP('—')).toEqual(['—']);
        });
    });

    describe('tokenizeForRSVP', () => {
        describe('basic functionality', () => {
            it('should handle simple text', () => {
                const result = tokenizeForRSVP('Hello world');
                expect(result.tokens).toEqual(['Hello', 'world']);
                expect(result.metadata.dashesExtracted).toBe(0);
                expect(result.metadata.originalWordCount).toBe(2);
                expect(result.metadata.finalTokenCount).toBe(2);
            });

            it('should handle empty input', () => {
                const result = tokenizeForRSVP('');
                expect(result.tokens).toEqual([]);
                expect(result.metadata.finalTokenCount).toBe(0);
            });

            it('should handle whitespace-only input', () => {
                const result = tokenizeForRSVP('   ');
                expect(result.tokens).toEqual([]);
            });
        });

        describe('dash extraction', () => {
            it('should extract em-dash from text', () => {
                const result = tokenizeForRSVP('perhaps—I like to—perhaps');
                expect(result.tokens).toEqual([
                    'perhaps', '—', 'I', 'like', 'to', '—', 'perhaps'
                ]);
                expect(result.metadata.dashesExtracted).toBe(2);
                // Original words: "perhaps—I", "like", "to—perhaps" = 3 words
                expect(result.metadata.originalWordCount).toBe(3);
                expect(result.metadata.finalTokenCount).toBe(7);
            });

            it('should extract parenthetical aside', () => {
                const text = 'I thought—(or rather, felt)—that something was wrong.';
                const result = tokenizeForRSVP(text);
                expect(result.tokens).toContain('—');
                // Check the dashes are properly separated
                const dashIndices = result.tokens
                    .map((t, i) => isStandaloneDash(t) ? i : -1)
                    .filter(i => i >= 0);
                expect(dashIndices.length).toBe(2);
            });

            it('should handle standalone dash in text', () => {
                const result = tokenizeForRSVP('I — was — wrong');
                expect(result.tokens).toEqual(['I', '—', 'was', '—', 'wrong']);
                expect(result.metadata.dashesExtracted).toBe(2);
            });

            it('should handle double hyphen as em-dash substitute', () => {
                const result = tokenizeForRSVP('I thought--or did I?--that it was true.');
                expect(result.tokens).toContain('--');
                const dashes = result.tokens.filter(isStandaloneDash);
                expect(dashes.length).toBe(2);
            });
        });

        describe('real-world examples', () => {
            it('should handle Gutenberg-style em-dash constructions', () => {
                // Common in older texts
                const text = '"I never—" he hesitated—"I never saw such a thing."';
                const result = tokenizeForRSVP(text);
                expect(result.tokens.filter(t => t === '—').length).toBe(2);
            });

            it('should handle interruption pattern', () => {
                const text = 'She said—but no, I cannot repeat what she said.';
                const result = tokenizeForRSVP(text);
                const dashIndex = result.tokens.indexOf('—');
                expect(dashIndex).toBeGreaterThan(0);
                expect(result.tokens[dashIndex - 1]).toBe('said');
                expect(result.tokens[dashIndex + 1]).toBe('but');
            });

            it('should split hyphenated words while extracting dashes', () => {
                const text = 'The self-aware robot—if it could be called that—pondered.';
                const result = tokenizeForRSVP(text);
                // "self-aware" is now split into "self-" and "aware"
                expect(result.tokens).toContain('self-');
                expect(result.tokens).toContain('aware');
                expect(result.tokens.filter(t => t === '—').length).toBe(2);
            });

            it('should handle complex Victorian-style prose', () => {
                const text = 'It was perhaps—I say perhaps because I am not certain—the most extraordinary event—nay, the most singular occurrence—of my entire career.';
                const result = tokenizeForRSVP(text);
                expect(result.metadata.dashesExtracted).toBe(4);
            });
        });
    });

    describe('isPauseToken', () => {
        it('should return true for em-dash', () => {
            expect(isPauseToken('—')).toBe(true);
        });

        it('should return true for en-dash', () => {
            expect(isPauseToken('–')).toBe(true);
        });

        it('should return true for double hyphen', () => {
            expect(isPauseToken('--')).toBe(true);
        });

        it('should return false for regular words', () => {
            expect(isPauseToken('hello')).toBe(false);
            expect(isPauseToken('world')).toBe(false);
        });

        it('should return false for single hyphen', () => {
            expect(isPauseToken('-')).toBe(false);
        });
    });

    describe('getTokenDisplayProps', () => {
        describe('pause tokens', () => {
            it('should mark em-dash as pause', () => {
                const props = getTokenDisplayProps('—');
                expect(props.isPause).toBe(true);
            });

            it('should have higher display time multiplier for dashes', () => {
                const props = getTokenDisplayProps('—');
                expect(props.displayTimeMultiplier).toBeGreaterThan(1.0);
            });

            it('should NOT use saccade rendering for dashes', () => {
                const props = getTokenDisplayProps('—');
                expect(props.useSaccadeRendering).toBe(false);
            });

            it('should have special CSS class for dashes', () => {
                const props = getTokenDisplayProps('—');
                expect(props.cssClass).toBe('rsvp-pause-token');
            });
        });

        describe('regular tokens', () => {
            it('should NOT mark regular words as pause', () => {
                const props = getTokenDisplayProps('hello');
                expect(props.isPause).toBe(false);
            });

            it('should have normal display time for regular words', () => {
                const props = getTokenDisplayProps('hello');
                expect(props.displayTimeMultiplier).toBe(1.0);
            });

            it('should use saccade rendering for regular words', () => {
                const props = getTokenDisplayProps('hello');
                expect(props.useSaccadeRendering).toBe(true);
            });

            it('should NOT have special CSS class for regular words', () => {
                const props = getTokenDisplayProps('hello');
                expect(props.cssClass).toBeUndefined();
            });
        });

        describe('hyphenated parts', () => {
            it('should have higher display time for hyphenated parts', () => {
                const props = getTokenDisplayProps('self-');
                expect(props.displayTimeMultiplier).toBe(1.3);
            });

            it('should NOT mark hyphenated parts as pause', () => {
                const props = getTokenDisplayProps('self-');
                expect(props.isPause).toBe(false);
            });

            it('should have special CSS class for hyphenated parts', () => {
                const props = getTokenDisplayProps('self-');
                expect(props.cssClass).toBe('rsvp-hyphenated-part');
            });

            it('should use saccade rendering for hyphenated parts', () => {
                const props = getTokenDisplayProps('self-');
                expect(props.useSaccadeRendering).toBe(true);
            });
        });

        describe('slash parts', () => {
            it('should have higher display time for slash parts', () => {
                const props = getTokenDisplayProps('and/');
                expect(props.displayTimeMultiplier).toBe(1.3);
            });

            it('should NOT mark slash parts as pause', () => {
                const props = getTokenDisplayProps('and/');
                expect(props.isPause).toBe(false);
            });

            it('should have special CSS class for slash parts', () => {
                const props = getTokenDisplayProps('and/');
                expect(props.cssClass).toBe('rsvp-slash-part');
            });
        });

        describe('long words', () => {
            it('should have higher display time for long words (>10 chars)', () => {
                const props = getTokenDisplayProps('phenomenology'); // 13 chars
                expect(props.displayTimeMultiplier).toBeGreaterThan(1.0);
            });

            it('should have normal display time for short words', () => {
                const props = getTokenDisplayProps('hello'); // 5 chars
                expect(props.displayTimeMultiplier).toBe(1.0);
            });

            it('should have normal display time for 10-char words', () => {
                const props = getTokenDisplayProps('basketball'); // exactly 10 chars
                expect(props.displayTimeMultiplier).toBe(1.0);
            });

            it('should scale extra time by length beyond threshold', () => {
                const short = getTokenDisplayProps('comfortable'); // 11 chars, 1 extra
                const long = getTokenDisplayProps('extraordinarily'); // 15 chars, 5 extra
                expect(long.displayTimeMultiplier).toBeGreaterThan(short.displayTimeMultiplier);
            });

            it('should NOT mark long words as pause', () => {
                const props = getTokenDisplayProps('phenomenology');
                expect(props.isPause).toBe(false);
            });
        });
    });

    describe('integration: RSVP stream simulation', () => {
        it('should produce readable token stream for parenthetical', () => {
            const text = 'perhaps—(I would not say it to a living soul)—perhaps';
            const result = tokenizeForRSVP(text);
            
            // Verify the structure creates proper pauses
            const tokens = result.tokens;
            expect(tokens[0]).toBe('perhaps');
            expect(tokens[1]).toBe('—');
            expect(tokens[2]).toBe('(I');
            // ... middle words ...
            expect(tokens[tokens.length - 2]).toBe('—');
            expect(tokens[tokens.length - 1]).toBe('perhaps');
            
            // The user should see:
            // "perhaps" -> "—" -> "(I" -> "would" -> ... -> "soul)" -> "—" -> "perhaps"
            // The dashes get their own moment, creating cognitive pause
        });

        it('should handle literary interruption pattern', () => {
            const text = '"But I—" She stopped.';
            const result = tokenizeForRSVP(text);
            
            expect(result.tokens).toContain('"But');
            // "I—" splits into "I" and "—" and "\""
            expect(result.tokens).toContain('I');
            expect(result.tokens).toContain('—');
            expect(result.tokens).toContain('"');
        });

        it('should maintain word order across dash extraction', () => {
            const text = 'The quick—and somewhat lazy—brown fox jumps.';
            const result = tokenizeForRSVP(text);
            
            // Find indices
            const quickIdx = result.tokens.indexOf('quick');
            const andIdx = result.tokens.indexOf('and');
            const lazyIdx = result.tokens.indexOf('lazy');
            const brownIdx = result.tokens.indexOf('brown');
            
            // Verify order is maintained
            expect(quickIdx).toBeLessThan(andIdx);
            expect(andIdx).toBeLessThan(lazyIdx);
            expect(lazyIdx).toBeLessThan(brownIdx);
        });
    });
});
