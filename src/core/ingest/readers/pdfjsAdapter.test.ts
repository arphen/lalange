import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMinimalPdf } from '../../../test/createMinimalPdf';
import { parsePdfWithPdfJs } from './pdfjsAdapter';

type PdfJsTestGlobal = typeof globalThis & {
    pdfjsWorker?: {
        WorkerMessageHandler: unknown;
    };
};

beforeAll(async () => {
    const { WorkerMessageHandler } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as PdfJsTestGlobal).pdfjsWorker = { WorkerMessageHandler };
});

afterAll(() => {
    delete (globalThis as PdfJsTestGlobal).pdfjsWorker;
});

describe('parsePdfWithPdfJs', () => {
    it('extracts metadata and page text from a valid PDF', async () => {
        const progress: string[] = [];

        const parsed = await parsePdfWithPdfJs(createMinimalPdf(), (message) => progress.push(message));

        expect(parsed.title).toBe('Adapter Test');
        expect(parsed.author).toBe('Test Author');
        expect(parsed.pages[0]).toMatchObject({ pageNumber: 1, label: undefined, text: 'Hello PDF world.' });
        expect(parsed.pages[0].words?.map((word) => word.text)).toEqual(['Hello', 'PDF', 'world.']);
        expect(parsed.pages[0].words?.every((word) => word.source === 'embedded')).toBe(true);
        expect(parsed.pages[0].words?.every((word) => word.box.x0 >= 0 && word.box.x1 <= 1)).toBe(true);
        expect(progress).toEqual(['Extracting PDF page 1 of 1...']);
    });

    it('reports malformed PDFs with a stable user-facing error', async () => {
        await expect(parsePdfWithPdfJs(new TextEncoder().encode('%PDF-not-valid')))
            .rejects.toThrow(/malformed|Could not read PDF/);
    });
});