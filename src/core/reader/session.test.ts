import { describe, expect, it } from 'vitest';
import {
    createReaderSessionSnapshot,
    reduceReaderSession,
    type ReaderSessionSnapshot,
} from './session';

const reduce = (snapshot: ReaderSessionSnapshot, ...commands: Parameters<typeof reduceReaderSession>[1][]) => (
    commands.reduce(reduceReaderSession, snapshot)
);

describe('reader session reducer', () => {
    it('claims one transport when playback starts', () => {
        const initial = createReaderSessionSnapshot('book-1', 'chapter-1');

        const playing = reduce(initial, { type: 'play', transport: 'rsvp' });
        const switched = reduce(playing, { type: 'play', transport: 'tts' });

        expect(playing).toMatchObject({ transport: 'rsvp', playing: true });
        expect(switched).toMatchObject({ transport: 'tts', playing: true });
    });

    it('releases the previous transport before another owner takes over', () => {
        const initial = createReaderSessionSnapshot('book-1', 'chapter-1');
        const playing = reduce(initial, { type: 'play', transport: 'rsvp' });

        const switched = reduce(
            playing,
            { type: 'claim-transport', transport: 'tts' },
            { type: 'play', transport: 'tts' },
        );

        expect(switched).toMatchObject({ transport: 'tts', playing: true });
        expect(switched.transport).not.toBe('rsvp');
    });

    it('pauses and clamps manual seeks', () => {
        const playing = reduce(
            createReaderSessionSnapshot('book-1', 'chapter-1'),
            { type: 'play', transport: 'rsvp' },
        );

        expect(reduce(playing, { type: 'seek', chapterId: 'chapter-2', wordIndex: -2 })).toMatchObject({
            chapterId: 'chapter-2',
            wordIndex: 0,
            playing: false,
            mode: 'text',
        });
    });

    it('blocks playback during transitions and clears cancelled transitions', () => {
        const initial = createReaderSessionSnapshot('book-1', 'chapter-1');
        const transitioning = reduce(initial, {
            type: 'begin-transition',
            phase: 'braking',
            targetChapterId: 'chapter-2',
        });

        expect(reduce(transitioning, { type: 'play', transport: 'rsvp' })).toBe(transitioning);
        expect(reduce(transitioning, { type: 'cancel-transition' })).toMatchObject({
            mode: 'text',
            playing: false,
            transition: undefined,
        });
    });

    it('keeps a destination seek inside the active transition until completion', () => {
        const transitioning = reduce(
            createReaderSessionSnapshot('book-1', 'chapter-1'),
            { type: 'begin-transition', phase: 'crossing', targetChapterId: 'chapter-2' },
            { type: 'seek', chapterId: 'chapter-2', wordIndex: 4 },
        );

        expect(transitioning).toMatchObject({
            chapterId: 'chapter-2',
            wordIndex: 4,
            mode: 'chapter-transition',
            playing: false,
            transition: {
                phase: 'crossing',
                targetChapterId: 'chapter-2',
            },
        });

        expect(reduce(transitioning, {
            type: 'complete-transition',
            chapterId: 'chapter-2',
            wordIndex: 4,
        })).toMatchObject({
            mode: 'text',
            playing: false,
            transition: undefined,
        });
    });
});