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

    it('normalizes arbitrary values without relying on hydration', () => {
        expect(normalizeCommonPhraseRankLimit(24)).toBe(20);
        expect(normalizeCommonPhraseRankLimit(-20)).toBe(0);
        expect(normalizeCommonPhraseRankLimit(501)).toBe(500);
        expect(normalizeCommonPhraseRankLimit('20')).toBe(0);
    });
});