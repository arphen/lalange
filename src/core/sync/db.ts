import { createRxDatabase, addRxPlugin, type RxDatabase, type RxCollection, type RxStorage } from 'rxdb';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import {
    bookSchema,
    chapterSchema,
    readingStateSchema,
    imageSchema,
    rawFileSchema,
    textIssueSchema,
    contentRevisionSchema,
    repairAnnotationSchema,
    processingJobSchema,
} from './schema';
import type { TextIssueCandidate } from '../ingest/anomalyScanner';
import type {
    BoundaryEvidence,
    ReformationReason,
    SectionOwnership,
    StructureMode,
} from '../ingest/structure';
import type { PdfNoteAnchor, PdfNoteEntry } from '../ingest/readers/pdfNotes';

addRxPlugin(RxDBMigrationSchemaPlugin);

// Define types for the database
export type GlobalSummaryType = {
    id: string;                    // e.g., "book123_summary_0"
    startWordIndex: number;        // Global word index (across all chapters)
    endWordIndex: number;
    startChapterId: string;
    endChapterId: string;
    summary: string;
    generatedAt: number;           // Timestamp
};

export type BookDocType = {
    id: string;
    title: string;
    author?: string;
    cover?: string;
    totalWords: number;
    chapterIds: string[];
    structureVersion?: number;
    structureMode?: StructureMode;
    globalSummaries?: GlobalSummaryType[];  // Book-level summaries every X words
};

export type RawFileDocType = {
    id: string;
    data: string;
};

export type ImageDocType = {
    id: string;
    bookId: string;
    filename: string;
    data: string;
    mimeType?: string;
};

export type ChapterDocType = {
    id: string;
    bookId: string;
    index: number;
    title: string;
    status: 'pending' | 'processing' | 'ready' | 'error';
    progress?: number;
    processingSpeed?: number;
    lastTPM?: number;
    lastChunkCompletedAt?: number;
    content: string[];
    paragraphBreaks?: number[];
    notes?: PdfNoteEntry[];
    noteAnchors?: PdfNoteAnchor[];
    densities?: number[];
    analysisData?: {
        tokens: string[];
        surprisals: number[];
    }[];
    subchapters?: {
        title: string;
        summary: string;
        startWordIndex: number;
        endWordIndex: number;
    }[];
    /** Metadata about chapter classification (license, TOC, etc.) */
    metadata?: {
        classificationType?: 'content' | 'license' | 'toc' | 'cover' | 'frontmatter' | 'backmatter' | 'image';
        classificationReason?: string;
        structureSource?: 'toc' | 'heading' | 'spine' | 'merged';
        structureOwnership?: SectionOwnership;
        reformationReason?: ReformationReason;
        boundaryEvidence?: BoundaryEvidence[];
        authoredGroupTitle?: string;
        originalTitles?: string[];
        licenseInfo?: {
            publisher: string;
            text: string;
        };
        tocEntries?: {
            title: string;
            href?: string;
        }[];
    };
};

export type HighlightType = {
    id: string;
    chapterId: string;
    startWordIndex: number;
    endWordIndex: number;
    text: string;
    note?: string;
    createdAt: number;
};

export type TTSPositionType = {
    chapterId: string;
    sentenceIndex: number;
    wordIndex: number;
    audioTime: number;
    timestamp: number;
};

export type TTSSettingsType = {
    voice: string;
    speed: number;
};

export type RepairAction = 'keep' | 'replace' | 'delete' | 'merge' | 'split';

export type RepairProposalType = {
    candidateId: string;
    action: RepairAction;
    replacement?: string;
    reasonCode: 'encoding-artifact' | 'ocr-substitution' | 'stray-page-marker' | 'broken-boundary' | 'punctuation-artifact' | 'consistent-book-form' | 'uncertain';
};

export type TextIssueDocType = TextIssueCandidate & {
    state: 'open' | 'accepted' | 'kept-original' | 'rejected' | 'stale';
    proposal?: RepairProposalType;
    createdAt: number;
    updatedAt: number;
};

export type ContentRevisionDocType = {
    id: string;
    bookId: string;
    sourceUnitId: string;
    parentRevisionId?: string;
    sourceHash: string;
    textHash: string;
    pipelineVersion: string;
    acceptedPatchIds: string[];
    createdAt: number;
    state: 'prepared' | 'active' | 'superseded';
};

export type RepairAnnotationDocType = {
    id: string;
    bookId: string;
    sourceUnitId: string;
    sourceRevisionId: string;
    canonicalRevisionId: string;
    sourceAnchor: {
        startOffset: number;
        endOffset: number;
        startTokenId?: string;
        endTokenId?: string;
        contextHash: string;
    };
    canonicalAnchor: {
        startOffset: number;
        endOffset: number;
        startTokenId?: string;
        endTokenId?: string;
        anchorHash: string;
    };
    originalText?: string;
    replacementText?: string;
    action: RepairAction;
    detectorIds: string[];
    detectorEvidence: Record<string, string | number | boolean>;
    modelFingerprint?: string;
    promptFingerprint?: string;
    validatorFingerprint: string;
    pipelineFingerprint: string;
    proposalState: 'proposed' | 'accepted' | 'kept-original' | 'rejected' | 'superseded';
    acceptedAt?: number;
    acceptanceAction?: 'accept' | 'keep-original' | 'accept-all-safe';
    renderRange: {
        kind: 'text-range';
        startOffset: number;
        endOffset: number;
        anchorHash: string;
    };
};

export type ProcessingJobDocType = {
    id: string;
    dedupeKey: string;
    feature: 'pacing' | 'repair' | 'structure' | 'summary' | 'tts-annotation';
    bookId: string;
    sourceUnitId?: string;
    inputRevisionHash: string;
    modelFingerprint: string;
    pipelineVersion: string;
    state: 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'stale';
    attemptCount: number;
    checkpoint?: string;
    createdAt: number;
    updatedAt: number;
};

export type ReadingStateDocType = {
    bookId: string;
    currentChapterId?: string;
    currentWordIndex: number;
    lastRead: number;
    highlights: HighlightType[];
    ttsPosition?: TTSPositionType;
    ttsSettings?: TTSSettingsType;
};

export type BookCollection = RxCollection<BookDocType>;
export type ChapterCollection = RxCollection<ChapterDocType>;
export type ReadingStateCollection = RxCollection<ReadingStateDocType>;
export type ImageCollection = RxCollection<ImageDocType>;
export type RawFileCollection = RxCollection<RawFileDocType>;
export type TextIssueCollection = RxCollection<TextIssueDocType>;
export type ContentRevisionCollection = RxCollection<ContentRevisionDocType>;
export type RepairAnnotationCollection = RxCollection<RepairAnnotationDocType>;
export type ProcessingJobCollection = RxCollection<ProcessingJobDocType>;

export type MyDatabaseCollections = {
    books: BookCollection;
    chapters: ChapterCollection;
    reading_states: ReadingStateCollection;
    images: ImageCollection;
    raw_files: RawFileCollection;
    text_issues: TextIssueCollection;
    content_revisions: ContentRevisionCollection;
    repair_annotations: RepairAnnotationCollection;
    processing_jobs: ProcessingJobCollection;
};

export type MyDatabase = RxDatabase<MyDatabaseCollections>;

export const bookMigrationStrategies = {
    1: (document: BookDocType): BookDocType => document,
};

export const chapterMigrationStrategies = {
    1: (document: ChapterDocType): ChapterDocType => document,
    2: (document: ChapterDocType): ChapterDocType => ({
        ...document,
        notes: document.notes || [],
        noteAnchors: document.noteAnchors || [],
    }),
    3: (document: ChapterDocType): ChapterDocType => ({
        ...document,
        paragraphBreaks: document.paragraphBreaks || [],
    }),
    4: (document: ChapterDocType): ChapterDocType => document,
};

let dbPromise: Promise<MyDatabase> | null = null;

export const ensureWebCrypto = (): void => {
    if (typeof globalThis.crypto?.subtle?.digest === 'function') return;

    throw new Error(
        'Local storage requires Web Crypto (crypto.subtle.digest). Open XYZ through https:// or http://localhost, not an insecure network URL.',
    );
};

export const initDB = async (): Promise<MyDatabase> => {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = (async () => {
        ensureWebCrypto();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let storage: RxStorage<any, any> = getRxStorageDexie();
        if (import.meta.env.DEV) {
            const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode');
            addRxPlugin(RxDBDevModePlugin);

            const { wrappedValidateAjvStorage } = await import('rxdb/plugins/validate-ajv');
            storage = wrappedValidateAjvStorage({
                storage
            });
        }

        const db = await createRxDatabase<MyDatabaseCollections>({
            name: 'xyz_db_v17', // Bumped to force fresh DB (multiInstance change)
            storage,
            ignoreDuplicate: import.meta.env.DEV,
            // multiInstance: false disables multi-tab leader election.
            // This is required for WebRTC sync to start immediately without waiting for leadership.
            // Tradeoff: Users should not open the app in multiple tabs simultaneously to avoid
            // potential consistency issues. The app's PWA nature (standalone mode) mitigates this.
            multiInstance: false
        });

        await db.addCollections({
            books: {
                schema: bookSchema,
                migrationStrategies: bookMigrationStrategies,
            },
            chapters: {
                schema: chapterSchema,
                migrationStrategies: chapterMigrationStrategies,
            },
            reading_states: {
                schema: readingStateSchema
            },
            images: {
                schema: imageSchema
            },
            raw_files: {
                schema: rawFileSchema
            },
            text_issues: {
                schema: textIssueSchema,
            },
            content_revisions: {
                schema: contentRevisionSchema,
            },
            repair_annotations: {
                schema: repairAnnotationSchema,
            },
            processing_jobs: {
                schema: processingJobSchema,
            }
        });

        return db;
    })();

    return dbPromise;
};

export const resetDB = async () => {
    const db = await initDB();
    await db.remove();
    window.location.reload();
};
