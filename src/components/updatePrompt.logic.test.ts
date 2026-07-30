import { describe, expect, it } from 'vitest';
import {
    beginUpdateCatchUp,
    canCheckForServiceWorkerUpdate,
    clearUpdateCatchUp,
    hasInstalledServiceWorker,
    isUpdateCatchUpActive,
    SW_UPDATE_CATCH_UP_TTL_MS,
    SW_UPDATE_CHECK_INTERVAL_MS,
    waitForServiceWorkerInstall,
} from './updatePrompt.logic';

const createStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
    const values = new Map<string, string>();

    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
};

describe('updatePrompt.logic', () => {
    it('uses a conservative update polling interval', () => {
        expect(SW_UPDATE_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
    });

    it('distinguishes first registration from an existing service worker', () => {
        expect(hasInstalledServiceWorker(undefined)).toBe(false);
        expect(hasInstalledServiceWorker({
            active: null,
            installing: null,
            waiting: null,
        })).toBe(false);
        expect(hasInstalledServiceWorker({
            active: null,
            installing: {} as ServiceWorker,
            waiting: null,
        })).toBe(false);
        expect(hasInstalledServiceWorker({
            active: {} as ServiceWorker,
            installing: null,
            waiting: null,
        })).toBe(true);
    });

    it('does not overlap an update check with initial installation', () => {
        expect(canCheckForServiceWorkerUpdate({
            active: null,
            installing: {} as ServiceWorker,
        })).toBe(false);
        expect(canCheckForServiceWorkerUpdate({
            active: {} as ServiceWorker,
            installing: null,
        })).toBe(true);
    });

    it('keeps update consent active only for the bounded catch-up window', () => {
        const storage = createStorage();
        const now = 1_000;

        beginUpdateCatchUp(storage, now);

        expect(isUpdateCatchUpActive(storage, now + SW_UPDATE_CATCH_UP_TTL_MS - 1)).toBe(true);
        expect(isUpdateCatchUpActive(storage, now + SW_UPDATE_CATCH_UP_TTL_MS)).toBe(false);
    });

    it('clears update catch-up consent after reaching the latest worker', () => {
        const storage = createStorage();

        beginUpdateCatchUp(storage, 1_000);
        clearUpdateCatchUp(storage);

        expect(isUpdateCatchUpActive(storage, 1_001)).toBe(false);
    });

    it('waits until the newest service worker finishes installing', async () => {
        const events = new EventTarget();
        const worker = {
            state: 'installing' as ServiceWorkerState,
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
        };
        const installed = waitForServiceWorkerInstall(worker);

        worker.state = 'installed';
        events.dispatchEvent(new Event('statechange'));

        await expect(installed).resolves.toBeUndefined();
    });
});