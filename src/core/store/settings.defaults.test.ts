import { describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings';

describe('settings defaults', () => {
    it('keeps optional AI features off for new users', () => {
        const defaults = useSettingsStore.getInitialState();

        expect(defaults.aiEnabled).toBe(false);
        expect(defaults.summariesEnabled).toBe(false);
    });
});