import { describe, expect, it } from 'vitest';
import {
    SW_RELOAD_FALLBACK_MS,
    SW_UPDATE_CHECK_INTERVAL_MS,
    shouldReloadOnControllerChange,
} from './updatePrompt.logic';

describe('updatePrompt.logic', () => {
    it('reloads only when update was user initiated and not already reloaded', () => {
        expect(shouldReloadOnControllerChange(true, false)).toBe(true);
        expect(shouldReloadOnControllerChange(false, false)).toBe(false);
        expect(shouldReloadOnControllerChange(true, true)).toBe(false);
        expect(shouldReloadOnControllerChange(false, true)).toBe(false);
    });

    it('uses a conservative update polling interval', () => {
        expect(SW_UPDATE_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
    });

    it('keeps fallback reload bounded', () => {
        expect(SW_RELOAD_FALLBACK_MS).toBe(2500);
    });
});