
import { describe, it, expect } from 'vitest';
import { getStructuralDelay } from './timing';

describe('getStructuralDelay', () => {
    const base = 100;

    it('should return 0 for normal words', () => {
        expect(getStructuralDelay('hello', base)).toBe(0);
    });

    it('should return delay for period', () => {
        expect(getStructuralDelay('end.', base)).toBe(150);
    });

    it('should return delay for comma', () => {
        expect(getStructuralDelay('pause,', base)).toBe(50);
    });

    it('should return delay for semicolon', () => {
        expect(getStructuralDelay('clause;', base)).toBe(100);
    });

    it('should return delay for long words (>12 chars)', () => {
        // "extraordinarily" is 15 chars
        expect(getStructuralDelay('extraordinarily', base)).toBe(50); // 0.5 * base
    });

    it('should return delay for hyphenated words', () => {
        expect(getStructuralDelay('long-term', base)).toBe(50); // 0.5 * base
    });

    it('should combine delays (long word + period)', () => {
        // "extraordinarily." is 16 chars + period
        // Period = 1.5 * base = 150
        // Long word = 0.5 * base = 50
        // Total = 200
        expect(getStructuralDelay('extraordinarily.', base)).toBe(200);
    });
});
