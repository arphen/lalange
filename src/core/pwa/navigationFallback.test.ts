import { describe, expect, it, vi } from 'vitest';
import { fetchNavigationWithFallback } from './navigationFallback';

describe('service worker navigation fallback', () => {
    const request = new Request('https://arphen.xyz/research');

    it('preserves successful network responses', async () => {
        const networkResponse = new Response('research', { status: 200 });
        const fallback = vi.fn(async () => new Response('offline app'));

        const response = await fetchNavigationWithFallback(
            request,
            vi.fn(async () => networkResponse),
            fallback,
        );

        expect(response).toBe(networkResponse);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('preserves server error status codes instead of masking them', async () => {
        const notFoundResponse = new Response('not found', { status: 404 });

        const response = await fetchNavigationWithFallback(
            request,
            vi.fn(async () => notFoundResponse),
            vi.fn(async () => new Response('offline app')),
        );

        expect(response.status).toBe(404);
    });

    it('uses the cached app only when the network request fails', async () => {
        const fallbackResponse = new Response('offline app', { status: 200 });
        const fallback = vi.fn(async () => fallbackResponse);

        const response = await fetchNavigationWithFallback(
            request,
            vi.fn(async () => { throw new TypeError('offline'); }),
            fallback,
        );

        expect(response).toBe(fallbackResponse);
        expect(fallback).toHaveBeenCalledOnce();
    });
});