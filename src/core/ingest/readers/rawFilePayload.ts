const RAW_FILE_PREFIX = 'xyzraw1';

export interface DecodedRawFilePayload {
    readerId?: string;
    base64Data: string;
}

export const encodeRawFilePayload = (base64Data: string, readerId: string): string => {
    return `${RAW_FILE_PREFIX}:${readerId}:${base64Data}`;
};

export const decodeRawFilePayload = (payload: string): DecodedRawFilePayload => {
    const firstColon = payload.indexOf(':');
    if (firstColon < 0) {
        return { base64Data: payload };
    }

    const prefix = payload.slice(0, firstColon);
    if (prefix !== RAW_FILE_PREFIX) {
        return { base64Data: payload };
    }

    const secondColon = payload.indexOf(':', firstColon + 1);
    if (secondColon < 0) {
        return { base64Data: payload };
    }

    const readerId = payload.slice(firstColon + 1, secondColon).trim();
    const base64Data = payload.slice(secondColon + 1);
    if (!readerId || !base64Data) {
        return { base64Data: payload };
    }

    return {
        readerId,
        base64Data,
    };
};
