import type { AppConfig, InitProgressCallback, MLCEngineInterface } from "@mlc-ai/web-llm";
import { useAIStore } from "../store/ai";
import { createOperationHandle } from "../operations/progressReporter";
import { MODEL_INFO, MODEL_MAPPING, type ModelTier, type LogprobItem, type PromptLogprobsResult } from './modelManifest';

export { MODEL_INFO, MODEL_MAPPING } from './modelManifest';
export type { LogprobItem, ModelTier, PromptLogprobsResult } from './modelManifest';

type WebLLMModule = typeof import("@mlc-ai/web-llm");

let webLLMModulePromise: Promise<WebLLMModule> | null = null;

const loadWebLLM = (): Promise<WebLLMModule> => {
    webLLMModulePromise ??= import("@mlc-ai/web-llm");
    return webLLMModulePromise;
};

export const WEBLLM_ERROR_CODES = {
    STORAGE_QUOTA_EXCEEDED: "BROWSER_STORAGE_QUOTA_EXCEEDED",
    WEBGPU_LIMIT_UNSUPPORTED: "WEBGPU_LIMIT_UNSUPPORTED",
    WEBGPU_UNAVAILABLE: "WEBGPU_UNAVAILABLE",
} as const;

const REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 10;

interface MinimalGPUAdapter {
    limits: {
        maxStorageBuffersPerShaderStage?: number;
    };
}

interface MinimalGPU {
    requestAdapter: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<MinimalGPUAdapter | null>;
}

interface NormalizedWebLLMError {
    userMessage: string;
    propagatedError: Error;
}

let cachedCompatibilityError: Error | null | undefined;

const getNavigatorGPU = (): MinimalGPU | undefined => {
    if (typeof navigator === "undefined") return undefined;
    return (navigator as Navigator & { gpu?: MinimalGPU }).gpu;
};

const parseStorageBufferLimitError = (message: string): { requested: number; limit: number } | null => {
    const explicitCodeMatch = message.match(/^WEBGPU_LIMIT_UNSUPPORTED:requested=(\d+):limit=(\d+)$/);
    if (explicitCodeMatch) {
        return {
            requested: Number(explicitCodeMatch[1]),
            limit: Number(explicitCodeMatch[2]),
        };
    }

    const runtimeMatch = message.match(/maxStorageBuffersPerShaderStage\s+exceeds\s+limit\.\s+requested=(\d+),\s+limit=(\d+)/i);
    if (runtimeMatch) {
        return {
            requested: Number(runtimeMatch[1]),
            limit: Number(runtimeMatch[2]),
        };
    }

    return null;
};

const normalizeWebLLMError = (error: unknown): NormalizedWebLLMError => {
    const fallback = {
        userMessage: "Failed to load AI model.",
        propagatedError: new Error("Failed to load AI model."),
    };

    if (!(error instanceof Error)) {
        return fallback;
    }

    const message = error.message;

    if (
        message.includes("NS_ERROR_FILE_NO_DEVICE_SPACE")
        || message.includes("QuotaExceededError")
        || message === WEBLLM_ERROR_CODES.STORAGE_QUOTA_EXCEEDED
    ) {
        return {
            userMessage: "Browser storage quota exceeded. Please clear space or delete cached models.",
            propagatedError: new Error(WEBLLM_ERROR_CODES.STORAGE_QUOTA_EXCEEDED),
        };
    }

    const parsedLimit = parseStorageBufferLimitError(message);
    if (parsedLimit || message === WEBLLM_ERROR_CODES.WEBGPU_LIMIT_UNSUPPORTED) {
        const requested = parsedLimit?.requested ?? REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE;
        const limit = parsedLimit?.limit;
        const limitDetail = typeof limit === "number"
            ? ` (requested ${requested}, device limit ${limit})`
            : "";

        return {
            userMessage: `This browser's current WebGPU adapter exposes too few resources for on-device AI${limitDetail}.`,
            propagatedError: new Error(WEBLLM_ERROR_CODES.WEBGPU_LIMIT_UNSUPPORTED),
        };
    }

    if (
        message === WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE
        || message.includes("WebGPU is not supported")
        || message.includes("Cannot find WebGPU in the environment")
    ) {
        return {
            userMessage: "WebGPU is unavailable in this browser/device, so on-device AI cannot start.",
            propagatedError: new Error(WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE),
        };
    }

    return {
        userMessage: message || fallback.userMessage,
        propagatedError: error,
    };
};

const getCompatibilityError = async (): Promise<Error | null> => {
    if (cachedCompatibilityError !== undefined) {
        return cachedCompatibilityError;
    }

    const gpu = getNavigatorGPU();
    if (!gpu) {
        cachedCompatibilityError = new Error(WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE);
        return cachedCompatibilityError;
    }

    try {
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) {
            cachedCompatibilityError = new Error(WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE);
            return cachedCompatibilityError;
        }

        const maxStorageBuffersPerShaderStage = adapter.limits.maxStorageBuffersPerShaderStage;
        if (
            typeof maxStorageBuffersPerShaderStage === "number"
            && maxStorageBuffersPerShaderStage < REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
        ) {
            cachedCompatibilityError = new Error(
                `${WEBLLM_ERROR_CODES.WEBGPU_LIMIT_UNSUPPORTED}:requested=${REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE}:limit=${maxStorageBuffersPerShaderStage}`,
            );
            return cachedCompatibilityError;
        }

        cachedCompatibilityError = null;
        return null;
    } catch {
        cachedCompatibilityError = new Error(WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE);
        return cachedCompatibilityError;
    }
};

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

let engineInstance: MLCEngineInterface | null = null;
let workerInstance: Worker | null = null;
let currentLoadedModel: string | null = null;

/**
 * Downloads a model to cache without loading it into GPU memory.
 * Use this for pre-downloading models during initialization.
 */
export const downloadModelToCache = async (
    tier: ModelTier,
    onProgress?: (progress: number, text: string) => void
): Promise<void> => {
    const { CreateWebWorkerMLCEngine, hasModelInCache } = await loadWebLLM();
    const modelId = MODEL_MAPPING[tier];
    console.log(`[WebLLM] Downloading model to cache: ${tier} (${modelId})`);
    const { setProgress, setLoading, setError } = useAIStore.getState();
    const operation = createOperationHandle({
        kind: 'model-load',
        publish: (update) => {
            const progress = update.state === 'completed'
                ? 1
                : update.completed ?? 0;
            setProgress(update.message || update.phase, progress);
        },
    });
    
    // Check if already cached
    const isCached = await hasModelInCache(modelId, APP_CONFIG);
    if (isCached) {
        console.log(`[WebLLM] Model ${tier} already in cache, skipping download.`);
        operation.complete('Already cached');
        onProgress?.(1, 'Already cached');
        return;
    }

    const compatibilityError = await getCompatibilityError();
    if (compatibilityError) {
        const { userMessage, propagatedError } = normalizeWebLLMError(compatibilityError);
        operation.fail(propagatedError);
        setError(userMessage);
        throw propagatedError;
    }

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

        operation.report({
            kind: 'model-load',
            phase: displayStatus.includes('Downloading') ? 'download' : 'load',
            completed: report.progress,
            total: 1,
            message: `[${info.name}] (${info.size})${timeInfo} ${displayStatus}`,
            state: 'running',
        });
        onProgress?.(report.progress, cleanText);
    };

    try {
        // Create a temporary worker-backed engine just to download, then unload it.
        const tempWorker = new Worker(new URL('./localModel.worker.ts', import.meta.url), { type: 'module' });
        try {
            const tempEngine = await CreateWebWorkerMLCEngine(tempWorker, modelId, {
                initProgressCallback: progressCallback,
                appConfig: APP_CONFIG,
            });
            await tempEngine.unload();
            console.log(`[WebLLM] Model ${tier} downloaded and unloaded from memory.`);
        } finally {
            tempWorker.terminate();
        }
        operation.complete('Model downloaded and cached');
    } catch (error) {
        operation.fail(error);
        throw error;
    } finally {
        setLoading(false);
    }
};

export const getEngine = async (
    tier: ModelTier
): Promise<MLCEngineInterface> => {
    const { CreateWebWorkerMLCEngine, hasModelInCache } = await loadWebLLM();
    if (!MODEL_MAPPING[tier]) {
        throw new Error(`Invalid model tier: ${tier}`);
    }

    const modelId = MODEL_MAPPING[tier];
    if (engineInstance && currentLoadedModel === modelId) {
        return engineInstance;
    }

    const aiStore = useAIStore.getState();
    const { setProgress, setLoading, setReady, setError, setActiveModelName, startModelLoad, completeModelLoad, setLifecycleState } = aiStore;

    const compatibilityError = await getCompatibilityError();
    if (compatibilityError) {
        const { userMessage, propagatedError } = normalizeWebLLMError(compatibilityError);
        setError(userMessage);
        throw propagatedError;
    }

    console.log(`[WebLLM] Requesting engine for tier: ${tier} (Model ID: ${modelId})`);

    // Check if model is already in cache to determine lifecycle state
    const isCached = await hasModelInCache(modelId, APP_CONFIG);
    
    // Get model size from config
    const modelConfig = tier === 'tiny' ? TINYLLAMA_LOGPROBS_CONFIG : QWEN_LOGPROBS_CONFIG;
    const modelSizeBytes = modelConfig.vram_required_MB * 1024 * 1024;

    const operation = createOperationHandle({
        kind: 'model-load',
        publish: (update) => {
            const progress = update.state === 'completed'
                ? 1
                : update.completed ?? 0;
            setProgress(update.message || update.phase, progress);
        },
    });

    const onProgress: InitProgressCallback = (report) => {
        console.log(`[WebLLM] Init Progress: ${report.text} (${report.progress})`);
        const info = MODEL_INFO[tier];

        // Remove the verbose explanation text that WebLLM appends
        let cleanText = report.text.replace(". It can take a while when we first visit this page to populate the cache. Later refreshes will become faster.", "");

        // Better status messages to distinguish Cache vs Network
        // Also update lifecycle state based on what's happening
        if (cleanText.includes("Fetching")) {
            cleanText = "Downloading from Network";
            setLifecycleState('downloading');
        } else if (cleanText.includes("Loading model from cache")) {
            cleanText = "Loading into GPU Memory";
            setLifecycleState('loading');
        }

        operation.report({
            kind: 'model-load',
            phase: cleanText.includes('Downloading') ? 'download' : 'load',
            completed: report.progress,
            total: 1,
            message: `[${info.name}] ${cleanText}`,
            state: 'running',
        });
    };

    setLoading(true, tier);
    setReady(false);
    setError(null);
    
    // Start model load tracking
    startModelLoad(MODEL_INFO[tier].name, modelSizeBytes);
    
    // Set initial lifecycle state based on cache status
    if (isCached) {
        setLifecycleState('loading');
        setProgress(`[${MODEL_INFO[tier].name}] Warming up AI (Loading from Disk)...`, 0);
    } else {
        setLifecycleState('downloading');
        setProgress(`[${MODEL_INFO[tier].name}] Preparing to download...`, 0);
    }

    try {
        // When switching models, we need to unload and recreate the engine
        // because appConfig can only be set at creation time
        if (engineInstance) {
            console.log(`[WebLLM] Unloading current model to switch to: ${modelId}`);
            setLifecycleState('unloading');
            await engineInstance.unload();
            engineInstance = null;
        }
        workerInstance?.terminate();
        workerInstance = null;

        console.log(`[WebLLM] Creating worker-backed MLCEngine instance for: ${modelId}`);
        const nextWorker = new Worker(new URL('./localModel.worker.ts', import.meta.url), { type: 'module' });
        workerInstance = nextWorker;
        engineInstance = await CreateWebWorkerMLCEngine(nextWorker, modelId, {
            initProgressCallback: onProgress,
            appConfig: APP_CONFIG,
        });
        console.log(`[WebLLM] MLCEngine created successfully.`);
        
        currentLoadedModel = modelId;
        setReady(true);
        setActiveModelName(MODEL_INFO[tier].name);
        completeModelLoad(); // Mark loading as complete
        operation.complete('AI model ready');
        return engineInstance;
    } catch (error) {
        console.error("Failed to load WebLLM engine:", error);
        const { userMessage, propagatedError } = normalizeWebLLMError(error);
        workerInstance?.terminate();
        workerInstance = null;
        engineInstance = null;
        currentLoadedModel = null;
        operation.fail(propagatedError);
        setError(userMessage);
        throw propagatedError;
    } finally {
        setLoading(false);
    }
};

export const reloadModel = async (tier: ModelTier) => {
    if (engineInstance) {
        await engineInstance.unload();
    }
    workerInstance?.terminate();
    workerInstance = null;
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
    workerInstance?.terminate();
    workerInstance = null;
};

export const generateWebLLMCompletion = async (
    prompt: string,
    tier: ModelTier
): Promise<{ response: string, usage?: Record<string, unknown> }> => {
    const { setTPS, recordInference } = useAIStore.getState();
    const engine = await getEngine(tier);
    
    const start = performance.now();
    const reply = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
    });
    const end = performance.now();

    const usage = reply.usage as Record<string, unknown> | undefined;
    
    // Calculate TPS and record inference
    if (usage && typeof usage.completion_tokens === 'number') {
        const durationSec = (end - start) / 1000;
        if (durationSec > 0) {
            const tps = usage.completion_tokens / durationSec;
            setTPS(Math.round(tps * 100) / 100);
        }
    }
    
    recordInference(); // Track inference count

    return {
        response: reply.choices[0].message.content || "",
        usage
    };
};

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
    tier: ModelTier,
    engineOverride?: MLCEngineInterface,
): Promise<PromptLogprobsResult> => {
    // Determine which engine to use
    // If 'tier' maps to a specific model ID, getEngine will load it.
    // NOTE: This causes a reload if the engine is different.
    const engine = engineOverride ?? await getEngine(tier);
    
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
        return {
            status: 'unavailable',
            items: [],
            reason: 'empty-response',
        };
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

    return {
        status: 'available',
        items: result,
    };
};

export const isModelCached = async (tier: ModelTier): Promise<boolean> => {
    const { hasModelInCache } = await loadWebLLM();
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
    const { deleteModelAllInfoInCache } = await loadWebLLM();
    const modelId = MODEL_MAPPING[tier];
    await deleteModelAllInfoInCache(modelId);
};
