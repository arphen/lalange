import { describe, expect, it } from 'vitest';
import {
    getTTSDefaultVoice,
    getTTSFallbackCandidates,
    registerTTSModelPlugin,
    type TTSModelPlugin,
} from './modelRegistry';
import type { VoiceInfo } from './engine';

const preferredVoice: VoiceInfo = {
    id: 'preferred',
    name: 'Preferred',
    engine: 'kokoro',
    gender: 'female',
    language: 'en-US',
    languageLabel: 'American English',
    flag: 'US',
    quality: 'A',
};

const candidate = (id: string): VoiceInfo => ({
    ...preferredVoice,
    id,
    name: id,
    engine: 'piper',
    quality: 'B',
});

const availableVoices = [preferredVoice, candidate('candidate-a'), candidate('candidate-b')];

const register = (plugin: TTSModelPlugin): (() => void) => registerTTSModelPlugin({
    ...plugin,
    id: `test-${plugin.id}`,
});

describe('TTS model registry', () => {
    it('orders fallback candidates by plugin priority', () => {
        const removeLowPriority = register({
            id: 'low',
            priority: 1,
            getFallbackCandidates: () => [candidate('candidate-a')],
        });
        const removeHighPriority = register({
            id: 'high',
            priority: 10,
            getFallbackCandidates: () => [candidate('candidate-b')],
        });

        try {
            expect(getTTSFallbackCandidates(preferredVoice, availableVoices).map((voice) => voice.id)).toEqual([
                'candidate-b',
                'candidate-a',
            ]);
        } finally {
            removeHighPriority();
            removeLowPriority();
        }
    });

    it('deduplicates candidates while retaining the highest-priority order', () => {
        const removeLowPriority = register({
            id: 'low-dedupe',
            priority: 1,
            getFallbackCandidates: () => [candidate('candidate-a'), candidate('candidate-b')],
        });
        const removeHighPriority = register({
            id: 'high-dedupe',
            priority: 10,
            getFallbackCandidates: () => [candidate('candidate-a')],
        });

        try {
            expect(getTTSFallbackCandidates(preferredVoice, availableVoices).map((voice) => voice.id)).toEqual([
                'candidate-a',
                'candidate-b',
            ]);
        } finally {
            removeHighPriority();
            removeLowPriority();
        }
    });

    it('selects the first available default from the highest-priority plugin', () => {
        const removeLowPriority = register({
            id: 'low-default',
            priority: 1,
            getDefaultVoice: () => 'candidate-a',
        });
        const removeHighPriority = register({
            id: 'high-default',
            priority: 10,
            getDefaultVoice: () => 'candidate-b',
        });

        try {
            expect(getTTSDefaultVoice(availableVoices)).toBe('candidate-b');
        } finally {
            removeHighPriority();
            removeLowPriority();
        }
    });

    it('ignores defaults that are absent from the available voice list', () => {
        const removePlugin = register({
            id: 'missing-default',
            getDefaultVoice: () => 'missing',
        });

        try {
            expect(getTTSDefaultVoice(availableVoices)).toBeUndefined();
        } finally {
            removePlugin();
        }
    });

    it('removes a plugin without affecting other registrations', () => {
        const removeKept = register({
            id: 'kept',
            getFallbackCandidates: () => [candidate('candidate-b')],
        });
        const removeDeleted = register({
            id: 'deleted',
            getFallbackCandidates: () => [candidate('candidate-a')],
        });

        removeDeleted();
        try {
            expect(getTTSFallbackCandidates(preferredVoice, availableVoices).map((voice) => voice.id)).toEqual([
                'candidate-b',
            ]);
        } finally {
            removeKept();
        }
    });
});
