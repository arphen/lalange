export type ReaderSessionSequenceFrame = (progress: number) => void;

export interface ReaderSessionSequence {
    readonly signal: AbortSignal;
    delay: (delayMs: number) => Promise<boolean>;
    repeat: (intervalMs: number, callback: () => void) => () => void;
    animate: (durationMs: number, onProgress: ReaderSessionSequenceFrame) => Promise<boolean>;
    cancel: () => void;
}

export const createReaderSessionSequence = (
    parentSignal?: AbortSignal,
): ReaderSessionSequence => {
    const controller = new AbortController();
    const operations = new Set<() => void>();

    const cancel = () => {
        if (controller.signal.aborted) return;

        controller.abort();
        [...operations].forEach((operation) => operation());
        operations.clear();
    };

    const onParentAbort = () => cancel();
    if (parentSignal) {
        if (parentSignal.aborted) {
            cancel();
        } else {
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
    }

    const register = (operation: () => void): boolean => {
        if (controller.signal.aborted) {
            operation();
            return false;
        }
        operations.add(operation);
        return true;
    };

    const delay = (delayMs: number): Promise<boolean> => new Promise((resolve) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const settle = (completed: boolean) => {
            if (settled) return;
            settled = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            operations.delete(cancelOperation);
            controller.signal.removeEventListener('abort', onAbort);
            resolve(completed);
        };

        const cancelOperation = () => settle(false);
        const onAbort = () => settle(false);
        if (!register(cancelOperation)) {
            resolve(false);
            return;
        }

        controller.signal.addEventListener('abort', onAbort, { once: true });
        timeoutId = setTimeout(() => settle(true), Math.max(0, delayMs));
    });

    const repeat = (intervalMs: number, callback: () => void): (() => void) => {
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let stopped = false;

        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (intervalId !== null) clearInterval(intervalId);
            operations.delete(stop);
            controller.signal.removeEventListener('abort', onAbort);
        };

        const onAbort = () => stop();
        if (!register(stop)) return () => undefined;

        controller.signal.addEventListener('abort', onAbort, { once: true });
        intervalId = setInterval(() => {
            if (controller.signal.aborted) {
                stop();
                return;
            }
            callback();
        }, Math.max(0, intervalMs));

        return stop;
    };

    const animate = (
        durationMs: number,
        onProgress: ReaderSessionSequenceFrame,
    ): Promise<boolean> => new Promise((resolve) => {
        if (controller.signal.aborted) {
            resolve(false);
            return;
        }
        if (durationMs <= 0) {
            onProgress(1);
            resolve(true);
            return;
        }

        let animationFrameId: number | null = null;
        let fallbackTimerId: ReturnType<typeof setTimeout> | null = null;
        let startedAt: number | null = null;
        let settled = false;

        const settle = (completed: boolean) => {
            if (settled) return;
            settled = true;
            if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
            if (fallbackTimerId !== null) clearTimeout(fallbackTimerId);
            operations.delete(cancelOperation);
            controller.signal.removeEventListener('abort', onAbort);
            if (completed) onProgress(1);
            resolve(completed);
        };

        const cancelOperation = () => settle(false);
        const onAbort = () => settle(false);
        if (!register(cancelOperation)) {
            resolve(false);
            return;
        }

        const update = (timestamp: number) => {
            if (settled || controller.signal.aborted) return;
            if (startedAt === null) startedAt = timestamp;
            const progress = Math.min(1, (timestamp - startedAt) / durationMs);
            onProgress(progress);
            if (progress >= 1) {
                settle(true);
            } else {
                animationFrameId = requestAnimationFrame(update);
            }
        };

        controller.signal.addEventListener('abort', onAbort, { once: true });
        animationFrameId = requestAnimationFrame(update);
        fallbackTimerId = setTimeout(() => settle(true), durationMs);
    });

    return {
        signal: controller.signal,
        delay,
        repeat,
        animate,
        cancel,
    };
};