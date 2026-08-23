import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeCommonPhraseRankLimit, useSettingsStore } from './settings';

describe('settings defaults', () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    });

    it('keeps optional AI features off for new users', () => {
        const defaults = useSettingsStore.getInitialState();

        expect(defaults.aiEnabled).toBe(false);
        expect(defaults.summariesEnabled).toBe(false);
    });

    it('defaults common phrase grouping to off and normalizes setter values', () => {
        const defaults = useSettingsStore.getInitialState();
        expect(defaults.commonPhraseRankLimit).toBe(0);

        defaults.setCommonPhraseRankLimit(137);
        expect(useSettingsStore.getState().commonPhraseRankLimit).toBe(140);
        defaults.setCommonPhraseRankLimit(999);
        expect(useSettingsStore.getState().commonPhraseRankLimit).toBe(500);
        defaults.setCommonPhraseRankLimit(Number.NaN);
        expect(useSettingsStore.getState().commonPhraseRankLimit).toBe(0);
    });

    it('hydrates missing and malformed persisted values as off', async () => {
        localStorage.setItem('xyz-settings', JSON.stringify({ state: { wpm: 420 }, version: 0 }));
        await useSettingsStore.persist.rehydrate();
        expect(useSettingsStore.getState().commonPhraseRankLimit).toBe(0);

        localStorage.setItem('xyz-settings', JSON.stringify({ state: { commonPhraseRankLimit: 'fast' }, version: 0 }));
        await useSettingsStore.persist.rehydrate();
        expect(useSettingsStore.getState().commonPhraseRankLimit).toBe(0);
    });

    it('migrates legacy AI enablement to pacing without enabling other features', async () => {
        localStorage.setItem('xyz-settings', JSON.stringify({
            state: { aiEnabled: true },
            version: 0,
        }));

        await useSettingsStore.persist.rehydrate();
        const settings = useSettingsStore.getState();

        expect(settings.adaptivePacingEnabled).toBe(true);
        expect(settings.aiEnabled).toBe(true);
        expect(settings.summariesEnabled).toBe(false);
        expect(settings.textRepairMode).toBe('off');
        expect(settings.ttsAnnotationsEnabled).toBe(false);
        expect(settings.structureStrategyId).toBe('auto-deterministic');
    });

    it('preserves the summary setting independently from legacy AI enablement', async () => {
        localStorage.setItem('xyz-settings', JSON.stringify({
            state: { aiEnabled: false, summariesEnabled: true },
            version: 0,
        }));

        await useSettingsStore.persist.rehydrate();

        expect(useSettingsStore.getState().adaptivePacingEnabled).toBe(false);
        expect(useSettingsStore.getState().summariesEnabled).toBe(true);
    });

    it('uses independent local AI defaults for a fresh profile', () => {
        const settings = useSettingsStore.getInitialState();

        expect(settings.adaptivePacingEnabled).toBe(false);
        expect(settings.textRepairMode).toBe('off');
        expect(settings.ttsAnnotationsEnabled).toBe(false);
        expect(settings.structureStrategyId).toBe('auto-deterministic');
        expect(settings.summariesEnabled).toBe(false);
    });

    it('normalizes arbitrary values without relying on hydration', () => {
        expect(normalizeCommonPhraseRankLimit(24)).toBe(20);
        expect(normalizeCommonPhraseRankLimit(-20)).toBe(0);
        expect(normalizeCommonPhraseRankLimit(501)).toBe(500);
        expect(normalizeCommonPhraseRankLimit('20')).toBe(0);
    });
});