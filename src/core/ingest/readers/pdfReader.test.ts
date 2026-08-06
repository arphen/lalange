import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, PdfIngestReader } from './pdfReader';
import type { PdfLayoutWord } from './pdfLayout';

const layoutWord = (
    id: string,
    text: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): PdfLayoutWord => ({
    id,
    pageNumber: 1,
    text,
    box: { x0, y0, x1, y1 },
    baseline: y1,
    direction: 'ltr',
    source: 'ocr',
});

describe('PdfIngestReader', () => {
    it('uses injected parsing and preserves meaningful pages in source order', async () => {
        const parsePdf = vi.fn().mockResolvedValue({
            title: '  A PDF Book  ',
            author: '  An Author  ',
            pages: [
                { pageNumber: 1, label: 'i', text: 'Opening text.' },
                { pageNumber: 2, label: 'ii', text: '   ' },
                { pageNumber: 3, label: '1', text: 'Main text.' },
            ],
        });
        const reader = new PdfIngestReader({ parsePdf });
        const file = new File(['%PDF-1.7'], 'fallback.pdf', { type: 'application/pdf' });

        const prepared = await reader.prepareInitial(file);
        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(prepared.title).toBe('A PDF Book');
        expect(prepared.author).toBe('An Author');
        expect(prepared.chapters.map((chapter) => chapter.title)).toEqual(['Document']);
        expect(chapters.map((chapter) => chapter.title)).toEqual(['Document']);
        expect(chapters[0].slices.map((slice) => slice.text)).toEqual(['Opening text.', '', 'Main text.']);
        expect(chapters[0].slices[2].html).toContain('data-pdf-page="3"');
    });

    it('recognizes PDF MIME, extension, and raw signatures', () => {
        const reader = new PdfIngestReader({ parsePdf: vi.fn() });

        expect(reader.acceptsFile(new File(['x'], 'BOOK.PDF'))).toBe(true);
        expect(reader.acceptsFile(new File(['x'], 'download', { type: 'application/pdf' }))).toBe(true);
        expect(reader.supportsRaw(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
        expect(reader.supportsRaw(new TextEncoder().encode('\n%PDF-1.7'))).toBe(true);
        expect(reader.supportsRaw(new TextEncoder().encode('not a pdf'))).toBe(false);
    });

    it('defers OCR for image-only PDFs until chapter loading', async () => {
        const parsePdf = vi.fn().mockImplementation(async (_rawData, _onProgress, options) => ({
            pages: [{ pageNumber: 1, text: options?.useOcr ? 'Recovered scan text.' : '' }],
        }));
        const reader = new PdfIngestReader({ parsePdf });
        const file = new File(['%PDF-1.7'], 'scan.pdf');

        const prepared = await reader.prepareInitial(file);
        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(prepared.title).toBe('scan');
        expect(chapters[0].slices[0].text).toBe('Recovered scan text.');
        expect(parsePdf.mock.calls[0][2]).toBeUndefined();
        expect(parsePdf.mock.calls[1][2]).toEqual({ useOcr: true });
    });

    it('orders geometry-backed body text and retains footnotes outside the body slice', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [{
                    pageNumber: 1,
                    text: 'Raw page order.',
                    words: [
                        layoutWord('left-1', 'Left column.', 0.1, 0.1, 0.35, 0.12),
                        layoutWord('right-1', 'Right column.', 0.55, 0.1, 0.85, 0.12),
                        layoutWord('left-2', 'Left continuation.', 0.1, 0.14, 0.35, 0.16),
                        layoutWord('right-2', 'Right continuation.', 0.55, 0.14, 0.85, 0.16),
                        layoutWord('note-1', '1. A retained note.', 0.1, 0.74, 0.45, 0.75),
                    ],
                }],
            }),
        });

        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(chapters[0].slices[0].text).toBe('Left column.\nLeft continuation.\n\nRight column.\nRight continuation.');
        expect(chapters[0].notes).toMatchObject([{
            label: '1',
            text: 'A retained note.',
            pageStart: 1,
            pageEnd: 1,
        }]);
    });

    it('fails chapter loading when local OCR recovers no readable page', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [{ pageNumber: 1, text: '' }],
            }),
        });

        await expect(reader.loadChapters(new TextEncoder().encode('%PDF-1.7')))
            .rejects.toThrow('No readable text found');
    });

    it('enforces file and page limits before persisting content', async () => {
        const parsePdf = vi.fn().mockResolvedValue({
            pages: Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) => ({
                pageNumber: index + 1,
                text: 'text',
            })),
        });
        const reader = new PdfIngestReader({ parsePdf });
        const oversizedFile = new File(['%PDF-1.7'], 'large.pdf');
        Object.defineProperty(oversizedFile, 'size', { value: MAX_PDF_BYTES + 1 });

        await expect(reader.prepareInitial(oversizedFile)).rejects.toThrow('maximum supported size');
        expect(parsePdf).not.toHaveBeenCalled();

        await expect(reader.loadChapters(new TextEncoder().encode('%PDF-1.7')))
            .rejects.toThrow('maximum supported count');
    });

    it('falls back to the file name and unknown author when metadata is absent', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [{ pageNumber: 7, text: 'Readable text.' }],
            }),
        });

        const prepared = await reader.prepareInitial(new File(['%PDF-1.7'], 'Local Notes.pdf'));

        expect(prepared.title).toBe('Local Notes');
        expect(prepared.author).toBe('Unknown');
        expect(prepared.chapters[0].title).toBe('Document');
    });
});