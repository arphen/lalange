import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { getChapterStructureLabel, getSubchapterDisplayName, getSummaryProgress } from './Sidebar.utils';
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

    describe('getChapterStructureLabel', () => {
        it('distinguishes publisher structure from recovered structure', () => {
            expect(getChapterStructureLabel('toc')).toBe('Publisher contents');
            expect(getChapterStructureLabel('heading')).toBe('Document heading');
            expect(getChapterStructureLabel('spine')).toBe('Recovered');
            expect(getChapterStructureLabel('merged')).toBe('Combined by XYZ');
            expect(getChapterStructureLabel(undefined)).toBeNull();
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
        it('loads a chapter when its row is clicked', () => {
            const chapter = createMockChapter();
            const onLoadChapter = vi.fn();
            render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

            fireEvent.click(screen.getByTestId('sidebar-chapter-button'));

            expect(onLoadChapter).toHaveBeenCalledWith('chapter-1');
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

            expect(screen.getByTestId('chapter-progress-chapter-1')).toHaveAttribute('aria-valuenow', '0');
            expect(screen.getByTestId('chapter-progress-chapter-2')).toHaveAttribute('aria-valuenow', '60');
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

        it('labels app-created sections separately from document headings', () => {
            const chapter = createMockChapter({
                metadata: { classificationType: 'content', structureSource: 'heading' },
            });
            render(<Sidebar {...defaultProps} chapters={[chapter]} />);

            expect(screen.getByTestId('chapter-structure-chapter-1')).toHaveTextContent('Document heading');
            expect(screen.getByLabelText('About XYZ-created sections')).toBeInTheDocument();
            expect(screen.getByRole('tooltip')).toHaveTextContent(
                'XYZ-created sections are generated from headings or recovered structure so long chapters are easier to navigate.',
            );
            expect(screen.getByTestId('subchapter-btn-0')).toHaveTextContent('Hello world this is a...');
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

            expect(screen.getByRole('button', { name: /Recaps/i })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /Recaps/i }));
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

            fireEvent.click(screen.getByRole('button', { name: /Recaps/i }));
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

            fireEvent.click(screen.getByRole('button', { name: /Recaps/i }));
            const summaryButton = screen.getByText('Summary 1').closest('button');
            fireEvent.click(summaryButton!);

            expect(onPlayGlobalSummary).toHaveBeenCalledWith(globalSummaries[0]);
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

            expect(activeButton).toHaveClass('bg-cyan-950/40');
            expect(activeButton).toHaveClass('border-cyan-400/40');
            
            // Inactive summary should not have purple highlight
            expect(inactiveButton).not.toHaveClass('bg-purple-900/40');
        });
    });
});
