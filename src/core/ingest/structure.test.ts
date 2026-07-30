import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEpubStructurePlan, loadPlannedChapterSources } from './structure';

const containerXml = (opfPath: string) => `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;

const repeatedWords = (prefix: string, count: number): string => {
    const words = Array.from({ length: count }, (_, index) => `${prefix}${index}`);
    return words.join(' ');
};

const xhtml = (body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;

describe('buildEpubStructurePlan', () => {
    it('uses container.xml rootfile instead of arbitrary OPF fallback', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));

        zip.file('wrong.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Wrong OPF</dc:title>
                    <dc:creator>Wrong Author</dc:creator>
                </metadata>
                <manifest>
                    <item id="w1" href="wrong.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="w1" />
                </spine>
            </package>
        `);

        zip.file('OEBPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Right OPF</dc:title>
                    <dc:creator>Right Author</dc:creator>
                </metadata>
                <manifest>
                    <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="c1" />
                </spine>
            </package>
        `);

        zip.file('OEBPS/chapter.xhtml', xhtml(`<p>${repeatedWords('word', 200)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.title).toBe('Right OPF');
        expect(plan.author).toBe('Right Author');
        expect(plan.chapters).toHaveLength(1);
        expect(plan.chapters[0].estimatedWords).toBeGreaterThan(100);
    });

    it('groups spine pages into meaningful chapters using TOC boundaries', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));

        zip.file('OEBPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>TOC Grouping</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml" />
                    <item id="p2" href="p2.xhtml" media-type="application/xhtml+xml" />
                    <item id="p3" href="p3.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="p1" />
                    <itemref idref="p2" />
                    <itemref idref="p3" />
                </spine>
            </package>
        `);

        zip.file('OEBPS/nav.xhtml', xhtml(`
            <nav epub:type="toc">
              <ol>
                <li><a href="p1.xhtml">Opening</a></li>
                <li><a href="p3.xhtml">Finale</a></li>
              </ol>
            </nav>
        `));
        zip.file('OEBPS/p1.xhtml', xhtml(`<h1>Opening</h1><p>${repeatedWords('alpha', 220)}</p>`));
        zip.file('OEBPS/p2.xhtml', xhtml(`<p>${repeatedWords('bridge', 220)}</p>`));
        zip.file('OEBPS/p3.xhtml', xhtml(`<h1>Finale</h1><p>${repeatedWords('omega', 220)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters).toHaveLength(2);
        expect(plan.chapters[0].title).toBe('Opening');
        expect(plan.chapters[0].slices).toHaveLength(2);
        expect(plan.chapters[1].title).toBe('Finale');
        expect(plan.chapters[1].slices).toHaveLength(1);
    });

    it('splits single-spine books by TOC fragments and keeps slice text isolated', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));

        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Fragment TOC</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="book" />
                </spine>
            </package>
        `);

        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc">
              <ol>
                <li><a href="book.xhtml#ch1">Chapter One</a></li>
                <li><a href="book.xhtml#ch2">Chapter Two</a></li>
                <li><a href="book.xhtml#ch3">Chapter Three</a></li>
              </ol>
            </nav>
        `));

        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="ch1">Chapter One</h1>
            <p>${repeatedWords('alpha', 120)}</p>
            <h1 id="ch2">Chapter Two</h1>
            <p>${repeatedWords('beta', 120)}</p>
            <h1 id="ch3">Chapter Three</h1>
            <p>${repeatedWords('gamma', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        expect(plan.chapters).toHaveLength(3);

        const firstChapterSources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);
        const secondChapterSources = await loadPlannedChapterSources(zip, plan.chapters[1].slices);

        const firstText = firstChapterSources.map((source) => source.text).join(' ');
        const secondText = secondChapterSources.map((source) => source.text).join(' ');

        expect(firstText).toContain('Chapter One');
        expect(firstText).not.toContain('Chapter Two');
        expect(secondText).toContain('Chapter Two');
        expect(secondText).not.toContain('Chapter Three');
    });

    it('splits single-spine books by anchored headings when TOC is missing', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));

        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Heading Fallback</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="book" />
                </spine>
            </package>
        `);

        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="ch1">Chapter I</h1>
            <p>${repeatedWords('first', 180)}</p>
            <h1 id="ch2">Chapter II</h1>
            <p>${repeatedWords('second', 180)}</p>
            <h1 id="ch3">Chapter III</h1>
            <p>${repeatedWords('third', 180)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters).toHaveLength(3);
        expect(plan.chapters[0].title).toBe('Chapter I');
        expect(plan.chapters[1].title).toBe('Chapter II');
        expect(plan.chapters[2].title).toBe('Chapter III');
    });

    it('merges pathological tiny spine slices into larger reading chapters', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));

        const manifestItems: string[] = [];
        const spineItems: string[] = [];

        for (let i = 1; i <= 12; i++) {
            manifestItems.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml" />`);
            spineItems.push(`<itemref idref="c${i}" />`);
            zip.file(`OPS/c${i}.xhtml`, xhtml(`<p>${repeatedWords(`tiny${i}_`, 20)}</p>`));
        }

        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Tiny Pages</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    ${manifestItems.join('\n')}
                </manifest>
                <spine>
                    ${spineItems.join('\n')}
                </spine>
            </package>
        `);

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.length).toBeLessThan(12);
        expect(plan.chapters.some((chapter) => chapter.source === 'merged')).toBe(true);
    });
});
