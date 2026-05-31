import { describe, expect, it } from 'vitest';
import {
    buildLocalAccessUrl,
    extractIpv4FromCandidate,
    isLoopbackHost,
    isPrivateIpv4,
} from './localAccess';

describe('localAccess utilities', () => {
    it('detects loopback hostnames', () => {
        expect(isLoopbackHost('localhost')).toBe(true);
        expect(isLoopbackHost('127.0.0.1')).toBe(true);
        expect(isLoopbackHost('::1')).toBe(true);
        expect(isLoopbackHost('192.168.1.40')).toBe(false);
    });

    it('builds URL for non-loopback hosts', () => {
        const url = buildLocalAccessUrl({
            protocol: 'http:',
            hostname: '192.168.1.40',
            port: '5173',
            pathname: '/reader/abc',
            search: '?x=1',
            hash: '#focus',
        });

        expect(url).toBe('http://192.168.1.40:5173/reader/abc?x=1#focus');
    });

    it('returns empty URL for loopback host without LAN override', () => {
        const url = buildLocalAccessUrl({
            protocol: 'http:',
            hostname: 'localhost',
            port: '5173',
            pathname: '/',
            search: '',
            hash: '',
        });

        expect(url).toBe('');
    });

    it('uses LAN override for loopback host and keeps route state', () => {
        const url = buildLocalAccessUrl(
            {
                protocol: 'https:',
                hostname: 'localhost',
                port: '5173',
                pathname: '/research',
                search: 'tab=sync',
                hash: 'chapter-1',
            },
            '192.168.1.55',
        );

        expect(url).toBe('https://192.168.1.55:5173/research?tab=sync#chapter-1');
    });

    it('extracts ipv4 from ICE candidate strings', () => {
        const candidate = 'candidate:842163049 1 udp 1677729535 192.168.1.42 60345 typ srflx raddr 0.0.0.0 rport 0';
        expect(extractIpv4FromCandidate(candidate)).toBe('192.168.1.42');
        expect(extractIpv4FromCandidate('candidate with no ip')).toBe(null);
    });

    it('identifies private ipv4 ranges', () => {
        expect(isPrivateIpv4('10.0.0.4')).toBe(true);
        expect(isPrivateIpv4('192.168.1.4')).toBe(true);
        expect(isPrivateIpv4('172.16.1.4')).toBe(true);
        expect(isPrivateIpv4('172.31.255.9')).toBe(true);
        expect(isPrivateIpv4('172.32.0.1')).toBe(false);
        expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    });
});