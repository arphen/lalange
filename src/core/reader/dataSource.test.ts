import { describe, expect, it, vi } from 'vitest';
import type { MyDatabase } from '../sync/db';
import { createReaderSessionDataSource } from './dataSource';

const createCollection = (subscription: { unsubscribe: () => void }) => ({
    find: vi.fn().mockReturnValue({
        $: { subscribe: vi.fn().mockReturnValue(subscription) },
        exec: vi.fn().mockResolvedValue([]),
    }),
    findOne: vi.fn().mockReturnValue({
        $: { subscribe: vi.fn().mockReturnValue(subscription) },
        exec: vi.fn().mockResolvedValue(null),
    }),
});

describe('Reader session data source', () => {
    it('disposes all live subscriptions together', async () => {
        const subscriptions = [
            { unsubscribe: vi.fn() },
            { unsubscribe: vi.fn() },
            { unsubscribe: vi.fn() },
        ];
        const database = {
            chapters: createCollection(subscriptions[0]),
            books: createCollection(subscriptions[1]),
            images: createCollection(subscriptions[2]),
            reading_states: { findOne: vi.fn(), insert: vi.fn() },
        } as unknown as MyDatabase;
        const dataSource = createReaderSessionDataSource('test', () => Promise.resolve(database));

        await dataSource.subscribeToChapters('book-1', vi.fn());
        await dataSource.subscribeToBook('book-1', vi.fn());
        await dataSource.subscribeToImages('book-1', vi.fn());
        dataSource.dispose();

        subscriptions.forEach((subscription) => {
            expect(subscription.unsubscribe).toHaveBeenCalledOnce();
        });
    });

    it('does not attach a subscription after disposal wins an async database open', async () => {
        let resolveDatabase: ((database: MyDatabase) => void) | null = null;
        const databasePromise = new Promise<MyDatabase>((resolve) => {
            resolveDatabase = resolve;
        });
        const subscription = { unsubscribe: vi.fn() };
        const database = {
            chapters: createCollection(subscription),
            books: createCollection(subscription),
            images: createCollection(subscription),
            reading_states: { findOne: vi.fn(), insert: vi.fn() },
        } as unknown as MyDatabase;
        const dataSource = createReaderSessionDataSource('test', () => databasePromise);
        const pending = dataSource.subscribeToChapters('book-1', vi.fn());

        dataSource.dispose();
        resolveDatabase!(database);

        await expect(pending).resolves.toBe(false);
        expect(database.chapters.find).not.toHaveBeenCalled();
    });

    it('cancels a pending chapter load when a newer chapter replaces it', async () => {
        const firstSubscription = { unsubscribe: vi.fn() };
        const secondSubscription = { unsubscribe: vi.fn() };
        let subscribeCount = 0;
        const database = {
            chapters: {
                findOne: vi.fn().mockImplementation(() => ({
                    $: {
                        subscribe: vi.fn().mockImplementation((callback) => {
                            subscribeCount += 1;
                            if (subscribeCount === 2) callback({ toJSON: () => ({ id: 'chapter-2' }) });
                            return subscribeCount === 1 ? firstSubscription : secondSubscription;
                        }),
                    },
                    exec: vi.fn(),
                })),
                find: vi.fn(),
            },
            books: createCollection({ unsubscribe: vi.fn() }),
            images: createCollection({ unsubscribe: vi.fn() }),
            reading_states: { findOne: vi.fn(), insert: vi.fn() },
        } as unknown as MyDatabase;
        const dataSource = createReaderSessionDataSource('test', () => Promise.resolve(database));
        const firstLoad = dataSource.subscribeToChapter('chapter-1', vi.fn());
        await Promise.resolve();
        const secondLoad = dataSource.subscribeToChapter('chapter-2', vi.fn());

        await expect(firstLoad).resolves.toBe(false);
        await expect(secondLoad).resolves.toBe(true);
        expect(firstSubscription.unsubscribe).toHaveBeenCalledOnce();
    });
});