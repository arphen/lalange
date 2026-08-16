import { describe, expect, it } from 'vitest';
import { createReaderBenchmarkFixture } from './readerBenchmark';

const benchmarkWords = [
    'The', 'reader', 'moves', 'through', 'a', 'small', 'chapter', 'with', 'steady', 'timing.',
    'The', 'next', 'window', 'reuses', 'most', 'of', 'its', 'existing', 'word', 'nodes.',
];

describe('Reader benchmark fixture', () => {
    it('keeps RSVP projection work deterministic with rivers enabled', () => {
        const fixture = createReaderBenchmarkFixture({ words: benchmarkWords, wpm: 600 });

        fixture.playRsvp();
        fixture.runRsvp(2000);

        const result = fixture.snapshot();
        expect(result).toMatchObject({
            mode: 'text',
            transport: 'rsvp',
            playing: true,
            framesAdvanced: 20,
            cursor: 20,
            riverRebuilds: 2,
        });
        expect(result.centerProjections).toBeGreaterThan(result.framesAdvanced);
        expect(result.riverNodesCreated).toBeGreaterThan(0);
    });

    it('covers summary, chapter transition, seek, and TTS handoff state paths', () => {
        const fixture = createReaderBenchmarkFixture({ words: benchmarkWords, wpm: 600 });

        fixture.playRsvp();
        fixture.runRsvp(300);
        const textCursor = fixture.snapshot().cursor;

        fixture.beginSummary(['A', 'short', 'summary.']);
        expect(fixture.snapshot()).toMatchObject({ mode: 'summary', playing: false });
        fixture.completeSummary();
        expect(fixture.snapshot()).toMatchObject({ mode: 'text', cursor: textCursor });

        fixture.beginChapterTransition('chapter-2');
        expect(fixture.snapshot()).toMatchObject({ mode: 'chapter-transition', playing: false });
        fixture.completeChapterTransition('chapter-2', 2);
        expect(fixture.snapshot()).toMatchObject({ mode: 'text', cursor: 2 });

        fixture.seek(5);
        expect(fixture.snapshot()).toMatchObject({ cursor: 5, playing: false });

        fixture.claimTts();
        expect(fixture.snapshot()).toMatchObject({ transport: 'tts', playing: false });
        fixture.releaseTts();
        fixture.playRsvp();
        expect(fixture.snapshot()).toMatchObject({ transport: 'rsvp', playing: true });
    });
});