import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import {
    buildExchangeIceServers,
    decodePairingSignal,
    encodePairingSignal,
    extractPairingCode,
} from './pairing';

describe('exchange ICE servers', () => {
    it('uses public STUN discovery by default', () => {
        expect(buildExchangeIceServers('')).toEqual([
            { urls: 'stun:stun.cloudflare.com:3478' },
        ]);
    });

    it('adds configured TURN relays', () => {
        const turnServer = {
            urls: 'turns:relay.example.com:5349',
            username: 'temporary-user',
            credential: 'temporary-password',
        };

        expect(buildExchangeIceServers(JSON.stringify([turnServer]))).toEqual([
            { urls: 'stun:stun.cloudflare.com:3478' },
            turnServer,
        ]);
    });

    it('rejects malformed ICE server configuration', () => {
        expect(() => buildExchangeIceServers('{bad json')).toThrow('must be a JSON array');
        expect(() => buildExchangeIceServers('{}')).toThrow('must be a JSON array');
    });
});

describe('exchange pairing codes', () => {
    it('round-trips a compressed WebRTC offer using the QR alphanumeric alphabet', async () => {
        const signal = {
            kind: 'offer' as const,
            sessionId: 'session',
            secret: 'secret',
            description: { type: 'offer' as const, sdp: 'v=0\r\na=candidate:local\r\n' },
        };

        const code = await encodePairingSignal(signal);
        expect(code).toMatch(/^XCHG2:[GJ]:[0-9A-Z% $*+./:-]+:$/);
        expect(code).not.toContain('/');
        await expect(decodePairingSignal(code)).resolves.toEqual(signal);
    });

    it('keeps only three compact book previews while preserving the total count', async () => {
        const signal = {
            kind: 'offer' as const,
            sessionId: 'session',
            secret: 'secret',
            description: { type: 'offer' as const, sdp: 'v=0\r\na=candidate:local\r\n' },
            invitation: {
                intent: 'give' as const,
                scope: 'selection' as const,
                sourceDevice: { id: 'device', name: 'My Mac', createdAt: 1 },
                bookCount: 12,
                books: Array.from({ length: 12 }, (_, index) => ({
                    bookId: `book-${index}`,
                    title: `Book ${index}`,
                    author: `Author ${index}`,
                    estimatedBytes: 1000,
                })),
                selection: {
                    content: true,
                    analysis: true,
                    progress: true,
                    highlights: true,
                    listening: true,
                },
            },
        };

        const decoded = await decodePairingSignal(await encodePairingSignal(signal));

        expect(decoded.kind).toBe('offer');
        if (decoded.kind !== 'offer') throw new Error('Expected an offer');
        expect(decoded.invitation?.sourceDevice.name).toBe('My Mac');
        expect(decoded.invitation?.bookCount).toBe(12);
        expect(decoded.invitation?.books.map((book) => book.title)).toEqual(['Book 0', 'Book 1', 'Book 2']);
    });

    it('renders a smaller QR grid than the legacy signaling format', async () => {
        const signal = {
            kind: 'offer' as const,
            sessionId: '18fb92d7-90b7-45cd-ac6b-48c67baed23c',
            secret: '04dd44d5-987d-4c2f-abab-c6efdb6f443f',
            description: {
                type: 'offer' as const,
                sdp: [
                    'v=0',
                    'o=- 2476655109549966322 2 IN IP4 127.0.0.1',
                    's=-',
                    't=0 0',
                    'a=group:BUNDLE 0',
                    'a=ice-options:trickle',
                    'a=fingerprint:sha-256 56:65:43:FA:CD:9A:21:90:13:85:BA:19:AA:8D:10:E4:46:93:68:DB:EF:7D:4B:A3:8F:29:AA:74:1A:77:39:E6',
                    'm=application 54932 UDP/DTLS/SCTP webrtc-datachannel',
                    'c=IN IP4 192.0.2.10',
                    'a=mid:0',
                    'a=setup:actpass',
                    'a=ice-ufrag:abcd',
                    'a=ice-pwd:abcdefghijklmnopqrstuvwxyz',
                    'a=sctp-port:5000',
                    'a=max-message-size:262144',
                    'a=candidate:1 1 udp 2122260223 host.local 54932 typ host generation 0 network-cost 999',
                    'a=candidate:2 1 udp 1686052607 198.51.100.25 62000 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
                ].join('\r\n'),
            },
            invitation: {
                intent: 'give' as const,
                scope: 'selection' as const,
                sourceDevice: { id: 'device-id', name: 'My MacBook Pro', createdAt: 1 },
                bookCount: 12,
                books: Array.from({ length: 12 }, (_, index) => ({
                    bookId: `book-${index}`,
                    title: `A Representative Book Title ${index}`,
                    author: `A Representative Author ${index}`,
                    estimatedBytes: 1234567,
                })),
                selection: {
                    content: true,
                    analysis: true,
                    progress: true,
                    highlights: true,
                    listening: true,
                },
            },
        };
        const compactCode = await encodePairingSignal(signal);
        const legacyCode = await encodePairingSignal(signal, true);
        const compactMarkup = renderToStaticMarkup(createElement(QRCodeSVG, { value: compactCode, level: 'L' }));
        const legacyMarkup = renderToStaticMarkup(createElement(QRCodeSVG, { value: legacyCode, level: 'L' }));
        const compactWidth = Number(compactMarkup.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
        const legacyWidth = Number(legacyMarkup.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
        const compactUrl = `HTTPS://ARPHEN.XYZ/EXCHANGE/${compactCode}`;
        const legacyUrl = `https://arphen.xyz/exchange#offer=${legacyCode}`;
        const compactUrlMarkup = renderToStaticMarkup(createElement(QRCodeSVG, { value: compactUrl, level: 'L' }));
        const legacyUrlMarkup = renderToStaticMarkup(createElement(QRCodeSVG, { value: legacyUrl, level: 'L' }));
        const compactUrlWidth = Number(compactUrlMarkup.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
        const legacyUrlWidth = Number(legacyUrlMarkup.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);

        expect(compactWidth).toBeGreaterThan(0);
        expect(compactWidth).toBeLessThan(legacyWidth);
        expect(compactUrlWidth).toBeGreaterThan(0);
        expect(compactUrlWidth).toBeLessThan(legacyUrlWidth);
    });

    it('continues to decode legacy pairing codes', async () => {
        const signal = {
            kind: 'answer' as const,
            sessionId: 'session',
            secret: 'secret',
            description: { type: 'answer' as const, sdp: 'v=0\r\na=candidate:local\r\n' },
        };

        const code = await encodePairingSignal(signal, true);
        expect(code).toMatch(/^xchg1\.[gj]\./);
        await expect(decodePairingSignal(code)).resolves.toEqual(signal);
    });

    it('extracts an offer from an invitation URL', () => {
        expect(extractPairingCode('https://arphen.xyz/exchange#offer=xchg1.j.value')).toBe('xchg1.j.value');
        expect(extractPairingCode('HTTPS://ARPHEN.XYZ/EXCHANGE/XCHG2:G:VALUE:')).toBe('XCHG2:G:VALUE:');
    });

    it('rejects unrelated QR data', async () => {
        await expect(decodePairingSignal('https://example.com')).rejects.toThrow('valid device exchange code');
    });

    it('distinguishes the short verification code from an exchange payload', async () => {
        await expect(decodePairingSignal('FBCA7B')).rejects.toThrow('verification code, not the full device exchange code');
    });
});
