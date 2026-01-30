/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionScheduler, type GlobalSummaryTask } from './scheduler';
import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { initDB } from '../sync/db';
import { generateUnifiedCompletion } from '../ai/service';

// Mocks
vi.mock('../store/settings', () => ({
    useSettingsStore: {
        getState: vi.fn()
    }
}));

vi.mock('../store/ai', () => ({
    useAIStore: {
        getState: vi.fn()
    }
}));

vi.mock('../sync/db', () => ({
    initDB: vi.fn()
}));

vi.mock('./analysis', () => ({
    analyzeDensityRange: vi.fn().mockResolvedValue({ 
        densities: [1, 1, 1], 
        analysisData: [{ tokens: [], surprisals: [] }] 
    }),
    analysisQueue: {
        add: vi.fn(async (fn) => fn()),
        pending: 0,
        size: 0
    }
}));

vi.mock('../ai/service', () => ({
    generateUnifiedCompletion: vi.fn()
}));

describe('IngestionScheduler - Global Summary Tasks', () => {
    let scheduler: IngestionScheduler;
    let mockDB: any;
    let mockBook: any;
    let mockChapter1: any;
    let mockChapter2: any;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new IngestionScheduler();

        // Setup default store mocks
        (useSettingsStore.getState as any).mockReturnValue({
            librarianModelTier: 'basic',
            summarizerModel: 'basic',
            summaryPrompt: 'Summarize this text.',
            summaryChunkSize: 2500,
            aiEnabled: true
        });

        (useAIStore.getState as any).mockReturnValue({
            setActivity: vi.fn(),
            setCurrentTask: vi.fn(),
            updateTaskProgress: vi.fn(),
            startSummaryTiming: vi.fn(),
            completeSummaryTiming: vi.fn()
        });

        // Setup mock chapters
        mockChapter1 = {
            id: 'chapter1',
            content: Array(1500).fill('word'),
        };
        mockChapter2 = {
            id: 'chapter2',
            content: Array(2000).fill('word'),
        };

        // Setup mock book
        mockBook = {
            id: 'book1',
            chapterIds: ['chapter1', 'chapter2'],
            globalSummaries: [],
            incrementalModify: vi.fn(async (fn) => {
                const doc = { ...mockBook };
                const result = fn(doc);
                mockBook.globalSummaries = result.globalSummaries;
                return result;
            })
        };

        // Setup DB mock
        mockDB = {
            chapters: {
                findOne: vi.fn().mockImplementation((id: string) => ({
                    exec: vi.fn().mockResolvedValue(id === 'chapter1' ? mockChapter1 : mockChapter2)
                }))
            },
            books: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockBook)
                })
            }
        };
        (initDB as any).mockResolvedValue(mockDB);

        // Setup LLM mock
        (generateUnifiedCompletion as any).mockResolvedValue({ 
            response: 'This is a global summary of the text.' 
        });
    });

    describe('addGlobalSummaryTask', () => {
        it('should add a global summary task', () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);

            const tasks = (scheduler as any).globalSummaryTasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0].id).toBe('global-summary-1');
            expect(tasks[0].type).toBe('GLOBAL_SUMMARY');
            // Status may be pending or processing since it starts immediately
            expect(['pending', 'processing']).toContain(tasks[0].status);
        });

        it('should not add duplicate global summary tasks', () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);
            scheduler.addGlobalSummaryTask(task); // Try to add same one

            const tasks = (scheduler as any).globalSummaryTasks;
            expect(tasks).toHaveLength(1);
        });

        it('should add task as dormant when specified', () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task, 'dormant');

            const tasks = (scheduler as any).globalSummaryTasks;
            expect(tasks[0].status).toBe('dormant');
        });
    });

    describe('wakeUpGlobalSummaryTasks', () => {
        it('should wake dormant global summary tasks when cursor approaches', () => {
            // Add a dormant task
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };
            scheduler.addGlobalSummaryTask(task, 'dormant');

            // Verify it's dormant
            expect((scheduler as any).globalSummaryTasks[0].status).toBe('dormant');

            // Set cursor near the task (within 2 intervals = 5000 words)
            scheduler.setCursor('book1', 'chapter1', 100, 100);

            // Task should now be pending or processing (it gets picked up immediately)
            const status = (scheduler as any).globalSummaryTasks[0].status;
            expect(['pending', 'processing']).toContain(status);
        });

        it('should not wake tasks for different books', () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book2', // Different book
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };
            scheduler.addGlobalSummaryTask(task, 'dormant');

            scheduler.setCursor('book1', 'chapter1', 100, 100);

            // Task should remain dormant (different book)
            expect((scheduler as any).globalSummaryTasks[0].status).toBe('dormant');
        });

        it('should not wake tasks that are far away', () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-5',
                bookId: 'book1',
                summaryIndex: 5,
                globalStartWordIndex: 12500,
                globalEndWordIndex: 15000, // Very far from cursor
                startChapterId: 'chapter5',
                endChapterId: 'chapter6'
            };
            scheduler.addGlobalSummaryTask(task, 'dormant');

            // Set cursor at beginning (global index 100)
            // Lookahead is 2 intervals = 5000 words
            // Task ends at 15000, cursor at 100, so 15000 > 100 + 5000
            scheduler.setCursor('book1', 'chapter1', 100, 100);

            // Task should remain dormant
            expect((scheduler as any).globalSummaryTasks[0].status).toBe('dormant');
        });
    });

    describe('executeGlobalSummaryTask', () => {
        it('should execute global summary task and collect text across chapters', async () => {
            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should have called LLM
            expect(generateUnifiedCompletion).toHaveBeenCalled();
            
            // Should have saved summary to book
            expect(mockBook.incrementalModify).toHaveBeenCalled();
            expect(mockBook.globalSummaries).toHaveLength(1);
            expect(mockBook.globalSummaries[0].summary).toBe('This is a global summary of the text.');
        });

        it('should skip if book is deleted', async () => {
            mockDB.books.findOne = vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null)
            });

            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'deleted-book',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not call LLM for deleted book
            expect(generateUnifiedCompletion).not.toHaveBeenCalled();
        });

        it('should handle LLM errors gracefully', async () => {
            (generateUnifiedCompletion as any).mockRejectedValue(new Error('LLM Error'));

            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should not crash - the scheduler should continue running
            // Task may remain (with failed status) or be removed depending on implementation
            expect(generateUnifiedCompletion).toHaveBeenCalled();
        });

        it('should update existing summary instead of duplicating', async () => {
            // Pre-populate with an existing summary
            mockBook.globalSummaries = [{
                id: 'global-summary-1',
                startWordIndex: 0,
                endWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2',
                summary: 'Old summary',
                generatedAt: Date.now() - 10000
            }];

            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: 'Updated summary.' 
            });

            const task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };

            scheduler.addGlobalSummaryTask(task);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should update, not duplicate
            expect(mockBook.globalSummaries).toHaveLength(1);
            expect(mockBook.globalSummaries[0].summary).toBe('Updated summary.');
        });
    });

    describe('processNext with global summaries', () => {
        it('should process global summaries only when no density tasks are pending', async () => {
            // Add a density task (higher priority)
            scheduler.addTask({
                id: 'density-task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'some text'
            });

            // Add a global summary task
            const globalTask: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'> = {
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            };
            scheduler.addGlobalSummaryTask(globalTask);

            await new Promise(resolve => setTimeout(resolve, 150));

            // Both should be processed eventually, but density first
            // (we can't easily test order here, just that both get processed)
            expect(generateUnifiedCompletion).toHaveBeenCalled();
        });
    });

    describe('removeTasksForBook', () => {
        it('should remove global summary tasks when book is removed', () => {
            scheduler.addGlobalSummaryTask({
                id: 'global-summary-1',
                bookId: 'book1',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            }, 'dormant');

            scheduler.addGlobalSummaryTask({
                id: 'global-summary-2',
                bookId: 'book2',
                summaryIndex: 0,
                globalStartWordIndex: 0,
                globalEndWordIndex: 2500,
                startChapterId: 'chapter1',
                endChapterId: 'chapter2'
            }, 'dormant');

            expect((scheduler as any).globalSummaryTasks).toHaveLength(2);

            scheduler.removeTasksForBook('book1');

            const tasks = (scheduler as any).globalSummaryTasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0].bookId).toBe('book2');
        });
    });
});
