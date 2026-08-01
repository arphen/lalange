import { describe, expect, it } from 'vitest';
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
    it('round-trips a compressed WebRTC offer', async () => {
        const signal = {
            kind: 'offer' as const,
            sessionId: 'session',
            secret: 'secret',
            description: { type: 'offer' as const, sdp: 'v=0\r\na=candidate:local\r\n' },
        };

        const code = await encodePairingSignal(signal);
        await expect(decodePairingSignal(code)).resolves.toEqual(signal);
    });

    it('extracts an offer from an invitation URL', () => {
        expect(extractPairingCode('https://arphen.xyz/exchange#offer=xchg1.j.value')).toBe('xchg1.j.value');
    });

    it('rejects unrelated QR data', async () => {
        await expect(decodePairingSignal('https://example.com')).rejects.toThrow('valid device exchange code');
    });

    it('distinguishes the short verification code from an exchange payload', async () => {
        await expect(decodePairingSignal('FBCA7B')).rejects.toThrow('verification code, not the full device exchange code');
    });
});
