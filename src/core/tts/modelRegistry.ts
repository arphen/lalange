import type { VoiceInfo } from './engine';

export interface TTSModelPlugin {
    id: string;
    priority?: number;
    getDefaultVoice?: (availableVoices: readonly VoiceInfo[]) => string | undefined;
    getFallbackCandidates?: (
        preferredVoice: VoiceInfo,
        availableVoices: readonly VoiceInfo[],
    ) => readonly VoiceInfo[];
}

const modelPlugins: TTSModelPlugin[] = [];

export function registerTTSModelPlugin(plugin: TTSModelPlugin): () => void {
    const existingIndex = modelPlugins.findIndex((registered) => registered.id === plugin.id);
    if (existingIndex >= 0) modelPlugins.splice(existingIndex, 1);
    modelPlugins.push(plugin);
    modelPlugins.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

    return () => {
        const index = modelPlugins.indexOf(plugin);
        if (index >= 0) modelPlugins.splice(index, 1);
    };
}

export function getTTSDefaultVoice(availableVoices: readonly VoiceInfo[]): string | undefined {
    for (const plugin of modelPlugins) {
        const voiceId = plugin.getDefaultVoice?.(availableVoices);
        if (voiceId && availableVoices.some((voice) => voice.id === voiceId)) return voiceId;
    }
    return undefined;
}

export function getTTSFallbackCandidates(
    preferredVoice: VoiceInfo,
    availableVoices: readonly VoiceInfo[],
): VoiceInfo[] {
    const candidates: VoiceInfo[] = [];
    const seenVoiceIds = new Set<string>();

    for (const plugin of modelPlugins) {
        for (const candidate of plugin.getFallbackCandidates?.(preferredVoice, availableVoices) ?? []) {
            if (seenVoiceIds.has(candidate.id)) continue;
            seenVoiceIds.add(candidate.id);
            candidates.push(candidate);
        }
    }

    return candidates;
}