import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { initDB } from '../sync/db';
import { analyzeDensityRange, type WindowResult } from './analysis';
import { generateUnifiedCompletion } from '../ai/service';

export type TaskType = 'DENSITY' | 'SUMMARY';

export interface IngestionTask {
    id: string;
    bookId: string;
    chapterId: string;
    subchapterIndex: number;
    startWordIndex: number;
    endWordIndex: number;
    type: TaskType;
    priority: number;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'dormant';
    text: string; // The text chunk to process
}

export class IngestionScheduler {
    private tasks: IngestionTask[] = [];
    private isRunning = false;
    private currentBookId: string | null = null;
    private currentChapterId: string | null = null;
    private currentWordIndex: number = 0;

    constructor() {
        // Subscribe to aiEnabled changes to resume processing when re-enabled
        // Guard for test environment where subscribe may not be available
        if (typeof useSettingsStore.subscribe === 'function') {
            useSettingsStore.subscribe((state) => {
                if (state.aiEnabled && !this.isRunning) {
                    console.log("[Scheduler] AI re-enabled, resuming task processing.");
                    this.processNext();
                }
            });
        }
    }

    /**
     * Resume processing (call when AI is re-enabled)
     */
    public resume() {
        this.processNext();
    }

    public setCursor(bookId: string, chapterId: string, wordIndex: number) {
        this.currentBookId = bookId;
        this.currentChapterId = chapterId;
        this.currentWordIndex = wordIndex;
        this.wakeUpDormantTasks();
        this.rebalancePriorities();
        this.processNext();
    }

    public removeTasksForBook(bookId: string) {
        const count = this.tasks.filter(t => t.bookId === bookId).length;
        this.tasks = this.tasks.filter(t => t.bookId !== bookId);
        console.log(`[Scheduler] Removed ${count} tasks for book ${bookId}`);
    }

    public addTask(task: Omit<IngestionTask, 'priority' | 'status'>, initialStatus: 'pending' | 'dormant' = 'pending') {
        // Check if task already exists
        const exists = this.tasks.find(t => 
            t.bookId === task.bookId && 
            t.chapterId === task.chapterId && 
            t.subchapterIndex === task.subchapterIndex && 
            t.type === task.type
        );
        if (exists) {
            console.log(`[Scheduler] Task already exists: ${task.type} ${task.chapterId} ${task.subchapterIndex}`);
            return;
        }

        const newTask: IngestionTask = {
            ...task,
            priority: 0,
            status: initialStatus
        };
        this.tasks.push(newTask);
        console.log(`[Scheduler] Added task: ${task.type} ${task.chapterId} ${task.subchapterIndex} (${initialStatus})`);
        
        if (initialStatus === 'pending') {
            this.rebalancePriorities();
            this.processNext();
        }
    }

    private wakeUpDormantTasks() {
        if (!this.currentBookId || !this.currentChapterId) return;

        // We wake tasks using chunk indices rather than word-distance so that
        // books with many small chunks don't accidentally wake a large number at once.
        const DENSITY_LOOKAHEAD_CHUNKS = 3;
        const SUMMARY_LOOKAHEAD_CHUNKS = 3;
        const REWIND_CHUNKS = 1;

        const chapterTasks = this.tasks.filter(
            (t) => t.bookId === this.currentBookId && t.chapterId === this.currentChapterId
        );

        // Prefer using DENSITY tasks to locate the current chunk (they share indices with SUMMARY).
        const locatorTasks = chapterTasks.filter((t) => t.type === 'DENSITY');
        const tasksForIndex = locatorTasks.length > 0 ? locatorTasks : chapterTasks;

        let currentChunkIndex = 0;
        const containing = tasksForIndex.find(
            (t) => t.startWordIndex <= this.currentWordIndex && t.endWordIndex > this.currentWordIndex
        );
        if (containing) {
            currentChunkIndex = containing.subchapterIndex;
        } else {
            // Fallback: pick the last chunk that starts before the cursor.
            const started = tasksForIndex
                .filter((t) => t.startWordIndex <= this.currentWordIndex)
                .sort((a, b) => b.startWordIndex - a.startWordIndex)[0];
            if (started) currentChunkIndex = started.subchapterIndex;
        }

        this.tasks.forEach((task) => {
            if (task.status !== 'dormant') return;
            if (task.bookId !== this.currentBookId) return;

            if (task.chapterId === this.currentChapterId) {
                const lookahead = task.type === 'DENSITY' ? DENSITY_LOOKAHEAD_CHUNKS : SUMMARY_LOOKAHEAD_CHUNKS;
                const minIndex = Math.max(0, currentChunkIndex - REWIND_CHUNKS);
                const maxIndex = currentChunkIndex + lookahead;

                if (task.subchapterIndex >= minIndex && task.subchapterIndex <= maxIndex) {
                    task.status = 'pending';
                    console.log(`[Scheduler] Waking up task: ${task.id} (Chunk: ${task.subchapterIndex}, Current: ${currentChunkIndex})`);
                }
            }
            // TODO: Handle next chapter lookahead
        });
    }

    private rebalancePriorities() {
        // Note: rebalance even without currentBookId - just don't apply cursor-based scoring
        this.tasks.forEach(task => {
            if (task.status !== 'pending') return;

            // Base priority
            let score = 0;

            // 1. Book Priority
            if (this.currentBookId && task.bookId === this.currentBookId) {
                score += 10000;
            }

            // 2. Chapter/Location Priority
            // We need to know the order of chapters. 
            // For simplicity, we assume chapterId string comparison or we need to look up index.
            // Let's rely on the fact that we usually process one book.
            // If we are in the same chapter:
            if (this.currentChapterId && task.chapterId === this.currentChapterId) {
                score += 5000;
                
                // Use chunk-based priority to ensure Density N → Summary N → Density N+1
                // Chunks closer to cursor get higher priority
                // Each chunk gets a 100-point band, with DENSITY getting +10 within the band
                
                // Determine if this task's chunk is before, at, or after cursor
                const isCurrent = task.startWordIndex <= this.currentWordIndex && task.endWordIndex > this.currentWordIndex;
                const isPassed = task.endWordIndex <= this.currentWordIndex;
                
                if (isPassed) {
                    // Passed chunk - lower priority but still process for completeness
                    // Further back = lower priority (but all passed are lower than current/future)
                    score += 100 - task.subchapterIndex; 
                } else if (isCurrent) {
                    // Current chunk - highest priority within the chapter
                    score += 3000 - (task.subchapterIndex * 100);
                } else {
                    // Future chunk - prioritize by subchapterIndex (lower = closer = higher priority)
                    score += 2000 - (task.subchapterIndex * 10);
                }
            } else if (!this.currentBookId) {
                // No cursor set yet - use task order (lower subchapterIndex first)
                // Group by chunk: Density 0, Summary 0, Density 1, Summary 1, etc.
                // Higher score = higher priority. Chunk 0 should be highest.
                // Use chunk index * 100 as base, so chunk 0 = 100000, chunk 1 = 99900, etc.
                score = 100000 - (task.subchapterIndex * 100);
            } else {
                // Different chapter. 
                // We'd need chapter indexes to know if it's next or prev.
                // For now, give a generic low score, but higher than other books.
                score += 500;
            }

            // 3. Task Type Priority
            // Within the SAME chunk, Density runs first (+10), then Summary.
            // This is a small bonus so it only matters for same-chunk comparisons.
            if (task.type === 'DENSITY') {
                score += 10;
            }

            task.priority = score;
        });

        // Sort: Higher priority first
        this.tasks.sort((a, b) => b.priority - a.priority);
    }

    private async processNext() {
        if (this.isRunning) {
            console.log("[Scheduler] processNext called but already running.");
            return;
        }

        // Check if AI is disabled - pause processing
        const settings = useSettingsStore.getState();
        if (!settings.aiEnabled) {
            console.log("[Scheduler] AI disabled, pausing task processing.");
            return;
        }

        const nextTask = this.tasks.find(t => t.status === 'pending');
        if (!nextTask) {
            console.log("[Scheduler] No pending tasks.");
            return;
        }

        const pendingCount = this.tasks.filter(t => t.status === 'pending').length;
        const dormantCount = this.tasks.filter(t => t.status === 'dormant').length;
        
        console.log(`[Scheduler] [Queue: ${pendingCount} Pending, ${dormantCount} Dormant] Starting Task: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`);
        
        this.isRunning = true;
        nextTask.status = 'processing';

        try {
            // Note: We don't wrap in llmQueue.add() here because:
            // - analyzeDensityRange() already uses analysisQueue internally for LLM calls
            // - generateUnifiedCompletion() for SUMMARY tasks is lightweight wrapper
            // Wrapping here would cause deadlock since analysisQueue has concurrency 1
            console.log(`[Scheduler] Executing task: ${nextTask.id}`);
            await this.executeTask(nextTask);
            console.log(`[Scheduler] [Success] Task Completed: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`);
            nextTask.status = 'completed';
            // Remove completed task
            this.tasks = this.tasks.filter(t => t.id !== nextTask.id);
        } catch (e) {
            console.error(`[Scheduler] [Failed] Task Error: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`, e);
            nextTask.status = 'failed';
            // Move to end or retry logic?
        } finally {
            this.isRunning = false;
            this.processNext(); // Loop
        }
    }

    private async executeTask(task: IngestionTask) {
        // Double check if task is still valid (might have been removed from queue but reference held)
        // Or if book was deleted
        const db = await initDB();
        const bookExists = await db.books.findOne(task.bookId).exec();
        if (!bookExists) {
            console.log(`[Scheduler] Skipping task for deleted book ${task.bookId}`);
            return;
        }

        const settings = useSettingsStore.getState();
        const aiState = useAIStore.getState();

        // console.log(`[Scheduler] Executing ${task.type} for ${task.chapterId} sub ${task.subchapterIndex}`);

        if (task.type === 'DENSITY') {
            const { pacingModelTier } = settings;
            
            // Set current task for progress tracking
            const words = task.text.trim().split(/\s+/);
            aiState.setCurrentTask({
                type: 'density',
                chunkIndex: task.subchapterIndex,
                totalChunks: 0, // We don't know total chunks here
                wordsProcessed: 0,
                totalWords: words.length,
            });
            aiState.setActivity(`Scanning Density (Chunk ${task.subchapterIndex + 1})`, pacingModelTier);
            
            try {
                // Incremental save callback - saves densities to DB after each 250-word window
                const onWindowComplete = async (result: WindowResult) => {
                    const chapter = await db.chapters.findOne(task.chapterId).exec();
                    if (!chapter) return;
                    
                    await chapter.incrementalModify(doc => {
                        const currentDensities = [...(doc.densities || [])];
                        const currentAnalysisData = [...(doc.analysisData || [])];
                        
                        // Pre-fill arrays if needed
                        const requiredLength = task.startWordIndex + result.startIndex + result.densities.length;
                        while (currentDensities.length < requiredLength) {
                            currentDensities.push(1.0); // Default density
                        }
                        while (currentAnalysisData.length < requiredLength) {
                            currentAnalysisData.push({ tokens: [], surprisals: [] });
                        }
                        
                        // Splice in the window's densities
                        for (let i = 0; i < result.densities.length; i++) {
                            const targetIdx = task.startWordIndex + result.startIndex + i;
                            currentDensities[targetIdx] = result.densities[i];
                            currentAnalysisData[targetIdx] = result.analysisData[i] || { tokens: [], surprisals: [] };
                        }
                        
                        return {
                            ...doc,
                            densities: currentDensities,
                            analysisData: currentAnalysisData
                        };
                    });
                    
                    console.log(`[Scheduler] Incremental save: ${result.densities.length} densities at offset ${result.startIndex}`);
                };

                // Analyze with incremental saves
                await analyzeDensityRange(words, onWindowComplete);
                
                // Note: Final global percentile-based densities are calculated at the end
                // but incremental window-local densities are already saved for immediate reading
            } finally {
                aiState.setActivity(null);
                aiState.setCurrentTask(null);
            }
        } 
        
        else if (task.type === 'SUMMARY') {
            const { summarizerModel } = settings;
            
            // Set current task for progress tracking
            aiState.setCurrentTask({
                type: 'summary',
                chunkIndex: task.subchapterIndex,
                totalChunks: 0,
                wordsProcessed: 0,
                totalWords: task.text.split(/\s+/).length,
            });
            aiState.setActivity(`Summarizing (Chunk ${task.subchapterIndex + 1})`, summarizerModel);
            
            // Start timing for interpolated progress
            aiState.startSummaryTiming();

            try {
                const summaryInstruction = settings.summaryPrompt || "Summarize the following text in 5 sentences.";

                const prompt = `${summaryInstruction}

${task.text.substring(0, 3000)}`;

                const { response } = await generateUnifiedCompletion(prompt, summarizerModel);
                
                const summary = response.trim();

                console.log(`[Scheduler] Summary for chunk ${task.subchapterIndex} (${summary.length} chars):`, summary.substring(0, 200));

                // Save to DB
                const chapter = await db.chapters.findOne(task.chapterId).exec();
                if (chapter) {
                    await chapter.incrementalModify(doc => {
                        const subchapters = [...(doc.subchapters || [])];
                        if (subchapters[task.subchapterIndex]) {
                            subchapters[task.subchapterIndex] = {
                                ...subchapters[task.subchapterIndex],
                                summary
                            };
                            console.log(`[Scheduler] Saved summary for subchapter ${task.subchapterIndex}`);
                        } else {
                            console.warn(`[Scheduler] Subchapter ${task.subchapterIndex} not found in doc.subchapters (length: ${subchapters.length})`);
                        }
                        
                        return {
                            ...doc,
                            subchapters
                        };
                    });
                } else {
                    console.error(`[Scheduler] Chapter ${task.chapterId} not found when trying to save summary`);
                }

            } finally {
                aiState.completeSummaryTiming(); // Record duration for interpolation
                aiState.setActivity(null);
                aiState.setCurrentTask(null);
            }
        }
    }
}

export const scheduler = new IngestionScheduler();
