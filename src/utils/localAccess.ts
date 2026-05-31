export interface LocalAccessLocation {
    protocol: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeSearch = (search: string): string => {
    if (!search) return '';
    return search.startsWith('?') ? search : `?${search}`;
};

const normalizeHash = (hash: string): string => {
    if (!hash) return '';
    return hash.startsWith('#') ? hash : `#${hash}`;
};

const hostHasExplicitPort = (host: string): boolean => {
    if (host.startsWith('[')) {
        return /\]:\d+$/.test(host);
    }
    return host.includes(':');
};

const isValidIpv4 = (candidate: string): boolean => {
    const parts = candidate.split('.');
    if (parts.length !== 4) return false;
    return parts.every((part) => {
        if (!/^\d+$/.test(part)) return false;
        const num = Number(part);
        return num >= 0 && num <= 255;
    });
};

export const isLoopbackHost = (hostname: string): boolean => {
    return LOOPBACK_HOSTNAMES.has(hostname);
};

export const isPrivateIpv4 = (ip: string): boolean => {
    if (!isValidIpv4(ip)) return false;

    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
        const secondOctet = Number(ip.split('.')[1]);
        return secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
};

export const extractIpv4FromCandidate = (candidate: string): string | null => {
    const ipv4Matches = candidate.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g);
    if (!ipv4Matches) return null;

    for (const match of ipv4Matches) {
        if (isValidIpv4(match)) {
            return match;
        }
    }

    return null;
};

export const buildLocalAccessUrl = (
    location: LocalAccessLocation,
    hostOverride?: string,
): string => {
    const override = hostOverride?.trim() ?? '';
    const isLoopback = isLoopbackHost(location.hostname);

    let host = location.hostname;

    if (isLoopback) {
        if (!override) return '';
        host = override;
    } else if (override) {
        host = override;
    }

    const withPort = hostHasExplicitPort(host) || !location.port
        ? host
        : `${host}:${location.port}`;

    const search = normalizeSearch(location.search);
    const hash = normalizeHash(location.hash);

    return `${location.protocol}//${withPort}${location.pathname}${search}${hash}`;
};