import type { ReferenceHandlingMode } from './cleaning';
import type { MarkupRecoveryResult } from './markupRecovery';

export type ContentQualityDecision = 'accept' | 'accept-degraded' | 'reject';

export type ContentZone = 'body' | 'notes' | 'publication-matter' | 'rejected-ocr';

export type ContentIssueType =
    | 'low-ocr-confidence'
    | 'scan-matter'
    | 'publication-matter'
    | 'page-furniture'
    | 'reference-marker'
    | 'control-character'
    | 'hard-wrap'
    | 'corrupt-span'
    | 'malformed-prose-markup';

export interface RawContentUnit {
    ordinal: number;
    path: string;
    html: string;
    text: string;
    lines: string[];
    markupRecovery?: MarkupRecoveryResult;
}

export interface ContentQualityIssue {
    type: ContentIssueType;
    confidence: number;
    count: number;
    samples: string[];
}

export interface ContentQualityResult {
    decision: ContentQualityDecision;
    cleanedHtml: string;
    cleanedText: string;
    issues: ContentQualityIssue[];
    removedCharacters: number;
    qualityScore: number;
    reason?: string;
    zone?: ContentZone;
}

export interface ContentQualityProfile {
    repeatedEdgeSignatures: ReadonlySet<string>;
    intactTokens: ReadonlySet<string>;
    referenceMarkerCount: number;
}

export interface ContentQualityOptions {
    lowConfidenceOcrThreshold?: number;
    degradedOcrThreshold?: number;
    referenceHandling?: ReferenceHandlingMode;
}

export interface FinalContentGuardOptions {
    baselineText?: string;
    requireContent?: boolean;
}

export const CONTENT_QUALITY_THRESHOLDS = {
    lowConfidenceOcr: 5,
    degradedOcr: 35,
    scanMatterWordLimit: 120,
    corruptionRejectRatio: 0.35,
} as const;

const OCR_CONFIDENCE_WARNING = /the text on this page is estimated to be only\s+(\d+(?:\.\d+)?)%\s+accurate/i;
const SCAN_MATTER_PATTERN = /\b(?:university(?: of [a-z]+)? library|arts library|due on|last date stamped|received|barcode|call number|library copy)\b/i;
const PUBLICATION_MATTER_PATTERN = /\b(?:printed in great britain|published by|presses universitaires|copyright)\b/i;
const CORRUPT_TOKEN_PATTERN = /(?:[A-Za-z]{2,}_[A-Za-z]{2,})|(?:[A-Za-z][^A-Za-z\s]{2,}[A-Za-z])|(?:\.{4,}|[|]{2,}|[~]{2,})/u;
const OCR_REFERENCE_CANDIDATE_PATTERN = /\^+(?:['"*®•♦■]+|\d{1,3})?\^*|[®•♦■]+/gu;
const NOTE_HEADING_PATTERN = /^(?:notes\b|ch\.?\s*[\divxlcdm]+\s+notes\b|bibliographical abbreviations used in the notes\b)/i;

const isForbiddenControlCharacter = (character: string): boolean => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint === 0xFFFD
        || codePoint <= 0x0008
        || codePoint === 0x000B
        || codePoint === 0x000C
        || (codePoint >= 0x000E && codePoint <= 0x001F)
        || (codePoint >= 0x007F && codePoint <= 0x009F);
};

const hasBarcodeLikeToken = (text: string): boolean => text
    .split(/\s+/)
    .some((token) => {
        const normalized = token.replace(/[^a-z0-9]/gi, '');
        if (normalized.length < 12) return false;
        return new Set(normalized.toLocaleLowerCase()).size <= 3;
    });

const normalizeEdgeSignature = (value: string): string => value
    .toLocaleLowerCase()
    .normalize('NFC')
    .replace(/\b(?:\d{1,4}|[ivxlcdm]{1,8})\b/gi, '<number>')
    .replace(/\s+/g, ' ')
    .trim();

const getEdgeLines = (unit: RawContentUnit): string[] => {
    const lines = unit.lines
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return [...lines.slice(0, 3), ...lines.slice(-3)];
};

const isGenericHeadingSignature = (signature: string): boolean => /^(?:chapter|section|part)\s+(?:<number>|[a-z]+)(?:\s+.*)?$/i.test(signature);

const isOcrReferenceCandidate = (text: string, index: number, length: number): boolean => {
    const before = text[index - 1] || '';
    const after = text[index + length] || '';
    const candidate = text.slice(index, index + length);
    const caretCluster = /^\^+(?:['"*®•♦■]+)?\^*$/u.test(candidate);
    const boundaryBefore = !before || /[\s.!?,;:()[\]{}"']/u.test(before) || caretCluster;
    const symbolBeforeDigit = caretCluster && candidate.split('').some((character) => character !== '^') && /^\d/u.test(after);
    const boundaryAfter = !after || /[\s.,;:!?()[\]{}"']/u.test(after) || symbolBeforeDigit;
    if (!boundaryBefore || !boundaryAfter) return false;
    if (/^\^+$/u.test(candidate) && /\d/u.test(after)) return false;
    if (candidate === '®' && /[\p{L}\p{N}]/u.test(before)) return false;
    return true;
};

const getOcrReferenceCandidates = (text: string): string[] => {
    const candidates: string[] = [];
    for (const match of text.matchAll(OCR_REFERENCE_CANDIDATE_PATTERN)) {
        const candidate = match[0];
        const index = match.index ?? -1;
        if (index >= 0 && isOcrReferenceCandidate(text, index, candidate.length)) {
            candidates.push(candidate);
        }
    }
    return candidates;
};

const detectContentZone = (text: string): ContentZone => {
    const firstLines = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3);
    return firstLines.some((line) => NOTE_HEADING_PATTERN.test(line.replace(/^page\s+\d{1,5}\s*/i, '')))
        ? 'notes'
        : 'body';
};

const repairHardWraps = (
    text: string,
    profile: ContentQualityProfile,
): { value: string; samples: string[] } => {
    const lines = text.split('\n');
    const joins: string[] = [];

    for (let index = 0; index < lines.length - 1; index += 1) {
        const leftMatch = lines[index].match(/([\p{L}]+)([-]*)\s*$/u);
        const rightMatch = lines[index + 1].match(/^\s*([\p{L}]+)/u);
        if (!leftMatch || !rightMatch) continue;

        const left = leftMatch[1];
        const right = rightMatch[1];
        const joined = `${left}${right}`.toLocaleLowerCase();
        const leftToken = left.toLocaleLowerCase();
        const rightToken = right.toLocaleLowerCase();
        const knownJoinedToken = profile.intactTokens.has(joined);
        const isFragment = !profile.intactTokens.has(leftToken) || !profile.intactTokens.has(rightToken);
        const oneCharacterShard = left.length === 1 || right.length === 1;
        if (!knownJoinedToken || (!isFragment && !oneCharacterShard)) continue;

        const replacement = `${left}${right}`;
        const leftPrefix = lines[index].slice(0, leftMatch.index);
        const rightSuffix = lines[index + 1].slice((rightMatch.index || 0) + rightMatch[0].length);
        lines[index] = `${leftPrefix}${replacement}${rightSuffix}`;
        lines[index + 1] = '';
        joins.push(`${left}${leftMatch[2]} + ${right} -> ${replacement}`);
    }

    return {
        value: lines.join('\n'),
        samples: joins,
    };
};

const normalizeOcrReferences = (
    text: string,
    profile: ContentQualityProfile,
    mode: ReferenceHandlingMode,
): { value: string; samples: string[] } => {
    if (mode === 'keep' || profile.referenceMarkerCount < 3) return { value: text, samples: [] };

    const samples: string[] = [];
    const replacement = mode === 'compact' ? ' [ref] ' : ' ';
    const value = text.replace(OCR_REFERENCE_CANDIDATE_PATTERN, (candidate, ...args: unknown[]) => {
        const offset = args.at(-2);
        const fullText = args.at(-1);
        if (typeof offset !== 'number' || typeof fullText !== 'string' || !isOcrReferenceCandidate(fullText, offset, candidate.length)) {
            return candidate;
        }
        samples.push(candidate);
        return replacement;
    }).replace(/(?:\s*\[ref\]\s*){2,}/gi, ' [ref] ').replace(/[ \t]{2,}/g, ' ');

    return { value, samples };
};

const removeRepeatedEdgeLines = (
    text: string,
    profile: ContentQualityProfile,
): { value: string; samples: string[] } => {
    const lines = text.split('\n');
    const removed: string[] = [];

    const removeRepeatedTokenSpan = (value: string, fromStart: boolean): { value: string; sample?: string } => {
        const tokenMatches = [...value.matchAll(/\S+/g)];
        if (tokenMatches.length < 2) return { value };

        const candidateCounts = Array.from({ length: Math.min(6, tokenMatches.length) - 1 }, (_, index) => index + 2)
            .sort((left, right) => right - left);
        for (const count of candidateCounts) {
            const selected = fromStart
                ? tokenMatches.slice(0, count)
                : tokenMatches.slice(-count);
            const lastSelected = selected.at(-1);
            if (!lastSelected) continue;
            const signature = normalizeEdgeSignature(selected.map((match) => match[0]).join(' '));
            if (!profile.repeatedEdgeSignatures.has(signature) || isGenericHeadingSignature(signature)) continue;
            const hasNumberEvidence = selected.some((match) => /\d/u.test(match[0]));
            const uppercaseWordCount = selected.filter((match) => /^[A-Z][A-Z.'-]*$/u.test(match[0])).length;
            if (!hasNumberEvidence && uppercaseWordCount < 2) continue;

            if (fromStart) {
                const end = lastSelected.index + lastSelected[0].length;
                return {
                    value: value.slice(end).replace(/^\s+/, ''),
                    sample: value.slice(0, end).trim(),
                };
            }

            const start = selected[0].index;
            return {
                value: value.slice(0, start).replace(/\s+$/, ''),
                sample: value.slice(start).trim(),
            };
        }
        return { value };
    };

    const removeFromStart = () => {
        while (true) {
            const index = lines.findIndex((line) => line.trim().length > 0);
            if (index < 0) return;
            const line = lines[index].replace(/\s+/g, ' ').trim();
            const signature = normalizeEdgeSignature(line);
            if (!profile.repeatedEdgeSignatures.has(signature) || isGenericHeadingSignature(signature)) return;
            removed.push(line);
            lines.splice(index, 1);
        }
    };

    const removeFromEnd = () => {
        while (true) {
            let index = lines.length - 1;
            while (index >= 0 && lines[index].trim().length === 0) index -= 1;
            if (index < 0) return;
            const line = lines[index].replace(/\s+/g, ' ').trim();
            const signature = normalizeEdgeSignature(line);
            if (!profile.repeatedEdgeSignatures.has(signature) || isGenericHeadingSignature(signature)) return;
            removed.push(line);
            lines.splice(index, 1);
        }
    };

    removeFromStart();
    removeFromEnd();

    const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstContentIndex >= 0) {
        const result = removeRepeatedTokenSpan(lines[firstContentIndex], true);
        if (result.sample) {
            lines[firstContentIndex] = result.value;
            removed.push(result.sample);
        }
    }

    let lastContentIndex = lines.length - 1;
    while (lastContentIndex >= 0 && lines[lastContentIndex].trim().length === 0) lastContentIndex -= 1;
    if (lastContentIndex >= 0) {
        const result = removeRepeatedTokenSpan(lines[lastContentIndex], false);
        if (result.sample) {
            lines[lastContentIndex] = result.value;
            removed.push(result.sample);
        }
    }

    return {
        value: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        samples: removed,
    };
};

const boundedSamples = (values: string[]): string[] => [...new Set(values
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, 3);

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const getCorruptTokens = (text: string): string[] => text
    .split(/\s+/)
    .filter((token) => CORRUPT_TOKEN_PATTERN.test(token));

const getArtifactDensity = (text: string): number => {
    const wordCount = countWords(text);
    return wordCount === 0 ? 0 : getCorruptTokens(text).length / wordCount;
};

export const validateFinalContent = (
    text: string,
    options: FinalContentGuardOptions = {},
): string[] => {
    const issues: string[] = [];
    if (options.requireContent && text.trim().length === 0) {
        issues.push('accepted prose resolved to empty output');
    }
    if ([...text].some(isForbiddenControlCharacter)) {
        issues.push('forbidden control characters remain');
    }
    if (OCR_CONFIDENCE_WARNING.test(text)) {
        issues.push('OCR confidence warning remains in output');
    }
    if (options.baselineText && getArtifactDensity(text) > getArtifactDensity(options.baselineText) + 0.02) {
        issues.push('artifact density increased during final cleanup');
    }
    return issues;
};

const normalizeControls = (value: string): { value: string; removed: string[] } => {
    const removed: string[] = [];
    const normalized = value
        .replace(/\r\n?/g, '\n')
        .normalize('NFC')
        .split('')
        .filter((character) => {
            if (isForbiddenControlCharacter(character)) {
                removed.push(character);
                return false;
            }
            return true;
        })
        .join('');

    return { value: normalized, removed };
};

const createIssue = (
    type: ContentIssueType,
    confidence: number,
    samples: string[],
    count = samples.length,
): ContentQualityIssue => ({
    type,
    confidence,
    count,
    samples: boundedSamples(samples),
});

const getOcrConfidence = (text: string): number | undefined => {
    const match = text.match(OCR_CONFIDENCE_WARNING);
    if (!match) return undefined;
    return Number(match[1]);
};

const getQualityScore = (issues: ContentQualityIssue[], wordCount: number): number => {
    if (wordCount === 0) return 0;

    const penalty = issues.reduce((total, issue) => {
        if (issue.type === 'low-ocr-confidence') return total + 0.7;
        if (issue.type === 'scan-matter') return total + 0.65;
        if (issue.type === 'corrupt-span') return total + Math.min(0.5, issue.count / Math.max(1, wordCount));
        if (issue.type === 'malformed-prose-markup') return total + Math.min(0.3, issue.count / Math.max(1, wordCount));
        if (issue.type === 'control-character') return total + Math.min(0.15, issue.count / Math.max(1, wordCount));
        return total;
    }, 0);

    return Math.max(0, Math.min(1, 1 - penalty));
};

export const analyzeContentUnits = (units: RawContentUnit[]): ContentQualityProfile => {
    const edgeOccurrences = new Map<string, number>();
    const intactTokens = new Set<string>();
    let referenceMarkerCount = 0;

    for (const unit of units) {
        const words = unit.text.split(/\s+/).filter(Boolean);
        referenceMarkerCount += getOcrReferenceCandidates(unit.text).length;
        for (const word of words) {
            const normalized = word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
            if (normalized) intactTokens.add(normalized);
        }

        const unitEdgeSignatures = new Set<string>();
        for (const line of getEdgeLines(unit)) {
            const signature = normalizeEdgeSignature(line);
            if (!signature || isGenericHeadingSignature(signature)) continue;
            unitEdgeSignatures.add(signature);
        }
        for (const edge of [words.slice(0, 8), words.slice(-8)]) {
            if (edge.length === 0) continue;
            const signature = normalizeEdgeSignature(edge.join(' '));
            if (signature && !isGenericHeadingSignature(signature)) unitEdgeSignatures.add(signature);
        }
        for (const edge of [words.slice(0, 12), words.slice(-12)]) {
            for (let start = 0; start < Math.min(5, edge.length); start += 1) {
                for (let length = 2; length <= 6 && start + length <= edge.length; length += 1) {
                    const signature = normalizeEdgeSignature(edge.slice(start, start + length).join(' '));
                    if (!isGenericHeadingSignature(signature)) unitEdgeSignatures.add(signature);
                }
            }
        }
        for (const signature of unitEdgeSignatures) {
            edgeOccurrences.set(signature, (edgeOccurrences.get(signature) || 0) + 1);
        }
    }

    return {
        repeatedEdgeSignatures: new Set(
            [...edgeOccurrences.entries()]
                .filter(([, count]) => count >= 3)
                .map(([signature]) => signature),
        ),
        intactTokens,
        referenceMarkerCount,
    };
};

export const cleanContentUnit = (
    unit: RawContentUnit,
    _profile: ContentQualityProfile = { repeatedEdgeSignatures: new Set(), intactTokens: new Set(), referenceMarkerCount: 0 },
    options: ContentQualityOptions = {},
): ContentQualityResult => {
    const lowConfidenceThreshold = options.lowConfidenceOcrThreshold ?? CONTENT_QUALITY_THRESHOLDS.lowConfidenceOcr;
    const degradedThreshold = options.degradedOcrThreshold ?? CONTENT_QUALITY_THRESHOLDS.degradedOcr;
    const referenceHandling = options.referenceHandling ?? 'keep';
    const normalizedText = normalizeControls(unit.text);
    const normalizedHtml = normalizeControls(unit.html);
    const issues: ContentQualityIssue[] = [];
    const wordCount = countWords(normalizedText.value);
    const ocrConfidence = getOcrConfidence(normalizedText.value);
    const corruptTokens = getCorruptTokens(normalizedText.value);
    const markupRecords = unit.markupRecovery?.records || [];
    const unresolvedMarkupRecords = markupRecords.filter((record) => (
        record.action === 'abstain'
        && record.recoveredTokenCount >= 8
        && !record.protectedContext
    ));

    if (normalizedText.removed.length > 0 || normalizedHtml.removed.length > 0) {
        issues.push(createIssue(
            'control-character',
            1,
            [...normalizedText.removed, ...normalizedHtml.removed],
            normalizedText.removed.length + normalizedHtml.removed.length,
        ));
    }

    if (ocrConfidence !== undefined) {
        issues.push(createIssue(
            'low-ocr-confidence',
            ocrConfidence <= lowConfidenceThreshold ? 1 : 0.8,
            [normalizedText.value.match(OCR_CONFIDENCE_WARNING)?.[0] || 'OCR confidence warning'],
            1,
        ));
    }

    const hasScanMatter = SCAN_MATTER_PATTERN.test(normalizedText.value) || hasBarcodeLikeToken(normalizedText.value);
    if (hasScanMatter) {
        issues.push(createIssue('scan-matter', 0.9, [normalizedText.value.slice(0, 240)], 1));
    }

    if (PUBLICATION_MATTER_PATTERN.test(normalizedText.value)) {
        issues.push(createIssue('publication-matter', 0.75, [normalizedText.value.slice(0, 240)], 1));
    }

    if (corruptTokens.length > 0) {
        issues.push(createIssue('corrupt-span', 0.55, corruptTokens, corruptTokens.length));
    }

    if (markupRecords.length > 0) {
        issues.push(createIssue(
            'malformed-prose-markup',
            Math.max(...markupRecords.map((record) => record.confidence)),
            markupRecords.flatMap((record) => [record.rawSample, record.recoveredSample]),
            markupRecords.length,
        ));
    }

    const corruptionRatio = corruptTokens.length / Math.max(1, wordCount);
    const hasStrongOcrFailure = ocrConfidence !== undefined && ocrConfidence < lowConfidenceThreshold;
    const hasDegradedOcr = ocrConfidence !== undefined && ocrConfidence < degradedThreshold;
    const sourceZone = detectContentZone(normalizedText.value);
    const isSmallScanMatter = wordCount <= CONTENT_QUALITY_THRESHOLDS.scanMatterWordLimit && hasScanMatter;
    const isLowConfidenceWithMatter = hasDegradedOcr
        && (hasScanMatter || PUBLICATION_MATTER_PATTERN.test(normalizedText.value));
    const isDominatedByCorruption = wordCount > 0
        && corruptionRatio >= CONTENT_QUALITY_THRESHOLDS.corruptionRejectRatio
        && wordCount <= CONTENT_QUALITY_THRESHOLDS.scanMatterWordLimit;
    const hasSubstantialUnresolvedMarkup = unresolvedMarkupRecords.length > 0;
    const hasMarkupRecovery = markupRecords.length > 0;
    const shouldReject = hasStrongOcrFailure
        || isSmallScanMatter
        || isLowConfidenceWithMatter
        || isDominatedByCorruption
        || hasSubstantialUnresolvedMarkup;
    const decision: ContentQualityDecision = shouldReject
        ? 'reject'
        : (hasDegradedOcr || corruptionRatio > 0 || hasMarkupRecovery ? 'accept-degraded' : 'accept');
    const furniture = removeRepeatedEdgeLines(normalizedText.value, _profile);
    if (furniture.samples.length > 0) {
        issues.push(createIssue('page-furniture', 0.9, furniture.samples, furniture.samples.length));
    }
    const hardWraps = repairHardWraps(furniture.value, _profile);
    if (hardWraps.samples.length > 0) {
        issues.push(createIssue('hard-wrap', 0.85, hardWraps.samples, hardWraps.samples.length));
    }
    const zone = shouldReject ? 'rejected-ocr' : sourceZone;
    const references = normalizeOcrReferences(hardWraps.value, _profile, referenceHandling);
    if (references.samples.length > 0) {
        issues.push(createIssue('reference-marker', 0.8, references.samples, references.samples.length));
    }
    const cleanedText = zone === 'notes' && referenceHandling !== 'keep' ? '' : references.value;

    return {
        decision,
        cleanedHtml: normalizedHtml.value,
        cleanedText,
        issues,
        removedCharacters: normalizedText.removed.length + normalizedText.value.length - cleanedText.length,
        qualityScore: getQualityScore(issues, wordCount),
        zone,
        reason: shouldReject
            ? hasStrongOcrFailure
                ? `OCR confidence below ${lowConfidenceThreshold}%`
                : isSmallScanMatter
                    ? 'Likely library or scan matter'
                    : isLowConfidenceWithMatter
                        ? 'Low-confidence OCR combined with publication or scan matter'
                        : hasSubstantialUnresolvedMarkup
                            ? 'Unresolved malformed prose markup may cause parser text loss'
                        : 'Source unit is dominated by corrupt OCR spans'
            : undefined,
    };
};
