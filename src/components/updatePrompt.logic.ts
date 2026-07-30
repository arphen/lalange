export const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const SW_UPDATE_CATCH_UP_TTL_MS = 30 * 60 * 1000;
export const SW_UPDATE_INSTALL_TIMEOUT_MS = 2 * 60 * 1000;

const SW_UPDATE_CATCH_UP_KEY = 'arphen:sw-update-catch-up-until';

type UpdateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type InstallingWorker = Pick<ServiceWorker, 'state' | 'addEventListener' | 'removeEventListener'>;
type ExistingRegistration = Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'waiting'>;

const INSTALL_COMPLETE_STATES: ReadonlySet<ServiceWorkerState> = new Set([
    'installed',
    'activated',
    'redundant',
]);

export const hasInstalledServiceWorker = (
    registration: ExistingRegistration | undefined,
): boolean => Boolean(registration?.active || registration?.waiting);

export const hasWaitingServiceWorker = (
    registration: Pick<ServiceWorkerRegistration, 'waiting'> | undefined,
): boolean => Boolean(registration?.waiting);

export const canCheckForServiceWorkerUpdate = (
    registration: Pick<ServiceWorkerRegistration, 'active' | 'installing'>,
): boolean => Boolean(registration.active && !registration.installing);

export const beginUpdateCatchUp = (storage: UpdateStorage, now = Date.now()): void => {
    try {
        storage.setItem(SW_UPDATE_CATCH_UP_KEY, String(now + SW_UPDATE_CATCH_UP_TTL_MS));
    } catch {
        // Storage can be unavailable in private browsing modes.
    }
};

export const isUpdateCatchUpActive = (storage: UpdateStorage, now = Date.now()): boolean => {
    try {
        const expiresAt = Number(storage.getItem(SW_UPDATE_CATCH_UP_KEY));
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            storage.removeItem(SW_UPDATE_CATCH_UP_KEY);
            return false;
        }

        return true;
    } catch {
        return false;
    }
};

export const clearUpdateCatchUp = (storage: UpdateStorage): void => {
    try {
        storage.removeItem(SW_UPDATE_CATCH_UP_KEY);
    } catch {
        // Storage can be unavailable in private browsing modes.
    }
};

export const waitForServiceWorkerInstall = (
    worker: InstallingWorker,
    timeoutMs = SW_UPDATE_INSTALL_TIMEOUT_MS,
): Promise<void> => {
    if (INSTALL_COMPLETE_STATES.has(worker.state)) return Promise.resolve();

    return new Promise((resolve) => {
        const finish = () => {
            worker.removeEventListener('statechange', handleStateChange);
            clearTimeout(timeout);
            resolve();
        };
        const handleStateChange = () => {
            if (INSTALL_COMPLETE_STATES.has(worker.state)) finish();
        };
        const timeout = setTimeout(finish, timeoutMs);

        worker.addEventListener('statechange', handleStateChange);
        handleStateChange();
    });
};