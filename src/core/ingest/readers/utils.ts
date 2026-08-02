const ZIP_MAGIC_0 = 0x50;
const ZIP_MAGIC_1 = 0x4b;

export const hasZipSignature = (data: Uint8Array): boolean => {
    return data.length >= 2 && data[0] === ZIP_MAGIC_0 && data[1] === ZIP_MAGIC_1;
};

export const getFileExtension = (fileName: string): string => {
    const idx = fileName.lastIndexOf('.');
    if (idx < 0 || idx === fileName.length - 1) return '';
    return fileName.slice(idx + 1).toLowerCase();
};

export const stripFileExtension = (fileName: string): string => {
    const idx = fileName.lastIndexOf('.');
    if (idx < 0) return fileName;
    return fileName.slice(0, idx);
};

export const normalizeMime = (mimeType: string): string => {
    return mimeType.split(';')[0]?.trim().toLowerCase() || '';
};

export const decodeUtf8 = (data: Uint8Array): string => {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data).replace(/^\uFEFF/, '');
};

export const readFileAsUint8Array = async (file: File): Promise<Uint8Array> => {
    const fileWithArrayBuffer = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof fileWithArrayBuffer.arrayBuffer === 'function') {
        const arrayBuffer = await fileWithArrayBuffer.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Failed to read file data.'));
        reader.onload = () => {
            const result = reader.result;
            if (!(result instanceof ArrayBuffer)) {
                reject(new Error('Unexpected file reader result type.'));
                return;
            }
            resolve(result);
        };
        reader.readAsArrayBuffer(file);
    });

    return new Uint8Array(arrayBuffer);
};

export const isLikelyUtf8Text = (data: Uint8Array): boolean => {
    if (data.length === 0) return false;
    if (hasZipSignature(data)) return false;

    // Null bytes usually indicate binary payloads.
    const hasNullByte = data.some((byte) => byte === 0);
    if (hasNullByte) return false;

    try {
        const decoded = decodeUtf8(data);
        if (!decoded.trim()) return false;

        const printableCount = Array.from(decoded).filter((char) => {
            const code = char.charCodeAt(0);
            return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code > 159;
        }).length;

        const ratio = printableCount / Math.max(1, decoded.length);
        return ratio > 0.9;
    } catch {
        return false;
    }
};

export const escapeHtml = (value: string): string => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export const markdownToPlainText = (markdown: string): string => {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}[-*+]\s+/gm, '')
        .replace(/^\s{0,3}\d+\.\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};
