import type { RealtimePacerSnapshot } from './realtimePacer';

export const FALLBACK_STABLE_AUDIO_SECONDS = 10;
export const FALLBACK_LOW_SPEED_THRESHOLD = 0.6;
export const FALLBACK_LOW_SPEED_SAMPLES = 3;
export const FALLBACK_FLOOR_SPEED = 0.5;
export const FALLBACK_UNDERRUN_WINDOW_SECONDS = 60;
export const FALLBACK_UNDERRUN_COUNT = 2;
export const FALLBACK_RECOVERY_SPEED = 0.7;
export const FALLBACK_RECOVERY_BUFFER_SECONDS = 15;

export type FallbackAdvisorReason =
    | 'measuring'
    | 'eligible'
    | 'prefer-speed'
    | 'paused'
    | 'warming-up'
    | 'interrupted'
    | 'piper-active'
    | 'unmapped-language'
    | 'dismissed'
    | 'trial-failed'
    | 'recovered';

export interface FallbackAdvisorEvidence {
    engine: 'kokoro' | 'piper';
    hasCandidate: boolean;
    isPlaying: boolean;
    isWarmup?: boolean;
    isGenerationSample?: boolean;
    isBufferShrinking: boolean;
    bufferedAudioSeconds: number;
    measuredAudioSeconds?: number;
    audibleTimeSeconds?: number;
}

export interface FallbackAdvisorSnapshot {
    eligible: boolean;
    stableAudioSeconds: number;
    consecutiveLowSpeedSamples: number;
    underrunsInWindow: number;
    dismissed: boolean;
    trialFailed: boolean;
    reason: FallbackAdvisorReason;
}

interface ResetOptions {
    preserveTrialFailure?: boolean;
}

export class FallbackAdvisor {
    private stableAudioSeconds = 0;
    private consecutiveLowSpeedSamples = 0;
    private underrunTimes: number[] = [];
    private dismissed = false;
    private trialFailed = false;
    private limitedEpisodeActive = false;
    private reason: FallbackAdvisorReason = 'measuring';
    private lastAudibleTimeSeconds: number | null = null;

    observe(
        snapshot: RealtimePacerSnapshot,
        evidence: FallbackAdvisorEvidence,
    ): FallbackAdvisorSnapshot {
        if (Number.isFinite(evidence.measuredAudioSeconds) && (evidence.measuredAudioSeconds ?? 0) > 0) {
            this.stableAudioSeconds += evidence.measuredAudioSeconds as number;
        }
        if (Number.isFinite(evidence.audibleTimeSeconds)) {
            this.lastAudibleTimeSeconds = evidence.audibleTimeSeconds as number;
            this.pruneUnderruns(this.lastAudibleTimeSeconds);
        }

        if (
            evidence.engine === 'kokoro'
            && evidence.isPlaying
            && !evidence.isWarmup
            && this.limitedEpisodeActive
            && snapshot.effectiveSpeed > FALLBACK_RECOVERY_SPEED
            && !evidence.isBufferShrinking
            && evidence.bufferedAudioSeconds >= FALLBACK_RECOVERY_BUFFER_SECONDS
        ) {
            this.stableAudioSeconds = 0;
            this.consecutiveLowSpeedSamples = 0;
            this.underrunTimes = [];
            this.dismissed = false;
            this.limitedEpisodeActive = false;
            this.reason = 'recovered';
            return this.snapshot();
        }

        if (evidence.engine === 'piper') return this.withReason('piper-active');
        if (!evidence.hasCandidate) return this.withReason('unmapped-language');
        if (snapshot.continuityMode === 'prefer-speed') return this.withReason('prefer-speed');
        if (!evidence.isPlaying) return this.withReason('paused');
        if (evidence.isWarmup) return this.withReason('warming-up');
        if (snapshot.paceState === 'interrupted') return this.withReason('interrupted');
        if (this.dismissed) return this.withReason('dismissed');
        if (this.trialFailed) return this.withReason('trial-failed');

        if (
            (evidence.isGenerationSample ?? true)
            && snapshot.effectiveSpeed <= FALLBACK_LOW_SPEED_THRESHOLD
            && evidence.isBufferShrinking
        ) {
            this.consecutiveLowSpeedSamples += 1;
            this.limitedEpisodeActive = true;
        } else {
            this.consecutiveLowSpeedSamples = 0;
        }

        const hasStableAudio = this.stableAudioSeconds >= FALLBACK_STABLE_AUDIO_SECONDS;
        const sustainedLowSpeed = this.consecutiveLowSpeedSamples >= FALLBACK_LOW_SPEED_SAMPLES;
        const floorUnderruns = (
            snapshot.effectiveSpeed <= FALLBACK_FLOOR_SPEED
            && this.underrunTimes.length >= FALLBACK_UNDERRUN_COUNT
        );
        if (floorUnderruns) this.limitedEpisodeActive = true;

        if (hasStableAudio && (sustainedLowSpeed || floorUnderruns)) {
            return this.withReason('eligible');
        }

        return this.withReason('measuring');
    }

    reportUnderrun(audibleTimeSeconds?: number): FallbackAdvisorSnapshot {
        const timestamp = audibleTimeSeconds ?? this.lastAudibleTimeSeconds;
        if (timestamp === null || !Number.isFinite(timestamp)) return this.snapshot();

        this.lastAudibleTimeSeconds = timestamp;
        this.pruneUnderruns(timestamp);
        this.underrunTimes.push(timestamp);
        return this.snapshot();
    }

    dismiss(): FallbackAdvisorSnapshot {
        this.dismissed = true;
        this.reason = 'dismissed';
        return this.snapshot();
    }

    markTrialFailed(): FallbackAdvisorSnapshot {
        this.trialFailed = true;
        this.reason = 'trial-failed';
        return this.snapshot();
    }

    reset(options: ResetOptions = {}): FallbackAdvisorSnapshot {
        const preserveTrialFailure = options.preserveTrialFailure ?? false;
        this.stableAudioSeconds = 0;
        this.consecutiveLowSpeedSamples = 0;
        this.underrunTimes = [];
        this.dismissed = false;
        this.trialFailed = preserveTrialFailure && this.trialFailed;
        this.limitedEpisodeActive = false;
        this.reason = this.trialFailed ? 'trial-failed' : 'measuring';
        this.lastAudibleTimeSeconds = null;
        return this.snapshot();
    }

    snapshot(): FallbackAdvisorSnapshot {
        const hasStableAudio = this.stableAudioSeconds >= FALLBACK_STABLE_AUDIO_SECONDS;
        const eligible = (
            this.reason === 'eligible'
            && hasStableAudio
            && !this.dismissed
            && !this.trialFailed
        );

        return Object.freeze({
            eligible,
            stableAudioSeconds: this.stableAudioSeconds,
            consecutiveLowSpeedSamples: this.consecutiveLowSpeedSamples,
            underrunsInWindow: this.underrunTimes.length,
            dismissed: this.dismissed,
            trialFailed: this.trialFailed,
            reason: this.reason,
        });
    }

    private withReason(reason: FallbackAdvisorReason): FallbackAdvisorSnapshot {
        this.reason = reason;
        return this.snapshot();
    }

    private pruneUnderruns(now: number): void {
        const oldestAllowed = now - FALLBACK_UNDERRUN_WINDOW_SECONDS;
        this.underrunTimes = this.underrunTimes.filter((timestamp) => timestamp >= oldestAllowed);
    }
}