import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { getSubchapterDisplayName, getSummaryProgress } from './Sidebar.utils';
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
        wpm: 300,
        now: Date.now(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Navigation', () => {
        it('provides a panel-owned close action', () => {
            const onClose = vi.fn();
            render(<Sidebar {...defaultProps} onClose={onClose} />);

            fireEvent.click(screen.getByRole('button', { name: 'Close contents' }));

            expect(onClose).toHaveBeenCalledOnce();
        });

        it('loads a chapter when its row is clicked', () => {
            const chapter = createMockChapter();
            const onLoadChapter = vi.fn();
            render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

            fireEvent.click(screen.getByTestId('sidebar-chapter-button'));

            expect(onLoadChapter).toHaveBeenCalledWith('chapter-1');
        });

        it('keeps chapter navigation separate from section disclosure', () => {
            const chapter = createMockChapter();
            const onLoadChapter = vi.fn();
            render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

            fireEvent.click(screen.getByRole('button', { name: 'Collapse sections for Chapter 1' }));

            expect(onLoadChapter).not.toHaveBeenCalled();
            expect(screen.queryByTestId('subchapter-btn-0')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Expand sections for Chapter 1' })).toBeInTheDocument();
        });

        it('makes the current chapter action explicit instead of a no-op', () => {
            const chapter = createMockChapter();
            const onLoadChapter = vi.fn();
            render(
                <Sidebar
                    {...defaultProps}
                    chapters={[chapter]}
                    currentChapter={chapter}
                    currentWordIndex={4}
                    onLoadChapter={onLoadChapter}
                />,
            );

            fireEvent.click(screen.getByTestId('sidebar-chapter-button'));

            expect(onLoadChapter).toHaveBeenCalledWith('chapter-1', 4);
        });

        it('loads a section start regardless of viewport size', () => {
            const chapter = createMockChapter();
            const onLoadChapter = vi.fn();
            render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

            fireEvent.click(screen.getByTestId('subchapter-btn-1'));

            expect(onLoadChapter).toHaveBeenCalledWith('chapter-1', 5);
        });

        it('marks the current chapter and section', () => {
            const chapter = createMockChapter();
            render(<Sidebar {...defaultProps} chapters={[chapter]} currentChapter={chapter} currentWordIndex={6} />);

            expect(screen.getByTestId('sidebar-chapter-button')).toHaveAttribute('aria-current', 'page');
            expect(screen.getByTestId('subchapter-btn-1')).toHaveAttribute('aria-current', 'location');
            expect(screen.getByTestId('chapter-progress-chapter-1')).toHaveAttribute('aria-valuenow', '60');
            expect(screen.getByRole('progressbar', { name: 'Book progress' })).toHaveAttribute('aria-valuenow', '60');
            expect(screen.getAllByText('60%')).toHaveLength(2);
            expect(screen.getByText('20%')).toBeInTheDocument();
        });

        it('does not infer progress for non-current chapters', () => {
            const firstChapter = createMockChapter();
            const secondChapter = createMockChapter({ id: 'chapter-2', index: 1, title: 'Chapter 2' });
            render(
                <Sidebar
                    {...defaultProps}
                    chapters={[firstChapter, secondChapter]}
                    currentChapter={secondChapter}
                    currentWordIndex={6}
                />,
            );

            expect(screen.queryByTestId('chapter-progress-chapter-1')).not.toBeInTheDocument();
            expect(screen.getByTestId('chapter-progress-chapter-2')).toHaveAttribute('aria-valuenow', '60');
        });

        it('keeps inactive chapter sections collapsed', () => {
            const firstChapter = createMockChapter();
            const secondChapter = createMockChapter({ id: 'chapter-2', index: 1, title: 'Chapter 2' });
            render(
                <Sidebar
                    {...defaultProps}
                    chapters={[firstChapter, secondChapter]}
                    currentChapter={firstChapter}
                />,
            );

            expect(screen.getByRole('button', { name: 'Collapse sections for Chapter 1' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Expand sections for Chapter 2' })).toBeInTheDocument();
            expect(screen.getAllByTestId('subchapter-btn-0')).toHaveLength(1);
        });

        it('searches chapter titles once the contents list is large enough', () => {
            const chapters = Array.from({ length: 12 }, (_, index) => createMockChapter({
                id: `chapter-${index + 1}`,
                index,
                title: index === 8 ? 'A Distant Shore' : `Chapter ${index + 1}`,
                subchapters: [],
            }));
            render(<Sidebar {...defaultProps} chapters={chapters} />);

            fireEvent.change(screen.getByRole('searchbox', { name: 'Search chapters and sections' }), {
                target: { value: 'distant' },
            });

            expect(screen.getByText('A Distant Shore')).toBeInTheDocument();
            expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
        });

        it('does not expose analysis status in the navigation drawer', () => {
            const chapter = createMockChapter({ densities: new Array(10).fill(0) });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            expect(screen.queryByText(/analyzing density/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/generating summary/i)).not.toBeInTheDocument();
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

        it('explains reformatted structure once and keeps analysis ranges separate', () => {
            const chapter = createMockChapter({
                metadata: { classificationType: 'content', structureSource: 'heading' },
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} structureMode="generated" />);

            expect(screen.getByTestId('structure-notice')).toHaveTextContent(
                'This edition used page-based structure. XYZ grouped it into 1 reading section.',
            );
            expect(screen.queryByTestId('chapter-structure-chapter-1')).not.toBeInTheDocument();
            expect(screen.queryByText('Recovered')).not.toBeInTheDocument();
            expect(screen.getByLabelText('About XYZ-created sections')).toBeInTheDocument();
            expect(screen.getByRole('tooltip')).toHaveTextContent(
                'Analysis ranges are generated inside each reading section for density work and recaps.',
            );
            expect(screen.getByTestId('subchapter-btn-0')).toHaveTextContent('Hello world this is a...');
        });

        it('describes long authored-section splits accurately', () => {
            const chapter = createMockChapter({
                metadata: { reformationReason: 'long-section-split' },
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} structureMode="hybrid" />);

            expect(screen.getByTestId('structure-notice')).toHaveTextContent(
                'This edition uses mixed structure. XYZ split long authored sections into 1 reading section.',
            );
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

    describe('Global Summaries Section', () => {
        it('should not render global summaries section when empty', () => {
            render(<Sidebar {...defaultProps} globalSummaries={[]} />);

            expect(screen.queryByText('Recaps')).not.toBeInTheDocument();
        });

        it('should render global summaries when provided', () => {
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary of first section',
                    generatedAt: Date.now()
                },
                {
                    id: 'global-2',
                    startWordIndex: 2500,
                    endWordIndex: 5000,
                    startChapterId: 'ch1',
                    endChapterId: 'ch2',
                    summary: 'Summary of second section',
                    generatedAt: Date.now()
                }
            ];

            render(<Sidebar {...defaultProps} globalSummaries={globalSummaries} />);

            expect(screen.getByRole('tab', { name: /Recaps/i })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('tab', { name: /Recaps/i }));
            expect(screen.getByText('Summary 1')).toBeInTheDocument();
            expect(screen.getByText('Summary 2')).toBeInTheDocument();
        });

        it('keeps recap entries collapsed by default', () => {
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now()
                }
            ];

            render(<Sidebar {...defaultProps} globalSummaries={globalSummaries} />);

            expect(screen.queryByText('Summary 1')).not.toBeInTheDocument();
        });

        it('should show word range for each global summary', () => {
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now()
                }
            ];

            render(<Sidebar {...defaultProps} globalSummaries={globalSummaries} />);

            fireEvent.click(screen.getByRole('tab', { name: /Recaps/i }));
            expect(screen.getByText('Words 0-2,500')).toBeInTheDocument();
        });

        it('should call onPlayGlobalSummary when summary is clicked', () => {
            const onPlayGlobalSummary = vi.fn();
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now()
                }
            ];

            render(
                <Sidebar 
                    {...defaultProps} 
                    globalSummaries={globalSummaries} 
                    onPlayGlobalSummary={onPlayGlobalSummary}
                />
            );

            fireEvent.click(screen.getByRole('tab', { name: /Recaps/i }));
            const summaryButton = screen.getByText('Summary 1').closest('button');
            fireEvent.click(summaryButton!);

            expect(onPlayGlobalSummary).toHaveBeenCalledWith(globalSummaries[0]);
        });

        it('provides a clear return to Contents while a recap is active', () => {
            const chapter = createMockChapter();
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now(),
                },
            ];

            render(
                <Sidebar
                    {...defaultProps}
                    chapters={[chapter]}
                    currentChapter={chapter}
                    globalSummaries={globalSummaries}
                    activeSummaryId="global-1"
                />,
            );

            expect(screen.getByText('Summary 1')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));

            expect(screen.getByTestId('sidebar-chapter-button')).toBeInTheDocument();
            expect(screen.queryByText('Summary 1')).not.toBeInTheDocument();
        });

        it('moves between tabs with standard arrow keys', () => {
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now(),
                },
            ];

            render(<Sidebar {...defaultProps} globalSummaries={globalSummaries} />);
            const contentsTab = screen.getByRole('tab', { name: 'Contents' });
            const recapsTab = screen.getByRole('tab', { name: /Recaps/i });

            contentsTab.focus();
            fireEvent.keyDown(contentsTab, { key: 'ArrowRight' });

            expect(recapsTab).toHaveFocus();
            expect(recapsTab).toHaveAttribute('aria-selected', 'true');
            expect(contentsTab).toHaveAttribute('tabindex', '-1');
        });

        it('should highlight active global summary', async () => {
            const globalSummaries = [
                {
                    id: 'global-1',
                    startWordIndex: 0,
                    endWordIndex: 2500,
                    startChapterId: 'ch1',
                    endChapterId: 'ch1',
                    summary: 'Summary text',
                    generatedAt: Date.now()
                },
                {
                    id: 'global-2',
                    startWordIndex: 2500,
                    endWordIndex: 5000,
                    startChapterId: 'ch1',
                    endChapterId: 'ch2',
                    summary: 'Second summary',
                    generatedAt: Date.now()
                }
            ];

            render(
                <Sidebar 
                    {...defaultProps} 
                    globalSummaries={globalSummaries} 
                    activeSummaryId="global-1"
                />
            );

            const activeButton = (await screen.findByText('Summary 1')).closest('button');
            const inactiveButton = screen.getByText('Summary 2').closest('button');

            expect(activeButton).toHaveClass('reader-recap-row--active');
            
            expect(inactiveButton).not.toHaveClass('reader-recap-row--active');
        });
    });
});
