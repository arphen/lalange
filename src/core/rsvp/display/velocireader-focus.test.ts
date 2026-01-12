import { describe, it, expect } from 'vitest';
import { 
    getFocusCharWidth, 
    getFocusFontSizeScale, 
    getFocusMargin,
    velocireaderFocusPlugin 
} from './velocireader-focus';

describe('Velocireader Focus Plugin', () => {
    describe('getFocusMargin', () => {
        it('should return -3.5 at ORP (compression)', () => {
            // dist 0 -> -3.5
            expect(getFocusMargin(2, 2)).toBe(-3.5);
        });

        it('should return positive margin at edges', () => {
            // dist 6 -> -3.5 + (6 * 0.7) = -3.5 + 4.2 = 0.7
            expect(getFocusMargin(8, 2)).toBeCloseTo(0.7);
        });
        
        it('should cap at +2', () => {
             // dist 10 -> -3.5 + 7 = 3.5 -> cap 2
             expect(getFocusMargin(12, 2)).toBe(2);
        });
    });

    describe('getFocusCharWidth', () => {
        it('should return 85 for single character word', () => {
             // len=1, orp=0 => maxDist=0 => returns 85
             expect(getFocusCharWidth(0, 0, 1)).toBe(85);
        });
        
        it('should return 85 at ORP', () => {
             // word 'testing', len 7, orp 2. char at 2.
             // dist=0.
             expect(getFocusCharWidth(2, 2, 7)).toBe(85);
        });

        it('should scale linearly based on char distance', () => {
            // word 'testing', len 7, orp 2.
            // max dist is index 6 (g) -> abs(6-2) = 4.
            // input index 6.
            // 85 + (4 * 4) = 101.
            expect(getFocusCharWidth(6, 2, 7)).toBe(101);
        });

        it('should handle middle distances correctly', () => {
            // word 'testing', len 7, orp 2.
            // max dist is 4.
            // index 0 ('t'), dist 2.
            // 85 + (2 * 4) = 93.
            expect(getFocusCharWidth(0, 2, 7)).toBe(93);
        });
    });

    describe('getFocusFontSizeScale', () => {
        it('should return 0.95 at ORP', () => {
            // word 'testing', len 7, orp 2.
            // index 2 (dist 0): 0.95
            expect(getFocusFontSizeScale(2, 2, 7)).toBe(0.95);
        });

        it('should scale up linearly based on distance', () => {
            // word 'testing', len 7, orp 2.
            
            // index 6 (dist 4).
            // 0.95 + (4 * 0.025) = 0.95 + 0.1 = 1.05
            expect(getFocusFontSizeScale(6, 2, 7)).toBeCloseTo(1.05);
            
            // index 4 (dist 2).
            // 0.95 + (2 * 0.025) = 0.95 + 0.05 = 1.00
            expect(getFocusFontSizeScale(4, 2, 7)).toBeCloseTo(1.00);
        });
    });

    describe('Plugin Properties', () => {
        it('should have correct id and name', () => {
            expect(velocireaderFocusPlugin.id).toBe('velocireader-focus');
            expect(velocireaderFocusPlugin.name).toBe('Velocireader Focus');
        });

        it('should render HTML with transforms', () => {
            const html = velocireaderFocusPlugin.renderWord('test');
            expect(html).toContain('transform: skewX');
            expect(html).toContain('scaleX');
            expect(html).toContain('scale(');
            expect(html).toContain('margin:');
        });
    });
});
