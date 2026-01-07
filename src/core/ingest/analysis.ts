import PQueue from 'p-queue';
import { getPromptLogprobs } from '../ai/service';
import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';

// Queue for LLM processing (concurrency: 1)
export const analysisQueue = new PQueue({ concurrency: 1 });

export interface AnalysisResult {
    densities: number[];
    analysisData: { tokens: string[], surprisals: number[] }[];
}

export const analyzeDensityRange = async (words: string[]): Promise<AnalysisResult> => {
    const { librarianModelTier, pacingSensitivity } = useSettingsStore.getState();
    const WINDOW_SIZE = 250;

    console.log(`[Analysis] analyzeDensityRange called for ${words.length} words. Tier: ${librarianModelTier}. Window: ${WINDOW_SIZE}`);

    try {
        const rawSurprisals: number[] = [];
        const analysisData: { tokens: string[], surprisals: number[] }[] = [];

        // Process in chunks of WINDOW_SIZE
        for (let i = 0; i < words.length; i += WINDOW_SIZE) {
            const chunkWords = words.slice(i, i + WINDOW_SIZE);
            const chunkText = chunkWords.join(' ');

            const logprobs = await analysisQueue.add(async () => {
                useAIStore.getState().setActivity(`Scanning Density (Chunk ${Math.floor(i / WINDOW_SIZE) + 1})`, librarianModelTier);
                console.log(`[Analysis] Analyzing density for chunk ${i}-${i + chunkWords.length} (${chunkWords.length} words)...`);
                try {
                    return await getPromptLogprobs(chunkText, librarianModelTier);
                } finally {
                    useAIStore.getState().setActivity(null);
                }
            });

            if (!logprobs || logprobs.length === 0) {
                console.warn('[Analysis] No logprobs returned for chunk. Using default density.');
                rawSurprisals.push(...new Array(chunkWords.length).fill(0)); 
                analysisData.push(...new Array(chunkWords.length).fill({ tokens: [], surprisals: [] }));
                continue;
            }

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
                rawSurprisals.push(-wordLogprob);
                analysisData.push({ tokens: wordTokens, surprisals: wordSurprisals });
            }
            
            // Fill if mismatch in this chunk
            while (rawSurprisals.length < i + chunkWords.length) {
                rawSurprisals.push(0);
                analysisData.push({ tokens: [], surprisals: [] });
            }
        }

        // === PHASE 2: Calculate percentiles for relative scoring ===
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

        // === PHASE 3: Map each word to density factor using percentiles ===
        const sensitivityMult = (pacingSensitivity ?? 50) / 50;
        const densities: number[] = [];

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const surprisal = rawSurprisals[i];

            // Percentile-based density factor
            // This ensures variation regardless of model's baseline perplexity
            let densityFactor = 1.0;
            if (surprisal <= p10) densityFactor = 0.6;        // Bottom 10% → Fast
            else if (surprisal <= p30) densityFactor = 0.8;   // 10-30% → Brisk
            else if (surprisal <= p50) densityFactor = 1.0;   // 30-50% → Normal
            else if (surprisal <= p70) densityFactor = 1.2;   // 50-70% → Deliberate
            else if (surprisal <= p90) densityFactor = 1.5;   // 70-90% → Slow
            else densityFactor = 2.0;                          // Top 10% → Very Slow

            // Apply sensitivity multiplier (amplifies the deviation from 1.0)
            // At sensitivity 50 → no change, at 100 → double the deviation
            const deviation = densityFactor - 1.0;
            const adjustedFactor = 1.0 + (deviation * sensitivityMult);

            // Note: Structural/Visual penalties (length) are now handled in the Reader/Timing engine
            // to separate "Information Density" (LLM) from "Visual Density" (Oculomotor).
            const finalScore = adjustedFactor;
            const clamped = Math.max(0.5, Math.min(5.0, finalScore));

            // Debug log for tuning (sample 1%)
            if (Math.random() < 0.01) {
                console.log(`[Density] "${word}" Surp: ${surprisal.toFixed(2)} → Factor: ${clamped.toFixed(2)}`);
            }

            densities.push(clamped);
        }

        return { densities, analysisData };

    } catch (e) {
        console.warn('LLM failed for density analysis (Forward Pass)', e);
        return { 
            densities: new Array(words.length).fill(1.0), 
            analysisData: new Array(words.length).fill({ tokens: [], surprisals: [] })
        };
    }
};

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
