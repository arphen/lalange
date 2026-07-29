import { describe, expect, it } from 'vitest';
import { validateExchangeBundle } from './validate';
import { EXCHANGE_PROTOCOL_VERSION, type ExchangeBundle, type ExchangeIntent } from './types';

function emptyBundle(intent: ExchangeIntent): ExchangeBundle {
    return {
        manifest: {
            protocolVersion: EXCHANGE_PROTOCOL_VERSION,
            exchangeId: 'exchange',
            intent,
            scope: 'selection',
            sourceDevice: { id: 'device', name: 'Device', createdAt: 1 },
            createdAt: 100,
            expiresAt: 200,
            selection: {
                content: true,
                analysis: false,
                progress: false,
                highlights: false,
                listening: false,
            },
            books: [],
        },
        books: [],
    };
}

describe('exchange bundle validation', () => {
    it('accepts an empty reconciliation receipt', async () => {
        await expect(validateExchangeBundle(emptyBundle('reconcile'), 150)).resolves.toBeUndefined();
    });

    it('rejects an empty gift', async () => {
        await expect(validateExchangeBundle(emptyBundle('give'), 150)).rejects.toThrow('invalid number of books');
    });
});
