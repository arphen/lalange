import { escapeHtml, getFileExtension, normalizeMime, readFileAsUint8Array, stripFileExtension } from './utils';
import type { IngestReaderPlugin, ReaderPreparedBook, ReaderResolvedChapter } from './types';

const PDF_EXTENSIONS = ['pdf'];
const PDF_MIME_TYPES = ['application/pdf'];
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

export const MAX_PDF_BYTES = 75 * 1024 * 1024;
export const MAX_PDF_PAGES = 2_000;

export interface ParsedPdfPage {
    pageNumber: number;
    label?: string;
    text: string;
}

export interface ParsedPdfDocument {
    title?: string;
    author?: string;
    pages: ParsedPdfPage[];
}

export interface PdfReaderDependencies {
    parsePdf: (
        rawData: Uint8Array,
        onProgress?: (message: string) => void,
    ) => Promise<ParsedPdfDocument>;
}

const hasPdfHeader = (data: Uint8Array): boolean => {
    const searchLimit = Math.min(data.length - PDF_HEADER.length, 1024);
    for (let offset = 0; offset <= searchLimit; offset++) {
        if (PDF_HEADER.every((byte, index) => data[offset + index] === byte)) {
            return true;
        }
    }
    return false;
};

const normalizePdfText = (value: string): string => value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const validatePdfSize = (size: number): void => {
    if (size > MAX_PDF_BYTES) {
        throw new Error(`PDF is too large. The maximum supported size is ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    }
};

const normalizeParsedDocument = (document: ParsedPdfDocument): ParsedPdfDocument => {
    if (document.pages.length > MAX_PDF_PAGES) {
        throw new Error(`PDF has too many pages. The maximum supported count is ${MAX_PDF_PAGES.toLocaleString()}.`);
    }

    const pages = document.pages
        .map((page) => ({
            ...page,
            text: normalizePdfText(page.text),
        }))
        .filter((page) => page.text.length > 0);

    if (pages.length === 0) {
        throw new Error('No extractable text found in PDF. Scanned or image-only PDFs require OCR, which is not supported yet.');
    }

    return {
        ...document,
        pages,
    };
};

export class PdfIngestReader implements IngestReaderPlugin {
    public readonly id = 'pdf';

    public readonly displayName = 'PDF';

    public readonly extensions = PDF_EXTENSIONS;

    public readonly mimeTypes = PDF_MIME_TYPES;

    private readonly dependencies: PdfReaderDependencies;

    public constructor(dependencies: PdfReaderDependencies) {
        this.dependencies = dependencies;
    }

    public acceptsFile(file: File): boolean {
        const extension = getFileExtension(file.name);
        const mimeType = normalizeMime(file.type);
        return PDF_EXTENSIONS.includes(extension) || PDF_MIME_TYPES.includes(mimeType);
    }

    public supportsRaw(data: Uint8Array): boolean {
        return hasPdfHeader(data);
    }

    public async prepareInitial(file: File, onProgress?: (message: string) => void): Promise<ReaderPreparedBook> {
        validatePdfSize(file.size);
        const rawData = await readFileAsUint8Array(file);
        const document = normalizeParsedDocument(await this.dependencies.parsePdf(rawData, onProgress));
        const fallbackTitle = stripFileExtension(file.name).trim() || file.name;

        return {
            title: document.title?.trim() || fallbackTitle,
            author: document.author?.trim() || 'Unknown',
            images: [],
            chapters: [{
                title: 'Document',
                source: 'spine',
            }],
        };
    }

    public async loadChapters(rawData: Uint8Array): Promise<ReaderResolvedChapter[]> {
        validatePdfSize(rawData.byteLength);
        const document = normalizeParsedDocument(await this.dependencies.parsePdf(rawData));

        return [{
            title: 'Document',
            source: 'spine',
            slices: document.pages.map((page) => ({
                text: page.text,
                html: `<div data-pdf-page="${page.pageNumber}">${escapeHtml(page.text)}</div>`,
            })),
        }];
    }
}

export const isPdfData = hasPdfHeader;