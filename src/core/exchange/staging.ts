import type { ExchangeBundle } from './types';
import { validateExchangeBundle } from './validate';

const DATABASE_NAME = 'xyz_exchange_staging';
const STORE_NAME = 'bundles';

function openStagingDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
}

export async function stageExchangeBundle(bundle: ExchangeBundle): Promise<void> {
    await validateExchangeBundle(bundle);
    const db = await openStagingDatabase();

    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(bundle, bundle.manifest.exchangeId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    db.close();
}

export async function getStagedExchangeBundle(exchangeId: string): Promise<ExchangeBundle | undefined> {
    const db = await openStagingDatabase();
    const result = await new Promise<ExchangeBundle | undefined>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(exchangeId);
        request.onsuccess = () => resolve(request.result as ExchangeBundle | undefined);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
}

export async function discardStagedExchangeBundle(exchangeId: string): Promise<void> {
    const db = await openStagingDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(exchangeId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    db.close();
}
