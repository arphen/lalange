export const LENS_SCALE_MIN = 0.65;
export const LENS_SCALE_MAX = 2.4;
export const LENS_SCALE_DEFAULT = 1;
export const TRACKPAD_PINCH_SENSITIVITY = 0.0025;

export interface Point2D {
    clientX: number;
    clientY: number;
}

export const clampLensScale = (
    value: number,
    min: number = LENS_SCALE_MIN,
    max: number = LENS_SCALE_MAX,
): number => {
    return Math.max(min, Math.min(max, value));
};

export const getWheelPinchDelta = (
    deltaY: number,
    sensitivity: number = TRACKPAD_PINCH_SENSITIVITY,
): number => {
    // On trackpads, pinch-in usually reports positive deltaY; we invert so pinch-in zooms out.
    const delta = -deltaY * sensitivity;
    return Object.is(delta, -0) ? 0 : delta;
};

export const getTouchDistance = (touchA: Point2D, touchB: Point2D): number => {
    const dx = touchA.clientX - touchB.clientX;
    const dy = touchA.clientY - touchB.clientY;
    return Math.hypot(dx, dy);
};

export const mergeTransformWithScale = (
    existingTransform: string | undefined,
    scale: number,
): string => {
    const normalizedTransform = (existingTransform ?? '').trim();
    const withoutScale = normalizedTransform
        .replace(/\s*scale\([^)]*\)\s*/g, ' ')
        .trim()
        .replace(/\s{2,}/g, ' ');

    const scaleTransform = `scale(${scale.toFixed(3)})`;
    return withoutScale.length > 0 ? `${withoutScale} ${scaleTransform}` : scaleTransform;
};
