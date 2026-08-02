import { MAX_PDF_PAGES, type ParsedPdfDocument } from './pdfReader';

interface PdfTextItem {
    str: string;
    hasEOL: boolean;
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

interface PdfDocument {
    numPages: number;
    getMetadata: () => Promise<unknown>;
    getPageLabels: () => Promise<string[] | null>;
    getPage: (pageNumber: number) => Promise<{
        getTextContent: (options: {
            disableNormalization: boolean;
            includeMarkedContent: boolean;
        }) => Promise<{ items: unknown[] }>;
    }>;
    destroy: () => Promise<void>;
}

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
): Promise<ParsedPdfDocument> => {
    let loadingTask: PdfLoadingTask | undefined;
    let pdfDocument: PdfDocument | undefined;

    try {
        const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
            import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ]);
        GlobalWorkerOptions.workerSrc = workerModule.default;

        loadingTask = getDocument({
            data: rawData.slice(),
            enableXfa: false,
            isEvalSupported: false,
            stopAtErrors: true,
        });
        const loadedDocument = await loadingTask.promise;
        pdfDocument = loadedDocument;

        if (loadedDocument.numPages > MAX_PDF_PAGES) {
            throw new Error(`PDF has too many pages. The maximum supported count is ${MAX_PDF_PAGES.toLocaleString()}.`);
        }

        const metadata = await loadedDocument.getMetadata() as PdfMetadata;
        const pageLabels = await loadedDocument.getPageLabels();
        const pages: ParsedPdfDocument['pages'] = [];

        for (let pageNumber = 1; pageNumber <= loadedDocument.numPages; pageNumber++) {
            onProgress?.(`Extracting PDF page ${pageNumber} of ${loadedDocument.numPages}...`);
            const page = await loadedDocument.getPage(pageNumber);
            const textContent = await page.getTextContent({
                disableNormalization: false,
                includeMarkedContent: false,
            });
            const text = textContent.items
                .filter(isTextItem)
                .reduce(appendTextItem, '')
                .trim();

            pages.push({
                pageNumber,
                label: pageLabels?.[pageNumber - 1] || undefined,
                text,
            });
        }

        return {
            title: readMetadataValue(metadata, 'Title', 'dc:title'),
            author: readMetadataValue(metadata, 'Author', 'dc:creator'),
            pages,
        };
    } catch (error) {
        throw describePdfError(error);
    } finally {
        if (pdfDocument) {
            await pdfDocument.destroy().catch(() => undefined);
        } else if (loadingTask) {
            await loadingTask.destroy().catch(() => undefined);
        }
    }
};