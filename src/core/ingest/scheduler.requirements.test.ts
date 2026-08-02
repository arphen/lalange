
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduler } from './scheduler';
import { processChaptersInBackground } from './pipeline';
import { initDB } from '../sync/db';
import { useSettingsStore } from '../store/settings';

// Mocks
vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

vi.mock('jszip', () => {
    return {
        default: {
            loadAsync: vi.fn().mockImplementation(async () => ({
                files: {
                    'content.opf': {
                        async: () => `
                            <package>
                                <manifest>
                                    <item id="item1" href="chapter1.html" />
                                </manifest>
                                <spine>
                                    <itemref idref="item1" />
                                </spine>
                            </package>`
                    },
                    'chapter1.html': {
                        async: () => {
                            // Generate text for 10 chunks (roughly 25,000 words)
                            // 1 chunk = 2500 words.
                            // We make sure every 100th word ends with a period to allow splitting.
                            const words = Array(25000).fill(0).map((_, i) => (i % 100 === 99) ? 'word.' : 'word');
                            return `<html><body><p>${words.join(' ')}</p></body></html>`;
                        }
                    }
                },
                file: (path: string) => {
                    if (path.endsWith('.opf')) return { async: () => Promise.resolve(`
                            <package>
                                <manifest>
                                    <item id="item1" href="chapter1.html" />
                                </manifest>
                                <spine>
                                    <itemref idref="item1" />
                                </spine>
                            </package>`) };
                    if (path.endsWith('chapter1.html')) return {
                        async: () => {
                             const words = Array(25000).fill(0).map((_, i) => (i % 100 === 99) ? 'word.' : 'word');
                             return `<html><body><p>${words.join(' ')}</p></body></html>`;
                        }
                    };
                    return null;
                }
            }))
        }
    };
});

vi.mock('../store/settings', () => ({
    useSettingsStore: {
        getState: vi.fn()
    }
}));

describe('Ingestion Scheduling Requirements', () => {
    let mockDB: any;
    let mockChapter: any;
    let mockBook: any;
    let mockRawFile: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset scheduler state 
        (scheduler as any).tasks = [];
        (scheduler as any).isRunning = false;

        // Mock Settings
        (useSettingsStore.getState as any).mockReturnValue({
            summaryChunkSize: 2500,
            librarianModelTier: 'basic',
            summarizerModel: 'basic',
            summarizerFragments: [],
            aiEnabled: true,
        });

        // Mock DB
        mockChapter = {
            id: 'book1_0',
            status: 'pending',
            content: [], // empty initially
            patch: vi.fn().mockResolvedValue({ id: 'book1_0' }), 
            incrementalPatch: vi.fn(),
        };

        mockBook = {
            id: 'book1',
            chapterIds: ['book1_0'],
            totalWords: 0,
            incrementalPatch: vi.fn()
        };

        mockRawFile = {
            data: Buffer.from('PK-mock-zip-data').toString('base64'),
        };

        mockDB = {
            raw_files: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockRawFile)
                })
            },
            chapters: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockChapter)
                })
            },
            books: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockBook)
                })
            }
        };

        (initDB as any).mockResolvedValue(mockDB);
    });

    it('should strictly schedule only 3 chunks initially for a new book', async () => {
        // Run Pipeline
        // Note: processChaptersInBackground usually reads the raw file from DB.
        // We mocked JSZip to return controlled content regardless of raw file content.
        await processChaptersInBackground('book1');

        // Check Scheduler Tasks
        const tasks = (scheduler as any).tasks;
        
        // With the global summary architecture change, we only schedule DENSITY tasks per-chunk.
        // Global summaries are scheduled separately and independently of chunk boundaries.
        
        const densityTasks = tasks.filter((t: any) => t.type === 'DENSITY');
        const summaryTasks = tasks.filter((t: any) => t.type === 'SUMMARY');

        // Check Density Tasks - 6 initial density tasks (INITIAL_DENSITY_CHUNKS)
        const activeDensity = densityTasks.filter((t: any) => t.status !== 'dormant');
        
        // Log for debugging
        if (activeDensity.length !== 6) {
            console.error(`Expected 6 active density tasks, got ${activeDensity.length}:`, activeDensity.map((t:any) => t.subchapterIndex));
        }

        expect(activeDensity.length, 'Should have exactly 6 initial density tasks').toBe(6);
        const activeDensityIndices = activeDensity.map((t: any) => t.subchapterIndex).sort((a: number, b: number) => a - b);
        expect(activeDensityIndices).toEqual([0, 1, 2, 3, 4, 5]);

        // Per-chunk SUMMARY tasks are no longer scheduled - global summaries are used instead.
        // Verify no per-chunk SUMMARY tasks are scheduled.
        expect(summaryTasks.length, 'Should have no per-chunk summary tasks with global summary architecture').toBe(0);
    });

    it('should wakeup the next chunk when cursor enters the first chunk', async () => {
        // Setup initial state manually to simulate ideal pipeline output
        // With 6-chunk lookahead for density, we need tasks 0-5 active, 6+ dormant
        const tasks = [
            // Active 0-5
            { id: 't0d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 0, startWordIndex: 0, endWordIndex: 2500, type: 'DENSITY', status: 'completed' },
            { id: 't1d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 1, startWordIndex: 2500, endWordIndex: 5000, type: 'DENSITY', status: 'completed' },
            { id: 't2d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 2, startWordIndex: 5000, endWordIndex: 7500, type: 'DENSITY', status: 'pending' },
            { id: 't3d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 3, startWordIndex: 7500, endWordIndex: 10000, type: 'DENSITY', status: 'pending' },
            { id: 't4d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 4, startWordIndex: 10000, endWordIndex: 12500, type: 'DENSITY', status: 'pending' },
            { id: 't5d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 5, startWordIndex: 12500, endWordIndex: 15000, type: 'DENSITY', status: 'pending' },
            
            // Dormant 6+
            { id: 't6d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 6, startWordIndex: 15000, endWordIndex: 17500, type: 'DENSITY', status: 'dormant' },
            { id: 't7d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 7, startWordIndex: 17500, endWordIndex: 20000, type: 'DENSITY', status: 'dormant' },
        ];

        (scheduler as any).tasks = [...tasks];
        (scheduler as any).currentBookId = 'book1';
        (scheduler as any).currentChapterId = 'ch1';
        (scheduler as any).currentWordIndex = 0;

        // Verify initial
        expect((scheduler as any).tasks.find((t:any) => t.id === 't6d').status).toBe('dormant');

        // Move cursor to start of Chunk 0
        // With 6-chunk lookahead, cursor at chunk 0 should wake chunks 0-5 (already done),
        // so chunk 6 should be woken when moving through
        scheduler.setCursor('book1', 'ch1', 100);
        
        const task6 = (scheduler as any).tasks.find((t: any) => t.id === 't6d');
        expect(task6.status).toBe('pending');
        
        // Ensure we don't wake up too many (7 should still be dormant)
        const task7 = (scheduler as any).tasks.find((t: any) => t.id === 't7d');
        expect(task7.status).toBe('dormant');
    });
});
