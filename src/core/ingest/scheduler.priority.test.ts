/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionScheduler } from './scheduler';
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

describe('IngestionScheduler - Priority Rebalancing Edge Cases', () => {
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

    describe('Priority calculation edge cases', () => {
        it('should handle priority with no cursor set (initial state)', () => {
            // Add tasks without setting cursor
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

            scheduler.addTask({
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 5,
                startWordIndex: 500,
                endWordIndex: 600,
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

            const tasks = (scheduler as any).tasks;
            
            // Without cursor, should prioritize by subchapterIndex (lower is higher priority)
            expect(tasks[0].id).toBe('task1'); // subchapterIndex 0
            expect(tasks[1].id).toBe('task3'); // subchapterIndex 2
            expect(tasks[2].id).toBe('task2'); // subchapterIndex 5
        });

        it('should handle priority with multiple books in queue', async () => {
            // Add tasks from different books
            scheduler.addTask({
                id: 'book1_task',
                bookId: 'book1',
                chapterId: 'book1_chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            });

            scheduler.addTask({
                id: 'book2_task',
                bookId: 'book2',
                chapterId: 'book2_chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text2'
            });

            scheduler.addTask({
                id: 'book3_task',
                bookId: 'book3',
                chapterId: 'book3_chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text3'
            });

            // Set cursor to book1
            scheduler.setCursor('book1', 'book1_chapter1', 0);

            const tasks = (scheduler as any).tasks;
            
            // book1 tasks should be prioritized
            expect(tasks[0].bookId).toBe('book1');
            expect(tasks[0].priority).toBeGreaterThan(tasks[1].priority);
            expect(tasks[0].priority).toBeGreaterThan(tasks[2].priority);
        });

        it('should handle priority at chunk boundaries', () => {
            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 2500,
                type: 'DENSITY',
                text: 'text1'
            });

            scheduler.addTask({
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 2500,
                endWordIndex: 5000,
                type: 'DENSITY',
                text: 'text2'
            });

            // Set cursor exactly at boundary
            scheduler.setCursor('book1', 'chapter1', 2500);

            const tasks = (scheduler as any).tasks;
            
            // Task at boundary should get current chunk priority
            const task2 = tasks.find((t: any) => t.id === 'task2');
            expect(task2.priority).toBeGreaterThan(5000); // Should be high priority (current chunk)
        });

        it('should handle priority with negative word indices (edge case)', () => {
            // This shouldn't happen in practice, but test robustness
            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: -100,
                endWordIndex: 0,
                type: 'DENSITY',
                text: 'text1'
            });

            scheduler.setCursor('book1', 'chapter1', 0);

            const tasks = (scheduler as any).tasks;
            
            // Should handle without crashing
            expect(tasks[0].priority).toBeDefined();
            expect(typeof tasks[0].priority).toBe('number');
        });

        it('should handle priority with very large word indices', () => {
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

            scheduler.addTask({
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1000,
                startWordIndex: 10000000,
                endWordIndex: 10000100,
                type: 'DENSITY',
                text: 'text2'
            });

            scheduler.setCursor('book1', 'chapter1', 0);

            const tasks = (scheduler as any).tasks;
            
            // Current chunk should be prioritized over very distant chunk
            expect(tasks[0].id).toBe('task1');
            expect(tasks[0].priority).toBeGreaterThan(tasks[1].priority);
        });

        it('should prioritize DENSITY over SUMMARY for same position', () => {
            scheduler.addTask({
                id: 'summary_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text'
            });

            scheduler.addTask({
                id: 'density_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text'
            });

            scheduler.setCursor('book1', 'chapter1', 0);

            const tasks = (scheduler as any).tasks;
            
            // DENSITY should be first
            expect(tasks[0].id).toBe('density_task');
            expect(tasks[0].type).toBe('DENSITY');
        });

        it('should handle priority rebalancing when switching between books', () => {
            scheduler.addTask({
                id: 'book1_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            }, 'dormant');

            scheduler.addTask({
                id: 'book2_task',
                bookId: 'book2',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text2'
            }, 'dormant');

            // Set cursor to book1 - this wakes tasks and sets priorities
            scheduler.setCursor('book1', 'chapter1', 0);
            
            const tasks = (scheduler as any).tasks;
            const book1Task = tasks.find((t: any) => t.bookId === 'book1');
            const book2Task = tasks.find((t: any) => t.bookId === 'book2');
            
            // book1 should have much higher priority (10000+ points for current book)
            expect(book1Task.priority).toBeGreaterThan(book2Task.priority);
            expect(book1Task.priority - book2Task.priority).toBeGreaterThan(5000);
        });

        it('should handle priority rebalancing when switching chapters', () => {
            scheduler.addTask({
                id: 'chapter1_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            }, 'dormant');

            scheduler.addTask({
                id: 'chapter2_task',
                bookId: 'book1',
                chapterId: 'chapter2',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text2'
            }, 'dormant');

            // Set cursor to chapter1 - this wakes tasks and sets priorities
            scheduler.setCursor('book1', 'chapter1', 0);
            
            const tasks = (scheduler as any).tasks;
            const ch1Task = tasks.find((t: any) => t.chapterId === 'chapter1');
            const ch2Task = tasks.find((t: any) => t.chapterId === 'chapter2');
            
            // chapter1 should have much higher priority (5000+ points for current chapter)
            expect(ch1Task.priority).toBeGreaterThan(ch2Task.priority);
            expect(ch1Task.priority - ch2Task.priority).toBeGreaterThan(4000);
        });

        it('should maintain priority order with mixed task types', () => {
            // Add mix of DENSITY and SUMMARY tasks at different positions
            for (let i = 0; i < 10; i++) {
                scheduler.addTask({
                    id: `density_${i}`,
                    bookId: 'book1',
                    chapterId: 'chapter1',
                    subchapterIndex: i,
                    startWordIndex: i * 100,
                    endWordIndex: (i + 1) * 100,
                    type: 'DENSITY',
                    text: `text${i}`
                });

                scheduler.addTask({
                    id: `summary_${i}`,
                    bookId: 'book1',
                    chapterId: 'chapter1',
                    subchapterIndex: i,
                    startWordIndex: i * 100,
                    endWordIndex: (i + 1) * 100,
                    type: 'SUMMARY',
                    text: `text${i}`
                });
            }

            scheduler.setCursor('book1', 'chapter1', 250); // Middle of chunk 2

            const tasks = (scheduler as any).tasks;
            
            // Verify tasks are sorted by priority (descending)
            for (let i = 0; i < tasks.length - 1; i++) {
                expect(tasks[i].priority).toBeGreaterThanOrEqual(tasks[i + 1].priority);
            }
        });

        it('should handle priority rebalancing after task removal', () => {
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
                bookId: 'book2',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text3'
            });

            scheduler.setCursor('book1', 'chapter1', 0);

            // Remove book1 tasks
            scheduler.removeTasksForBook('book1');

            const tasks = (scheduler as any).tasks;
            
            // Only book2 task should remain
            expect(tasks.length).toBe(1);
            expect(tasks[0].bookId).toBe('book2');
        });

        it('should handle priority with zero-width chunks', () => {
            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 100,
                endWordIndex: 100, // Zero width
                type: 'DENSITY',
                text: ''
            });

            scheduler.setCursor('book1', 'chapter1', 100);

            const tasks = (scheduler as any).tasks;
            
            // Should handle without crashing
            expect(tasks[0].priority).toBeDefined();
        });

        it('should handle priority when cursor is beyond all tasks', () => {
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

            // Set cursor way beyond all tasks
            scheduler.setCursor('book1', 'chapter1', 1000000);

            const tasks = (scheduler as any).tasks;
            
            // Task should still have valid priority (as passed chunk)
            expect(tasks[0].priority).toBeDefined();
            expect(tasks[0].priority).toBeGreaterThan(0);
        });

        it('should handle priority with very small chunk size setting', () => {
            (useSettingsStore.getState as any).mockReturnValue({
                pacingModelTier: 'basic',
                summarizerModel: 'basic',
                summarizerBasePrompt: 'Summarize',
                summarizerFragments: [],
                enableJunkRemoval: false,
                summaryChunkSize: 1 // Very small
            });

            scheduler.addTask({
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 1,
                type: 'DENSITY',
                text: 'word'
            });

            scheduler.setCursor('book1', 'chapter1', 0);

            const tasks = (scheduler as any).tasks;
            
            // Should handle small chunk size without issues
            expect(tasks[0].priority).toBeDefined();
        });

        it('should handle priority when all tasks are in different chapters', () => {
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
                chapterId: 'chapter2',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text2'
            }, 'dormant');

            scheduler.addTask({
                id: 'task3',
                bookId: 'book1',
                chapterId: 'chapter3',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text3'
            }, 'dormant');

            // Set cursor to chapter1
            scheduler.setCursor('book1', 'chapter1', 50);

            const tasks = (scheduler as any).tasks;
            
            // Current chapter task should be highest priority
            const ch1Task = tasks.find((t: any) => t.chapterId === 'chapter1');
            const ch2Task = tasks.find((t: any) => t.chapterId === 'chapter2');
            const ch3Task = tasks.find((t: any) => t.chapterId === 'chapter3');
            
            expect(ch1Task.priority).toBeGreaterThan(ch2Task.priority);
            expect(ch1Task.priority).toBeGreaterThan(ch3Task.priority);
        });
    });
});
