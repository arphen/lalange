import { afterEach, describe, expect, it, vi } from 'vitest';

const matchAllDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'matchAll');
const readableStreamAsyncIteratorDescriptor = Object.getOwnPropertyDescriptor(
    ReadableStream.prototype,
    Symbol.asyncIterator,
);

const restoreMatchAll = () => {
    if (matchAllDescriptor) {
        Object.defineProperty(String.prototype, 'matchAll', matchAllDescriptor);
    } else {
        Reflect.deleteProperty(String.prototype, 'matchAll');
    }
};

const restoreReadableStreamAsyncIterator = () => {
    if (readableStreamAsyncIteratorDescriptor) {
        Object.defineProperty(
            ReadableStream.prototype,
            Symbol.asyncIterator,
            readableStreamAsyncIteratorDescriptor,
        );
    } else {
        Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
    }
};

describe('runtime compatibility', () => {
    afterEach(() => {
        restoreMatchAll();
        restoreReadableStreamAsyncIterator();
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

    it('makes readable streams async iterable for Kokoro decompression', async () => {
        Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
            configurable: true,
            writable: true,
            value: undefined,
        });
        vi.resetModules();

        await import('./runtimeCompatibility');

        const stream = new ReadableStream<string>({
            start(controller) {
                controller.enqueue('voice');
                controller.close();
            },
        }) as ReadableStream<string> & AsyncIterable<string>;
        const chunks: string[] = [];

        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['voice']);
    });
});