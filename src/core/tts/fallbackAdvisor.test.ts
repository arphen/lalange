import { describe, expect, it } from 'vitest';
import type { RealtimePacerSnapshot } from './realtimePacer';
import {
    FALLBACK_FLOOR_SPEED,
    FALLBACK_RECOVERY_BUFFER_SECONDS,
    FALLBACK_STABLE_AUDIO_SECONDS,
    FallbackAdvisor,
} from './fallbackAdvisor';

const snapshot = (overrides: Partial<RealtimePacerSnapshot> = {}): RealtimePacerSnapshot => ({
    preferredSpeed: 1,
    effectiveSpeed: 0.6,
    sustainableSpeed: 0.6,
    generationRtf: 1.3,
    paceState: 'limited',
    continuityMode: 'continuous',
    hasStableMeasurement: true,
    deliveredWpm: 100,
    reason: 'device-limit',
    ...overrides,
});

const evidence = (overrides: Partial<Parameters<FallbackAdvisor['observe']>[1]> = {}) => ({
    engine: 'kokoro' as const,
    hasCandidate: true,
    isPlaying: true,
    isBufferShrinking: true,
    bufferedAudioSeconds: 3,
    ...overrides,
});

describe('FallbackAdvisor', () => {
    it('requires sustained low performance before offering a fallback', () => {
        const advisor = new FallbackAdvisor();

        for (let index = 0; index < 2; index++) {
            const result = advisor.observe(snapshot(), evidence({ measuredAudioSeconds: 4 }));
            expect(result.eligible).toBe(false);
        }

        const result = advisor.observe(snapshot(), evidence({ measuredAudioSeconds: 2 }));

        expect(result.stableAudioSeconds).toBe(FALLBACK_STABLE_AUDIO_SECONDS);
        expect(result.lowSpeedSamplesInWindow).toBe(3);
        expect(result.eligible).toBe(true);
        expect(result.reason).toBe('eligible');
    });

    it('does not mistake healthy startup for recovery', () => {
        const advisor = new FallbackAdvisor();

        const result = advisor.observe(
            snapshot({ effectiveSpeed: 1, sustainableSpeed: 1, paceState: 'steady', reason: 'steady' }),
            evidence({ isBufferShrinking: false, bufferedAudioSeconds: FALLBACK_RECOVERY_BUFFER_SECONDS, measuredAudioSeconds: 4 }),
        );

        expect(result.stableAudioSeconds).toBe(4);
        expect(result.reason).toBe('measuring');
    });

    it('offers after two floor underruns in the audible-time window', () => {
        const advisor = new FallbackAdvisor();
        advisor.observe(snapshot({ effectiveSpeed: 0.5 }), evidence({ measuredAudioSeconds: 10, audibleTimeSeconds: 0 }));
        advisor.reportUnderrun(10);
        advisor.reportUnderrun(20);

        const result = advisor.observe(
            snapshot({ effectiveSpeed: 0.5 }),
            evidence({ measuredAudioSeconds: 0, audibleTimeSeconds: 20 }),
        );

        expect(result.underrunsInWindow).toBe(2);
        expect(result.eligible).toBe(true);
    });

    it('drops underruns outside the sixty-second window', () => {
        const advisor = new FallbackAdvisor();
        advisor.observe(snapshot({ effectiveSpeed: 0.5 }), evidence({ measuredAudioSeconds: 10, audibleTimeSeconds: 0 }));
        advisor.reportUnderrun(0);
        advisor.reportUnderrun(30);

        const result = advisor.observe(
            snapshot({ effectiveSpeed: 0.5 }),
            evidence({ audibleTimeSeconds: 91 }),
        );

        expect(result.underrunsInWindow).toBe(0);
        expect(result.eligible).toBe(false);
    });

    it.each([
        ['prefer-speed', snapshot({ continuityMode: 'prefer-speed', reason: 'prefer-speed' }), evidence()],
        ['paused', snapshot(), evidence({ isPlaying: false })],
        ['warming-up', snapshot(), evidence({ isWarmup: true })],
        ['Piper active', snapshot(), evidence({ engine: 'piper' })],
        ['unmapped language', snapshot(), evidence({ hasCandidate: false })],
    ])('suppresses offers while %s', (_label, pace, observedEvidence) => {
        const advisor = new FallbackAdvisor();

        const result = advisor.observe(pace, {
            ...observedEvidence,
            measuredAudioSeconds: 20,
        });

        expect(result.eligible).toBe(false);
    });

    it('suppresses a dismissed offer until performance recovers', () => {
        const advisor = new FallbackAdvisor();
        for (let index = 0; index < 3; index++) {
            advisor.observe(snapshot(), evidence({ measuredAudioSeconds: 4 }));
        }

        advisor.dismiss();
        expect(advisor.observe(snapshot(), evidence()).reason).toBe('dismissed');

        const recovered = advisor.observe(
            snapshot({ effectiveSpeed: 0.8, sustainableSpeed: 0.8, paceState: 'recovering', reason: 'recovering' }),
            evidence({ isBufferShrinking: false, bufferedAudioSeconds: FALLBACK_RECOVERY_BUFFER_SECONDS }),
        );

        expect(recovered.reason).toBe('recovered');
        expect(recovered.dismissed).toBe(false);
    });

    it('does not rearm after a failed Piper trial when capacity resets', () => {
        const advisor = new FallbackAdvisor();
        advisor.markTrialFailed();

        advisor.reset({ preserveTrialFailure: true });

        expect(advisor.snapshot()).toMatchObject({
            eligible: false,
            trialFailed: true,
            reason: 'trial-failed',
        });
    });
});

describe('FallbackAdvisor on a device that struggles in bursts', () => {
    const sawtooth = (index: number) => {
        const starving = index % 2 === 0;
        return {
            pacer: snapshot({ effectiveSpeed: starving ? 0.45 : 0.8 }),
            evidence: evidence({
                isBufferShrinking: starving,
                bufferedAudioSeconds: starving ? 3 : 12,
                measuredAudioSeconds: 3,
            }),
        };
    };

    it('offers the lighter voice when a device keeps falling behind and clawing back', () => {
        // A device that cannot keep up rarely starves continuously: it starves,
        // recovers a little, starves again. Demanding an unbroken run of bad
        // samples meant this pattern was never offered a fallback at all.
        const advisor = new FallbackAdvisor();
        let eligible = false;

        for (let index = 0; index < 10; index++) {
            const { pacer, evidence: sample } = sawtooth(index);
            if (advisor.observe(pacer, sample).eligible) eligible = true;
        }

        expect(eligible).toBe(true);
    });

    it('leaves a healthy device alone when it dips only occasionally', () => {
        const advisor = new FallbackAdvisor();
        let eligible = false;

        for (let index = 0; index < 24; index++) {
            const starving = index % 6 === 0;
            const result = advisor.observe(
                snapshot({ effectiveSpeed: starving ? 0.45 : 1 }),
                evidence({
                    isBufferShrinking: starving,
                    bufferedAudioSeconds: starving ? 8 : 20,
                    measuredAudioSeconds: 3,
                }),
            );
            if (result.eligible) eligible = true;
        }

        expect(eligible).toBe(false);
    });
});

describe('FallbackAdvisor around a momentary interruption', () => {
    it('withholds judgement while playback is interrupted', () => {
        // The pacer clears this state once the buffer recovers, so a single
        // underrun must not by itself recommend changing voice.
        const advisor = new FallbackAdvisor();
        const interrupted = snapshot({
            effectiveSpeed: FALLBACK_FLOOR_SPEED,
            paceState: 'interrupted',
            reason: 'interrupted',
        });

        const result = advisor.observe(interrupted, evidence({ measuredAudioSeconds: 12 }));

        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('interrupted');
    });
});
