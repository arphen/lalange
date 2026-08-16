import { describe, expect, it } from 'vitest';
import { createReaderPerformanceCounters } from './readerPerformance';

describe('reader performance counters', () => {
    it('does not collect data when instrumentation is disabled', () => {
        const counters = createReaderPerformanceCounters();

        counters.record('readerCommits', 3);

        expect(counters.snapshot()).toEqual({
            readerCommits: 0,
            centerProjections: 0,
            riverRebuilds: 0,
            riverNodesCreated: 0,
            schedulerCursorPublications: 0,
            persistenceWrites: 0,
        });
    });

    it('records and resets bounded counter snapshots', () => {
        const counters = createReaderPerformanceCounters(true);

        counters.record('centerProjections');
        counters.record('riverNodesCreated', 12);
        counters.record('persistenceWrites');

        expect(counters.snapshot()).toMatchObject({
            centerProjections: 1,
            riverNodesCreated: 12,
            persistenceWrites: 1,
        });

        counters.reset();

        expect(counters.snapshot()).toEqual({
            readerCommits: 0,
            centerProjections: 0,
            riverRebuilds: 0,
            riverNodesCreated: 0,
            schedulerCursorPublications: 0,
            persistenceWrites: 0,
        });
    });
});