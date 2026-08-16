export type OperationKind = 'model-load' | 'ingest' | 'analysis' | 'sync' | 'exchange';
export type OperationState = 'running' | 'completed' | 'failed' | 'cancelled';

export interface OperationProgress {
    operationId: string;
    kind: OperationKind;
    phase: string;
    completed?: number;
    total?: number;
    message?: string;
    state: OperationState;
    updatedAt: number;
}

export type OperationProgressUpdate = Omit<OperationProgress, 'operationId' | 'updatedAt'>;

export interface OperationHandle {
    readonly id: string;
    readonly signal: AbortSignal;
    report: (update: OperationProgressUpdate) => void;
    complete: (message?: string) => void;
    fail: (error: unknown) => void;
    cancel: () => void;
    dispose: () => void;
}

interface OperationOptions {
    kind: OperationKind;
    publish: (update: OperationProgress) => void;
    operationId?: string;
    intervalMs?: number;
    now?: () => number;
}

const DEFAULT_INTERVAL_MS = 100;
let operationSequence = 0;

const createOperationId = (kind: OperationKind): string => {
    operationSequence += 1;
    return `${kind}-${Date.now()}-${operationSequence}`;
};

const getUpdateKey = (update: OperationProgressUpdate): string => JSON.stringify([
    update.kind,
    update.phase,
    update.completed,
    update.total,
    update.message,
    update.state,
]);

export const createOperationHandle = ({
    kind,
    publish,
    operationId = createOperationId(kind),
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
}: OperationOptions): OperationHandle => {
    const abortController = new AbortController();
    let closed = false;
    let lastPublishedKey: string | null = null;
    let lastPublishedAt = Number.NEGATIVE_INFINITY;
    let pending: OperationProgressUpdate | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const dispatch = (update: OperationProgressUpdate) => {
        clearTimer();
        pending = null;

        const updateKey = getUpdateKey(update);
        if (lastPublishedKey === updateKey) return;

        lastPublishedKey = updateKey;
        lastPublishedAt = now();
        publish({
            operationId,
            ...update,
            updatedAt: lastPublishedAt,
        });
    };

    const schedule = (update: OperationProgressUpdate) => {
        pending = update;
        if (timer !== null) return;

        const delay = Math.max(0, intervalMs - (now() - lastPublishedAt));
        timer = setTimeout(() => {
            timer = null;
            if (pending) dispatch(pending);
        }, delay);
    };

    const report = (update: OperationProgressUpdate) => {
        if (closed) return;
        const updateKey = getUpdateKey(update);
        if (lastPublishedKey === updateKey || getUpdateKey(pending ?? update) === updateKey && pending !== null) return;

        if (lastPublishedKey === null || now() - lastPublishedAt >= intervalMs) {
            dispatch(update);
        } else {
            schedule(update);
        }
    };

    const finish = (update: OperationProgressUpdate) => {
        if (closed) return;
        dispatch(update);
        closed = true;
        abortController.abort();
    };

    return {
        id: operationId,
        signal: abortController.signal,
        report,
        complete: (message) => finish({
            kind,
            phase: 'complete',
            message,
            state: 'completed',
        }),
        fail: (error) => finish({
            kind,
            phase: 'failed',
            message: error instanceof Error ? error.message : String(error),
            state: 'failed',
        }),
        cancel: () => finish({
            kind,
            phase: 'cancelled',
            message: 'Cancelled',
            state: 'cancelled',
        }),
        dispose: () => {
            if (closed) return;
            closed = true;
            clearTimer();
            pending = null;
            abortController.abort();
        },
    };
};
