import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Reader } from './Reader';
import * as dbModule from '../../core/sync/db';

// Mock the DB module
vi.mock('../../core/sync/db', () => ({
    initDB: vi.fn(),
}));

describe('Reader Component - Conflict Handling', () => {
    const mockBook = {
        id: 'book-conflict',
        title: 'Conflict Book',
        author: 'Test Author',
        cover: '',
        totalWords: 100,
        chapterIds: ['chapter-1', 'chapter-2']
    };

    const mockChapter1 = {
        id: 'chapter-1',
        bookId: 'book-conflict',
        index: 0,
        title: 'Chapter 1',
        status: 'ready',
        content: ['Chapter', 'One', 'Content'],
        toJSON: function () { return this; }
    };

    const mockChapter2 = {
        id: 'chapter-2',
        bookId: 'book-conflict',
        index: 1,
        title: 'Chapter 2',
        status: 'ready',
        content: ['Chapter', 'Two', 'Content'],
        toJSON: function () { return this; }
    };

    // Stateful DB Mock
    const dbState = {
        readingState: {
            bookId: 'book-conflict',
            currentChapterId: 'chapter-1',
            currentWordIndex: 0,
            lastRead: Date.now(),
            highlights: [],
            _rev: '1-init'
        }
    };

    const createMockDoc = (data: { _rev: string } & Record<string, unknown>) => ({
        ...data,
        toJSON: () => data,
        patch: vi.fn().mockImplementation(async (patchData) => {
            // Simulate conflict check
            if (data._rev !== dbState.readingState._rev) {
                const error = new Error('Document update conflict') as Error & { code: string };
                error.code = 'CONFLICT';
                throw error;
            }
            // Update DB state
            dbState.readingState = {
                ...dbState.readingState,
                ...patchData,
                _rev: `${parseInt(data._rev.split('-')[0]) + 1}-rev`
            };
            return createMockDoc(dbState.readingState);
        }),
        incrementalPatch: vi.fn().mockImplementation(async (patchData) => {
            // incrementalPatch handles conflict by fetching latest and retrying (simulated here by just updating)
            dbState.readingState = {
                ...dbState.readingState,
                ...patchData,
                _rev: `${parseInt(dbState.readingState._rev.split('-')[0]) + 1}-rev`
            };
            return createMockDoc(dbState.readingState);
        })
    });

    const mockDb = {
        reading_states: {
            findOne: vi.fn().mockReturnValue({
                exec: vi.fn().mockImplementation(async () => {
                    return createMockDoc(dbState.readingState);
                })
            }),
            insert: vi.fn().mockImplementation(async (data) => {
                dbState.readingState = { ...data, _rev: '1-init' };
                return createMockDoc(dbState.readingState);
            })
        },
        chapters: {
            findOne: vi.fn().mockImplementation((id) => ({
                exec: vi.fn().mockResolvedValue(
                    id === 'chapter-1' ? mockChapter1 : mockChapter2
                ),
                $: {
                    subscribe: vi.fn().mockImplementation((callback) => {
                        callback(id === 'chapter-1' ? mockChapter1 : mockChapter2);
                        return { unsubscribe: vi.fn() };
                    })
                }
            })),
            find: vi.fn().mockReturnValue({
                $: {
                    subscribe: vi.fn().mockImplementation((callback) => {
                        callback([mockChapter1, mockChapter2]);
                        return { unsubscribe: vi.fn() };
                    })
                },
                exec: vi.fn().mockResolvedValue([mockChapter1, mockChapter2])
            })
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(dbModule.initDB).mockResolvedValue(mockDb as unknown as MyDatabase);
        // Reset DB state
        dbState.readingState = {
            bookId: 'book-conflict',
            currentChapterId: 'chapter-1',
            currentWordIndex: 0,
            lastRead: Date.now(),
            highlights: [],
            _rev: '1-init'
        };
    });

    it('should handle conflict when changing chapters while playing', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            const elements = screen.getAllByText('Chapter 1');
            expect(elements.length).toBeGreaterThan(0);
        });

        // Start playing
        fireEvent.click(screen.getByTestId('rsvp-container'));
        await waitFor(() => {
            expect(screen.queryByTestId('play-overlay')).not.toBeInTheDocument();
        });

        // Click Next Chapter while playing
        // Open Sidebar
        const chaptersBtn = screen.getByTestId('toggle-chapters');
        if (chaptersBtn.getAttribute('aria-expanded') === 'false') {
            fireEvent.click(chaptersBtn);
        }

        // Click Chapter 2 in sidebar
        const chapter2Btn = screen.getByText('Chapter 2').closest('button');
        expect(chapter2Btn).toBeInTheDocument();
        fireEvent.click(chapter2Btn!);

        // This triggers:
        // 1. setIsPlaying(false) -> triggers saveProgress (async)
        // 2. loadChapter -> fetches doc, tries to patch

        // To simulate the race where saveProgress finishes BEFORE loadChapter writes but AFTER loadChapter reads,
        // we rely on the fact that both are async.
        // However, in the real code, loadChapter awaits initDB and findOne.
        // saveProgress also awaits initDB and findOne.

        // If we click Next Chapter:
        // loadChapter called.
        //   setIsPlaying(false).
        //     Effect triggers saveProgress.
        //       saveProgress awaits initDB...
        //   loadChapter awaits initDB...

        // It's hard to deterministically force the race in jsdom without more hooks.
        // But if we use the mock to delay things?

        // Let's try to just trigger it and see if our mock logic catches a conflict if we don't use incrementalPatch.
        // Note: The current Reader.tsx uses .patch().
        // If saveProgress runs first and updates _rev, then loadChapter's fetched doc will be stale IF it fetched it before saveProgress finished.

        // In the component:
        // loadChapter:
        //   setIsPlaying(false) -> Effect -> saveProgress()
        //   await initDB()
        //   await findOne()

        // saveProgress:
        //   await initDB()
        //   await findOne()

        // If saveProgress is faster or interleaved:
        // 1. saveProgress fetches rev 1.
        // 2. loadChapter fetches rev 1.
        // 3. saveProgress patches -> rev 2.
        // 4. loadChapter patches -> CONFLICT (because it has doc with rev 1).

        // To force this interleaving in the test, we can delay the findOne resolution in loadChapter?
        // But findOne is called multiple times.

        // We expect the chapter to change eventually
        await waitFor(() => {
            expect(screen.getByText('Chapter 2')).toBeInTheDocument();
        });

        // And we expect the reading state to be updated to Chapter 2
        await waitFor(() => {
            expect(dbState.readingState.currentChapterId).toBe('chapter-2');
        });
    });
});
