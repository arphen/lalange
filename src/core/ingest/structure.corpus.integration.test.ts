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

        const expectedTitles = [
            'Opening',
            'Introduction',
            "Translator's Note",
            'Introductory: Gifts and Return Gifts',
            'Chapter I: Gifts and the Obligation to Return Gifts',
            'Chapter II: Distribution of the System: Generosity, Honour and Money',
            'Chapter III: Survivals in Early Literature',
            'Chapter IV: Conclusions',
        ];
        const expectedStarts = [
            'EPUB/notice.html',
            'EPUB/page_13.html',
            'EPUB/page_19.html',
            'EPUB/page_22.html',
            'EPUB/page_28.html',
            'EPUB/page_39.html',
            'EPUB/page_68.html',
            'EPUB/page_85.html',
        ];

        expect(plan.structureMode).toBe('authored');
        expect(plan.structureDiagnostics.declaredToc.nav).toMatchObject({
            state: 'present-empty',
            paths: ['EPUB/nav.xhtml'],
            entryCount: 0,
        });
        expect(plan.structureDiagnostics.declaredToc.ncx).toMatchObject({
            state: 'present-empty',
            paths: ['EPUB/toc.ncx'],
            entryCount: 0,
        });
        expect(plan.structureDiagnostics.toc).toMatchObject({
            collectedEntries: 0,
            validatedEntries: 0,
            boundaries: 0,
            degraded: false,
        });
        expect(plan.structureDiagnostics.heading.selectedSource).toBe('scan-heading');
        expect(plan.structureDiagnostics.heading.candidates.some((candidate) => (
            candidate.kind === 'scan-heading'
            && candidate.title === 'Chapter I: Gifts and the Obligation to Return Gifts'
            && candidate.path === 'EPUB/page_28.html'
        ))).toBe(true);
        expect(plan.structureDiagnostics.finalSections.map((section) => section.title)).toEqual(expectedTitles);
        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(expectedTitles);
        expect(plan.chapters.map((chapter) => chapter.slices[0]?.path)).toEqual(expectedStarts);
        expect(plan.chapters[0].source).toBe('spine');
        expect(plan.chapters.slice(1).every((chapter) => (
            chapter.source === 'heading'
            && chapter.structureOwnership === 'authored'
            && chapter.reformationReason === 'authored-boundary'
            && chapter.boundaryEvidence?.includes('scan-heading')
            && chapter.authoredGroupTitle === chapter.title
        ))).toBe(true);
        expect(plan.chapters.every((chapter) => chapter.title !== 'Recovered')).toBe(true);

        const recoveredStarts = expectedStarts.slice(1);
        for (const chapter of plan.chapters.slice(1)) {
            const chapterPaths = chapter.slices.map((slice) => slice.path);
            expect(recoveredStarts.filter((start) => chapterPaths.includes(start))).toHaveLength(1);
        }
        const translatorNote = plan.chapters.find((chapter) => chapter.title === "Translator's Note");
        const introductoryChapter = plan.chapters.find((chapter) => chapter.title.startsWith('Introductory:'));
        expect(translatorNote?.slices.map((slice) => slice.path)).not.toContain('EPUB/page_21.html');
        expect(translatorNote?.slices.map((slice) => slice.path)).not.toContain('EPUB/page_22.html');
        expect(introductoryChapter?.slices.map((slice) => slice.path)).toContain('EPUB/page_22.html');
        expect(plan.chapters.some((chapter) => chapter.title.startsWith('Notes'))).toBe(false);
        expect(plan.skippedChapters.some((chapter) => (
            chapter.classificationType === 'toc'
            && chapter.slices.some((slice) => slice.path === 'EPUB/page_21.html')
        ))).toBe(true);

        const skippedNotePaths = plan.skippedChapters
            .filter((chapter) => chapter.classificationType === 'backmatter')
            .flatMap((chapter) => chapter.slices.map((slice) => slice.path));
        expect(skippedNotePaths).toContain('EPUB/page_104.html');
        expect(skippedNotePaths).toContain('EPUB/page_152.html');
        expect(plan.skippedChapters
            .filter((chapter) => chapter.classificationType === 'backmatter')
            .every((chapter) => chapter.reason.includes('suppress'))).toBe(true);

        const repeatedPlan = await buildEpubStructurePlan(zip);
        expect(repeatedPlan.structureMode).toBe(plan.structureMode);
        expect(repeatedPlan.chapters.map(({ title, slices, boundaryEvidence }) => ({ title, slices, boundaryEvidence })))
            .toEqual(plan.chapters.map(({ title, slices, boundaryEvidence }) => ({ title, slices, boundaryEvidence })));

        const keptPlan = await buildEpubStructurePlan(zip, { referenceHandling: 'keep' });
        const keptNotes = keptPlan.chapters.filter((chapter) => chapter.title.startsWith('Notes'));
        expect(keptPlan.structureMode).toBe('hybrid');
        expect(keptNotes.length).toBeGreaterThan(0);
        expect(keptNotes.every((chapter) => (
            chapter.source === 'heading' && chapter.boundaryEvidence?.includes('scan-heading')
        ))).toBe(true);
        expect(keptNotes.flatMap((chapter) => chapter.slices.map((slice) => slice.path)))
            .toContain('EPUB/page_104.html');
        expect(keptNotes.flatMap((chapter) => chapter.slices.map((slice) => slice.path)))
            .toContain('EPUB/page_152.html');

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
        expect(resolvedText).not.toContain('CONTENTS Introductory');
        expect(resolvedChapters[3].map((source) => source.text).join(' '))
            .toContain('I have never found a man so generous and hospitable');
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
