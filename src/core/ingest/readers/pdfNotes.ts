import type { PdfBox, PdfLayoutLine, PdfLayoutRegion, PdfRegionRole } from './pdfLayout';

export type PdfNoteKind = 'footnote' | 'endnote' | 'translator-note' | 'editor-note' | 'unknown';

export interface PdfNoteEntry {
    id: string;
    kind: PdfNoteKind;
    label?: string;
    text: string;
    pageStart: number;
    pageEnd: number;
    sourceRegionIds: string[];
    confidence: number;
    issues: string[];
}

export interface PdfNoteAnchor {
    id: string;
    noteId: string;
    chapterId: string;
    wordIndex: number;
    sourcePage: number;
    markerText?: string;
    confidence: number;
    evidence: string[];
}

export interface PdfNotesResult {
    regions: PdfLayoutRegion[];
    notes: PdfNoteEntry[];
}

export interface PdfNoteLinkResult {
    anchors: PdfNoteAnchor[];
    unresolvedCallouts: number;
}

const NOTE_HEADING_PATTERN = /^(?:notes?|endnotes?|translator['’]?s notes?|editor(?:ial)? notes?)$/i;
const CAPTION_PATTERN = /^(?:fig(?:ure)?\.?|table|source)\s*[:.\d]/i;
const NOTE_LABEL_PATTERN = /^(?<label>(?:\d{1,3}|[ivxlcdm]{1,8}|[*†‡]+))[.)]?\s+(?<body>\S.*)$/i;

const clampConfidence = (value: number): number => Math.min(1, Math.max(0, value));

const boxWidth = (box: PdfBox): number => Math.max(0, box.x1 - box.x0);

const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

const getRegionWordHeights = (region: PdfLayoutRegion): number[] => region.lines
    .flatMap((line) => line.words.map((word) => word.box.y1 - word.box.y0))
    .filter((height) => height > 0);

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const getDocumentBodyHeight = (regions: PdfLayoutRegion[]): number => median(regions
    .filter((region) => region.role === 'body' && region.box.y0 < 0.68)
    .flatMap(getRegionWordHeights));

const getPageBodyHeight = (regions: PdfLayoutRegion[], pageNumber: number): number => median(regions
    .filter((region) => region.pageNumber === pageNumber && region.role === 'body' && region.box.y0 < 0.68)
    .flatMap(getRegionWordHeights));

const getLeadingLabel = (text: string): { label: string; body: string } | undefined => {
    const match = text.trim().match(NOTE_LABEL_PATTERN);
    if (!match?.groups?.label || !match.groups.body) return undefined;
    return { label: match.groups.label, body: match.groups.body };
};

const normalizeLabel = (label: string): string => label.replace(/[.)]/g, '').toLowerCase();

const getWordTokens = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

const getMarkerLabel = (text: string): string | undefined => {
    const normalized = text.trim().replace(/[()[\]{}.,:;]+$/g, '');
    if (/^\d{1,3}$/.test(normalized)) return normalized;
    if (/^[*†‡]+$/.test(normalized)) return normalized;
    return undefined;
};

const isFormulaLike = (text: string): boolean => (
    /^S\(?[0-9Ⱥa-z]?[)]?$/.test(text)
    || /^[a-zA-Z]$/.test(text)
    || /^[A-Za-z]\d+$/.test(text)
    || /^[$=+\-_/^]+$/.test(text)
);

const isFormulaContext = (lineWords: PdfLayoutRegion['lines'][number]['words'], index: number): boolean => {
    const previous = lineWords[index - 1]?.text.trim();
    return previous === 'S' || previous === '$' || previous === '=';
};

const countLeadingLabels = (region: PdfLayoutRegion): number => region.lines
    .filter((line) => getLeadingLabel(line.text))
    .length;

const isEdgeRegion = (region: PdfLayoutRegion): boolean => region.box.y0 >= 0.88 || region.box.y1 <= 0.12;

const getRecurringEdgeTexts = (regions: PdfLayoutRegion[]): Set<string> => {
    const counts = new Map<string, number>();
    for (const region of regions) {
        if (!isEdgeRegion(region)) continue;
        const text = normalizeText(region.text);
        if (text.split(' ').length > 12) continue;
        counts.set(text, (counts.get(text) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([text]) => text));
};

const withClassification = (
    region: PdfLayoutRegion,
    role: PdfRegionRole,
    confidence: number,
    evidence: string[],
): PdfLayoutRegion => ({
    ...region,
    role,
    confidence: clampConfidence(confidence),
    evidence: [...new Set([...region.evidence, ...evidence])],
});

export const classifyPdfRegions = (regions: PdfLayoutRegion[]): PdfLayoutRegion[] => {
    const recurringEdgeTexts = getRecurringEdgeTexts(regions);
    const documentBodyHeight = getDocumentBodyHeight(regions);

    return regions.map((region) => {
        if (region.role !== 'body' && region.role !== 'unknown') return region;
        const normalizedText = normalizeText(region.text);
        if (recurringEdgeTexts.has(normalizedText)) {
            return withClassification(region, 'running-furniture', 0.98, ['recurring-edge-text']);
        }
        if (NOTE_HEADING_PATTERN.test(region.text.trim())) {
            return withClassification(region, 'heading', 0.96, ['note-section-heading']);
        }
        if (CAPTION_PATTERN.test(region.text.trim())) {
            return withClassification(region, 'caption', 0.72, ['caption-like-leading-label']);
        }

        const pageBodyHeight = getPageBodyHeight(regions, region.pageNumber) || documentBodyHeight;
        const regionWordHeight = median(getRegionWordHeights(region));
        const bottomPosition = region.box.y0 >= 0.68;
        const smallerType = pageBodyHeight > 0 && regionWordHeight < pageBodyHeight * 0.82;
        const labelCount = countLeadingLabels(region);
        const labeledEntries = labelCount > 0;
        const narrowMargin = boxWidth(region.box) <= 0.2 && (region.box.x0 <= 0.08 || region.box.x1 >= 0.92);

        if (narrowMargin && smallerType && labeledEntries) {
            return withClassification(region, 'marginal-note', 0.82, [
                'outer-margin-placement',
                'smaller-than-body-type',
                'labeled-note-entry',
            ]);
        }
        if (bottomPosition && smallerType && labeledEntries) {
            return withClassification(region, 'footnote', clampConfidence(0.62 + (labelCount > 1 ? 0.12 : 0)), [
                'bottom-region-placement',
                'smaller-than-body-type',
                'labeled-note-entry',
            ]);
        }
        return region;
    });
};

const getNoteKind = (region: PdfLayoutRegion): PdfNoteKind => {
    if (region.role === 'footnote') return 'footnote';
    if (region.role === 'endnote') return 'endnote';
    if (region.role === 'marginal-note') return 'translator-note';
    return 'unknown';
};

interface NoteSegment {
    label?: string;
    lines: PdfLayoutLine[];
    issues: string[];
}

const segmentRegion = (region: PdfLayoutRegion): NoteSegment[] => {
    const segments: NoteSegment[] = [];
    for (const line of region.lines) {
        const leadingLabel = getLeadingLabel(line.text);
        if (leadingLabel) {
            segments.push({ label: leadingLabel.label, lines: [line], issues: [] });
        } else if (segments.length > 0) {
            segments[segments.length - 1].lines.push(line);
        } else {
            segments.push({ lines: [line], issues: ['missing-note-label'] });
        }
    }
    return segments;
};

const segmentText = (segment: NoteSegment): string => segment.lines.map((line, index) => {
    if (index > 0 || !segment.label) return line.text;
    const leadingLabel = getLeadingLabel(line.text);
    return leadingLabel?.body || line.text;
}).join('\n').trim();

const createNote = (region: PdfLayoutRegion, segment: NoteSegment, index: number): PdfNoteEntry => ({
    id: `${region.id}-n${index}`,
    kind: getNoteKind(region),
    label: segment.label,
    text: segmentText(segment),
    pageStart: region.pageNumber,
    pageEnd: region.pageNumber,
    sourceRegionIds: [region.id],
    confidence: clampConfidence(region.confidence - (segment.issues.length > 0 ? 0.18 : 0)),
    issues: segment.issues,
});

export const extractPdfNotes = (regions: PdfLayoutRegion[]): PdfNotesResult => {
    const classifiedRegions = classifyPdfRegions(regions);
    const notes = classifiedRegions
        .filter((region) => region.role === 'footnote'
            || region.role === 'endnote'
            || region.role === 'marginal-note')
        .flatMap((region) => segmentRegion(region).map((segment, index) => createNote(region, segment, index)));
    return { regions: classifiedRegions, notes };
};

export const linkPdfNoteAnchors = (
    regions: PdfLayoutRegion[],
    notes: PdfNoteEntry[],
    chapterId = 'document',
): PdfNoteLinkResult => {
    const notesByLabel = new Map<string, PdfNoteEntry[]>();
    for (const note of notes) {
        if (!note.label) continue;
        const label = normalizeLabel(note.label);
        notesByLabel.set(label, [...(notesByLabel.get(label) || []), note]);
    }

    const anchors: PdfNoteAnchor[] = [];
    const usedNoteIds = new Set<string>();
    let bodyWordIndex = 0;
    let unresolvedCallouts = 0;
    const bodyRegions = regions
        .filter((region) => region.role === 'body' || region.role === 'heading' || region.role === 'unknown')
        .sort((left, right) => left.pageNumber - right.pageNumber || left.box.y0 - right.box.y0 || left.id.localeCompare(right.id));

    for (const region of bodyRegions) {
        for (const line of region.lines) {
            const lineHeight = median(line.words.map((word) => word.box.y1 - word.box.y0));
            for (const [wordOffset, word] of line.words.entries()) {
                const tokens = getWordTokens(word.text);
                const markerLabel = tokens.length === 1 ? getMarkerLabel(tokens[0]) : undefined;
                const smallMarker = lineHeight > 0 && (word.box.y1 - word.box.y0) < lineHeight * 0.85;
                const elevatedMarker = word.baseline < line.baseline - Math.max(lineHeight * 0.12, 0.002);
                if (markerLabel
                    && !isFormulaLike(word.text)
                    && !isFormulaContext(line.words, wordOffset)
                    && (smallMarker || elevatedMarker)) {
                    const candidates = notesByLabel.get(normalizeLabel(markerLabel)) || [];
                    const note = candidates.find((candidate) => !usedNoteIds.has(candidate.id))
                        || candidates.find((candidate) => candidate.pageStart === region.pageNumber);
                    if (!note) {
                        unresolvedCallouts++;
                    } else {
                        usedNoteIds.add(note.id);
                        anchors.push({
                            id: `${region.id}-w${bodyWordIndex}-n${note.id}`,
                            noteId: note.id,
                            chapterId,
                            wordIndex: bodyWordIndex,
                            sourcePage: region.pageNumber,
                            markerText: word.text,
                            confidence: note.pageStart === region.pageNumber ? 0.96 : 0.78,
                            evidence: [
                                'exact-label-match',
                                ...(note.pageStart === region.pageNumber ? ['same-page-match'] : []),
                                ...(smallMarker ? ['smaller-marker'] : []),
                                ...(elevatedMarker ? ['elevated-marker'] : []),
                            ],
                        });
                    }
                }
                bodyWordIndex += tokens.length;
            }
        }
    }

    return { anchors, unresolvedCallouts };
};