
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
            data: Buffer.from('mock-zip-data').toString('base64'),
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
        
        // We expect chunks for Density and Summary.
        
        const densityTasks = tasks.filter((t: any) => t.type === 'DENSITY');
        const summaryTasks = tasks.filter((t: any) => t.type === 'SUMMARY');

        // Check Density Tasks
        const activeDensity = densityTasks.filter((t: any) => t.status !== 'dormant');
        
        // Log for debugging
        if (activeDensity.length !== 3) {
            console.error(`Expected 3 active density tasks, got ${activeDensity.length}:`, activeDensity.map((t:any) => t.subchapterIndex));
        }

        expect(activeDensity.length, 'Should have exactly 3 initial density tasks').toBe(3);
        const activeDensityIndices = activeDensity.map((t: any) => t.subchapterIndex).sort((a: number, b: number) => a - b);
        expect(activeDensityIndices).toEqual([0, 1, 2]);

        // Check Summary Tasks
        const activeSummary = summaryTasks.filter((t: any) => t.status !== 'dormant');
        
        if (activeSummary.length !== 3) {
            console.error(`Expected 3 active summary tasks, got ${activeSummary.length}:`, activeSummary.map((t:any) => t.subchapterIndex));
        }

        expect(activeSummary.length, 'Should have exactly 3 initial summary tasks').toBe(3);
        const activeSummaryIndices = activeSummary.map((t: any) => t.subchapterIndex).sort((a: number, b: number) => a - b);
        expect(activeSummaryIndices).toEqual([0, 1, 2]);
    });

    it('should wakeup the next chunk when cursor enters the first chunk', async () => {
        // Setup initial state manually to simulate ideal pipeline output
        const tasks = [
            // Active 0, 1, 2
            { id: 't0d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 0, startWordIndex: 0, endWordIndex: 2500, type: 'DENSITY', status: 'completed' },
            { id: 't1d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 1, startWordIndex: 2500, endWordIndex: 5000, type: 'DENSITY', status: 'completed' },
            { id: 't2d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 2, startWordIndex: 5000, endWordIndex: 7500, type: 'DENSITY', status: 'pending' },
            
            // Dormant 3
            { id: 't3d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 3, startWordIndex: 7500, endWordIndex: 10000, type: 'DENSITY', status: 'dormant' },
            // Dormant 4
            { id: 't4d', bookId: 'book1', chapterId: 'ch1', subchapterIndex: 4, startWordIndex: 10000, endWordIndex: 12500, type: 'DENSITY', status: 'dormant' },
        ];

        (scheduler as any).tasks = [...tasks];
        (scheduler as any).currentBookId = 'book1';
        (scheduler as any).currentChapterId = 'ch1';
        (scheduler as any).currentWordIndex = 0;

        // Verify initial
        expect((scheduler as any).tasks.find((t:any) => t.id === 't3d').status).toBe('dormant');

        // Move cursor to start of Chunk 0
        // We want this to trigger lookahead.
        // If the lookahead window is 3 chunks wide? 
        // 0 -> needs 0, 1, 2. (Already active)
        // User said: "as the user begins to read the first chunk, the processing of the next chunk should commence."
        // "First chunk" = 0. "Next chunk" relative to what?
        // If they mean "processing of the NEXT chunk (after the initial 3)"?
        // "exactly 3 chunks are first processed ... as the user begins [chunk 0]... process NEXT chunk".
        // This implies 0, 1, 2 are initially processed.
        // When reading 0, we should ensure 3 is processing.
        // This means the Lookahead needs to cover index 3 when cursor is at 0.
        // Chunk size = 2500.
        // Cursor at 100 (in chunk 0).
        // Target: Chunk 3.
        
        scheduler.setCursor('book1', 'ch1', 100);
        
        const task3 = (scheduler as any).tasks.find((t: any) => t.id === 't3d');
        expect(task3.status).toBe('pending');
        
        // Ensure we don't wake up too many
        const task4 = (scheduler as any).tasks.find((t: any) => t.id === 't4d');
        expect(task4.status).toBe('dormant');
    });
});
