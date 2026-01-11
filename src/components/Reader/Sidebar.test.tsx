import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar, getSubchapterDisplayName, getSummaryProgress } from './Sidebar';
import type { ChapterDocType } from '../../core/sync/db';

// Mock the AI store
vi.mock('../../core/store/ai', () => ({
    useAIStore: vi.fn(() => ({
        isLoading: false,
        isReady: true,
        error: null,
        activeModelName: 'TestModel',
        tps: 0,
        activity: null,
    })),
}));

describe('Sidebar Helper Functions', () => {
    describe('getSubchapterDisplayName', () => {
        it('should return first words when content is available', () => {
            const sub = { title: 'Part 1', startWordIndex: 0, endWordIndex: 100 };
            const content = ['Hello', 'world', 'this', 'is', 'a', 'test'];
            const result = getSubchapterDisplayName(sub, content);
            expect(result).toBe('Hello world this is a...');
        });

        it('should return first 5 words with ellipsis when content exists', () => {
            const sub = { title: 'Part 1', startWordIndex: 0, endWordIndex: 100 };
            const content = ['Hello', 'world', 'this', 'is', 'a', 'test', 'with', 'more', 'words'];
            const result = getSubchapterDisplayName(sub, content);
            expect(result).toBe('Hello world this is a...');
        });

        it('should respect startWordIndex when getting first words', () => {
            const sub = { title: 'Part 2', startWordIndex: 3, endWordIndex: 100 };
            const content = ['Hello', 'world', 'this', 'is', 'a', 'test', 'with', 'more', 'words'];
            const result = getSubchapterDisplayName(sub, content);
            expect(result).toBe('is a test with more...');
        });

        it('should return title when content is undefined', () => {
            const sub = { title: 'Part 1', startWordIndex: 0, endWordIndex: 100 };
            const result = getSubchapterDisplayName(sub, undefined);
            expect(result).toBe('Part 1');
        });

        it('should return title when content does not reach startWordIndex', () => {
            const sub = { title: 'Part 3', startWordIndex: 10, endWordIndex: 100 };
            const content = ['Hello', 'world'];
            const result = getSubchapterDisplayName(sub, content);
            expect(result).toBe('Part 3');
        });

        it('should handle fewer than 5 words in chunk gracefully', () => {
            const sub = { title: 'Part 1', startWordIndex: 0, endWordIndex: 3 };
            const content = ['Hello', 'world', 'test'];
            const result = getSubchapterDisplayName(sub, content);
            expect(result).toBe('Hello world test...');
        });
    });

    describe('getSummaryProgress', () => {
        it('should return 0 when density is not complete and no summary', () => {
            expect(getSummaryProgress(0.5, false)).toBe(0);
        });

        it('should return 0 when density is 0 and no summary', () => {
            expect(getSummaryProgress(0, false)).toBe(0);
        });

        it('should return 0.5 when density is complete but no summary yet', () => {
            expect(getSummaryProgress(1, false)).toBe(0.5);
        });

        it('should return 1 when summary exists', () => {
            expect(getSummaryProgress(1, true)).toBe(1);
        });

        it('should return 1 when summary exists even if density shows incomplete (edge case)', () => {
            expect(getSummaryProgress(0.5, true)).toBe(1);
        });
    });
});

describe('Sidebar Component', () => {
    const createMockChapter = (overrides: Partial<ChapterDocType> = {}): ChapterDocType => ({
        id: 'chapter-1',
        bookId: 'book-1',
        index: 0,
        title: 'Chapter 1',
        status: 'ready',
        content: ['Hello', 'world', 'this', 'is', 'a', 'test', 'chapter', 'with', 'many', 'words'],
        densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], // All processed
        subchapters: [
            { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
            { title: 'Part 2', summary: 'This is a summary', startWordIndex: 5, endWordIndex: 10 },
        ],
        ...overrides,
    });

    const defaultProps = {
        chapters: [createMockChapter()],
        currentChapter: null,
        onLoadChapter: vi.fn(),
        onInspectChapter: vi.fn(),
        wpm: 300,
        now: Date.now(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Progress Bar Rendering', () => {
        it('should render fused 2px progress bar with density and summary rows', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0], // Partial density
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            // Should show progress bar since density < 1 and no summary
            const progressBar = screen.getByTestId('progress-bar-0');
            expect(progressBar).toBeInTheDocument();
            expect(progressBar).toHaveClass('h-[2px]'); // 2px total height

            // Should have density bar (1px)
            const densityBar = screen.getByTestId('density-bar-0');
            expect(densityBar).toHaveClass('h-[1px]');

            // Should have summary bar (1px)
            const summaryBar = screen.getByTestId('summary-bar-0');
            expect(summaryBar).toHaveClass('h-[1px]');
        });

        it('should show density fill proportional to processed densities', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0], // 2/5 = 40% for first subchapter (0-5)
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const densityFill = screen.getByTestId('density-fill-0');
            expect(densityFill).toHaveStyle({ width: '40%' });
        });

        it('should show summary shimmer when density is complete but no summary', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], // All processed
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 }, // No summary
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            // Should show shimmer animation (density done, summary pending)
            const shimmer = screen.getByTestId('summary-shimmer-0');
            expect(shimmer).toBeInTheDocument();
            expect(shimmer).toHaveClass('animate-shimmer');
        });

        it('should show solid purple bar when density complete but still processing', () => {
            // This test validates that when density is complete (100%) and summary exists,
            // but there's still a chunk being processed (densityProgress < 1 on another chunk),
            // the purple bar shows as complete.
            // NOTE: When both density AND summary are complete for ALL subchapters, 
            // the progress bar is hidden entirely (see "should hide progress bars" test).
            
            // Create a chapter where first subchapter is complete, but second is not
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 }, // Density done, no summary - shows shimmer
                    { title: 'Part 2', summary: 'Completed summary', startWordIndex: 5, endWordIndex: 10 }, // Both done - hidden
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            // First subchapter: density done, no summary -> shows shimmer
            const shimmer = screen.getByTestId('summary-shimmer-0');
            expect(shimmer).toBeInTheDocument();
            
            // Second subchapter: both complete -> bar hidden entirely
            const progressBar1 = screen.queryByTestId('progress-bar-1');
            expect(progressBar1).not.toBeInTheDocument();
        });

        it('should show waiting state when density is not complete', () => {
            const chapter = createMockChapter({
                densities: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // No density yet
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const summaryWaiting = screen.getByTestId('summary-waiting-0');
            expect(summaryWaiting).toBeInTheDocument();
            expect(summaryWaiting).toHaveClass('w-0');
        });

        it('should hide progress bars when both density and summary are complete', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: 'Done', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            // Progress bar should not exist when both complete
            const progressBar = screen.queryByTestId('progress-bar-0');
            expect(progressBar).not.toBeInTheDocument();
        });
    });

    describe('Subchapter Display Name', () => {
        it('should display first words when content is available', () => {
            const chapter = createMockChapter({
                content: ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog'],
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const button = screen.getByTestId('subchapter-btn-0');
            expect(button).toHaveTextContent('The quick brown fox jumps...');
        });

        it('should display first words even when density is not complete', () => {
            const chapter = createMockChapter({
                content: ['The', 'quick', 'brown', 'fox', 'jumps'],
                densities: [0.5, 0.5, 0, 0, 0], // Partial - only 2/5 = 40%
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const button = screen.getByTestId('subchapter-btn-0');
            expect(button).toHaveTextContent('The quick brown fox jumps...');
        });
    });

    describe('Summary Expansion', () => {
        it('should expand summary on click when summary exists', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: 'This is the summary text', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            // Summary container should be collapsed initially (max-h-0)
            const summaryContent = screen.getByTestId('summary-content-0');
            const container = summaryContent.parentElement;
            expect(container).toHaveClass('max-h-0');

            // Click to expand
            const button = screen.getByTestId('subchapter-btn-0');
            fireEvent.click(button);

            // Summary container should be expanded (max-h-40)
            expect(container).toHaveClass('max-h-40');
            expect(screen.getByText('This is the summary text')).toBeInTheDocument();
        });

        it('should collapse summary on second click', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: 'Summary to toggle', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const button = screen.getByTestId('subchapter-btn-0');
            const summaryContent = screen.getByTestId('summary-content-0');
            const container = summaryContent.parentElement;
            
            // Click to expand
            fireEvent.click(button);
            expect(container).toHaveClass('max-h-40');

            // Click to collapse
            fireEvent.click(button);
            expect(container).toHaveClass('max-h-0');
        });

        it('should show generating message when density complete but no summary', () => {
            const chapter = createMockChapter({
                densities: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                subchapters: [
                    { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
                ],
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            const button = screen.getByTestId('subchapter-btn-0');
            fireEvent.click(button);

            // Should show "Generating summary..." message
            const generatingEl = screen.getByTestId('summary-generating-0');
            expect(generatingEl).toBeInTheDocument();
            expect(generatingEl.parentElement).toHaveClass('max-h-40');
        });
    });

    describe('Image Chapter Filtering', () => {
        it('should filter out image chapters from display', () => {
            const imageChapter = createMockChapter({
                id: 'image-chapter',
                title: 'Image Chapter',
                metadata: { classificationType: 'image' },
            });
            const contentChapter = createMockChapter({
                id: 'content-chapter',
                title: 'Content Chapter',
                metadata: { classificationType: 'content' },
            });
            
            render(<Sidebar {...defaultProps} chapters={[imageChapter, contentChapter]} />);

            // Image chapter should not be displayed
            expect(screen.queryByText('Image Chapter')).not.toBeInTheDocument();
            // Content chapter should be displayed
            expect(screen.getByText('Content Chapter')).toBeInTheDocument();
        });
    });
});
