import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDensityRange } from './analysis';
import { getPromptLogprobs } from '../ai/service';

// Mock dependencies
vi.mock('../ai/service', () => ({
    checkAIHealth: vi.fn().mockResolvedValue(true),
    generateUnifiedCompletion: vi.fn(),
    getPromptLogprobs: vi.fn(),
}));

describe('analyzeDensityRange (Percentile-Based)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return default densities if LLM fails', async () => {
        vi.mocked(getPromptLogprobs).mockRejectedValue(new Error('LLM Error'));
        const words = ['hello', 'world'];
        const densities = await analyzeDensityRange(words);
        // Default factor 1.0
        expect(densities).toEqual([1.0, 1.0]);
    });

    it('should produce variation using percentile-based scoring', async () => {
        // Mock logprobs with varying surprisal levels
        // Word 1: "the" -> very predictable (logprob -0.1, surprisal 0.1)
        // Word 2: "cat" -> medium (logprob -1.0, surprisal 1.0)
        // Word 3: "ephemeral" -> surprising (logprob -5.0, surprisal 5.0)
        const mockLogprobs = [
            { token: 'the', logprob: -0.1 },
            { token: ' cat', logprob: -1.0 },
            { token: ' ephemeral', logprob: -5.0 }
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);

        const words = ['the', 'cat', 'ephemeral'];
        const densities = await analyzeDensityRange(words);

        expect(densities.length).toBe(3);
        // "the" should be faster than "ephemeral"
        expect(densities[0]).toBeLessThan(densities[2]);
        // All should be different (percentile-based guarantees variation)
        expect(densities[0]).not.toBe(densities[1]);
    });

    it('should handle structural multipliers for long words', async () => {
        // Two words with same surprisal but different lengths
        const mockLogprobs = [
            { token: 'cat', logprob: -1.0 },
            { token: ' extraordinarily', logprob: -1.0 } // 15 chars -> 1.3x multiplier
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);

        const words = ['cat', 'extraordinarily'];
        const densities = await analyzeDensityRange(words);

        // Long word should have higher density due to structural multiplier
        expect(densities[1]).toBeGreaterThan(densities[0]);
    });
    
    it('should align tokens to words correctly', async () => {
        // "simple text" split into sub-word tokens
        // "simple": tokens ["sim", "ple"] with logprobs -1, -1 -> surprisal 2
        // "text": token [" text"] with logprob -0.1 -> surprisal 0.1
        const mockLogprobs = [
            { token: 'sim', logprob: -1.0 },
            { token: 'ple', logprob: -1.0 },
            { token: ' text', logprob: -0.1 }
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);
        
        const words = ['simple', 'text'];
        const densities = await analyzeDensityRange(words);
        
        expect(densities.length).toBe(2);
        // "simple" (surprisal 2.0) should be slower than "text" (surprisal 0.1)
        expect(densities[0]).toBeGreaterThan(densities[1]);
    });
});

