import type {
    BookDocType,
    ChapterDocType,
    HighlightType,
    ImageDocType,
    RawFileDocType,
    TTSPositionType,
    TTSSettingsType,
} from '../sync/db';

export const EXCHANGE_PROTOCOL_VERSION = 1;

export type ExchangeIntent = 'give' | 'handoff' | 'reconcile';
export type ExchangeScope = 'selection' | 'library';
export type ExchangeContinuationMode = 'reading' | 'listening';

export interface ExchangeDeviceIdentity {
    id: string;
    name: string;
    createdAt: number;
}

export interface ExchangeDataSelection {
    content: boolean;
    analysis: boolean;
    progress: boolean;
    highlights: boolean;
    listening: boolean;
}

export interface ExchangeProgressSnapshot {
    currentChapterId?: string;
    currentWordIndex: number;
    lastRead: number;
    ttsPosition?: TTSPositionType;
    ttsSettings?: TTSSettingsType;
}

export interface ExchangeReadingData {
    progress?: ExchangeProgressSnapshot;
    highlights?: HighlightType[];
}

export interface ExchangeBookContent {
    book: BookDocType;
    chapters: ChapterDocType[];
    images: ImageDocType[];
    rawFile?: RawFileDocType;
}

export interface ExchangeFingerprints {
    content?: string;
    progress?: string;
    highlights?: string;
}

export interface ExchangeBookPayload {
    bookId: string;
    title: string;
    author?: string;
    content?: ExchangeBookContent;
    reading?: ExchangeReadingData;
    fingerprints: ExchangeFingerprints;
    estimatedBytes: number;
}

export interface ExchangeContinuation {
    bookId: string;
    chapterId: string;
    wordIndex: number;
    mode: ExchangeContinuationMode;
    sentenceIndex?: number;
    audioTime?: number;
}

export interface ExchangeManifestBook {
    bookId: string;
    title: string;
    author?: string;
    estimatedBytes: number;
    fingerprints: ExchangeFingerprints;
}

export interface ExchangeInvitationSummary {
    intent: ExchangeIntent;
    scope: ExchangeScope;
    sourceDevice: ExchangeDeviceIdentity;
    bookCount: number;
    books: Array<Pick<ExchangeManifestBook, 'bookId' | 'title' | 'author' | 'estimatedBytes'>>;
    selection: ExchangeDataSelection;
}

export interface ExchangeManifest {
    protocolVersion: typeof EXCHANGE_PROTOCOL_VERSION;
    exchangeId: string;
    intent: ExchangeIntent;
    scope: ExchangeScope;
    sourceDevice: ExchangeDeviceIdentity;
    createdAt: number;
    expiresAt: number;
    selection: ExchangeDataSelection;
    books: ExchangeManifestBook[];
    continuation?: ExchangeContinuation;
}

export function summarizeExchangeInvitation(manifest: ExchangeManifest): ExchangeInvitationSummary {
    return {
        intent: manifest.intent,
        scope: manifest.scope,
        sourceDevice: manifest.sourceDevice,
        bookCount: manifest.books.length,
        books: manifest.books.slice(0, 12).map(({ bookId, title, author, estimatedBytes }) => ({
            bookId,
            title,
            author,
            estimatedBytes,
        })),
        selection: manifest.selection,
    };
}

export interface ExchangeBundle {
    manifest: ExchangeManifest;
    books: ExchangeBookPayload[];
}

export interface ExchangeEntityHashes {
    content?: string;
    progress?: string;
    highlights?: string;
}

export interface ExchangeLedgerEntry {
    peerDeviceId: string;
    bookId: string;
    exchangeId: string;
    completedAt: number;
    hashes: ExchangeEntityHashes;
}

export type ExchangeComparison =
    | 'same'
    | 'incoming-only-change'
    | 'local-only-change'
    | 'concurrent-change';

export type ContentResolution = 'keep-local' | 'take-incoming' | 'keep-both';
export type ProgressResolution = 'keep-local' | 'take-incoming' | 'keep-both-bookmarks';
export type HighlightResolution =
    | 'keep-local'
    | 'take-incoming'
    | 'merge-prefer-local'
    | 'merge-prefer-incoming';

export interface ExchangeBookResolution {
    content?: ContentResolution;
    progress?: ProgressResolution;
    highlights?: HighlightResolution;
}

export interface ExchangeBookConflict {
    bookId: string;
    title: string;
    content: ExchangeComparison;
    progress: ExchangeComparison;
    highlights: ExchangeComparison;
    suggestedResolution: ExchangeBookResolution;
}

export interface ExchangeImportPlan {
    exchangeId: string;
    sourceDevice: ExchangeDeviceIdentity;
    intent: ExchangeIntent;
    books: ExchangeBookConflict[];
    hasConflicts: boolean;
}
