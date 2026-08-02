import type { IngestReaderPlugin } from './types';

export class IngestReaderRegistry {
    private readonly readers: IngestReaderPlugin[];

    public constructor(readers: IngestReaderPlugin[]) {
        this.readers = readers;
        if (readers.length === 0) {
            throw new Error('IngestReaderRegistry requires at least one reader plugin.');
        }
    }

    public resolveForFile(file: File): IngestReaderPlugin | null {
        return this.readers.find((reader) => reader.acceptsFile(file)) || null;
    }

    public resolveForRaw(rawData: Uint8Array, preferredReaderId?: string): IngestReaderPlugin | null {
        if (preferredReaderId) {
            const preferred = this.readers.find((reader) => reader.id === preferredReaderId);
            if (preferred) return preferred;
        }

        return this.readers.find((reader) => reader.supportsRaw(rawData)) || null;
    }

    public isFileSupported(file: File): boolean {
        return this.resolveForFile(file) !== null;
    }

    public getAcceptAttribute(): string {
        const extensions = this.readers.flatMap((reader) => reader.extensions);
        const unique = [...new Set(extensions.map((ext) => ext.toLowerCase()))];
        return unique.map((ext) => `.${ext}`).join(',');
    }

    public getSupportedExtensionsLabel(): string {
        const extensions = this.readers.flatMap((reader) => reader.extensions);
        const unique = [...new Set(extensions.map((ext) => ext.toLowerCase()))];
        return unique.map((ext) => `.${ext}`).join(', ');
    }
}
