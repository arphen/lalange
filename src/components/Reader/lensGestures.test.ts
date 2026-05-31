import { describe, expect, it } from 'vitest';
import {
    clampLensScale,
    getTouchDistance,
    getWheelPinchDelta,
    LENS_SCALE_MAX,
    LENS_SCALE_MIN,
    mergeTransformWithScale,
} from './lensGestures';

describe('lensGestures', () => {
    it('clamps lens scale to configured bounds', () => {
        expect(clampLensScale(0.1)).toBe(LENS_SCALE_MIN);
        expect(clampLensScale(10)).toBe(LENS_SCALE_MAX);
        expect(clampLensScale(1.25)).toBe(1.25);
    });

    it('computes signed wheel pinch deltas', () => {
        expect(getWheelPinchDelta(100)).toBeLessThan(0);
        expect(getWheelPinchDelta(-100)).toBeGreaterThan(0);
        expect(getWheelPinchDelta(0)).toBe(0);
    });

    it('computes euclidean touch distance', () => {
        const distance = getTouchDistance(
            { clientX: 0, clientY: 0 },
            { clientX: 3, clientY: 4 },
        );
        expect(distance).toBe(5);
    });

    it('adds scale to transform when no transform exists', () => {
        expect(mergeTransformWithScale(undefined, 1.2)).toBe('scale(1.200)');
    });

    it('preserves transform functions and replaces previous scale', () => {
        const merged = mergeTransformWithScale('translateX(4px) scale(1.1)', 1.75);
        expect(merged).toBe('translateX(4px) scale(1.750)');
    });
});
