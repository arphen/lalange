import JSZip from 'jszip';
import { buildEpubStructurePlan, loadPlannedChapterSources } from '../structure';
import { decodeUtf8 } from './utils';
import { EpubIngestReader } from './epubReader';
import { MarkdownIngestReader } from './markdownReader';
import { PdfIngestReader, type PdfReaderDependencies } from './pdfReader';
import { parsePdfWithPdfJs } from './pdfjsAdapter';
import { PlainTextIngestReader } from './plainTextReader';
import { IngestReaderRegistry } from './registry';

export interface DefaultReaderDependencies {
    loadZip: (input: File | Uint8Array) => Promise<JSZip>;
    buildEpubStructurePlan: typeof buildEpubStructurePlan;
    loadPlannedChapterSources: typeof loadPlannedChapterSources;
    decodeText: (data: Uint8Array) => string;
    parsePdf: PdfReaderDependencies['parsePdf'];
}

export const createDefaultIngestReaderRegistry = (
    dependencies: Partial<DefaultReaderDependencies> = {},
): IngestReaderRegistry => {
    const resolvedDependencies: DefaultReaderDependencies = {
        loadZip: dependencies.loadZip || ((input) => JSZip.loadAsync(input)),
        buildEpubStructurePlan: dependencies.buildEpubStructurePlan || buildEpubStructurePlan,
        loadPlannedChapterSources: dependencies.loadPlannedChapterSources || loadPlannedChapterSources,
        decodeText: dependencies.decodeText || decodeUtf8,
        parsePdf: dependencies.parsePdf || parsePdfWithPdfJs,
    };

    return new IngestReaderRegistry([
        new EpubIngestReader({
            loadZip: resolvedDependencies.loadZip,
            buildEpubStructurePlan: resolvedDependencies.buildEpubStructurePlan,
            loadPlannedChapterSources: resolvedDependencies.loadPlannedChapterSources,
        }),
        new PdfIngestReader({ parsePdf: resolvedDependencies.parsePdf }),
        new MarkdownIngestReader({ decodeText: resolvedDependencies.decodeText }),
        new PlainTextIngestReader({ decodeText: resolvedDependencies.decodeText }),
    ]);
};

export const defaultIngestReaderRegistry = createDefaultIngestReaderRegistry();

export { IngestReaderRegistry } from './registry';
export { EpubIngestReader } from './epubReader';
export { PdfIngestReader, MAX_PDF_BYTES, MAX_PDF_PAGES, isPdfData } from './pdfReader';
export { parsePdfWithPdfJs } from './pdfjsAdapter';
export { PlainTextIngestReader } from './plainTextReader';
export { MarkdownIngestReader } from './markdownReader';
export { encodeRawFilePayload, decodeRawFilePayload } from './rawFilePayload';
export { readFileAsUint8Array } from './utils';
export type {
    IngestReaderPlugin,
    ReaderPreparedBook,
    ReaderResolvedChapter,
    ReaderPlannedChapter,
    ReaderChapterSlice,
    ReaderImageAsset,
} from './types';
export type { ParsedPdfDocument, ParsedPdfPage, PdfReaderDependencies } from './pdfReader';
