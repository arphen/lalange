const textEncoder = new TextEncoder();

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, entry]) => entry !== undefined)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }

    return value;
}

export function stableSerialize(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export async function fingerprintValue(value: unknown): Promise<string> {
    const data = textEncoder.encode(stableSerialize(value));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
