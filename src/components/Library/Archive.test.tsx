import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MyDatabase } from '../../core/sync/db';
import { Archive } from './Archive';
import * as dbModule from '../../core/sync/db';

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
                    $: {
                        subscribe: (cb: (docs: unknown[]) => void) => {
                            cb([
                                {
                                    id: 'book1',
                                    title: 'Test Book',
                                    toJSON: () => ({ id: 'book1', title: 'Test Book' }),
                                    remove: mockRemoveBook
                                }
                            ]);
                            return { unsubscribe: vi.fn() };
                        }
                    }
                }),
                findOne: () => ({
                    remove: mockRemoveBook
                })
            },
            chapters: {
                find: () => ({
                    exec: async () => [{ remove: mockRemoveChapter }],
                    $: {
                        subscribe: (cb: (docs: unknown[]) => void) => {
                            cb([]); // Return empty chapters for now
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
                findOne: () => ({
                    exec: async () => ({ remove: mockRemoveRawFile })
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
        render(<Archive onOpenBook={mockOnOpenBook} />);

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
});
