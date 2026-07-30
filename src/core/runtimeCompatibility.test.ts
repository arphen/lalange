import { afterEach, describe, expect, it, vi } from 'vitest';

const matchAllDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'matchAll');

const restoreMatchAll = () => {
    if (matchAllDescriptor) {
        Object.defineProperty(String.prototype, 'matchAll', matchAllDescriptor);
    } else {
        Reflect.deleteProperty(String.prototype, 'matchAll');
    }
};

describe('runtime compatibility', () => {
    afterEach(() => {
        restoreMatchAll();
        vi.resetModules();
    });

    it('installs the built-ins required by the Kokoro phonemizer', async () => {
        Object.defineProperty(String.prototype, 'matchAll', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        vi.resetModules();

        await import('./runtimeCompatibility');

        expect(typeof String.prototype.matchAll).toBe('function');
        expect(Array.from('aba'.matchAll(/a/g), (match) => match.index)).toEqual([0, 2]);
        expect([1, 2, 3].at(-1)).toBe(3);
    });
});