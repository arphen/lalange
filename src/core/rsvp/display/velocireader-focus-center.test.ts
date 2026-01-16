import { describe, it, expect } from 'vitest';
import { 
    getCenterFocusMargin, 
    velocireaderFocusCenterPlugin 
} from './velocireader-focus-center';

describe('Velocireader Focus Center Plugin', () => {
    describe('getCenterFocusMargin', () => {
        it('should have maximum compression at geometric center', () => {
            // word length 5. Center index is 2.
            const len = 5;
            const centerIdx = 2;
            
            const marginAtCenter = getCenterFocusMargin(centerIdx, len);
            // -7.0 + (0 * rate) = -7.0
            expect(marginAtCenter).toBe(-7.0);
        });

        it('should have weaker recovery on left side (stay compressed)', () => {
            const len = 5; // Center is 2
            
            // Left Side: Index 1 (Dist 1). Rate 0.6
            // -7.0 + (1 * 0.6) = -6.4
            const marginLeft = getCenterFocusMargin(1, len);
            
            // Right Side: Index 3 (Dist 1). Rate 1.3
            // -7.0 + (1 * 1.3) = -5.7
            const marginRight = getCenterFocusMargin(3, len);
            
            // Left should be MORE compressed (more negative) than Right
            expect(marginLeft).toBe(-6.4);
            expect(marginRight).toBeCloseTo(-5.7);
            expect(marginLeft).toBeLessThan(marginRight);
        });

        it('should cap positive margin at 2px', () => {
            // Very long word
            const len = 21; // Center 10
            // Index 20 (Right edge) -> dist 10
            // -7.0 + (10 * 1.3) = 6.0 -> capped at 2
            expect(getCenterFocusMargin(20, len)).toBe(2);
        });
    });

    describe('Plugin Properties', () => {
        it('should have correct id and name', () => {
            expect(velocireaderFocusCenterPlugin.id).toBe('velocireader-focus-center');
            expect(velocireaderFocusCenterPlugin.name).toBe('Velocireader Focus Center');
        });

        it('should render HTML with margin styles', () => {
            const html = velocireaderFocusCenterPlugin.renderWord('test');
            // Should contain margin style
            expect(html).toContain('margin: 0');
            // Should contain transform
            expect(html).toContain('transform: skewX');
        });
    });
});
