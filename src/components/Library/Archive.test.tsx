import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Archive } from './Archive';
import * as dbModule from '../../core/sync/db';
import * as pipelineModule from '../../core/ingest/pipeline';

const mockRequestSetup = vi.hoisted(() => vi.fn());

vi.mock('../../core/store/ai', () => ({
    useAIStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        isLoading: false,
        progress: '',
        requestSetup: mockRequestSetup,
    }),
}));

vi.mock('../../core/store/settings', () => ({
    useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        aiEnabled: false,
    }),
}));

// Mock the DB module
vi.mock('../../core/sync/db', () => ({
    initDB: vi.fn(),
}));

// Mock the pipeline module
vi.mock('../../core/ingest/pipeline', () => ({
    initialIngest: vi.fn(),
    processChaptersInBackground: vi.fn().mockResolvedValue(undefined),
    stopProcessing: vi.fn(),
    estimateBookDensity: vi.fn(),
}));

describe('Archive', () => {
    const mockOnOpenBook = vi.fn();
    const mockOnScanHandoff = vi.fn();
    const mockInsertBook = vi.fn();
    const mockRemoveBook = vi.fn();
    const mockRemoveChapter = vi.fn();
    const mockRemoveImage = vi.fn();
    const mockRemoveRawFile = vi.fn();
    const mockRemoveReadingState = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock DB implementation
        const mockDB = {
            books: {
                find: () => ({
                    exec: async () => ([
                        {
                            toJSON: () => ({ id: 'book1', title: 'Test Book', author: 'Unknown', status: 'ready', totalWords: 100 })
                        }
                    ]),
                    $: {
                        subscribe: (cb: (docs: unknown[]) => void) => {
                            cb([
                                {
                                    id: 'book1',
                                    title: 'Test Book',
                                    author: 'Unknown',
                                    status: 'ready',
                                    totalWords: 100,
                                    toJSON: () => ({ id: 'book1', title: 'Test Book', author: 'Unknown', status: 'ready', totalWords: 100 }),
                                    remove: mockRemoveBook
                                }
                            ]);
                            return { unsubscribe: vi.fn() };
                        }
                    }
                }),
                insert: mockInsertBook,
                findOne: () => ({
                    remove: mockRemoveBook
                })
            },
            chapters: {
                find: () => ({
                    exec: async () => [{ remove: mockRemoveChapter }],
                    $: {
                        subscribe: (cb: (docs: unknown[]) => void) => {
                            cb([{
                                id: 'chapter1',
                                bookId: 'book1',
                                status: 'ready',
                                content: ['Test'],
                                toJSON: () => ({
                                    id: 'chapter1',
                                    bookId: 'book1',
                                    status: 'ready',
                                    content: ['Test'],
                                }),
                            }]);
                            return { unsubscribe: vi.fn() };
                        }
                    }
                }),
                bulkInsert: vi.fn()
            },
            images: {
                find: () => ({
                    exec: async () => [{ remove: mockRemoveImage }]
                }),
                bulkInsert: vi.fn()
            },
            raw_files: {
                findOne: (id: string) => ({
                    exec: async () => {
                        if (id === 'book1') {
                            return { data: 'same-raw-data', remove: mockRemoveRawFile };
                        }
                        return { remove: mockRemoveRawFile };
                    }
                }),
                insert: vi.fn()
            },
            reading_states: {
                findOne: () => ({
                    exec: async () => ({ remove: mockRemoveReadingState })
                }),
                insert: vi.fn()
            }
        };

        vi.mocked(dbModule.initDB).mockResolvedValue(mockDB as unknown as MyDatabase);

        // Mock confirm
        global.confirm = vi.fn(() => true);
    });

    it('renders books and allows deletion', async () => {
        render(<Archive onOpenBook={mockOnOpenBook} onScanHandoff={mockOnScanHandoff} />);

        // Check if book is rendered
        expect(await screen.findByText('Test Book')).toBeDefined();

        // Find delete button (it's hidden by opacity but exists)
        const deleteBtn = screen.getByTitle('Delete Book');

        // Click delete
        fireEvent.click(deleteBtn);

        // Verify confirm was called
        expect(global.confirm).toHaveBeenCalledWith('Are you sure you want to delete this book?');

        // Verify DB removal calls
        await waitFor(() => {
            expect(mockRemoveBook).toHaveBeenCalled();
            expect(mockRemoveChapter).toHaveBeenCalled();
            expect(mockRemoveImage).toHaveBeenCalled();
            expect(mockRemoveRawFile).toHaveBeenCalled();
            expect(mockRemoveReadingState).toHaveBeenCalled();
        });
    });

    it('offers adaptive pacing setup instead of starting density work while AI is off', async () => {
        render(<Archive onOpenBook={mockOnOpenBook} onScanHandoff={mockOnScanHandoff} />);

        fireEvent.click(await screen.findByTitle('Estimate Density'));

        expect(mockRequestSetup).toHaveBeenCalledWith('pacing');
        expect(global.confirm).not.toHaveBeenCalledWith('Start density estimation for this book? This may take a while.');
    });

    it('opens the in-app handoff scanner from the Archive actions', async () => {
        render(<Archive onOpenBook={mockOnOpenBook} onScanHandoff={mockOnScanHandoff} />);

        fireEvent.click(await screen.findByRole('button', { name: 'SCAN HANDOFF' }));

        expect(mockOnScanHandoff).toHaveBeenCalledOnce();
    });

    it('reuses existing book when the ingested payload matches an archive entry', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => new Blob(['demo-epub'], { type: 'application/epub+zip' })
        } as Response);

        vi.mocked(pipelineModule.initialIngest).mockResolvedValue({
            book: {
                id: 'new-book-id',
                title: 'Test Book',
                author: 'Unknown',
                totalWords: 0,
                chapterIds: ['new-book-id_0']
            },
            chapters: [
                {
                    id: 'new-book-id_0',
                    bookId: 'new-book-id',
                    index: 0,
                    title: 'Chapter 1',
                    status: 'pending',
                    content: []
                }
            ],
            images: [],
            rawFile: {
                id: 'new-book-id',
                data: 'same-raw-data'
            }
        });

        render(<Archive onOpenBook={mockOnOpenBook} onScanHandoff={mockOnScanHandoff} />);

        fireEvent.click(await screen.findByTestId('archive-load-demo'));

        await waitFor(() => {
            expect(mockOnOpenBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'book1' }));
        });

        expect(mockInsertBook).not.toHaveBeenCalled();
        expect(pipelineModule.processChaptersInBackground).not.toHaveBeenCalled();
    });
});
