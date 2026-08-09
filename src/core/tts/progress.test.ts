import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTTSProgressReporter } from './progress';

describe('createTTSProgressReporter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces duplicate and high-frequency progress events', () => {
        const updates: Array<[number, string]> = [];
        const reporter = createTTSProgressReporter((progress, status) => updates.push([progress, status]));

        for (let index = 0; index < 10_000; index++) {
            reporter.report(index / 10_000, 'Loading model.onnx');
        }

        expect(updates).toHaveLength(1);
        reporter.complete(1, 'Ready');
        expect(updates).toEqual([[0, 'Loading model.onnx'], [1, 'Ready']]);
    });

    it('publishes a trailing update after the rate limit', () => {
        const updates: Array<[number, string]> = [];
        const reporter = createTTSProgressReporter((progress, status) => updates.push([progress, status]));

        reporter.report(0, 'Loading');
        reporter.report(0.5, 'Loading model.onnx');
        expect(updates).toEqual([[0, 'Loading']]);

        vi.advanceTimersByTime(100);
        expect(updates).toEqual([[0, 'Loading'], [0.5, 'Loading model.onnx']]);
    });

    it('publishes terminal states immediately and clears pending work', () => {
        const updates: Array<[number, string]> = [];
        const reporter = createTTSProgressReporter((progress, status) => updates.push([progress, status]));

        reporter.report(0, 'Loading');
        reporter.report(0.25, 'Loading model.onnx');
        reporter.error(0, 'Failed');
        vi.runAllTimers();

        expect(updates).toEqual([[0, 'Loading'], [0, 'Failed']]);
    });
});