import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDensityRange } from './pipeline';
import { getPromptLogprobs } from '../ai/service';

// Mock dependencies
vi.mock('../ai/service', () => ({
    checkAIHealth: vi.fn().mockResolvedValue(true),
    generateUnifiedCompletion: vi.fn(),
    getPromptLogprobs: vi.fn(),
}));

describe('analyzeDensityRange (Forward Pass)', () => {
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

    it('should calculate density based on logprobs', async () => {
        // Mock logprobs
        // "hello" -> logprob -0.1 (Surprisal 0.1 -> Very Low -> Factor 0.6)
        // "world" -> logprob -10.0 (Surprisal 10.0 -> High -> Factor 2.0)
        const mockLogprobs = [
            { token: 'hello', logprob: -0.1 },
            { token: ' world', logprob: -10.0 }
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);

        const words = ['hello', 'world'];
        const densities = await analyzeDensityRange(words);

        expect(densities.length).toBe(2);
        expect(densities[0]).toBe(0.6); // Very Low surprisal
        expect(densities[1]).toBe(2.0); // High surprisal
    });

    it('should handle structural multipliers', async () => {
        // "hello." -> logprob -0.1 (Surprisal 0.1 -> Factor 0.6)
        // Punctuation multipliers are REMOVED in pipeline (handled by Reader)
        // Length < 12 -> 1.0
        // Final = 0.6 * 1.0 = 0.6
        const mockLogprobs = [
            { token: 'hello', logprob: -0.1 },
            { token: '.', logprob: -0.1 }
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);

        const words = ['hello.'];
        const densities = await analyzeDensityRange(words);

        expect(densities[0]).toBe(0.6);
    });
    
    it('should align tokens to words correctly', async () => {
        // "simple text"
        // Tokens: ["sim", "ple", " text"]
        // "simple": logprob -1 + -1 = -2 (Surprisal 2 -> Factor 0.8)
        // "text": logprob -0.1 (Surprisal 0.1 -> Factor 0.6)
        
        const mockLogprobs = [
            { token: 'sim', logprob: -1.0 },
            { token: 'ple', logprob: -1.0 },
            { token: ' text', logprob: -0.1 }
        ];
        vi.mocked(getPromptLogprobs).mockResolvedValue(mockLogprobs);
        
        const words = ['simple', 'text'];
        const densities = await analyzeDensityRange(words);
        
        expect(densities[0]).toBe(0.8); // simple
        expect(densities[1]).toBe(0.6); // text
    });
});

