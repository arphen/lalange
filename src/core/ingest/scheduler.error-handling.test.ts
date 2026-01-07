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

describe('IngestionScheduler - Error Handling', () => {
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
            summaryChunkSize: 2500,
            summaryPrompt: 'Summarize in 5 sentences.'
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

    describe('Failed task execution', () => {
        it('should handle failed DENSITY task and continue processing next tasks', async () => {
            // First task fails, second should still process
            (analyzeDensityRange as any)
                .mockRejectedValueOnce(new Error('AI model error'))
                .mockResolvedValueOnce({
                    densities: [1, 1, 1],
                    analysisData: [{}, {}, {}]
                });

            const task1: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text1'
            };

            const task2: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 100,
                endWordIndex: 200,
                type: 'DENSITY',
                text: 'text2'
            };

            scheduler.addTask(task1);
            scheduler.addTask(task2);

            // Wait for both tasks to be attempted
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify both tasks were attempted
            expect(analyzeDensityRange).toHaveBeenCalledTimes(2);
            
            // Verify task1 is marked as failed
            const tasks = (scheduler as any).tasks;
            const failedTask = tasks.find((t: any) => t.id === 'task1');
            expect(failedTask?.status).toBe('failed');
            
            // Verify task2 was completed and removed
            const completedTask = tasks.find((t: any) => t.id === 'task2');
            expect(completedTask).toBeUndefined();
        });

        it('should handle failed SUMMARY task and continue processing', async () => {
            (generateUnifiedCompletion as any)
                .mockRejectedValueOnce(new Error('Network timeout'))
                .mockResolvedValueOnce({ 
                    response: '{"status": "CONTENT", "title": "Test", "summary": "Summary"}' 
                });

            const task1: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'summary_task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text1'
            };

            const task2: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'summary_task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 1,
                startWordIndex: 100,
                endWordIndex: 200,
                type: 'SUMMARY',
                text: 'text2'
            };

            scheduler.addTask(task1);
            scheduler.addTask(task2);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(generateUnifiedCompletion).toHaveBeenCalledTimes(2);
            
            const tasks = (scheduler as any).tasks;
            const failedTask = tasks.find((t: any) => t.id === 'summary_task1');
            expect(failedTask?.status).toBe('failed');
        });

        it('should handle multiple consecutive task failures gracefully', async () => {
            (analyzeDensityRange as any)
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))
                .mockResolvedValueOnce({
                    densities: [1, 1, 1],
                    analysisData: [{}, {}, {}]
                });

            for (let i = 0; i < 4; i++) {
                scheduler.addTask({
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

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(analyzeDensityRange).toHaveBeenCalledTimes(4);
            
            const tasks = (scheduler as any).tasks;
            const failedTasks = tasks.filter((t: any) => t.status === 'failed');
            expect(failedTasks.length).toBe(3);
        });

        it('should skip task execution when book is deleted mid-processing', async () => {
            // Book doesn't exist
            mockDB.books.findOne = vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null)
            });

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'deleted_book',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Task should complete without calling analyzeDensityRange
            expect(analyzeDensityRange).not.toHaveBeenCalled();
            
            const tasks = (scheduler as any).tasks;
            expect(tasks.find((t: any) => t.id === 'task1')).toBeUndefined();
        });

        it('should handle chapter not found during DENSITY task', async () => {
            mockDB.chapters.findOne = vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null)
            });

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'missing_chapter',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'DENSITY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Should complete without error even though chapter doesn't exist
            expect(analyzeDensityRange).toHaveBeenCalled();
        });

        it('should handle chapter not found during SUMMARY task', async () => {
            mockDB.chapters.findOne = vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null)
            });

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'missing_chapter',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Should complete without error even though chapter doesn't exist
            expect(generateUnifiedCompletion).toHaveBeenCalled();
        });

        it('should handle database write errors during DENSITY task', async () => {
            mockChapter.incrementalModify = vi.fn().mockRejectedValue(new Error('DB write failed'));

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

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            const tasks = (scheduler as any).tasks;
            const failedTask = tasks.find((t: any) => t.id === 'task1');
            expect(failedTask?.status).toBe('failed');
        });

        it('should handle database write errors during SUMMARY task', async () => {
            mockChapter.incrementalModify = vi.fn().mockRejectedValue(new Error('DB write failed'));

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            const tasks = (scheduler as any).tasks;
            const failedTask = tasks.find((t: any) => t.id === 'task1');
            expect(failedTask?.status).toBe('failed');
        });

        it('should handle malformed JSON in SUMMARY response', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: 'This is not valid JSON {broken}' 
            });

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Should complete without crashing, using default values
            const tasks = (scheduler as any).tasks;
            expect(tasks.find((t: any) => t.id === 'task1')).toBeUndefined();
            expect(mockChapter.incrementalModify).toHaveBeenCalled();
        });
    });

    describe('Task execution edge cases', () => {
        it('should handle empty densities array from analyzeDensityRange', async () => {
            (analyzeDensityRange as any).mockResolvedValue({
                densities: [],
                analysisData: []
            });

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

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(mockChapter.incrementalModify).toHaveBeenCalled();
        });

        it('should handle JUNK status in summary response', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: '{"status": "JUNK"}' 
            });

            (useSettingsStore.getState as any).mockReturnValue({
                pacingModelTier: 'basic',
                summarizerModel: 'basic',
                summarizerBasePrompt: 'Summarize',
                summarizerFragments: [],
                enableJunkRemoval: true,
                summaryChunkSize: 2500
            });

            const task: Omit<IngestionTask, 'priority' | 'status'> = {
                id: 'task1',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'text'
            };

            scheduler.addTask(task);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Verify the chapter was updated with JUNK markers
            expect(mockChapter.incrementalModify).toHaveBeenCalled();
            const modifyCall = mockChapter.incrementalModify.mock.calls[0][0];
            const result = modifyCall({ subchapters: [{ title: '', summary: '' }] });
            expect(result.subchapters[0].title).toBe('SKIPPED (JUNK)');
        });
    });
});
