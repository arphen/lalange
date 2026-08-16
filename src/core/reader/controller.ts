import {
    createReaderSessionSnapshot,
    reduceReaderSession,
    type ReaderSessionCommand,
    type ReaderSessionSnapshot,
} from './session';
import { createReaderSessionSequence, type ReaderSessionSequence } from './sessionSequence';

export type ReaderSessionListener = () => void;

export interface ReaderSessionController {
    getSnapshot: () => ReaderSessionSnapshot;
    subscribe: (listener: ReaderSessionListener) => () => void;
    dispatch: (command: ReaderSessionCommand) => void;
    createSequence: () => ReaderSessionSequence;
    dispose: () => void;
}

export const createReaderSessionController = (
    initialSnapshot: ReaderSessionSnapshot,
): ReaderSessionController => {
    let snapshot = initialSnapshot;
    let disposed = false;
    const sessionAbortController = new AbortController();
    const listeners = new Set<ReaderSessionListener>();

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            if (disposed) return () => undefined;
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispatch: (command) => {
            if (disposed) return;
            const nextSnapshot = reduceReaderSession(snapshot, command);
            if (nextSnapshot === snapshot) return;
            snapshot = nextSnapshot;
            listeners.forEach((listener) => listener());
        },
        createSequence: () => createReaderSessionSequence(sessionAbortController.signal),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            sessionAbortController.abort();
            listeners.clear();
        },
    };
};

export const createReaderSessionControllerForBook = (
    bookId: string,
    chapterId: string,
    wordIndex = 0,
): ReaderSessionController => (
    createReaderSessionController(createReaderSessionSnapshot(bookId, chapterId, wordIndex))
);