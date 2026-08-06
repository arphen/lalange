import type {
    BoundaryEvidence,
    ChapterSource,
    ReformationReason,
    SectionOwnership,
    StructureMode,
} from '../structure';
import type { PdfNoteAnchor, PdfNoteEntry } from './pdfNotes';

export interface ReaderImageAsset {
    filename: string;
    data: string;
    mimeType: string;
}

export interface ReaderStructureMetadata {
    structureOwnership?: SectionOwnership;
    reformationReason?: ReformationReason;
    boundaryEvidence?: BoundaryEvidence[];
    authoredGroupTitle?: string;
    originalTitles?: string[];
}

export interface ReaderPlannedChapter extends ReaderStructureMetadata {
    title: string;
    source: ChapterSource;
}

export interface ReaderChapterSlice {
    text: string;
    html: string;
}

export interface ReaderResolvedChapter extends ReaderStructureMetadata {
    title: string;
    source: ChapterSource;
    slices: ReaderChapterSlice[];
    notes?: PdfNoteEntry[];
    noteAnchors?: PdfNoteAnchor[];
}

export interface ReaderPreparedBook {
    title: string;
    author: string;
    coverBase64?: string;
    images: ReaderImageAsset[];
    chapters: ReaderPlannedChapter[];
    structureVersion?: 1;
    structureMode?: StructureMode;
}

export interface IngestReaderPlugin {
    id: string;
    displayName: string;
    extensions: string[];
    mimeTypes: string[];
    acceptsFile: (file: File) => boolean;
    supportsRaw: (data: Uint8Array) => boolean;
    prepareInitial: (file: File, onProgress?: (message: string) => void) => Promise<ReaderPreparedBook>;
    loadChapters: (rawData: Uint8Array, onProgress?: (message: string) => void) => Promise<ReaderResolvedChapter[]>;
}
