import type { ModelTier } from './modelManifest';

export type TextRepairMode = 'off' | 'review' | 'auto-safe';

export interface LocalAIFeatureSettings {
    adaptivePacingEnabled: boolean;
    textRepairMode: TextRepairMode;
    summariesEnabled: boolean;
    ttsAnnotationsEnabled: boolean;
    structureStrategyId: string;
    repairModelId: ModelTier;
}

export type LocalAIFeature = 'pacing' | 'repair' | 'structure' | 'summary' | 'tts-annotation';

export const DEFAULT_LOCAL_AI_FEATURE_SETTINGS: LocalAIFeatureSettings = {
    adaptivePacingEnabled: false,
    textRepairMode: 'review',
    summariesEnabled: false,
    ttsAnnotationsEnabled: false,
    structureStrategyId: 'auto-deterministic',
    repairModelId: 'qwen',
};

interface LegacyPacingSettings {
    adaptivePacingEnabled?: boolean;
    aiEnabled?: boolean;
}

export const isAdaptivePacingEnabled = (settings: LegacyPacingSettings): boolean => (
    settings.adaptivePacingEnabled === true || settings.aiEnabled === true
);

export const isTextRepairEnabled = (settings: Pick<LocalAIFeatureSettings, 'textRepairMode'>): boolean => (
    settings.textRepairMode !== 'off'
);

export const isLocalAIFeatureEnabled = (
    settings: LegacyPacingSettings & Partial<LocalAIFeatureSettings>,
    feature: LocalAIFeature,
): boolean => {
    switch (feature) {
        case 'pacing':
            return isAdaptivePacingEnabled(settings);
        case 'repair':
            return settings.textRepairMode !== undefined && isTextRepairEnabled(settings as Pick<LocalAIFeatureSettings, 'textRepairMode'>);
        case 'summary':
            return settings.summariesEnabled === true;
        case 'tts-annotation':
            return settings.ttsAnnotationsEnabled === true;
        case 'structure':
            return settings.structureStrategyId === 'ai-assisted-candidates';
    }
};
