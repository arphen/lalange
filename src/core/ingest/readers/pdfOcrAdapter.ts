export interface PdfOcrAssetPaths {
    workerPath: string;
    corePath: string;
    langPath: string;
}

export interface PdfOcrProgress {
    status: string;
    progress: number;
}

export interface PdfOcrWord {
    text: string;
    confidence: number;
    boundingBox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
    lineId: string;
    blockId: string;
}

export interface PdfOcrPageResult {
    text: string;
    words: PdfOcrWord[];
    meanConfidence: number;
    language: string;
    durationMs: number;
}

export type PdfOcrImage = HTMLCanvasElement | OffscreenCanvas;

export interface PdfOcrEngine {
    recognize(
        image: PdfOcrImage,
        onProgress?: (progress: PdfOcrProgress) => void,
    ): Promise<PdfOcrPageResult>;
    cancel(): Promise<void>;
    close(): Promise<void>;
}

interface TesseractBoundingBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

interface TesseractWord {
    text: string;
    confidence: number;
    bbox: TesseractBoundingBox;
}

interface TesseractLine {
    words: TesseractWord[];
}

interface TesseractParagraph {
    lines: TesseractLine[];
}

interface TesseractBlock {
    paragraphs: TesseractParagraph[];
}

interface TesseractPageData {
    text: string;
    confidence: number;
    blocks?: TesseractBlock[] | null;
}

interface TesseractRecognitionResult {
    data: TesseractPageData;
}

interface TesseractWorker {
    recognize: (
        image: PdfOcrImage,
        options?: Record<string, never>,
        output?: { text?: boolean; blocks?: boolean },
    ) => Promise<TesseractRecognitionResult>;
    terminate: () => Promise<unknown>;
}

export interface PdfOcrWorkerFactoryOptions {
    workerPath: string;
    corePath: string;
    langPath: string;
    logger?: (progress: PdfOcrProgress) => void;
}

export type PdfOcrWorkerFactory = (
    language: string,
    options: PdfOcrWorkerFactoryOptions,
) => Promise<TesseractWorker>;

export const DEFAULT_PDF_OCR_ASSETS: PdfOcrAssetPaths = {
    workerPath: '/ocr-assets/worker.min.js',
    corePath: '/ocr-assets/tesseract-core',
    langPath: '/ocr-assets/tessdata/4.0.0_best_int',
};

const getDefaultAssetUrl = (path: string): string => {
    const origin = typeof window === 'undefined' ? 'http://localhost/' : window.location.origin;
    return new URL(`${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`, origin).toString();
};

export const getDefaultPdfOcrAssets = (): PdfOcrAssetPaths => ({
    workerPath: getDefaultAssetUrl(DEFAULT_PDF_OCR_ASSETS.workerPath),
    corePath: getDefaultAssetUrl(DEFAULT_PDF_OCR_ASSETS.corePath),
    langPath: getDefaultAssetUrl(DEFAULT_PDF_OCR_ASSETS.langPath),
});

const createDefaultWorker: PdfOcrWorkerFactory = async (language, options) => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker(language, OEM.LSTM_ONLY, {
        workerPath: options.workerPath,
        corePath: options.corePath,
        langPath: options.langPath,
        gzip: true,
        logger: options.logger,
    });
};

const normalizeOcrText = (text: string): string => text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const collectOcrWords = (data: TesseractPageData): PdfOcrWord[] => {
    const words: PdfOcrWord[] = [];
    for (const [blockIndex, block] of (data.blocks || []).entries()) {
        for (const [paragraphIndex, paragraph] of block.paragraphs.entries()) {
            for (const [lineIndex, line] of paragraph.lines.entries()) {
                for (const word of line.words) {
                    if (!word.text.trim()) continue;
                    words.push({
                        text: word.text,
                        confidence: word.confidence,
                        boundingBox: word.bbox,
                        blockId: `${blockIndex}:${paragraphIndex}`,
                        lineId: `${blockIndex}:${paragraphIndex}:${lineIndex}`,
                    });
                }
            }
        }
    }
    return words;
};

const getMeanConfidence = (data: TesseractPageData, words: PdfOcrWord[]): number => {
    if (Number.isFinite(data.confidence)) return data.confidence;
    if (words.length === 0) return 0;
    return words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
};

export interface TesseractPdfOcrEngineOptions {
    language?: string;
    assets?: PdfOcrAssetPaths;
    workerFactory?: PdfOcrWorkerFactory;
}

export class TesseractPdfOcrEngine implements PdfOcrEngine {
    private readonly language: string;

    private readonly assets: PdfOcrAssetPaths;

    private readonly workerFactory: PdfOcrWorkerFactory;

    private workerPromise?: Promise<TesseractWorker>;

    private activeProgressListener?: (progress: PdfOcrProgress) => void;

    private closed = false;

    public constructor(options: TesseractPdfOcrEngineOptions = {}) {
        this.language = options.language || 'eng';
        this.assets = options.assets || getDefaultPdfOcrAssets();
        this.workerFactory = options.workerFactory || createDefaultWorker;
    }

    private getWorker(): Promise<TesseractWorker> {
        if (this.closed) throw new Error('PDF OCR engine is closed.');
        if (!this.workerPromise) {
            this.workerPromise = this.workerFactory(this.language, {
                ...this.assets,
                logger: (progress) => this.activeProgressListener?.(progress),
            });
        }
        return this.workerPromise;
    }

    public async recognize(
        image: PdfOcrImage,
        onProgress?: (progress: PdfOcrProgress) => void,
    ): Promise<PdfOcrPageResult> {
        const startedAt = Date.now();
        this.activeProgressListener = onProgress;
        try {
            const worker = await this.getWorker();
            const result = await worker.recognize(
                image,
                {},
                { text: true, blocks: true },
            );
            const words = collectOcrWords(result.data);

            return {
                text: normalizeOcrText(result.data.text || ''),
                words,
                meanConfidence: getMeanConfidence(result.data, words),
                language: this.language,
                durationMs: Date.now() - startedAt,
            };
        } finally {
            if (this.activeProgressListener === onProgress) {
                this.activeProgressListener = undefined;
            }
        }
    }

    public async cancel(): Promise<void> {
        const workerPromise = this.workerPromise;
        this.workerPromise = undefined;
        if (!workerPromise) return;
        const worker = await workerPromise.catch(() => undefined);
        await worker?.terminate().catch(() => undefined);
    }

    public async close(): Promise<void> {
        this.closed = true;
        await this.cancel();
    }
}
