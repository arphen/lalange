import { describe, expect, it } from 'vitest';
import { SW_UPDATE_CHECK_INTERVAL_MS } from './updatePrompt.logic';

describe('updatePrompt.logic', () => {
    it('uses a conservative update polling interval', () => {
        expect(SW_UPDATE_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
    });
});