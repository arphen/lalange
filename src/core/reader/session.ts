export type TransportOwner = 'none' | 'rsvp' | 'tts';
export type ReaderMode = 'text' | 'summary' | 'chapter-transition' | 'image-break';

export interface ReaderTransition {
    phase: string;
    targetChapterId?: string;
}

export interface ReaderSessionSnapshot {
    bookId: string;
    chapterId: string;
    wordIndex: number;
    mode: ReaderMode;
    transport: TransportOwner;
    playing: boolean;
    transition?: ReaderTransition;
}

export type ReaderSessionCommand =
    | { type: 'play'; transport: Exclude<TransportOwner, 'none'> }
    | { type: 'pause' }
    | { type: 'claim-transport'; transport: Exclude<TransportOwner, 'none'> }
    | { type: 'release-transport'; transport: Exclude<TransportOwner, 'none'> }
    | { type: 'seek'; chapterId: string; wordIndex: number }
    | { type: 'set-mode'; mode: ReaderMode }
    | { type: 'begin-transition'; phase: string; targetChapterId?: string }
    | { type: 'complete-transition'; chapterId: string; wordIndex: number }
    | { type: 'cancel-transition' };

export const createReaderSessionSnapshot = (
    bookId: string,
    chapterId: string,
    wordIndex = 0,
): ReaderSessionSnapshot => ({
    bookId,
    chapterId,
    wordIndex,
    mode: 'text',
    transport: 'none',
    playing: false,
});

const clampWordIndex = (wordIndex: number): number => Math.max(0, Math.floor(wordIndex));

export const reduceReaderSession = (
    snapshot: ReaderSessionSnapshot,
    command: ReaderSessionCommand,
): ReaderSessionSnapshot => {
    switch (command.type) {
        case 'play':
            if (snapshot.mode === 'chapter-transition') return snapshot;
            return {
                ...snapshot,
                transport: command.transport,
                playing: true,
            };
        case 'pause':
            return snapshot.playing ? { ...snapshot, playing: false } : snapshot;
        case 'claim-transport':
            return {
                ...snapshot,
                transport: command.transport,
                playing: false,
            };
        case 'release-transport':
            return snapshot.transport === command.transport
                ? { ...snapshot, transport: 'none', playing: false }
                : snapshot;
        case 'seek':
            return {
                ...snapshot,
                chapterId: command.chapterId,
                wordIndex: clampWordIndex(command.wordIndex),
                mode: 'text',
                playing: false,
            };
        case 'set-mode':
            return {
                ...snapshot,
                mode: command.mode,
                transition: command.mode === 'chapter-transition' ? snapshot.transition : undefined,
            };
        case 'begin-transition':
            return {
                ...snapshot,
                mode: 'chapter-transition',
                playing: false,
                transition: {
                    phase: command.phase,
                    targetChapterId: command.targetChapterId,
                },
            };
        case 'complete-transition':
            return {
                ...snapshot,
                chapterId: command.chapterId,
                wordIndex: clampWordIndex(command.wordIndex),
                mode: 'text',
                playing: false,
                transition: undefined,
            };
        case 'cancel-transition':
            return snapshot.mode === 'chapter-transition'
                ? { ...snapshot, mode: 'text', playing: false, transition: undefined }
                : snapshot;
    }
};