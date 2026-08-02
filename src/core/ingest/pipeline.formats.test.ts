import { describe, expect, it } from 'vitest';
import { createMinimalPdf } from '../../test/createMinimalPdf';
import { initialIngest } from './pipeline';

type PdfJsTestGlobal = typeof globalThis & {
    pdfjsWorker?: {
        WorkerMessageHandler: unknown;
    };
};

describe('initialIngest multi-format support', () => {
    it('ingests plain text files with the text reader', async () => {
        const file = new File(['Alpha beta gamma'], 'sample.txt', { type: 'text/plain' });

        const result = await initialIngest(file);

        expect(result.book.title).toBe('sample');
        expect(result.book.author).toBe('Unknown');
        expect(result.chapters).toHaveLength(1);
        expect(result.chapters[0].title).toBe('sample');
        expect(result.chapters[0].metadata?.structureSource).toBe('merged');
        expect(result.rawFile.data.startsWith('xyzraw1:text:')).toBe(true);
    });

    it('ingests markdown files with the markdown reader', async () => {
        const file = new File(['# The Heading\n\nSome **body** text.'], 'chapter.md', { type: 'text/markdown' });

        const result = await initialIngest(file);

        expect(result.book.title).toBe('The Heading');
        expect(result.chapters).toHaveLength(1);
        expect(result.chapters[0].title).toBe('The Heading');
        expect(result.rawFile.data.startsWith('xyzraw1:markdown:')).toBe(true);
    });

    it('ingests PDFs through the default reader registry', async () => {
        const { WorkerMessageHandler } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        (globalThis as PdfJsTestGlobal).pdfjsWorker = { WorkerMessageHandler };
        const progress: string[] = [];

        try {
            const file = new File([createMinimalPdf()], 'fallback.pdf', { type: 'application/pdf' });
            const result = await initialIngest(file, (message) => progress.push(message));

            expect(result.book.title).toBe('Adapter Test');
            expect(result.book.author).toBe('Test Author');
            expect(result.chapters).toHaveLength(1);
            expect(result.chapters[0].title).toBe('Document');
            expect(result.rawFile.data.startsWith('xyzraw1:pdf:')).toBe(true);
            expect(progress).toContain('Extracting PDF page 1 of 1...');
        } finally {
            delete (globalThis as PdfJsTestGlobal).pdfjsWorker;
        }
    });

    it('rejects unsupported file formats', async () => {
        const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], 'blob.bin', {
            type: 'application/octet-stream',
        });

        await expect(initialIngest(file)).rejects.toThrow('Unsupported file format');
    });
});
