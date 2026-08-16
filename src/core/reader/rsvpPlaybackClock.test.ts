import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRsvpPlaybackClock } from './rsvpPlaybackClock';

describe('RsvpPlaybackClock', () => {
    const animationFrames = new Map<number, FrameRequestCallback>();
    let nextAnimationFrameId = 1;

    beforeEach(() => {
        vi.useFakeTimers();
        animationFrames.clear();
        nextAnimationFrameId = 1;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = nextAnimationFrameId++;
            animationFrames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            animationFrames.delete(id);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('sleeps before requesting a precise animation frame', () => {
        const clock = createRsvpPlaybackClock();
        const frame = vi.fn();

        clock.schedule(frame, 100);
        vi.advanceTimersByTime(99);
        expect(animationFrames.size).toBe(0);

        vi.advanceTimersByTime(1);
        expect(animationFrames.size).toBe(1);

        animationFrames.get(1)?.(42);
        expect(frame).toHaveBeenCalledWith(42);
    });

    it('requests the next animation frame immediately when no sleep is needed', () => {
        const clock = createRsvpPlaybackClock();
        const frame = vi.fn();

        clock.schedule(frame);
        expect(animationFrames.size).toBe(1);

        animationFrames.get(1)?.(84);
        expect(frame).toHaveBeenCalledWith(84);
    });

    it('cancels pending timers and frames', () => {
        const clock = createRsvpPlaybackClock();
        const frame = vi.fn();

        clock.schedule(frame, 100);
        clock.cancel();
        vi.advanceTimersByTime(100);

        expect(animationFrames.size).toBe(0);
        expect(frame).not.toHaveBeenCalled();
    });
});