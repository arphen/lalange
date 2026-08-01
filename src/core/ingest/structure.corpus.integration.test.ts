import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEpubStructurePlan } from './structure';

const BOOKS_DIR = path.resolve(__dirname, '../../../books');
const ARTIFACT_TITLE = /^(?:cover|title page|(?:table of )?contents?(?: of (?:vol(?:ume)?|book|part)\.? [\divxlcdm]+)?|toc|copyright|license|licence|imprint|colophon)$/i;

describe.skipIf(process.env.RUN_EPUB_CORPUS !== '1')('EPUB structure corpus', () => {
    it('produces readable, artifact-free plans for repository EPUBs', async () => {
        const files = fs.readdirSync(BOOKS_DIR)
            .filter((file) => file.toLowerCase().endsWith('.epub'))
            .sort();

        expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
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
            expect(plan.chapters.length, `${file} should not be split at page granularity`).toBeLessThan(100);
            expect(totalWords, `${file} should contain substantial readable text`).toBeGreaterThan(200);
            expect(
                titles.some((title) => ARTIFACT_TITLE.test(title.trim())),
                `${file} should not expose publication artifacts`,
            ).toBe(false);
        }
    }, 30_000);
});
