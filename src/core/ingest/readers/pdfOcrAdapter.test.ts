import { describe, expect, it, vi } from 'vitest';
import {
    TesseractPdfOcrEngine,
    type PdfOcrProgress,
} from './pdfOcrAdapter';

describe('TesseractPdfOcrEngine', () => {
    it('creates one worker, normalizes text, and returns word geometry', async () => {
        const recognize = vi.fn().mockResolvedValue({
            data: {
                text: '  First line.\r\n\r\nSecond line.  ',
                confidence: 87,
                blocks: [{
                    paragraphs: [{
                        lines: [{
                            words: [{
                                text: 'First',
                                confidence: 94,
                                bbox: { x0: 10, y0: 20, x1: 50, y1: 40 },
                            }],
                        }],
                    }],
                }],
            },
        });
        const terminate = vi.fn().mockResolvedValue(undefined);
        const progress: PdfOcrProgress[] = [];
        let logger: ((value: PdfOcrProgress) => void) | undefined;
        const workerFactory = vi.fn(async (_language, options) => {
            logger = options.logger;
            return { recognize, terminate };
        });
        const engine = new TesseractPdfOcrEngine({ workerFactory });
        const canvas = document.createElement('canvas');

        const first = await engine.recognize(canvas, (value) => progress.push(value));
        const second = await engine.recognize(canvas);
        logger?.({ status: 'recognizing text', progress: 0.5 });

        expect(workerFactory).toHaveBeenCalledTimes(1);
        expect(recognize).toHaveBeenCalledTimes(2);
        expect(first.text).toBe('First line.\n\nSecond line.');
        expect(first.meanConfidence).toBe(87);
        expect(first.words).toEqual([{
            text: 'First',
            confidence: 94,
            boundingBox: { x0: 10, y0: 20, x1: 50, y1: 40 },
            blockId: '0:0',
            lineId: '0:0:0',
        }]);
        expect(second.language).toBe('eng');
        expect(progress).toEqual([{ status: 'recognizing text', progress: 0.5 }]);
    });

    it('terminates the active worker on cancellation and can be closed safely', async () => {
        const terminate = vi.fn().mockResolvedValue(undefined);
        const workerFactory = vi.fn(async () => ({
            recognize: vi.fn().mockResolvedValue({
                data: { text: '', confidence: 0, blocks: [] },
            }),
            terminate,
        }));
        const engine = new TesseractPdfOcrEngine({ workerFactory });
        const canvas = document.createElement('canvas');

        await engine.recognize(canvas);
        await engine.cancel();
        await engine.close();

        expect(terminate).toHaveBeenCalledTimes(1);
        await expect(engine.recognize(canvas)).rejects.toThrow('engine is closed');
    });
});