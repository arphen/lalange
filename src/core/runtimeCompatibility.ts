import 'core-js/features/string/match-all';
import 'core-js/features/array/at';

const readableStreamPrototype = globalThis.ReadableStream?.prototype as
	| (ReadableStream<unknown> & {
		  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
	  })
	| undefined;

if (readableStreamPrototype && typeof readableStreamPrototype[Symbol.asyncIterator] !== 'function') {
	Object.defineProperty(readableStreamPrototype, Symbol.asyncIterator, {
		configurable: true,
		writable: true,
		async *value() {
			const reader = this.getReader();

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) return;
					yield value;
				}
			} finally {
				reader.releaseLock();
			}
		},
	});
}