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

    it('builds a chapter per PDF outline entry at any nesting depth', async () => {
        const pages = Array.from({ length: 8 }, (_, index) => ({
            pageNumber: index + 1,
            text: `Page ${index + 1} text.`,
        }));
        const parsePdf = vi.fn().mockResolvedValue({
            pages,
            outline: [
                { title: 'Cover', pageNumber: 1 },
                { title: 'A. Consciousness', pageNumber: 3 },
                { title: 'I. Sensuous-Certainty', pageNumber: 4 },
                { title: 'II. Perceiving', pageNumber: 6 },
                { title: 'B. Self-Consciousness', pageNumber: 7 },
            ],
        });
        const reader = new PdfIngestReader({ parsePdf });

        const prepared = await reader.prepareInitial(new File(['%PDF-1.7'], 'outlined.pdf'));
        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        const titles = [
            'Cover',
            'A. Consciousness',
            'I. Sensuous-Certainty',
            'II. Perceiving',
            'B. Self-Consciousness',
        ];
        expect(prepared.chapters.map((chapter) => chapter.title)).toEqual(titles);
        expect(prepared.structureMode).toBe('authored');
        expect(prepared.chapters[1].boundaryEvidence).toEqual(['publisher-toc']);
        expect(chapters.map((chapter) => chapter.title)).toEqual(titles);

        // The first chapter absorbs the pages ahead of it; each later chapter runs to the next entry.
        expect(chapters.map((chapter) => chapter.slices.map((slice) => slice.text))).toEqual([
            ['Page 1 text.', 'Page 2 text.'],
            ['Page 3 text.'],
            ['Page 4 text.', 'Page 5 text.'],
            ['Page 6 text.'],
            ['Page 7 text.', 'Page 8 text.'],
        ]);
    });

    it('drops outline entries that cannot describe a page range', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [
                    { pageNumber: 1, text: 'One.' },
                    { pageNumber: 2, text: 'Two.' },
                    { pageNumber: 3, text: 'Three.' },
                ],
                outline: [
                    { title: 'Part One', pageNumber: 1 },
                    { title: 'Chapter I', pageNumber: 1 },
                    { title: 'Backwards', pageNumber: 1 },
                    { title: 'Off The End', pageNumber: 99 },
                    { title: '   ', pageNumber: 2 },
                    { title: 'Chapter II', pageNumber: 3 },
                ],
            }),
        });

        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(chapters.map((chapter) => chapter.title)).toEqual(['Part One', 'Chapter II']);
        expect(chapters[0].slices).toHaveLength(2);
    });

    it('falls back to a single document chapter when the outline is too thin', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [
                    { pageNumber: 1, text: 'One.' },
                    { pageNumber: 2, text: 'Two.' },
                ],
                outline: [{ title: 'Only Entry', pageNumber: 2 }],
            }),
        });

        const prepared = await reader.prepareInitial(new File(['%PDF-1.7'], 'thin.pdf'));
        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(prepared.chapters.map((chapter) => chapter.title)).toEqual(['Document']);
        expect(prepared.structureMode).toBeUndefined();
        expect(chapters.map((chapter) => chapter.title)).toEqual(['Document']);
        expect(chapters[0].slices).toHaveLength(2);
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

    it('joins a line-end hyphenated word within a page', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [{ pageNumber: 1, text: 'A theory of evo-\nlution took hold.' }],
            }),
        });

        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(chapters[0].slices[0].text).toBe('A theory of evolution took hold.');
        expect(chapters[0].slices[0].html).toContain('evolution');
    });

    it('joins a hyphenated wrap split across a page boundary', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [
                    { pageNumber: 1, text: 'A theory of evo-' },
                    { pageNumber: 2, text: 'lution took hold.' },
                ],
            }),
        });

        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(chapters[0].slices[0].text).toBe('A theory of evolution');
        expect(chapters[0].slices[1].text).toBe(' took hold.');
    });

    it('does not join an unhyphenated pair across a page boundary', async () => {
        const reader = new PdfIngestReader({
            parsePdf: vi.fn().mockResolvedValue({
                pages: [
                    { pageNumber: 1, text: 'Stray word the' },
                    { pageNumber: 2, text: 'cat sat down.' },
                ],
            }),
        });

        const chapters = await reader.loadChapters(new TextEncoder().encode('%PDF-1.7'));

        expect(chapters[0].slices[0].text).toBe('Stray word the');
        expect(chapters[0].slices[1].text).toBe('cat sat down.');
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