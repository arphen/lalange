import {
    ServiceWorkerUpdateController,
    type UpdateStorage,
    type UpdateWorkerContainer,
} from './updateController';

const safeStorage: UpdateStorage = {
    getItem: (key) => {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    setItem: (key, value) => {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // Storage can be unavailable in private browsing modes.
        }
    },
    removeItem: (key) => {
        try {
            window.localStorage.removeItem(key);
        } catch {
            // Storage can be unavailable in private browsing modes.
        }
    },
};

const serviceWorker = 'serviceWorker' in navigator
    ? navigator.serviceWorker as unknown as UpdateWorkerContainer
    : null;
const currentHash = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'unknown';

export const pwaUpdateController = new ServiceWorkerUpdateController({
    serviceWorker,
    storage: safeStorage,
    currentHash,
    getDeploymentMetadata: async () => {
        const response = await fetch('/version.json', { cache: 'reload' });
        if (!response.ok) {
            throw new Error(`Update metadata request failed (${response.status}).`);
        }
        return response.json() as Promise<{ hash: string }>;
    },
    now: () => Date.now(),
    reload: () => window.location.reload(),
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    log: (message, error) => {
        if (error === undefined) {
            console.log(`[SW] ${message}`);
        } else {
            console.error(`[SW] ${message}:`, error);
        }
    },
});