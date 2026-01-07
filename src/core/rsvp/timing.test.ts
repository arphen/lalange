
import { describe, it, expect } from 'vitest';
import { getVisualProcessingDelay } from './timing';

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
