import { decodeUtf8, escapeHtml, getFileExtension, markdownToPlainText, normalizeMime, readFileAsUint8Array, stripFileExtension } from './utils';
import type { IngestReaderPlugin, ReaderPreparedBook, ReaderResolvedChapter } from './types';
import { buildLineWrapProfile, repairLineWraps } from '../lineWrap';

const MARKDOWN_EXTENSIONS = ['md', 'markdown'];
const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown', 'application/markdown'];

export interface MarkdownReaderDependencies {
    decodeText?: (data: Uint8Array) => string;
    toPlainText?: (markdown: string) => string;
}

export class MarkdownIngestReader implements IngestReaderPlugin {
    public readonly id = 'markdown';

    public readonly displayName = 'Markdown';

    public readonly extensions = MARKDOWN_EXTENSIONS;

    public readonly mimeTypes = MARKDOWN_MIME_TYPES;

    private readonly decodeText: (data: Uint8Array) => string;

    private readonly toPlainText: (markdown: string) => string;

    public constructor(dependencies: MarkdownReaderDependencies = {}) {
        this.decodeText = dependencies.decodeText || decodeUtf8;
        this.toPlainText = dependencies.toPlainText || markdownToPlainText;
    }

    public acceptsFile(file: File): boolean {
        const extension = getFileExtension(file.name);
        const mimeType = normalizeMime(file.type);
        return MARKDOWN_EXTENSIONS.includes(extension) || MARKDOWN_MIME_TYPES.includes(mimeType);
    }

    public supportsRaw(data: Uint8Array): boolean {
        void data;
        // Raw markdown bytes are indistinguishable from plain text.
        // We rely on the persisted reader id hint for deterministic replay.
        return false;
    }

    public async prepareInitial(file: File): Promise<ReaderPreparedBook> {
        const markdown = this.decodeText(await readFileAsUint8Array(file));
        const plainText = this.normalizeText(this.toPlainText(markdown));
        if (!plainText) {
            throw new Error('No readable content found in markdown file.');
        }

        const headingTitle = this.extractHeadingTitle(markdown);
        const fallbackTitle = stripFileExtension(file.name).trim() || file.name;

        return {
            title: headingTitle || fallbackTitle,
            author: 'Unknown',
            images: [],
            chapters: [{
                title: headingTitle || 'Chapter 1',
                source: 'merged',
            }],
        };
    }

    public async loadChapters(rawData: Uint8Array): Promise<ReaderResolvedChapter[]> {
        const markdown = this.decodeText(rawData);
        const plainText = this.normalizeText(this.toPlainText(markdown));
        if (!plainText) {
            return [];
        }

        const headingTitle = this.extractHeadingTitle(markdown);
        const repairedText = repairLineWraps(plainText, buildLineWrapProfile([plainText])).value;
        return [{
            title: headingTitle || 'Chapter 1',
            source: 'merged',
            slices: [{
                text: repairedText,
                html: `<pre>${escapeHtml(markdown)}</pre>`,
            }],
        }];
    }

    private extractHeadingTitle(markdown: string): string {
        const match = markdown.match(/^\s{0,3}#{1,2}\s+(.+)$/m);
        return match?.[1]?.trim() || '';
    }

    private normalizeText(rawText: string): string {
        return rawText
            .replace(/\r\n/g, '\n')
            .replaceAll('\0', ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
