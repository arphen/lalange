import type {
    ExchangeBookResolution,
    ExchangeComparison,
    ExchangeIntent,
} from './types';

export function compareExchangeFingerprint(
    localHash: string | undefined,
    incomingHash: string | undefined,
    sharedBaseHash?: string,
): ExchangeComparison {
    if (localHash === incomingHash) return 'same';

    if (sharedBaseHash !== undefined) {
        if (localHash === sharedBaseHash && incomingHash !== sharedBaseHash) {
            return 'incoming-only-change';
        }
        if (incomingHash === sharedBaseHash && localHash !== sharedBaseHash) {
            return 'local-only-change';
        }
    }

    if (localHash === undefined && incomingHash !== undefined) return 'incoming-only-change';
    if (incomingHash === undefined && localHash !== undefined) return 'local-only-change';
    return 'concurrent-change';
}

export function suggestExchangeResolution(
    intent: ExchangeIntent,
    comparison: {
        content: ExchangeComparison;
        progress: ExchangeComparison;
        highlights: ExchangeComparison;
    },
): ExchangeBookResolution {
    const content = comparison.content === 'incoming-only-change'
        ? 'take-incoming'
        : comparison.content === 'concurrent-change'
            ? 'keep-both'
            : 'keep-local';

    const progress = intent === 'handoff' && comparison.progress !== 'same'
        ? 'take-incoming'
        : comparison.progress === 'incoming-only-change'
            ? 'take-incoming'
            : 'keep-local';

    const highlights = comparison.highlights === 'incoming-only-change'
        ? 'take-incoming'
        : comparison.highlights === 'concurrent-change'
            ? 'merge-prefer-local'
            : 'keep-local';

    return { content, progress, highlights };
}
