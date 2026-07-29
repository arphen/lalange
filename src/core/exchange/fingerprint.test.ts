import { describe, expect, it } from 'vitest';
import { fingerprintValue, stableSerialize } from './fingerprint';

describe('exchange fingerprints', () => {
    it('is stable across object key ordering', async () => {
        const left = { title: 'Book', nested: { second: 2, first: 1 } };
        const right = { nested: { first: 1, second: 2 }, title: 'Book' };

        expect(stableSerialize(left)).toBe(stableSerialize(right));
        await expect(fingerprintValue(left)).resolves.toBe(await fingerprintValue(right));
    });

    it('changes when array order changes', async () => {
        const left = await fingerprintValue({ chapters: ['one', 'two'] });
        const right = await fingerprintValue({ chapters: ['two', 'one'] });
        expect(left).not.toBe(right);
    });
});
