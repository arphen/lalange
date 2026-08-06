import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEpubStructurePlan, loadPlannedChapterSources } from './structure';

const BOOKS_DIR = path.resolve(process.env.EPUB_CORPUS_DIR || path.join(__dirname, '../../../books'));
const ARTIFACT_TITLE = /^(?:cover|title page|(?:table of )?contents?(?: of (?:vol(?:ume)?|book|part)\.? [\divxlcdm]+)?|toc|copyright|license|licence|imprint|colophon)$/i;
const KNOWN_CORRUPTED_EPUBS = new Set([
    'pg40739-images-3.epub',
    'pg40739-images.epub',
]);

describe.skipIf(process.env.RUN_EPUB_CORPUS !== '1')('EPUB structure corpus', () => {
    it('normalizes the gift EPUB page sequence into reader-facing sections', async () => {
        const file = 'giftformsfunctio00maus.epub';
        const archivePath = path.join(BOOKS_DIR, file);
        expect(fs.existsSync(archivePath), `${file} should exist in the EPUB corpus`).toBe(true);

        const zip = await JSZip.loadAsync(fs.readFileSync(archivePath));
        const plan = await buildEpubStructurePlan(zip);
        const pagePaths = Object.keys(zip.files)
            .filter((filePath) => /^EPUB\/page_\d+\.html$/i.test(filePath))
            .sort();
        const plannedPagePaths = plan.chapters
            .flatMap((chapter) => chapter.slices.map((slice) => slice.path))
            .filter((slicePath) => /^EPUB\/page_\d+\.html$/i.test(slicePath));
        const qualityRejectedPagePaths = plan.qualityRejections
            .map((rejection) => rejection.path)
            .filter((rejectionPath) => /^EPUB\/page_\d+\.html$/i.test(rejectionPath));
        const skippedPagePaths = plan.skippedChapters
            .flatMap((chapter) => chapter.slices.map((slice) => slice.path))
            .filter((slicePath) => /^EPUB\/page_\d+\.html$/i.test(slicePath));
        const resolvedChapters = await Promise.all(
            plan.chapters.map((chapter) => loadPlannedChapterSources(zip, chapter.slices, plan.contentQualityProfile)),
        );
        const resolvedText = resolvedChapters
            .flatMap((sources) => sources.map((source) => source.text))
            .join(' ');
        const resolvedWordTotal = resolvedText.trim().split(/\s+/).filter(Boolean).length;
        const sectionWords = plan.chapters.map((chapter) => chapter.estimatedWords).sort((left, right) => left - right);
        const medianWords = sectionWords[Math.floor(sectionWords.length / 2)] || 0;

        expect(plan.structureMode).toBe('generated');
        expect(plan.chapters.length).toBeGreaterThanOrEqual(12);
        expect(plan.chapters.length).toBeLessThanOrEqual(25);
        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(
            Array.from({ length: plan.chapters.length }, (_, index) => `Section ${index + 1}`),
        );
        expect(plan.chapters.every((chapter) => chapter.title !== 'Recovered')).toBe(true);
        const rejectedPagePathSet = new Set(qualityRejectedPagePaths);
        const skippedPagePathSet = new Set(skippedPagePaths);
        expect([...plannedPagePaths].sort()).toEqual(pagePaths
            .filter((pagePath) => !rejectedPagePathSet.has(pagePath) && !skippedPagePathSet.has(pagePath))
            .sort());
        expect(new Set([...plannedPagePaths, ...qualityRejectedPagePaths, ...skippedPagePaths])).toEqual(new Set(pagePaths));
        expect(new Set([...plannedPagePaths, ...qualityRejectedPagePaths, ...skippedPagePaths]).size)
            .toBe(plannedPagePaths.length + qualityRejectedPagePaths.length + skippedPagePaths.length);
        expect(new Set(plannedPagePaths).size).toBe(plannedPagePaths.length);
        expect(qualityRejectedPagePaths).toEqual([
            'EPUB/page_0.html',
            'EPUB/page_12.html',
            'EPUB/page_158.html',
            'EPUB/page_159.html',
            'EPUB/page_161.html',
            'EPUB/page_162.html',
            'EPUB/page_163.html',
        ]);
        expect(plan.qualityRejections.every((rejection) => rejection.reason.length > 0)).toBe(true);
        expect(skippedPagePaths).toContain('EPUB/page_104.html');
        expect(plan.skippedChapters.filter((chapter) => chapter.classificationType === 'backmatter')
            .every((chapter) => chapter.reason.includes('suppress'))).toBe(true);
        expect(resolvedText).not.toContain('The text on this page is estimated to be only');
        expect([...resolvedText].some((character) => {
            const codePoint = character.codePointAt(0) || 0;
            return codePoint <= 0x0008
                || codePoint === 0x000B
                || codePoint === 0x000C
                || (codePoint >= 0x000E && codePoint <= 0x001F)
                || (codePoint >= 0x007F && codePoint <= 0x009F);
        })).toBe(false);
        expect(resolvedText).not.toMatch(/(?:^|[\s.!?,;:()[\]{}"'])(?:\^+['"*®•♦■]+\^*|\^+\d{1,3}\^*|\^{2,})(?=$|[\s.,;!?()[\]{}"'])/u);
        expect(resolvedChapters.flatMap((sources) => sources.map((source) => source.text.trim()))
            .filter(Boolean)
            .every((text) => !/^(?:Page\s+\d+\s+)?(?:THE GIFT|\d+ THE GIFT)\b/i.test(text))).toBe(true);
        expect(resolvedText).toContain('Tahitian, Tongan and Mangarevan languages');
        expect(resolvedText).toContain('The Spirit of the Thing Given');
        expect(plan.chapters.reduce((total, chapter) => total + chapter.estimatedWords, 0)).toBe(resolvedWordTotal);
        expect(medianWords).toBeGreaterThanOrEqual(2_000);
        expect(medianWords).toBeLessThanOrEqual(5_000);
        expect(resolvedChapters.every((sources) => sources.some((source) => source.text.trim().length > 0))).toBe(true);
    }, 120_000);

    it('produces readable, artifact-free plans for repository EPUBs', async () => {
        const files = fs.readdirSync(BOOKS_DIR)
            .filter((file) => file.toLowerCase().endsWith('.epub'))
            .sort();

        expect(files.length).toBeGreaterThan(0);
        const failures: { file: string; reason: string }[] = [];

        for (const file of files) {
            try {
                const zip = await JSZip.loadAsync(fs.readFileSync(path.join(BOOKS_DIR, file)));
                const plan = await buildEpubStructurePlan(zip);
                const totalWords = plan.chapters.reduce((sum, chapter) => sum + chapter.estimatedWords, 0);
                const titles = plan.chapters.map((chapter) => chapter.title);
                const wordCounts = plan.chapters
                    .map((chapter) => chapter.estimatedWords)
                    .sort((left, right) => left - right);
                const medianWords = wordCounts[Math.floor(wordCounts.length / 2)] || 0;
                const tinyChapters = wordCounts.filter((wordCount) => wordCount < 100).length;
                const giantChapters = wordCounts.filter((wordCount) => wordCount > 30_000).length;
                const tinyTitles = plan.chapters
                    .filter((chapter) => chapter.estimatedWords < 100)
                    .map((chapter) => chapter.title);

                console.log(JSON.stringify({
                    file,
                    spine: plan.spine.length,
                    chapters: plan.chapters.length,
                    skipped: plan.skippedChapters.map((chapter) => chapter.classificationType),
                    totalWords,
                    chapterWords: {
                        min: wordCounts[0] || 0,
                        median: medianWords,
                        max: wordCounts.at(-1) || 0,
                        tiny: tinyChapters,
                        tinyTitles,
                        giant: giantChapters,
                    },
                    titles: titles.slice(0, 12),
                }));

                expect(plan.chapters.length, `${file} should have readable chapters`).toBeGreaterThan(0);
                expect(totalWords, `${file} should contain substantial readable text`).toBeGreaterThan(200);
                if (plan.chapters.length >= 8) {
                    expect(
                        tinyChapters / plan.chapters.length,
                        `${file} should not be dominated by tiny page-like chapters`,
                    ).toBeLessThan(0.35);
                }
                expect(plan.chapters.every((chapter) => chapter.slices.length > 0), `${file} should give every chapter a source slice`).toBe(true);
                expect(
                    titles.some((title) => ARTIFACT_TITLE.test(title.trim())),
                    `${file} should not expose publication artifacts`,
                ).toBe(false);

                const resolvedChapters = await Promise.all(
                    plan.chapters.map((chapter) => loadPlannedChapterSources(zip, chapter.slices)),
                );
                expect(resolvedChapters, `${file} should resolve every planned chapter`).toHaveLength(plan.chapters.length);
                for (const [chapterIndex, sources] of resolvedChapters.entries()) {
                    if (plan.chapters[chapterIndex].estimatedWords > 0) {
                        expect(
                            sources.some((source) => source.text.trim().length > 0),
                            `${file} chapter ${chapterIndex + 1} should resolve readable text`,
                        ).toBe(true);
                    }
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                failures.push({ file, reason });
                console.error(`[EPUB corpus] ${file}: ${reason}`);
            }
        }

        const unexpectedFailures = failures.filter(({ file }) => !KNOWN_CORRUPTED_EPUBS.has(file));
        const knownFailures = failures.filter(({ file }) => KNOWN_CORRUPTED_EPUBS.has(file));
        if (knownFailures.length > 0) {
            console.warn(`[EPUB corpus] Known corrupted fixtures: ${JSON.stringify(knownFailures)}`);
        }
        expect(unexpectedFailures, `EPUB corpus failures: ${JSON.stringify(unexpectedFailures)}`).toEqual([]);
    }, 120_000);
});
