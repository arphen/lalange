import { describe, expect, it } from 'vitest';
import {
    clusterPdfLines,
    normalizePdfBox,
    resolvePdfLayout,
    type PdfLayoutWord,
} from './pdfLayout';

const word = (
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
    source: 'embedded',
});

describe('pdfLayout', () => {
    it('normalizes boxes and baselines into page coordinates', () => {
        expect(normalizePdfBox({ x0: 200, y0: 400, x1: 100, y1: 100 }, 200, 400)).toEqual({
            x0: 0.5,
            y0: 0.25,
            x1: 1,
            y1: 1,
        });
    });

    it('keeps parallel columns as separate lines', () => {
        const lines = clusterPdfLines([
            word('l1', 'Left', 0.1, 0.1, 0.2, 0.12),
            word('r1', 'Right', 0.55, 0.1, 0.65, 0.12),
            word('l2', 'column', 0.1, 0.14, 0.24, 0.16),
            word('r2', 'column', 0.55, 0.14, 0.69, 0.16),
        ]);

        expect(lines).toHaveLength(4);
        expect(lines.map((line) => line.text)).toEqual(['Left', 'Right', 'column', 'column']);
    });

    it('does not insert a space after a soft or Unicode hyphen within a line', () => {
        const lines = clusterPdfLines([
            word('a1', 'evo­', 0.1, 0.1, 0.15, 0.12),
            word('a2', 'lution', 0.151, 0.1, 0.22, 0.12),
        ]);

        expect(lines).toHaveLength(1);
        expect(lines[0].text).toBe('evo­lution');
    });

    it('reads a two-column page one column at a time', () => {
        const result = resolvePdfLayout([
            word('l1', 'Left one', 0.1, 0.1, 0.35, 0.12),
            word('r1', 'Right one', 0.55, 0.1, 0.85, 0.12),
            word('l2', 'Left two', 0.1, 0.14, 0.35, 0.16),
            word('r2', 'Right two', 0.55, 0.14, 0.85, 0.16),
        ]);

        expect(result.pages[0].bodyOrder.map((blockId) => result.blocks.find((block) => block.id === blockId)?.text))
            .toEqual(['Left one\nLeft two', 'Right one\nRight two']);
        expect(result.pages[0].blocks.map((block) => block.columnIndex)).toEqual([0, 1]);
    });

    it('places a full-width heading before the columns it introduces', () => {
        const result = resolvePdfLayout([
            word('h1', 'A heading', 0.1, 0.04, 0.9, 0.06),
            word('l1', 'Left one', 0.1, 0.1, 0.35, 0.12),
            word('r1', 'Right one', 0.55, 0.1, 0.85, 0.12),
            word('l2', 'Left two', 0.1, 0.14, 0.35, 0.16),
            word('r2', 'Right two', 0.55, 0.14, 0.85, 0.16),
        ]);

        expect(result.pages[0].blocks.map((block) => block.text)).toEqual([
            'A heading',
            'Left one\nLeft two',
            'Right one\nRight two',
        ]);
    });
});