import { CreateMLCEngine, MLCEngine, type InitProgressCallback, hasModelInCache, deleteModelAllInfoInCache, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { useAIStore } from "../store/ai";

export const MODEL_INFO = {
    tiny: {
        id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
        name: "Tiny (Llama 3.2 1B)",
        size: "600 MB",
        description: "Fastest, low memory. Good for basic tasks."
    },
    balanced: {
        id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
        name: "Balanced (Llama 3.2 3B)",
        size: "1.8 GB",
        description: "Best trade-off between speed and quality."
    },
    pro: {
        id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
        name: "Pro (Mistral 7B)",
        size: "4.1 GB",
        description: "High quality, requires more memory."
    },
    creative: {
        id: "gemma-2-9b-it-q4f16_1-MLC",
        name: "The Prose King (Gemma 2 9B)",
        size: "5.7 GB",
        description: "Writes better summaries. Tighter context (8k)."
    },
    reliable: {
        id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
        name: "The Safe Backup (Llama 3.1 8B)",
        size: "4.6 GB",
        description: "Faster than Gemma, slightly more robotic."
    }
} as const;

export const MODEL_MAPPING = {
    tiny: MODEL_INFO.tiny.id,
    balanced: MODEL_INFO.balanced.id,
    pro: MODEL_INFO.pro.id,
    creative: MODEL_INFO.creative.id,
    reliable: MODEL_INFO.reliable.id
} as const;

export type ModelTier = keyof typeof MODEL_MAPPING;

let engineInstance: MLCEngine | null = null;
let currentLoadedModel: string | null = null;

export const getEngine = async (
    tier: ModelTier
): Promise<MLCEngine> => {
    if (!MODEL_MAPPING[tier]) {
        throw new Error(`Invalid model tier: ${tier}`);
    }

    const modelId = MODEL_MAPPING[tier];
    const { setProgress, setLoading, setReady, setError, setActiveModelName } = useAIStore.getState();
    const startTime = Date.now();

    const onProgress: InitProgressCallback = (report) => {
        const info = MODEL_INFO[tier];
        let timeInfo = "";

        if (report.progress > 0.01 && report.progress < 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const estimatedTotal = elapsed / report.progress;
            const remaining = estimatedTotal - elapsed;

            if (remaining > 0 && isFinite(remaining)) {
                const mins = Math.floor(remaining / 60);
                const secs = Math.floor(remaining % 60);
                timeInfo = ` [ETA: ${mins > 0 ? `${mins}m ` : ''}${secs}s]`;
            }
        }

        // Remove the verbose explanation text that WebLLM appends
        const cleanText = report.text.replace(". It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.", "");

        setProgress(`[${info.name}] (${info.size})${timeInfo} ${cleanText}`, report.progress);
    };

    if (engineInstance && currentLoadedModel === modelId) {
        return engineInstance;
    }

    setLoading(true, tier); // Pass tier as the loading model name
    setReady(false);
    setError(null);

    try {
        // Check if model is already in cache to update UI state immediately
        const isCached = await hasModelInCache(modelId);
        if (isCached) {
            setProgress(`[${MODEL_INFO[tier].name}] Verifying cache...`, 0);
        }

        if (!engineInstance) {
            engineInstance = await CreateMLCEngine(modelId, { 
                initProgressCallback: onProgress,
                appConfig: {
                    ...prebuiltAppConfig,
                    useIndexedDBCache: true,
                }
            });
        } else {
            await engineInstance.reload(modelId);
        }
        currentLoadedModel = modelId;
        setReady(true);
        setActiveModelName(MODEL_INFO[tier].name);
        return engineInstance;
    } catch (error) {
        console.error("Failed to load WebLLM engine:", error);
        let errorMessage = "Failed to load AI model.";
        
        // Check for storage quota error
        if (error instanceof Error) {
            if (error.message.includes("NS_ERROR_FILE_NO_DEVICE_SPACE") || error.message.includes("QuotaExceededError")) {
                errorMessage = "Browser storage quota exceeded. Please clear space or delete cached models.";
            } else {
                errorMessage = error.message;
            }
        }
        
        setError(errorMessage);
        throw error;
    } finally {
        setLoading(false);
    }
};

export const reloadModel = async (tier: ModelTier) => {
    if (engineInstance) {
        await engineInstance.unload();
    }
    engineInstance = null;
    currentLoadedModel = null;
    await getEngine(tier);
};

export const unloadCurrentModel = async () => {
    if (engineInstance) {
        await engineInstance.unload();
        engineInstance = null;
        currentLoadedModel = null;
    }
};

export const generateWebLLMCompletion = async (
    prompt: string,
    tier: ModelTier
): Promise<{ response: string, usage?: Record<string, unknown> }> => {
    const { setTPS } = useAIStore.getState();
    const engine = await getEngine(tier);
    
    const start = performance.now();
    const reply = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
    });
    const end = performance.now();

    const usage = reply.usage as Record<string, unknown> | undefined;
    
    // Calculate TPS
    if (usage && typeof usage.completion_tokens === 'number') {
        const durationSec = (end - start) / 1000;
        if (durationSec > 0) {
            const tps = usage.completion_tokens / durationSec;
            setTPS(Math.round(tps * 100) / 100);
        }
    }

    return {
        response: reply.choices[0].message.content || "",
        usage
    };
};

export interface LogprobItem {
    token: string;
    logprob: number;
    bytes?: number[] | null;
    top_logprobs?: LogprobItem[];
    content?: string;
}

export const getPromptLogprobs = async (
    text: string,
    tier: ModelTier
): Promise<LogprobItem[]> => {
    const engine = await getEngine(tier);
    
    // Configure request for "Read-Only" analysis (Forward Pass)
    const reply = await engine.chat.completions.create({
        messages: [{ role: "user", content: text }],
        max_tokens: 1,       // Force immediate stop after prompt processing
        logprobs: true,      // Enable log probability calculation
        top_logprobs: 1,     // We only need the score of the actual token
        // @ts-expect-error - Pass the prompt_logprobs flag to vLLM/MLC backend
        extra_body: { prompt_logprobs: true }
    });

    // Access the prompt logprobs from the response
    // Note: The location of prompt_logprobs depends on the specific API implementation
    // It might be in `prompt_logprobs` at the root, or inside `choices` if using standard OpenAI format with a twist.
    // Based on vLLM documentation, it's often a top-level field or part of the usage/debug info.
    // We'll try to find it.
    
    const rawReply = reply as unknown as { prompt_logprobs?: LogprobItem[], choices?: { logprobs?: { content?: LogprobItem[] } }[] };
    if (rawReply.prompt_logprobs) {
        return rawReply.prompt_logprobs;
    }
    
    // Fallback: check if it's in choices (unlikely for prompt logprobs but possible)
    if (rawReply.choices?.[0]?.logprobs?.content) {
         // This is usually for generated tokens, but let's return it if nothing else
         return rawReply.choices[0].logprobs.content;
    }

    return [];
};

export const isModelCached = async (tier: ModelTier): Promise<boolean> => {
    const modelId = MODEL_MAPPING[tier];
    return await hasModelInCache(modelId);
};

export const getModelShardInfo = async (tier: ModelTier): Promise<{ completed: number, total: number }> => {
    const modelId = MODEL_MAPPING[tier];
    try {
        const cacheKeys = await caches.keys();
        // WebLLM typically uses the modelId as the cache name, or prefixed
        const cacheName = cacheKeys.find(k => k === modelId || k === `webllm/${modelId}`);
        
        if (!cacheName) {
             return { completed: 0, total: 0 };
        }
        
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        
        // Look for ndarray-cache.json to determine total shards
        const configReq = keys.find(k => k.url.endsWith("ndarray-cache.json"));
        let total = 0;
        
        if (configReq) {
            const resp = await cache.match(configReq);
            if (resp) {
                const data = await resp.json();
                if (Array.isArray(data.records)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    total = data.records.filter((r: any) => r.name.includes("params_shard_")).length;
                }
            }
        }
        
        // Count how many params_shard_*.bin are in the cache
        const completed = keys.filter(k => k.url.includes("params_shard_")).length;
        
        return { completed, total };
        
    } catch (e) {
        console.warn("Failed to inspect cache for model", modelId, e);
        return { completed: 0, total: 0 };
    }
};

export const deleteModel = async (tier: ModelTier): Promise<void> => {
    const modelId = MODEL_MAPPING[tier];
    await deleteModelAllInfoInCache(modelId);
};
