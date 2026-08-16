import type { RxDocument } from 'rxdb';
import {
    initDB,
    type BookDocType,
    type ChapterDocType,
    type ImageDocType,
    type MyDatabase,
    type ReadingStateDocType,
} from '../sync/db';

type Subscription = { unsubscribe: () => void };
type ReadingStateDocument = RxDocument<ReadingStateDocType>;
type OpenDatabase = () => Promise<MyDatabase>;

export interface ReaderSessionDataSource {
    subscribeToChapters: (
        bookId: string,
        onChange: (chapters: ChapterDocType[]) => void,
    ) => Promise<boolean>;
    subscribeToBook: (
        bookId: string,
        onChange: (book: BookDocType) => void,
    ) => Promise<boolean>;
    subscribeToImages: (
        bookId: string,
        onChange: (images: ImageDocType[]) => void,
    ) => Promise<boolean>;
    subscribeToChapter: (
        chapterId: string,
        onChange: (chapter: ChapterDocType, isInitial: boolean) => void | Promise<void>,
    ) => Promise<boolean>;
    findChapter: (chapterId: string) => Promise<ChapterDocType | null>;
    listChapters: (bookId: string) => Promise<ChapterDocType[]>;
    getOrCreateReadingState: (bookId: string, firstChapterId?: string) => Promise<ReadingStateDocument>;
    dispose: () => void;
}

export const createReaderSessionDataSource = (
    sessionKey = 'reader',
    openDatabase: OpenDatabase = initDB,
): ReaderSessionDataSource => {
    let disposed = false;
    const subscriptions = new Map<string, Subscription>();
    const subscriptionVersions = new Map<string, number>();
    let cancelPendingChapterLoad: (() => void) | null = null;

    const cancelSubscription = (key: string) => {
        const scopedKey = `${sessionKey}:${key}`;
        subscriptions.get(scopedKey)?.unsubscribe();
        subscriptions.delete(scopedKey);
    };

    const subscribe = async (
        key: string,
        createSubscription: (database: MyDatabase) => Subscription | null,
    ): Promise<boolean> => {
        cancelSubscription(key);
        const scopedKey = `${sessionKey}:${key}`;
        const version = (subscriptionVersions.get(scopedKey) || 0) + 1;
        subscriptionVersions.set(scopedKey, version);
        const database = await openDatabase();
        if (disposed || subscriptionVersions.get(scopedKey) !== version) return false;

        const subscription = createSubscription(database);
    if (!subscription) return false;
        if (disposed || subscriptionVersions.get(scopedKey) !== version) {
            subscription.unsubscribe();
            return false;
        }

        subscriptions.set(scopedKey, subscription);
        return true;
    };

    const subscribeToChapters = async (
        bookId: string,
        onChange: (chapters: ChapterDocType[]) => void,
    ): Promise<boolean> => subscribe('chapters', (database) => (
        database.chapters.find({
            selector: { bookId },
            sort: [{ index: 'asc' }],
        }).$.subscribe((documents) => {
            if (disposed) return;
            onChange(documents.map((document) => document.toJSON() as ChapterDocType));
        })
    ));

    const subscribeToBook = async (
        bookId: string,
        onChange: (book: BookDocType) => void,
    ): Promise<boolean> => subscribe('book', (database) => {
        if (!database.books) return null;
        return database.books.findOne(bookId).$.subscribe((document) => {
            if (disposed || !document) return;
            onChange(document.toJSON() as BookDocType);
        });
    });

    const subscribeToImages = async (
        bookId: string,
        onChange: (images: ImageDocType[]) => void,
    ): Promise<boolean> => subscribe('images', (database) => {
        if (!database.images) return null;
        return database.images.find({ selector: { bookId } }).$.subscribe((documents) => {
            if (disposed) return;
            onChange(documents.map((document) => document.toJSON() as ImageDocType));
        });
    });

    const subscribeToChapter = async (
        chapterId: string,
        onChange: (chapter: ChapterDocType, isInitial: boolean) => void | Promise<void>,
    ): Promise<boolean> => {
        cancelPendingChapterLoad?.();
        cancelPendingChapterLoad = null;

        let resolveInitial: ((attached: boolean) => void) | null = null;
        let initialResolved = false;
        const initialLoad = new Promise<boolean>((resolve) => {
            resolveInitial = resolve;
        });
        const resolveInitialLoad = (attached: boolean) => {
            if (initialResolved) return;
            initialResolved = true;
            resolveInitial?.(attached);
            resolveInitial = null;
            if (cancelPendingChapterLoad === cancelInitialLoad) {
                cancelPendingChapterLoad = null;
            }
        };
        const cancelInitialLoad = () => resolveInitialLoad(false);
        cancelPendingChapterLoad = cancelInitialLoad;

        const attached = await subscribe('chapter', (database) => (
            database.chapters.findOne(chapterId).$.subscribe((document) => {
                if (disposed || !document) return;
                const chapter = document.toJSON() as ChapterDocType;
                const isInitial = !initialResolved;
                void Promise.resolve(onChange(chapter, isInitial)).then(() => {
                    if (isInitial) resolveInitialLoad(true);
                }).catch(() => {
                    if (isInitial) resolveInitialLoad(false);
                });
            })
        ));

        if (!attached) resolveInitialLoad(false);
        return initialLoad;
    };

    const findChapter = async (chapterId: string): Promise<ChapterDocType | null> => {
        const database = await openDatabase();
        if (disposed) return null;
        const document = await database.chapters.findOne(chapterId).exec();
        return document ? document.toJSON() as ChapterDocType : null;
    };

    const listChapters = async (bookId: string): Promise<ChapterDocType[]> => {
        const database = await openDatabase();
        if (disposed) return [];
        const documents = await database.chapters.find({
            selector: { bookId },
            sort: [{ index: 'asc' }],
        }).exec();
        return documents.map((document) => document.toJSON() as ChapterDocType);
    };

    const getOrCreateReadingState = async (
        bookId: string,
        firstChapterId?: string,
    ): Promise<ReadingStateDocument> => {
        const database = await openDatabase();
        if (disposed) throw new Error('Reader session data source is disposed');

        let state = await database.reading_states.findOne(bookId).exec();
        if (!state) {
            state = await database.reading_states.insert({
                bookId,
                currentChapterId: firstChapterId,
                currentWordIndex: 0,
                lastRead: Date.now(),
                highlights: [],
            });
        }
        return state;
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelPendingChapterLoad?.();
        cancelPendingChapterLoad = null;
        [...subscriptions.values()].forEach((subscription) => subscription.unsubscribe());
        subscriptions.clear();
    };

    return {
        subscribeToChapters,
        subscribeToBook,
        subscribeToImages,
        subscribeToChapter,
        findChapter,
        listChapters,
        getOrCreateReadingState,
        dispose,
    };
};