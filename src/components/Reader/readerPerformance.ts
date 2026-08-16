export interface ReaderPerformanceSnapshot {
    readerCommits: number;
    centerProjections: number;
    riverRebuilds: number;
    riverNodesCreated: number;
    schedulerCursorPublications: number;
    persistenceWrites: number;
}

export type ReaderPerformanceCounter = keyof ReaderPerformanceSnapshot;

export interface ReaderPerformanceCounters {
    readonly enabled: boolean;
    record: (counter: ReaderPerformanceCounter, amount?: number) => void;
    snapshot: () => ReaderPerformanceSnapshot;
    reset: () => void;
}

const emptySnapshot = (): ReaderPerformanceSnapshot => ({
    readerCommits: 0,
    centerProjections: 0,
    riverRebuilds: 0,
    riverNodesCreated: 0,
    schedulerCursorPublications: 0,
    persistenceWrites: 0,
});

export const createReaderPerformanceCounters = (enabled = false): ReaderPerformanceCounters => {
    let counters = emptySnapshot();

    return {
        enabled,
        record: (counter, amount = 1) => {
            if (!enabled) return;
            counters[counter] += amount;
        },
        snapshot: () => ({ ...counters }),
        reset: () => {
            counters = emptySnapshot();
        },
    };
};

const readerPerformanceEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('readerPerf');

export const readerPerformanceCounters = createReaderPerformanceCounters(readerPerformanceEnabled);

declare global {
    interface Window {
        __XYZ_READER_PERF__?: ReaderPerformanceCounters;
    }
}

if (readerPerformanceEnabled) {
    window.__XYZ_READER_PERF__ = readerPerformanceCounters;
}