import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ServiceWorkerUpdateController,
    UPDATE_SESSION_STORAGE_KEY,
    type UpdateControllerDependencies,
    type UpdateRegistration,
    type UpdateStorage,
    type UpdateWorker,
    type UpdateWorkerContainer,
} from './updateController';

const LEGACY_UPDATE_STORAGE_KEY = 'arphen:sw-update-catch-up-until';

class FakeWorker extends EventTarget implements UpdateWorker {
    state: ServiceWorkerState;
    readonly messages: unknown[] = [];

    constructor(state: ServiceWorkerState) {
        super();
        this.state = state;
    }

    postMessage(message: unknown): void {
        this.messages.push(message);
    }

    transitionTo(state: ServiceWorkerState): void {
        this.state = state;
        this.dispatchEvent(new Event('statechange'));
    }
}

class FakeRegistration extends EventTarget implements UpdateRegistration {
    active: FakeWorker | null = new FakeWorker('activated');
    installing: FakeWorker | null = null;
    waiting: FakeWorker | null = null;
    updateCalls = 0;
    updateImplementation: () => Promise<unknown> = async () => undefined;

    async update(): Promise<unknown> {
        this.updateCalls += 1;
        return this.updateImplementation();
    }

    discover(worker: FakeWorker): void {
        this.installing = worker;
        this.dispatchEvent(new Event('updatefound'));
    }
}

class FakeWorkerContainer extends EventTarget implements UpdateWorkerContainer {
    controller: FakeWorker | null = new FakeWorker('activated');
    readonly registration: FakeRegistration;
    registerCalls = 0;
    registerOptions: { scope: string; updateViaCache: ServiceWorkerUpdateViaCache } | null = null;

    constructor(registration: FakeRegistration) {
        super();
        this.registration = registration;
    }

    async register(
        _scriptURL: string,
        options: { scope: string; updateViaCache: ServiceWorkerUpdateViaCache },
    ): Promise<UpdateRegistration> {
        this.registerCalls += 1;
        this.registerOptions = options;
        return this.registration;
    }

    changeController(controller: FakeWorker): void {
        this.controller = controller;
        this.dispatchEvent(new Event('controllerchange'));
    }
}

const createStorage = (): UpdateStorage => {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
};

const createHarness = (
    controlled = true,
    storage = createStorage(),
    proposedHash = 'abcdef1',
    getDeploymentMetadata = async () => ({ hash: proposedHash }),
) => {
    const registration = new FakeRegistration();
    const container = new FakeWorkerContainer(registration);
    if (!controlled) {
        container.controller = null;
        registration.active = null;
    }
    let reloads = 0;
    const dependencies: UpdateControllerDependencies = {
        serviceWorker: container,
        storage,
        currentHash: '8f0573a',
        getDeploymentMetadata,
        now: () => Date.now(),
        reload: () => {
            reloads += 1;
        },
        setInterval: (callback, delay) => window.setInterval(callback, delay),
        clearInterval: (handle) => window.clearInterval(handle as number),
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
    };
    const controller = new ServiceWorkerUpdateController(dependencies);

    return {
        controller,
        registration,
        container,
        storage,
        reloadCount: () => reloads,
    };
};

const installAndTakeControl = (
    harness: ReturnType<typeof createHarness>,
    dispatchControllerChange = true,
): FakeWorker => {
    const worker = new FakeWorker('installing');
    harness.registration.discover(worker);
    harness.registration.installing = null;
    harness.registration.waiting = null;
    harness.registration.active = worker;
    harness.container.controller = worker;
    worker.transitionTo('activated');
    if (dispatchControllerChange) {
        harness.container.dispatchEvent(new Event('controllerchange'));
    }
    return worker;
};

afterEach(() => {
    vi.useRealTimers();
});

describe('ServiceWorkerUpdateController', () => {
    it('owns one cache-bypassing registration even when started repeatedly', async () => {
        const harness = createHarness();

        await Promise.all([harness.controller.start(), harness.controller.start()]);

        expect(harness.container.registerCalls).toBe(1);
        expect(harness.container.registerOptions).toEqual({ scope: '/', updateViaCache: 'none' });
        expect(harness.registration.updateCalls).toBe(1);
        harness.controller.dispose();
    });

    it('clears obsolete retry state from an existing installation', async () => {
        const storage = createStorage();
        storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify({
            expiresAt: Date.now() + 60_000,
            attempts: 3,
        }));
        storage.setItem(LEGACY_UPDATE_STORAGE_KEY, String(Date.now() + 60_000));
        const harness = createHarness(true, storage);
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;

        await harness.controller.start();

        expect(storage.getItem(UPDATE_SESSION_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(LEGACY_UPDATE_STORAGE_KEY)).toBeNull();
        expect(waiting.messages).toEqual([]);
        expect(harness.controller.getSnapshot().status).toBe('idle');
        harness.controller.dispose();
    });

    it('never reloads merely because an old worker remains waiting', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;

        await harness.controller.start();
        await harness.controller.applyUpdate();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(waiting.messages).toEqual([]);
        expect(harness.reloadCount()).toBe(0);
        harness.controller.dispose();
    });

    it('prompts with the proposed hash after autonomous takeover, then reloads once', async () => {
        const getDeploymentMetadata = vi.fn(async () => ({ hash: 'abcdef1' }));
        const harness = createHarness(true, createStorage(), 'abcdef1', getDeploymentMetadata);
        await harness.controller.start();

        const worker = installAndTakeControl(harness);
        harness.container.dispatchEvent(new Event('controllerchange'));
        await vi.waitFor(() => expect(harness.controller.getSnapshot().status).toBe('available'));

        expect(worker.messages).toEqual([]);
        expect(getDeploymentMetadata).toHaveBeenCalledWith(worker);
        expect(harness.controller.getSnapshot()).toMatchObject({
            hash: 'abcdef1',
            changelogUrl: 'https://github.com/arpheno/lalange/compare/8f0573a...abcdef1',
        });
        expect(harness.reloadCount()).toBe(0);

        await harness.controller.applyUpdate();

        expect(harness.reloadCount()).toBe(1);
        harness.controller.dispose();
    });

    it('detects a confirmed takeover even when controllerchange is not emitted', async () => {
        const harness = createHarness();
        await harness.controller.start();

        const worker = installAndTakeControl(harness, false);
        await vi.waitFor(() => expect(harness.controller.getSnapshot().status).toBe('available'));

        expect(worker.messages).toEqual([]);
        expect(harness.controller.getSnapshot().hash).toBe('abcdef1');
        expect(harness.reloadCount()).toBe(0);
        harness.controller.dispose();
    });

    it('does not reload when the first service worker claims a fresh page', async () => {
        const harness = createHarness(false);
        await harness.controller.start();

        const worker = installAndTakeControl(harness);

        expect(worker.messages).toEqual([]);
        expect(harness.reloadCount()).toBe(0);
        harness.controller.dispose();
    });

    it('does not carry an attempt budget across successive deployed workers', async () => {
        const storage = createStorage();
        storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify({
            expiresAt: Date.now() + 60_000,
            attempts: 3,
        }));

        for (let generation = 0; generation < 5; generation += 1) {
            const proposedHash = `abcde${generation}1`;
            const harness = createHarness(true, storage, proposedHash);
            await harness.controller.start();
            installAndTakeControl(harness);
            await vi.waitFor(() => expect(harness.controller.getSnapshot().status).toBe('available'));

            expect(storage.getItem(UPDATE_SESSION_STORAGE_KEY)).toBeNull();
            expect(harness.controller.getSnapshot().hash).toBe(proposedHash);
            expect(harness.reloadCount()).toBe(0);

            await harness.controller.applyUpdate();

            expect(harness.reloadCount()).toBe(1);
            harness.controller.dispose();
        }
    });

    it('shows only the latest hash when another worker takes over during metadata loading', async () => {
        let metadataCalls = 0;
        let resolveFirstMetadata: (metadata: { hash: string }) => void = () => undefined;
        const getDeploymentMetadata = vi.fn(() => {
            metadataCalls += 1;
            if (metadataCalls === 1) {
                return new Promise<{ hash: string }>((resolve) => {
                    resolveFirstMetadata = resolve;
                });
            }
            return Promise.resolve({ hash: '2222222' });
        });
        const harness = createHarness(true, createStorage(), 'unused1', getDeploymentMetadata);
        await harness.controller.start();

        installAndTakeControl(harness);
        await vi.waitFor(() => expect(getDeploymentMetadata).toHaveBeenCalledTimes(1));
        installAndTakeControl(harness);
        resolveFirstMetadata({ hash: '1111111' });

        await vi.waitFor(() => expect(harness.controller.getSnapshot().hash).toBe('2222222'));
        expect(getDeploymentMetadata).toHaveBeenCalledTimes(2);
        expect(harness.controller.getSnapshot().changelogUrl).toContain('2222222');
        harness.controller.dispose();
    });

    it('deduplicates overlapping network update checks', async () => {
        const harness = createHarness();
        await harness.controller.start();
        let resolveUpdate: () => void = () => undefined;
        harness.registration.updateImplementation = () => new Promise<void>((resolve) => {
            resolveUpdate = resolve;
        });

        const firstCheck = harness.controller.checkForUpdates();
        const secondCheck = harness.controller.checkForUpdates();
        await Promise.resolve();

        expect(firstCheck).toBe(secondCheck);
        expect(harness.registration.updateCalls).toBe(2);
        resolveUpdate();
        await Promise.all([firstCheck, secondCheck]);
        harness.controller.dispose();
    });

    it('does not reload when an update check times out without a takeover', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.controller.start();
        harness.registration.updateImplementation = () => new Promise(() => undefined);

        const check = harness.controller.checkForUpdates();
        await vi.advanceTimersByTimeAsync(15_000);
        await check;

        expect(harness.reloadCount()).toBe(0);
        harness.controller.dispose();
    });
});