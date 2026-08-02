import type { ChapterSource } from '../structure';

export interface ReaderImageAsset {
    filename: string;
    data: string;
    mimeType: string;
}

export interface ReaderPlannedChapter {
    title: string;
    source: ChapterSource;
}

export interface ReaderChapterSlice {
    text: string;
    html: string;
}

export interface ReaderResolvedChapter {
    title: string;
    source: ChapterSource;
    slices: ReaderChapterSlice[];
}

export interface ReaderPreparedBook {
    title: string;
    author: string;
    coverBase64?: string;
    images: ReaderImageAsset[];
    chapters: ReaderPlannedChapter[];
}

export interface IngestReaderPlugin {
    id: string;
    displayName: string;
    extensions: string[];
    mimeTypes: string[];
    acceptsFile: (file: File) => boolean;
    supportsRaw: (data: Uint8Array) => boolean;
    prepareInitial: (file: File, onProgress?: (message: string) => void) => Promise<ReaderPreparedBook>;
    loadChapters: (rawData: Uint8Array) => Promise<ReaderResolvedChapter[]>;
}
