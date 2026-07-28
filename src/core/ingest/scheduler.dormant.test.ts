import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionScheduler, type IngestionTask } from './scheduler';

// Mock dependencies
vi.mock('../store/ai', () => ({
    useAIStore: {
        getState: vi.fn(() => ({
            setActivity: vi.fn(),
        })),
    },
}));

vi.mock('../store/settings', () => ({
    useSettingsStore: {
        getState: vi.fn(() => ({
            librarianModelTier: 'haiku',
            aiEnabled: true,
            wpm: 300, // 300 WPM = 900 words for 3 min lookahead
        })),
    },
}));

// Mock pipeline functions
vi.mock('./pipeline', () => ({
    analyzeDensityRange: vi.fn().mockResolvedValue([1, 1, 1]),
}));

// Mock service
vi.mock('../ai/service', () => ({
    getSummary: vi.fn().mockResolvedValue('Summary'),
}));

describe('IngestionScheduler Dormant Tasks', () => {
    let scheduler: IngestionScheduler;

    beforeEach(() => {
        scheduler = new IngestionScheduler();
        vi.clearAllMocks();
    });

    it('should not process dormant tasks', async () => {
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

        scheduler.addTask(task, 'dormant');

        // Wait a bit to ensure it doesn't run
        await new Promise(resolve => setTimeout(resolve, 50));

        // Access private tasks array for verification (using any cast)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = (scheduler as any).tasks;
        expect(tasks[0].status).toBe('dormant');
    });

    it('should wake up dormant tasks when cursor is near', async () => {
        const task1: Omit<IngestionTask, 'priority' | 'status'> = {
            id: 'task1',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'some text'
        };

        const task2: Omit<IngestionTask, 'priority' | 'status'> = {
            id: 'task2',
            bookId: 'book1',
            chapterId: 'chapter1',
            subchapterIndex: 1,
            startWordIndex: 100,
            endWordIndex: 200,
            type: 'DENSITY',
            text: 'some text'
        };

        // Add task1 as pending (active)
        scheduler.addTask(task1, 'pending');
        // Add task2 as dormant
        scheduler.addTask(task2, 'dormant');

        // Verify initial state
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let tasks = (scheduler as any).tasks;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(tasks.find((t: any) => t.id === 'task2').status).toBe('dormant');

        // Move cursor close to task2 (e.g. word 50)
        // Lookahead is 5000 words, so 50 is definitely close to 100
        scheduler.setCursor('book1', 'chapter1', 50);

        // Verify task2 woke up
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tasks = (scheduler as any).tasks;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(tasks.find((t: any) => t.id === 'task2').status).toBe('pending');
    });

    it('should NOT wake up dormant tasks if cursor is far away (different book)', async () => {
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

        scheduler.addTask(task, 'dormant');

        // Set cursor for different book
        scheduler.setCursor('book2', 'chapter1', 0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = (scheduler as any).tasks;
        expect(tasks[0].status).toBe('dormant');
    });

    it('should preload density tasks for the next chapter', () => {
        // Keep the queue stable so the assertion can inspect the wake-up decision.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (scheduler as any).isRunning = true;

        scheduler.addTask({
            id: 'current',
            bookId: 'book1',
            chapterId: 'chapter1',
            chapterIndex: 0,
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'current chapter'
        }, 'dormant');
        scheduler.addTask({
            id: 'next',
            bookId: 'book1',
            chapterId: 'chapter2',
            chapterIndex: 1,
            subchapterIndex: 0,
            startWordIndex: 0,
            endWordIndex: 100,
            type: 'DENSITY',
            text: 'next chapter'
        }, 'dormant');

        scheduler.setCursor('book1', 'chapter1', 0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = (scheduler as any).tasks;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(tasks.find((task: any) => task.id === 'next').status).toBe('pending');
    });
});
