import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { classifyChapter, type ChapterClassification } from './cleaning';

export type ChapterSource = 'toc' | 'heading' | 'spine' | 'merged';

export type BoundaryEvidence = 'publisher-toc' | 'document-heading' | 'source-spine';
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
}

export interface ChapterSlice {
    path: string;
    startFragment?: string;
    endFragment?: string;
    startHeadingIndex?: number;
    endHeadingIndex?: number;
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
    classificationType: ChapterClassification['type'];
    reason: string;
}

export interface LoadedChapterSlice {
    path: string;
    text: string;
    html: string;
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
    structureVersion: 1;
    structureMode: StructureMode;
}

const MARKER_START = '__XYZ_CHAPTER_START__';
const MARKER_END = '__XYZ_CHAPTER_END__';

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
): string => {
    if (!startFragment && !endFragment && startHeadingIndex === undefined && endHeadingIndex === undefined) {
        return html;
    }

    const $ = cheerio.load(html);
    $('script, style, noscript').remove();

    const root = $('body').first();

    const findBoundaryElement = (
        fragment: string | undefined,
        headingIndex: number | undefined,
    ): cheerio.Cheerio<Element> | null => {
        if (fragment) {
            const fragmentElement = findFragmentElement($, fragment);
            if (fragmentElement) return fragmentElement;
        }
        if (headingIndex !== undefined) {
            const heading = $('h1, h2').eq(headingIndex);
            if (heading.length > 0) return heading;
        }
        return null;
    };

    const startElement = findBoundaryElement(startFragment, startHeadingIndex);
    if (startElement && startElement.length > 0) startElement.before(MARKER_START);

    const endElement = findBoundaryElement(endFragment, endHeadingIndex);
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
    if (unit.boundaryEvidence === 'document-heading') return false;
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
    boundaryEvidence: boundaryEvidenceForSource(chapter.source),
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
        : unit.boundaryEvidence === 'document-heading' ? 'heading' : 'spine',
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
                });
            } else {
                for (let spineIndex = current.index; spineIndex < next.index; spineIndex++) {
                    slices.push({
                        path: spine[spineIndex].resolvedPath,
                        startFragment: spineIndex === current.index ? current.fragment : undefined,
                        startHeadingIndex: spineIndex === current.index ? current.headingIndex : undefined,
                    });
                }
            }
        } else {
            for (let spineIndex = current.index; spineIndex < spine.length; spineIndex++) {
                slices.push({
                    path: spine[spineIndex].resolvedPath,
                    startFragment: spineIndex === current.index ? current.fragment : undefined,
                    startHeadingIndex: spineIndex === current.index ? current.headingIndex : undefined,
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

type HeadingKind = 'chapter' | 'book' | 'part' | 'section' | 'ordinal' | 'numbered-title';

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

interface TocDepthCandidate {
    title: string;
    resolvedPath: string;
    fragment?: string;
    depth: number;
}

const selectTocDepth = (candidates: TocDepthCandidate[]): TocEntry[] => {
    if (candidates.length === 0) return [];

    const byDepth = new Map<number, TocDepthCandidate[]>();
    for (const candidate of candidates) {
        const group = byDepth.get(candidate.depth) || [];
        group.push(candidate);
        byDepth.set(candidate.depth, group);
    }

    const groups = [...byDepth.entries()].sort(([left], [right]) => left - right);
    let selected = groups[0][1];

    for (let index = 1; index < groups.length && selected.length <= 2; index++) {
        const next = groups[index][1];
        if (next.length <= selected.length) break;
        selected = next;
    }

    return selected.map(({ title, resolvedPath, fragment }) => ({ title, resolvedPath, fragment }));
};

const buildHeadingChapters = async (
    zip: JSZip,
    spine: SpineItem[],
): Promise<PlannedChapter[] | null> => {
    const candidates: HeadingCandidate[] = [];

    for (const spineItem of spine) {
        const entry = findZipEntry(zip, spineItem.resolvedPath);
        if (!entry) continue;

        const html = await entry.async('string');
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
    }

    const boundaries: ChapterBoundary[] = [...selectHeadingFamily(candidates)];
    if (boundaries.length < 2) return null;

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
    }
    return chapters;
};

const extractNavEntries = async (
    zip: JSZip,
    navPath: string,
): Promise<TocEntry[]> => {
    const entry = findZipEntry(zip, navPath);
    if (!entry) return [];

    const html = await entry.async('string');
    const $ = cheerio.load(html);

    const navRoot = $('nav[epub\\:type="toc"], nav[role="doc-toc"]').first();
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

    return selectTocDepth(candidates);
};

const extractNcxEntries = async (
    zip: JSZip,
    ncxPath: string,
): Promise<TocEntry[]> => {
    const entry = findZipEntry(zip, ncxPath);
    if (!entry) return [];

    const xml = await entry.async('string');
    const $ = cheerio.load(xml, { xmlMode: true });
    const navDir = getDirectoryPath(ncxPath);

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

    return selectTocDepth(candidates);
};

const collectTocEntries = async (
    zip: JSZip,
    manifest: Record<string, ManifestItem>,
    spineTocId?: string,
): Promise<TocEntry[]> => {
    const navCandidates = Object.values(manifest)
        .filter((item) => {
            const properties = (item.properties || '').toLowerCase();
            const mediaType = (item.mediaType || '').toLowerCase();
            const href = item.href.toLowerCase();
            return properties.includes('nav')
                || href.includes('toc')
                || href.includes('nav')
                || mediaType.includes('xhtml')
                || mediaType.includes('html');
        })
        .filter((item) => item.href.toLowerCase().includes('toc') || item.href.toLowerCase().includes('nav') || (item.properties || '').toLowerCase().includes('nav'));

    const navEntries: TocEntry[] = [];
    for (const item of navCandidates) {
        const entries = await extractNavEntries(zip, item.resolvedPath);
        navEntries.push(...entries);
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

    const seenNcx = new Set<string>();
    const ncxEntries: TocEntry[] = [];
    for (const item of ncxCandidates) {
        if (seenNcx.has(item.id)) continue;
        seenNcx.add(item.id);
        const entries = await extractNcxEntries(zip, item.resolvedPath);
        ncxEntries.push(...entries);
    }

    const deduped: TocEntry[] = [];
    const seen = new Set<string>();
    for (const entry of [...navEntries, ...ncxEntries]) {
        const key = `${normalizeArchivePath(entry.resolvedPath)}#${entry.fragment || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }

    return deduped;
};

const isLowInformationTocTitle = (title: string): boolean => {
    const normalized = normalizeWhitespace(title).toLowerCase().replace(/[\s_-]+/g, ' ');
    return !normalized || /^(?:untitled|unknown|title|chapter|section|part|book|item|entry)$/i.test(normalized);
};

const validateAndOrderTocEntries = async (
    zip: JSZip,
    tocEntries: TocEntry[],
    spine: SpineItem[],
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
            if (html === undefined) {
                const entry = findZipEntry(zip, path);
                html = entry ? await entry.async('string') : '';
                htmlCache.set(path, html);
            }
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

    if (candidates.some((candidate) => /^(?:copyright|copyright page|legal notice|license|licence|project gutenberg license|imprint|colophon|about this (?:ebook|edition))$/.test(candidate))) {
        return { type: 'license', reason: 'Publication legal or production boilerplate', shouldIncludeInReading: false };
    }

    return null;
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

    if (/^(?:part|book|volume)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(title)) {
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
    zip: JSZip,
    chapters: PlannedChapter[],
    manifest: Record<string, ManifestItem>,
    coverManifestId?: string,
    publicationTitle = '',
    publicationAuthor = '',
): Promise<{ chapters: PlannedChapter[]; skippedChapters: SkippedPlannedChapter[] }> => {
    const manifestByPath = new Map(
        Object.values(manifest).map((item) => [normalizeArchivePath(item.resolvedPath), item]),
    );
    const coverPath = coverManifestId && manifest[coverManifestId]
        ? normalizeArchivePath(manifest[coverManifestId].resolvedPath)
        : '';
    const htmlCache = new Map<string, string>();
    const readableChapters: PlannedChapter[] = [];
    const skippedChapters: SkippedPlannedChapter[] = [];

    const loadHtml = async (path: string): Promise<string> => {
        const normalizedPath = normalizeArchivePath(path);
        const cached = htmlCache.get(normalizedPath);
        if (cached !== undefined) return cached;

        const entry = findZipEntry(zip, normalizedPath);
        const html = entry ? await entry.async('string') : '';
        htmlCache.set(normalizedPath, html);
        return html;
    };

    for (const [chapterIndex, chapter] of chapters.entries()) {
        const readableSlices: ChapterSlice[] = [];
        const readableSliceEstimates: number[] = [];
        const readableSources: { html: string; text: string }[] = [];
        const skippedSlices: SkippedPlannedChapter[] = [];
        let bestTitle = normalizeWhitespace(chapter.title);

        for (const slice of chapter.slices) {
            const normalizedPath = normalizeArchivePath(slice.path);
            const html = await loadHtml(normalizedPath);
            if (!html) continue;

            const slicedHtml = extractSliceHtml(
                html,
                slice.startFragment,
                slice.endFragment,
                slice.startHeadingIndex,
                slice.endHeadingIndex,
            );
            const markupClassification = classifyArtifactMarkup(slicedHtml);
            const readableHtml = stripEmbeddedPublicationMatter(slicedHtml);
            const text = extractReadableTextFromHtml(readableHtml);
            const sliceTitle = extractSliceTitle(readableHtml, bestTitle);
            const manifestItem = manifestByPath.get(normalizedPath);

            const explicitClassification = normalizedPath === coverPath
                ? { type: 'cover' as const, reason: 'Manifest cover document', shouldIncludeInReading: false }
                : (manifestItem?.properties || '').split(/\s+/).includes('nav')
                    ? { type: 'toc' as const, reason: 'EPUB navigation document', shouldIncludeInReading: false }
                    : classifyArtifactLabel(sliceTitle, normalizedPath)
                        || classifyTitleMatter(
                            sliceTitle,
                            text,
                            readableHtml,
                            publicationTitle,
                            publicationAuthor,
                        )
                        || markupClassification;

            const classification = explicitClassification || classifyChapter(
                text,
                readableHtml,
                sliceTitle,
            );
            const estimatedWords = countWords(text);

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
            readableSources.push({ html: readableHtml, text });
            if (!bestTitle || isGenericChapterTitle(bestTitle) || bestTitle === 'Front Matter' || bestTitle === 'Opening') {
                bestTitle = sliceTitle || bestTitle;
            }
        }

        skippedChapters.push(...skippedSlices);

        if (readableSlices.length === 0) {
            const imageOnlySlices = skippedSlices.filter((slice) => slice.classificationType === 'image');
            if (imageOnlySlices.length > 0) {
                readableChapters.push({
                    ...chapter,
                    title: bestTitle || imageOnlySlices[0].title || `Chapter ${readableChapters.length + 1}`,
                    slices: imageOnlySlices.flatMap((slice) => slice.slices),
                    estimatedWords: imageOnlySlices.reduce((sum, slice) => sum + slice.estimatedWords, 0),
                });
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

    return { chapters: readableChapters, skippedChapters };
};

export const buildEpubStructurePlan = async (zip: JSZip): Promise<EpubStructurePlan> => {
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

    const spineTocId = normalizeWhitespace($opf('spine').attr('toc') || '') || undefined;
    const collectedTocEntries = await collectTocEntries(zip, manifest, spineTocId);
    const tocEntries = await validateAndOrderTocEntries(zip, collectedTocEntries, spine);
    const tocBoundaries = buildBoundariesFromToc(tocEntries, spine);
    const tocWasDegraded = tocEntries.length < collectedTocEntries.length;

    let rawChapters = tocBoundaries.length > 0
        ? buildChaptersFromBoundaries(tocBoundaries, spine)
        : buildFallbackSpineChapters(spine);

    if (tocBoundaries.length === 0 || rawChapters.length === 1 || tocWasDegraded) {
        const headingFallback = await buildHeadingChapters(zip, spine);
        const headingIsMoreComplete = headingFallback && headingFallback.length > rawChapters.length;
        if (headingFallback && (
            (headingFallback.length > 1 && tocBoundaries.length === 0)
            || rawChapters.length === 1
            || (tocWasDegraded && headingIsMoreComplete)
        )) {
            rawChapters = headingFallback;
        }
    }

    const filtered = await filterNonReadingChapters(
        zip,
        rawChapters,
        manifest,
        coverManifestId,
        title,
        author,
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
        structureVersion: normalizedStructure.version,
        structureMode: normalizedStructure.mode,
    };
};

export const loadPlannedChapterSources = async (
    zip: JSZip,
    slices: ChapterSlice[],
): Promise<LoadedChapterSlice[]> => {
    const htmlCache = new Map<string, string>();
    const sources: LoadedChapterSlice[] = [];

    for (const slice of slices) {
        const normalizedPath = normalizeArchivePath(slice.path);
        if (!normalizedPath) continue;

        let html = htmlCache.get(normalizedPath);
        if (html === undefined) {
            const entry = findZipEntry(zip, normalizedPath);
            if (!entry) {
                htmlCache.set(normalizedPath, '');
                continue;
            }
            html = await entry.async('string');
            htmlCache.set(normalizedPath, html);
        }

        if (!html) continue;

        const slicedHtml = extractSliceHtml(
            html,
            slice.startFragment,
            slice.endFragment,
            slice.startHeadingIndex,
            slice.endHeadingIndex,
        );
        const readableHtml = stripEmbeddedPublicationMatter(slicedHtml);
        const text = extractReadableTextFromHtml(readableHtml);
        sources.push({
            path: normalizedPath,
            text,
            html: readableHtml,
        });
    }

    return sources;
};
