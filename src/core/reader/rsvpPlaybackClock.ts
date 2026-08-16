export type RsvpPlaybackFrame = (time: number) => void;

export interface RsvpPlaybackClock {
    schedule: (frame: RsvpPlaybackFrame, delayMs?: number) => void;
    cancel: () => void;
}

export const createRsvpPlaybackClock = (): RsvpPlaybackClock => {
    let animationFrameId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    const cancelScheduledWork = () => {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    const schedule = (frame: RsvpPlaybackFrame, delayMs = 0) => {
        cancelScheduledWork();
        const scheduledGeneration = ++generation;

        const requestFrame = () => {
            if (scheduledGeneration !== generation) return;

            animationFrameId = requestAnimationFrame((time) => {
                animationFrameId = null;
                if (scheduledGeneration === generation) frame(time);
            });
        };

        if (delayMs > 0) {
            timeoutId = setTimeout(() => {
                timeoutId = null;
                requestFrame();
            }, delayMs);
        } else {
            requestFrame();
        }
    };

    const cancel = () => {
        generation += 1;
        cancelScheduledWork();
    };

    return { schedule, cancel };
};