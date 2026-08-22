import { escapeHtml, getFileExtension, normalizeMime, readFileAsUint8Array, stripFileExtension } from './utils';
import type { PdfOcrEngine } from './pdfOcrAdapter';
import type { PdfLayoutWord } from './pdfLayout';
import { extractPdfNotes, linkPdfNoteAnchors, type PdfNoteAnchor, type PdfNoteEntry } from './pdfNotes';
import { resolvePdfLayout, type PdfLayoutPage } from './pdfLayout';
import type { IngestReaderPlugin, ReaderPreparedBook, ReaderResolvedChapter } from './types';
import { buildLineWrapProfile, repairLineWrapsAcrossSegments } from '../lineWrap';

const PDF_EXTENSIONS = ['pdf'];
const PDF_MIME_TYPES = ['application/pdf'];
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

export const MAX_PDF_BYTES = 75 * 1024 * 1024;
export const MAX_PDF_PAGES = 2_000;

export interface ParsedPdfPage {
    pageNumber: number;
    label?: string;
    text: string;
    words?: PdfLayoutWord[];
    layout?: PdfLayoutPage;
    notes?: PdfNoteEntry[];
    noteAnchors?: PdfNoteAnchor[];
}

export interface PdfOutlineEntry {
    title: string;
    pageNumber: number;
}

export interface ParsedPdfDocument {
    title?: string;
    author?: string;
    pages: ParsedPdfPage[];
    outline?: PdfOutlineEntry[];
}

export interface PdfPlannedChapter {
    title: string;
    startPage: number;
    endPage: number;
}

export interface PdfParseOptions {
    useOcr?: boolean;
    ocrEngine?: PdfOcrEngine;
    signal?: AbortSignal;
}

export interface PdfReaderDependencies {
    parsePdf: (
        rawData: Uint8Array,
        onProgress?: (message: string) => void,
        options?: PdfParseOptions,
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

const normalizeWhitespace = (value: string): string => value.replaceAll('\0', '').replace(/\s+/g, ' ').trim();

const validatePdfSize = (size: number): void => {
    if (size > MAX_PDF_BYTES) {
        throw new Error(`PDF is too large. The maximum supported size is ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    }
};

const normalizeParsedDocument = (document: ParsedPdfDocument, requireText: boolean): ParsedPdfDocument => {
    if (document.pages.length > MAX_PDF_PAGES) {
        throw new Error(`PDF has too many pages. The maximum supported count is ${MAX_PDF_PAGES.toLocaleString()}.`);
    }

    const pages = document.pages.map((page) => ({
        ...page,
        text: normalizePdfText(page.text),
    }));

    if (requireText && !pages.some((page) => page.text.length > 0)) {
        throw new Error('No readable text found in PDF after local OCR. The document may be blank or the OCR language pack may be unavailable.');
    }

    return {
        ...document,
        pages,
    };
};

const isBodyRegion = (role: PdfLayoutPage['regions'][number]['role']): boolean => (
    role === 'body' || role === 'heading' || role === 'unknown'
);

const applyPdfLayout = (document: ParsedPdfDocument): ParsedPdfDocument => {
    const words = document.pages.flatMap((page) => page.words || []);
    if (words.length === 0) return document;

    const layout = resolvePdfLayout(words);
    const notesResult = extractPdfNotes(layout.regions);
    const links = linkPdfNoteAnchors(notesResult.regions, notesResult.notes);
    const pages = document.pages.map((page) => {
        const pageLayout = layout.pages.find((candidate) => candidate.pageNumber === page.pageNumber);
        if (!pageLayout) return page;
        const pageRegions = notesResult.regions.filter((region) => region.pageNumber === page.pageNumber);
        const regionById = new Map(pageRegions.map((region) => [region.id, region]));
        const bodyRegions = pageLayout.bodyOrder
            .map((blockId) => regionById.get(blockId.replace('-b', '-r')))
            .filter((region): region is NonNullable<typeof region> => region !== undefined)
            .filter((region) => isBodyRegion(region.role));
        const bodyText = bodyRegions.map((region) => region.text).join('\n\n').trim();
        const resolvedPageLayout: PdfLayoutPage = {
            ...pageLayout,
            regions: pageRegions,
            bodyOrder: bodyRegions.map((region) => region.id.replace('-r', '-b')),
        };
        return {
            ...page,
            text: bodyText || page.text,
            layout: resolvedPageLayout,
            notes: pageRegions
                .filter((region) => region.role === 'footnote' || region.role === 'endnote' || region.role === 'marginal-note')
                .flatMap((region) => notesResult.notes.filter((note) => note.sourceRegionIds.includes(region.id))),
            noteAnchors: links.anchors.filter((anchor) => anchor.sourcePage === page.pageNumber),
        };
    });

    return { ...document, pages };
};

const applyPdfLineWraps = (document: ParsedPdfDocument): ParsedPdfDocument => {
    const texts = document.pages.map((page) => page.text);
    const profile = buildLineWrapProfile(texts);
    const { segments } = repairLineWrapsAcrossSegments(texts, profile);

    return {
        ...document,
        pages: document.pages.map((page, index) => ({ ...page, text: segments[index] })),
    };
};

const toChapterSlice = (page: ParsedPdfPage) => ({
    text: page.text,
    html: `<div data-pdf-page="${page.pageNumber}">${escapeHtml(page.text)}</div>`,
});

const MIN_OUTLINE_CHAPTERS = 2;

const sanitizeOutline = (
    outline: PdfOutlineEntry[] | undefined,
    pageCount: number,
): PdfOutlineEntry[] => {
    if (!outline || outline.length === 0) return [];

    const entries: PdfOutlineEntry[] = [];
    let lastPage = 0;

    for (const entry of outline) {
        const title = normalizeWhitespace(entry.title);
        if (!title) continue;
        if (!Number.isInteger(entry.pageNumber) || entry.pageNumber < 1 || entry.pageNumber > pageCount) continue;
        // A destination that jumps backwards means the outline is not in reading order; it cannot
        // describe contiguous page ranges, so drop the stray entry rather than the whole outline.
        if (entry.pageNumber < lastPage) continue;
        // Entries sharing a start page (a part and its first chapter) would leave an empty range.
        if (entries.length > 0 && entry.pageNumber === lastPage) continue;

        lastPage = entry.pageNumber;
        entries.push({ title, pageNumber: entry.pageNumber });
    }

    return entries;
};

/**
 * Turns a PDF's outline into contiguous chapters, one per entry at any nesting depth. Returns null
 * when the outline is missing or too thin to describe the document, leaving the single-chapter
 * fallback in place.
 */
export const planPdfChapters = (
    outline: PdfOutlineEntry[] | undefined,
    pageCount: number,
): PdfPlannedChapter[] | null => {
    if (pageCount < 1) return null;

    const entries = sanitizeOutline(outline, pageCount);
    if (entries.length < MIN_OUTLINE_CHAPTERS) return null;

    return entries.map((entry, index) => {
        const next = entries[index + 1];
        // The first chapter absorbs any pages the outline leaves in front of it.
        const startPage = index === 0 ? 1 : entry.pageNumber;

        return {
            title: entry.title,
            startPage,
            endPage: next ? Math.max(startPage, next.pageNumber - 1) : pageCount,
        };
    });
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
        const document = normalizeParsedDocument(await this.dependencies.parsePdf(rawData, onProgress), false);
        const fallbackTitle = stripFileExtension(file.name).trim() || file.name;

        const plan = planPdfChapters(document.outline, document.pages.length);

        return {
            title: document.title?.trim() || fallbackTitle,
            author: document.author?.trim() || 'Unknown',
            images: [],
            chapters: plan
                ? plan.map((chapter) => ({
                    title: chapter.title,
                    source: 'toc' as const,
                    structureOwnership: 'authored' as const,
                    reformationReason: 'authored-boundary' as const,
                    boundaryEvidence: ['publisher-toc' as const],
                }))
                : [{
                    title: 'Document',
                    source: 'spine',
                }],
            ...(plan ? { structureVersion: 1 as const, structureMode: 'authored' as const } : {}),
        };
    }

    public async loadChapters(rawData: Uint8Array, onProgress?: (message: string) => void): Promise<ReaderResolvedChapter[]> {
        validatePdfSize(rawData.byteLength);
        const document = applyPdfLineWraps(applyPdfLayout(normalizeParsedDocument(
            await this.dependencies.parsePdf(rawData, onProgress, { useOcr: true }),
            true,
        )));
        const notes = document.pages.flatMap((page) => page.notes || []);
        const noteAnchors = document.pages.flatMap((page) => page.noteAnchors || []);
        const plan = planPdfChapters(document.outline, document.pages.length);

        if (!plan) {
            return [{
                title: 'Document',
                source: 'spine',
                slices: document.pages.map(toChapterSlice),
                ...(notes.length > 0 ? { notes } : {}),
                ...(noteAnchors.length > 0 ? { noteAnchors } : {}),
            }];
        }

        return plan.map((chapter) => {
            const pages = document.pages.filter((page) => (
                page.pageNumber >= chapter.startPage && page.pageNumber <= chapter.endPage
            ));
            const chapterNotes = pages.flatMap((page) => page.notes || []);
            const chapterNoteAnchors = pages.flatMap((page) => page.noteAnchors || []);

            return {
                title: chapter.title,
                source: 'toc' as const,
                structureOwnership: 'authored' as const,
                reformationReason: 'authored-boundary' as const,
                boundaryEvidence: ['publisher-toc' as const],
                slices: pages.map(toChapterSlice),
                ...(chapterNotes.length > 0 ? { notes: chapterNotes } : {}),
                ...(chapterNoteAnchors.length > 0 ? { noteAnchors: chapterNoteAnchors } : {}),
            };
        });
    }
}

export const isPdfData = hasPdfHeader;