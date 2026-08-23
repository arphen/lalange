export interface ModelInfo {
    id: string;
    name: string;
    size: string;
    description: string;
    vramRequiredMB: number;
}

export const MODEL_INFO = {
    tiny: {
        id: 'TinyLlama-1.1B-logprobs',
        name: 'TinyLlama (Logprobs)',
        size: '700 MB',
        description: 'Standard 1.1B model.',
        vramRequiredMB: 700,
    },
    qwen: {
        id: 'Qwen2.5-1.5B-logprobs',
        name: 'Qwen 2.5 1.5B (Logprobs)',
        size: '980 MB',
        description: 'Higher quality 1.5B model.',
        vramRequiredMB: 1200,
    },
} satisfies Record<string, ModelInfo>;

export const MODEL_MAPPING = {
    tiny: MODEL_INFO.tiny.id,
    qwen: MODEL_INFO.qwen.id,
} as const;

export type ModelTier = keyof typeof MODEL_MAPPING;

export const PACING_MODEL_TIER: ModelTier = 'tiny';

export interface LogprobItem {
    token: string;
    logprob: number;
    bytes?: number[] | null;
    top_logprobs?: LogprobItem[];
    content?: string;
}

export type PromptLogprobsResult =
    | {
        status: 'available';
        items: LogprobItem[];
    }
    | {
        status: 'unavailable';
        items: [];
        reason: 'runtime-not-supported' | 'empty-response';
    };
