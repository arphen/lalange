import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncPage } from './SyncPage';

const mockStartBookSync = vi.hoisted(() => vi.fn());
const mockInitDB = vi.hoisted(() => vi.fn());

vi.mock('../../core/sync/replication', () => ({
    startBookSync: mockStartBookSync,
}));

vi.mock('../../core/sync/db', () => ({
    initDB: mockInitDB,
}));

describe('SyncPage progress monitoring', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('serializes chapter polls and stops scheduling after unmount', async () => {
        let resolveFirstBookQuery: (value: null) => void = () => undefined;
        const firstBookQuery = new Promise<null>((resolve) => {
            resolveFirstBookQuery = resolve;
        });
        const findOne = vi.fn()
            .mockReturnValueOnce({ exec: () => firstBookQuery })
            .mockImplementation(() => ({ exec: async () => null }));
        const count = vi.fn().mockResolvedValue(0);
        const cancel = vi.fn().mockResolvedValue(undefined);

        mockStartBookSync.mockResolvedValue([{ cancel }]);
        mockInitDB.mockResolvedValue({
            books: { findOne },
            chapters: { count },
        });

        const view = render(
            <MemoryRouter initialEntries={['/sync?room=room&key=key&bookId=book']}>
                <Routes>
                    <Route path="/sync" element={<SyncPage />} />
                </Routes>
            </MemoryRouter>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(findOne).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(5000);
        });
        expect(findOne).toHaveBeenCalledTimes(1);

        resolveFirstBookQuery(null);
        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            vi.advanceTimersByTime(1000);
            await Promise.resolve();
        });
        expect(findOne).toHaveBeenCalledTimes(2);

        view.unmount();
        await act(async () => {
            vi.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(findOne).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});
