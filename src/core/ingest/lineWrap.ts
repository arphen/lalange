/**
 * Repairs words split across a source line break (hard wraps), e.g. "evo-" +
 * "lution" -> "evolution", using book-local word evidence plus a small set of
 * orthographic heuristics. Shared by every ingest reader so a wrap is resolved
 * once, while newline structure still distinguishes an intra-paragraph wrap
 * from a real paragraph or page boundary.
 */

export interface LineWrapProfile {
    /** lowercased, edge-punctuation-stripped tokens with no internal hyphen */
    intactTokens: ReadonlySet<string>;
    /** lowercased, edge-punctuation-stripped tokens with an internal hyphen, e.g. 'self-aware' */
    hyphenatedTokens: ReadonlySet<string>;
}

export interface LineWrapResult {
    value: string;
    samples: string[];
}

const SOFT_HYPHEN = '­';
const HYPHEN_CHAR_CLASS = '-‐‑­';
const NUMBER_WORDS = new Set(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
// A larger set (pre, re, sub, ex, anti, multi, semi, co, under, over...) looks appealing but is
// wrong far more often than right: those strings are common syllable onsets, not just prefixes
// -- re-/member, pre-/sent, sub-/ject, under-/stand, ex-/it, anti-/thesis would all be wrongly
// kept hyphenated. Anything outside this short list is left to book-local attestation instead.
const SAFE_HYPHEN_PREFIXES = new Set(['self', 'non', 'quasi', 'pseudo']);

const LEFT_WRAP_PATTERN = new RegExp(`([\\p{L}\\p{N}]+)([${HYPHEN_CHAR_CLASS}])?[ \\t]*$`, 'u');
const RIGHT_WRAP_PATTERN = /^[ \t]*([\p{L}\p{N}]+)/u;
const TRAILING_HYPHEN_PATTERN = new RegExp(`[${HYPHEN_CHAR_CLASS}]$`);
const EDGE_PUNCTUATION_PATTERN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const decideHyphenJoin = (
    leftPrefixEndsWithHyphen: boolean,
    left: string,
    hyphen: string,
    right: string,
    profile: LineWrapProfile,
): boolean => {
    if (hyphen === SOFT_HYPHEN) return false;

    const leftLower = left.toLocaleLowerCase();
    const rightLower = right.toLocaleLowerCase();

    if (/\d/.test(left) || /\d/.test(right) || NUMBER_WORDS.has(leftLower)) return true;

    const hyphenatedForm = `${leftLower}-${rightLower}`;
    const joinedForm = `${leftLower}${rightLower}`;
    if (profile.hyphenatedTokens.has(hyphenatedForm) && !profile.intactTokens.has(joinedForm)) return true;
    if (profile.intactTokens.has(joinedForm)) return false;
    if (leftPrefixEndsWithHyphen) return true;
    if (/^\p{Lu}/u.test(right) && !/^\p{Lu}+$/u.test(left)) return true;
    if (SAFE_HYPHEN_PREFIXES.has(leftLower) && profile.intactTokens.has(rightLower)) return true;

    return false;
};

const shouldJoinUnhyphenated = (left: string, right: string, profile: LineWrapProfile): boolean => {
    const leftLower = left.toLocaleLowerCase();
    const rightLower = right.toLocaleLowerCase();
    const joined = `${leftLower}${rightLower}`;
    if (!profile.intactTokens.has(joined)) return false;

    const isFragment = !profile.intactTokens.has(leftLower) || !profile.intactTokens.has(rightLower);
    const oneCharacterShard = left.length === 1 || right.length === 1;
    return isFragment || oneCharacterShard;
};

const resolveWrapsInLines = (lines: string[], profile: LineWrapProfile): { lines: string[]; samples: string[] } => {
    const samples: string[] = [];
    let index = 0;

    while (index < lines.length - 1) {
        const leftMatch = lines[index].match(LEFT_WRAP_PATTERN);
        const rightMatch = lines[index + 1].match(RIGHT_WRAP_PATTERN);
        if (!leftMatch || !rightMatch) {
            index += 1;
            continue;
        }

        const left = leftMatch[1];
        const hyphen = leftMatch[2];
        const right = rightMatch[1];
        const leftPrefix = lines[index].slice(0, leftMatch.index);

        let keepHyphen: boolean | undefined;
        if (hyphen) {
            keepHyphen = decideHyphenJoin(TRAILING_HYPHEN_PATTERN.test(leftPrefix), left, hyphen, right, profile);
        } else if (shouldJoinUnhyphenated(left, right, profile)) {
            keepHyphen = false;
        }

        if (keepHyphen === undefined) {
            index += 1;
            continue;
        }

        const joinedWord = keepHyphen ? `${left}${hyphen}${right}` : `${left}${right}`;
        const rightSuffix = lines[index + 1].slice(rightMatch[0].length);
        lines[index] = `${leftPrefix}${joinedWord}${rightSuffix}`;
        lines.splice(index + 1, 1);
        samples.push(`${left}${hyphen ?? ''} + ${right} -> ${joinedWord}`);
        // Re-examine the same index: the merged line may itself end in a hyphen
        // (a wrap spanning three or more source lines).
    }

    return { lines, samples };
};

export const repairLineWraps = (text: string, profile: LineWrapProfile): LineWrapResult => {
    const { lines, samples } = resolveWrapsInLines(text.split('\n'), profile);
    return { value: lines.join('\n').replace(new RegExp(SOFT_HYPHEN, 'g'), ''), samples };
};

/**
 * Like repairLineWraps, but for an ordered sequence of larger segments (e.g. PDF
 * pages) where a segment boundary carries no blank-line signal. A segment can
 * legitimately end at a paragraph end with nothing marking "don't join", so a
 * hyphen at the boundary is the only safe signal to join across segments --
 * unhyphenated joins never cross a segment boundary.
 */
export const repairLineWrapsAcrossSegments = (
    segments: string[],
    profile: LineWrapProfile,
): { segments: string[]; samples: string[] } => {
    const samples: string[] = [];
    const segmentLines = segments.map((segment) => {
        const { lines, samples: segmentSamples } = resolveWrapsInLines(segment.split('\n'), profile);
        samples.push(...segmentSamples);
        return lines;
    });

    for (let index = 0; index < segmentLines.length - 1; index += 1) {
        const leftLines = segmentLines[index];
        const rightLines = segmentLines[index + 1];
        if (leftLines.length === 0 || rightLines.length === 0) continue;

        const leftLine = leftLines[leftLines.length - 1];
        const rightLine = rightLines[0];
        const leftMatch = leftLine.match(LEFT_WRAP_PATTERN);
        const rightMatch = rightLine.match(RIGHT_WRAP_PATTERN);
        if (!leftMatch || !rightMatch || !leftMatch[2]) continue;

        const left = leftMatch[1];
        const hyphen = leftMatch[2];
        const right = rightMatch[1];
        const leftPrefix = leftLine.slice(0, leftMatch.index);
        const keepHyphen = decideHyphenJoin(TRAILING_HYPHEN_PATTERN.test(leftPrefix), left, hyphen, right, profile);
        const joinedWord = keepHyphen ? `${left}${hyphen}${right}` : `${left}${right}`;

        // Only the word itself crosses the boundary -- the rest of the right
        // segment's line stays attributed to the right segment, so page/slice
        // boundaries aren't disturbed by a wrap repair.
        leftLines[leftLines.length - 1] = `${leftPrefix}${joinedWord}`;
        rightLines[0] = rightLine.slice(rightMatch[0].length);
        samples.push(`${left}${hyphen} + ${right} -> ${joinedWord} (cross-segment)`);
    }

    return {
        segments: segmentLines.map((lines) => lines.join('\n').replace(new RegExp(SOFT_HYPHEN, 'g'), '')),
        samples,
    };
};

export const buildLineWrapProfile = (texts: Iterable<string>): LineWrapProfile => {
    const intactTokens = new Set<string>();
    const hyphenatedTokens = new Set<string>();

    for (const text of texts) {
        const lines = text.split('\n');
        const excludedLeftEnds = new Set<number>();
        const excludedRightStarts = new Set<number>();
        for (let index = 0; index < lines.length - 1; index += 1) {
            const leftMatch = lines[index].match(LEFT_WRAP_PATTERN);
            const rightMatch = lines[index + 1].match(RIGHT_WRAP_PATTERN);
            if (leftMatch?.[2] && rightMatch) {
                excludedLeftEnds.add(index);
                excludedRightStarts.add(index + 1);
            }
        }

        lines.forEach((line, lineIndex) => {
            const rawTokens = line.split(/\s+/).filter(Boolean);
            rawTokens.forEach((raw, tokenIndex) => {
                if (tokenIndex === 0 && excludedRightStarts.has(lineIndex)) return;
                if (tokenIndex === rawTokens.length - 1 && excludedLeftEnds.has(lineIndex)) return;

                const stripped = raw.replace(EDGE_PUNCTUATION_PATTERN, '');
                if (!stripped) return;
                const normalized = stripped.toLocaleLowerCase();
                if (/[-‐‑]/.test(normalized)) {
                    hyphenatedTokens.add(normalized);
                } else {
                    intactTokens.add(normalized);
                }
            });
        });
    }

    return { intactTokens, hyphenatedTokens };
};
