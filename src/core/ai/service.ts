import { localAIBroker } from './broker';
import { type LocalAIFeature } from './policy';
import { type ModelTier, MODEL_MAPPING, type PromptLogprobsResult } from './modelManifest';
import { useAIStore } from '../store/ai';
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
        await localAIBroker.prepareModel(targetModel);
        return true;
    } catch (e) {
        console.error("WebLLM Health Check Failed:", e);
        return false;
    }
};

export const reloadModel = async (modelTier?: ModelTier): Promise<void> => {
    const targetModel = resolveModelTier(modelTier);
    await localAIBroker.reload(targetModel);
};

export interface AICompletionResult {
    response: string;
    metrics?: Record<string, unknown>;
}

export const generateUnifiedCompletion = async (
    prompt: string,
    modelTier?: ModelTier,
    feature?: LocalAIFeature,
): Promise<{ response: string, metrics?: Record<string, unknown> }> => {
    const targetModel = resolveModelTier(modelTier);

    return await localAIBroker.execute(
        { feature, modelTier: targetModel },
        async (engine) => {
            const start = performance.now();
            const reply = await engine.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
            });
            const end = performance.now();
            const usage = reply.usage as Record<string, unknown> | undefined;
            const completionTokens = usage?.completion_tokens;
            if (typeof completionTokens === 'number' && end > start) {
                useAIStore.getState().setTPS(Math.round((completionTokens / ((end - start) / 1000)) * 100) / 100);
            }
            useAIStore.getState().recordInference();
            return {
                response: reply.choices[0]?.message.content || '',
                metrics: usage,
            };
        },
    );
};

export const getPromptLogprobs = async (text: string, modelTier?: ModelTier): Promise<PromptLogprobsResult> => {
    const targetModel = resolveModelTier(modelTier);
    return await localAIBroker.getPromptLogprobs(text, targetModel);
};
