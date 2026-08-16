import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOperationHandle, type OperationProgress } from './progressReporter';

describe('createOperationHandle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('throttles duplicate running updates and flushes terminal states immediately', () => {
        const updates: OperationProgress[] = [];
        const operation = createOperationHandle({
            kind: 'model-load',
            publish: (update) => updates.push(update),
        });

        operation.report({ kind: 'model-load', phase: 'download', completed: 0, total: 1, state: 'running' });
        operation.report({ kind: 'model-load', phase: 'download', completed: 0, total: 1, state: 'running' });
        operation.report({ kind: 'model-load', phase: 'download', completed: 0.5, total: 1, state: 'running' });

        expect(updates).toHaveLength(1);
        expect(updates[0].completed).toBe(0);

        operation.complete('Ready');

        expect(updates).toHaveLength(2);
        expect(updates[1]).toMatchObject({
            operationId: operation.id,
            kind: 'model-load',
            phase: 'complete',
            message: 'Ready',
            state: 'completed',
        });
        expect(operation.signal.aborted).toBe(true);
    });

    it('publishes a trailing update after the interval', () => {
        const updates: OperationProgress[] = [];
        const operation = createOperationHandle({
            kind: 'analysis',
            publish: (update) => updates.push(update),
        });

        operation.report({ kind: 'analysis', phase: 'density', completed: 0, state: 'running' });
        operation.report({ kind: 'analysis', phase: 'density', completed: 0.5, state: 'running' });

        vi.advanceTimersByTime(100);

        expect(updates.map((update) => update.completed)).toEqual([0, 0.5]);
    });

    it('cancels the operation and ignores stale callbacks', () => {
        const updates: OperationProgress[] = [];
        const operation = createOperationHandle({
            kind: 'ingest',
            publish: (update) => updates.push(update),
        });

        operation.report({ kind: 'ingest', phase: 'parse', completed: 0.25, state: 'running' });
        operation.cancel();
        operation.report({ kind: 'ingest', phase: 'parse', completed: 0.75, state: 'running' });
        vi.runAllTimers();

        expect(updates).toHaveLength(2);
        expect(updates[1].state).toBe('cancelled');
        expect(operation.signal.aborted).toBe(true);
    });

    it('disposes pending work without publishing a terminal state', () => {
        const publish = vi.fn();
        const operation = createOperationHandle({
            kind: 'sync',
            publish,
        });

        operation.report({ kind: 'sync', phase: 'transfer', completed: 0, state: 'running' });
        operation.report({ kind: 'sync', phase: 'transfer', completed: 0.5, state: 'running' });
        operation.dispose();
        vi.runAllTimers();

        expect(publish).toHaveBeenCalledTimes(1);
        expect(operation.signal.aborted).toBe(true);
    });
});
