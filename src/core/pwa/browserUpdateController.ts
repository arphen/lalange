import {
    ServiceWorkerUpdateController,
    type UpdateStorage,
    type UpdateWorker,
    type UpdateWorkerContainer,
} from './updateController';
import { GET_DEPLOYMENT_METADATA, type DeploymentMetadata } from './updateProtocol';

const DEPLOYMENT_METADATA_TIMEOUT_MS = 5_000;

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

const getDeploymentMetadata = (worker: UpdateWorker): Promise<DeploymentMetadata> => (
    new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeoutHandle = window.setTimeout(() => {
            channel.port1.close();
            reject(new Error('The controlling worker did not identify its deployment.'));
        }, DEPLOYMENT_METADATA_TIMEOUT_MS);

        channel.port1.onmessage = (event: MessageEvent<DeploymentMetadata>) => {
            window.clearTimeout(timeoutHandle);
            channel.port1.close();
            resolve(event.data);
        };

        try {
            worker.postMessage({ type: GET_DEPLOYMENT_METADATA }, [channel.port2]);
        } catch (error) {
            window.clearTimeout(timeoutHandle);
            channel.port1.close();
            reject(error);
        }
    })
);

export const pwaUpdateController = new ServiceWorkerUpdateController({
    serviceWorker,
    storage: safeStorage,
    currentHash,
    getDeploymentMetadata,
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