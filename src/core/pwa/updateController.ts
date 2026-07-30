export const UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const UPDATE_CONSENT_TTL_MS = 30 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 15 * 1000;
export const UPDATE_ACTIVATION_TIMEOUT_MS = 8 * 1000;
export const UPDATE_MAX_ACTIVATION_ATTEMPTS = 3;
export const UPDATE_SESSION_STORAGE_KEY = 'arphen:sw-update-session';

const LEGACY_UPDATE_STORAGE_KEY = 'arphen:sw-update-catch-up-until';
const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

export type UpdateStatus = 'idle' | 'available' | 'applying' | 'error';

export interface UpdateSnapshot {
    status: UpdateStatus;
    attempt: number;
    error: string | null;
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
    consentTtlMs?: number;
    updateCheckTimeoutMs?: number;
    activationTimeoutMs?: number;
    maxActivationAttempts?: number;
}

interface UpdateSession {
    expiresAt: number;
    attempts: number;
}

const IDLE_SNAPSHOT: UpdateSnapshot = Object.freeze({
    status: 'idle',
    attempt: 0,
    error: null,
});

const errorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);

export class ServiceWorkerUpdateController {
    private readonly dependencies: UpdateControllerDependencies;
    private readonly pollIntervalMs: number;
    private readonly consentTtlMs: number;
    private readonly updateCheckTimeoutMs: number;
    private readonly activationTimeoutMs: number;
    private readonly maxActivationAttempts: number;
    private readonly listeners = new Set<() => void>();
    private readonly workerStateListeners = new Map<UpdateWorker, EventListener>();
    private snapshot: UpdateSnapshot = IDLE_SNAPSHOT;
    private registration: UpdateRegistration | null = null;
    private startPromise: Promise<void> | null = null;
    private updateCheckPromise: Promise<void> | null = null;
    private pollHandle: unknown = null;
    private activationTimeoutHandle: unknown = null;
    private applyingWorker: UpdateWorker | null = null;
    private dismissedWorker: UpdateWorker | null = null;
    private hasControlledPage = false;
    private controllerListenerAttached = false;
    private reloadStarted = false;
    private volatileUpdateSession: UpdateSession | null = null;

    constructor(
        dependencies: UpdateControllerDependencies,
        options: UpdateControllerOptions = {},
    ) {
        this.dependencies = dependencies;
        this.pollIntervalMs = options.pollIntervalMs ?? UPDATE_POLL_INTERVAL_MS;
        this.consentTtlMs = options.consentTtlMs ?? UPDATE_CONSENT_TTL_MS;
        this.updateCheckTimeoutMs = options.updateCheckTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
        this.activationTimeoutMs = options.activationTimeoutMs ?? UPDATE_ACTIVATION_TIMEOUT_MS;
        this.maxActivationAttempts = options.maxActivationAttempts ?? UPDATE_MAX_ACTIVATION_ATTEMPTS;
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
        if (!this.registration) {
            this.setSnapshot('error', 0, 'The update service is not registered.');
            return;
        }

        this.beginUpdateSession();
        this.setSnapshot('applying', 0, null);
        await this.checkForUpdates();
        this.inspectRegistration();
        this.activateWaitingWorker(this.registration.waiting);
    };

    retry = async (): Promise<void> => {
        if (!this.registration) {
            this.startPromise = null;
            this.setSnapshot('idle', 0, null);
            await this.start();
            return;
        }

        await this.applyUpdate();
    };

    dismiss = (): void => {
        this.dismissedWorker = this.registration?.waiting ?? null;
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
        this.clearActivationTimeout();
    };

    private startInternal = async (): Promise<void> => {
        const serviceWorker = this.dependencies.serviceWorker;
        if (!serviceWorker) return;

        this.hasControlledPage = Boolean(serviceWorker.controller);
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
        this.clearActivationTimeout();
        this.applyingWorker = null;

        if (!this.hasControlledPage) {
            this.hasControlledPage = true;
            this.dependencies.log?.('First service worker took control');
            this.setSnapshot('idle', 0, null);
            return;
        }

        this.dependencies.log?.('Updated service worker took control');
        this.reloadOnce();
    };

    private inspectRegistration = (): void => {
        const registration = this.registration;
        if (!registration) return;

        this.observeWorker(registration.installing);
        this.observeWorker(registration.waiting);

        if (registration.waiting) {
            this.handleWaitingWorker(registration.waiting);
        } else if (this.snapshot.status === 'available') {
            this.setSnapshot('idle', 0, null);
        }
    };

    private observeWorker = (worker: UpdateWorker | null): void => {
        if (!worker || this.workerStateListeners.has(worker)) return;

        const listener: EventListener = () => {
            if (worker.state === 'redundant' && this.applyingWorker === worker) {
                this.clearActivationTimeout();
                this.applyingWorker = null;
                this.clearUpdateSession();
                this.setSnapshot('error', 0, 'The downloaded update became invalid before activation.');
            }

            if (worker.state === 'redundant') {
                worker.removeEventListener('statechange', listener);
                this.workerStateListeners.delete(worker);
                return;
            }
            this.inspectRegistration();
        };
        this.workerStateListeners.set(worker, listener);
        worker.addEventListener('statechange', listener);
    };

    private handleWaitingWorker = (worker: UpdateWorker): void => {
        if (worker.state === 'redundant' || this.applyingWorker === worker) return;

        if (!this.hasControlledPage) {
            this.applyingWorker = worker;
            this.dependencies.log?.('Activating first service worker');
            this.postSkipWaiting(worker);
            return;
        }

        const updateSession = this.readUpdateSession();
        if (updateSession) {
            this.setSnapshot('applying', updateSession.attempts, null);
            this.activateWaitingWorker(worker);
            return;
        }

        if (this.dismissedWorker !== worker) {
            if (this.snapshot.status !== 'available') this.dependencies.log?.('Update available');
            this.setSnapshot('available', 0, null);
        }
    };

    private activateWaitingWorker = (worker: UpdateWorker | null): void => {
        if (!worker || worker.state === 'redundant' || this.applyingWorker === worker) return;

        const session = this.incrementActivationAttempt();
        if (!session) return;
        if (session.attempts > this.maxActivationAttempts) {
            this.dismissedWorker = worker;
            this.clearUpdateSession();
            this.setSnapshot(
                'error',
                this.maxActivationAttempts,
                `The update could not take control after ${this.maxActivationAttempts} attempts.`,
            );
            return;
        }

        this.applyingWorker = worker;
        this.dependencies.log?.(`Activating update (attempt ${session.attempts})`);
        this.setSnapshot('applying', session.attempts, null);
        this.clearActivationTimeout();
        this.activationTimeoutHandle = this.dependencies.setTimeout(() => {
            if (this.applyingWorker !== worker) return;
            this.dependencies.log?.('Service worker activation timed out; reloading for recovery');
            this.reloadOnce();
        }, this.activationTimeoutMs);

        try {
            this.postSkipWaiting(worker);
        } catch (error) {
            this.clearActivationTimeout();
            this.applyingWorker = null;
            this.clearUpdateSession();
            this.setSnapshot('error', session.attempts, errorMessage(error));
        }
    };

    private postSkipWaiting = (worker: UpdateWorker): void => {
        worker.postMessage(SKIP_WAITING_MESSAGE);
    };

    private reloadOnce = (): void => {
        if (this.reloadStarted) return;

        this.reloadStarted = true;
        try {
            this.dependencies.log?.('Reloading into updated application');
            this.dependencies.reload();
        } catch (error) {
            this.reloadStarted = false;
            this.clearUpdateSession();
            this.setSnapshot('error', 0, errorMessage(error));
        }
    };

    private clearActivationTimeout = (): void => {
        if (this.activationTimeoutHandle === null) return;
        this.dependencies.clearTimeout(this.activationTimeoutHandle);
        this.activationTimeoutHandle = null;
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

    private beginUpdateSession = (): void => {
        this.writeUpdateSession({
            expiresAt: this.dependencies.now() + this.consentTtlMs,
            attempts: 0,
        });
    };

    private incrementActivationAttempt = (): UpdateSession | null => {
        const session = this.readUpdateSession();
        if (!session) return null;

        const nextSession = { ...session, attempts: session.attempts + 1 };
        this.writeUpdateSession(nextSession);
        return nextSession;
    };

    private readUpdateSession = (): UpdateSession | null => {
        let session = this.volatileUpdateSession;
        try {
            const current = this.dependencies.storage.getItem(UPDATE_SESSION_STORAGE_KEY);
            const legacy = this.dependencies.storage.getItem(LEGACY_UPDATE_STORAGE_KEY);

            if (current) {
                const parsed = JSON.parse(current) as Partial<UpdateSession>;
                if (Number.isFinite(parsed.expiresAt) && Number.isFinite(parsed.attempts)) {
                    session = {
                        expiresAt: Number(parsed.expiresAt),
                        attempts: Number(parsed.attempts),
                    };
                }
            } else if (legacy && Number.isFinite(Number(legacy))) {
                session = { expiresAt: Number(legacy), attempts: 0 };
                this.writeUpdateSession(session);
                this.dependencies.storage.removeItem(LEGACY_UPDATE_STORAGE_KEY);
            }
        } catch {
            // Retain the in-memory session when persistent storage is unavailable.
        }

        if (!session || session.expiresAt <= this.dependencies.now()) {
            this.clearUpdateSession();
            return null;
        }

        this.volatileUpdateSession = session;
        return session;
    };

    private writeUpdateSession = (session: UpdateSession): void => {
        this.volatileUpdateSession = session;
        try {
            this.dependencies.storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify(session));
        } catch {
            // Storage can be unavailable in private browsing modes.
        }
    };

    private clearUpdateSession = (): void => {
        this.volatileUpdateSession = null;
        try {
            this.dependencies.storage.removeItem(UPDATE_SESSION_STORAGE_KEY);
            this.dependencies.storage.removeItem(LEGACY_UPDATE_STORAGE_KEY);
        } catch {
            // Storage can be unavailable in private browsing modes.
        }
    };

    private setSnapshot = (status: UpdateStatus, attempt: number, error: string | null): void => {
        if (
            this.snapshot.status === status
            && this.snapshot.attempt === attempt
            && this.snapshot.error === error
        ) return;

        this.snapshot = Object.freeze({ status, attempt, error });
        this.listeners.forEach((listener) => listener());
    };
}