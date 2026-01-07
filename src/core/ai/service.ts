import { generateWebLLMCompletion, getEngine, type ModelTier, getPromptLogprobs as getWebLLMPromptLogprobs, type LogprobItem, reloadModel as reloadWebLLM, MODEL_MAPPING } from './webllm';
import { useSettingsStore } from '../store/settings';

const resolveModelTier = (tier?: ModelTier): ModelTier => {
    const { llmModel } = useSettingsStore.getState();
    if (tier) return tier;
    
    // Safety check for legacy settings
    // Check if the string value of llmModel is a valid key in MODEL_MAPPING
    if (Object.prototype.hasOwnProperty.call(MODEL_MAPPING, llmModel)) {
        return llmModel as ModelTier;
    }
    
    return 'tiny';
};

export const checkAIHealth = async (modelTier?: ModelTier): Promise<boolean> => {
    const targetModel = resolveModelTier(modelTier);

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
    const targetModel = resolveModelTier(modelTier);
    await reloadWebLLM(targetModel);
};

export interface AICompletionResult {
    response: string;
    metrics?: Record<string, unknown>;
}

export const generateUnifiedCompletion = async (prompt: string, modelTier?: ModelTier): Promise<{ response: string, metrics?: Record<string, unknown> }> => {
    const targetModel = resolveModelTier(modelTier);

    const result = await generateWebLLMCompletion(prompt, targetModel);
    return { response: result.response, metrics: result.usage };
};

export const getPromptLogprobs = async (text: string, modelTier?: ModelTier): Promise<LogprobItem[]> => {
    const targetModel = resolveModelTier(modelTier);
    return await getWebLLMPromptLogprobs(text, targetModel);
};
