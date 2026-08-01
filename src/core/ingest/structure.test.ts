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

    it('omits cover, table of contents, and license documents from planned chapters', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Clean Reading Plan</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />
                    <item id="contents" href="front-02.xhtml" media-type="application/xhtml+xml" />
                    <item id="title" href="front-03.xhtml" media-type="application/xhtml+xml" />
                    <item id="divider" href="front-04.xhtml" media-type="application/xhtml+xml" />
                    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
                    <item id="license" href="license.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="cover" />
                    <itemref idref="nav" />
                    <itemref idref="contents" />
                    <itemref idref="title" />
                    <itemref idref="divider" />
                    <itemref idref="chapter" />
                    <itemref idref="license" />
                </spine>
            </package>
        `);
        zip.file('OPS/cover.xhtml', xhtml('<h1>Cover</h1><img src="cover.jpg" alt="Cover" />'));
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc">
                <h1>Table of Contents</h1>
                <ol><li><a href="chapter.xhtml">Chapter One</a></li></ol>
            </nav>
        `));
        zip.file('OPS/front-02.xhtml', xhtml(`
            <section>
                <h1>CONTENTS OF VOL. I.</h1>
                <p>Chapter I. 1</p><p>Chapter II. 20</p><p>Chapter III. 42</p>
            </section>
        `));
        zip.file('OPS/front-03.xhtml', xhtml('<h1>Clean Reading Plan</h1><p>By Tester</p>'));
        zip.file('OPS/front-04.xhtml', xhtml('<h1>Part I</h1>'));
        zip.file('OPS/chapter.xhtml', xhtml(`<h1>Chapter One</h1><p>${repeatedWords('story', 300)}</p>`));
        zip.file('OPS/license.xhtml', xhtml(`
            <h1>Project Gutenberg License</h1>
            <p>THE FULL PROJECT GUTENBERG LICENSE</p>
            <p>Project Gutenberg Literary Archive Foundation trademark royalty redistribute electronic work gutenberg.org.</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters).toHaveLength(1);
        expect(plan.chapters[0].title).toBe('Chapter One');
        expect(plan.chapters[0].slices).toEqual([{ path: 'OPS/chapter.xhtml' }]);
    });

    it('keeps readable content when a TOC is embedded in the same document', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Inline Contents</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/book.xhtml', xhtml(`
            <section epub:type="toc">
                <h1>Contents</h1>
                <p>Chapter One</p><p>Chapter Two</p><p>Chapter Three</p>
            </section>
            <section>
                <h1>The Story</h1>
                <p>${repeatedWords('story', 400)}</p>
            </section>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const sources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);

        expect(plan.chapters).toHaveLength(1);
        expect(plan.chapters[0].estimatedWords).toBeGreaterThan(350);
        expect(sources[0].text).toContain('The Story');
        expect(sources[0].text).not.toContain('Contents');
        expect(sources[0].html).not.toContain('epub:type="toc"');
    });

    it('rejects EPUBs with no readable content after publication matter is removed', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Artifacts Only</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />
                    <item id="license" href="license.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="cover" /><itemref idref="license" /></spine>
            </package>
        `);
        zip.file('OPS/cover.xhtml', xhtml('<h1>Cover</h1><img src="cover.jpg" alt="Cover" />'));
        zip.file('OPS/license.xhtml', xhtml(`
            <h1>Project Gutenberg License</h1>
            <p>THE FULL PROJECT GUTENBERG LICENSE</p>
            <p>Project Gutenberg Literary Archive Foundation trademark royalty redistribute electronic work gutenberg.org.</p>
        `));

        await expect(buildEpubStructurePlan(zip)).rejects.toThrow('No readable content');
    });

    it('preserves short chapters when the EPUB TOC declares meaningful boundaries', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));

        const manifestItems = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />'];
        const spineItems: string[] = [];
        const navItems: string[] = [];

        for (let i = 1; i <= 12; i++) {
            manifestItems.push(`<item id="story${i}" href="story${i}.xhtml" media-type="application/xhtml+xml" />`);
            spineItems.push(`<itemref idref="story${i}" />`);
            navItems.push(`<li><a href="story${i}.xhtml">Story ${i}: A Distinct Tale</a></li>`);
            zip.file(`OPS/story${i}.xhtml`, xhtml(`<h1>Story ${i}: A Distinct Tale</h1><p>${repeatedWords(`story${i}_`, 40)}</p>`));
        }

        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Short Story Collection</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>${manifestItems.join('\n')}</manifest>
                <spine>${spineItems.join('\n')}</spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`<nav epub:type="toc"><ol>${navItems.join('\n')}</ol></nav>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters).toHaveLength(12);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
    });

    it('uses nested chapter links instead of a top-level book-title link', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Nested Navigation</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol><li>
                <a href="book.xhtml#title">Nested Navigation</a>
                <ol>
                    <li><a href="book.xhtml#ch1">Chapter I. Arrival</a></li>
                    <li><a href="book.xhtml#ch2">Chapter II. Discovery</a></li>
                    <li><a href="book.xhtml#ch3">Chapter III. Return</a></li>
                </ol>
            </li></ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="title">Nested Navigation</h1>
            <h2 id="ch1">Chapter I. Arrival</h2><p>${repeatedWords('arrival', 120)}</p>
            <h2 id="ch2">Chapter II. Discovery</h2><p>${repeatedWords('discovery', 120)}</p>
            <h2 id="ch3">Chapter III. Return</h2><p>${repeatedWords('return', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Chapter I. Arrival',
            'Chapter II. Discovery',
            'Chapter III. Return',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
    });

    it('keeps a complete peer-level TOC instead of partial nested subdivisions', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Essay Collection</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="first" href="first.xhtml" media-type="application/xhtml+xml" />
                    <item id="second" href="second.xhtml" media-type="application/xhtml+xml" />
                    <item id="third" href="third.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="first" />
                    <itemref idref="second" />
                    <itemref idref="third" />
                </spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="first.xhtml#first">The First Essay</a></li>
                <li><a href="second.xhtml#second">The Second Essay</a><ol>
                    <li><a href="second.xhtml#second-a">I A Question</a></li>
                    <li><a href="second.xhtml#second-b">II An Answer</a></li>
                </ol></li>
                <li><a href="third.xhtml#third">The Third Essay</a><ol>
                    <li><a href="third.xhtml#third-a">I A Beginning</a></li>
                    <li><a href="third.xhtml#third-b">II An Ending</a></li>
                </ol></li>
            </ol></nav>
        `));
        zip.file('OPS/first.xhtml', xhtml(`<h1 id="first">The First Essay</h1><p>${repeatedWords('first', 160)}</p>`));
        zip.file('OPS/second.xhtml', xhtml(`
            <h1 id="second">The Second Essay</h1><p>${repeatedWords('second', 80)}</p>
            <h2 id="second-a">I A Question</h2><p>${repeatedWords('question', 80)}</p>
            <h2 id="second-b">II An Answer</h2><p>${repeatedWords('answer', 80)}</p>
        `));
        zip.file('OPS/third.xhtml', xhtml(`
            <h1 id="third">The Third Essay</h1><p>${repeatedWords('third', 80)}</p>
            <h2 id="third-a">I A Beginning</h2><p>${repeatedWords('beginning', 80)}</p>
            <h2 id="third-b">II An Ending</h2><p>${repeatedWords('ending', 80)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'The First Essay',
            'The Second Essay',
            'The Third Essay',
        ]);
    });

    it('resolves parent-relative paths from navigation documents', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/package/content.opf'));
        zip.file('OPS/package/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Relative Navigation</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="chapter" href="../Text/chapter.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="chapter" /></spine>
            </package>
        `);
        zip.file('OPS/package/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="../Text/chapter.xhtml#one">The First Chapter</a></li>
                <li><a href="../Text/chapter.xhtml#two">The Second Chapter</a></li>
            </ol></nav>
        `));
        zip.file('OPS/Text/chapter.xhtml', xhtml(`
            <h1 id="one">The First Chapter</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="two">The Second Chapter</h1><p>${repeatedWords('second', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'The First Chapter',
            'The Second Chapter',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
        expect(plan.chapters[0].slices[0].path).toBe('OPS/Text/chapter.xhtml');
    });
});
