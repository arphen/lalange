import { describe, expect, it } from 'vitest';
import { RealtimePacer } from './realtimePacer';

describe('RealtimePacer', () => {
    it('keeps the preferred speed when generation has headroom', () => {
        const pacer = new RealtimePacer(1);

        const snapshot = pacer.observeGeneration({ generationSeconds: 0.4, audioSeconds: 2 });

        expect(snapshot.effectiveSpeed).toBe(1);
        expect(snapshot.paceState).toBe('steady');
        expect(snapshot.generationRtf).toBe(0.2);
    });

    it('applies a faster preference immediately when the device is healthy', () => {
        const pacer = new RealtimePacer(1);

        expect(pacer.setPreferredSpeed(1.2).effectiveSpeed).toBe(1.2);
    });

    it('keeps a device limit when the user raises the preference again', () => {
        const pacer = new RealtimePacer(1);
        pacer.observeGeneration({ generationSeconds: 2.4, audioSeconds: 2 });

        expect(pacer.setPreferredSpeed(1.2).effectiveSpeed).toBe(0.9);
    });

    it('lowers speed when sustained generation cannot keep the target headroom', () => {
        const pacer = new RealtimePacer(1);

        const snapshot = pacer.observeGeneration({ generationSeconds: 2.4, audioSeconds: 2 });

        expect(snapshot.effectiveSpeed).toBe(0.9);
        expect(snapshot.sustainableSpeed).toBe(0.65);
        expect(snapshot.paceState).toBe('limited');
        expect(snapshot.reason).toBe('device-limit');
    });

    it('lowers before an underrun when the buffer is shrinking', () => {
        const pacer = new RealtimePacer(1);
        pacer.observeGeneration({ generationSeconds: 0.4, audioSeconds: 2 });

        const snapshot = pacer.observeBuffer({
            bufferedAudioSeconds: 3,
            isShrinking: true,
            nextAudioReady: false,
            deliveredWpm: null,
        });

        expect(snapshot.effectiveSpeed).toBe(0.9);
        expect(snapshot.paceState).toBe('limited');
    });

    it('recovers slowly after three healthy buffer observations', () => {
        const pacer = new RealtimePacer(1);
        pacer.observeGeneration({ generationSeconds: 0.4, audioSeconds: 2 });
        pacer.observeBuffer({ bufferedAudioSeconds: 3, isShrinking: true, nextAudioReady: false, deliveredWpm: null });
        expect(pacer.snapshot().effectiveSpeed).toBe(0.9);

        for (let index = 0; index < 3; index++) {
            pacer.observeBuffer({
                bufferedAudioSeconds: 20,
                isShrinking: false,
                nextAudioReady: true,
                deliveredWpm: null,
            });
        }

        expect(pacer.snapshot().effectiveSpeed).toBe(0.95);
        expect(pacer.snapshot().paceState).toBe('recovering');
    });

    it('never falls below the minimum supported speed', () => {
        const pacer = new RealtimePacer(1);

        for (let index = 0; index < 20; index++) {
            pacer.observeBuffer({
                bufferedAudioSeconds: 1,
                isShrinking: true,
                nextAudioReady: false,
                deliveredWpm: null,
            });
        }

        expect(pacer.snapshot().effectiveSpeed).toBe(0.5);
    });

    it('does not cap speed when the reader prefers speed over continuity', () => {
        const pacer = new RealtimePacer(1, 'prefer-speed');
        pacer.observeGeneration({ generationSeconds: 2.4, audioSeconds: 2 });
        pacer.observeBuffer({
            bufferedAudioSeconds: 1,
            isShrinking: true,
            nextAudioReady: false,
            deliveredWpm: null,
        });

        const snapshot = pacer.snapshot();

        expect(snapshot.effectiveSpeed).toBe(1);
        expect(snapshot.continuityMode).toBe('prefer-speed');
        expect(snapshot.reason).toBe('prefer-speed');
    });

    it('reports an interruption separately from normal startup waiting', () => {
        const pacer = new RealtimePacer(1);

        expect(pacer.snapshot().paceState).toBe('measuring');
        expect(pacer.reportUnderrun().paceState).toBe('interrupted');
        expect(pacer.reportUnderrun().reason).toBe('interrupted');
    });

    it('resets stale capacity evidence', () => {
        const pacer = new RealtimePacer(1);
        pacer.observeGeneration({ generationSeconds: 2.4, audioSeconds: 2 });
        pacer.observeBuffer({ bufferedAudioSeconds: 1, isShrinking: true, nextAudioReady: false, deliveredWpm: null });

        const snapshot = pacer.reset();

        expect(snapshot.effectiveSpeed).toBe(1);
        expect(snapshot.generationRtf).toBeNull();
        expect(snapshot.paceState).toBe('measuring');
    });
});