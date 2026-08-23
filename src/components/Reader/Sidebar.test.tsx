import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ChapterDocType } from '../../core/sync/db';

describe('Sidebar V2', () => {
    const createMockChapter = (overrides: Partial<ChapterDocType> = {}): ChapterDocType => ({
        id: 'chapter-1',
        bookId: 'book-1',
        index: 0,
        title: 'Chapter 1',
        status: 'ready',
        content: ['Hello', 'world', 'this', 'is', 'a', 'test', 'chapter', 'with', 'many', 'words'],
        densities: new Array(10).fill(0.5),
        subchapters: [
            { title: 'Part 1', summary: '', startWordIndex: 0, endWordIndex: 5 },
            { title: 'Part 2', summary: '', startWordIndex: 5, endWordIndex: 10 },
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

    it('renders a flat outline without implementation or progress noise', () => {
        render(<Sidebar {...defaultProps} structureMode="generated" />);

        expect(screen.getByRole('heading', { name: 'Contents' })).toBeInTheDocument();
        expect(screen.getByTestId('sidebar-chapter-button')).toHaveTextContent('Chapter 1');
        expect(screen.queryByTestId('subchapter-btn-0')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Expand|Collapse sections/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByText(/page-based structure|reading sections|Jump within this chapter/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Reading index|Book progress/i)).not.toBeInTheDocument();
    });

    it('navigates immediately from an inactive chapter row', () => {
        const onLoadChapter = vi.fn();
        const chapter = createMockChapter({ id: 'chapter-2', index: 1, title: 'Chapter 2' });
        render(<Sidebar {...defaultProps} chapters={[createMockChapter(), chapter]} onLoadChapter={onLoadChapter} />);

        fireEvent.click(screen.getAllByTestId('sidebar-chapter-button')[1]);

        expect(onLoadChapter).toHaveBeenCalledWith('chapter-2');
    });

    it('makes the current row resume the reader without seeking', () => {
        const onLoadChapter = vi.fn();
        const onFocusCurrent = vi.fn();
        const chapter = createMockChapter();
        render(
            <Sidebar
                {...defaultProps}
                chapters={[chapter]}
                currentChapter={chapter}
                currentWordIndex={6}
                onLoadChapter={onLoadChapter}
                onFocusCurrent={onFocusCurrent}
            />,
        );

        fireEvent.click(screen.getByTestId('sidebar-chapter-button'));

        expect(onFocusCurrent).toHaveBeenCalledOnce();
        expect(onLoadChapter).not.toHaveBeenCalled();
        expect(screen.getByTestId('sidebar-chapter-button')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByText('Current')).toBeInTheDocument();
    });

    it('opens chapter actions without navigating and stages passages in a separate view', () => {
        const onLoadChapter = vi.fn();
        const chapter = createMockChapter();
        render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

        fireEvent.click(screen.getByRole('button', { name: 'More options for Chapter 1' }));
        expect(onLoadChapter).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Browse passages' }));

        expect(screen.getByRole('heading', { name: 'Passages' })).toBeInTheDocument();
        expect(screen.getByText('Chapter 1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start of chapter/ })).toBeInTheDocument();
        expect(screen.getByText('test chapter with many words...')).toBeInTheDocument();
        expect(screen.queryByTestId('sidebar-chapter-button')).not.toBeInTheDocument();
    });

    it('loads an explicit passage start and returns to the outline', () => {
        const onLoadChapter = vi.fn();
        const chapter = createMockChapter();
        render(<Sidebar {...defaultProps} chapters={[chapter]} onLoadChapter={onLoadChapter} />);

        fireEvent.click(screen.getByRole('button', { name: 'More options for Chapter 1' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Browse passages' }));
        fireEvent.click(screen.getByRole('button', { name: /test chapter with many words/ }));

        expect(onLoadChapter).toHaveBeenCalledWith('chapter-1', 5);
        fireEvent.click(screen.getByRole('button', { name: 'Back to Contents' }));
        expect(screen.getByRole('heading', { name: 'Contents' })).toBeInTheDocument();
        expect(screen.getByTestId('sidebar-chapter-button')).toBeInTheDocument();
    });

    it('offers search as a transient cross-level view for large outlines', () => {
        const chapters = Array.from({ length: 6 }, (_, index) => createMockChapter({
            id: `chapter-${index + 1}`,
            index,
            title: `Chapter ${index + 1}`,
        }));
        render(<Sidebar {...defaultProps} chapters={chapters} />);

        fireEvent.click(screen.getByRole('button', { name: 'Search contents' }));
        const searchbox = screen.getByRole('searchbox', { name: 'Search chapters and passages' });
        fireEvent.change(searchbox, { target: { value: 'test chapter' } });

        expect(screen.getByText('Passage in Chapter 1')).toBeInTheDocument();
        expect(screen.queryByTestId('sidebar-chapter-button')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getAllByTestId('sidebar-chapter-button')).toHaveLength(6);
    });

    it('keeps provenance explanation behind the contents menu', () => {
        render(<Sidebar {...defaultProps} structureMode="generated" />);

        expect(screen.queryByText(/This file did not include a reliable contents list/i)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'More contents options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'About this contents list' }));

        expect(screen.getByRole('heading', { name: 'About this contents list' })).toBeInTheDocument();
        expect(screen.getByText(/This file did not include a reliable contents list/i)).toBeInTheDocument();
        expect(screen.getByText(/Passages are optional shortcuts/i)).toBeInTheDocument();
    });

    it('presents recaps with human context instead of word ranges', () => {
        const summary = {
            id: 'global-1',
            startWordIndex: 0,
            endWordIndex: 2500,
            startChapterId: 'chapter-1',
            endChapterId: 'chapter-1',
            summary: 'Summary text',
            generatedAt: Date.now(),
        };
        render(<Sidebar {...defaultProps} globalSummaries={[summary]} />);

        fireEvent.click(screen.getByRole('tab', { name: 'Recaps' }));

        expect(screen.getByText('Chapter 1')).toBeInTheDocument();
        expect(screen.queryByText(/Words 0-2,500/)).not.toBeInTheDocument();
        expect(screen.queryByText('Summary 1')).not.toBeInTheDocument();
    });

    it('allows the outline to remain selected while a recap is active', () => {
        const summary = {
            id: 'global-1',
            startWordIndex: 0,
            endWordIndex: 2500,
            startChapterId: 'chapter-1',
            endChapterId: 'chapter-1',
            summary: 'Summary text',
            generatedAt: Date.now(),
        };
        render(<Sidebar {...defaultProps} globalSummaries={[summary]} activeSummaryId="global-1" />);

        expect(screen.queryByTestId('sidebar-chapter-button')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));

        expect(screen.getByTestId('sidebar-chapter-button')).toBeInTheDocument();
    });

    it('returns About to the specific Passages chapter that opened it', () => {
        render(<Sidebar {...defaultProps} structureMode="generated" />);

        fireEvent.click(screen.getByRole('button', { name: 'More options for Chapter 1' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Browse passages' }));
        fireEvent.click(screen.getByRole('button', { name: 'More contents options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'About this contents list' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Back to contents' })[1]);

        expect(screen.getByRole('heading', { name: 'Passages' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Start of chapter/ })).toBeInTheDocument();
    });

    it('filters image chapters and keeps the close action owned by the panel', () => {
        const onClose = vi.fn();
        const imageChapter = createMockChapter({
            id: 'image-chapter',
            title: 'Illustration',
            metadata: { classificationType: 'image' },
        });
        render(<Sidebar {...defaultProps} chapters={[imageChapter, createMockChapter()]} onClose={onClose} />);

        expect(screen.queryByText('Illustration')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close contents' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});