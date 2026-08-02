import { describe, expect, it } from 'vitest';
import { createDefaultIngestReaderRegistry } from './index';

describe('ingest reader registry', () => {
    it('resolves readers by file type', () => {
        const registry = createDefaultIngestReaderRegistry();

        const txtFile = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
        const mdFile = new File(['# Heading'], 'story.md', { type: 'text/markdown' });
        const epubFile = new File(['PK\u0003\u0004'], 'book.epub', { type: 'application/epub+zip' });
        const pdfFile = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });

        expect(registry.resolveForFile(txtFile)?.id).toBe('text');
        expect(registry.resolveForFile(mdFile)?.id).toBe('markdown');
        expect(registry.resolveForFile(epubFile)?.id).toBe('epub');
        expect(registry.resolveForFile(pdfFile)?.id).toBe('pdf');
    });

    it('resolves readers from raw bytes and optional reader id hint', () => {
        const registry = createDefaultIngestReaderRegistry();

        const plainBytes = new TextEncoder().encode('chapter one chapter two');
        const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        const pdfBytes = new TextEncoder().encode('%PDF-1.7');

        expect(registry.resolveForRaw(plainBytes)?.id).toBe('text');
        expect(registry.resolveForRaw(plainBytes, 'markdown')?.id).toBe('markdown');
        expect(registry.resolveForRaw(zipBytes)?.id).toBe('epub');
        expect(registry.resolveForRaw(pdfBytes)?.id).toBe('pdf');
    });

    it('publishes accepted extensions for upload controls', () => {
        const registry = createDefaultIngestReaderRegistry();

        const accept = registry.getAcceptAttribute();
        expect(accept).toContain('.epub');
        expect(accept).toContain('.pdf');
        expect(accept).toContain('.txt');
        expect(accept).toContain('.md');
        expect(accept).toContain('.markdown');
    });
});
