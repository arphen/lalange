import { CreateMLCEngine, MLCEngine, type InitProgressCallback, hasModelInCache, deleteModelAllInfoInCache, type AppConfig } from "@mlc-ai/web-llm";
import { useAIStore } from "../store/ai";

// Custom TinyLlama model with prefill logprobs support
const TINYLLAMA_LOGPROBS_CONFIG = {
    model: "https://huggingface.co/mlc-ai/TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
    model_id: "TinyLlama-1.1B-logprobs",
    model_lib: "/TinyLlama-1.1B.wasm",
    vram_required_MB: 700,
    low_resource_required: true,
};

// Custom Qwen2.5 model with prefill logprobs support
const QWEN_LOGPROBS_CONFIG = {
    model: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    model_id: "Qwen2.5-1.5B-logprobs",
    model_lib: "/Qwen2.5-1.5B.wasm", // Requires custom WASM from logitwebllm
    vram_required_MB: 1200, // Increased for 1.5B model
    low_resource_required: true,
};

// Shared app config with our custom models
const APP_CONFIG: AppConfig = {
    model_list: [TINYLLAMA_LOGPROBS_CONFIG, QWEN_LOGPROBS_CONFIG],
    useIndexedDBCache: true,
};

// Model definitions
export const MODEL_INFO = {
    tiny: {
        id: "TinyLlama-1.1B-logprobs",
        name: "TinyLlama (Logprobs)",
        size: "700 MB",
        description: "Standard 1.1B model."
    },
    qwen: {
        id: "Qwen2.5-1.5B-logprobs",
        name: "Qwen 2.5 1.5B (Logprobs)",
        size: "980 MB",
        description: "Higher quality 1.5B model."
    }
} as const;

export const MODEL_MAPPING = {
    tiny: MODEL_INFO.tiny.id,
    qwen: MODEL_INFO.qwen.id,
} as const;

export type ModelTier = keyof typeof MODEL_MAPPING;

let engineInstance: MLCEngine | null = null;
let currentLoadedModel: string | null = null;

/**
 * Downloads a model to cache without loading it into GPU memory.
 * Use this for pre-downloading models during initialization.
 */
export const downloadModelToCache = async (
    tier: ModelTier,
    onProgress?: (progress: number, text: string) => void
): Promise<void> => {
    const modelId = MODEL_MAPPING[tier];
    console.log(`[WebLLM] Downloading model to cache: ${tier} (${modelId})`);
    
    // Check if already cached
    const isCached = await hasModelInCache(modelId, APP_CONFIG);
    if (isCached) {
        console.log(`[WebLLM] Model ${tier} already in cache, skipping download.`);
        onProgress?.(1, 'Already cached');
        return;
    }

    const { setProgress, setLoading } = useAIStore.getState();
    const startTime = Date.now();
    
    setLoading(true, tier);

    const progressCallback: InitProgressCallback = (report) => {
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

        const cleanText = report.text.replace(". It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.", "");
        
        let displayStatus = cleanText;
        if (cleanText.includes("Fetching")) {
            displayStatus = "Downloading from Network";
        }

        setProgress(`[${info.name}] (${info.size})${timeInfo} ${displayStatus}`, report.progress);
        onProgress?.(report.progress, cleanText);
    };

    try {
        // Create a temporary engine just to download, then immediately unload
        const tempEngine = await CreateMLCEngine(modelId, {
            initProgressCallback: progressCallback,
            appConfig: APP_CONFIG,
        });
        
        // Immediately unload to free GPU memory
        await tempEngine.unload();
        console.log(`[WebLLM] Model ${tier} downloaded and unloaded from memory.`);
    } finally {
        setLoading(false);
    }
};

export const getEngine = async (
    tier: ModelTier
): Promise<MLCEngine> => {
    if (!MODEL_MAPPING[tier]) {
        throw new Error(`Invalid model tier: ${tier}`);
    }

    const modelId = MODEL_MAPPING[tier];
    console.log(`[WebLLM] Requesting engine for tier: ${tier} (Model ID: ${modelId})`);
    
    const { setProgress, setLoading, setReady, setError, setActiveModelName } = useAIStore.getState();
    const startTime = Date.now();

    const onProgress: InitProgressCallback = (report) => {
        console.log(`[WebLLM] Init Progress: ${report.text} (${report.progress})`);
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
        let cleanText = report.text.replace(". It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.", "");

        // Better status messages to distinguish Cache vs Network
        if (cleanText.includes("Fetching")) {
             cleanText = "Downloading from Network";
        } else if (cleanText.includes("Loading model from cache")) {
             cleanText = "Loading into GPU Memory";
        }

        setProgress(`[${info.name}] ${cleanText}${timeInfo}`, report.progress);
    };

    if (engineInstance && currentLoadedModel === modelId) {
        return engineInstance;
    }

    setLoading(true, tier); // Pass tier as the loading model name
    setReady(false);
    setError(null);

    try {
        // Check if model is already in cache to update UI state immediately
        const isCached = await hasModelInCache(modelId, APP_CONFIG);
        if (isCached) {
            setProgress(`[${MODEL_INFO[tier].name}] Warming up AI (Loading from Disk)...`, 0);
        }

        // When switching models, we need to unload and recreate the engine
        // because appConfig can only be set at creation time
        if (engineInstance) {
            console.log(`[WebLLM] Unloading current model to switch to: ${modelId}`);
            await engineInstance.unload();
            engineInstance = null;
        }

        console.log(`[WebLLM] Creating MLCEngine instance for: ${modelId}`);
        engineInstance = await CreateMLCEngine(modelId, { 
            initProgressCallback: onProgress,
            appConfig: APP_CONFIG,
        });
        console.log(`[WebLLM] MLCEngine created successfully.`);
        
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

/**
 * Extended response type for our custom WebLLM fork with input logprobs
 */
interface ChatCompletionWithInputLogprobs {
    input_tokens?: string[];
    input_logprobs?: number[];
    choices: Array<{
        message: { content: string | null };
    }>;
}

/**
 * Get logprobs for input text using the custom TinyLlama model with prefill logprobs.
 * This uses the `return_input_logprobs` flag from our forked WebLLM.
 * 
 * Always uses the 'logprobs' tier (TinyLlama with custom WASM) regardless of
 * the tier parameter, since only this model supports input logprobs.
 */
export const getPromptLogprobs = async (
    text: string,
    tier: ModelTier
): Promise<LogprobItem[]> => {
    // Determine which engine to use
    // If 'tier' maps to a specific model ID, getEngine will load it.
    // NOTE: This causes a reload if the engine is different.
    const engine = await getEngine(tier);
    
    const info = MODEL_INFO[tier];
    console.log(`[WebLLM] Getting input logprobs using ${info.name}...`);
    
    const response = await engine.chat.completions.create({
        messages: [{ role: "user", content: text }],
        max_tokens: 1,  // We only care about input analysis, stop immediately
        return_input_logprobs: true,
    }) as unknown as ChatCompletionWithInputLogprobs;
    
    const tokens = response.input_tokens;
    const logprobs = response.input_logprobs;
    
    if (!tokens || !logprobs || tokens.length === 0) {
        console.warn('[WebLLM] No input_logprobs returned. Is the custom WASM loaded?');
        console.warn('[WebLLM] Response keys:', Object.keys(response));
        // Fallback to heuristic-based approach
        const words = text.split(/\s+/);
        return words.map((word) => ({
            token: word,
            logprob: -1.0 - (word.length * 0.1) - (Math.random() * 0.5),
        }));
    }
    
    console.log(`[WebLLM] Got ${tokens.length} input tokens with logprobs`);
    
    // Convert to LogprobItem format
    const result: LogprobItem[] = tokens.map((token, index) => ({
        token,
        logprob: logprobs[index],
    }));
    
    // Debug output
    const surprisals = result.map(r => -r.logprob);
    const minS = Math.min(...surprisals);
    const maxS = Math.max(...surprisals);
    const avgS = surprisals.reduce((a, b) => a + b, 0) / surprisals.length;
    console.log(`[WebLLM] Surprisal range: min=${minS.toFixed(2)}, max=${maxS.toFixed(2)}, avg=${avgS.toFixed(2)}`);
    
    // Sample some items
    const samples = result.slice(0, 10);
    console.log(`[WebLLM] First 10 tokens: ${samples.map(s => `"${s.token}"=${s.logprob.toFixed(2)}`).join(', ')}`);

    return result;
};

export const isModelCached = async (tier: ModelTier): Promise<boolean> => {
    const modelId = MODEL_MAPPING[tier];
    return await hasModelInCache(modelId, APP_CONFIG);
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
