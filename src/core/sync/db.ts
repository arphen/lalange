import { createRxDatabase, addRxPlugin, type RxDatabase, type RxCollection, type RxStorage } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { bookSchema, chapterSchema, readingStateSchema, imageSchema, rawFileSchema } from './schema';

// Define types for the database
export type BookDocType = {
    id: string;
    title: string;
    author?: string;
    cover?: string;
    totalWords: number;
    chapterIds: string[];
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

export type MyDatabaseCollections = {
    books: BookCollection;
    chapters: ChapterCollection;
    reading_states: ReadingStateCollection;
    images: ImageCollection;
    raw_files: RawFileCollection;
};

export type MyDatabase = RxDatabase<MyDatabaseCollections>;

let dbPromise: Promise<MyDatabase> | null = null;

export const initDB = async (): Promise<MyDatabase> => {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = (async () => {
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
            multiInstance: false // Disable multi-tab leader election - required for WebRTC replication to start immediately
        });

        await db.addCollections({
            books: {
                schema: bookSchema
            },
            chapters: {
                schema: chapterSchema
            },
            reading_states: {
                schema: readingStateSchema
            },
            images: {
                schema: imageSchema
            },
            raw_files: {
                schema: rawFileSchema
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
