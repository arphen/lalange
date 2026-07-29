import { describe, expect, it } from 'vitest';
import { compareExchangeFingerprint, suggestExchangeResolution } from './conflicts';

describe('compareExchangeFingerprint', () => {
    it('detects the same state', () => {
        expect(compareExchangeFingerprint('same', 'same', 'base')).toBe('same');
    });

    it('detects an incoming-only change from a shared base', () => {
        expect(compareExchangeFingerprint('base', 'remote', 'base')).toBe('incoming-only-change');
    });

    it('detects a local-only change from a shared base', () => {
        expect(compareExchangeFingerprint('local', 'base', 'base')).toBe('local-only-change');
    });

    it('detects concurrent changes', () => {
        expect(compareExchangeFingerprint('local', 'remote', 'base')).toBe('concurrent-change');
    });
});

describe('suggestExchangeResolution', () => {
    it('prefers incoming position for a handoff', () => {
        expect(suggestExchangeResolution('handoff', {
            content: 'same',
            progress: 'concurrent-change',
            highlights: 'same',
        }).progress).toBe('take-incoming');
    });

    it('does not silently replace concurrent progress during reconciliation', () => {
        expect(suggestExchangeResolution('reconcile', {
            content: 'same',
            progress: 'concurrent-change',
            highlights: 'same',
        }).progress).toBe('keep-local');
    });
});
