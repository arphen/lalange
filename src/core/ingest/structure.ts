import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { classifyChapter, type ChapterClassification } from './cleaning';
import {
    analyzeContentUnits,
    cleanContentUnit,
    type ContentQualityIssue,
    type ContentQualityProfile,
    type RawContentUnit,
} from './contentQuality';
import {
    recoverMalformedProseMarkup,
    type MarkupRecoveryRecord,
    type MarkupRecoveryResult,
} from './markupRecovery';
import type { ReferenceHandlingMode } from './cleaning';
import {
    defaultStructureDiscoveryRegistry,
    validateStructureProposal,
    type StructureDiscoveryRegistry,
    type StructureProposal,
    type StructureSourceDocument,
} from './structureStrategies';

export type ChapterSource = 'toc' | 'heading' | 'spine' | 'merged';

export type BoundaryEvidence = 'publisher-toc' | 'document-heading' | 'scan-heading' | 'source-spine';
export type SectionOwnership = 'authored' | 'xyz';
export type ReformationReason =
    | 'authored-boundary'
    | 'page-sequence'
    | 'long-section-split'
    | 'short-section-merge'
    | 'format-fallback';
export type StructureMode = 'authored' | 'hybrid' | 'generated';

interface ManifestItem {
    id: string;
    href: string;
    mediaType?: string;
    properties?: string;
    resolvedPath: string;
}

interface SpineItem {
    idref: string;
    href: string;
    resolvedPath: string;
    index: number;
}

interface TocEntry {
    title: string;
    resolvedPath: string;
    fragment?: string;
}

interface ChapterBoundary {
    index: number;
    title: string;
    fragment?: string;
    headingIndex?: number;
    blockIndex?: number;
    evidence?: BoundaryEvidence;
}

export interface ChapterSlice {
    path: string;
    startFragment?: string;
    endFragment?: string;
    startHeadingIndex?: number;
    endHeadingIndex?: number;
    startBlockIndex?: number;
    endBlockIndex?: number;
}

export interface PlannedChapter {
    title: string;
    slices: ChapterSlice[];
    sliceEstimatedWords?: number[];
    estimatedWords: number;
    source: ChapterSource;
    structureOwnership?: SectionOwnership;
    reformationReason?: ReformationReason;
    boundaryEvidence?: BoundaryEvidence[];
    authoredGroupTitle?: string;
    originalTitles?: string[];
}

export interface SourceUnit {
    ordinal: number;
    slices: ChapterSlice[];
    sliceEstimatedWords?: number[];
    estimatedWords: number;
    title?: string;
    boundaryEvidence: BoundaryEvidence;
    authoredGroupTitle?: string;
}

export interface ReadingSectionPlan {
    title: string;
    slices: ChapterSlice[];
    estimatedWords: number;
    source: ChapterSource;
    ownership: SectionOwnership;
    reason: ReformationReason;
    boundaryEvidence: BoundaryEvidence[];
    authoredGroupTitle?: string;
    originalTitles: string[];
}

export interface NormalizedBookStructure {
    version: 1;
    sourceUnits: SourceUnit[];
    sections: ReadingSectionPlan[];
    mode: StructureMode;
}

export interface SkippedPlannedChapter {
    title: string;
    slices: ChapterSlice[];
    estimatedWords: number;
    classificationType: ChapterClassification['type'] | 'quality';
    reason: string;
}

export interface RejectedContentUnit {
    path: string;
    qualityScore: number;
    issues: ContentQualityIssue[];
    reason: string;
}

export interface ContentQualityAuditRecord {
    path: string;
    decision: 'accept' | 'accept-degraded' | 'reject';
    zone?: string;
    qualityScore: number;
    issues: ContentQualityIssue[];
    removedCharacters: number;
    beforeSample: string;
    afterSample: string;
    markupRecovery: {
        records: MarkupRecoveryRecord[];
        repairedCandidateCount: number;
        unresolvedCandidateCount: number;
        recoveredTokenCount: number;
        recoveredCharacterCount: number;
    };
}

export interface LoadedEpubContentDocument {
    path: string;
    rawHtml: string;
    repairedHtml: string;
    recovery: MarkupRecoveryResult;
}

export interface LoadedChapterSlice {
    path: string;
    text: string;
    html: string;
}

export type DeclaredTocState = 'absent' | 'present-empty' | 'present-invalid' | 'present-valid';

export interface StructureCandidateDiagnostic {
    path: string;
    title: string;
    kind: 'dom-heading' | 'scan-heading';
    level?: number;
    ordinal?: number;
    headingIndex?: number;
    blockIndex?: number;
}

export interface StructureDiagnostics {
    declaredToc: {
        nav: { state: DeclaredTocState; paths: string[]; entryCount: number };
        ncx: { state: DeclaredTocState; paths: string[]; entryCount: number };
    };
    toc: {
        collectedEntries: number;
        validatedEntries: number;
        boundaries: number;
        degraded: boolean;
    };
    heading: {
        selectedSource: 'document-heading' | 'scan-heading' | 'none';
        candidates: StructureCandidateDiagnostic[];
        selectedBoundaries: { path: string; title: string; evidence?: BoundaryEvidence }[];
        abstentionReasons: string[];
    };
    sourceUnits: {
        title?: string;
        source: ChapterSource;
        boundaryEvidence: BoundaryEvidence;
        estimatedWords: number;
        paths: string[];
    }[];
    finalSections: {
        title: string;
        source: ChapterSource;
        ownership: SectionOwnership;
        reason: ReformationReason;
        boundaryEvidence: BoundaryEvidence[];
        authoredGroupTitle?: string;
        estimatedWords: number;
        paths: string[];
    }[];
    skipped: {
        title: string;
        classificationType: SkippedPlannedChapter['classificationType'];
        reason: string;
        paths: string[];
    }[];
    qualityRejections: { path: string; reason: string }[];
}

export interface EpubStructurePlan {
    opfPath: string;
    opfDir: string;
    title: string;
    author: string;
    coverManifestId?: string;
    manifest: Record<string, ManifestItem>;
    spine: SpineItem[];
    chapters: PlannedChapter[];
    skippedChapters: SkippedPlannedChapter[];
    qualityRejections: RejectedContentUnit[];
    contentQualityProfile: ContentQualityProfile;
    contentQualityAudit: ContentQualityAuditRecord[];
    structureVersion: 1;
    structureMode: StructureMode;
    structureDiagnostics: StructureDiagnostics;
}

export interface EpubStructureOptions {
    referenceHandling?: ReferenceHandlingMode;
    structureStrategyId?: string;
    structureDiscoveryRegistry?: StructureDiscoveryRegistry;
    bookId?: string;
    sourceHash?: string;
}

const MARKER_START = '__XYZ_CHAPTER_START__';
const MARKER_END = '__XYZ_CHAPTER_END__';
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const decodeUriSafely = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const normalizeArchivePath = (value: string): string => {
    const decoded = decodeUriSafely(value).replace(/\\/g, '/');
    const noQuery = decoded.split('?')[0] || '';
    const absolute = noQuery.startsWith('/');
    const parts = (absolute ? noQuery.slice(1) : noQuery)
        .split('/')
        .filter(Boolean);

    const normalized: string[] = [];
    for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') {
            if (normalized.length > 0) normalized.pop();
            continue;
        }
        normalized.push(part);
    }

    return normalized.join('/');
};

const getDirectoryPath = (value: string): string => {
    const normalized = normalizeArchivePath(value);
    const idx = normalized.lastIndexOf('/');
    if (idx < 0) return '';
    return normalized.slice(0, idx);
};

const getBaseName = (value: string): string => {
    const normalized = normalizeArchivePath(value);
    const idx = normalized.lastIndexOf('/');
    if (idx < 0) return normalized;
    return normalized.slice(idx + 1);
};

const isLikelyNavigationPath = (value: string): boolean => {
    const baseName = getBaseName(value).replace(/\.[^.]+$/, '');
    return /(?:^|[-_.\s])(?:nav|navigation|toc|contents?|table[-_.\s]+of[-_.\s]+contents?)(?:[-_.\s]|$)/i.test(baseName);
};

const resolveArchivePath = (baseDir: string, href: string): string => {
    const decodedHref = decodeUriSafely(href).replace(/\\/g, '/');
    const cleanedHref = decodedHref.split('?')[0] || '';
    if (!cleanedHref) {
        return normalizeArchivePath(baseDir);
    }
    if (cleanedHref.startsWith('/')) {
        return normalizeArchivePath(cleanedHref);
    }
    if (!baseDir) {
        return normalizeArchivePath(cleanedHref);
    }
    return normalizeArchivePath(`${baseDir}/${cleanedHref}`);
};

const splitHref = (href: string): { path: string; fragment?: string } => {
    const hashIndex = href.indexOf('#');
    if (hashIndex < 0) {
        return {
            path: href,
        };
    }

    const rawPath = href.slice(0, hashIndex);
    const rawFragment = href.slice(hashIndex + 1);
    const normalizedFragment = normalizeWhitespace(decodeUriSafely(rawFragment));

    return {
        path: rawPath,
        fragment: normalizedFragment || undefined,
    };
};

const escapeAttrValue = (value: string): string => value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const findFragmentElement = (
    $: cheerio.CheerioAPI,
    fragment: string,
): cheerio.Cheerio<Element> | null => {
    const normalized = normalizeWhitespace(decodeUriSafely(fragment));
    if (!normalized) return null;

    const escaped = escapeAttrValue(normalized);
    const byId = $(`[id="${escaped}"]`).first();
    if (byId.length > 0) return byId;

    const byName = $(`[name="${escaped}"]`).first();
    if (byName.length > 0) return byName;

    return null;
};

const extractReadableTextFromRoot = ($: cheerio.CheerioAPI): string => {
    const body = $('body').first();
    const root = (body.length > 0 ? body : $('html').first()).clone();
    root.find('script, style, noscript, svg').remove();
    root.find('br').replaceWith('\n');
    root.find('p, h1, h2, h3, h4, h5, h6, li, blockquote, section, article').append('\n\n');

    return root
        .text()
        .replace(/\r/g, '')
        .replace(/[\t ]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const extractSliceHtml = (
    html: string,
    startFragment?: string,
    endFragment?: string,
    startHeadingIndex?: number,
    endHeadingIndex?: number,
    startBlockIndex?: number,
    endBlockIndex?: number,
): string => {
    if (
        !startFragment
        && !endFragment
        && startHeadingIndex === undefined
        && endHeadingIndex === undefined
        && startBlockIndex === undefined
        && endBlockIndex === undefined
    ) {
        return html;
    }

    const $ = cheerio.load(html);
    $('script, style, noscript').remove();

    const root = $('body').first();
    const blockRoot: cheerio.Cheerio<Element> = root.length > 0 ? root : $.root().children().first();
    const blocks = blockRoot.find(BLOCK_SELECTOR);

    const findBoundaryElement = (
        fragment: string | undefined,
        headingIndex: number | undefined,
        blockIndex: number | undefined,
    ): cheerio.Cheerio<Element> | null => {
        if (fragment) {
            const fragmentElement = findFragmentElement($, fragment);
            if (fragmentElement) return fragmentElement;
        }
        if (blockIndex !== undefined) {
            const block = blocks.eq(blockIndex);
            if (block.length > 0) return block;
        }
        if (headingIndex !== undefined) {
            const heading = $('h1, h2').eq(headingIndex);
            if (heading.length > 0) return heading;
        }
        return null;
    };

    const startElement = findBoundaryElement(startFragment, startHeadingIndex, startBlockIndex);
    if (startElement && startElement.length > 0) startElement.before(MARKER_START);

    const endElement = findBoundaryElement(endFragment, endHeadingIndex, endBlockIndex);
    if (endElement && endElement.length > 0) endElement.before(MARKER_END);

    const marked = root.length > 0 ? root.html() || '' : $.root().html() || '';
    let working = marked;

    const startIndex = working.indexOf(MARKER_START);
    if (startIndex >= 0) {
        working = working.slice(startIndex + MARKER_START.length);
    }

    const endIndex = working.indexOf(MARKER_END);
    if (endIndex >= 0) {
        working = working.slice(0, endIndex);
    }

    return working;
};

export const extractReadableTextFromHtml = (
    html: string,
    startFragment?: string,
    endFragment?: string,
): string => {
    const slicedHtml = extractSliceHtml(html, startFragment, endFragment);
    const $ = cheerio.load(`<body>${slicedHtml}</body>`);
    $('script, style, noscript').remove();
    return extractReadableTextFromRoot($);
};

const countWords = (text: string): number => {
    const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
    return tokens.length;
};

const findZipEntry = (zip: JSZip, requestedPath: string): JSZip.JSZipObject | null => {
    const normalizedRequested = normalizeArchivePath(requestedPath);
    const direct = zip.file(normalizedRequested);
    if (direct) return direct;

    const decoded = decodeUriSafely(requestedPath);
    const decodedDirect = zip.file(decoded);
    if (decodedDirect) return decodedDirect;

    const requestedBaseName = getBaseName(normalizedRequested).toLowerCase();
    for (const filePath of Object.keys(zip.files)) {
        const normalizedCandidate = normalizeArchivePath(filePath);
        if (normalizedCandidate === normalizedRequested) {
            const match = zip.file(filePath);
            if (match) return match;
        }
    }

    if (requestedBaseName) {
        for (const filePath of Object.keys(zip.files)) {
            const candidateBase = getBaseName(filePath).toLowerCase();
            if (candidateBase === requestedBaseName) {
                const match = zip.file(filePath);
                if (match) return match;
            }
        }
    }

    return null;
};

type ContentDocumentLoader = (path: string) => Promise<LoadedEpubContentDocument>;

const createContentDocumentLoader = (zip: JSZip): ContentDocumentLoader => {
    const cache = new Map<string, LoadedEpubContentDocument>();

    return async (path: string): Promise<LoadedEpubContentDocument> => {
        const normalizedPath = normalizeArchivePath(path);
        const cached = cache.get(normalizedPath);
        if (cached) return cached;

        const entry = findZipEntry(zip, normalizedPath);
        const rawHtml = entry ? await entry.async('string') : '';
        const recovery = recoverMalformedProseMarkup(rawHtml);
        const loaded: LoadedEpubContentDocument = {
            path: normalizedPath,
            rawHtml,
            repairedHtml: recovery.html,
            recovery,
        };
        cache.set(normalizedPath, loaded);
        return loaded;
    };
};

const resolveOpfPath = async (zip: JSZip): Promise<string> => {
    const container = zip.file('META-INF/container.xml');
    if (container) {
        const containerXml = await container.async('string');
        const $container = cheerio.load(containerXml, { xmlMode: true });
        const rootFile = $container('rootfile').first().attr('full-path');
        if (rootFile) {
            return normalizeArchivePath(rootFile);
        }
    }

    const fallbackOpf = Object.keys(zip.files).find((filePath) => filePath.toLowerCase().endsWith('.opf'));
    if (!fallbackOpf) {
        throw new Error('Invalid EPUB: No OPF file found');
    }

    return normalizeArchivePath(fallbackOpf);
};

const buildPathLookup = (spine: SpineItem[]) => {
    const exactLookup = new Map<string, number[]>();
    const basenameLookup = new Map<string, number[]>();

    const pushLookup = (lookup: Map<string, number[]>, key: string, index: number) => {
        if (!key) return;
        const existing = lookup.get(key);
        if (existing) {
            if (!existing.includes(index)) existing.push(index);
        } else {
            lookup.set(key, [index]);
        }
    };

    for (const item of spine) {
        pushLookup(exactLookup, normalizeArchivePath(item.resolvedPath), item.index);
        pushLookup(exactLookup, normalizeArchivePath(item.href), item.index);

        const baseName = getBaseName(item.resolvedPath).toLowerCase();
        pushLookup(basenameLookup, baseName, item.index);
    }

    return { exactLookup, basenameLookup };
};

const resolveTocEntryToIndex = (
    entry: TocEntry,
    lookups: ReturnType<typeof buildPathLookup>,
    minIndex: number,
): number | null => {
    const normalizedPath = normalizeArchivePath(entry.resolvedPath);
    const exactCandidates = lookups.exactLookup.get(normalizedPath) || [];
    const viableExact = exactCandidates.filter((candidate) => candidate >= minIndex);
    if (viableExact.length > 0) {
        return viableExact[0];
    }

    const baseName = getBaseName(normalizedPath).toLowerCase();
    const basenameCandidates = lookups.basenameLookup.get(baseName) || [];
    const viableBasename = basenameCandidates.filter((candidate) => candidate >= minIndex);
    if (viableBasename.length === 1) {
        return viableBasename[0];
    }

    return null;
};

const isGenericChapterTitle = (title: string): boolean => /^(?:(?:chapter|section|part|book|page|p\.?)[\s_-]*(?:\d{1,5}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|\d{1,5})[.:-]?$/i.test(normalizeWhitespace(title));

const ensureChapterTitles = (chapters: PlannedChapter[]): PlannedChapter[] => chapters.map((chapter, index) => {
    const title = normalizeWhitespace(chapter.title);
    return {
        ...chapter,
        title: title || `Chapter ${index + 1}`,
    };
});

export const READING_SECTION_TARGET_WORDS = 3_500;
export const READING_SECTION_SOFT_MIN_WORDS = 2_000;
export const READING_SECTION_HARD_MAX_WORDS = 5_000;
export const AUTHORED_SECTION_SPLIT_THRESHOLD_WORDS = 10_000;

const boundaryEvidenceForSource = (source: ChapterSource): BoundaryEvidence => {
    if (source === 'toc') return 'publisher-toc';
    if (source === 'heading') return 'document-heading';
    return 'source-spine';
};

const genericSourcePath = /(?:^|\/)(?:page|p)[\s_-]*\d{1,5}\.(?:x?html?|xml)$/i;
const numericSourcePath = /(?:^|\/)\d{1,5}\.(?:x?html?|xml)$/i;

const isGenericSourceUnit = (unit: SourceUnit, repeatedTitles: Set<string>): boolean => {
    const title = normalizeWhitespace(unit.title || '');
    const pageLikeTitle = /^(?:(?:page|p\.?)[\s_-]*\d{1,5}|\d{1,5})[.:-]?$/i.test(title);
    if (unit.boundaryEvidence === 'document-heading' || unit.boundaryEvidence === 'scan-heading') return false;
    if (unit.boundaryEvidence === 'publisher-toc') return pageLikeTitle;
    if (isGenericChapterTitle(title)) return true;
    if (repeatedTitles.has(title.toLowerCase())) return true;

    return unit.slices.some((slice) => {
        const path = normalizeArchivePath(slice.path);
        return genericSourcePath.test(path) || numericSourcePath.test(path);
    });
};

const uniqueValues = <T,>(values: T[]): T[] => [...new Set(values)];

const toSourceUnits = (chapters: PlannedChapter[]): SourceUnit[] => chapters.map((chapter, ordinal) => ({
    ordinal,
    slices: [...chapter.slices],
    sliceEstimatedWords: chapter.sliceEstimatedWords || chapter.slices.map(() => (
        chapter.slices.length > 0 ? chapter.estimatedWords / chapter.slices.length : 0
    )),
    estimatedWords: chapter.estimatedWords,
    title: normalizeWhitespace(chapter.title) || undefined,
    boundaryEvidence: chapter.boundaryEvidence?.[0] || boundaryEvidenceForSource(chapter.source),
    authoredGroupTitle: chapter.authoredGroupTitle,
}));

const mergeSourceUnits = (units: SourceUnit[]): Pick<ReadingSectionPlan, 'slices' | 'estimatedWords' | 'boundaryEvidence' | 'originalTitles'> => ({
    slices: units.flatMap((unit) => unit.slices),
    estimatedWords: units.reduce((total, unit) => total + unit.estimatedWords, 0),
    boundaryEvidence: uniqueValues(units.map((unit) => unit.boundaryEvidence)),
    originalTitles: units.map((unit) => unit.title).filter((title): title is string => Boolean(title)),
});

const makeAuthoredSection = (unit: SourceUnit): ReadingSectionPlan => ({
    title: unit.title || 'Untitled section',
    slices: [...unit.slices],
    estimatedWords: unit.estimatedWords,
    source: unit.boundaryEvidence === 'publisher-toc'
        ? 'toc'
        : unit.boundaryEvidence === 'document-heading' || unit.boundaryEvidence === 'scan-heading' ? 'heading' : 'spine',
    ownership: unit.boundaryEvidence === 'source-spine' ? 'xyz' : 'authored',
    reason: unit.boundaryEvidence === 'source-spine' ? 'format-fallback' : 'authored-boundary',
    boundaryEvidence: [unit.boundaryEvidence],
    authoredGroupTitle: unit.authoredGroupTitle || (unit.boundaryEvidence === 'source-spine' ? undefined : unit.title),
    originalTitles: unit.title ? [unit.title] : [],
});

const makeLongAuthoredSections = (unit: SourceUnit): ReadingSectionPlan[] => {
    if (
        unit.estimatedWords <= AUTHORED_SECTION_SPLIT_THRESHOLD_WORDS
        || unit.slices.length < 2
    ) {
        return [makeAuthoredSection(unit)];
    }

    const sections: ReadingSectionPlan[] = [];
    let sectionSlices: ChapterSlice[] = [];
    let sectionWords = 0;
    let partNumber = 1;

    const flush = () => {
        if (sectionSlices.length === 0) return;
        sections.push({
            ...makeAuthoredSection({
                ...unit,
                slices: sectionSlices,
                estimatedWords: sectionWords,
            }),
            title: `${unit.title || 'Untitled section'} - Part ${partNumber}`,
            reason: 'long-section-split',
            authoredGroupTitle: unit.title || undefined,
            originalTitles: unit.title ? [unit.title] : [],
        });
        partNumber += 1;
        sectionSlices = [];
        sectionWords = 0;
    };

    for (const [sliceIndex, slice] of unit.slices.entries()) {
        const sliceWords = unit.sliceEstimatedWords?.[sliceIndex] || 0;
        const nextWords = sectionWords + sliceWords;
        const shouldClose = sectionSlices.length > 0 && (
            nextWords > READING_SECTION_HARD_MAX_WORDS
            || (sectionWords >= READING_SECTION_SOFT_MIN_WORDS && nextWords > READING_SECTION_TARGET_WORDS)
        );
        if (shouldClose) flush();
        sectionSlices.push(slice);
        sectionWords += sliceWords;
    }
    flush();

    let sectionIndex = 0;
    while (sectionIndex < sections.length) {
        const current = sections[sectionIndex];
        if (current.estimatedWords >= READING_SECTION_SOFT_MIN_WORDS) {
            sectionIndex += 1;
            continue;
        }

        const previous = sections[sectionIndex - 1];
        const next = sections[sectionIndex + 1];
        const mergeSections = (left: ReadingSectionPlan, right: ReadingSectionPlan): ReadingSectionPlan => ({
            ...left,
            slices: [...left.slices, ...right.slices],
            estimatedWords: left.estimatedWords + right.estimatedWords,
            boundaryEvidence: uniqueValues([...left.boundaryEvidence, ...right.boundaryEvidence]),
            originalTitles: uniqueValues([...left.originalTitles, ...right.originalTitles]),
        });

        if (previous) {
            const combinedWords = previous.estimatedWords + current.estimatedWords;
            const canMerge = combinedWords <= READING_SECTION_HARD_MAX_WORDS
                || (previous.slices.length === 1 && previous.estimatedWords > READING_SECTION_HARD_MAX_WORDS);
            if (canMerge) {
                sections.splice(sectionIndex - 1, 2, mergeSections(previous, current));
                sectionIndex = Math.max(0, sectionIndex - 1);
                continue;
            }
        }

        if (next) {
            const combinedWords = current.estimatedWords + next.estimatedWords;
            const canMerge = combinedWords <= READING_SECTION_HARD_MAX_WORDS
                || (next.slices.length === 1 && next.estimatedWords > READING_SECTION_HARD_MAX_WORDS);
            if (canMerge) {
                sections.splice(sectionIndex, 2, mergeSections(current, next));
                continue;
            }
        }

        sectionIndex += 1;
    }

    return sections.map((section, index) => ({
        ...section,
        title: `${unit.title || 'Untitled section'} - Part ${index + 1}`,
    }));
};

const makeGeneratedSection = (
    units: SourceUnit[],
    title: string,
    reason: ReformationReason = 'page-sequence',
): ReadingSectionPlan => ({
    ...mergeSourceUnits(units),
    title,
    source: 'merged',
    ownership: 'xyz',
    reason,
    authoredGroupTitle: undefined,
});

const rebalanceFinalGeneratedSection = (sections: ReadingSectionPlan[]): ReadingSectionPlan[] => {
    if (sections.length < 2) return sections;

    const last = sections[sections.length - 1];
    const previous = sections[sections.length - 2];
    const combinedWords = previous.estimatedWords + last.estimatedWords;
    if (
        last.reason !== 'page-sequence'
        || last.estimatedWords >= READING_SECTION_SOFT_MIN_WORDS
        || previous.reason !== 'page-sequence'
        || combinedWords > READING_SECTION_HARD_MAX_WORDS
    ) {
        return sections;
    }

    const merged = makeGeneratedSection(
        [{
            ordinal: 0,
            slices: previous.slices,
            estimatedWords: previous.estimatedWords,
            title: previous.originalTitles.join(' '),
            boundaryEvidence: previous.boundaryEvidence[0] || 'source-spine',
        }, {
            ordinal: 1,
            slices: last.slices,
            estimatedWords: last.estimatedWords,
            title: last.originalTitles.join(' '),
            boundaryEvidence: last.boundaryEvidence[0] || 'source-spine',
        }],
        previous.title,
        'short-section-merge',
    );
    return [...sections.slice(0, -2), merged];
};

export const normalizeReadingSections = (chapters: PlannedChapter[]): NormalizedBookStructure => {
    const titledChapters = ensureChapterTitles(chapters);
    const sourceUnits = toSourceUnits(titledChapters);
    const titleCounts = new Map<string, number>();
    for (const unit of sourceUnits) {
        const title = normalizeWhitespace(unit.title || '').toLowerCase();
        if (title) titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    const repeatedTitles = new Set(
        [...titleCounts.entries()]
            .filter(([, count]) => count >= 3 && count / Math.max(1, sourceUnits.length) >= 0.5)
            .map(([title]) => title),
    );
    const genericUnits = sourceUnits.filter((unit) => isGenericSourceUnit(unit, repeatedTitles));
    const generatedRatio = genericUnits.length / Math.max(1, sourceUnits.length);
    const shouldGenerate = genericUnits.length >= 2 && generatedRatio >= 0.5;
    const mode: StructureMode = shouldGenerate
        ? genericUnits.length === sourceUnits.length ? 'generated' : 'hybrid'
        : 'authored';

    if (!shouldGenerate) {
        const authoredSections = sourceUnits.flatMap(makeLongAuthoredSections);
        return {
            version: 1,
            sourceUnits,
            sections: authoredSections,
            mode: authoredSections.length > sourceUnits.length ? 'hybrid' : mode,
        };
    }

    const sections: ReadingSectionPlan[] = [];
    let splitAuthoredSection = false;
    let generatedBucket: SourceUnit[] = [];
    let sectionNumber = 1;

    const flushGeneratedBucket = () => {
        if (generatedBucket.length === 0) return;
        sections.push(makeGeneratedSection(generatedBucket, `Section ${sectionNumber}`));
        sectionNumber += 1;
        generatedBucket = [];
    };

    for (const unit of sourceUnits) {
        if (!isGenericSourceUnit(unit, repeatedTitles)) {
            flushGeneratedBucket();
            const authoredSections = makeLongAuthoredSections(unit);
            splitAuthoredSection ||= authoredSections.length > 1;
            sections.push(...authoredSections);
            continue;
        }

        const currentWords = generatedBucket.reduce((total, bucketUnit) => total + bucketUnit.estimatedWords, 0);
        const nextWords = currentWords + unit.estimatedWords;
        const shouldClose = generatedBucket.length > 0 && (
            nextWords > READING_SECTION_HARD_MAX_WORDS
            || (currentWords >= READING_SECTION_SOFT_MIN_WORDS && nextWords > READING_SECTION_TARGET_WORDS)
        );
        if (shouldClose) flushGeneratedBucket();
        generatedBucket.push(unit);
    }
    flushGeneratedBucket();

        const rebalancedSections = rebalanceFinalGeneratedSection(sections);
        let generatedSectionNumber = 0;
        const renamedSections = rebalancedSections.map((section) => {
            if (section.ownership !== 'xyz' || section.source !== 'merged') return section;
            generatedSectionNumber += 1;
            return { ...section, title: `Section ${generatedSectionNumber}` };
        });

    return {
        version: 1,
        sourceUnits,
        sections: renamedSections,
        mode: splitAuthoredSection && mode === 'authored' ? 'hybrid' : mode,
    };
};

const buildChaptersFromBoundaries = (
    boundaries: ChapterBoundary[],
    spine: SpineItem[],
    source: ChapterSource = 'toc',
): PlannedChapter[] => {
    const chapters: PlannedChapter[] = [];

    for (let i = 0; i < boundaries.length; i++) {
        const current = boundaries[i];
        const next = boundaries[i + 1];
        const slices: ChapterSlice[] = [];

        if (next) {
            if (current.index === next.index) {
                slices.push({
                    path: spine[current.index].resolvedPath,
                    startFragment: current.fragment,
                    endFragment: next.fragment,
                    startHeadingIndex: current.headingIndex,
                    endHeadingIndex: next.headingIndex,
                    startBlockIndex: current.blockIndex,
                    endBlockIndex: next.blockIndex,
                });
            } else {
                for (let spineIndex = current.index; spineIndex < next.index; spineIndex++) {
                    slices.push({
                        path: spine[spineIndex].resolvedPath,
                        startFragment: spineIndex === current.index ? current.fragment : undefined,
                        startHeadingIndex: spineIndex === current.index ? current.headingIndex : undefined,
                        startBlockIndex: spineIndex === current.index ? current.blockIndex : undefined,
                    });
                }
            }
        } else {
            for (let spineIndex = current.index; spineIndex < spine.length; spineIndex++) {
                slices.push({
                    path: spine[spineIndex].resolvedPath,
                    startFragment: spineIndex === current.index ? current.fragment : undefined,
                    startHeadingIndex: spineIndex === current.index ? current.headingIndex : undefined,
                    startBlockIndex: spineIndex === current.index ? current.blockIndex : undefined,
                });
            }
        }

        const hasUsefulSlice = slices.some((slice) => normalizeArchivePath(slice.path).length > 0);
        if (!hasUsefulSlice) continue;

        chapters.push({
            title: current.title,
            slices,
            estimatedWords: 0,
            source,
            boundaryEvidence: [current.evidence || boundaryEvidenceForSource(source)],
        });
    }

    return chapters;
};

const buildFallbackSpineChapters = (spine: SpineItem[]): PlannedChapter[] => spine.map((item, index) => ({
    title: `Chapter ${index + 1}`,
    slices: [{ path: item.resolvedPath }],
    estimatedWords: 0,
    source: 'spine',
}));

type HeadingKind = 'chapter' | 'book' | 'part' | 'section' | 'ordinal' | 'numbered-title' | 'frontmatter';

interface HeadingCandidate extends ChapterBoundary {
    kind: HeadingKind;
    level: number;
    ordinal?: number;
}

const writtenOrdinals: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
};

const romanToNumber = (value: string): number | null => {
    const normalized = value.toUpperCase();
    if (!/^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(normalized)) {
        return null;
    }

    const values: Record<string, number> = {
        I: 1,
        V: 5,
        X: 10,
        L: 50,
        C: 100,
        D: 500,
        M: 1000,
    };
    let total = 0;
    let previous = 0;
    for (let index = normalized.length - 1; index >= 0; index--) {
        const current = values[normalized[index]];
        total += current < previous ? -current : current;
        previous = current;
    }
    return total > 0 ? total : null;
};

const parseOrdinal = (value: string): number | null => {
    if (/^\d{1,3}$/.test(value)) return Number(value);
    const written = writtenOrdinals[value.toLowerCase()];
    if (written) return written;
    return romanToNumber(value);
};

const classifyHeading = (title: string): Pick<HeadingCandidate, 'kind' | 'ordinal'> | null => {
    const normalized = normalizeWhitespace(title);
    if (!normalized) return null;

    const explicit = /^(chapter|book|part|section)\b/i.exec(normalized);
    if (explicit) {
        return { kind: explicit[1].toLowerCase() as HeadingKind };
    }

    const standaloneOrdinal = /^([ivxlcdm]{1,8}|\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)[.:-]?$/i.exec(normalized);
    if (standaloneOrdinal) {
        return {
            kind: 'ordinal',
            ordinal: parseOrdinal(standaloneOrdinal[1]) ?? undefined,
        };
    }

    const titledOrdinal = /^([ivxlcdm]{1,8}|\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:[.):-]|\s+)\s*(\S.+)$/i.exec(normalized);
    if (titledOrdinal) {
        return {
            kind: 'numbered-title',
            ordinal: parseOrdinal(titledOrdinal[1]) ?? undefined,
        };
    }

    return null;
};

const ordinalTokenPattern = '[ivxlcdm]{1,8}|\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';

const toRoman = (value: number): string => {
    const numerals: [number, string][] = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let remaining = value;
    let result = '';
    for (const [unit, numeral] of numerals) {
        while (remaining >= unit) {
            result += numeral;
            remaining -= unit;
        }
    }
    return result;
};

const titleCaseHeading = (value: string): string => {
    const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
    return normalizeWhitespace(value)
        .toLocaleLowerCase()
        .split(' ')
        .map((word, index) => {
            if (index > 0 && smallWords.has(word)) return word;
            return word.replace(/[\p{L}]/u, (character) => character.toLocaleUpperCase());
        })
        .join(' ');
};

const repairScanHeadingWordBreaks = (value: string): string => value.replace(
    /\b([A-Z])\s+([A-Z]{2,})\b/g,
    '$1$2',
);

const extractScanHeading = (
    value: string,
): { title: string; kind: HeadingKind; ordinal?: number } | null => {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return null;

    const chapterMatch = new RegExp(`^(chapter|book|part|section)\\s+(${ordinalTokenPattern})(?:[.):-]|\\s+)(.*)$`, 'i').exec(normalized);
    if (chapterMatch) {
        const ordinal = parseOrdinal(chapterMatch[2]);
        if (ordinal === null) return null;

        const remainder = normalizeWhitespace(chapterMatch[3]);
        const bodyMarker = /\s+(?:THE\s+[a-z]|[IVXLCDM]{1,8}\.\s+[A-Z])/u.exec(remainder);
        const description = repairScanHeadingWordBreaks(
            normalizeWhitespace(bodyMarker ? remainder.slice(0, bodyMarker.index) : remainder),
        );
        if (!description || description.length > 140) return null;

        return {
            title: `${chapterMatch[1][0].toLocaleUpperCase()}${chapterMatch[1].slice(1).toLocaleLowerCase()} ${toRoman(ordinal)}: ${titleCaseHeading(description)}`,
            kind: chapterMatch[1].toLocaleLowerCase() as HeadingKind,
            ordinal,
        };
    }

    const frontMatter = /^(INTRODUCTION|TRANSLATOR['’]S NOTE|INTRODUCTORY)\b(.*)$/iu.exec(normalized);
    if (!frontMatter) {
        if (/^BIBLIOGRAPHICAL ABBREVIATIONS USED IN THE NOTES\b/i.test(normalized)) {
            return { title: 'Notes', kind: 'section' };
        }
        return null;
    }

    const label = frontMatter[1].replace(/[’]/g, "'").toLocaleLowerCase();
    const remainder = normalizeWhitespace(frontMatter[2]);
    if (label === 'introduction') return { title: 'Introduction', kind: 'section' };
    if (label === "translator's note") return { title: "Translator's Note", kind: 'section' };
    const bodyMarker = /\s+THE\s+[a-z]/u.exec(remainder);
    const description = repairScanHeadingWordBreaks(
        normalizeWhitespace(bodyMarker ? remainder.slice(0, bodyMarker.index) : remainder),
    );
    if (!description || description.length > 140) return null;
    return { title: `Introductory: ${titleCaseHeading(description)}`, kind: 'section' };
};

const isConsecutiveSequence = (candidates: HeadingCandidate[]): boolean => {
    if (candidates.some((candidate) => candidate.ordinal === undefined)) return false;
    return candidates.every((candidate, index) => (
        index === 0 || candidate.ordinal === candidates[index - 1].ordinal! + 1
    ));
};

const selectHeadingFamily = (candidates: HeadingCandidate[]): HeadingCandidate[] => {
    for (const kind of ['chapter', 'section', 'book', 'part'] as const) {
        const family = candidates.filter((candidate) => candidate.kind === kind);
        if (family.length >= 2) return family;
    }

    for (const kind of ['numbered-title', 'ordinal'] as const) {
        const families = [1, 2]
            .map((level) => ({
                level,
                family: candidates.filter((candidate) => candidate.kind === kind && candidate.level === level),
            }))
            .filter(({ level, family }) => family.length >= (kind === 'numbered-title' && level === 2 ? 3 : 2))
            .filter(({ family }) => isConsecutiveSequence(family))
            .sort((left, right) => right.family.length - left.family.length);
        if (families[0]) return families[0].family;
    }

    return [];
};

const isPageLikeSpine = (spine: SpineItem[]): boolean => {
    if (spine.length < 3) return false;
    const pageLikeCount = spine.filter((item) => {
        const path = normalizeArchivePath(item.resolvedPath);
        return genericSourcePath.test(path) || numericSourcePath.test(path);
    }).length;
    return pageLikeCount / spine.length >= 0.75;
};

const isLeadingEpigraph = (html: string): boolean => {
    const $ = cheerio.load(html);
    if ($('h1, h2, h3, h4, h5, h6').length > 0) return false;

    const blocks = $(BLOCK_SELECTOR).filter((_, el) => normalizeWhitespace($(el).text()).length > 0);
    if (blocks.length !== 1) return false;

    const text = normalizeWhitespace(blocks.first().text());
    const wordCount = countWords(text);
    return wordCount >= 40
        && wordCount <= 400
        && !/^(?:page\s+\d+\s+)?(?:the gift|\d+\s+the gift)\b/i.test(text);
};

const selectScanHeadingFamily = (candidates: HeadingCandidate[]): HeadingCandidate[] => {
    const numbered = candidates
        .filter((candidate) => candidate.kind === 'chapter' && candidate.ordinal !== undefined)
        .sort((left, right) => left.index - right.index || (left.blockIndex || 0) - (right.blockIndex || 0));
    if (numbered.length < 2 || !isConsecutiveSequence(numbered)) return [];

    const firstNumberedIndex = numbered[0].index;
    const lastNumberedIndex = numbered.at(-1)?.index ?? firstNumberedIndex;
    const frontMatter = candidates.filter((candidate, index, allCandidates) => (
        candidate.kind === 'section'
        && candidate.title !== 'Notes'
        && candidate.index < firstNumberedIndex
        && allCandidates.findIndex((other) => other.kind === candidate.kind && other.title === candidate.title) === index
    ));
    const notes = candidates.filter((candidate) => candidate.title === 'Notes' && candidate.index > lastNumberedIndex);
    return [...frontMatter, ...numbered, ...notes]
        .sort((left, right) => left.index - right.index || (left.blockIndex || 0) - (right.blockIndex || 0));
};

interface TocDepthCandidate {
    title: string;
    resolvedPath: string;
    fragment?: string;
    depth: number;
}

interface TocSourceResult {
    entries: TocEntry[];
    state: 'present-empty' | 'present-invalid' | 'present-valid';
}

const isStructuralTocTitle = (title: string): boolean => {
    const normalized = normalizeWhitespace(title);
    return /^(?:part|book|volume)\b/i.test(normalized)
        || /^[ivxlcdm]{1,8}[.) :-]\s*\S/i.test(normalized);
};

const isChapterLikeTocTitle = (title: string): boolean => {
    const normalized = normalizeWhitespace(title);
    return /^(?:chapter\s+(?:[ivxlcdm]{1,8}|\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b|\d{1,3}[.) :-]\s*\S)/i.test(normalized);
};

const selectTocDepth = (candidates: TocDepthCandidate[]): TocEntry[] => {
    if (candidates.length === 0) return [];

    const byDepth = new Map<number, TocDepthCandidate[]>();
    for (const candidate of candidates) {
        const group = byDepth.get(candidate.depth) || [];
        group.push(candidate);
        byDepth.set(candidate.depth, group);
    }

    const groups = [...byDepth.entries()].sort(([left], [right]) => left - right);

    let partChapterDepth: number | undefined;
    for (const [depth, group] of groups.slice(1)) {
        const hasStructuralParent = candidates.some((candidate) => (
            candidate.depth < depth && isStructuralTocTitle(candidate.title)
        ));
        if (group.length >= 2 && hasStructuralParent && group.every((candidate) => isChapterLikeTocTitle(candidate.title))) {
            partChapterDepth = depth;
        }
    }

    if (partChapterDepth !== undefined) {
        return candidates
            .filter((candidate) => candidate.depth === partChapterDepth || (
                candidate.depth < partChapterDepth && !isStructuralTocTitle(candidate.title)
            ))
            .map(({ title, resolvedPath, fragment }) => ({ title, resolvedPath, fragment }));
    }

    let selected = groups[0][1];

    for (let index = 1; index < groups.length && selected.length <= 2; index++) {
        const next = groups[index][1];
        if (next.length <= selected.length) break;
        selected = next;
    }

    return selected.map(({ title, resolvedPath, fragment }) => ({ title, resolvedPath, fragment }));
};

interface HeadingRecoveryResult {
    chapters: PlannedChapter[] | null;
    semanticCandidates: HeadingCandidate[];
    scanCandidates: HeadingCandidate[];
    selectedBoundaries: ChapterBoundary[];
    selectedSource: 'document-heading' | 'scan-heading' | 'none';
    abstentionReasons: string[];
}

const buildHeadingChapters = async (
    loadDocument: ContentDocumentLoader,
    spine: SpineItem[],
): Promise<HeadingRecoveryResult> => {
    const candidates: HeadingCandidate[] = [];
    const scanCandidates: HeadingCandidate[] = [];
    const allowScanHeadings = isPageLikeSpine(spine);

    for (const spineItem of spine) {
        const document = await loadDocument(spineItem.resolvedPath);
        const html = document.repairedHtml;
        if (!html) continue;
        const $ = cheerio.load(html);

        $('h1, h2').each((headingIndex, el) => {
            const title = normalizeWhitespace($(el).text());
            const classification = classifyHeading(title);
            if (!classification) return;

            const fragment = normalizeWhitespace($(el).attr('id') || $(el).attr('name') || '') || undefined;
            candidates.push({
                index: spineItem.index,
                title,
                fragment,
                headingIndex,
                level: Number(el.tagName.slice(1)),
                ...classification,
            });
        });

        if (allowScanHeadings) {
            const block = $(BLOCK_SELECTOR).filter((_, el) => normalizeWhitespace($(el).text()).length > 0).first();
            const blockText = normalizeWhitespace(block.text());
            const scanHeading = extractScanHeading(blockText);
            if (scanHeading) {
                scanCandidates.push({
                    index: spineItem.index,
                    blockIndex: $(BLOCK_SELECTOR).index(block),
                    level: 1,
                    evidence: 'scan-heading',
                    ...scanHeading,
                });
            }
        }
    }

    const semanticBoundaries = selectHeadingFamily(candidates);
    const scanBoundaries = selectScanHeadingFamily(scanCandidates);
    const selectedSource: HeadingRecoveryResult['selectedSource'] = semanticBoundaries.length > 0
        ? 'document-heading'
        : scanBoundaries.length > 0 ? 'scan-heading' : 'none';
    const selectedBoundaries: ChapterBoundary[] = semanticBoundaries.length > 0
        ? [...semanticBoundaries]
        : await Promise.all(scanBoundaries.map(async (boundary) => {
            if (!/^Introductory:/u.test(boundary.title) || boundary.index <= 0) return boundary;

            const previousDocument = await loadDocument(spine[boundary.index - 1].resolvedPath);
            if (!previousDocument.repairedHtml || !isLeadingEpigraph(previousDocument.repairedHtml)) return boundary;

            return {
                ...boundary,
                index: boundary.index - 1,
            };
        }));
    if (selectedBoundaries.length < 2) {
        return {
            chapters: null,
            semanticCandidates: candidates,
            scanCandidates,
            selectedBoundaries,
            selectedSource: 'none',
            abstentionReasons: selectedSource === 'none'
                ? ['No coherent heading family was recovered']
                : ['Heading candidates did not form at least two boundaries'],
        };
    }

    const boundaries = [...selectedBoundaries];

    const hasRecoveredOpening = boundaries[0].index > 0 || (boundaries[0].headingIndex ?? 0) > 0;
    if (hasRecoveredOpening) {
        boundaries.unshift({
            index: 0,
            title: 'Opening',
        });
    }

    const chapters = buildChaptersFromBoundaries(boundaries, spine, 'heading');
    if (hasRecoveredOpening && chapters[0]) {
        chapters[0].source = 'spine';
        chapters[0].boundaryEvidence = ['source-spine'];
    }
    return {
        chapters,
        semanticCandidates: candidates,
        scanCandidates,
        selectedBoundaries,
        selectedSource,
        abstentionReasons: [],
    };
};

const extractNavEntries = async (
    zip: JSZip,
    navPath: string,
    allowBodyFallback = false,
): Promise<TocSourceResult> => {
    const entry = findZipEntry(zip, navPath);
    if (!entry) return { entries: [], state: 'present-invalid' };

    const html = await entry.async('string');
    const $ = cheerio.load(html);

    const navRoot = $('nav[epub\\:type="toc"], nav[role="doc-toc"]').first();
    if (navRoot.length === 0 && !allowBodyFallback) {
        return { entries: [], state: 'present-invalid' };
    }
    const sourceRoot = navRoot.length > 0 ? navRoot : $('body');
    const links = sourceRoot.find('a[href]');

    const navDir = getDirectoryPath(navPath);
    const candidates: TocDepthCandidate[] = [];

    links.each((_, el) => {
        const href = ($(el).attr('href') || '').trim();
        if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
            return;
        }

        const { path: entryPath, fragment } = splitHref(href);
        const resolvedPath = entryPath
            ? resolveArchivePath(navDir, entryPath)
            : normalizeArchivePath(navPath);

        const title = normalizeWhitespace($(el).text());
        if (!resolvedPath) return;

        candidates.push({
            title,
            resolvedPath,
            fragment,
            depth: Math.max(1, $(el).parents('li').length),
        });
    });

    const entries = selectTocDepth(candidates);
    return {
        entries,
        state: entries.length > 0 ? 'present-valid' : navRoot.length > 0 ? 'present-empty' : 'present-invalid',
    };
};

const extractNcxEntries = async (
    zip: JSZip,
    ncxPath: string,
): Promise<TocSourceResult> => {
    const entry = findZipEntry(zip, ncxPath);
    if (!entry) return { entries: [], state: 'present-invalid' };

    const xml = await entry.async('string');
    const $ = cheerio.load(xml, { xmlMode: true });
    const navDir = getDirectoryPath(ncxPath);

    if ($('navMap').length === 0) return { entries: [], state: 'present-invalid' };
    const points = $('navMap navPoint');

    const candidates: TocDepthCandidate[] = [];
    points.each((_, el) => {
        const src = $(el).find('> content').attr('src') || $(el).find('content').first().attr('src') || '';
        if (!src) return;

        const title = normalizeWhitespace(
            $(el).find('> navLabel > text').first().text()
            || $(el).find('navLabel > text').first().text(),
        );

        const { path: entryPath, fragment } = splitHref(src);
        const resolvedPath = entryPath
            ? resolveArchivePath(navDir, entryPath)
            : normalizeArchivePath(ncxPath);

        if (!resolvedPath) return;

        candidates.push({
            title,
            resolvedPath,
            fragment,
            depth: $(el).parents('navPoint').length + 1,
        });
    });

    const entries = selectTocDepth(candidates);
    return { entries, state: entries.length > 0 ? 'present-valid' : 'present-empty' };
};

interface TocCollectionResult {
    entries: TocEntry[];
    nav: StructureDiagnostics['declaredToc']['nav'];
    ncx: StructureDiagnostics['declaredToc']['ncx'];
}

const summarizeDeclaredToc = (
    items: ManifestItem[],
    sources: TocSourceResult[],
): { state: DeclaredTocState; paths: string[]; entryCount: number } => {
    const paths = items.map((item) => normalizeArchivePath(item.resolvedPath));
    if (items.length === 0) return { state: 'absent', paths, entryCount: 0 };

    const entries = sources.flatMap((source) => source.entries);
    const state: DeclaredTocState = sources.some((source) => source.state === 'present-invalid')
        ? 'present-invalid'
        : entries.length > 0 ? 'present-valid' : 'present-empty';
    return { state, paths, entryCount: entries.length };
};

const collectTocEntries = async (
    zip: JSZip,
    manifest: Record<string, ManifestItem>,
    spineTocId?: string,
): Promise<TocCollectionResult> => {
    const navCandidates = Object.values(manifest)
        .filter((item) => {
            const properties = (item.properties || '').toLowerCase();
            const mediaType = (item.mediaType || '').toLowerCase();
            return properties.includes('nav')
                || (mediaType.includes('xhtml') || mediaType.includes('html'))
                && isLikelyNavigationPath(item.resolvedPath);
        });

    const navSources: TocSourceResult[] = [];
    for (const item of navCandidates) {
        navSources.push(await extractNavEntries(
            zip,
            item.resolvedPath,
            !(item.properties || '').toLowerCase().includes('nav'),
        ));
    }

    const ncxCandidates: ManifestItem[] = [];
    for (const item of Object.values(manifest)) {
        const mediaType = (item.mediaType || '').toLowerCase();
        const href = item.href.toLowerCase();
        if (mediaType.includes('application/x-dtbncx+xml') || href.endsWith('.ncx')) {
            ncxCandidates.push(item);
        }
    }

    if (spineTocId && manifest[spineTocId]) {
        ncxCandidates.push(manifest[spineTocId]);
    }

    const uniqueNcxCandidates = [...new Map(ncxCandidates.map((item) => [item.id, item])).values()];
    const seenNcx = new Set<string>();
    const ncxSources: TocSourceResult[] = [];
    for (const item of uniqueNcxCandidates) {
        if (seenNcx.has(item.id)) continue;
        seenNcx.add(item.id);
        ncxSources.push(await extractNcxEntries(zip, item.resolvedPath));
    }

    const deduped: TocEntry[] = [];
    const seen = new Set<string>();
    for (const entry of [...navSources.flatMap((source) => source.entries), ...ncxSources.flatMap((source) => source.entries)]) {
        const key = `${normalizeArchivePath(entry.resolvedPath)}#${entry.fragment || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }

    return {
        entries: deduped,
        nav: summarizeDeclaredToc(navCandidates, navSources),
        ncx: summarizeDeclaredToc(uniqueNcxCandidates, ncxSources),
    };
};

const isLowInformationTocTitle = (title: string): boolean => {
    const normalized = normalizeWhitespace(title).toLowerCase().replace(/[\s_-]+/g, ' ');
    return !normalized || /^(?:untitled|unknown|title|chapter|section|part|book|item|entry)$/i.test(normalized);
};

const validateAndOrderTocEntries = async (
    tocEntries: TocEntry[],
    spine: SpineItem[],
    loadDocument: ContentDocumentLoader,
): Promise<TocEntry[]> => {
    const lookups = buildPathLookup(spine);
    const htmlCache = new Map<string, string>();
    const candidates: {
        entry: TocEntry;
        spineIndex: number;
        anchorIndex: number;
        originalIndex: number;
    }[] = [];

    for (const [originalIndex, tocEntry] of tocEntries.entries()) {
        const spineIndex = resolveTocEntryToIndex(tocEntry, lookups, 0);
        if (spineIndex === null) continue;

        let anchorIndex = -1;
        if (tocEntry.fragment) {
            const path = spine[spineIndex].resolvedPath;
            let html = htmlCache.get(path);
            if (html === undefined) html = (await loadDocument(path)).repairedHtml;
            htmlCache.set(path, html);
            if (!html) continue;

            const $ = cheerio.load(html);
            const anchor = findFragmentElement($, tocEntry.fragment);
            if (!anchor) continue;

            const anchorElement = anchor.get(0);
            if (!anchorElement) continue;

            const semanticContainer = anchor.closest('[epub\\:type], [role]').first();
            const semanticTokens = new Set(
                `${semanticContainer.attr('epub:type') || ''} ${semanticContainer.attr('role') || ''}`
                    .toLowerCase()
                    .split(/\s+/)
                    .filter(Boolean),
            );
            if (semanticTokens.has('pagebreak') || semanticTokens.has('doc-pagebreak')) continue;

            const targetHeading = anchor.is('h1, h2, h3, h4, h5, h6')
                ? anchor
                : anchor.closest('h1, h2, h3, h4, h5, h6').first();
            const targetTitle = normalizeWhitespace(targetHeading.text());
            const validatedEntry = isLowInformationTocTitle(tocEntry.title) && targetTitle
                ? { ...tocEntry, title: targetTitle }
                : tocEntry;

            $('*').each((index, element) => {
                if (element === anchorElement) anchorIndex = index;
            });
            if (anchorIndex < 0) continue;

            candidates.push({ entry: validatedEntry, spineIndex, anchorIndex, originalIndex });
            continue;
        }

        candidates.push({ entry: tocEntry, spineIndex, anchorIndex, originalIndex });
    }

    return candidates
        .sort((left, right) => (
            left.spineIndex - right.spineIndex
            || left.anchorIndex - right.anchorIndex
            || left.originalIndex - right.originalIndex
        ))
        .map(({ entry }) => entry);
};

const buildBoundariesFromToc = (
    tocEntries: TocEntry[],
    spine: SpineItem[],
): ChapterBoundary[] => {
    if (tocEntries.length === 0 || spine.length === 0) return [];

    const lookups = buildPathLookup(spine);
    const boundaries: ChapterBoundary[] = [];
    const seen = new Set<string>();

    let floorIndex = 0;
    for (const tocEntry of tocEntries) {
        const matchedIndex = resolveTocEntryToIndex(tocEntry, lookups, floorIndex);
        if (matchedIndex === null) continue;

        const title = normalizeWhitespace(tocEntry.title);
        const key = `${matchedIndex}|${tocEntry.fragment || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        boundaries.push({
            index: matchedIndex,
            title,
            fragment: tocEntry.fragment,
        });

        floorIndex = matchedIndex;
    }

    if (boundaries.length === 0) return [];

    const firstBoundary = boundaries[0];
    if (firstBoundary.index > 0) {
        boundaries.unshift({
            index: 0,
            title: 'Front Matter',
        });
    }

    return boundaries;
};

interface StructureDiscoveryAnchors {
    document: StructureSourceDocument;
    tocEntries: Map<string, TocEntry>;
    headingBoundaries: Map<string, ChapterBoundary>;
    sourceUnits: Map<string, { index: number; title?: string }>;
}

const createStructureDiscoveryAnchors = async (
    loadDocument: ContentDocumentLoader,
    spine: SpineItem[],
    tocEntries: TocEntry[],
    headingRecovery: HeadingRecoveryResult | null,
    opfPath: string,
    options: EpubStructureOptions,
): Promise<StructureDiscoveryAnchors> => {
    const sourceUnits = new Map<string, { index: number; title?: string }>();
    const units: StructureSourceDocument['units'] = [];
    for (const spineItem of spine) {
        const sourceUnitId = `spine:${spineItem.index}`;
        const document = await loadDocument(spineItem.resolvedPath);
        const $ = cheerio.load(document.repairedHtml || '');
        const title = normalizeWhitespace($('h1, h2, h3, h4, h5, h6').first().text()) || undefined;
        sourceUnits.set(sourceUnitId, { index: spineItem.index, title });
        units.push({
            id: sourceUnitId,
            ordinal: spineItem.index,
            title,
            text: normalizeWhitespace($('body').text()),
        });
    }

    const lookups = buildPathLookup(spine);
    const navigationEntries: NonNullable<StructureSourceDocument['navigationEntries']> = [];
    const navigationById = new Map<string, TocEntry>();
    tocEntries.forEach((entry, index) => {
        const sourceIndex = resolveTocEntryToIndex(entry, lookups, 0);
        if (sourceIndex === null) return;
        const id = `toc:${index}`;
        navigationEntries.push({
            id,
            title: entry.title,
            sourceUnitId: `spine:${sourceIndex}`,
        });
        navigationById.set(id, entry);
    });

    const headingBoundaries = new Map<string, ChapterBoundary>();
    const headings: NonNullable<StructureSourceDocument['headings']> = [];
    (headingRecovery?.selectedBoundaries || []).forEach((boundary, index) => {
        const id = `heading:${index}`;
        const sourceUnitId = `spine:${boundary.index}`;
        if (!sourceUnits.has(sourceUnitId)) return;
        headings.push({
            id,
            sourceUnitId,
            title: boundary.title,
            level: boundary.headingIndex === undefined ? undefined : 1,
            startOffset: boundary.headingIndex ?? boundary.blockIndex ?? 0,
        });
        headingBoundaries.set(id, boundary);
    });

    const document: StructureSourceDocument = {
        bookId: options.bookId || opfPath,
        sourceHash: options.sourceHash || `${opfPath}:${spine.map((item) => item.resolvedPath).join('|')}`,
        units,
        navigationEntries,
        headings,
    };

    return {
        document,
        tocEntries: navigationById,
        headingBoundaries,
        sourceUnits,
    };
};

const buildChaptersFromStructureProposal = (
    proposal: StructureProposal,
    anchors: StructureDiscoveryAnchors,
    spine: SpineItem[],
): PlannedChapter[] => {
    if (proposal.pluginId === 'publisher-navigation') {
        const selectedEntries = proposal.boundaries
            .map((boundary) => boundary.titleSourceAnchorId ? anchors.tocEntries.get(boundary.titleSourceAnchorId) : undefined)
            .filter((entry): entry is TocEntry => Boolean(entry));
        return buildChaptersFromBoundaries(
            buildBoundariesFromToc(selectedEntries, spine),
            spine,
            'toc',
        );
    }

    if (proposal.pluginId === 'source-units' || proposal.boundaries.every((boundary) => !boundary.titleSourceAnchorId)) {
        const boundaries: ChapterBoundary[] = proposal.boundaries.flatMap((boundary) => {
            const sourceUnit = anchors.sourceUnits.get(boundary.sourceAnchorId);
            if (!sourceUnit) return [];
            return [{
                index: sourceUnit.index,
                title: sourceUnit.title || `Chapter ${sourceUnit.index + 1}`,
                evidence: 'source-spine' as const,
            }];
        });
        return buildChaptersFromBoundaries(boundaries, spine, 'spine');
    }

    const headingBoundaries = proposal.boundaries.flatMap((boundary) => {
        const headingId = boundary.titleSourceAnchorId;
        const heading = headingId ? anchors.headingBoundaries.get(headingId) : undefined;
        return heading ? [heading] : [];
    });
    return buildChaptersFromBoundaries(headingBoundaries, spine, 'heading');
};

const normalizeArtifactLabel = (value: string): string => normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/^[\W_]+|[\W_]+$/g, '');

const classifyArtifactLabel = (
    title: string,
    path: string,
): Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'> | null => {
    const label = normalizeArtifactLabel(title);
    const filename = normalizeArtifactLabel(getBaseName(path).replace(/\.[^.]+$/, ''));
    const candidates = [label, filename].filter(Boolean);

    if (candidates.some((candidate) => /^(?:cover|cover page|title page|front cover|back cover)$/.test(candidate))) {
        return { type: 'cover', reason: 'Publication cover or title page', shouldIncludeInReading: false };
    }

    if (candidates.some((candidate) => /^(?:toc|navigation|nav|(?:table of )?contents?(?: of (?:vol(?:ume)?|book|part)\.? [\divxlcdm]+)?|list of (?:illustrations?|figures?|tables?|plates?))$/.test(candidate))) {
        return { type: 'toc', reason: 'Publication navigation or table of contents', shouldIncludeInReading: false };
    }

    if (candidates.some((candidate) => /^(?:copyright|copyright page|legal notice|license|licence|disclaimer|project gutenberg license|imprint|colophon|about this (?:ebook|edition))$/.test(candidate))) {
        return { type: 'license', reason: 'Publication legal or production boilerplate', shouldIncludeInReading: false };
    }

    return null;
};

const classifyEmbeddedContents = (
    text: string,
): Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'> | null => {
    const normalized = normalizeWhitespace(text);
    if (!/^CONTENTS?\b/i.test(normalized)) return null;

    const structuralEntries = normalized.match(
        /\b(?:introductory|chapter|part|section|book|conclusions|bibliographical|notes)\b/gi,
    ) || [];
    if (structuralEntries.length < 3) return null;

    return {
        type: 'toc',
        reason: 'Embedded table of contents detected from structural entries',
        shouldIncludeInReading: false,
    };
};

const normalizeMetadataLabel = (value: string): string => normalizeWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^the project gutenberg e-?book of\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const metadataLabelVariants = (value: string): string[] => {
    const variants = [value, ...value.split(/[:;/]/)];
    return [...new Set(variants.map(normalizeMetadataLabel).filter(Boolean))];
};

const classifyTitleMatter = (
    title: string,
    text: string,
    html: string,
    publicationTitle: string,
    publicationAuthor: string,
): Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'> | null => {
    const wordCount = countWords(text);
    if (wordCount > 80) return null;

    const titleKey = normalizeMetadataLabel(title);
    const publicationTitleVariants = metadataLabelVariants(publicationTitle);
    const publicationAuthorKey = normalizeMetadataLabel(publicationAuthor);

    const matchesPublicationTitle = titleKey && publicationTitleVariants.some((variant) => {
        if (variant === titleKey) return true;
        const shorterLength = Math.min(variant.length, titleKey.length);
        const longerLength = Math.max(variant.length, titleKey.length);
        return shorterLength >= 8
            && shorterLength / longerLength >= 0.6
            && (variant.startsWith(titleKey) || titleKey.startsWith(variant));
    });

    if (matchesPublicationTitle) {
        return { type: 'cover', reason: 'Low-content publication title page', shouldIncludeInReading: false };
    }

    if (publicationAuthorKey && titleKey.includes(publicationAuthorKey) && wordCount <= 40) {
        return { type: 'cover', reason: 'Low-content publication byline page', shouldIncludeInReading: false };
    }

    if (/\b(?:edition|published by|publication of|printing)\b/i.test(title) && wordCount <= 40) {
        return { type: 'cover', reason: 'Low-content edition or publication page', shouldIncludeInReading: false };
    }

    if (
        /^(?:part|book|volume)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(title)
        || /^[ivxlcdm]{1,8}[.) :-]\s*\S/i.test(title)
    ) {
        const $ = cheerio.load(`<body>${html}</body>`);
        const proseWords = countWords($('p, li, blockquote').text());
        if (proseWords < 20) {
            return { type: 'toc', reason: 'Content-free structural divider', shouldIncludeInReading: false };
        }
    }

    return null;
};

const classifyArtifactMarkup = (
    html: string,
): Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'> | null => {
    const $ = cheerio.load(`<body>${html}</body>`);
    const artifactElements: {
        element: Element;
        classification: Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'>;
    }[] = [];

    $('[epub\\:type], [role]').each((_, el) => {
        const values = `${$(el).attr('epub:type') || ''} ${$(el).attr('role') || ''}`;
        const semanticTokens = new Set(values.toLowerCase().split(/\s+/).filter(Boolean));
        let classification: Pick<ChapterClassification, 'type' | 'reason' | 'shouldIncludeInReading'> | null = null;

        if (['cover', 'cover-image', 'titlepage', 'doc-cover', 'doc-titlepage'].some((value) => semanticTokens.has(value))) {
            classification = { type: 'cover', reason: 'EPUB cover or title-page semantics', shouldIncludeInReading: false };
        } else if (['toc', 'landmarks', 'page-list', 'loi', 'lot', 'doc-toc'].some((value) => semanticTokens.has(value))) {
            classification = { type: 'toc', reason: 'EPUB navigation semantics', shouldIncludeInReading: false };
        } else if (['copyright-page', 'colophon', 'imprint', 'doc-colophon', 'doc-credit'].some((value) => semanticTokens.has(value))) {
            classification = { type: 'license', reason: 'EPUB legal or production semantics', shouldIncludeInReading: false };
        }

        if (classification) {
            artifactElements.push({ element: el, classification });
        }
    });

    if (artifactElements.length === 0) return null;

    const artifactSet = new Set(artifactElements.map(({ element }) => element));
    const topLevelArtifacts = artifactElements.filter(({ element }) => (
        !$(element).parents().toArray().some((parent) => artifactSet.has(parent))
    ));
    const fullTextLength = normalizeWhitespace($('body').first().text()).length;
    const artifactTextLength = topLevelArtifacts.reduce((sum, { element }) => (
        sum + normalizeWhitespace($(element).text()).length
    ), 0);
    const remainingTextLength = Math.max(0, fullTextLength - artifactTextLength);

    if (fullTextLength === 0 || artifactTextLength / fullTextLength >= 0.8 || remainingTextLength < 80) {
        return topLevelArtifacts[0].classification;
    }

    return null;
};

const stripEmbeddedPublicationMatter = (html: string): string => {
    const $ = cheerio.load(`<body>${html}</body>`);

    $('[epub\\:type], [role]').each((_, el) => {
        const values = `${$(el).attr('epub:type') || ''} ${$(el).attr('role') || ''}`;
        const semanticTokens = new Set(values.toLowerCase().split(/\s+/).filter(Boolean));
        const isArtifact = [
            'cover',
            'cover-image',
            'titlepage',
            'doc-cover',
            'doc-titlepage',
            'toc',
            'landmarks',
            'page-list',
            'loi',
            'lot',
            'doc-toc',
            'copyright-page',
            'colophon',
            'imprint',
            'doc-colophon',
            'doc-credit',
        ].some((value) => semanticTokens.has(value));

        if (isArtifact) $(el).remove();
    });

    return $('body').first().html() || '';
};

const extractSliceTitle = (html: string, fallback: string): string => {
    const $ = cheerio.load(`<body>${html}</body>`);
    const heading = normalizeWhitespace(
        $('h1, h2, h3, [epub\\:type~="title"], [role="doc-title"]').first().text(),
    );
    if (heading) return heading;

    const fallbackTitle = normalizeWhitespace(fallback);
    if (fallbackTitle) return fallbackTitle;

    const documentTitle = normalizeWhitespace($('title').first().text());
    return documentTitle;
};

const filterNonReadingChapters = async (
    loadDocument: ContentDocumentLoader,
    chapters: PlannedChapter[],
    manifest: Record<string, ManifestItem>,
    coverManifestId?: string,
    publicationTitle = '',
    publicationAuthor = '',
    referenceHandling: ReferenceHandlingMode = 'suppress',
): Promise<{
    chapters: PlannedChapter[];
    skippedChapters: SkippedPlannedChapter[];
    qualityRejections: RejectedContentUnit[];
    contentQualityProfile: ContentQualityProfile;
    contentQualityAudit: ContentQualityAuditRecord[];
}> => {
    const manifestByPath = new Map(
        Object.values(manifest).map((item) => [normalizeArchivePath(item.resolvedPath), item]),
    );
    const coverPath = coverManifestId && manifest[coverManifestId]
        ? normalizeArchivePath(manifest[coverManifestId].resolvedPath)
        : '';
    const readableChapters: PlannedChapter[] = [];
    const skippedChapters: SkippedPlannedChapter[] = [];
    const qualityRejections: RejectedContentUnit[] = [];
    const contentQualityAudit: ContentQualityAuditRecord[] = [];

    const rawUnits: RawContentUnit[] = [];
    for (const chapter of chapters) {
        for (const slice of chapter.slices) {
            const normalizedPath = normalizeArchivePath(slice.path);
            const document = await loadDocument(normalizedPath);
            const html = document.repairedHtml;
            if (!html) continue;

            const slicedHtml = extractSliceHtml(
                html,
                slice.startFragment,
                slice.endFragment,
                slice.startHeadingIndex,
                slice.endHeadingIndex,
                slice.startBlockIndex,
                slice.endBlockIndex,
            );
            const readableHtml = stripEmbeddedPublicationMatter(slicedHtml);
            const text = extractReadableTextFromHtml(readableHtml);
            rawUnits.push({
                ordinal: rawUnits.length,
                path: normalizedPath,
                html: readableHtml,
                text,
                lines: text.split('\n'),
                markupRecovery: document.recovery,
            });
        }
    }
    const contentQualityProfile = analyzeContentUnits(rawUnits);
    let rawUnitIndex = 0;

    for (const [chapterIndex, chapter] of chapters.entries()) {
        const readableSlices: ChapterSlice[] = [];
        const readableSliceEstimates: number[] = [];
        const readableSources: { html: string; text: string }[] = [];
        const skippedSlices: SkippedPlannedChapter[] = [];
        let bestTitle = normalizeWhitespace(chapter.title);

        for (const slice of chapter.slices) {
            const normalizedPath = normalizeArchivePath(slice.path);
            const document = await loadDocument(normalizedPath);
            const html = document.repairedHtml;
            if (!html) continue;

            const slicedHtml = extractSliceHtml(
                html,
                slice.startFragment,
                slice.endFragment,
                slice.startHeadingIndex,
                slice.endHeadingIndex,
                slice.startBlockIndex,
                slice.endBlockIndex,
            );
            const markupClassification = classifyArtifactMarkup(slicedHtml);
            const rawUnit = rawUnits[rawUnitIndex++];
            const readableHtml = rawUnit.html;
            const text = rawUnit.text;
            const sliceTitle = extractSliceTitle(readableHtml, bestTitle);
            const qualityResult = cleanContentUnit(rawUnit, contentQualityProfile, { referenceHandling });
            contentQualityAudit.push({
                path: normalizedPath,
                decision: qualityResult.decision,
                zone: qualityResult.zone,
                qualityScore: qualityResult.qualityScore,
                issues: qualityResult.issues,
                removedCharacters: qualityResult.removedCharacters,
                beforeSample: text.replace(/\s+/g, ' ').trim().slice(0, 240),
                afterSample: qualityResult.cleanedText.replace(/\s+/g, ' ').trim().slice(0, 240),
                markupRecovery: {
                    records: rawUnit.markupRecovery?.records || [],
                    repairedCandidateCount: rawUnit.markupRecovery?.records.filter((record) => record.action === 'repair').length || 0,
                    unresolvedCandidateCount: rawUnit.markupRecovery?.unresolvedCandidateCount || 0,
                    recoveredTokenCount: rawUnit.markupRecovery?.recoveredTokenCount || 0,
                    recoveredCharacterCount: rawUnit.markupRecovery?.recoveredCharacterCount || 0,
                },
            });

            if (qualityResult.decision === 'reject') {
                const rejection: RejectedContentUnit = {
                    path: normalizedPath,
                    qualityScore: qualityResult.qualityScore,
                    issues: qualityResult.issues,
                    reason: qualityResult.reason || 'Source unit rejected by content quality gate',
                };
                qualityRejections.push(rejection);
                skippedSlices.push({
                    title: extractSliceTitle(readableHtml, bestTitle) || bestTitle || 'Rejected source unit',
                    slices: [slice],
                    estimatedWords: countWords(qualityResult.cleanedText),
                    classificationType: 'quality',
                    reason: rejection.reason,
                });
                continue;
            }

            if (qualityResult.zone === 'notes' && referenceHandling !== 'keep') {
                skippedSlices.push({
                    title: sliceTitle || bestTitle || 'Notes',
                    slices: [slice],
                    estimatedWords: countWords(text),
                    classificationType: 'backmatter',
                    reason: `Notes omitted with reference handling mode: ${referenceHandling}`,
                });
                continue;
            }

            const cleanedHtml = qualityResult.cleanedHtml;
            const cleanedText = qualityResult.cleanedText;
            const manifestItem = manifestByPath.get(normalizedPath);

            if (chapter.title === 'Notes' && referenceHandling !== 'keep') {
                skippedSlices.push({
                    title: sliceTitle || 'Notes',
                    slices: [slice],
                    estimatedWords: countWords(text),
                    classificationType: 'backmatter',
                    reason: `Notes omitted with reference handling mode: ${referenceHandling}`,
                });
                continue;
            }

            const explicitClassification = normalizedPath === coverPath
                ? { type: 'cover' as const, reason: 'Manifest cover document', shouldIncludeInReading: false }
                : (manifestItem?.properties || '').split(/\s+/).includes('nav')
                    ? { type: 'toc' as const, reason: 'EPUB navigation document', shouldIncludeInReading: false }
                    : classifyArtifactLabel(sliceTitle, normalizedPath)
                        || classifyTitleMatter(
                            sliceTitle,
                            cleanedText,
                            cleanedHtml,
                            publicationTitle,
                            publicationAuthor,
                        )
                        || classifyEmbeddedContents(cleanedText)
                        || markupClassification;

            const classification = explicitClassification || classifyChapter(
                cleanedText,
                cleanedHtml,
                sliceTitle,
            );
            const estimatedWords = countWords(cleanedText);

            if (!classification.shouldIncludeInReading) {
                skippedSlices.push({
                    title: sliceTitle || bestTitle || 'Skipped Section',
                    slices: [slice],
                    estimatedWords,
                    classificationType: classification.type,
                    reason: classification.reason,
                });
                continue;
            }

            readableSlices.push(slice);
            readableSliceEstimates.push(estimatedWords);
            readableSources.push({ html: cleanedHtml, text: cleanedText });
            if (!bestTitle || isGenericChapterTitle(bestTitle) || bestTitle === 'Front Matter' || bestTitle === 'Opening') {
                bestTitle = sliceTitle || bestTitle;
            }
        }

        if (readableSlices.length === 0) {
            const imageOnlySlices = skippedSlices.filter((slice) => slice.classificationType === 'image');
            if (imageOnlySlices.length > 0) {
                skippedChapters.push(...skippedSlices.filter((slice) => slice.classificationType !== 'image' && slice.classificationType !== 'quality'));
                readableChapters.push({
                    ...chapter,
                    title: bestTitle || imageOnlySlices[0].title || `Chapter ${readableChapters.length + 1}`,
                    slices: imageOnlySlices.flatMap((slice) => slice.slices),
                    estimatedWords: imageOnlySlices.reduce((sum, slice) => sum + slice.estimatedWords, 0),
                });
            } else {
                skippedChapters.push(...skippedSlices.filter((slice) => slice.classificationType !== 'quality'));
            }

            if (skippedSlices.length === 0) {
                skippedChapters.push({
                    title: bestTitle || `Chapter ${chapterIndex + 1}`,
                    slices: chapter.slices,
                    estimatedWords: 0,
                    classificationType: 'image',
                    reason: 'No readable text found',
                });
            }
            continue;
        }

        skippedChapters.push(...skippedSlices.filter((slice) => slice.classificationType !== 'quality'));

        const readableChapter: PlannedChapter = {
            ...chapter,
            title: bestTitle || `Chapter ${readableChapters.length + 1}`,
            slices: readableSlices,
            sliceEstimatedWords: readableSliceEstimates,
            estimatedWords: readableSources.reduce((sum, source) => sum + countWords(source.text), 0),
        };

        const combinedText = readableSources.map((source) => source.text).join('\n\n');
        const combinedHtml = readableSources.map((source) => source.html).join('\n\n');
        const combinedClassification = classifyArtifactLabel(readableChapter.title, readableSlices[0].path)
            || classifyTitleMatter(
                readableChapter.title,
                combinedText,
                combinedHtml,
                publicationTitle,
                publicationAuthor,
            )
            || classifyChapter(combinedText, combinedHtml, readableChapter.title);

        if (!combinedClassification.shouldIncludeInReading) {
            skippedChapters.push({
                title: readableChapter.title,
                slices: readableChapter.slices,
                estimatedWords: readableChapter.estimatedWords,
                classificationType: combinedClassification.type,
                reason: combinedClassification.reason,
            });
            continue;
        }

        readableChapters.push(readableChapter);
    }

    return {
        chapters: readableChapters,
        skippedChapters,
        qualityRejections,
        contentQualityProfile,
        contentQualityAudit,
    };
};

export const buildEpubStructurePlan = async (
    zip: JSZip,
    options: EpubStructureOptions = {},
): Promise<EpubStructurePlan> => {
    const opfPath = await resolveOpfPath(zip);
    const opfEntry = findZipEntry(zip, opfPath);
    if (!opfEntry) {
        throw new Error(`Invalid EPUB: OPF not found at ${opfPath}`);
    }

    const opfContent = await opfEntry.async('string');
    const $opf = cheerio.load(opfContent, { xmlMode: true });
    const opfDir = getDirectoryPath(opfPath);

    const title = normalizeWhitespace(
        $opf('metadata > dc\\:title, metadata > title').first().text(),
    );
    const author = normalizeWhitespace(
        $opf('metadata > dc\\:creator, metadata > creator').first().text(),
    );
    const coverManifestId = normalizeWhitespace($opf('metadata > meta[name="cover"]').attr('content') || '') || undefined;

    const manifest: Record<string, ManifestItem> = {};
    $opf('manifest > item').each((_, el) => {
        const id = normalizeWhitespace($opf(el).attr('id') || '');
        const href = normalizeWhitespace($opf(el).attr('href') || '');
        if (!id || !href) return;

        manifest[id] = {
            id,
            href,
            mediaType: normalizeWhitespace($opf(el).attr('media-type') || '') || undefined,
            properties: normalizeWhitespace($opf(el).attr('properties') || '') || undefined,
            resolvedPath: resolveArchivePath(opfDir, href),
        };
    });

    const spine: SpineItem[] = [];
    $opf('spine > itemref').each((_, el) => {
        const idref = normalizeWhitespace($opf(el).attr('idref') || '');
        if (!idref) return;

        const linear = normalizeWhitespace(($opf(el).attr('linear') || 'yes').toLowerCase());
        if (linear === 'no') return;

        const item = manifest[idref];
        if (!item) return;

        const mediaType = (item.mediaType || '').toLowerCase();
        if (mediaType && !mediaType.includes('xhtml') && !mediaType.includes('html') && !mediaType.includes('xml')) {
            return;
        }

        spine.push({
            idref,
            href: item.href,
            resolvedPath: item.resolvedPath,
            index: spine.length,
        });
    });

    if (spine.length === 0) {
        throw new Error('Invalid EPUB: No linear spine documents found');
    }

    const loadDocument = createContentDocumentLoader(zip);
    const spineTocId = normalizeWhitespace($opf('spine').attr('toc') || '') || undefined;
    const tocCollection = await collectTocEntries(zip, manifest, spineTocId);
    const collectedTocEntries = tocCollection.entries;
    const tocEntries = await validateAndOrderTocEntries(collectedTocEntries, spine, loadDocument);
    const tocBoundaries = buildBoundariesFromToc(tocEntries, spine);
    const tocWasDegraded = tocEntries.length < collectedTocEntries.length;

    let headingRecovery: HeadingRecoveryResult | null = null;
    let rawChapters = tocBoundaries.length > 0
        ? buildChaptersFromBoundaries(tocBoundaries, spine)
        : buildFallbackSpineChapters(spine);

    if (tocBoundaries.length === 0 || rawChapters.length === 1 || tocWasDegraded) {
        headingRecovery = await buildHeadingChapters(loadDocument, spine);
        const headingFallback = headingRecovery.chapters;
        const headingIsMoreComplete = headingFallback && headingFallback.length > rawChapters.length;
        if (headingFallback && (
            (headingFallback.length > 1 && tocBoundaries.length === 0)
            || rawChapters.length === 1
            || (tocWasDegraded && headingIsMoreComplete)
        )) {
            rawChapters = headingFallback;
        }
    }

    const requestedStrategyId = options.structureStrategyId || 'auto-deterministic';
    if (requestedStrategyId !== 'auto-deterministic') {
        if (
            (requestedStrategyId === 'document-headings' || requestedStrategyId === 'ai-assisted-candidates')
            && !headingRecovery
        ) {
            headingRecovery = await buildHeadingChapters(loadDocument, spine);
        }

        const structureDiscoveryRegistry = options.structureDiscoveryRegistry || defaultStructureDiscoveryRegistry;
        const anchors = await createStructureDiscoveryAnchors(
            loadDocument,
            spine,
            tocEntries,
            headingRecovery,
            opfPath,
            options,
        );
        const strategy = structureDiscoveryRegistry.resolve(anchors.document, requestedStrategyId);
        const proposal = validateStructureProposal(
            anchors.document,
            await strategy.discover(anchors.document, { signal: new AbortController().signal }),
        );
        const discoveredChapters = buildChaptersFromStructureProposal(proposal, anchors, spine);
        if (discoveredChapters.length === 0) {
            throw new Error(`Structure strategy produced no usable boundaries: ${requestedStrategyId}`);
        }
        rawChapters = discoveredChapters;
    }

    const filtered = await filterNonReadingChapters(
        loadDocument,
        rawChapters,
        manifest,
        coverManifestId,
        title,
        author,
        options.referenceHandling || 'suppress',
    );
    if (filtered.chapters.length === 0) {
        throw new Error('Invalid EPUB: No readable content remains after excluding publication matter');
    }

    const normalizedStructure = normalizeReadingSections(filtered.chapters);
    const normalizedChapters = normalizedStructure.sections.map((section) => ({
        title: section.title,
        slices: section.slices,
        estimatedWords: section.estimatedWords,
        source: section.source,
        structureOwnership: section.ownership,
        reformationReason: section.reason,
        boundaryEvidence: section.boundaryEvidence,
        authoredGroupTitle: section.authoredGroupTitle,
        originalTitles: section.originalTitles,
    }));

    const sourceForEvidence = (evidence: BoundaryEvidence): ChapterSource => (
        evidence === 'publisher-toc' ? 'toc'
            : evidence === 'document-heading' || evidence === 'scan-heading' ? 'heading'
                : 'spine'
    );
    const diagnosticCandidates: StructureCandidateDiagnostic[] = [
        ...(headingRecovery?.semanticCandidates || []).map((candidate) => ({
            path: spine[candidate.index]?.resolvedPath || '',
            title: candidate.title,
            kind: 'dom-heading' as const,
            level: candidate.level,
            ordinal: candidate.ordinal,
            headingIndex: candidate.headingIndex,
            blockIndex: candidate.blockIndex,
        })),
        ...(headingRecovery?.scanCandidates || []).map((candidate) => ({
            path: spine[candidate.index]?.resolvedPath || '',
            title: candidate.title,
            kind: 'scan-heading' as const,
            level: candidate.level,
            ordinal: candidate.ordinal,
            headingIndex: candidate.headingIndex,
            blockIndex: candidate.blockIndex,
        })),
    ];
    const headingAbstentionReasons = headingRecovery?.abstentionReasons || (
        tocBoundaries.length > 0 && rawChapters.length > 1 && !tocWasDegraded
            ? ['Not attempted because validated TOC boundaries were available']
            : ['Heading recovery was not attempted']
    );
    const structureDiagnostics: StructureDiagnostics = {
        declaredToc: {
            nav: tocCollection.nav,
            ncx: tocCollection.ncx,
        },
        toc: {
            collectedEntries: collectedTocEntries.length,
            validatedEntries: tocEntries.length,
            boundaries: tocBoundaries.length,
            degraded: tocWasDegraded,
        },
        heading: {
            selectedSource: headingRecovery?.selectedSource || 'none',
            candidates: diagnosticCandidates,
            selectedBoundaries: (headingRecovery?.selectedBoundaries || []).map((boundary) => ({
                path: spine[boundary.index]?.resolvedPath || '',
                title: boundary.title,
                evidence: boundary.evidence,
            })),
            abstentionReasons: headingAbstentionReasons,
        },
        sourceUnits: normalizedStructure.sourceUnits.map((unit) => ({
            title: unit.title,
            source: sourceForEvidence(unit.boundaryEvidence),
            boundaryEvidence: unit.boundaryEvidence,
            estimatedWords: unit.estimatedWords,
            paths: unit.slices.map((slice) => slice.path),
        })),
        finalSections: normalizedStructure.sections.map((section) => ({
            title: section.title,
            source: section.source,
            ownership: section.ownership,
            reason: section.reason,
            boundaryEvidence: section.boundaryEvidence,
            authoredGroupTitle: section.authoredGroupTitle,
            estimatedWords: section.estimatedWords,
            paths: section.slices.map((slice) => slice.path),
        })),
        skipped: filtered.skippedChapters.map((chapter) => ({
            title: chapter.title,
            classificationType: chapter.classificationType,
            reason: chapter.reason,
            paths: chapter.slices.map((slice) => slice.path),
        })),
        qualityRejections: filtered.qualityRejections.map((rejection) => ({
            path: rejection.path,
            reason: rejection.reason,
        })),
    };

    return {
        opfPath,
        opfDir,
        title: title || 'Unknown Title',
        author: author || 'Unknown',
        coverManifestId,
        manifest,
        spine,
        chapters: normalizedChapters,
        skippedChapters: filtered.skippedChapters,
        qualityRejections: filtered.qualityRejections,
        contentQualityProfile: filtered.contentQualityProfile,
        contentQualityAudit: filtered.contentQualityAudit,
        structureVersion: normalizedStructure.version,
        structureMode: normalizedStructure.mode,
        structureDiagnostics,
    };
};

export const loadPlannedChapterSources = async (
    zip: JSZip,
    slices: ChapterSlice[],
    contentQualityProfile?: ContentQualityProfile,
    referenceHandling: ReferenceHandlingMode = 'suppress',
): Promise<LoadedChapterSlice[]> => {
    const loadDocument = createContentDocumentLoader(zip);
    const sources: LoadedChapterSlice[] = [];
    const rawUnits: RawContentUnit[] = [];

    for (const slice of slices) {
        const normalizedPath = normalizeArchivePath(slice.path);
        if (!normalizedPath) continue;

        const document = await loadDocument(normalizedPath);
        const html = document.repairedHtml;
        if (!html) continue;

        const slicedHtml = extractSliceHtml(
            html,
            slice.startFragment,
            slice.endFragment,
            slice.startHeadingIndex,
            slice.endHeadingIndex,
            slice.startBlockIndex,
            slice.endBlockIndex,
        );
        const readableHtml = stripEmbeddedPublicationMatter(slicedHtml);
        const text = extractReadableTextFromHtml(readableHtml);
        rawUnits.push({
            ordinal: rawUnits.length,
            path: normalizedPath,
            html: readableHtml,
            text,
            lines: text.split('\n'),
            markupRecovery: document.recovery,
        });
    }
    const profile = contentQualityProfile || analyzeContentUnits(rawUnits);
    let rawUnitIndex = 0;

    for (const slice of slices) {
        const normalizedPath = normalizeArchivePath(slice.path);
        if (!normalizedPath) continue;

        const html = (await loadDocument(normalizedPath)).repairedHtml;
        if (!html) continue;

        const rawUnit = rawUnits[rawUnitIndex++];
        const qualityResult = cleanContentUnit(rawUnit, profile, { referenceHandling });
        if (qualityResult.decision === 'reject') continue;
        if (qualityResult.zone === 'notes' && referenceHandling !== 'keep') continue;
        sources.push({
            path: normalizedPath,
            text: qualityResult.cleanedText,
            html: qualityResult.cleanedHtml,
        });
    }

    return sources;
};
