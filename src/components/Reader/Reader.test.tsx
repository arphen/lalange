import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Reader } from './Reader';
import * as dbModule from '../../core/sync/db';

const mockSetSchedulerCursor = vi.hoisted(() => vi.fn());

vi.mock('../../core/ingest/scheduler', () => ({
    scheduler: { setCursor: mockSetSchedulerCursor },
}));

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
        // Reset the reading_states.findOne mock to return default state (chapter-1, word 0)
        mockDb.reading_states.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockReadingState)
        });
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

    it('should skip an empty saved placeholder and open the first readable chapter', async () => {
        const emptyPlaceholder = {
            id: 'chapter-0',
            bookId: 'book-1',
            index: 0,
            title: 'Cover',
            status: 'ready',
            content: [],
            metadata: { classificationType: 'image' },
            toJSON: function () { return this; }
        };
        const savedPlaceholderState = {
            ...mockReadingState,
            currentChapterId: 'chapter-0',
            toJSON: function () { return this; }
        };
        const chapters = [emptyPlaceholder, mockChapter1, mockChapter2];

        mockDb.reading_states.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue(savedPlaceholderState)
        });
        mockDb.chapters.findOne.mockImplementation((id) => ({
            exec: vi.fn().mockResolvedValue(chapters.find(chapter => chapter.id === id)),
            $: {
                subscribe: vi.fn().mockImplementation((callback) => {
                    callback(chapters.find(chapter => chapter.id === id));
                    return { unsubscribe: vi.fn() };
                })
            }
        }));
        mockDb.chapters.find.mockReturnValue({
            $: {
                subscribe: vi.fn().mockImplementation((callback) => {
                    callback(chapters);
                    return { unsubscribe: vi.fn() };
                })
            },
            exec: vi.fn().mockResolvedValue(chapters)
        });

        render(<Reader book={{ ...mockBook, chapterIds: ['chapter-0', 'chapter-1', 'chapter-2'] }} />);

        await waitFor(() => {
            expect(screen.getByTestId('rsvp-container')).toHaveTextContent('Hello');
        });
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

    it('should ignore ghost click after touch drag on RSVP lane', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        const rsvpContainer = screen.getByTestId('rsvp-container');
        const touchSurface = rsvpContainer.firstElementChild as HTMLElement;
        expect(touchSurface).toBeTruthy();

        fireEvent.touchStart(touchSurface, {
            touches: [{ identifier: 1, clientX: 100, clientY: 100 }],
        });
        fireEvent.touchMove(touchSurface, {
            touches: [{ identifier: 1, clientX: 100, clientY: 132 }],
        });
        fireEvent.touchEnd(touchSurface, { touches: [] });

        fireEvent.click(rsvpContainer);

        expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
    });

    it('should not toggle play from river background click after scroll', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        const topRiver = screen.getByTestId('reader-context-top');
        fireEvent.scroll(topRiver);
        fireEvent.click(topRiver);

        expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
    });

    it('should keep playback running when selecting a river word', async () => {
        const { container } = render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('play-overlay')).toBeInTheDocument();
        });

        const rsvpContainer = screen.getByTestId('rsvp-container');
        fireEvent.click(rsvpContainer);

        await waitFor(() => {
            expect(screen.queryByTestId('play-overlay')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            const wordSpan = container.querySelector('[data-index="2"]');
            expect(wordSpan).toBeInTheDocument();
        });

        const wordSpan = container.querySelector('[data-index="2"]');
        expect(wordSpan).toBeTruthy();
        fireEvent.click(wordSpan!);

        expect(screen.queryByTestId('play-overlay')).not.toBeInTheDocument();
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

        await waitFor(() => {
            const sidebar = screen.getByTestId('sidebar-container');
            expect(sidebar).toHaveClass('translate-x-full');
        });
    });

    it('should close the chapter drawer on swipe-right gesture', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            const sidebar = screen.getByTestId('sidebar-container');
            expect(sidebar).toHaveClass('translate-x-0');
        });

        const sidebar = screen.getByTestId('sidebar-container');
        fireEvent.touchStart(sidebar, {
            touches: [{ identifier: 1, clientX: 24, clientY: 120 }],
        });
        fireEvent.touchMove(sidebar, {
            touches: [{ identifier: 1, clientX: 120, clientY: 124 }],
        });
        fireEvent.touchEnd(sidebar, { touches: [] });

        await waitFor(() => {
            expect(sidebar).toHaveClass('translate-x-full');
        });
    });

    it('should keep the chapter drawer closed by default on mobile', async () => {
        const originalWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

        const { unmount } = render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.getByTestId('sidebar-container')).toHaveClass('translate-x-full');
        });

        unmount();
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    });

    it('should seek forward when swiping up on the RSVP lane', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            expect(screen.getByTestId('rsvp-container')).toHaveTextContent('Hello');
        });

        const rsvpContainer = screen.getByTestId('rsvp-container');
        const touchSurface = rsvpContainer.firstElementChild as HTMLElement;
        fireEvent.touchStart(touchSurface, {
            touches: [{ identifier: 1, clientX: 100, clientY: 120 }],
        });
        fireEvent.touchMove(touchSurface, {
            touches: [{ identifier: 1, clientX: 100, clientY: 64 }],
        });
        fireEvent.touchEnd(touchSurface, {
            touches: [],
            changedTouches: [{ identifier: 1, clientX: 100, clientY: 64 }],
        });

        expect(rsvpContainer).toHaveTextContent('this');
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

    it('should resume from saved reading position', async () => {
        // Setup a state that is NOT at the start - user was reading Chapter 2
        const savedState = {
            ...mockReadingState,
            currentChapterId: 'chapter-2',
            currentWordIndex: 1,  // Second word of chapter 2 ("chapter")
            toJSON: function () { return this; },
            patch: vi.fn(),
            incrementalPatch: vi.fn()
        };
        
        // Override the mock for this test
        mockDb.reading_states.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue(savedState)
        });

        render(<Reader book={mockBook} />);
        
        await waitFor(() => {
            expect(screen.queryByText('INITIALIZING COCKPIT...')).not.toBeInTheDocument();
        });

        // Should resume at Chapter 2, word index 1 ("chapter"), NOT Chapter 1 ("Hello")
        // This verifies reading position persistence works correctly
        const rsvpContainer = screen.getByTestId('rsvp-container');
        expect(rsvpContainer).toHaveTextContent('chapter');

        await waitFor(() => {
            expect(mockSetSchedulerCursor).toHaveBeenCalledWith('book-1', 'chapter-2', 1, 7);
        });
    });

    it('should display the first word in the RSVP center area immediately after loading', async () => {
        // This test specifically checks that the RSVP display (the big word in the center)
        // shows the first word of the chapter immediately after loading completes.
        // The user reported that this area was blank on initial load.
        
        render(<Reader book={mockBook} />);
        
        // Wait for loading to complete
        await waitFor(() => {
            expect(screen.queryByText('INITIALIZING COCKPIT...')).not.toBeInTheDocument();
        });

        // The RSVP display is the div with ref={rsvpRef} inside the rsvp-container
        // It should contain the first word "Hello" rendered via the display plugin
        const rsvpContainer = screen.getByTestId('rsvp-container');
        
        // Find the actual RSVP word display element (the inner div that shows the word)
        // This is the element that was blank in the user's screenshot
        const rsvpWordDisplay = rsvpContainer.querySelector('.text-6xl, .md\\:text-8xl');
        
        expect(rsvpWordDisplay).toBeInTheDocument();
        expect(rsvpWordDisplay).not.toBeEmptyDOMElement();
        expect(rsvpWordDisplay?.textContent?.trim()).toBe('Hello');
    });

    it('should display first word even when chapter subscription emits asynchronously', async () => {
        // This test simulates the real-world scenario more closely:
        // The chapter subscription callback fires asynchronously after React has
        // already rendered the component once without any content.
        
        let subscribeCallback: ((doc: typeof mockChapter1) => void) | null = null;
        
        // Create a mock that captures the subscribe callback and calls it asynchronously
        const asyncMockDb = {
            ...mockDb,
            chapters: {
                ...mockDb.chapters,
                findOne: vi.fn().mockImplementation((id) => ({
                    exec: vi.fn().mockResolvedValue(
                        id === 'chapter-1' ? mockChapter1 : mockChapter2
                    ),
                    $: {
                        subscribe: vi.fn().mockImplementation((callback) => {
                            // Store the callback but don't call it yet
                            subscribeCallback = callback;
                            return { unsubscribe: vi.fn() };
                        })
                    }
                })),
                find: mockDb.chapters.find
            }
        };
        
        vi.mocked(dbModule.initDB).mockResolvedValue(asyncMockDb as unknown as MyDatabase);

        render(<Reader book={mockBook} />);
        
        // Should show loading initially
        expect(screen.getByText('INITIALIZING COCKPIT...')).toBeInTheDocument();
        
        // Wait a tick for the async loadChapter to set up the subscription
        await waitFor(() => {
            expect(subscribeCallback).not.toBeNull();
        });
        
        // Now simulate the async emission of chapter data
        // This is what happens in the real app after RxDB emits the document
        subscribeCallback!(mockChapter1);
        
        // Wait for loading to complete
        await waitFor(() => {
            expect(screen.queryByText('INITIALIZING COCKPIT...')).not.toBeInTheDocument();
        });

        // The RSVP container should now show "Hello"
        const rsvpContainer = screen.getByTestId('rsvp-container');
        const rsvpWordDisplay = rsvpContainer.querySelector('.text-6xl');
        
        expect(rsvpWordDisplay).toBeInTheDocument();
        // This assertion will FAIL if the bug exists - the display will be empty
        expect(rsvpWordDisplay?.textContent?.trim()).toBe('Hello');
    });

    it('should show first word in RSVP display element (not just container)', async () => {
        // This test checks the EXACT element that displays the word
        // The rsvpRef div should contain the word set via innerHTML by renderWord
        
        render(<Reader book={mockBook} />);
        
        await waitFor(() => {
            expect(screen.queryByText('INITIALIZING COCKPIT...')).not.toBeInTheDocument();
        });

        const rsvpContainer = screen.getByTestId('rsvp-container');
        
        // The word display is inside the rsvp-container, with classes text-6xl md:text-8xl
        // Find all elements with text-6xl class
        const textDisplayElements = rsvpContainer.querySelectorAll('[class*="text-6xl"]');
        
        // There should be exactly one element showing the word
        expect(textDisplayElements.length).toBeGreaterThan(0);
        
        const wordDisplayElement = textDisplayElements[0];
        
        // The element should not be empty and should contain the first word
        expect(wordDisplayElement?.textContent?.trim()).not.toBe('');
        expect(wordDisplayElement?.textContent).toContain('Hello');
    });
});
