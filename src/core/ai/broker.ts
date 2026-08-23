import PQueue from 'p-queue';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import {
    deleteModel as deleteCachedModel,
    downloadModelToCache as downloadCachedModel,
    getEngine,
    isModelCached as isCachedModel,
    reloadModel,
    unloadCurrentModel,
} from './webllm';
import { type ModelTier, type PromptLogprobsResult } from './modelManifest';
import { isLocalAIFeatureEnabled, type LocalAIFeature } from './policy';
import { useAIStore } from '../store/ai';
import { useSettingsStore } from '../store/settings';

export interface LocalAIRequestOptions {
    feature?: LocalAIFeature;
    modelTier: ModelTier;
    priority?: number;
    dedupeKey?: string;
    signal?: AbortSignal;
}

export class LocalAIFeatureDisabledError extends Error {
    constructor(feature: LocalAIFeature) {
        super(`Local AI feature is disabled: ${feature}`);
        this.name = 'LocalAIFeatureDisabledError';
    }
}

export type LocalModelHost = Pick<MLCEngineInterface, 'interruptGenerate'> & {
    chat: Pick<MLCEngineInterface['chat'], 'completions'>;
};

const createAbortError = (): Error => {
    const error = new Error('Local AI request aborted');
    error.name = 'AbortError';
    return error;
};

const isUnsupportedLogprobError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (message.includes('logprob') || message.includes('log-prob'))
        && (message.includes('unsupported') || message.includes('not supported') || message.includes('not implemented'));
};

class LocalAIBroker {
    private readonly queue = new PQueue({ concurrency: 1 });
    private readonly inFlight = new Map<string, Promise<unknown>>();

    private ensureNotAborted(signal?: AbortSignal): void {
        if (signal?.aborted) throw createAbortError();
    }

    async prepareModel(tier: ModelTier): Promise<void> {
        await this.queue.add(async () => {
            await getEngine(tier);
        }, { priority: 100 });
    }

    async execute<T>(
        options: LocalAIRequestOptions,
        task: (host: LocalModelHost, signal?: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const settings = useSettingsStore.getState();
        if (options.feature && !isLocalAIFeatureEnabled(settings, options.feature)) {
            throw new LocalAIFeatureDisabledError(options.feature);
        }

        if (options.dedupeKey) {
            const existing = this.inFlight.get(options.dedupeKey);
            if (existing) return await existing as T;
        }

        const request = this.queue.add(async () => {
            this.ensureNotAborted(options.signal);
            const engine = await getEngine(options.modelTier);
            this.ensureNotAborted(options.signal);
            const aiStore = useAIStore.getState();
            const previousState = aiStore.lifecycleState;
            const abortHandler = () => engine.interruptGenerate();
            const host: LocalModelHost = {
                chat: engine.chat,
                interruptGenerate: engine.interruptGenerate.bind(engine),
            };
            options.signal?.addEventListener('abort', abortHandler, { once: true });

            try {
                return await task(host, options.signal);
            } finally {
                options.signal?.removeEventListener('abort', abortHandler);
                if (previousState !== useAIStore.getState().lifecycleState) {
                    aiStore.setLifecycleState(previousState);
                }
            }
        }, { priority: options.priority ?? 0 });

        const dedupeKey = options.dedupeKey;
        if (dedupeKey) {
            this.inFlight.set(dedupeKey, request);
            request.finally(() => {
                if (this.inFlight.get(dedupeKey) === request) {
                    this.inFlight.delete(dedupeKey);
                }
            }).catch(() => undefined);
        }

        return await request;
    }

    async getPromptLogprobs(
        text: string,
        modelTier: ModelTier,
        signal?: AbortSignal,
    ): Promise<PromptLogprobsResult> {
        return await this.execute(
            {
                feature: 'pacing',
                modelTier,
                signal,
                priority: 70,
                dedupeKey: `pacing-logprobs:${modelTier}:${text}`,
            },
            async (engine) => {
                let response: {
                    input_tokens?: string[];
                    input_logprobs?: number[];
                };
                try {
                    response = await engine.chat.completions.create({
                        messages: [{ role: 'user', content: text }],
                        max_tokens: 1,
                        return_input_logprobs: true,
                    }) as unknown as {
                        input_tokens?: string[];
                        input_logprobs?: number[];
                    };
                } catch (error) {
                    if (isUnsupportedLogprobError(error)) {
                        return {
                            status: 'unavailable',
                            items: [],
                            reason: 'runtime-not-supported',
                        };
                    }
                    throw error;
                }
                if (!response.input_tokens || !response.input_logprobs || response.input_tokens.length === 0) {
                    return {
                        status: 'unavailable',
                        items: [],
                        reason: 'empty-response',
                    };
                }
                return {
                    status: 'available',
                    items: response.input_tokens.map((token, index) => ({
                        token,
                        logprob: response.input_logprobs?.[index] ?? 0,
                    })),
                };
            },
        );
    }

    async reload(tier: ModelTier): Promise<void> {
        await this.queue.add(async () => await reloadModel(tier), { priority: 100 });
    }

    async unload(): Promise<void> {
        await this.queue.add(async () => await unloadCurrentModel(), { priority: 100 });
    }

    async download(
        tier: ModelTier,
        onProgress?: (progress: number, text: string) => void,
    ): Promise<void> {
        await this.queue.add(async () => await downloadCachedModel(tier, onProgress), { priority: 90 });
    }

    async isCached(tier: ModelTier): Promise<boolean> {
        return await isCachedModel(tier);
    }

    async deleteCached(tier: ModelTier): Promise<void> {
        await this.queue.add(async () => await deleteCachedModel(tier), { priority: 100 });
    }
}

export const localAIBroker = new LocalAIBroker();
