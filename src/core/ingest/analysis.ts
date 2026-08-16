import PQueue from 'p-queue';
import { getPromptLogprobs } from '../ai/service';
import { PACING_MODEL_TIER } from '../ai/webllm';
import { createOperationHandle } from '../operations/progressReporter';
import { useAIStore } from '../store/ai';
import { useSettingsStore } from '../store/settings';

// Queue for LLM processing (concurrency: 1)
export const analysisQueue = new PQueue({ concurrency: 1 });

export interface AnalysisResult {
    densities: number[];
    analysisData: { tokens: string[], surprisals: number[] }[];
    completed: boolean;
}

export interface WindowResult {
    startIndex: number;
    densities: number[];
    analysisData: { tokens: string[], surprisals: number[] }[];
}

/**
 * Callback for incremental density updates.
 * Called after each 250-word window is processed with the densities for that window.
 */
export type OnWindowComplete = (result: WindowResult) => Promise<void>;

/**
 * Analyze density for a range of words, calling onWindowComplete after each window.
 * This allows incremental saves to DB so the reader can start immediately.
 */
export const analyzeDensityRange = async (
    words: string[],
    onWindowComplete?: OnWindowComplete,
    signal?: AbortSignal,
): Promise<AnalysisResult> => {
    const WINDOW_SIZE = 250;
    const operation = createOperationHandle({
        kind: 'analysis',
        publish: (update) => {
            const aiStore = useAIStore.getState();
            if (update.message) {
                aiStore.setActivity(update.message, PACING_MODEL_TIER);
            }
            if (typeof update.completed === 'number' && typeof update.total === 'number') {
                aiStore.updateTaskProgress(update.completed, update.total);
            }
        },
    });

    console.log(`[Analysis] analyzeDensityRange called for ${words.length} words. Tier: ${PACING_MODEL_TIER}. Window: ${WINDOW_SIZE}`);

    try {
        const rawSurprisals: number[] = [];
        const analysisData: { tokens: string[], surprisals: number[] }[] = [];

        // Process in chunks of WINDOW_SIZE
        for (let i = 0; i < words.length; i += WINDOW_SIZE) {
            if (signal?.aborted) {
                console.log(`[Analysis] Density scan interrupted after ${rawSurprisals.length}/${words.length} words.`);
                break;
            }

            const chunkWords = words.slice(i, i + WINDOW_SIZE);
            const chunkText = chunkWords.join(' ');
            
            // Track window-level results for incremental save
            const windowRawSurprisals: number[] = [];
            const windowAnalysisData: { tokens: string[], surprisals: number[] }[] = [];
            const chunkNum = Math.floor(i / WINDOW_SIZE) + 1;
            const totalChunks = Math.ceil(words.length / WINDOW_SIZE);

            operation.report({
                kind: 'analysis',
                phase: 'window',
                completed: i,
                total: words.length,
                message: `Scanning Density (Window ${chunkNum}/${totalChunks})`,
                state: 'running',
            });

            const logprobs = await analysisQueue.add(async () => {
                console.log(`[Analysis] Analyzing density for chunk ${i}-${i + chunkWords.length} (${chunkWords.length} words)...`);
                return await getPromptLogprobs(chunkText, PACING_MODEL_TIER);
            });

            if (!logprobs || logprobs.length === 0) {
                console.warn('[Analysis] No logprobs returned for chunk. Using default density.');
                for (let j = 0; j < chunkWords.length; j++) {
                    windowRawSurprisals.push(0);
                    windowAnalysisData.push({ tokens: [], surprisals: [] });
                }
            } else {
                // === PHASE 1: Extract raw surprisal for each word in this chunk ===
                let tokenIdx = 0;

                for (const word of chunkWords) {
                    let wordLogprob = 0;
                    const wordTokens: string[] = [];
                    const wordSurprisals: number[] = [];
                    let reconstructedWord = "";

                    while (tokenIdx < logprobs.length) {
                        const item = logprobs[tokenIdx];
                        let tokenText = "";
                        let logprob = 0;

                        if (typeof item === 'object' && item !== null) {
                            if (item.token) tokenText = item.token;
                            else if (item.content) tokenText = item.content || "";
                            if (item.logprob !== undefined) logprob = item.logprob;
                        }

                        reconstructedWord += tokenText;
                        wordLogprob += logprob;
                        
                        wordTokens.push(tokenText);
                        wordSurprisals.push(-logprob);

                        tokenIdx++;

                        const normReconstructed = reconstructedWord.replace(/\s/g, '');
                        const normWord = word.replace(/\s/g, '');

                        if (normReconstructed.length >= normWord.length) {
                            break;
                        }
                    }

                    // Surprisal = -logprob (higher = more unexpected)
                    windowRawSurprisals.push(-wordLogprob);
                    windowAnalysisData.push({ tokens: wordTokens, surprisals: wordSurprisals });
                }
                
                // Fill if mismatch in this chunk
                while (windowRawSurprisals.length < chunkWords.length) {
                    windowRawSurprisals.push(0);
                    windowAnalysisData.push({ tokens: [], surprisals: [] });
                }
            }
            
            // Add to cumulative arrays
            rawSurprisals.push(...windowRawSurprisals);
            analysisData.push(...windowAnalysisData);
            
            // Calculate window-level densities using local percentiles
            // This provides immediate, usable densities even before all windows complete
            const windowDensities = calculateDensitiesFromSurprisals(
                windowRawSurprisals, 
                chunkWords, 
                useSettingsStore.getState().pacingSensitivity ?? 50
            );
            
            // Call the incremental save callback
            if (onWindowComplete) {
                await onWindowComplete({
                    startIndex: i,
                    densities: windowDensities,
                    analysisData: windowAnalysisData,
                });
            }
            
            // Update progress after window completion
            operation.report({
                kind: 'analysis',
                phase: 'window',
                completed: i + chunkWords.length,
                total: words.length,
                message: `Scanning Density (Window ${chunkNum}/${totalChunks})`,
                state: 'running',
            });
        }

        // === PHASE 2: Calculate final percentiles for relative scoring across ALL words ===
        if (rawSurprisals.length === 0) {
            if (signal?.aborted) {
                operation.cancel();
            } else {
                operation.complete('No words to analyze');
            }
            return { densities: [], analysisData: [], completed: words.length === 0 };
        }

        const sortedSurprisals = [...rawSurprisals].sort((a, b) => a - b);
        const getPercentile = (p: number) => {
            const idx = Math.floor((p / 100) * (sortedSurprisals.length - 1));
            return sortedSurprisals[idx];
        };

        const p10 = getPercentile(10);
        const p30 = getPercentile(30);
        const p50 = getPercentile(50);
        const p70 = getPercentile(70);
        const p90 = getPercentile(90);

        console.log(`[Analysis] Surprisal Percentiles: P10=${p10.toFixed(2)} P30=${p30.toFixed(2)} P50=${p50.toFixed(2)} P70=${p70.toFixed(2)} P90=${p90.toFixed(2)}`);

        // === PHASE 3: Map each word to density factor using global percentiles ===
        const sensitivityMult = (useSettingsStore.getState().pacingSensitivity ?? 50) / 50;
        const densities: number[] = [];

        for (let i = 0; i < rawSurprisals.length; i++) {
            const word = words[i];
            const surprisal = rawSurprisals[i];

            // Percentile-based density factor
            let densityFactor: number;
            if (surprisal <= p10) densityFactor = 0.6;
            else if (surprisal <= p30) densityFactor = 0.8;
            else if (surprisal <= p50) densityFactor = 1.0;
            else if (surprisal <= p70) densityFactor = 1.2;
            else if (surprisal <= p90) densityFactor = 1.5;
            else densityFactor = 2.0;

            const deviation = densityFactor - 1.0;
            const adjustedFactor = 1.0 + (deviation * sensitivityMult);
            const clamped = Math.max(0.5, Math.min(5.0, adjustedFactor));

            if (Math.random() < 0.01) {
                console.log(`[Density] "${word}" Surp: ${surprisal.toFixed(2)} → Factor: ${clamped.toFixed(2)}`);
            }

            densities.push(clamped);
        }

        if (signal?.aborted) {
            operation.cancel();
        } else {
            operation.complete('Density analysis complete');
        }

        return {
            densities,
            analysisData,
            completed: rawSurprisals.length === words.length,
        };

    } catch (e) {
        console.warn('LLM failed for density analysis (Forward Pass)', e);
        if (signal?.aborted) {
            operation.cancel();
        } else {
            operation.fail(e);
        }
        const defaultAnalysisData = [];
        for (let i = 0; i < words.length; i++) {
            defaultAnalysisData.push({ tokens: [], surprisals: [] });
        }
        return { 
            densities: new Array(words.length).fill(1.0), 
            analysisData: defaultAnalysisData,
            completed: !signal?.aborted,
        };
    }
};

/**
 * Calculate densities from raw surprisals using percentile-based scoring.
 * Used for incremental window-level density calculation.
 */
function calculateDensitiesFromSurprisals(
    rawSurprisals: number[], 
    _words: string[], 
    sensitivity: number
): number[] {
    if (rawSurprisals.length === 0) return [];
    
    const sortedSurprisals = [...rawSurprisals].sort((a, b) => a - b);
    const getPercentile = (p: number) => {
        const idx = Math.floor((p / 100) * (sortedSurprisals.length - 1));
        return sortedSurprisals[Math.max(0, idx)];
    };

    const p10 = getPercentile(10);
    const p30 = getPercentile(30);
    const p50 = getPercentile(50);
    const p70 = getPercentile(70);
    const p90 = getPercentile(90);

    const sensitivityMult = sensitivity / 50;
    const densities: number[] = [];

    for (let i = 0; i < rawSurprisals.length; i++) {
        const surprisal = rawSurprisals[i];

        let densityFactor: number;
        if (surprisal <= p10) densityFactor = 0.6;
        else if (surprisal <= p30) densityFactor = 0.8;
        else if (surprisal <= p50) densityFactor = 1.0;
        else if (surprisal <= p70) densityFactor = 1.2;
        else if (surprisal <= p90) densityFactor = 1.5;
        else densityFactor = 2.0;

        const deviation = densityFactor - 1.0;
        const adjustedFactor = 1.0 + (deviation * sensitivityMult);
        const clamped = Math.max(0.5, Math.min(5.0, adjustedFactor));

        densities.push(clamped);
    }

    return densities;
}

export const chunkText = (text: string, maxWords: number): string[] => {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
        currentChunk.push(word);

        // Break if we exceed maxWords AND we are at a sentence boundary
        if (currentChunk.length >= maxWords && word.match(/[.!?]["']?$/)) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
        }
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }
    return chunks;
};
