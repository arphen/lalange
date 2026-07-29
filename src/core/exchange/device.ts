import { generateUUID } from '../../utils/uuid';
import type { ExchangeDeviceIdentity, ExchangeLedgerEntry } from './types';

const DEVICE_STORAGE_KEY = 'xyz-exchange-device';
const LEDGER_STORAGE_KEY = 'xyz-exchange-ledger';
const MAX_LEDGER_ENTRIES = 1000;

function inferDeviceName(): string {
    if (typeof navigator === 'undefined') return 'Browser';
    const userAgent = navigator.userAgent;

    if (/iPad/i.test(userAgent)) return 'iPad';
    if (/iPhone/i.test(userAgent)) return 'iPhone';
    if (/Android/i.test(userAgent)) return 'Android phone';
    if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
    if (/Windows/i.test(userAgent)) return 'Windows PC';
    if (/Linux/i.test(userAgent)) return 'Linux device';
    return 'Browser';
}

export function getExchangeDeviceIdentity(): ExchangeDeviceIdentity {
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored) as ExchangeDeviceIdentity;
            } catch {
                localStorage.removeItem(DEVICE_STORAGE_KEY);
            }
        }
    }

    const identity: ExchangeDeviceIdentity = {
        id: generateUUID(),
        name: inferDeviceName(),
        createdAt: Date.now(),
    };

    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(identity));
    }

    return identity;
}

export function renameExchangeDevice(name: string): ExchangeDeviceIdentity {
    const current = getExchangeDeviceIdentity();
    const next = { ...current, name: name.trim() || current.name };
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(next));
    return next;
}

export function getExchangeLedger(): ExchangeLedgerEntry[] {
    if (typeof localStorage === 'undefined') return [];

    try {
        return JSON.parse(localStorage.getItem(LEDGER_STORAGE_KEY) || '[]') as ExchangeLedgerEntry[];
    } catch {
        return [];
    }
}

export function findExchangeLedgerEntry(
    peerDeviceId: string,
    bookId: string,
): ExchangeLedgerEntry | undefined {
    return getExchangeLedger().find((entry) => (
        entry.peerDeviceId === peerDeviceId && entry.bookId === bookId
    ));
}

export function recordExchangeLedger(entries: ExchangeLedgerEntry[]): void {
    if (typeof localStorage === 'undefined' || entries.length === 0) return;

    const incomingKeys = new Set(entries.map((entry) => `${entry.peerDeviceId}:${entry.bookId}`));
    const retained = getExchangeLedger().filter((entry) => (
        !incomingKeys.has(`${entry.peerDeviceId}:${entry.bookId}`)
    ));
    const next = [...entries, ...retained]
        .sort((left, right) => right.completedAt - left.completedAt)
        .slice(0, MAX_LEDGER_ENTRIES);

    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(next));
}
