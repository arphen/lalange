import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ loaded: false }));

vi.mock('@mlc-ai/web-llm', () => {
    runtime.loaded = true;

    return {
        hasModelInCache: vi.fn().mockResolvedValue(true),
    };
});

describe('WebLLM runtime loading', () => {
    beforeEach(() => {
        runtime.loaded = false;
        vi.resetModules();
    });

    it('loads the runtime only when an AI operation requests it', async () => {
        const webllm = await import('./webllm');

        expect(webllm.MODEL_INFO.tiny.name).toBe('TinyLlama (Logprobs)');
        expect(runtime.loaded).toBe(false);

        await expect(webllm.isModelCached('tiny')).resolves.toBe(true);
        expect(runtime.loaded).toBe(true);
    });
});