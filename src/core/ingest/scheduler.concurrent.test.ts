/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionScheduler, type IngestionTask } from './scheduler';
import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { initDB } from '../sync/db';
import { analyzeDensityRange } from './analysis';
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
    analyzeDensityRange: vi.fn(),
    analysisQueue: {
        add: vi.fn(async (fn) => fn()),
        pending: 0,
        size: 0
    }
}));

vi.mock('../ai/service', () => ({
    generateUnifiedCompletion: vi.fn()
}));

describe('IngestionScheduler - Concurrent Operations', () => {
    let scheduler: IngestionScheduler;
    let mockDB: any;
    let mockChapter: any;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new IngestionScheduler();

        // Setup default store mocks
        (useSettingsStore.getState as any).mockReturnValue({
            pacingModelTier: 'basic',
            summarizerModel: 'basic',
            summarizerBasePrompt: 'Summarize',
            summarizerFragments: [],
            enableJunkRemoval: false,
            summaryChunkSize: 2500
        });

        (useAIStore.getState as any).mockReturnValue({
            setActivity: vi.fn()
        });

        // Setup DB mock
        mockChapter = {
            incrementalModify: vi.fn().mockResolvedValue({}),
            incrementalPatch: vi.fn().mockResolvedValue({})
        };
        
        mockDB = {
            chapters: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockChapter)
                })
            },
            books: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue({ id: 'book1' })
                })
            }
        };
        (initDB as any).mockResolvedValue(mockDB);

        // Setup default successful mocks
        (analyzeDensityRange as any).mockResolvedValue({
            densities: [1, 1, 1],
            analysisData: [{}, {}, {}]
        });
        (generateUnifiedCompletion as any).mockResolvedValue({ 
            response: '{"status": "CONTENT", "title": "Test", "summary": "Test Summary"}' 
        });
    });

    describe('Concurrent task additions', () => {
        it('should handle multiple tasks added simultaneously to same chapter', () => {
            const tasks: Array<Omit<IngestionTask, 'priority' | 'status'>> = [];
            for (let i = 0; i < 10; i++) {
                tasks.push({
                    id: `task${i}`,
                    bookId: 'book1',
                    chapterId: 'chapter1',
                    subchapterIndex: i,
                    startWordIndex: i * 100,
                    endWordIndex: (i + 1) * 100,
                    type: 'DENSITY',
                    text: `text${i}`
                });
            }

            // Add all tasks simultaneously
            tasks.forEach(task => scheduler.addTask(task));

            const schedulerTasks = (scheduler as any).tasks;
            expect(schedulerTasks.length).toBe(10);
            
            // Verify all have status pending or processing (at least one may have started)
            const activeOrPendingTasks = schedulerTasks.filter((t: any) => 
                t.status === 'pending' || t.status === 'processing'
            );
            expect(activeOrPendingTasks.length).toBe(10);
        });

        it('should prevent duplicate tasks when added concurrently', () => {
            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text'
            };

            // Try to add same task multiple times
            scheduler.addTask(task);
            scheduler.addTask(task);
            scheduler.addTask(task);

            const schedulerTasks = (scheduler as any).tasks;
            expect(schedulerTasks.length).toBe(1);
        });

        it('should handle tasks added while scheduler is processing', async () => {
            let taskStartCount = 0;
            let resolveFirstTask: ((v: any) => void) | undefined;
            
            (analyzeDensityRange as any).mockImplementation(() => {
                taskStartCount++;
                if (taskStartCount === 1) {
                    // First task - make it wait
                    return new Promise(r => { resolveFirstTask = r; });
                }
                // Other tasks - complete immediately
                return Promise.resolve({ densities: [1, 1, 1], analysisData: [{}, {}, {}] });
            });

            // Add first task
            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            });

            // Wait for first task to start processing
            await new Promise(resolve => setTimeout(resolve, 10));

            // First task should have started
            expect(taskStartCount).toBeGreaterThanOrEqual(1);

            // Add more tasks while first is processing
            scheduler.addTask({
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 100,
                endWordIndex: 200,
                type: 'DENSITY',
                text: 'text2'
            });

            scheduler.addTask({
                id: 'task3',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 2,
                startWordIndex: 200,
                endWordIndex: 300,
                type: 'DENSITY',
                text: 'text3'
            });

            const countBeforeResolve = taskStartCount;

            // Complete first task
            if (resolveFirstTask) {
                resolveFirstTask({ densities: [1, 1, 1], analysisData: [{}, {}, {}] });
            }

            // Wait for other tasks to process
            await new Promise(resolve => setTimeout(resolve, 50));

            // More tasks should have been processed after resolving
            expect(taskStartCount).toBeGreaterThan(countBeforeResolve);
            expect(taskStartCount).toBeGreaterThanOrEqual(3);
        });

        it('should handle concurrent setCursor calls', async () => {
            // Add dormant tasks
            for (let i = 0; i < 10; i++) {
                scheduler.addTask({
                    id: `task${i}`,
                    bookId: 'book1',
                    chapterId: 'chapter1',
                    subchapterIndex: i,
                    startWordIndex: i * 100,
                    endWordIndex: (i + 1) * 100,
                    type: 'DENSITY',
                    text: `text${i}`
                }, 'dormant');
            }

            // Call setCursor multiple times rapidly
            scheduler.setCursor('book1', 'chapter1', 0);
            scheduler.setCursor('book1', 'chapter1', 100);
            scheduler.setCursor('book1', 'chapter1', 200);

            const tasks = (scheduler as any).tasks;
            
            // Should wake up tasks near final cursor position (200)
            const pendingTasks = tasks.filter((t: any) => t.status === 'pending');
            expect(pendingTasks.length).toBeGreaterThan(0);
        });

        it('should handle adding tasks and setting cursor simultaneously', async () => {
            // Add tasks
            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            }, 'dormant');

            scheduler.addTask({
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 100,
                endWordIndex: 200,
                type: 'DENSITY',
                text: 'text2'
            }, 'dormant');

            // Set cursor immediately
            scheduler.setCursor('book1', 'chapter1', 50);

            const tasks = (scheduler as any).tasks;
            
            // Should wake up task1 (contains word 50)
            expect(tasks.find((t: any) => t.id === 'task1').status).toBe('pending');
        });

        it('should maintain task queue integrity with rapid additions', () => {
            // Rapidly add 100 tasks
            for (let i = 0; i < 100; i++) {
                scheduler.addTask({
                    id: `task${i}`,
                    bookId: 'book1',
                    chapterId: 'chapter1',
                    subchapterIndex: i,
                    startWordIndex: i * 100,
                    endWordIndex: (i + 1) * 100,
                    type: i % 2 === 0 ? 'DENSITY' : 'SUMMARY',
                    text: `text${i}`
                });
            }

            const tasks = (scheduler as any).tasks;
            expect(tasks.length).toBe(100);
            
            // All tasks should have valid priorities and be in active states
            tasks.forEach((task: any) => {
                expect(typeof task.priority).toBe('number');
                expect(['pending', 'processing']).toContain(task.status);
            });
        });

        it('should handle concurrent task additions from different books', () => {
            const books = ['book1', 'book2', 'book3'];
            
            books.forEach((bookId) => {
                for (let i = 0; i < 5; i++) {
                    scheduler.addTask({
                        id: `${bookId}_task${i}`,
                        bookId,
                        chapterId: `${bookId}_chapter1`,
                        subchapterIndex: i,
                        startWordIndex: i * 100,
                        endWordIndex: (i + 1) * 100,
                        type: 'DENSITY',
                        text: `text${i}`
                    });
                }
            });

            const tasks = (scheduler as any).tasks;
            expect(tasks.length).toBe(15);
            
            // Tasks from each book should be present
            books.forEach(bookId => {
                const bookTasks = tasks.filter((t: any) => t.bookId === bookId);
                expect(bookTasks.length).toBe(5);
            });
        });

        it('should handle task removal during concurrent additions', async () => {
            let resolveFirstTask: ((v: any) => void) | undefined;
            (analyzeDensityRange as any).mockImplementationOnce(
                () => new Promise(r => { resolveFirstTask = r; })
            );

            // Add first task for book1
            scheduler.addTask({
                id: 'book1_task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            });

            // Wait for it to start processing
            await new Promise(resolve => setTimeout(resolve, 10));

            // Add more tasks for book1
            scheduler.addTask({
                id: 'book1_task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 100,
                endWordIndex: 200,
                type: 'DENSITY',
                text: 'text2'
            });

            // Remove all book1 tasks
            scheduler.removeTasksForBook('book1');

            const tasks = (scheduler as any).tasks;
            
            // No book1 tasks should remain
            const book1Tasks = tasks.filter((t: any) => t.bookId === 'book1');
            expect(book1Tasks.length).toBe(0);

            // Complete first task (should handle gracefully even though removed)
            if (resolveFirstTask) {
                resolveFirstTask({ densities: [1, 1, 1], analysisData: [{}, {}, {}] });
            }

            await new Promise(resolve => setTimeout(resolve, 20));
        });
    });

    describe('Race conditions', () => {
        it('should not process the same task twice', async () => {
            let resolveCount = 0;
            const resolvers: Array<(v: any) => void> = [];
            
            (analyzeDensityRange as any).mockImplementation(() => {
                return new Promise(resolve => {
                    resolvers.push(resolve);
                    resolveCount++;
                });
            });

            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            });

            // Wait for task to start
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify only one call was made
            expect(resolveCount).toBe(1);
            
            // Complete the task
            resolvers[0]({ densities: [1, 1, 1], analysisData: [{}, {}, {}] });
            
            await new Promise(resolve => setTimeout(resolve, 20));

            // Verify still only one call
            expect(resolveCount).toBe(1);
            expect(analyzeDensityRange).toHaveBeenCalledTimes(1);
        });

        it('should handle processNext called multiple times simultaneously', async () => {
            let resolveFirstTask: ((v: any) => void) | undefined;
            (analyzeDensityRange as any).mockImplementationOnce(
                () => new Promise(r => { resolveFirstTask = r; })
            );

            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            });

            // Wait for task to start
            await new Promise(resolve => setTimeout(resolve, 10));

            // Try to trigger processNext multiple times (simulating concurrent calls)
            (scheduler as any).processNext();
            (scheduler as any).processNext();
            (scheduler as any).processNext();

            // Should still only process one task at a time
            const isRunning = (scheduler as any).isRunning;
            expect(isRunning).toBe(true);

            // Complete first task
            if (resolveFirstTask) {
                resolveFirstTask({ densities: [1, 1, 1], analysisData: [{}, {}, {}] });
            }

            await new Promise(resolve => setTimeout(resolve, 20));
            
            expect(analyzeDensityRange).toHaveBeenCalledTimes(1);
        });
    });
});
