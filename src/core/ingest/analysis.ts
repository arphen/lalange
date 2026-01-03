import PQueue from 'p-queue';
import { getPromptLogprobs } from '../ai/service';
import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';

// Queue for LLM processing (concurrency: 1)
export const analysisQueue = new PQueue({ concurrency: 1 });

export const analyzeDensityRange = async (words: string[]): Promise<number[]> => {
    const text = words.join(' ');
    const { librarianModelTier, pacingSensitivity } = useSettingsStore.getState();

    console.log(`[Analysis] analyzeDensityRange called for ${words.length} words. Tier: ${librarianModelTier}`);

    try {
        const logprobs = await analysisQueue.add(async () => {
            useAIStore.getState().setActivity('Scanning Density (Forward Pass)', librarianModelTier);
            console.log(`[Analysis] Analyzing density for ${words.length} words using Forward Pass...`);
            try {
                return await getPromptLogprobs(text, librarianModelTier);
            } finally {
                useAIStore.getState().setActivity(null);
            }
        });

        if (!logprobs || logprobs.length === 0) {
            console.warn('[Analysis] No logprobs returned from Forward Pass. Using default density.');
            return new Array(words.length).fill(1.0);
        }

        // === PHASE 1: Extract raw surprisal for each word ===
        const rawSurprisals: number[] = [];
        let tokenIdx = 0;

        for (const word of words) {
            let wordLogprob = 0;
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
                tokenIdx++;

                const normReconstructed = reconstructedWord.replace(/\s/g, '');
                const normWord = word.replace(/\s/g, '');

                if (normReconstructed.length >= normWord.length) {
                    break;
                }
            }

            // Surprisal = -logprob (higher = more unexpected)
            rawSurprisals.push(-wordLogprob);
        }

        // Fill if mismatch
        while (rawSurprisals.length < words.length) {
            rawSurprisals.push(0);
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

            // Apply structural multipliers (word length)
            let structuralMultiplier = 1.0;
            if (word.length > 12) structuralMultiplier = 1.3;
            else if (word.length > 8) structuralMultiplier = 1.1;

            const finalScore = structuralMultiplier * adjustedFactor;
            const clamped = Math.max(0.5, Math.min(5.0, finalScore));

            // Debug log for tuning (sample 1%)
            if (Math.random() < 0.01) {
                console.log(`[Density] "${word}" Surp: ${surprisal.toFixed(2)} → Factor: ${clamped.toFixed(2)}`);
            }

            densities.push(clamped);
        }

        return densities;

    } catch (e) {
        console.warn('LLM failed for density analysis (Forward Pass)', e);
        return new Array(words.length).fill(1.0);
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
