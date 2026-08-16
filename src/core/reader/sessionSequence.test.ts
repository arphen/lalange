import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReaderSessionSequence } from './sessionSequence';

describe('Reader session sequence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves delays as completed or cancelled', async () => {
        const sequence = createReaderSessionSequence();
        const completed = sequence.delay(100);

        vi.advanceTimersByTime(100);
        await expect(completed).resolves.toBe(true);

        const cancelled = sequence.delay(100);
        sequence.cancel();
        await expect(cancelled).resolves.toBe(false);
    });

    it('stops repeated callbacks when the sequence is cancelled', () => {
        const sequence = createReaderSessionSequence();
        const callback = vi.fn();

        sequence.repeat(100, callback);
        vi.advanceTimersByTime(250);
        expect(callback).toHaveBeenCalledTimes(2);

        sequence.cancel();
        vi.advanceTimersByTime(300);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('aborts child work when the owning session is disposed', async () => {
        const sessionController = new AbortController();
        const sequence = createReaderSessionSequence(sessionController.signal);
        const pending = sequence.delay(100);

        sessionController.abort();
        await expect(pending).resolves.toBe(false);
    });
});