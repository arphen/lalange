import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Archive } from './Archive';
import { getBookOpenIssue, persistInitialIngest } from './archivePersistence';
import * as dbModule from '../../core/sync/db';
import * as pipelineModule from '../../core/ingest/pipeline';

const mockRequestSetup = vi.hoisted(() => vi.fn());
const mockScanBookForAnomalies = vi.hoisted(() => vi.fn());
const mockScanLibraryForAnomalies = vi.hoisted(() => vi.fn());

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

vi.mock('../../core/ingest/repair', () => ({
    scanBookForAnomalies: mockScanBookForAnomalies,
    scanLibraryForAnomalies: mockScanLibraryForAnomalies,
}));

vi.mock('../Repair/RepairReviewPanel', () => ({
    RepairReviewPanel: ({ bookId }: { bookId: string }) => <div data-testid="repair-review-panel">Repair queue for {bookId}</div>,
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
            },
            text_issues: {
                find: () => ({
                    exec: async () => [{
                        id: 'issue1',
                        bookId: 'book1',
                        sourceUnitId: 'chapter1',
                        state: 'open',
                        remove: vi.fn(),
                    }],
                    $: {
                        subscribe: (cb: (docs: unknown[]) => void) => {
                            cb([]);
                            return { unsubscribe: vi.fn() };
                        },
                    },
                }),
            }
        };

        vi.mocked(dbModule.initDB).mockResolvedValue(mockDB as unknown as MyDatabase);
        mockScanBookForAnomalies.mockResolvedValue({ candidatesFound: 0 });
        mockScanLibraryForAnomalies.mockResolvedValue({ candidatesFound: 1 });

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

    it('opens the repair queue for the first affected book after a library scan', async () => {
        render(<Archive onOpenBook={mockOnOpenBook} onScanHandoff={mockOnScanHandoff} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Scan library for text anomalies' }));

        await waitFor(() => expect(mockScanLibraryForAnomalies).toHaveBeenCalledOnce());
        expect(await screen.findByTestId('repair-review-panel')).toHaveTextContent('Repair queue for book1');
    });

    it('does not create a visible book when its raw source cannot be saved', async () => {
        const insertBook = vi.fn();
        const missingDocument = { exec: vi.fn().mockResolvedValue(null) };
        const db = {
            raw_files: {
                insert: vi.fn().mockRejectedValue(new DOMException('Storage quota exceeded', 'QuotaExceededError')),
                findOne: vi.fn(() => missingDocument),
            },
            books: {
                insert: insertBook,
                findOne: vi.fn(() => missingDocument),
            },
            chapters: {
                bulkInsert: vi.fn(),
                findOne: vi.fn(() => missingDocument),
            },
            images: {
                bulkInsert: vi.fn(),
                findOne: vi.fn(() => missingDocument),
            },
            reading_states: {
                insert: vi.fn(),
                findOne: vi.fn(() => missingDocument),
            },
        };

        await expect(persistInitialIngest(db as unknown as MyDatabase, {
            book: {
                id: 'large-pdf',
                title: 'Lacan',
                totalWords: 0,
                chapterIds: ['large-pdf_0'],
            },
            chapters: [{
                id: 'large-pdf_0',
                bookId: 'large-pdf',
                index: 0,
                title: 'Document',
                status: 'pending',
                content: [],
            }],
            images: [],
            rawFile: { id: 'large-pdf', data: 'encoded-pdf' },
        })).rejects.toThrow('No partial copy was kept');

        expect(db.raw_files.insert).toHaveBeenCalledOnce();
        expect(insertBook).not.toHaveBeenCalled();
    });

    it('identifies an incomplete book whose raw source is missing', async () => {
        const db = {
            raw_files: {
                findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
            },
            chapters: {
                find: vi.fn(() => ({
                    exec: vi.fn().mockResolvedValue([{ status: 'pending' }]),
                })),
            },
        };

        await expect(getBookOpenIssue(db as unknown as MyDatabase, 'incomplete-pdf'))
            .resolves.toContain('select the PDF again');
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
