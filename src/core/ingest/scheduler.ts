import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { initDB } from '../sync/db';
import { analyzeDensityRange } from './analysis';
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
        // potentially load saved state? For now, in-memory.
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
                
                // Distance from current word
                const distance = task.startWordIndex - this.currentWordIndex;
                const settings = useSettingsStore.getState();
                const chunkSize = settings.summaryChunkSize || 2500;
                
                if (distance < 0) {
                    // Passed chunk. 
                    // If it's SUMMARY, we still need it (for review).
                    // If it's DENSITY, we might not need it as much if we already read it? 
                    // But we want to fill the map.
                    score += 100; 
                } else if (distance === 0 || (distance > 0 && distance < chunkSize)) {
                    // Current Chunk
                    score += 2000;
                } else {
                    // Future Chunk - closer is better
                    // Max words ~100k. 
                    score += 1000 - (distance / 100);
                }
            } else if (!this.currentBookId) {
                // No cursor set yet - use task order (lower subchapterIndex first)
                score = 1000 - task.subchapterIndex;
            } else {
                // Different chapter. 
                // We'd need chapter indexes to know if it's next or prev.
                // For now, give a generic low score, but higher than other books.
                score += 500;
            }

            // 3. Task Type Priority
            // Density > Summary (Start reading > Finish reading)
            if (task.type === 'DENSITY') {
                score += 50;
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
            aiState.setActivity(`Scanning Density (Chunk ${task.subchapterIndex + 1})`, pacingModelTier);
            
            try {
                // Split text into words for density analysis
                const words = task.text.trim().split(/\s+/);
                const { densities, analysisData } = await analyzeDensityRange(words);

                // Save to DB
                const chapter = await db.chapters.findOne(task.chapterId).exec();
                if (chapter) {
                    await chapter.incrementalModify(doc => {
                        const currentDensities = [...(doc.densities || [])];
                        // Safety: ensure analysisData array exists
                        const currentAnalysisData = [...(doc.analysisData || [])];
                        
                        // Splice in the new densities
                        // We need to be careful about indices. 
                        // The task.startWordIndex should align with the chapter content.
                        for (let i = 0; i < densities.length; i++) {
                            if (task.startWordIndex + i < currentDensities.length) {
                                currentDensities[task.startWordIndex + i] = densities[i];
                                // We also need to grow the analysisData array if needed because it wasn't pre-filled with 0s like densities
                                // Actually, chapter content logic in pipeline.ts pre-fills densities with 0s. 
                                // It does NOT pre-fill analysisData. So we might be pushing or assigning.
                                // However, incrementalPatch in pipeline.ts only initialized densities.
                                // So assume analysisData might be shorter. 
                                // Wait, simple assignment at index works in JS arrays (it fills holes), but we want to be clean.
                                currentAnalysisData[task.startWordIndex + i] = analysisData[i];
                            }
                        }
                        return {
                            ...doc,
                            densities: currentDensities,
                            analysisData: currentAnalysisData
                        };
                    });
                }
            } finally {
                aiState.setActivity(null);
            }
        } 
        
        else if (task.type === 'SUMMARY') {
            const { summarizerModel, summarizerBasePrompt, summarizerFragments, enableJunkRemoval } = settings;
            aiState.setActivity(`Summarizing (Chunk ${task.subchapterIndex + 1})`, summarizerModel);

            try {
                const summaryFragmentText = summarizerFragments.filter(f => f.enabled).map(f => f.text).join('\n');
                const summarySystemPrompt = `${summarizerBasePrompt}\n${summaryFragmentText}`;
                const specificSummaryInstruction = settings.summaryPrompt || "Summarize the following text in 5 sentences.";

                let prompt = '';
                if (enableJunkRemoval) {
                    prompt = `
${summarySystemPrompt}

Analyze the following text segment from a book.
Task:
1. Determine if this text is "CONTENT" (narrative, story, useful info) or "JUNK" (copyright page, table of contents, list of image references, empty space, or just garbage).
2. If CONTENT, provide a short "title" (max 5 words) and a "summary" based on this instruction: "${specificSummaryInstruction}".
3. If JUNK, return status "JUNK".

OUTPUT JSON ONLY:
{
  "status": "CONTENT" | "JUNK",
  "title": "...",
  "summary": "..."
}

TEXT:
${task.text.substring(0, 3000)}
`;
                } else {
                    prompt = `
${summarySystemPrompt}

Analyze the following text segment from a book.
Task:
1. Provide a short "title" (max 5 words) and a "summary" based on this instruction: "${specificSummaryInstruction}".

OUTPUT JSON ONLY:
{
  "status": "CONTENT",
  "title": "...",
  "summary": "..."
}

TEXT:
${task.text.substring(0, 3000)}
`;
                }

                const { response } = await generateUnifiedCompletion(prompt, summarizerModel);
                
                let title = `Part ${task.subchapterIndex + 1}`;
                let summary = '';
                let isJunk = false;

                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        if (enableJunkRemoval && parsed.status === 'JUNK') {
                            isJunk = true;
                        } else {
                            title = parsed.title || title;
                            summary = parsed.summary || '';
                        }
                    } catch (e) {
                        console.warn("Failed to parse summary JSON", e);
                    }
                }

                // Save to DB
                const chapter = await db.chapters.findOne(task.chapterId).exec();
                if (chapter) {
                    await chapter.incrementalModify(doc => {
                        const subchapters = [...(doc.subchapters || [])];
                        if (subchapters[task.subchapterIndex]) {
                            subchapters[task.subchapterIndex] = {
                                ...subchapters[task.subchapterIndex],
                                title: isJunk ? "SKIPPED (JUNK)" : title,
                                summary: isJunk ? "Content identified as non-narrative junk." : summary
                            };
                        }
                        
                        // If Junk, we might want to zero out densities or mark them?
                        // For now, let's just leave them.
                        
                        return {
                            ...doc,
                            subchapters
                        };
                    });
                }

            } finally {
                aiState.setActivity(null);
            }
        }
    }
}

export const scheduler = new IngestionScheduler();
