import { afterEach, describe, expect, it, vi } from 'vitest';
import { READER_LOAD_TIMEOUT_MESSAGE, loadReaderBook } from './readerBookLoader';
import { initDB } from '../../core/sync/db';

vi.mock('../../core/sync/db', () => ({
    initDB: vi.fn(),
}));

describe('loadReaderBook', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('times out when database initialization is blocked', async () => {
        vi.useFakeTimers();
        vi.mocked(initDB).mockReturnValue(new Promise(() => undefined));

        const result = expect(loadReaderBook('blocked-book', 100))
            .rejects.toThrow(READER_LOAD_TIMEOUT_MESSAGE);
        await vi.advanceTimersByTimeAsync(100);

        await result;
    });
});