import { MAX_PDF_PAGES, type ParsedPdfDocument, type PdfOutlineEntry, type PdfParseOptions } from './pdfReader';
import { TesseractPdfOcrEngine, type PdfOcrEngine, type PdfOcrWord } from './pdfOcrAdapter';
import { normalizePdfBox, type PdfLayoutWord, type PdfTextDirection } from './pdfLayout';
import { createOperationHandle } from '../../operations/progressReporter';

interface PdfTextItem {
    str: string;
    hasEOL: boolean;
    transform?: number[];
    width?: number;
    height?: number;
    dir?: string;
    fontName?: string;
}

interface PdfViewport {
    width: number;
    height: number;
    convertToViewportPoint?: (x: number, y: number) => [number, number];
}

interface PdfPage {
    getTextContent: (options: {
        disableNormalization: boolean;
        includeMarkedContent: boolean;
    }) => Promise<{ items: unknown[] }>;
    getViewport: (options: { scale: number }) => PdfViewport;
    render: (options: { canvasContext: unknown; canvas: HTMLCanvasElement | null; viewport: PdfViewport }) => { promise: Promise<void> };
}

interface PdfMetadata {
    info: Record<string, unknown>;
    metadata: {
        get: (name: string) => unknown;
    } | null;
}

interface PdfLoadingTask {
    promise: Promise<PdfDocument>;
    destroy: () => Promise<void>;
}

interface PdfOutlineNode {
    title?: unknown;
    dest?: unknown;
    items?: unknown;
}

interface PdfDocument {
    numPages: number;
    getMetadata: () => Promise<unknown>;
    getPageLabels: () => Promise<string[] | null>;
    getOutline: () => Promise<unknown>;
    getDestination: (id: string) => Promise<unknown>;
    getPageIndex: (ref: unknown) => Promise<number>;
    getPage: (pageNumber: number) => Promise<PdfPage>;
    destroy: () => Promise<void>;
}

const isOutlineNode = (value: unknown): value is PdfOutlineNode => (
    !!value && typeof value === 'object'
);

const resolveOutlinePage = async (
    document: PdfDocument,
    dest: unknown,
): Promise<number | undefined> => {
    try {
        const resolved = typeof dest === 'string' ? await document.getDestination(dest) : dest;
        if (!Array.isArray(resolved) || resolved.length === 0) return undefined;
        const pageIndex = await document.getPageIndex(resolved[0]);
        if (!Number.isInteger(pageIndex) || pageIndex < 0) return undefined;
        return pageIndex + 1;
    } catch {
        return undefined;
    }
};

const collectOutlineEntries = async (
    document: PdfDocument,
    nodes: unknown,
    depth: number,
    entries: PdfOutlineEntry[],
): Promise<void> => {
    if (!Array.isArray(nodes) || depth > MAX_OUTLINE_DEPTH) return;

    for (const node of nodes) {
        if (!isOutlineNode(node)) continue;
        if (entries.length >= MAX_OUTLINE_ENTRIES) return;

        const title = typeof node.title === 'string' ? node.title.replaceAll('\0', '').trim() : '';
        const pageNumber = await resolveOutlinePage(document, node.dest);
        if (title && pageNumber !== undefined) {
            entries.push({ title, pageNumber });
        }

        await collectOutlineEntries(document, node.items, depth + 1, entries);
    }
};

const extractOutline = async (document: PdfDocument): Promise<PdfOutlineEntry[]> => {
    try {
        const nodes = await document.getOutline();
        const entries: PdfOutlineEntry[] = [];
        await collectOutlineEntries(document, nodes, 0, entries);
        return entries;
    } catch {
        return [];
    }
};

const MAX_OUTLINE_DEPTH = 6;
const MAX_OUTLINE_ENTRIES = 5_000;

export const MAX_OCR_LONG_EDGE = 3_500;
export const MAX_OCR_PIXELS = 16_000_000;
const OCR_SCALE = 250 / 72;

const isTextItem = (item: unknown): item is PdfTextItem => {
    if (!item || typeof item !== 'object') return false;
    return typeof (item as Partial<PdfTextItem>).str === 'string';
};

const normalizeMetadataValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replaceAll('\0', '').trim();
    return normalized || undefined;
};

const readMetadataValue = (
    metadata: PdfMetadata,
    infoKey: string,
    xmpKey: string,
): string | undefined => {
    return normalizeMetadataValue(metadata.info[infoKey])
        || normalizeMetadataValue(metadata.metadata?.get(xmpKey));
};

const appendTextItem = (current: string, item: PdfTextItem): string => {
    const value = item.str.replaceAll('\0', '');
    if (!value) return item.hasEOL && current && !current.endsWith('\n') ? `${current}\n` : current;

    const needsSpace = current.length > 0
        && !/\s$/.test(current)
        && !/^[,.;:!?%)\]}]/.test(value);
    const combined = `${current}${needsSpace ? ' ' : ''}${value}`;
    return item.hasEOL ? `${combined}\n` : combined;
};

const getTextDirection = (direction?: string): PdfTextDirection => {
    if (direction === 'rtl') return 'rtl';
    if (direction === 'ttb') return 'ttb';
    return 'ltr';
};

const getViewportPoint = (viewport: PdfViewport, x: number, y: number): [number, number] => {
    const point = viewport.convertToViewportPoint?.(x, y);
    return point || [x, viewport.height - y];
};

const getTextItemBox = (
    item: PdfTextItem,
    viewport: PdfViewport,
    startFraction: number,
    endFraction: number,
): { box: PdfLayoutWord['box']; baseline: number } | undefined => {
    if (!item.transform || item.transform.length < 6) return undefined;
    const [a, b, c, d, e, f] = item.transform;
    const horizontalLength = Math.hypot(a, b) || 1;
    const verticalLength = Math.hypot(c, d) || item.height || horizontalLength;
    const xUnit = [a / horizontalLength, b / horizontalLength];
    const yUnit = [c / verticalLength, d / verticalLength];
    const itemWidth = item.width && item.width > 0 ? item.width : horizontalLength;
    const itemHeight = item.height && item.height > 0 ? item.height : verticalLength;
    const start = itemWidth * startFraction;
    const end = itemWidth * endFraction;
    const points = [
        getViewportPoint(viewport, e + xUnit[0] * start, f + xUnit[1] * start),
        getViewportPoint(viewport, e + xUnit[0] * end, f + xUnit[1] * end),
        getViewportPoint(viewport, e + xUnit[0] * end + yUnit[0] * itemHeight, f + xUnit[1] * end + yUnit[1] * itemHeight),
        getViewportPoint(viewport, e + xUnit[0] * start + yUnit[0] * itemHeight, f + xUnit[1] * start + yUnit[1] * itemHeight),
    ];
    const rawBox = {
        x0: Math.min(...points.map(([x]) => x)),
        y0: Math.min(...points.map(([, y]) => y)),
        x1: Math.max(...points.map(([x]) => x)),
        y1: Math.max(...points.map(([, y]) => y)),
    };
    const baseline = getViewportPoint(viewport, e + xUnit[0] * start, f + xUnit[1] * start)[1] / viewport.height;
    return {
        box: normalizePdfBox(rawBox, viewport.width, viewport.height),
        baseline: Math.min(1, Math.max(0, baseline)),
    };
};

const extractEmbeddedWords = (
    pageNumber: number,
    items: unknown[],
    viewport: PdfViewport,
): PdfLayoutWord[] => {
    const words: PdfLayoutWord[] = [];
    for (const [itemIndex, rawItem] of items.entries()) {
        if (!isTextItem(rawItem)) continue;
        const value = rawItem.str.replaceAll('\0', '');
        const tokens = value.match(/\S+/g) || [];
        let searchStart = 0;
        for (const [wordIndex, token] of tokens.entries()) {
            const start = value.indexOf(token, searchStart);
            const end = start + token.length;
            searchStart = end;
            const geometry = getTextItemBox(rawItem, viewport, start / Math.max(1, value.length), end / Math.max(1, value.length));
            if (!geometry) continue;
            words.push({
                id: `p${pageNumber}-embedded-${itemIndex}-${wordIndex}`,
                pageNumber,
                text: token,
                box: geometry.box,
                baseline: geometry.baseline,
                fontName: rawItem.fontName,
                fontSize: rawItem.height,
                direction: getTextDirection(rawItem.dir),
                source: 'embedded',
                sourceLineId: `embedded-${itemIndex}`,
            });
        }
    }
    return words;
};

const extractOcrWords = (
    pageNumber: number,
    words: PdfOcrWord[],
    width: number,
    height: number,
): PdfLayoutWord[] => words.map((word, index) => ({
    id: `p${pageNumber}-ocr-${index}`,
    pageNumber,
    text: word.text,
    box: normalizePdfBox(word.boundingBox, width, height),
    baseline: Math.min(1, Math.max(0, word.boundingBox.y1 / height)),
    confidence: word.confidence,
    direction: 'ltr',
    source: 'ocr',
    sourceBlockId: word.blockId,
    sourceLineId: word.lineId,
}));

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new DOMException('PDF parsing was cancelled.', 'AbortError');
};

const createCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined') throw new Error('PDF OCR requires a browser canvas.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

const getOcrViewport = (page: PdfPage): PdfViewport => {
    const baseViewport = page.getViewport({ scale: 1 });
    const requestedScale = OCR_SCALE;
    const longEdgeScale = MAX_OCR_LONG_EDGE / Math.max(baseViewport.width, baseViewport.height);
    const pixelScale = Math.sqrt(MAX_OCR_PIXELS / Math.max(1, baseViewport.width * baseViewport.height));
    const scale = Math.min(requestedScale, longEdgeScale, pixelScale);
    return page.getViewport({ scale: Math.max(1, scale) });
};

const renderPageForOcr = async (page: PdfPage, signal?: AbortSignal): Promise<HTMLCanvasElement | OffscreenCanvas> => {
    throwIfAborted(signal);
    const viewport = getOcrViewport(page);
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for local PDF OCR.');
    const htmlCanvas = typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
        ? canvas
        : null;
    await page.render({ canvasContext: context, canvas: htmlCanvas, viewport }).promise;
    throwIfAborted(signal);
    return canvas;
};

const releaseCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas): void => {
    canvas.width = 0;
    canvas.height = 0;
};

const describePdfError = (error: unknown): Error => {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);

    if (name === 'PasswordException' || /password/i.test(message)) {
        return new Error('Password-protected PDFs are not supported. Remove the password and try again.');
    }
    if (name === 'InvalidPDFException') {
        return new Error('The PDF is malformed or invalid.');
    }

    return new Error(`Could not read PDF: ${message || 'Unknown PDF parsing error.'}`);
};

export const parsePdfWithPdfJs = async (
    rawData: Uint8Array,
    onProgress?: (message: string) => void,
    options: PdfParseOptions = {},
): Promise<ParsedPdfDocument> => {
    const operation = createOperationHandle({
        kind: 'ingest',
        intervalMs: 0,
        publish: (update) => {
            if (update.state === 'running') {
                onProgress?.(update.message ?? update.phase);
            }
        },
    });
    const report = (message: string, phase: string): void => {
        operation.report({
            kind: 'ingest',
            phase,
            message,
            state: 'running',
        });
    };
    let loadingTask: PdfLoadingTask | undefined;
    let pdfDocument: PdfDocument | undefined;
    let ocrEngine: PdfOcrEngine | undefined;
    let ownsOcrEngine = false;

    try {
        const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
            import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        GlobalWorkerOptions.workerSrc = workerModule.default;

        const task = getDocument({
            data: rawData.slice(),
            enableXfa: false,
            isEvalSupported: false,
            stopAtErrors: true,
        }) as unknown as PdfLoadingTask;
        loadingTask = task;
        const loadedDocument = await task.promise;
        pdfDocument = loadedDocument;

        if (loadedDocument.numPages > MAX_PDF_PAGES) {
            throw new Error(`PDF has too many pages. The maximum supported count is ${MAX_PDF_PAGES.toLocaleString()}.`);
        }

        const metadata = await loadedDocument.getMetadata() as PdfMetadata;
        const pageLabels = await loadedDocument.getPageLabels();
        const outline = await extractOutline(loadedDocument);
        if (options.useOcr) {
            ocrEngine = options.ocrEngine || new TesseractPdfOcrEngine();
            ownsOcrEngine = !options.ocrEngine;
        }
        const pages: ParsedPdfDocument['pages'] = [];

        for (let pageNumber = 1; pageNumber <= loadedDocument.numPages; pageNumber++) {
            throwIfAborted(options.signal);
            report(`Extracting PDF page ${pageNumber} of ${loadedDocument.numPages}...`, 'pdf-page');
            const page = await loadedDocument.getPage(pageNumber);
            const textContent = await page.getTextContent({
                disableNormalization: false,
                includeMarkedContent: false,
            });
            const viewport = page.getViewport({ scale: 1 });
            let words = extractEmbeddedWords(pageNumber, textContent.items, viewport);
            let text = textContent.items
                .filter(isTextItem)
                .reduce(appendTextItem, '')
                .trim();

            if (!text && ocrEngine) {
                report(`Rendering PDF page ${pageNumber} for local OCR...`, 'ocr-render');
                let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
                try {
                    canvas = await renderPageForOcr(page, options.signal);
                    const ocrResult = await ocrEngine.recognize(canvas, (progress) => {
                        report(`OCR page ${pageNumber} of ${loadedDocument.numPages}: ${progress.status} ${Math.round(progress.progress * 100)}%`, 'ocr');
                    });
                    text = ocrResult.text;
                    words = extractOcrWords(pageNumber, ocrResult.words, canvas.width, canvas.height);
                } catch (error) {
                    report(`OCR failed for PDF page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`, 'ocr-error');
                } finally {
                    if (canvas) releaseCanvas(canvas);
                }
            }

            const parsedPage = {
                pageNumber,
                label: pageLabels?.[pageNumber - 1] || undefined,
                text,
                ...(words.length > 0 ? { words } : {}),
            };
            pages.push(parsedPage);
        }

        const result = {
            title: readMetadataValue(metadata, 'Title', 'dc:title'),
            author: readMetadataValue(metadata, 'Author', 'dc:creator'),
            pages,
            ...(outline.length > 0 ? { outline } : {}),
        };
        operation.complete('PDF parsed');
        return result;
    } catch (error) {
        const normalizedError = describePdfError(error);
        if (options.signal?.aborted) {
            operation.cancel();
        } else {
            operation.fail(normalizedError);
        }
        throw normalizedError;
    } finally {
        if (ownsOcrEngine && ocrEngine) {
            await ocrEngine.close().catch(() => undefined);
        }
        if (pdfDocument) {
            await pdfDocument.destroy().catch(() => undefined);
        } else if (loadingTask) {
            await loadingTask.destroy().catch(() => undefined);
        }
    }
};