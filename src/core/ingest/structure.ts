import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { classifyChapter, type ChapterClassification } from './cleaning';

type ChapterSource = 'toc' | 'spine' | 'merged';

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
}

export interface ChapterSlice {
    path: string;
    startFragment?: string;
    endFragment?: string;
}

export interface PlannedChapter {
    title: string;
    slices: ChapterSlice[];
    estimatedWords: number;
    source: ChapterSource;
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
): string => {
    if (!startFragment && !endFragment) return html;

    const $ = cheerio.load(html);
    $('script, style, noscript').remove();

    const root = $('body').first();

    if (startFragment) {
        const startEl = findFragmentElement($, startFragment);
        if (startEl && startEl.length > 0) {
            startEl.before(MARKER_START);
        }
    }

    if (endFragment) {
        const endEl = findFragmentElement($, endFragment);
        if (endEl && endEl.length > 0) {
            endEl.before(MARKER_END);
        }
    }

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

const isGenericChapterTitle = (title: string): boolean => /^(chapter|section|part)\s+\d+$/i.test(normalizeWhitespace(title));

const mergeChapterPair = (left: PlannedChapter, right: PlannedChapter): PlannedChapter => {
    const leftTitle = normalizeWhitespace(left.title);
    const rightTitle = normalizeWhitespace(right.title);

    const keepRightTitle = isGenericChapterTitle(leftTitle) && rightTitle && !isGenericChapterTitle(rightTitle);
    const mergedTitle = keepRightTitle ? rightTitle : (leftTitle || rightTitle);

    return {
        title: mergedTitle,
        slices: [...left.slices, ...right.slices],
        estimatedWords: left.estimatedWords + right.estimatedWords,
        source: 'merged',
    };
};

const ensureChapterTitles = (chapters: PlannedChapter[]): PlannedChapter[] => chapters.map((chapter, index) => {
    const title = normalizeWhitespace(chapter.title);
    return {
        ...chapter,
        title: title || `Chapter ${index + 1}`,
    };
});

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
    }
    return sorted[midpoint];
};

const normalizeChapterGranularity = (chapters: PlannedChapter[]): PlannedChapter[] => {
    if (chapters.length < 8) {
        return ensureChapterTitles(chapters);
    }

    const pageLikeTitle = /^(?:(?:page|p\.?)[\s_-]*)?\d{1,5}$/i;
    const pageLikeTocEntries = chapters.filter((chapter) => (
        chapter.source === 'toc' && pageLikeTitle.test(normalizeWhitespace(chapter.title))
    )).length;
    const tocChapters = chapters.filter((chapter) => chapter.source === 'toc').length;
    const tocLooksPageBased = tocChapters > 0 && pageLikeTocEntries / tocChapters >= 0.35;

    if (tocChapters > 0 && !tocLooksPageBased) {
        return ensureChapterTitles(chapters);
    }

    const wordCounts = chapters.map((chapter) => chapter.estimatedWords);
    const medianWords = median(wordCounts);
    const tinyThreshold = medianWords < 180 ? 260 : 140;
    const tinyCount = wordCounts.filter((count) => count > 0 && count < tinyThreshold).length;
    const tinyRatio = tinyCount / Math.max(1, chapters.length);

    if (tinyRatio < 0.35) {
        return ensureChapterTitles(chapters);
    }

    const targetWords = Math.max(700, Math.min(2400, Math.round(medianWords * 5)));
    const merged: PlannedChapter[] = [];
    let bucket: PlannedChapter | null = null;

    for (const chapter of chapters) {
        if (!bucket) {
            bucket = { ...chapter, slices: [...chapter.slices] };
            continue;
        }

        const shouldMerge = bucket.estimatedWords < tinyThreshold
            || chapter.estimatedWords < tinyThreshold
            || bucket.estimatedWords < targetWords;

        if (shouldMerge) {
            bucket = mergeChapterPair(bucket, chapter);
            continue;
        }

        merged.push(bucket);
        bucket = { ...chapter, slices: [...chapter.slices] };
    }

    if (bucket) {
        merged.push(bucket);
    }

    if (merged.length > 1) {
        const last = merged[merged.length - 1];
        if (last.estimatedWords > 0 && last.estimatedWords < tinyThreshold) {
            const previous = merged[merged.length - 2];
            merged.splice(merged.length - 2, 2, mergeChapterPair(previous, last));
        }
    }

    return ensureChapterTitles(merged);
};

const buildChaptersFromBoundaries = (
    boundaries: ChapterBoundary[],
    spine: SpineItem[],
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
                });
            } else {
                for (let spineIndex = current.index; spineIndex < next.index; spineIndex++) {
                    slices.push({
                        path: spine[spineIndex].resolvedPath,
                        startFragment: spineIndex === current.index ? current.fragment : undefined,
                    });
                }
            }
        } else {
            for (let spineIndex = current.index; spineIndex < spine.length; spineIndex++) {
                slices.push({
                    path: spine[spineIndex].resolvedPath,
                    startFragment: spineIndex === current.index ? current.fragment : undefined,
                });
            }
        }

        const hasUsefulSlice = slices.some((slice) => normalizeArchivePath(slice.path).length > 0);
        if (!hasUsefulSlice) continue;

        chapters.push({
            title: current.title,
            slices,
            estimatedWords: 0,
            source: 'toc',
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

const looksLikeChapterHeading = (title: string): boolean => {
    const normalized = normalizeWhitespace(title);
    if (!normalized) return false;

    if (/^(chapter|book|part|section)\b/i.test(normalized)) return true;
    if (/^[ivxlcdm]{1,8}[.:-]?$/i.test(normalized)) return true;
    if (/^\d{1,3}[.:-]?$/i.test(normalized)) return true;

    return false;
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

const buildSingleSpineHeadingChapters = async (
    zip: JSZip,
    spine: SpineItem[],
): Promise<PlannedChapter[] | null> => {
    if (spine.length !== 1) return null;

    const onlySpinePath = spine[0].resolvedPath;
    const entry = findZipEntry(zip, onlySpinePath);
    if (!entry) return null;

    const html = await entry.async('string');
    const $ = cheerio.load(html);
    const headings: { title: string; fragment: string }[] = [];

    $('h1, h2').each((_, el) => {
        const title = normalizeWhitespace($(el).text());
        if (!looksLikeChapterHeading(title)) return;

        const fragment = normalizeWhitespace($(el).attr('id') || $(el).attr('name') || '');
        if (!fragment) return;

        headings.push({ title, fragment });
    });

    if (headings.length < 2) return null;

    return headings.map((heading, index) => ({
        title: heading.title,
        slices: [{
            path: onlySpinePath,
            startFragment: heading.fragment,
            endFragment: headings[index + 1]?.fragment,
        }],
        estimatedWords: 0,
        source: 'spine',
    }));
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

    const documentTitle = normalizeWhitespace($('title').first().text());
    return documentTitle || normalizeWhitespace(fallback);
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
        const readableSources: { html: string; text: string }[] = [];
        const skippedSlices: SkippedPlannedChapter[] = [];
        let bestTitle = normalizeWhitespace(chapter.title);

        for (const slice of chapter.slices) {
            const normalizedPath = normalizeArchivePath(slice.path);
            const html = await loadHtml(normalizedPath);
            if (!html) continue;

            const slicedHtml = extractSliceHtml(html, slice.startFragment, slice.endFragment);
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
            readableSources.push({ html: readableHtml, text });
            if (!bestTitle || isGenericChapterTitle(bestTitle) || bestTitle === 'Front Matter') {
                bestTitle = sliceTitle || bestTitle;
            }
        }

        skippedChapters.push(...skippedSlices);

        if (readableSlices.length === 0) {
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
    const tocEntries = await collectTocEntries(zip, manifest, spineTocId);
    const tocBoundaries = buildBoundariesFromToc(tocEntries, spine);

    let rawChapters = tocBoundaries.length > 0
        ? buildChaptersFromBoundaries(tocBoundaries, spine)
        : buildFallbackSpineChapters(spine);

    if (tocBoundaries.length === 0 || rawChapters.length === 1) {
        const headingFallback = await buildSingleSpineHeadingChapters(zip, spine);
        if (headingFallback && headingFallback.length > 1) {
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

    const normalizedChapters = normalizeChapterGranularity(filtered.chapters);

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

        const slicedHtml = extractSliceHtml(html, slice.startFragment, slice.endFragment);
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
