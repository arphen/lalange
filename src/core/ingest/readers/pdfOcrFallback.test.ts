import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfOcrEngine } from './pdfOcrAdapter';

const { getDocument } = vi.hoisted(() => ({
    getDocument: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument,
    GlobalWorkerOptions: {},
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
    default: 'worker.js',
}));

import { parsePdfWithPdfJs } from './pdfjsAdapter';

class TestOffscreenCanvas {
    public width: number;

    public height: number;

    public constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    public getContext(): Record<string, never> {
        return {};
    }
}

describe('parsePdfWithPdfJs OCR fallback', () => {
    beforeEach(() => {
        getDocument.mockReset();
        vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
    });

    it('renders an empty text-layer page and passes its canvas to local OCR', async () => {
        const progress: string[] = [];
        const page = {
            getTextContent: vi.fn().mockResolvedValue({ items: [] }),
            getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 72 * scale, height: 72 * scale })),
            render: vi.fn(({ canvasContext, canvas, viewport }) => {
                expect(canvasContext).toEqual({});
                expect(canvas).toBeNull();
                expect(viewport.width).toBeGreaterThan(0);
                return { promise: Promise.resolve() };
            }),
        };
        const pdfDocument = {
            numPages: 1,
            getMetadata: vi.fn().mockResolvedValue({ info: {}, metadata: null }),
            getPageLabels: vi.fn().mockResolvedValue(null),
            getPage: vi.fn().mockResolvedValue(page),
            destroy: vi.fn().mockResolvedValue(undefined),
        };
        getDocument.mockReturnValue({
            promise: Promise.resolve(pdfDocument),
            destroy: vi.fn().mockResolvedValue(undefined),
        });

        const recognize = vi.fn().mockImplementation(async (canvas: HTMLCanvasElement | OffscreenCanvas, onProgress?: (progress: { status: string; progress: number }) => void) => {
            expect(canvas.width).toBeGreaterThan(0);
            expect(canvas.height).toBeGreaterThan(0);
            onProgress?.({ status: 'recognizing text', progress: 1 });
            return {
                text: 'Recovered scan text.',
                words: [{
                    text: 'Recovered',
                    confidence: 96,
                    boundingBox: { x0: 10, y0: 12, x1: 40, y1: 24 },
                    lineId: '0:0:0',
                    blockId: '0:0',
                }],
                meanConfidence: 99,
                language: 'eng',
                durationMs: 1,
            };
        });
        const ocrEngine: PdfOcrEngine = {
            recognize,
            cancel: async () => undefined,
            close: async () => undefined,
        };

        const parsed = await parsePdfWithPdfJs(
            new TextEncoder().encode('%PDF-1.7'),
            (message) => progress.push(message),
            { useOcr: true, ocrEngine },
        );

        expect(parsed.pages[0]).toMatchObject({ pageNumber: 1, label: undefined, text: 'Recovered scan text.' });
        expect(parsed.pages[0].words).toEqual([expect.objectContaining({
            text: 'Recovered',
            source: 'ocr',
            box: { x0: 10 / 250, y0: 12 / 250, x1: 40 / 250, y1: 24 / 250 },
            baseline: 24 / 250,
        })]);
        expect(page.render).toHaveBeenCalledOnce();
        expect(recognize).toHaveBeenCalledOnce();
        expect(progress).toContain('Rendering PDF page 1 for local OCR...');
        expect(progress).toContain('OCR page 1 of 1: recognizing text 100%');
    });
});
