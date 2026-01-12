import { describe, it, expect } from 'vitest';
import { 
    getExtremeCharWidth, 
    getFontSizeScale, 
    velocireaderExtremePlugin 
} from './velocireader-extreme';

describe('Velocireader Extreme Plugin', () => {
    describe('getExtremeCharWidth', () => {
        it('should return 100 for single character word', () => {
             // len=1, orp=0 => maxDist=0 => returns 100
             expect(getExtremeCharWidth(0, 0, 1)).toBe(100);
        });
        
        it('should return 100 at ORP', () => {
             // word 'testing', len 7, orp 2. char at 2.
             // dist=0.
             expect(getExtremeCharWidth(2, 2, 7)).toBe(100);
        });

        it('should scale linearly based on char distance', () => {
            // word 'testing', len 7, orp 2.
            // max dist is index 6 (g) -> abs(6-2) = 4.
            // input index 6.
            // 100 + (4 * 3) = 112.
            expect(getExtremeCharWidth(6, 2, 7)).toBe(112);
        });

        it('should handle middle distances correctly', () => {
            // word 'testing', len 7, orp 2.
            // max dist is 4.
            // index 0 ('t'), dist 2.
            // 100 + (2 * 3) = 106.
            expect(getExtremeCharWidth(0, 2, 7)).toBe(106);
        });
    });

    describe('getFontSizeScale', () => {
        it('should return 1.0 within parafoveal radius', () => {
            // Radius is 2.
            // word 'testing', len 7, orp 2.
            // index 2 (dist 0): 1.0
            expect(getFontSizeScale(2, 2, 7)).toBe(1.0);
            // index 3 (dist 1): 1.0
            expect(getFontSizeScale(3, 2, 7)).toBe(1.0);
            // index 4 (dist 2): 1.0
            expect(getFontSizeScale(4, 2, 7)).toBe(1.0);
        });

        it('should return 1.0 inside radius even for long words', () => {
             // 'internationalization', len 20, orp ~7.
             // index 7 (orp): 1.0
             expect(getFontSizeScale(7, 7, 20)).toBe(1.0);
        });

        it('should scale up outside parafoveal radius based on char distance', () => {
            // word 'testing', len 7, orp 2.
            // parafovealRadius = 2.
            
            // index 6 (dist 4). effectiveDist = 2.
            // 1.0 + (2 * 0.015) = 1.03
            expect(getFontSizeScale(6, 2, 7)).toBe(1.03);
            
            // index 5 (dist 3). effectiveDist = 1.
            // 1.0 + (1 * 0.015) = 1.015
            expect(getFontSizeScale(5, 2, 7)).toBe(1.015);
        });
    });

    describe('Plugin Properties', () => {
        it('should have correct id and name', () => {
            expect(velocireaderExtremePlugin.id).toBe('velocireader-extreme');
            expect(velocireaderExtremePlugin.name).toBe('Velocireader X');
        });

        it('should render HTML with transforms', () => {
            const html = velocireaderExtremePlugin.renderWord('test');
            expect(html).toContain('transform: skewX');
            expect(html).toContain('scaleX');
            expect(html).toContain('scale(');
            expect(html).toContain('margin:');
        });
    });
});
