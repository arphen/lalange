import { describe, it, expect } from 'vitest';
import { 
    getAnchoredSlantAngle, 
    velocireaderFocusSlantPlugin 
} from './velocireader-focus-slant';

describe('Velocireader Focus Slant Plugin', () => {
    describe('getAnchoredSlantAngle', () => {
        it('should return 0 at the ORP', () => {
            // idx = orp = 2
            expect(getAnchoredSlantAngle(2, 2)).toBe(0);
        });

        it('should have negative slant to the left', () => {
            // idx = 1, orp = 2. dist = -1. angle should be -6
            expect(getAnchoredSlantAngle(1, 2)).toBe(-6);
            // idx = 0, orp = 2. dist = -2. angle should be -8
            expect(getAnchoredSlantAngle(0, 2)).toBe(-8);
        });

        it('should have positive slant to the right', () => {
            // idx = 3, orp = 2. dist = 1. angle should be 6
            expect(getAnchoredSlantAngle(3, 2)).toBe(6);
            // idx = 4, orp = 2. dist = 2. angle should be 8
            expect(getAnchoredSlantAngle(4, 2)).toBe(8);
        });

        it('should cap at +/- 15 degrees', () => {
            // idx = 20, orp = 2. dist = 18. linear = 36. cap 15.
            expect(getAnchoredSlantAngle(20, 2)).toBe(15);
            // idx = 0, orp = 20. dist = -20. linear = -40. cap -15.
            expect(getAnchoredSlantAngle(0, 20)).toBe(-15);
        });
    });

    describe('Plugin Properties', () => {
        it('should have correct id and name', () => {
            expect(velocireaderFocusSlantPlugin.id).toBe('velocireader-focus-slant');
            expect(velocireaderFocusSlantPlugin.name).toBe('Velocireader Focus S');
        });

        it('should render HTML', () => {
            const html = velocireaderFocusSlantPlugin.renderWord('test');
            expect(html).toContain('scaleX');
            expect(html).toContain('skewX');
        });
    });
});
