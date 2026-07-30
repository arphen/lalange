export const UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 15 * 1000;
export const UPDATE_SESSION_STORAGE_KEY = 'arphen:sw-update-session';

const LEGACY_UPDATE_STORAGE_KEY = 'arphen:sw-update-catch-up-until';

export type UpdateStatus = 'idle' | 'available' | 'applying' | 'error';

export interface UpdateSnapshot {
    status: UpdateStatus;
    attempt: number;
    error: string | null;
    hash: string | null;
    changelogUrl: string | null;
}

export interface DeploymentMetadata {
    hash: string;
}

export interface UpdateWorker {
    readonly state: ServiceWorkerState;
    postMessage(message: unknown): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
}

export interface UpdateRegistration {
    readonly active: UpdateWorker | null;
    readonly installing: UpdateWorker | null;
    readonly waiting: UpdateWorker | null;
    update(): Promise<unknown>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
}

export interface UpdateWorkerContainer {
    readonly controller: UpdateWorker | null;
    register(
        scriptURL: string,
        options: { scope: string; updateViaCache: ServiceWorkerUpdateViaCache },
    ): Promise<UpdateRegistration>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
}

export interface UpdateStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface UpdateControllerDependencies {
    serviceWorker: UpdateWorkerContainer | null;
    storage: UpdateStorage;
    currentHash: string;
    getDeploymentMetadata: () => Promise<DeploymentMetadata>;
    now: () => number;
    reload: () => void;
    setInterval: (callback: () => void, delay: number) => unknown;
    clearInterval: (handle: unknown) => void;
    setTimeout: (callback: () => void, delay: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    log?: (message: string, error?: unknown) => void;
}

export interface UpdateControllerOptions {
    pollIntervalMs?: number;
    updateCheckTimeoutMs?: number;
}

const IDLE_SNAPSHOT: UpdateSnapshot = Object.freeze({
    status: 'idle',
    attempt: 0,
    error: null,
    hash: null,
    changelogUrl: null,
});

const GITHUB_REPOSITORY_URL = 'https://github.com/arpheno/lalange';

const errorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);

export class ServiceWorkerUpdateController {
    private readonly dependencies: UpdateControllerDependencies;
    private readonly pollIntervalMs: number;
    private readonly updateCheckTimeoutMs: number;
    private readonly listeners = new Set<() => void>();
    private readonly workerStateListeners = new Map<UpdateWorker, EventListener>();
    private snapshot: UpdateSnapshot = IDLE_SNAPSHOT;
    private registration: UpdateRegistration | null = null;
    private startPromise: Promise<void> | null = null;
    private updateCheckPromise: Promise<void> | null = null;
    private pollHandle: unknown = null;
    private initialController: UpdateWorker | null = null;
    private metadataController: UpdateWorker | null = null;
    private pendingMetadataLoad: Promise<void> | null = null;
    private controllerListenerAttached = false;
    private reloadStarted = false;

    constructor(
        dependencies: UpdateControllerDependencies,
        options: UpdateControllerOptions = {},
    ) {
        this.dependencies = dependencies;
        this.pollIntervalMs = options.pollIntervalMs ?? UPDATE_POLL_INTERVAL_MS;
        this.updateCheckTimeoutMs = options.updateCheckTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
    }

    getSnapshot = (): UpdateSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    start = (): Promise<void> => {
        this.startPromise ??= this.startInternal();
        return this.startPromise;
    };

    checkForUpdates = (): Promise<void> => {
        if (!this.registration) return Promise.resolve();
        if (this.updateCheckPromise) return this.updateCheckPromise;

        const registration = this.registration;
        this.updateCheckPromise = this.settleWithTimeout(
            Promise.resolve().then(() => registration.update()),
            this.updateCheckTimeoutMs,
            'Service worker update check failed or timed out',
        ).finally(() => {
            this.updateCheckPromise = null;
            this.inspectRegistration();
        });

        return this.updateCheckPromise;
    };

    applyUpdate = async (): Promise<void> => {
        if (this.snapshot.status === 'available') {
            this.reloadOnce();
            return;
        }
        await this.checkForUpdates();
    };

    retry = async (): Promise<void> => {
        if (!this.registration) {
            this.startPromise = null;
            this.setSnapshot('idle', 0, null);
            await this.start();
            return;
        }

        if (this.snapshot.status === 'error' && this.metadataController) {
            await this.loadUpdateMetadata();
        } else {
            this.setSnapshot('idle', 0, null);
            await this.checkForUpdates();
        }
    };

    dismiss = (): void => {
        this.setSnapshot('idle', 0, null);
    };

    dispose = (): void => {
        const serviceWorker = this.dependencies.serviceWorker;
        if (serviceWorker && this.controllerListenerAttached) {
            serviceWorker.removeEventListener('controllerchange', this.handleControllerChange);
        }
        this.registration?.removeEventListener('updatefound', this.handleUpdateFound);
        this.workerStateListeners.forEach((listener, worker) => {
            worker.removeEventListener('statechange', listener);
        });
        this.workerStateListeners.clear();
        if (this.pollHandle !== null) this.dependencies.clearInterval(this.pollHandle);
    };

    private startInternal = async (): Promise<void> => {
        const serviceWorker = this.dependencies.serviceWorker;
        if (!serviceWorker) return;

        this.clearObsoleteUpdateState();
        this.initialController = serviceWorker.controller;
        if (!this.controllerListenerAttached) {
            serviceWorker.addEventListener('controllerchange', this.handleControllerChange);
            this.controllerListenerAttached = true;
        }

        try {
            const registration = await serviceWorker.register('/sw.js', {
                scope: '/',
                updateViaCache: 'none',
            });
            this.registration = registration;
            this.dependencies.log?.('Update controller registered');
            registration.addEventListener('updatefound', this.handleUpdateFound);
            this.inspectRegistration();

            this.pollHandle ??= this.dependencies.setInterval(() => {
                void this.checkForUpdates();
            }, this.pollIntervalMs);

            await this.checkForUpdates();
        } catch (error) {
            this.dependencies.log?.('Service worker registration failed', error);
            this.setSnapshot('error', 0, errorMessage(error));
        }
    };

    private handleUpdateFound: EventListener = () => {
        this.inspectRegistration();
    };

    private handleControllerChange: EventListener = () => {
        this.inspectController();
    };

    private inspectRegistration = (): void => {
        const registration = this.registration;
        if (!registration) return;

        this.observeWorker(registration.active);
        this.observeWorker(registration.installing);
        this.observeWorker(registration.waiting);
        this.inspectController();
    };

    private observeWorker = (worker: UpdateWorker | null): void => {
        if (!worker || worker.state === 'redundant' || this.workerStateListeners.has(worker)) return;

        const listener: EventListener = () => {
            if (worker.state === 'redundant') {
                worker.removeEventListener('statechange', listener);
                this.workerStateListeners.delete(worker);
            }
            this.inspectRegistration();
        };
        this.workerStateListeners.set(worker, listener);
        worker.addEventListener('statechange', listener);
    };

    private inspectController = (): void => {
        const controller = this.dependencies.serviceWorker?.controller ?? null;
        if (!controller) return;

        if (!this.initialController) {
            this.initialController = controller;
            this.dependencies.log?.('First service worker took control');
            return;
        }

        if (controller === this.initialController) return;

        this.initialController = controller;
        this.metadataController = controller;
        this.dependencies.log?.('Updated service worker took control');
        void this.loadUpdateMetadata();
    };

    private loadUpdateMetadata = (): Promise<void> => {
        const targetController = this.metadataController;
        if (!targetController) return Promise.resolve();
        if (this.pendingMetadataLoad) return this.pendingMetadataLoad;

        this.setSnapshot('applying', 0, null);
        this.pendingMetadataLoad = Promise.resolve()
            .then(() => this.dependencies.getDeploymentMetadata())
            .then(({ hash }) => {
                if (this.metadataController !== targetController) return;
                if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
                    throw new Error('The update did not provide a valid deployment hash.');
                }

                const currentHash = this.dependencies.currentHash;
                const changelogUrl = /^[0-9a-f]{7,40}$/i.test(currentHash) && currentHash !== hash
                    ? `${GITHUB_REPOSITORY_URL}/compare/${currentHash}...${hash}`
                    : `${GITHUB_REPOSITORY_URL}/commit/${hash}`;
                this.setSnapshot('available', 0, null, hash, changelogUrl);
            })
            .catch((error) => {
                if (this.metadataController === targetController) {
                    this.setSnapshot('error', 0, errorMessage(error));
                }
            })
            .finally(() => {
                this.pendingMetadataLoad = null;
                if (this.metadataController !== targetController) {
                    void this.loadUpdateMetadata();
                }
            });
        return this.pendingMetadataLoad;
    };

    private reloadOnce = (): void => {
        if (this.reloadStarted) return;

        this.reloadStarted = true;
        try {
            this.dependencies.log?.('Reloading into updated application');
            this.dependencies.reload();
        } catch (error) {
            this.reloadStarted = false;
            this.setSnapshot('error', 0, errorMessage(error));
        }
    };

    private clearObsoleteUpdateState = (): void => {
        try {
            this.dependencies.storage.removeItem(UPDATE_SESSION_STORAGE_KEY);
            this.dependencies.storage.removeItem(LEGACY_UPDATE_STORAGE_KEY);
        } catch {
            // Storage can be unavailable in private browsing modes.
        }
    };

    private settleWithTimeout = (
        operation: Promise<unknown>,
        timeoutMs: number,
        timeoutMessage: string,
    ): Promise<void> => new Promise((resolve) => {
        let settled = false;
        const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            this.dependencies.clearTimeout(timeoutHandle);
            if (error !== undefined) this.dependencies.log?.(timeoutMessage, error);
            resolve();
        };
        const timeoutHandle = this.dependencies.setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
        operation.then(() => finish(), (error) => finish(error));
    });

    private setSnapshot = (
        status: UpdateStatus,
        attempt: number,
        error: string | null,
        hash: string | null = null,
        changelogUrl: string | null = null,
    ): void => {
        if (
            this.snapshot.status === status
            && this.snapshot.attempt === attempt
            && this.snapshot.error === error
            && this.snapshot.hash === hash
            && this.snapshot.changelogUrl === changelogUrl
        ) return;

        this.snapshot = Object.freeze({ status, attempt, error, hash, changelogUrl });
        this.listeners.forEach((listener) => listener());
    };
}