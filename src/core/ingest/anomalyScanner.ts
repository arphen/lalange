import { fingerprintValue } from '../exchange/fingerprint';

export type TextIssueSeverity = 'low' | 'medium' | 'high';
export type TextIssueAmbiguity = 'low' | 'medium' | 'high';

export interface TextIssueCandidate {
    id: string;
    bookId: string;
    sourceUnitId: string;
    revisionHash: string;
    startOffset: number;
    endOffset: number;
    originalHash: string;
    detectorIds: string[];
    evidence: Record<string, string | number | boolean>;
    severity: TextIssueSeverity;
    ambiguity: TextIssueAmbiguity;
}

export interface ProtectedTextRange {
    startOffset: number;
    endOffset: number;
    reason?: string;
}

export interface AnomalyScanInput {
    bookId: string;
    sourceUnitId: string;
    revisionHash: string;
    text: string;
    protectedRanges?: ProtectedTextRange[];
}

export interface AnomalyScanResult {
    candidates: TextIssueCandidate[];
    circuitBroken: boolean;
    circuitBreakerReason?: 'candidate-ratio' | 'candidate-count';
}

type DetectorHit = {
    startOffset: number;
    endOffset: number;
    detectorId: string;
    evidence: Record<string, string | number | boolean>;
    severity: TextIssueSeverity;
    ambiguity: TextIssueAmbiguity;
};

const MAX_CANDIDATES_PER_BOOK = 1000;
const MAX_CANDIDATE_RATIO = 0.05;
const MOJIBAKE = /(?:\u00c3.|\u00c2.|\u00e2\u0080\u00a6|\u00e2\u0080\u0099|\u00e2\u0080\u009c|\u00e2\u0080\u009d|\u00f0\u009f|\u00ef\u00bf\u00bd)/g;
const MARKUP = /(?:<\/?[A-Za-z][^>]*>|&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9A-F]+);)/gi;
const NUMERIC_INTRUSION = /(?<![\w])(?:\.\d+|[A-Za-z]+\d+[A-Za-z]*|\d+[A-Za-z]+)(?![\w])/g;
const PUNCTUATION_SPACING = /\s+[,.!?;:](?=\S)|[,.!?;:]{2,}(?!\.{3})/g;
const LINE_END_HYPHEN = /\b[\p{L}\p{N}]+-[\r\n]+[\p{L}\p{N}]+/gu;
const PAGE_MARKER = /(?:^|\n)[ \t]*(?:page[ \t]+)?\d{1,4}[ \t]*(?=\n|$)/gi;

const severityRank: Record<TextIssueSeverity, number> = { low: 0, medium: 1, high: 2 };
const ambiguityRank: Record<TextIssueAmbiguity, number> = { low: 0, medium: 1, high: 2 };

const overlaps = (left: { startOffset: number; endOffset: number }, right: ProtectedTextRange): boolean => (
    left.startOffset < right.endOffset && right.startOffset < left.endOffset
);

const addRegexHits = (
    text: string,
    regex: RegExp,
    detectorId: string | ((match: RegExpExecArray) => string),
    evidence: (match: RegExpExecArray) => Record<string, string | number | boolean>,
    severity: TextIssueSeverity,
    ambiguity: TextIssueAmbiguity,
    hits: DetectorHit[],
): void => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const startOffset = match.index;
        hits.push({
            startOffset,
            endOffset: startOffset + match[0].length,
            detectorId: typeof detectorId === 'function' ? detectorId(match) : detectorId,
            evidence: evidence(match),
            severity,
            ambiguity,
        });
        if (match[0].length === 0) regex.lastIndex++;
    }
};

const addControlCharacterHits = (text: string, hits: DetectorHit[]): void => {
    for (let index = 0; index < text.length; index += 1) {
        const codePoint = text.codePointAt(index) ?? 0;
        if (!((codePoint >= 0 && codePoint <= 8) || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31) || codePoint === 127)) continue;
        hits.push({
            startOffset: index,
            endOffset: index + 1,
            detectorId: 'encoding-control-character',
            evidence: { codePoint },
            severity: 'high',
            ambiguity: 'low',
        });
    }
};

const isLikelyValidNumericToken = (value: string, text: string, startOffset: number, endOffset: number): boolean => {
    if (/^\d+(?:\.\d+)?$/.test(value)) return true;
    if (/^[A-Z]?\d+[A-Z]?$/.test(value) && /\b(?:H2O|CO2|B2B|IPv\d+)\b/i.test(value)) return true;
    const before = text.slice(Math.max(0, startOffset - 20), startOffset);
    const after = text.slice(endOffset, endOffset + 20);
    return /(?:section|chapter|part|figure|table|formula|equation)\s*$/i.test(before)
        || /^\s*(?:of|in|[-+*/=)])/.test(after);
};

const mergeHits = (hits: DetectorHit[]): DetectorHit[] => {
    const sorted = [...hits].sort((left, right) => (
        left.startOffset - right.startOffset || right.endOffset - left.endOffset
    ));
    const merged: DetectorHit[] = [];

    for (const hit of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || hit.startOffset > previous.endOffset) {
            merged.push({ ...hit, evidence: { ...hit.evidence } });
            continue;
        }

        previous.endOffset = Math.max(previous.endOffset, hit.endOffset);
        if (!previous.detectorId.split(',').includes(hit.detectorId)) {
            previous.detectorId += `,${hit.detectorId}`;
        }
        previous.evidence = { ...previous.evidence, ...hit.evidence };
        if (severityRank[hit.severity] > severityRank[previous.severity]) previous.severity = hit.severity;
        if (ambiguityRank[hit.ambiguity] > ambiguityRank[previous.ambiguity]) previous.ambiguity = hit.ambiguity;
    }

    return merged;
};

const collectHits = (text: string): DetectorHit[] => {
    const hits: DetectorHit[] = [];
    addRegexHits(text, /\uFFFD/g, 'encoding-replacement-character', () => ({ kind: 'replacement-character' }), 'high', 'low', hits);
    addControlCharacterHits(text, hits);
    addRegexHits(text, MOJIBAKE, 'encoding-mojibake', (match) => ({ sample: match[0] }), 'medium', 'medium', hits);
    addRegexHits(text, MARKUP, 'markup-residue', (match) => ({ sample: match[0] }), 'high', 'medium', hits);

    addRegexHits(text, NUMERIC_INTRUSION, (match) => {
        const value = match[0];
        return value.startsWith('.') ? 'numeric-lone-fragment' : 'numeric-alphanumeric-intrusion';
    }, (match) => ({ value: match[0] }), 'medium', 'high', hits);
    for (const hit of hits.filter((candidate) => candidate.detectorId.startsWith('numeric-'))) {
        if (isLikelyValidNumericToken(text.slice(hit.startOffset, hit.endOffset), text, hit.startOffset, hit.endOffset)) {
            const index = hits.indexOf(hit);
            if (index >= 0) hits.splice(index, 1);
        }
    }

    addRegexHits(text, PUNCTUATION_SPACING, 'punctuation-spacing', (match) => ({ sample: match[0] }), 'low', 'high', hits);
    addRegexHits(text, LINE_END_HYPHEN, 'word-boundary-line-hyphen', (match) => ({ sample: match[0] }), 'medium', 'medium', hits);
    addRegexHits(text, PAGE_MARKER, 'repeated-page-marker', (match) => ({ sample: match[0].trim() }), 'medium', 'high', hits);

    const lines = new Map<string, Array<{ startOffset: number; endOffset: number }>>();
    const lineRegex = /(?:^|\n)([^\n]+)(?=\n|$)/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(text)) !== null) {
        const value = lineMatch[1].trim();
        if (value.length < 3 || value.length > 120 || /^\d+$/.test(value)) continue;
        const normalized = value.toLocaleLowerCase().replace(/\s+/g, ' ');
        const startOffset = lineMatch.index + (lineMatch[0].startsWith('\n') ? 1 : 0) + lineMatch[1].indexOf(value);
        const entries = lines.get(normalized) ?? [];
        entries.push({ startOffset, endOffset: startOffset + value.length });
        lines.set(normalized, entries);
    }
    for (const [normalized, occurrences] of lines) {
        if (occurrences.length < 2) continue;
        for (const occurrence of occurrences) {
            hits.push({
                ...occurrence,
                detectorId: 'repeated-header',
                evidence: { normalized, occurrences: occurrences.length },
                severity: 'medium',
                ambiguity: 'high',
            });
        }
    }

    return hits;
};

export const scanTextForAnomalies = async (input: AnomalyScanInput): Promise<AnomalyScanResult> => {
    const hits = mergeHits(collectHits(input.text).filter((hit) => (
        !(input.protectedRanges ?? []).some((range) => overlaps(hit, range))
    )));
    const circuitBroken = hits.length > MAX_CANDIDATES_PER_BOOK || hits.length > input.text.length * MAX_CANDIDATE_RATIO;
    const limitedHits = circuitBroken ? hits.slice(0, MAX_CANDIDATES_PER_BOOK) : hits;
    const candidates = await Promise.all(limitedHits.map(async (hit) => {
        const original = input.text.slice(hit.startOffset, hit.endOffset);
        const originalHash = await fingerprintValue(original);
        const detectorIds = hit.detectorId.split(',');
        return {
            id: `${input.sourceUnitId}:${hit.startOffset}:${hit.endOffset}:${originalHash.slice(0, 12)}`,
            bookId: input.bookId,
            sourceUnitId: input.sourceUnitId,
            revisionHash: input.revisionHash,
            startOffset: hit.startOffset,
            endOffset: hit.endOffset,
            originalHash,
            detectorIds,
            evidence: hit.evidence,
            severity: hit.severity,
            ambiguity: hit.ambiguity,
        } satisfies TextIssueCandidate;
    }));

    return {
        candidates,
        circuitBroken,
        ...(circuitBroken ? {
            circuitBreakerReason: hits.length > MAX_CANDIDATES_PER_BOOK ? 'candidate-count' : 'candidate-ratio',
        } : {}),
    };
};
