export type ContinuityMode = 'continuous' | 'prefer-speed';
export type PaceState = 'measuring' | 'steady' | 'limited' | 'recovering' | 'interrupted';

export interface GenerationSample {
    generationSeconds: number;
    audioSeconds: number;
}

export interface BufferSnapshot {
    bufferedAudioSeconds: number;
    isShrinking: boolean;
    nextAudioReady: boolean;
    deliveredWpm: number | null;
}

export interface RealtimePacerSnapshot {
    preferredSpeed: number;
    effectiveSpeed: number;
    sustainableSpeed: number;
    generationRtf: number | null;
    paceState: PaceState;
    continuityMode: ContinuityMode;
    hasStableMeasurement: boolean;
    deliveredWpm: number | null;
    reason: 'measuring' | 'steady' | 'device-limit' | 'recovering' | 'interrupted' | 'prefer-speed';
}

export interface RealtimePacerOptions {
    minSpeed?: number;
    targetRtf?: number;
    recoveryBufferSeconds?: number;
    dangerBufferSeconds?: number;
    maxSamples?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const quantizeSpeed = (value: number): number => Math.round(value * 20) / 20;

export class RealtimePacer {
    private readonly minSpeed: number;
    private readonly targetRtf: number;
    private readonly recoveryBufferSeconds: number;
    private readonly dangerBufferSeconds: number;
    private readonly maxSamples: number;
    private samples: GenerationSample[] = [];
    private healthySamples = 0;
    private buffer: BufferSnapshot = {
        bufferedAudioSeconds: 0,
        isShrinking: false,
        nextAudioReady: false,
        deliveredWpm: null,
    };
    private preferredSpeed: number;
    private continuityMode: ContinuityMode;
    private effectiveSpeed: number;
    private paceState: PaceState = 'measuring';
    private reason: RealtimePacerSnapshot['reason'] = 'measuring';
    private interrupted = false;
    private deliveredWpm: number | null = null;

    constructor(
        preferredSpeed = 1,
        continuityMode: ContinuityMode = 'continuous',
        options: RealtimePacerOptions = {},
    ) {
        this.minSpeed = options.minSpeed ?? 0.5;
        this.targetRtf = options.targetRtf ?? 0.8;
        this.recoveryBufferSeconds = options.recoveryBufferSeconds ?? 15;
        this.dangerBufferSeconds = options.dangerBufferSeconds ?? 4;
        this.maxSamples = options.maxSamples ?? 5;
        this.preferredSpeed = clamp(preferredSpeed, this.minSpeed, 2);
        this.continuityMode = continuityMode;
        this.effectiveSpeed = this.preferredSpeed;
        if (continuityMode === 'prefer-speed') {
            this.paceState = 'steady';
            this.reason = 'prefer-speed';
        }
    }

    setPreferredSpeed(speed: number): RealtimePacerSnapshot {
        const previousPreferredSpeed = this.preferredSpeed;
        const wasFollowingPreferredSpeed = this.effectiveSpeed >= previousPreferredSpeed;
        this.preferredSpeed = clamp(speed, this.minSpeed, 2);
        if (this.continuityMode === 'prefer-speed') {
            this.effectiveSpeed = this.preferredSpeed;
        } else if (wasFollowingPreferredSpeed) {
            this.effectiveSpeed = this.preferredSpeed;
        } else {
            this.effectiveSpeed = Math.min(this.effectiveSpeed, this.preferredSpeed);
        }
        return this.snapshot();
    }

    setContinuityMode(mode: ContinuityMode): RealtimePacerSnapshot {
        this.continuityMode = mode;
        if (mode === 'prefer-speed') {
            this.effectiveSpeed = this.preferredSpeed;
            this.paceState = this.interrupted ? 'interrupted' : 'steady';
            this.reason = 'prefer-speed';
        } else if (!this.interrupted) {
            this.recalculateEffectiveSpeed(true);
        }
        return this.snapshot();
    }

    observeGeneration(sample: GenerationSample): RealtimePacerSnapshot {
        if (
            !Number.isFinite(sample.generationSeconds)
            || !Number.isFinite(sample.audioSeconds)
            || sample.generationSeconds <= 0
            || sample.audioSeconds <= 0
        ) {
            return this.snapshot();
        }

        this.samples.push(sample);
        if (this.samples.length > this.maxSamples) this.samples.shift();
        this.healthySamples = 0;
        this.recalculateEffectiveSpeed(false);
        return this.snapshot();
    }

    observeBuffer(buffer: BufferSnapshot): RealtimePacerSnapshot {
        this.buffer = {
            bufferedAudioSeconds: Math.max(0, buffer.bufferedAudioSeconds),
            isShrinking: buffer.isShrinking,
            nextAudioReady: buffer.nextAudioReady,
            deliveredWpm: buffer.deliveredWpm,
        };
        this.deliveredWpm = buffer.deliveredWpm;

        // A single underrun used to latch `interrupted` for the rest of the
        // session: every recovery path below is gated on !interrupted, so speech
        // stayed pinned at the floor speed forever and the fallback advisor was
        // permanently silenced. Clear it once the buffer is genuinely healthy.
        if (
            this.continuityMode === 'continuous'
            && this.interrupted
            && this.buffer.bufferedAudioSeconds > this.recoveryBufferSeconds
            && !this.buffer.isShrinking
        ) {
            this.healthySamples += 1;
            if (this.healthySamples >= 3) return this.recoverFromInterruption();
            return this.snapshot();
        }

        if (
            this.continuityMode === 'continuous'
            && !this.interrupted
            && this.buffer.isShrinking
            && this.buffer.bufferedAudioSeconds <= this.dangerBufferSeconds
        ) {
            this.lowerForBufferDanger();
        } else if (
            this.continuityMode === 'continuous'
            && !this.interrupted
            && this.buffer.bufferedAudioSeconds > this.recoveryBufferSeconds
            && !this.buffer.isShrinking
        ) {
            this.healthySamples += 1;
            if (this.healthySamples >= 3) this.recalculateEffectiveSpeed(true);
        }

        return this.snapshot();
    }

    reportUnderrun(): RealtimePacerSnapshot {
        this.interrupted = true;
        this.paceState = 'interrupted';
        this.reason = 'interrupted';
        return this.snapshot();
    }

    recoverFromInterruption(): RealtimePacerSnapshot {
        this.interrupted = false;
        this.healthySamples = 0;
        this.paceState = this.samples.length === 0 ? 'measuring' : 'steady';
        this.reason = this.samples.length === 0 ? 'measuring' : 'steady';
        return this.snapshot();
    }

    reset(): RealtimePacerSnapshot {
        this.samples = [];
        this.healthySamples = 0;
        this.interrupted = false;
        this.effectiveSpeed = this.preferredSpeed;
        this.paceState = 'measuring';
        this.reason = 'measuring';
        this.buffer = {
            bufferedAudioSeconds: 0,
            isShrinking: false,
            nextAudioReady: false,
            deliveredWpm: null,
        };
        this.deliveredWpm = null;
        return this.snapshot();
    }

    snapshot(): RealtimePacerSnapshot {
        const totals = this.samples.reduce(
            (result, sample) => ({
                generationSeconds: result.generationSeconds + sample.generationSeconds,
                audioSeconds: result.audioSeconds + sample.audioSeconds,
            }),
            { generationSeconds: 0, audioSeconds: 0 },
        );
        const generationRtf = totals.audioSeconds > 0
            ? totals.generationSeconds / totals.audioSeconds
            : null;
        const hasStableMeasurement = totals.audioSeconds >= 2;

        return Object.freeze({
            preferredSpeed: this.preferredSpeed,
            effectiveSpeed: this.effectiveSpeed,
            sustainableSpeed: this.calculateSustainableSpeed(generationRtf),
            generationRtf,
            paceState: this.paceState,
            continuityMode: this.continuityMode,
            hasStableMeasurement,
            deliveredWpm: this.deliveredWpm,
            reason: this.reason,
        });
    }

    private calculateSustainableSpeed(generationRtf: number | null): number {
        if (!generationRtf || generationRtf <= 0) return this.preferredSpeed;
        return quantizeSpeed(clamp(
            this.preferredSpeed * this.targetRtf / generationRtf,
            this.minSpeed,
            this.preferredSpeed,
        ));
    }

    private recalculateEffectiveSpeed(isRecovery: boolean): void {
        if (this.continuityMode === 'prefer-speed' || this.interrupted) return;

        const snapshot = this.snapshot();
        if (!snapshot.hasStableMeasurement) {
            this.paceState = 'measuring';
            this.reason = 'measuring';
            return;
        }

        const sustainableSpeed = snapshot.sustainableSpeed;
        if (!isRecovery && sustainableSpeed < this.effectiveSpeed) {
            this.effectiveSpeed = quantizeSpeed(Math.max(
                sustainableSpeed,
                this.effectiveSpeed - 0.1,
            ));
            this.paceState = 'limited';
            this.reason = 'device-limit';
            return;
        }

        if (isRecovery && sustainableSpeed >= this.effectiveSpeed && this.effectiveSpeed < this.preferredSpeed) {
            this.effectiveSpeed = quantizeSpeed(Math.min(
                this.preferredSpeed,
                this.effectiveSpeed + 0.05,
            ));
            this.paceState = this.effectiveSpeed >= this.preferredSpeed ? 'steady' : 'recovering';
            this.reason = this.effectiveSpeed >= this.preferredSpeed ? 'steady' : 'recovering';
            return;
        }

        this.paceState = this.effectiveSpeed < this.preferredSpeed ? 'limited' : 'steady';
        this.reason = this.effectiveSpeed < this.preferredSpeed ? 'device-limit' : 'steady';
    }

    private lowerForBufferDanger(): void {
        if (this.effectiveSpeed <= this.minSpeed) return;
        this.effectiveSpeed = quantizeSpeed(Math.max(this.minSpeed, this.effectiveSpeed - 0.1));
        this.paceState = 'limited';
        this.reason = 'device-limit';
        this.healthySamples = 0;
    }
}