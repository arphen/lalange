import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getEngine: vi.fn(),
    reloadModel: vi.fn(),
    unloadCurrentModel: vi.fn(),
    downloadModelToCache: vi.fn(),
    isModelCached: vi.fn(),
    deleteModel: vi.fn(),
    setLifecycleState: vi.fn(),
    settings: {
        adaptivePacingEnabled: true,
        aiEnabled: true,
        textRepairMode: 'off',
        summariesEnabled: false,
        ttsAnnotationsEnabled: false,
        structureStrategyId: 'auto-deterministic',
        repairModelId: 'qwen',
    },
}));

vi.mock('./webllm', () => ({
    getEngine: mocks.getEngine,
    reloadModel: mocks.reloadModel,
    unloadCurrentModel: mocks.unloadCurrentModel,
    downloadModelToCache: mocks.downloadModelToCache,
    isModelCached: mocks.isModelCached,
    deleteModel: mocks.deleteModel,
}));

vi.mock('../store/settings', () => ({
    useSettingsStore: {
        getState: () => mocks.settings,
    },
}));

vi.mock('../store/ai', () => ({
    useAIStore: {
        getState: () => ({
            lifecycleState: 'ready',
            setLifecycleState: mocks.setLifecycleState,
        }),
    },
}));

describe('LocalAIBroker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.adaptivePacingEnabled = true;
        mocks.settings.aiEnabled = true;
        mocks.settings.textRepairMode = 'off';
        mocks.settings.summariesEnabled = false;
        mocks.getEngine.mockResolvedValue({
            interruptGenerate: vi.fn(),
        });
    });

    it('does not load a model for a disabled feature', async () => {
        const { localAIBroker, LocalAIFeatureDisabledError } = await import('./broker');
        mocks.settings.adaptivePacingEnabled = false;
        mocks.settings.aiEnabled = false;

        await expect(localAIBroker.execute(
            { feature: 'pacing', modelTier: 'tiny' },
            async () => 'unreachable',
        )).rejects.toBeInstanceOf(LocalAIFeatureDisabledError);
        expect(mocks.getEngine).not.toHaveBeenCalled();
    });

    it('deduplicates requests with the same key', async () => {
        const { localAIBroker } = await import('./broker');
        const task = vi.fn(async () => 'completed');

        const results = await Promise.all([
            localAIBroker.execute(
                { feature: 'pacing', modelTier: 'tiny', dedupeKey: 'book-1:chapter-1' },
                task,
            ),
            localAIBroker.execute(
                { feature: 'pacing', modelTier: 'tiny', dedupeKey: 'book-1:chapter-1' },
                task,
            ),
        ]);

        expect(results).toEqual(['completed', 'completed']);
        expect(mocks.getEngine).toHaveBeenCalledTimes(1);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it('does not start an engine request after cancellation', async () => {
        const { localAIBroker } = await import('./broker');
        const controller = new AbortController();
        controller.abort();

        await expect(localAIBroker.execute(
            { feature: 'pacing', modelTier: 'tiny', signal: controller.signal },
            async () => 'unreachable',
        )).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.getEngine).not.toHaveBeenCalled();
    });

    it('returns an explicit unavailable result when input logprobs are unsupported', async () => {
        const { localAIBroker } = await import('./broker');
        mocks.getEngine.mockResolvedValue({
            interruptGenerate: vi.fn(),
            chat: {
                completions: {
                    create: vi.fn().mockRejectedValue(new Error('return_input_logprobs is not supported')),
                },
            },
        });

        await expect(localAIBroker.getPromptLogprobs('text', 'tiny')).resolves.toEqual({
            status: 'unavailable',
            items: [],
            reason: 'runtime-not-supported',
        });
    });
});
