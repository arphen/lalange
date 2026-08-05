import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'

const storageValues = new Map<string, string>()
const testLocalStorage: Storage = {
    get length() {
        return storageValues.size
    },
    clear() {
        storageValues.clear()
    },
    getItem(key) {
        return storageValues.get(key) ?? null
    },
    key(index) {
        return Array.from(storageValues.keys())[index] ?? null
    },
    removeItem(key) {
        storageValues.delete(key)
    },
    setItem(key, value) {
        storageValues.set(key, value)
    },
}

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: testLocalStorage,
    })
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: testLocalStorage,
    })
}

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = function () { };

// jsdom's Blob predates Blob.arrayBuffer(), which every supported browser has.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
        });
    };
}
