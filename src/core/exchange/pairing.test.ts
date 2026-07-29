import { describe, expect, it } from 'vitest';
import { decodePairingSignal, encodePairingSignal, extractPairingCode } from './pairing';

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
});
