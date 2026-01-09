import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Reader } from './Reader';
import * as dbModule from '../../core/sync/db';

// Mock the DB module
vi.mock('../../core/sync/db', () => ({
    initDB: vi.fn(),
    // Mock types if needed, but usually not for runtime
}));

describe('Reader Component', () => {
    const mockBook = {
        id: 'book-1',
        title: 'Test Book',
        author: 'Test Author',
        cover: '',
        totalWords: 100,
        chapterIds: ['chapter-1', 'chapter-2']
    };

    const mockChapter1 = {
        id: 'chapter-1',
        bookId: 'book-1',
        index: 0,
        title: 'Chapter 1',
        status: 'ready',
        content: ['Hello', 'world', 'this', 'is', 'a', 'test'],
        toJSON: function () { return this; }
    };

    const mockChapter2 = {
        id: 'chapter-2',
        bookId: 'book-1',
        index: 1,
        title: 'Chapter 2',
        status: 'ready',
        content: ['Second', 'chapter', 'content'],
        toJSON: function () { return this; }
    };

    const mockReadingState = {
        bookId: 'book-1',
        currentChapterId: 'chapter-1',
        currentWordIndex: 0,
        lastRead: Date.now(),
        highlights: [],
        toJSON: function () { return this; },
        patch: vi.fn(),
        incrementalPatch: vi.fn()
    };

    const mockDb = {
        reading_states: {
            findOne: vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(mockReadingState)
            }),
            insert: vi.fn().mockResolvedValue(mockReadingState)
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
    });

    it('should render loading state initially', () => {
        render(<Reader book={mockBook} />);
        expect(screen.getByText('INITIALIZING COCKPIT...')).toBeInTheDocument();
    });

    it('should load and display the first word', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.queryByText('INITIALIZING COCKPIT...')).not.toBeInTheDocument();
        });

        // The word "Hello" should be split.
        // In the new gradient implementation, "Hello" is split into individual characters for the first 4 in the RSVP view.
        // H (900), e (800), l (700), l (600), o (light)

        // Check RSVP container text content
        const rsvpContainer = screen.getByTestId('rsvp-container');
        expect(rsvpContainer).toHaveTextContent('Hello');
    });

    it('should display chapter title', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            // There might be multiple "Chapter 1" (sidebar and main view)
            const elements = screen.getAllByText('Chapter 1');
            expect(elements.length).toBeGreaterThan(0);
        });
    });

    it('should have the sidebar open by default', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            const sidebar = screen.getByTestId('sidebar-container');
            expect(sidebar).toHaveClass('translate-x-0');
            expect(sidebar).not.toHaveClass('translate-x-full');
        });
    });

    it('should toggle play/pause', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        // Click the RSVP container to toggle play
        const rsvpContainer = screen.getByTestId('rsvp-container');
        fireEvent.click(rsvpContainer);

        // Should be playing now (no overlay)
        await waitFor(() => {
            expect(screen.queryByTestId('play-overlay')).not.toBeInTheDocument();
        });

        // Click again to pause
        fireEvent.click(rsvpContainer);

        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });
    });

    it('should navigate to next chapter', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            const elements = screen.getAllByText('Chapter 1');
            expect(elements.length).toBeGreaterThan(0);
        });

        // Open Sidebar
        const chaptersBtn = screen.getByTitle('Chapters');
        fireEvent.click(chaptersBtn);

        // Click Chapter 2 in sidebar
        // The sidebar renders buttons for chapters. We can find it by text.
        // Note: The sidebar might be rendering "Chapter 2" inside a button.
        const chapter2Btn = screen.getByText('Chapter 2').closest('button');
        expect(chapter2Btn).toBeInTheDocument();
        fireEvent.click(chapter2Btn!);

        await waitFor(() => {
            // Check if content updated to "Second"
            const rsvpContainer = screen.getByTestId('rsvp-container');
            expect(rsvpContainer).toHaveTextContent('Second');
        });
    });

    it('should save progress when pausing', async () => {
        const { container } = render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        // Simulate clicking a word in the "River of Text" (Next Context)
        // The words are rendered with data-index attributes
        // We want to click the word at index 2 ("this")

        // We need to wait for the next context to be rendered
        await waitFor(() => {
            const wordSpan = container.querySelector('[data-index="2"]');
            expect(wordSpan).toBeInTheDocument();
        });

        const wordSpan = container.querySelector('[data-index="2"]');
        expect(wordSpan).not.toBeNull();

        fireEvent.click(wordSpan!);

        // Clicking a word jumps to it and pauses (calls saveProgress)
        await waitFor(() => {
            expect(mockReadingState.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({
                currentWordIndex: 2
            }));
        });
    });

    it('should toggle play/pause with spacebar', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        // Press Spacebar
        fireEvent.keyDown(window, { key: ' ', code: 'Space' });

        // Should be playing now (no overlay)
        await waitFor(() => {
            expect(screen.queryByTestId('play-overlay')).not.toBeInTheDocument();
        });

        // Press Spacebar again
        fireEvent.keyDown(window, { key: ' ', code: 'Space' });

        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });
    });
});
