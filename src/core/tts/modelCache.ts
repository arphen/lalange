const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
const MODEL_CACHE_DB_NAME = 'xyz-transformers-model-cache';
const MODEL_CACHE_STORE_NAME = 'responses';
const MODEL_CACHE_DB_VERSION = 1;

interface CachedResponseRecord {
    key: string;
    blob: Blob;
    headers: [string, string][];
    status: number;
    statusText: string;
}

type CacheKey = Request | string | URL;

function normalizeCacheKey(key: CacheKey): string {
    if (typeof key === 'string') return key;
    return key instanceof Request ? key.url : key.toString();
}

export function shouldUseLargeModelCache(key: CacheKey): boolean {
    return normalizeCacheKey(key).endsWith('/onnx/model.onnx');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

let modelCacheDatabasePromise: Promise<IDBDatabase> | null = null;

function openModelCacheDatabase(): Promise<IDBDatabase> {
    if (modelCacheDatabasePromise) return modelCacheDatabasePromise;

    modelCacheDatabasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(MODEL_CACHE_DB_NAME, MODEL_CACHE_DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(MODEL_CACHE_STORE_NAME)) {
                database.createObjectStore(MODEL_CACHE_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open model cache'));
    });

    return modelCacheDatabasePromise;
}

async function matchIndexedDB(key: string): Promise<Response | undefined> {
    if (typeof indexedDB === 'undefined') return undefined;

    const database = await openModelCacheDatabase();
    const transaction = database.transaction(MODEL_CACHE_STORE_NAME, 'readonly');
    const record = await requestResult<CachedResponseRecord | undefined>(
        transaction.objectStore(MODEL_CACHE_STORE_NAME).get(key),
    );

    if (!record) return undefined;

    return new Response(record.blob, {
        headers: record.headers,
        status: record.status,
        statusText: record.statusText,
    });
}

async function putIndexedDB(key: string, response: Response): Promise<void> {
    if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is unavailable');
    }

    const record: CachedResponseRecord = {
        key,
        blob: await response.blob(),
        headers: Array.from(response.headers.entries()),
        status: response.status,
        statusText: response.statusText,
    };
    const database = await openModelCacheDatabase();
    const transaction = database.transaction(MODEL_CACHE_STORE_NAME, 'readwrite');
    transaction.objectStore(MODEL_CACHE_STORE_NAME).put(record);
    await transactionComplete(transaction);
}

async function matchBrowserCache(key: string): Promise<Response | undefined> {
    if (typeof caches === 'undefined') return undefined;
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    return (await cache.match(key)) ?? undefined;
}

async function putBrowserCache(key: string, response: Response): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('Cache Storage is unavailable');
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    await cache.put(key, response);
}

export const transformersModelCache = {
    async match(key: CacheKey): Promise<Response | undefined> {
        const normalizedKey = normalizeCacheKey(key);
        return (await matchBrowserCache(normalizedKey)) ?? (await matchIndexedDB(normalizedKey));
    },

    async put(key: CacheKey, response: Response): Promise<void> {
        const normalizedKey = normalizeCacheKey(key);

        if (shouldUseLargeModelCache(normalizedKey)) {
            await putIndexedDB(normalizedKey, response);
            return;
        }

        try {
            await putBrowserCache(normalizedKey, response.clone());
        } catch (error) {
            console.warn('[TTS] Cache Storage write failed; using IndexedDB:', error);
            await putIndexedDB(normalizedKey, response);
        }
    },
};

export async function isTransformersFileCached(url: string): Promise<boolean> {
    return (await transformersModelCache.match(url)) !== undefined;
}

export async function clearTransformersModelCache(modelId: string): Promise<number> {
    if (typeof indexedDB === 'undefined') return 0;

    const database = await openModelCacheDatabase();
    const readTransaction = database.transaction(MODEL_CACHE_STORE_NAME, 'readonly');
    const keys = await requestResult<IDBValidKey[]>(
        readTransaction.objectStore(MODEL_CACHE_STORE_NAME).getAllKeys(),
    );
    const matchingKeys = keys.filter((key) => String(key).includes(modelId));

    if (matchingKeys.length === 0) return 0;

    const deleteTransaction = database.transaction(MODEL_CACHE_STORE_NAME, 'readwrite');
    const store = deleteTransaction.objectStore(MODEL_CACHE_STORE_NAME);
    for (const key of matchingKeys) store.delete(key);
    await transactionComplete(deleteTransaction);
    return matchingKeys.length;
}
