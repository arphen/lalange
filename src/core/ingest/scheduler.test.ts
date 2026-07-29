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

describe('IngestionScheduler', () => {
    let scheduler: IngestionScheduler;
    let mockDB: any;
    let mockChapter: any;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new IngestionScheduler();

        // Setup default store mocks
        (useSettingsStore.getState as any).mockReturnValue({
            librarianModelTier: 'basic',
            summarizerModel: 'basic',
            summarizerBasePrompt: 'Summarize',
            summarizerFragments: [],
            enableJunkRemoval: false,
            aiEnabled: true
        });

        (useAIStore.getState as any).mockReturnValue({
            lifecycleState: 'ready',
            setActivity: vi.fn(),
            setCurrentTask: vi.fn(),
            updateTaskProgress: vi.fn(),
            startSummaryTiming: vi.fn(),
            completeSummaryTiming: vi.fn()
        });

        // Setup DB mock
        mockChapter = {
            incrementalModify: vi.fn(),
            incrementalPatch: vi.fn()
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

        // Setup Service mocks
        // Mock analyzeDensityRange to match the actual function signature (no callback)
        (analyzeDensityRange as any).mockImplementation(async (_words: string[], callback: any) => {
             // Simulate callback execution if provided
             if (callback) {
                await callback({
                    densities: [1, 1, 1],
                    analysisData: [{ tokens: [], surprisals: [] }],
                    startIndex: 0
                });
            }
            return {
                densities: [1, 1, 1],
                analysisData: [{ tokens: [], surprisals: [] }]
            };
        });
        (generateUnifiedCompletion as any).mockResolvedValue({ response: 'Test Summary' });
    });

    it('should add tasks and process them', async () => {
        const task: Omit<IngestionTask, 'priority' | 'status'> = {
            id: 'task1',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'some text'
        };

        scheduler.addTask(task);

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(analyzeDensityRange).toHaveBeenCalled();
        expect(mockChapter.incrementalModify).toHaveBeenCalled();
    });

    it('should process density but leave summaries pending when summaries are disabled', async () => {
        (useSettingsStore.getState as any).mockReturnValue({
            aiEnabled: true,
            summariesEnabled: false,
            pacingModelTier: 'basic',
        });

        scheduler.addTask({
            id: 'summary1',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'SUMMARY',
            text: 'some text',
        });
        scheduler.addTask({
            id: 'density1',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'some text',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(analyzeDensityRange).toHaveBeenCalled();
        expect(generateUnifiedCompletion).not.toHaveBeenCalled();
        expect((scheduler as any).tasks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'summary1', status: 'pending' }),
        ]));
    });

    it('should prioritize current chapter density over other tasks', async () => {
        // Pause processing by making the first task hang
        let resolveTask1: ((v: any) => void) | undefined;
        (analyzeDensityRange as any).mockImplementationOnce(() => new Promise(r => { resolveTask1 = r; }));

        // Task 1: Starts immediately
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

        // Wait for task 1 to start
        await new Promise(resolve => setTimeout(resolve, 10));

        // Task 2: Far away chapter
        scheduler.addTask({
            id: 'task2',
            bookId: 'book1',
            chapterId: 'chapter5',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'text2'
        });

        // Task 3: Current chapter (should be prioritized over Task 2)
        scheduler.addTask({
            id: 'task3',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 1,
            startWordIndex: 100,
            endWordIndex: 200,
            type: 'DENSITY',
            text: 'text3'
        });

        // Set cursor to chapter 1
        scheduler.setCursor('book1', 'chapter1', 0);

        // Now resolve task 1, so scheduler picks next task
        if (resolveTask1) resolveTask1([1]);
        else throw new Error("resolveTask1 was not assigned - task did not start?");
        
        // Wait for next task to be picked
        await new Promise(resolve => setTimeout(resolve, 10));

        // Task 3 should be executed before Task 2 because it's in the current chapter
        const calls = (analyzeDensityRange as any).mock.calls;
        // calls[0] is task1
        // calls[1] should be task3 ('text3')
        
        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(calls[1][0]).toEqual(['text3']);
    });

    it('should prioritize density over summary for the same chunk', async () => {
        let resolveTask1: ((v: any) => void) | undefined;
        (analyzeDensityRange as any).mockImplementationOnce(() => new Promise(r => { resolveTask1 = r; }));

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

        await new Promise(resolve => setTimeout(resolve, 10));

        scheduler.addTask({
            id: 'task2_summary',
            bookId: 'book1',
            chapterId: 'chapter2',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'SUMMARY',
            text: 'text2'
        });

        scheduler.addTask({
            id: 'task2_density',
            bookId: 'book1',
            chapterId: 'chapter2',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'text2'
        });

        scheduler.setCursor('book1', 'chapter2', 0);

        if (resolveTask1) resolveTask1([1]);
        else throw new Error("resolveTask1 was not assigned");

        // Wait for all tasks to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        // Check that density ran before summary
        const densityCalls = (analyzeDensityRange as any).mock.invocationCallOrder;
        const summaryCalls = (generateUnifiedCompletion as any).mock.invocationCallOrder;

        // densityCalls[0] is task1
        // densityCalls[1] is task2_density
        // summaryCalls[0] is task2_summary

        expect(densityCalls.length).toBeGreaterThanOrEqual(2);
        expect(summaryCalls.length).toBeGreaterThanOrEqual(1);

        expect(densityCalls[1]).toBeLessThan(summaryCalls[0]);
    });

    it('should handle task failure gracefully', async () => {
        (analyzeDensityRange as any).mockRejectedValueOnce(new Error('AI Error'));

        const task: Omit<IngestionTask, 'priority' | 'status'> = {
            id: 'task1',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'some text'
        };

        scheduler.addTask(task);

        await new Promise(resolve => setTimeout(resolve, 10));

        // Should not crash, and should try to process next if any (none here)
        expect(analyzeDensityRange).toHaveBeenCalled();
    });

    it('should pause task processing while AI lifecycle is crashed', async () => {
        (useAIStore.getState as any).mockReturnValue({
            lifecycleState: 'crashed',
            setActivity: vi.fn(),
            setCurrentTask: vi.fn(),
            updateTaskProgress: vi.fn(),
            startSummaryTiming: vi.fn(),
            completeSummaryTiming: vi.fn(),
        });

        scheduler.addTask({
            id: 'task_crash_pause',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'some text',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(analyzeDensityRange).not.toHaveBeenCalled();
        expect((scheduler as any).tasks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'task_crash_pause', status: 'pending' }),
        ]));
    });

    it('should prioritize current chunk over passed chunks and future chunks', async () => {
        let resolveTask1: ((v: any) => void) | undefined;
        (analyzeDensityRange as any).mockImplementationOnce(() => new Promise(r => { resolveTask1 = r; }));

        // Task 1: Blocking
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

        await new Promise(resolve => setTimeout(resolve, 10));

        // Task 2: Passed Chunk (Word 100-200)
        scheduler.addTask({
            id: 'task_passed',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 1,
            startWordIndex: 100,
            endWordIndex: 200,
            type: 'DENSITY',
            text: 'passed'
        });

        // Task 3: Current Chunk (Word 1000-1100)
        scheduler.addTask({
            id: 'task_current',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 10,
            startWordIndex: 1000,
            endWordIndex: 1100,
            type: 'DENSITY',
            text: 'current'
        });

        // Task 4: Future Chunk (Word 5000-5100)
        scheduler.addTask({
            id: 'task_future',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 50,
            startWordIndex: 5000,
            endWordIndex: 5100,
            type: 'DENSITY',
            text: 'future'
        });

        // Set cursor to 1000
        scheduler.setCursor('book1', 'chapter1', 1000);

        if (resolveTask1) resolveTask1([1]);
        else throw new Error("resolveTask1 was not assigned");

        await new Promise(resolve => setTimeout(resolve, 50));

        const calls = (analyzeDensityRange as any).mock.calls;
        // calls[0] = task1
        // Expected order: Current, Future, Passed
        
        // We need to find the index of each call
        const callArgs = calls.map((c: any) => c[0][0]); // Get the text argument
        
        const currentIdx = callArgs.indexOf('current');
        const futureIdx = callArgs.indexOf('future');
        const passedIdx = callArgs.indexOf('passed');

        expect(currentIdx).toBeGreaterThan(-1);
        expect(futureIdx).toBeGreaterThan(-1);
        expect(passedIdx).toBeGreaterThan(-1);

        // Current should be first (after task1)
        expect(currentIdx).toBeLessThan(futureIdx);
        expect(currentIdx).toBeLessThan(passedIdx);
        
        // Future should be before Passed (based on my logic: Future = 1000 - dist/100, Passed = 100)
        // Future score: 1000 - (4000/100) = 960.
        // Passed score: 100.
        // So Future > Passed.
        expect(futureIdx).toBeLessThan(passedIdx);
    });

    describe('Summary LLM Response', () => {
        beforeEach(() => {
            // Reset mock to default for summary tests
            (analyzeDensityRange as any).mockResolvedValue({ 
                densities: [1, 1, 1], 
                analysisData: [{ tokens: [], surprisals: [] }] 
            });
        });

        it('should save plain text summary response', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: 'This is a test summary of the text.' 
            });

            mockChapter.subchapters = [{ startWordIndex: 0, endWordIndex: 100 }];
            mockChapter.incrementalModify = vi.fn(async (fn) => {
                const doc = { subchapters: [...mockChapter.subchapters] };
                const result = fn(doc);
                mockChapter.subchapters = result.subchapters;
                return result;
            });

            scheduler.addTask({
                id: 'summary_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text to summarize'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockChapter.incrementalModify).toHaveBeenCalled();
            expect(mockChapter.subchapters[0].summary).toBe('This is a test summary of the text.');
        });

        it('should trim whitespace from summary response', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: '  \n  Summary with whitespace.  \n  ' 
            });

            mockChapter.subchapters = [{ startWordIndex: 0, endWordIndex: 100 }];
            mockChapter.incrementalModify = vi.fn(async (fn) => {
                const doc = { subchapters: [...mockChapter.subchapters] };
                const result = fn(doc);
                mockChapter.subchapters = result.subchapters;
                return result;
            });

            scheduler.addTask({
                id: 'summary_task2',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockChapter.subchapters[0].summary).toBe('Summary with whitespace.');
        });

        it('should handle LLM service throwing an error', async () => {
            (generateUnifiedCompletion as any).mockRejectedValue(new Error('LLM service unavailable'));

            mockChapter.subchapters = [{ startWordIndex: 0, endWordIndex: 100 }];

            scheduler.addTask({
                id: 'error_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not crash, scheduler continues
            expect(generateUnifiedCompletion).toHaveBeenCalled();
        });

        it('should handle empty response from LLM', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ response: '' });

            mockChapter.subchapters = [{ startWordIndex: 0, endWordIndex: 100 }];
            mockChapter.incrementalModify = vi.fn(async (fn) => {
                const doc = { subchapters: [...mockChapter.subchapters] };
                const result = fn(doc);
                mockChapter.subchapters = result.subchapters;
                return result;
            });

            scheduler.addTask({
                id: 'empty_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockChapter.subchapters[0].summary).toBe('');
        });

        it('should handle chapter not found in DB', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: 'Test summary.' 
            });

            // Return null for chapter
            mockDB.chapters.findOne = vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null)
            });

            scheduler.addTask({
                id: 'missing_chapter_task',
                bookId: 'book1',
                chapterId: 'nonexistent',
                subchapterIndex: 0,
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not crash
            expect(generateUnifiedCompletion).toHaveBeenCalled();
        });

        it('should handle subchapter index out of bounds', async () => {
            (generateUnifiedCompletion as any).mockResolvedValue({ 
                response: 'Test summary.' 
            });

            mockChapter.subchapters = [{ startWordIndex: 0, endWordIndex: 100 }];
            mockChapter.incrementalModify = vi.fn(async (fn) => {
                const doc = { subchapters: [...mockChapter.subchapters] };
                const result = fn(doc);
                return result;
            });

            scheduler.addTask({
                id: 'oob_task',
                bookId: 'book1',
                chapterId: 'chapter1',
                subchapterIndex: 99, // Out of bounds
                startWordIndex: 0,
                endWordIndex: 100,
                type: 'SUMMARY',
                text: 'some text'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should not crash, just log warning
            expect(mockChapter.incrementalModify).toHaveBeenCalled();
        });
    });
});
