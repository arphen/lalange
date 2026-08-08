
import { describe, it, expect } from 'vitest';
import { getFrameTargetInterval, getTargetInterval, getVisualProcessingDelay, isLikelyProperNoun } from './timing';
import type { RsvpFrame } from './phrases/grouping';

describe('getTargetInterval', () => {
    it('should keep punctuation cadence smooth at 500 WPM', () => {
        expect(getTargetInterval('word', 1, 500)).toBe(120);
        expect(getTargetInterval('word,', 1, 500)).toBe(150);
        expect(getTargetInterval('word.', 1, 500)).toBe(198);
    });

    it('should compress density extremes toward the base cadence', () => {
        expect(getTargetInterval('word', 0.5, 500)).toBe(93);
        expect(getTargetInterval('word', 2, 500)).toBe(174);
    });

    it('should give likely proper nouns extra time', () => {
        expect(isLikelyProperNoun('Montmorency', 'met')).toBe(true);
        expect(isLikelyProperNoun('Montmorency', 'arrived.')).toBe(false);
        expect(getTargetInterval('Montmorency', 1, 500, { isLikelyProperNoun: true }))
            .toBeGreaterThan(getTargetInterval('montmorency', 1, 500));
    });
});

describe('getFrameTargetInterval', () => {
    const frame = (tokens: string[], sourceWordCount: 1 | 2 | 3): RsvpFrame => ({
        startIndex: 0,
        sourceWordCount,
        tokens,
        displayText: tokens.join(' '),
    });

    it('compresses a neutral bigram to 150 ms at 600 WPM', () => {
        expect(getFrameTargetInterval(frame(['in', 'the'], 2), [1, 1], undefined, 600)).toBe(150);
    });

    it('compresses a neutral trigram to 225 ms at 600 WPM', () => {
        expect(getFrameTargetInterval(frame(['one', 'of', 'the'], 3), [1, 1, 1], undefined, 600)).toBe(225);
    });

    it('keeps terminal punctuation outside the compression factor', () => {
        expect(getFrameTargetInterval(frame(['in', 'the.'], 2), [1, 1], undefined, 600)).toBe(215);
    });

    it('preserves the single-token timing path', () => {
        const single = frame(['word,'], 1);
        expect(getFrameTargetInterval(single, [1], undefined, 500)).toBe(getTargetInterval('word,', 1, 500));
        expect(getFrameTargetInterval(single, [0], undefined, 500)).toBe(getTargetInterval('word,', 1, 500));
    });

    it('uses each constituent density for its own portion of grouped time', () => {
        const grouped = getFrameTargetInterval(frame(['in', 'the'], 2), [0.5, 2], undefined, 600);
        expect(grouped).toBe(166.875);
        expect(grouped).not.toBe(150);
        expect(getFrameTargetInterval(frame(['in', 'the'], 2), [1, 1], undefined, 600)).toBe(150);
    });
});

describe('getVisualProcessingDelay', () => {
    it('should return length-based delay for normal words', () => {
        // 'hello' length 5
        // 25 * sqrt(5) ≈ 55.9
        const delay = getVisualProcessingDelay('hello');
        expect(delay).toBeCloseTo(55.9, 1);
    });

    it('should return delay for period', () => {
        // 'end.' length 4. Ends in period (+300)
        // 300 + 25 * sqrt(4) = 300 + 50 = 350
        const delay = getVisualProcessingDelay('end.');
        expect(delay).toBeCloseTo(350, 1);
    });

    it('should return delay for comma', () => {
        // 'pause,' length 6. Ends in comma (+150)
        // 150 + 25 * sqrt(6) ≈ 150 + 61.24 = 211.24
        const delay = getVisualProcessingDelay('pause,');
        expect(delay).toBeCloseTo(211.2, 1);
    });

    it('should return delay for semicolon', () => {
        // 'clause;' length 7. Ends in semicolon (+200)
        // 200 + 25 * sqrt(7) ≈ 200 + 66.14 = 266.14
        const delay = getVisualProcessingDelay('clause;');
        expect(delay).toBeCloseTo(266.1, 1);
    });

    it('should return higher delay for long words', () => {
        // 'extraordinarily' length 15
        // 25 * sqrt(15) ≈ 96.82
        const delay = getVisualProcessingDelay('extraordinarily');
        expect(delay).toBeCloseTo(96.8, 1);
    });

    it('should return delay for hyphen at end', () => {
         // The current implementation only checks the last character.
         // 'cut-off-' length 8. Ends in - (+150)
         // 150 + 25 * sqrt(8) ≈ 150 + 70.71 = 220.71
         const delay = getVisualProcessingDelay('cut-off-');
         expect(delay).toBeCloseTo(220.7, 1);
    });

    it('should combine delays (long word + period)', () => {
        // 'extraordinarily.' length 16. Ends in . (+300)
        // 300 + 25 * sqrt(16) = 300 + 100 = 400
        const delay = getVisualProcessingDelay('extraordinarily.');
        expect(delay).toBeCloseTo(400, 1);
    });
});
