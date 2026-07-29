import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Reader } from './Reader';
import * as dbModule from '../../core/sync/db';
import { useSettingsStore } from '../../core/store/settings';
import { useAIStore } from '../../core/store/ai';
import { useTTSStore } from '../../core/store/tts';

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
        subchapters: [
            { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 3 },
            { title: 'Part 2', summary: '', startWordIndex: 3, endWordIndex: 6 },
        ],
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
        useSettingsStore.persist.setOptions({
            storage: {
                getItem: vi.fn(() => null),
                setItem: vi.fn(),
                removeItem: vi.fn(),
            },
        });
        useTTSStore.persist.setOptions({
            storage: {
                getItem: vi.fn(() => null),
                setItem: vi.fn(),
                removeItem: vi.fn(),
            },
        });
        useSettingsStore.getState().aiEnabled = true;
        useSettingsStore.getState().focusModeEnabled = false;
        useSettingsStore.getState().riverTopEnabled = true;
        useSettingsStore.getState().riverBottomEnabled = true;
        useAIStore.getState().isLoading = false;
        // Reset the reading_states.findOne mock to return default state (chapter-1, word 0)
        mockDb.reading_states.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockReadingState)
        });
        vi.mocked(dbModule.initDB).mockResolvedValue(mockDb as unknown as MyDatabase);
    });

    it('should render loading state initially', () => {
        render(<Reader book={mockBook} />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading book...');
    });

    it('should let the user return to the library while loading', () => {
        const onBack = vi.fn();
        render(<Reader book={mockBook} onBack={onBack} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));

        expect(onBack).toHaveBeenCalledOnce();
    });

    it('should load and display the first word', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
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
            expect(screen.getByTestId('speed-controls')).toHaveClass('md:mr-80');
        });
    });

    it('harmonizes listen panel placement with the chapter drawer', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));

        const panel = screen.getByTestId('tts-player-panel');
        expect(panel).toHaveClass('md:right-[21rem]');
        expect(panel).toHaveClass('opacity-0');

        fireEvent.click(screen.getByTestId('toggle-chapters'));

        await waitFor(() => {
            expect(panel).not.toHaveClass('md:right-[21rem]');
            expect(panel).not.toHaveClass('opacity-0');
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

    it('should keep river typography stable on hover', async () => {
        const { container } = render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(container.querySelector('.word-span')).toBeInTheDocument();
        });

        const riverWord = container.querySelector('.word-span');
        expect(riverWord).not.toHaveClass('group', 'transition-all', 'hover:text-white');
        riverWord?.querySelectorAll('span').forEach((letter) => {
            expect(letter.className).not.toContain('group-hover:opacity-100');
        });
    });

    it('should brake, cross, and launch when navigating to the next chapter', async () => {
        render(<Reader book={mockBook} />);
        await waitFor(() => {
            const elements = screen.getAllByText('Chapter 1');
            expect(elements.length).toBeGreaterThan(0);
        });

        // Open Sidebar
        const chaptersBtn = screen.getByTestId('toggle-chapters');
        if (chaptersBtn.getAttribute('aria-expanded') === 'false') {
            fireEvent.click(chaptersBtn);
        }

        // Click Chapter 2 in sidebar
        // The sidebar renders buttons for chapters. We can find it by text.
        // Note: The sidebar might be rendering "Chapter 2" inside a button.
        const chapter2Btn = screen.getByText('Chapter 2').closest('button');
        expect(chapter2Btn).toBeInTheDocument();
        const rsvpContainer = screen.getByTestId('rsvp-container');
        fireEvent.click(rsvpContainer);
        await waitFor(() => expect(rsvpContainer).toHaveAttribute('aria-pressed', 'true'));

        vi.useFakeTimers();
        try {
            fireEvent.click(chapter2Btn!);

            expect(screen.getByRole('status')).toHaveTextContent('Next chapter / Chapter 2');
            expect(screen.getByRole('status')).not.toHaveTextContent('3');
            expect(rsvpContainer).toHaveTextContent('Hello');
            expect(screen.getByTestId('sidebar-container')).toHaveClass('translate-x-0');
            fireEvent.click(rsvpContainer);
            expect(rsvpContainer).toHaveAttribute('aria-pressed', 'true');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(760);
            });

            expect(rsvpContainer).toHaveTextContent('Second');
            expect(rsvpContainer).toHaveAttribute('aria-pressed', 'false');
            expect(screen.getByTestId('reader-context-top')).toBeEmptyDOMElement();
            expect(screen.getByTestId('sidebar-container')).toHaveClass('translate-x-full');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(1200);
            });
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should advance destination words after navigating while playing', async () => {
        render(<Reader book={mockBook} />);
        const rsvpContainer = await screen.findByTestId('rsvp-container');
        fireEvent.click(rsvpContainer);
        await waitFor(() => expect(rsvpContainer).toHaveAttribute('aria-pressed', 'true'));

        const chaptersBtn = screen.getByTestId('toggle-chapters');
        if (chaptersBtn.getAttribute('aria-expanded') === 'false') {
            fireEvent.click(chaptersBtn);
        }
        const chapter2Btn = screen.getByText('Chapter 2').closest('button');
        expect(chapter2Btn).toBeInTheDocument();

        vi.useFakeTimers();
        try {
            fireEvent.click(chapter2Btn!);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(760);
            });
            expect(rsvpContainer).toHaveTextContent('Second');
            expect(rsvpContainer).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('sidebar-container')).toHaveClass('translate-x-0');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(400);
            });

            expect(screen.getByTestId('sidebar-container')).toHaveClass('translate-x-full');

            const focusLane = rsvpContainer.querySelector('.reader-focus-lane');
            expect(focusLane).toBeInTheDocument();
            let destinationAdvanced = false;
            for (let attempt = 0; attempt < 10 && !destinationAdvanced; attempt += 1) {
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(200);
                });
                destinationAdvanced = focusLane?.textContent?.trim() !== 'Second';
            }

            expect(destinationAdvanced).toBe(true);
            expect(rsvpContainer).not.toHaveTextContent('Second');
        } finally {
            vi.useRealTimers();
        }
    });

    it('should seek within the current chapter without reloading it', async () => {
        render(<Reader book={mockBook} />);
        const rsvpContainer = await screen.findByTestId('rsvp-container');
        await waitFor(() => expect(rsvpContainer).toHaveTextContent('Hello'));
        const chapterLookupsBeforeSeek = mockDb.chapters.findOne.mock.calls.length;

        vi.useFakeTimers();
        try {
            fireEvent.click(screen.getByTestId('subchapter-btn-1'));

            expect(screen.getByRole('status')).toHaveTextContent('Chapter 1 / Part 2');
            await act(async () => {
                await vi.advanceTimersByTimeAsync(760);
            });

            expect(rsvpContainer).toHaveTextContent('is');
            expect(mockDb.chapters.findOne).toHaveBeenCalledTimes(chapterLookupsBeforeSeek);
        } finally {
            vi.useRealTimers();
        }
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
            expect(screen.getByTestId('speed-controls')).toHaveClass('md:mr-0');
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
        expect(screen.getByText('20% through book')).toBeInTheDocument();
    });

    it('should cross forward into the next chapter without a mechanical count-in', async () => {
        render(<Reader book={mockBook} />);
        const rsvpContainer = await screen.findByTestId('rsvp-container');
        await waitFor(() => expect(rsvpContainer).toHaveTextContent('Hello'));

        vi.useFakeTimers();
        try {
            fireEvent.wheel(rsvpContainer.firstElementChild as HTMLElement, { deltaY: 300 });

            expect(screen.getByRole('status')).toHaveTextContent('Next chapter / Chapter 2');
            expect(screen.getByRole('status')).not.toHaveTextContent('3');
            await act(async () => {
                await vi.advanceTimersByTimeAsync(760);
            });

            expect(rsvpContainer).toHaveTextContent('Second');
            expect(screen.getByTestId('reader-context-top')).toBeEmptyDOMElement();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should cross backward into the previous chapter without a mechanical count-in', async () => {
        const savedState = {
            ...mockReadingState,
            currentChapterId: 'chapter-2',
            currentWordIndex: 0,
            toJSON: function () { return this; },
        };
        mockDb.reading_states.findOne.mockReturnValue({
            exec: vi.fn().mockResolvedValue(savedState),
        });

        render(<Reader book={mockBook} />);
        const rsvpContainer = await screen.findByTestId('rsvp-container');
        await waitFor(() => expect(rsvpContainer).toHaveTextContent('Second'));

        vi.useFakeTimers();
        try {
            fireEvent.wheel(rsvpContainer.firstElementChild as HTMLElement, { deltaY: -1000 });

            expect(screen.getByRole('status')).toHaveTextContent('Previous chapter / Chapter 1');
            expect(screen.getByRole('status')).not.toHaveTextContent('3');
            await act(async () => {
                await vi.advanceTimersByTimeAsync(760);
            });

            expect(rsvpContainer).toHaveTextContent('Hello');
            expect(screen.getByTestId('reader-context-top')).toBeEmptyDOMElement();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should re-enable adaptive pacing without opening setup when the model is ready', async () => {
        const settings = useSettingsStore.getState();
        const originalSetAiEnabled = settings.setAiEnabled;
        const setAiEnabled = vi.fn((enabled: boolean) => {
            settings.aiEnabled = enabled;
        });
        settings.aiEnabled = false;
        settings.setAiEnabled = setAiEnabled;
        useAIStore.setState({ isReady: true, isLoading: false, isSetupOpen: false });
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Enable adaptive pacing' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Enable adaptive pacing' }));

        expect(setAiEnabled).toHaveBeenCalledWith(true);
        expect(useAIStore.getState().isSetupOpen).toBe(false);
        settings.aiEnabled = true;
        settings.setAiEnabled = originalSetAiEnabled;
    });

    it('should open setup from unavailable adaptive pacing control', async () => {
        useSettingsStore.getState().aiEnabled = false;
        useAIStore.setState({ isReady: false, isLoading: false, isSetupOpen: false });
        render(<Reader book={mockBook} />);

        const unavailableButton = await screen.findByRole('button', { name: 'Set up adaptive pacing' });
        expect(unavailableButton).not.toBeDisabled();
        fireEvent.click(unavailableButton);

        expect(useAIStore.getState().isSetupOpen).toBe(true);
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

    it('should expose keyboard playback controls on the reading lane', async () => {
        render(<Reader book={mockBook} />);
        const readingLane = await screen.findByRole('button', { name: 'Play reading' });

        fireEvent.keyDown(readingLane, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(readingLane).toHaveAccessibleName('Pause reading');
            expect(readingLane).toHaveAttribute('aria-pressed', 'true');
        });

        fireEvent.keyDown(readingLane, { key: ' ', code: 'Space' });

        await waitFor(() => {
            expect(readingLane).toHaveAccessibleName('Play reading');
            expect(readingLane).toHaveAttribute('aria-pressed', 'false');
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
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
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
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
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
        expect(screen.getByText('Loading book...')).toBeInTheDocument();
        
        // Wait a tick for the async loadChapter to set up the subscription
        await waitFor(() => {
            expect(subscribeCallback).not.toBeNull();
        });
        
        // Now simulate the async emission of chapter data
        // This is what happens in the real app after RxDB emits the document
        subscribeCallback!(mockChapter1);
        
        // Wait for loading to complete
        await waitFor(() => {
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
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
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
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

    it('keeps only the reader and focus exit control accessible in focus mode', async () => {
        render(<Reader book={mockBook} />);

        await waitFor(() => {
            expect(screen.queryByText('Loading book...')).not.toBeInTheDocument();
        });

        const readerShell = screen.getByTestId('reader-shell');
        const focusButton = screen.getByRole('button', { name: 'Focus Mode' });
        const speedControls = screen.getByTestId('speed-controls');

        fireEvent.click(focusButton);

        expect(readerShell).toHaveClass('reader-shell--focus');
        expect(screen.getByRole('button', { name: 'Exit Focus Mode' })).toBeVisible();
        expect(screen.getByTestId('rsvp-container')).not.toHaveAttribute('aria-hidden');
        expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
        expect(screen.getByTitle('Disable adaptive pacing')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByTitle('Disable adaptive pacing')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByTestId('toggle-chapters')).toHaveAttribute('aria-hidden', 'true');
        expect(speedControls).toHaveAttribute('aria-hidden', 'true');
        expect(speedControls).toHaveAttribute('inert');

        act(() => {
            useSettingsStore.getState().setRiverTopEnabled(false);
            useSettingsStore.getState().setRiverBottomEnabled(false);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));

        expect(readerShell).not.toHaveClass('reader-shell--focus');
        expect(screen.getByRole('button', { name: 'Focus Mode' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTitle('Disable adaptive pacing')).toHaveAttribute('aria-hidden', 'false');
        expect(screen.getByTitle('Disable adaptive pacing')).toHaveProperty('tabIndex', 0);
        expect(speedControls).toHaveAttribute('aria-hidden', 'false');
        expect(speedControls).not.toHaveAttribute('inert');
        expect(useSettingsStore.getState().riverTopEnabled).toBe(true);
        expect(useSettingsStore.getState().riverBottomEnabled).toBe(true);
    });
});
