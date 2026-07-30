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

    finishInstalling(worker: FakeWorker): void {
        this.installing = null;
        this.waiting = worker;
        worker.transitionTo('installed');
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

const createHarness = (controlled = true, storage = createStorage()) => {
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

    it('offers a real waiting worker without activating it before consent', async () => {
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;

        await harness.controller.start();

        expect(harness.controller.getSnapshot().status).toBe('available');
        expect(waiting.messages).toEqual([]);
        harness.controller.dispose();
    });

    it('checks for the newest worker, activates it, and reloads once control changes', async () => {
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        await harness.controller.start();

        await harness.controller.applyUpdate();
        harness.container.changeController(waiting);
        harness.container.changeController(waiting);

        expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(harness.registration.updateCalls).toBe(2);
        expect(harness.reloadCount()).toBe(1);
        harness.controller.dispose();
    });

    it('auto-activates a worker that appears after update() already resolved', async () => {
        const harness = createHarness();
        harness.storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify({
            expiresAt: Date.now() + 60_000,
            attempts: 0,
        }));
        await harness.controller.start();
        const delayedWorker = new FakeWorker('installing');

        harness.registration.discover(delayedWorker);
        harness.registration.finishInstalling(delayedWorker);

        expect(delayedWorker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(harness.controller.getSnapshot().status).toBe('applying');
        harness.controller.dispose();
    });

    it('still activates an existing waiting worker when the network update check fails', async () => {
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        await harness.controller.start();
        harness.registration.updateImplementation = async () => {
            throw new Error('offline');
        };

        await harness.controller.applyUpdate();

        expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(harness.controller.getSnapshot().status).toBe('applying');
        harness.controller.dispose();
    });

    it('activates within the page when persistent storage is unavailable', async () => {
        const unavailableStorage: UpdateStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error('storage denied');
            },
            removeItem: () => {
                throw new Error('storage denied');
            },
        };
        const harness = createHarness(true, unavailableStorage);
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        await harness.controller.start();

        await harness.controller.applyUpdate();

        expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(harness.controller.getSnapshot().status).toBe('applying');
        harness.controller.dispose();
    });

    it('does not show an update prompt during first installation', async () => {
        const harness = createHarness(false);
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;

        await harness.controller.start();
        harness.container.changeController(waiting);

        expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(harness.controller.getSnapshot().status).toBe('idle');
        expect(harness.reloadCount()).toBe(0);
        harness.controller.dispose();
    });

    it('does not offer the same dismissed worker again during later checks', async () => {
        const harness = createHarness();
        harness.registration.waiting = new FakeWorker('installed');
        await harness.controller.start();

        harness.controller.dismiss();
        await harness.controller.checkForUpdates();

        expect(harness.controller.getSnapshot().status).toBe('idle');
        harness.controller.dispose();
    });

    it('does not reuse expired consent for a newly waiting worker', async () => {
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        harness.storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify({
            expiresAt: Date.now() - 1,
            attempts: 0,
        }));

        await harness.controller.start();

        expect(waiting.messages).toEqual([]);
        expect(harness.controller.getSnapshot().status).toBe('available');
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

    it('reloads once when another tab activates an external update', async () => {
        const harness = createHarness();
        await harness.controller.start();

        harness.container.changeController(new FakeWorker('activated'));
        harness.container.changeController(new FakeWorker('activated'));

        expect(harness.reloadCount()).toBe(1);
        harness.controller.dispose();
    });

    it('reloads as a recovery fallback when activation does not change the controller', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        await harness.controller.start();
        await harness.controller.applyUpdate();

        await vi.advanceTimersByTimeAsync(8_000);

        expect(harness.reloadCount()).toBe(1);
        harness.controller.dispose();
    });

    it('stops automatic recovery after three persisted activation attempts', async () => {
        const harness = createHarness();
        const waiting = new FakeWorker('installed');
        harness.registration.waiting = waiting;
        harness.storage.setItem(UPDATE_SESSION_STORAGE_KEY, JSON.stringify({
            expiresAt: Date.now() + 60_000,
            attempts: 3,
        }));

        await harness.controller.start();

        expect(waiting.messages).toEqual([]);
        expect(harness.controller.getSnapshot()).toMatchObject({
            status: 'error',
            attempt: 3,
        });
        harness.controller.dispose();
    });
});