import { generateWebLLMCompletion, getEngine, type ModelTier, getPromptLogprobs as getWebLLMPromptLogprobs, type LogprobItem, reloadModel as reloadWebLLM } from './webllm';
import { useSettingsStore } from '../store/settings';

export const checkAIHealth = async (modelTier?: ModelTier): Promise<boolean> => {
    const { llmModel } = useSettingsStore.getState();
    const targetModel = modelTier || (llmModel as ModelTier);

    // For WebLLM, we assume it's healthy if we can load the engine.
    // But loading might take time.
    // We can try to get the engine, which will trigger loading if needed.
    try {
        await getEngine(targetModel);
        return true;
    } catch (e) {
        console.error("WebLLM Health Check Failed:", e);
        return false;
    }
};

export const reloadModel = async (modelTier?: ModelTier): Promise<void> => {
    const { llmModel } = useSettingsStore.getState();
    const targetModel = modelTier || (llmModel as ModelTier);
    await reloadWebLLM(targetModel);
};

export interface AICompletionResult {
    response: string;
    metrics?: Record<string, unknown>;
}

export const generateUnifiedCompletion = async (prompt: string, modelTier?: ModelTier): Promise<{ response: string, metrics?: Record<string, unknown> }> => {
    const { llmModel } = useSettingsStore.getState();
    const targetModel = modelTier || (llmModel as ModelTier);

    const result = await generateWebLLMCompletion(prompt, targetModel);
    return { response: result.response, metrics: result.usage };
};

export const getPromptLogprobs = async (text: string, modelTier?: ModelTier): Promise<LogprobItem[]> => {
    const { llmModel } = useSettingsStore.getState();
    const targetModel = modelTier || (llmModel as ModelTier);
    return await getWebLLMPromptLogprobs(text, targetModel);
};
