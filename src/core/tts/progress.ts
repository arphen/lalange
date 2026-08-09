export interface TTSProgressUpdate {
    progress: number;
    status: string;
}

export interface TTSProgressReporter {
    report: (progress: number, status: string) => void;
    complete: (progress: number, status: string) => void;
    error: (progress: number, status: string) => void;
    dispose: () => void;
}

const DEFAULT_INTERVAL_MS = 100;

function normalizeProgress(progress: number): number {
    return Math.max(0, Math.min(1, Math.round(progress * 100) / 100));
}

export function createTTSProgressReporter(
    publish: (progress: number, status: string) => void,
    intervalMs = DEFAULT_INTERVAL_MS,
): TTSProgressReporter {
    let lastPublished: TTSProgressUpdate | null = null;
    let lastPublishedAt = Number.NEGATIVE_INFINITY;
    let pending: TTSProgressUpdate | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const isDuplicate = (update: TTSProgressUpdate): boolean => (
        (lastPublished?.progress === update.progress && lastPublished.status === update.status)
        || (pending?.progress === update.progress && pending.status === update.status)
    );

    const publishUpdate = (update: TTSProgressUpdate) => {
        clearTimer();
        pending = null;
        if (lastPublished?.progress === update.progress && lastPublished.status === update.status) return;
        lastPublished = update;
        lastPublishedAt = Date.now();
        publish(update.progress, update.status);
    };

    const schedulePending = (update: TTSProgressUpdate) => {
        pending = update;
        if (timer !== null) return;

        const delay = Math.max(0, intervalMs - (Date.now() - lastPublishedAt));
        timer = setTimeout(() => {
            timer = null;
            if (pending) publishUpdate(pending);
        }, delay);
    };

    const report = (progress: number, status: string) => {
        if (closed) return;
        const update = { progress: normalizeProgress(progress), status };
        if (isDuplicate(update)) return;

        if (lastPublished === null || Date.now() - lastPublishedAt >= intervalMs) {
            publishUpdate(update);
            return;
        }

        schedulePending(update);
    };

    const publishTerminal = (progress: number, status: string) => {
        if (closed) return;
        publishUpdate({ progress: normalizeProgress(progress), status });
        closed = true;
    };

    return {
        report,
        complete: publishTerminal,
        error: publishTerminal,
        dispose: () => {
            closed = true;
            clearTimer();
            pending = null;
        },
    };
}