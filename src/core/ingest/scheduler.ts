import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { initDB, type GlobalSummaryType } from '../sync/db';
import { analyzeDensityRange, type WindowResult } from './analysis';
import { generateUnifiedCompletion } from '../ai/service';

export type TaskType = 'DENSITY' | 'SUMMARY' | 'GLOBAL_SUMMARY';

export interface IngestionTask {
    id: string;
    bookId: string;
    chapterId: string;
    chapterIndex?: number;
    subchapterIndex: number;
    startWordIndex: number;
    endWordIndex: number;
    type: TaskType;
    priority: number;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'dormant';
    text: string; // The text chunk to process
}

// Global summary task has different structure (spans multiple chapters)
export interface GlobalSummaryTask {
    id: string;
    bookId: string;
    summaryIndex: number;           // Which global summary (0, 1, 2, ...)
    globalStartWordIndex: number;   // Start index across entire book
    globalEndWordIndex: number;
    startChapterId: string;
    endChapterId: string;
    type: 'GLOBAL_SUMMARY';
    priority: number;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'dormant';
    // Text is collected at execution time by reading chapters
}

const SUMMARY_STYLE_GUARD = 'Write only the summary text. Do not mention prompts, instructions, being an AI, or being a chatbot.';

const sanitizeSummaryText = (rawSummary: string): string => {
    const cleaned = rawSummary
        .trim()
        .replace(/^as\s+an?\s+(?:ai(?:\s+language\s+model)?|language\s+model|chatbot)[^\n]*?[:.!?]\s*/i, '')
        .replace(/^i\s+(?:am|can't|cannot|do not|don't)\s+[^.!?]*[.!?]\s*/i, '')
        .replace(/^(?:here(?: is|'s)\s+)?(?:a\s+)?summary\s*[:-]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned || rawSummary.trim();
};

export class IngestionScheduler {
    private tasks: IngestionTask[] = [];
    private globalSummaryTasks: GlobalSummaryTask[] = [];
    private isRunning = false;
    private activeTask: IngestionTask | null = null;
    private activeTaskAbortController: AbortController | null = null;
    private currentBookId: string | null = null;
    private currentChapterId: string | null = null;
    private currentWordIndex: number = 0;
    private currentGlobalWordIndex: number = 0;  // Tracks position across entire book
    private previousAiEnabled: boolean = true;
    private previousSummariesEnabled: boolean = false;
    private crashPauseLogged = false;

    constructor() {
        // Subscribe to aiEnabled changes to resume processing when re-enabled
        // Guard for test environment where subscribe may not be available
        if (typeof useSettingsStore.subscribe === 'function') {
            // Track previous state to only trigger on false→true transitions
            this.previousAiEnabled = useSettingsStore.getState().aiEnabled ?? true;
            this.previousSummariesEnabled = useSettingsStore.getState().summariesEnabled ?? false;
            useSettingsStore.subscribe((state) => {
                const wasDisabled = !this.previousAiEnabled;
                const isNowEnabled = state.aiEnabled;
                const summariesWereDisabled = !this.previousSummariesEnabled;
                const summariesAreNowEnabled = state.summariesEnabled ?? false;
                this.previousAiEnabled = isNowEnabled;
                this.previousSummariesEnabled = summariesAreNowEnabled;
                
                // Only resume on transition from disabled to enabled
                if (wasDisabled && isNowEnabled && !this.isRunning) {
                    console.log("[Scheduler] AI re-enabled, resuming task processing.");
                    this.processNext();
                }

                if (summariesWereDisabled && summariesAreNowEnabled) {
                    console.log("[Scheduler] Automatic summaries enabled, resuming summary processing.");
                    this.reconcileTaskActivation();
                    this.wakeUpGlobalSummaryTasks();
                    this.rebalancePriorities();
                    if (!this.isRunning) this.processNext();
                }
            });
        }
    }

    public setCursor(bookId: string, chapterId: string, wordIndex: number, globalWordIndex?: number) {
        this.currentBookId = bookId;
        this.currentChapterId = chapterId;
        this.currentWordIndex = wordIndex;
        if (globalWordIndex !== undefined) {
            this.currentGlobalWordIndex = globalWordIndex;
        }

        const activeTaskIds = this.reconcileTaskActivation();
        if (this.activeTask && !activeTaskIds.has(this.activeTask.id)) {
            this.activeTaskAbortController?.abort();
        }
        this.wakeUpGlobalSummaryTasks();
        this.rebalancePriorities();
        this.processNext();
    }

    public removeTasksForBook(bookId: string) {
        if (this.activeTask?.bookId === bookId) {
            this.activeTaskAbortController?.abort();
        }
        const count = this.tasks.filter(t => t.bookId === bookId).length;
        const globalCount = this.globalSummaryTasks.filter(t => t.bookId === bookId).length;
        this.tasks = this.tasks.filter(t => t.bookId !== bookId);
        this.globalSummaryTasks = this.globalSummaryTasks.filter(t => t.bookId !== bookId);
        console.log(`[Scheduler] Removed ${count} tasks and ${globalCount} global summary tasks for book ${bookId}`);
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

        // A newly discovered next-chapter task may already be inside the active
        // lookahead window even when the pipeline initially marks it dormant.
        this.reconcileTaskActivation();
        if (newTask.status === 'pending') {
            this.rebalancePriorities();
            this.processNext();
        }
    }

    public addGlobalSummaryTask(task: Omit<GlobalSummaryTask, 'priority' | 'status' | 'type'>, initialStatus: 'pending' | 'dormant' = 'pending') {
        // Check if task already exists
        const exists = this.globalSummaryTasks.find(t => 
            t.bookId === task.bookId && 
            t.summaryIndex === task.summaryIndex
        );
        if (exists) {
            console.log(`[Scheduler] Global summary task already exists: ${task.bookId} summary ${task.summaryIndex}`);
            return;
        }

        const newTask: GlobalSummaryTask = {
            ...task,
            type: 'GLOBAL_SUMMARY',
            priority: 0,
            status: initialStatus
        };
        this.globalSummaryTasks.push(newTask);
        console.log(`[Scheduler] Added global summary task: ${task.bookId} summary ${task.summaryIndex} (words ${task.globalStartWordIndex}-${task.globalEndWordIndex}) (${initialStatus})`);
        
        if (initialStatus === 'pending') {
            this.rebalancePriorities();
            this.processNext();
        }
    }

    private wakeUpGlobalSummaryTasks() {
        if (!this.currentBookId) return;
        
        const settings = useSettingsStore.getState();
        if (settings.summariesEnabled === false) return;
        const summaryInterval = settings.summaryChunkSize || 2500;
        
        // Wake up global summaries that are within 2 intervals of current position
        const lookaheadWords = summaryInterval * 2;
        
        this.globalSummaryTasks.forEach(task => {
            if (task.status !== 'dormant') return;
            if (task.bookId !== this.currentBookId) return;
            
            // Wake if the summary's end point is within lookahead
            if (task.globalEndWordIndex <= this.currentGlobalWordIndex + lookaheadWords) {
                task.status = 'pending';
                console.log(`[Scheduler] Waking up global summary task: ${task.id} (ends at ${task.globalEndWordIndex}, current: ${this.currentGlobalWordIndex})`);
            }
        });
    }

    private reconcileTaskActivation(): Set<string> {
        const activeTaskIds = new Set<string>();
        if (!this.currentBookId || !this.currentChapterId) return activeTaskIds;

        // Calculate lookahead based on reading time rather than fixed chunk count.
        // This ensures we always have enough buffer even with small chunks from malformed epubs.
        const settings = useSettingsStore.getState();
        const wpm = settings.wpm || 300;
        
        // Density: aim for 3 minutes of reading time lookahead
        // Summary: aim for 2 minutes (summaries are lower priority)
        const DENSITY_LOOKAHEAD_MINUTES = 3;
        const SUMMARY_LOOKAHEAD_MINUTES = 2;
        const DENSITY_LOOKAHEAD_WORDS = wpm * DENSITY_LOOKAHEAD_MINUTES;
        const SUMMARY_LOOKAHEAD_WORDS = wpm * SUMMARY_LOOKAHEAD_MINUTES;
        
        // Also maintain minimum chunk counts for very fast readers
        const MIN_DENSITY_CHUNKS = 6;
        const MIN_SUMMARY_CHUNKS = 5;
        const REWIND_CHUNKS = 1;

        const chapterTasks = this.tasks.filter(
            (t) => t.bookId === this.currentBookId && t.chapterId === this.currentChapterId
        );
        const currentChapterIndex = chapterTasks.find(
            (task) => task.chapterIndex !== undefined
        )?.chapterIndex;

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
            if (task.status === 'completed' || task.status === 'failed') return;
            let shouldBeActive = false;

            if (
                task.bookId === this.currentBookId
                && task.chapterId === this.currentChapterId
                && !(task.type === 'SUMMARY' && settings.summariesEnabled === false)
            ) {
                const lookaheadWords = task.type === 'DENSITY' ? DENSITY_LOOKAHEAD_WORDS : SUMMARY_LOOKAHEAD_WORDS;
                const minChunks = task.type === 'DENSITY' ? MIN_DENSITY_CHUNKS : MIN_SUMMARY_CHUNKS;
                
                // Wake if: within word-based lookahead OR within minimum chunk count
                const isWithinWordLookahead = task.startWordIndex < this.currentWordIndex + lookaheadWords;
                const isWithinChunkLookahead = task.subchapterIndex <= currentChunkIndex + minChunks;
                const isRewind = task.subchapterIndex >= Math.max(0, currentChunkIndex - REWIND_CHUNKS);

                shouldBeActive = isRewind && (isWithinWordLookahead || isWithinChunkLookahead);
            } else if (
                task.bookId === this.currentBookId &&
                task.type === 'DENSITY' &&
                currentChapterIndex !== undefined &&
                task.chapterIndex === currentChapterIndex + 1
            ) {
                const isWithinWordLookahead = task.startWordIndex < DENSITY_LOOKAHEAD_WORDS;
                const isWithinChunkLookahead = task.subchapterIndex < MIN_DENSITY_CHUNKS;

                shouldBeActive = isWithinWordLookahead || isWithinChunkLookahead;
            }

            if (shouldBeActive) {
                activeTaskIds.add(task.id);
            }

            if (task.status === 'processing') return;

            if (shouldBeActive && task.status === 'dormant') {
                task.status = 'pending';
                console.log(`[Scheduler] Waking up task: ${task.id}`);
            } else if (!shouldBeActive && task.status === 'pending') {
                task.status = 'dormant';
                console.log(`[Scheduler] Returning stale task to dormant: ${task.id}`);
            }
        });

        return activeTaskIds;
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

        const aiState = useAIStore.getState();
        if (aiState.lifecycleState === 'crashed') {
            if (!this.crashPauseLogged) {
                console.log("[Scheduler] AI crashed, pausing task processing until recovery.");
                this.crashPauseLogged = true;
            }
            return;
        }
        this.crashPauseLogged = false;

        // Check for pending global summary tasks first (lower priority than density but important)
        const summariesEnabled = settings.summariesEnabled !== false;
        const nextGlobalSummary = !summariesEnabled
            ? undefined
            : this.globalSummaryTasks.find(t => t.status === 'pending');
        const nextTask = this.tasks.find(t =>
            t.status === 'pending' && (summariesEnabled || t.type !== 'SUMMARY')
        );
        
        // Prioritize density tasks over global summaries, but run global summaries when no density pending
        const hasPendingDensity = this.tasks.some(t => t.status === 'pending' && t.type === 'DENSITY');
        
        if (nextGlobalSummary && !hasPendingDensity) {
            // Execute global summary task
            const pendingGlobal = this.globalSummaryTasks.filter(t => t.status === 'pending').length;
            console.log(`[Scheduler] [Global Summary Queue: ${pendingGlobal} Pending] Starting: ${nextGlobalSummary.id}`);
            
            this.isRunning = true;
            nextGlobalSummary.status = 'processing';
            
            try {
                await this.executeGlobalSummaryTask(nextGlobalSummary);
                console.log(`[Scheduler] [Success] Global Summary Completed: ${nextGlobalSummary.id}`);
                nextGlobalSummary.status = 'completed';
                this.globalSummaryTasks = this.globalSummaryTasks.filter(t => t.id !== nextGlobalSummary.id);
            } catch (e) {
                console.error(`[Scheduler] [Failed] Global Summary Error: ${nextGlobalSummary.id}`, e);
                nextGlobalSummary.status = 'failed';
            } finally {
                this.isRunning = false;
                this.processNext();
            }
            return;
        }
        
        if (!nextTask) {
            console.log("[Scheduler] No pending tasks.");
            return;
        }

        const pendingCount = this.tasks.filter(t => t.status === 'pending').length;
        const dormantCount = this.tasks.filter(t => t.status === 'dormant').length;
        
        console.log(`[Scheduler] [Queue: ${pendingCount} Pending, ${dormantCount} Dormant] Starting Task: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`);
        
        this.isRunning = true;
        nextTask.status = 'processing';
        const abortController = new AbortController();
        this.activeTask = nextTask;
        this.activeTaskAbortController = abortController;

        try {
            // Note: We don't wrap in llmQueue.add() here because:
            // - analyzeDensityRange() already uses analysisQueue internally for LLM calls
            // - generateUnifiedCompletion() for SUMMARY tasks is lightweight wrapper
            // Wrapping here would cause deadlock since analysisQueue has concurrency 1
            console.log(`[Scheduler] Executing task: ${nextTask.id}`);
            const completed = await this.executeTask(nextTask, abortController.signal);
            if (completed) {
                console.log(`[Scheduler] [Success] Task Completed: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`);
                nextTask.status = 'completed';
                this.tasks = this.tasks.filter(t => t.id !== nextTask.id);
            } else {
                console.log(`[Scheduler] Task interrupted and returned to dormant: ${nextTask.id}`);
                nextTask.status = 'dormant';
            }
        } catch (e) {
            console.error(`[Scheduler] [Failed] Task Error: [${nextTask.type}] Ch:${nextTask.chapterId.split('_').pop()} Pt:${nextTask.subchapterIndex}`, e);
            nextTask.status = 'failed';
            // Move to end or retry logic?
        } finally {
            this.activeTask = null;
            this.activeTaskAbortController = null;
            this.isRunning = false;
            this.processNext(); // Loop
        }
    }

    private async executeTask(task: IngestionTask, signal: AbortSignal): Promise<boolean> {
        // Double check if task is still valid (might have been removed from queue but reference held)
        // Or if book was deleted
        const db = await initDB();
        const bookExists = await db.books.findOne(task.bookId).exec();
        if (!bookExists) {
            console.log(`[Scheduler] Skipping task for deleted book ${task.bookId}`);
            return true;
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

                // A cursor jump can stop the scan between windows; completed
                // windows have already been persisted by the callback above.
                const result = await analyzeDensityRange(words, onWindowComplete, signal);
                return result.completed !== false;
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

${SUMMARY_STYLE_GUARD}

${task.text.substring(0, 3000)}`;

                const { response } = await generateUnifiedCompletion(prompt, summarizerModel);

                const summary = sanitizeSummaryText(response);

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

        return true;
    }

    /**
     * Execute a global summary task - summarizes text across multiple chapters
     * for a book-level summary every X words.
     */
    private async executeGlobalSummaryTask(task: GlobalSummaryTask) {
        const db = await initDB();
        const bookDoc = await db.books.findOne(task.bookId).exec();
        if (!bookDoc) {
            console.log(`[Scheduler] Skipping global summary for deleted book ${task.bookId}`);
            return;
        }

        const settings = useSettingsStore.getState();
        const aiState = useAIStore.getState();
        const { summarizerModel } = settings;

        aiState.setCurrentTask({
            type: 'summary',
            chunkIndex: task.summaryIndex,
            totalChunks: 0,
            wordsProcessed: 0,
            totalWords: task.globalEndWordIndex - task.globalStartWordIndex,
        });
        aiState.setActivity(`Book Summary ${task.summaryIndex + 1}`, summarizerModel);
        aiState.startSummaryTiming();

        try {
            // Collect text from chapters spanning this summary range
            let collectedText = '';
            let globalWordsSeen = 0;
            const maxTextLength = 4000; // Characters limit for summary prompt

            for (const chapterId of bookDoc.chapterIds) {
                const chapter = await db.chapters.findOne(chapterId).exec();
                if (!chapter || !chapter.content || chapter.content.length === 0) continue;
                
                const chapterStartGlobal = globalWordsSeen;
                const chapterEndGlobal = globalWordsSeen + chapter.content.length;
                
                // Check if this chapter overlaps with our target range
                if (chapterEndGlobal > task.globalStartWordIndex && chapterStartGlobal < task.globalEndWordIndex) {
                    // Calculate which words from this chapter to include
                    const localStart = Math.max(0, task.globalStartWordIndex - chapterStartGlobal);
                    const localEnd = Math.min(chapter.content.length, task.globalEndWordIndex - chapterStartGlobal);
                    
                    const words = chapter.content.slice(localStart, localEnd);
                    collectedText += words.join(' ') + ' ';
                    
                    if (collectedText.length > maxTextLength) {
                        collectedText = collectedText.substring(0, maxTextLength);
                        break;
                    }
                }
                
                globalWordsSeen += chapter.content.length;
                if (globalWordsSeen >= task.globalEndWordIndex) break;
            }

            if (collectedText.trim().length === 0) {
                console.warn(`[Scheduler] No text collected for global summary ${task.id}`);
                return;
            }

            const summaryInstruction = settings.summaryPrompt || "Summarize the following text in 5 sentences.";
            const prompt = `${summaryInstruction}\n\n${SUMMARY_STYLE_GUARD}\n\n${collectedText.trim()}`;

            const { response } = await generateUnifiedCompletion(prompt, summarizerModel);
            const summary = sanitizeSummaryText(response);

            console.log(`[Scheduler] Global Summary ${task.summaryIndex} (${summary.length} chars):`, summary.substring(0, 200));

            // Save to book document
            await bookDoc.incrementalModify(doc => {
                const globalSummaries: GlobalSummaryType[] = [...(doc.globalSummaries || [])];
                
                // Find existing or add new
                const existingIndex = globalSummaries.findIndex(s => s.id === task.id);
                const summaryDoc: GlobalSummaryType = {
                    id: task.id,
                    startWordIndex: task.globalStartWordIndex,
                    endWordIndex: task.globalEndWordIndex,
                    startChapterId: task.startChapterId,
                    endChapterId: task.endChapterId,
                    summary,
                    generatedAt: Date.now()
                };
                
                if (existingIndex >= 0) {
                    globalSummaries[existingIndex] = summaryDoc;
                } else {
                    globalSummaries.push(summaryDoc);
                    // Sort by start index
                    globalSummaries.sort((a, b) => a.startWordIndex - b.startWordIndex);
                }
                
                return {
                    ...doc,
                    globalSummaries
                };
            });

            console.log(`[Scheduler] Saved global summary ${task.summaryIndex} to book ${task.bookId}`);

        } finally {
            aiState.completeSummaryTiming();
            aiState.setActivity(null);
            aiState.setCurrentTask(null);
        }
    }
}

export const scheduler = new IngestionScheduler();
