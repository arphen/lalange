import { decodeUtf8, escapeHtml, getFileExtension, isLikelyUtf8Text, normalizeMime, readFileAsUint8Array, stripFileExtension } from './utils';
import type { IngestReaderPlugin, ReaderPreparedBook, ReaderResolvedChapter } from './types';
import { buildLineWrapProfile, repairLineWraps } from '../lineWrap';

const TEXT_EXTENSIONS = ['txt', 'text'];
const TEXT_MIME_TYPES = ['text/plain'];

export interface PlainTextReaderDependencies {
    decodeText?: (data: Uint8Array) => string;
}

export class PlainTextIngestReader implements IngestReaderPlugin {
    public readonly id = 'text';

    public readonly displayName = 'Plain text';

    public readonly extensions = TEXT_EXTENSIONS;

    public readonly mimeTypes = TEXT_MIME_TYPES;

    private readonly decodeText: (data: Uint8Array) => string;

    public constructor(dependencies: PlainTextReaderDependencies = {}) {
        this.decodeText = dependencies.decodeText || decodeUtf8;
    }

    public acceptsFile(file: File): boolean {
        const extension = getFileExtension(file.name);
        const mimeType = normalizeMime(file.type);
        return TEXT_EXTENSIONS.includes(extension) || TEXT_MIME_TYPES.includes(mimeType);
    }

    public supportsRaw(data: Uint8Array): boolean {
        return isLikelyUtf8Text(data);
    }

    public async prepareInitial(file: File): Promise<ReaderPreparedBook> {
        const rawData = await readFileAsUint8Array(file);
        const normalizedText = this.normalizeText(this.decodeText(rawData));
        if (!normalizedText) {
            throw new Error('No readable content found in text file.');
        }

        const fallbackTitle = stripFileExtension(file.name).trim() || file.name;
        return {
            title: fallbackTitle,
            author: 'Unknown',
            images: [],
            chapters: [{
                title: fallbackTitle,
                source: 'merged',
            }],
        };
    }

    public async loadChapters(rawData: Uint8Array): Promise<ReaderResolvedChapter[]> {
        const normalizedText = this.normalizeText(this.decodeText(rawData));
        if (!normalizedText) {
            return [];
        }

        const repairedText = repairLineWraps(normalizedText, buildLineWrapProfile([normalizedText])).value;

        return [{
            title: 'Chapter 1',
            source: 'merged',
            slices: [{
                text: repairedText,
                html: `<pre>${escapeHtml(repairedText)}</pre>`,
            }],
        }];
    }

    private normalizeText(rawText: string): string {
        return rawText
            .replace(/\r\n/g, '\n')
            .replaceAll('\0', ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
