import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildEpubStructurePlan, loadPlannedChapterSources, normalizeReadingSections, type PlannedChapter } from './structure';
import { StructureDiscoveryRegistry } from './structureStrategies';

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
    it('applies an explicitly requested source-anchored structure strategy', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Strategy Test</dc:title><dc:creator>Tester</dc:creator></metadata>
                <manifest>
                    <item id="one" href="one.xhtml" media-type="application/xhtml+xml" />
                    <item id="two" href="two.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="one" /><itemref idref="two" /></spine>
            </package>
        `);
        zip.file('OPS/one.xhtml', xhtml('<h1>First</h1><p>First chapter prose.</p>'));
        zip.file('OPS/two.xhtml', xhtml('<h1>Second</h1><p>Second chapter prose.</p>'));

        const registry = new StructureDiscoveryRegistry([{
            id: 'second-source-unit',
            displayName: 'Second source unit',
            version: '1',
            kind: 'deterministic',
            supports: (input) => input.units.length === 2,
            discover: async (input) => ({
                pluginId: 'second-source-unit',
                pluginVersion: '1',
                boundaries: [{
                    sourceAnchorId: input.units[1].id,
                    evidence: ['test-source-anchor'],
                    confidence: 1,
                }],
                issues: [],
            }),
        }]);

        const plan = await buildEpubStructurePlan(zip, {
            structureStrategyId: 'second-source-unit',
            structureDiscoveryRegistry: registry,
        });

        expect(plan.chapters).toHaveLength(1);
        expect(plan.chapters[0].title).toBe('Second');
        expect(plan.chapters[0].slices[0].path).toBe('OPS/two.xhtml');
    });

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
        expect(plan.structureDiagnostics.declaredToc.nav.state).toBe('absent');
        expect(plan.structureDiagnostics.declaredToc.ncx.state).toBe('absent');
    });

    it('uses the same repaired XHTML for planning, quality, and final loading', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Markup Recovery</dc:title><dc:creator>Tester</dc:creator></metadata>
                <manifest>
                    <item id="one" href="one.xhtml" media-type="application/xhtml+xml" />
                    <item id="two" href="two.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="one" /><itemref idref="two" /></spine>
            </package>
        `);
        zip.file('OPS/one.xhtml', xhtml(`
            <h1>Chapter One</h1>
            <p>Opening prose before the malformed sequence.</p>
            <p><..case-- exchange="" so="" the="" potlatch="" in="" north-="" west="" america="" types=""/></p>
            <p>Closing prose after the malformed sequence.</p>
        `));
        zip.file('OPS/two.xhtml', xhtml(`
            <h1>Chapter Two</h1>
            <p>Opening prose before the synthetic sequence.</p>
            <p><f cf.="" also="" venia="" venus="" venenum="" vanati="" to="" give="" pleasure="" and="" disposition=""/></p>
            <p>Closing prose after the synthetic sequence.</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const resolved = await Promise.all(
            plan.chapters.map((chapter) => loadPlannedChapterSources(zip, chapter.slices, plan.contentQualityProfile)),
        );
        const resolvedText = resolved.flatMap((sources) => sources.map((source) => source.text)).join(' ');
        const recoveryRecords = plan.contentQualityAudit.flatMap((record) => record.markupRecovery.records);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Chapter One', 'Chapter Two']);
        expect(resolvedText).toContain('exchange so the potlatch in north- west america');
        expect(resolvedText).toContain('cf. also venia venus venenum');
        expect(resolvedText).not.toContain('=""');
        expect(recoveryRecords.map((record) => record.kind)).toEqual([
            'invalid-pseudo-tag',
            'synthetic-empty-element',
        ]);
        expect(plan.contentQualityAudit.every((record) => record.decision === 'accept-degraded')).toBe(true);
        expect(plan.contentQualityAudit.every((record) => (
            record.issues.some((issue) => issue.type === 'malformed-prose-markup')
        ))).toBe(true);
        expect(plan.chapters.reduce((total, chapter) => total + chapter.estimatedWords, 0)).toBe(
            resolvedText.trim().split(/\s+/).filter(Boolean).length,
        );
    });

    it('reports a declared nav document without a TOC root as invalid', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
        zip.file('OEBPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Invalid Nav</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OEBPS/nav.xhtml', xhtml('<p>not a navigation document</p>'));
        zip.file('OEBPS/book.xhtml', xhtml(`<p>${repeatedWords('word', 200)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.structureDiagnostics.declaredToc.nav).toMatchObject({
            state: 'present-invalid',
            paths: ['OEBPS/nav.xhtml'],
            entryCount: 0,
        });
        expect(plan.structureDiagnostics.declaredToc.ncx.state).toBe('absent');
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
        expect(plan.structureDiagnostics.declaredToc.nav).toMatchObject({
            state: 'present-valid',
            paths: ['OEBPS/nav.xhtml'],
            entryCount: 2,
        });
        expect(plan.structureDiagnostics.declaredToc.ncx.state).toBe('absent');
        expect(plan.chapters[0].title).toBe('Opening');
        expect(plan.chapters[0].slices).toHaveLength(2);
        expect(plan.chapters[1].title).toBe('Finale');
        expect(plan.chapters[1].slices).toHaveLength(1);
    });

    it('does not treat generated toc-like filename suffixes as navigation documents', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
        zip.file('OEBPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Generated Filename Navigation</dc:title></metadata>
                <manifest>
                    <item id="nav" href="NavJohnBrown.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="preface" href="05_PrefaceJohnBrownvlthmfuwrmefxonbsyetochqcom.xhtml" media-type="application/xhtml+xml" />
                    <item id="one" href="08_ChapterOne.xhtml" media-type="application/xhtml+xml" />
                    <item id="two" href="09_ChapterTwo.xhtml" media-type="application/xhtml+xml" />
                    <item id="disclaimer" href="disclaimerJohnBrown.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="preface" />
                    <itemref idref="one" />
                    <itemref idref="two" />
                    <itemref idref="disclaimer" />
                </spine>
            </package>
        `);
        zip.file('OEBPS/NavJohnBrown.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="05_PrefaceJohnBrownvlthmfuwrmefxonbsyetochqcom.xhtml">Preface</a></li>
                <li><a href="08_ChapterOne.xhtml">Chapter One</a></li>
                <li><a href="09_ChapterTwo.xhtml">Chapter Two</a></li>
                <li><a href="disclaimerJohnBrown.xhtml">Disclaimer</a></li>
            </ol></nav>
        `));
        zip.file('OEBPS/05_PrefaceJohnBrownvlthmfuwrmefxonbsyetochqcom.xhtml', xhtml(`
            <h1>Preface</h1>
            <p><a href="#page-1">1</a> ${repeatedWords('preface', 120)}</p>
            <p><a href="#page-2">2</a> ${repeatedWords('preface-end', 120)}</p>
        `));
        zip.file('OEBPS/08_ChapterOne.xhtml', xhtml(`<h1>Chapter One</h1><p>${repeatedWords('one', 180)}</p>`));
        zip.file('OEBPS/09_ChapterTwo.xhtml', xhtml(`<h1>Chapter Two</h1><p>${repeatedWords('two', 180)}</p>`));
        zip.file('OEBPS/disclaimerJohnBrown.xhtml', xhtml('<h1>Disclaimer</h1><p>This eBook is licensed to a reader.</p>'));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.structureDiagnostics.declaredToc.nav).toMatchObject({
            state: 'present-valid',
            paths: ['OEBPS/NavJohnBrown.xhtml'],
            entryCount: 4,
        });
        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Preface',
            'Chapter One',
            'Chapter Two',
        ]);
    });

    it('selects numbered chapter children under authored part entries', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OEBPS/content.opf'));
        zip.file('OEBPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Part Hierarchy</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="part1" href="part1.xhtml" media-type="application/xhtml+xml" />
                    <item id="one" href="one.xhtml" media-type="application/xhtml+xml" />
                    <item id="two" href="two.xhtml" media-type="application/xhtml+xml" />
                    <item id="part2" href="part2.xhtml" media-type="application/xhtml+xml" />
                    <item id="three" href="three.xhtml" media-type="application/xhtml+xml" />
                    <item id="four" href="four.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="part1" />
                    <itemref idref="one" />
                    <itemref idref="two" />
                    <itemref idref="part2" />
                    <itemref idref="three" />
                    <itemref idref="four" />
                </spine>
            </package>
        `);
        zip.file('OEBPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="part1.xhtml">I. The Symptom</a><ol>
                    <li><a href="one.xhtml">1. How Did Marx Invent the Symptom?</a></li>
                    <li><a href="two.xhtml">2. From Symptom to Sinthome</a></li>
                </ol></li>
                <li><a href="part2.xhtml">II. Lack in the Other</a><ol>
                    <li><a href="three.xhtml">3. Che Vuoi?</a></li>
                    <li><a href="four.xhtml">4. You Only Die Twice</a></li>
                </ol></li>
            </ol></nav>
        `));
        zip.file('OEBPS/part1.xhtml', xhtml('<h1>I. The Symptom</h1>'));
        zip.file('OEBPS/part2.xhtml', xhtml('<h1>II. Lack in the Other</h1>'));
        zip.file('OEBPS/one.xhtml', xhtml(`<h1>1. How Did Marx Invent the Symptom?</h1><p>${repeatedWords('one', 180)}</p>`));
        zip.file('OEBPS/two.xhtml', xhtml(`<h1>2. From Symptom to Sinthome</h1><p>${repeatedWords('two', 180)}</p>`));
        zip.file('OEBPS/three.xhtml', xhtml(`<h1>3. Che Vuoi?</h1><p>${repeatedWords('three', 180)}</p>`));
        zip.file('OEBPS/four.xhtml', xhtml(`<h1>4. You Only Die Twice</h1><p>${repeatedWords('four', 180)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            '1. How Did Marx Invent the Symptom?',
            '2. From Symptom to Sinthome',
            '3. Che Vuoi?',
            '4. You Only Die Twice',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
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

    it('recovers a coherent sequence of titled headings without fragment IDs', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>ID-less Chapters</dc:title></metadata>
                <manifest><item id="book" href="book.xhtml" media-type="application/xhtml+xml" /></manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/book.xhtml', xhtml(`
            <h2>I. Loomings</h2><p>${repeatedWords('first', 120)}</p>
            <h2>II. The Carpet-Bag</h2><p>${repeatedWords('second', 120)}</p>
            <h2>III. The Spouter-Inn</h2><p>${repeatedWords('third', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const firstSources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);
        const secondSources = await loadPlannedChapterSources(zip, plan.chapters[1].slices);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'I. Loomings',
            'II. The Carpet-Bag',
            'III. The Spouter-Inn',
        ]);
        expect(firstSources.map((source) => source.text).join(' ')).not.toContain('second0');
        expect(secondSources.map((source) => source.text).join(' ')).not.toContain('third0');
    });

    it('recovers a coherent sequence of written-number headings', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Written Numbers</dc:title></metadata>
                <manifest><item id="book" href="book.xhtml" media-type="application/xhtml+xml" /></manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/book.xhtml', xhtml(`
            <h2>ONE. The Door</h2><p>${repeatedWords('first', 120)}</p>
            <h2>TWO. The Hall</h2><p>${repeatedWords('second', 120)}</p>
            <h2>THREE. The Garden</h2><p>${repeatedWords('third', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'ONE. The Door',
            'TWO. The Hall',
            'THREE. The Garden',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'heading')).toBe(true);
    });

    it('does not promote an isolated numbered heading to a chapter boundary', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Decorative Number</dc:title></metadata>
                <manifest><item id="book" href="book.xhtml" media-type="application/xhtml+xml" /></manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/book.xhtml', xhtml(`
            <h1>A Complete Essay</h1><p>${repeatedWords('opening', 120)}</p>
            <h2>I. A Digression</h2><p>${repeatedWords('ending', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters).toHaveLength(1);
        expect(plan.chapters[0].title).toBe('A Complete Essay');
    });

    it('rejects broken TOC fragments and recovers authored heading boundaries', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Broken Navigation</dc:title>
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
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#missing-one">Chapter I</a></li>
                <li><a href="book.xhtml#missing-two">Chapter II</a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="chapter-one">Chapter I</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="chapter-two">Chapter II</h1><p>${repeatedWords('second', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const firstSources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);
        const secondSources = await loadPlannedChapterSources(zip, plan.chapters[1].slices);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Chapter I', 'Chapter II']);
        expect(firstSources.map((source) => source.text).join(' ')).not.toContain('second0');
        expect(secondSources.map((source) => source.text).join(' ')).not.toContain('first0');
    });

    it('prefers a complete heading sequence over a partially broken TOC', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Partial Navigation</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#one">Chapter I</a></li>
                <li><a href="book.xhtml#missing-two">Chapter II</a></li>
                <li><a href="book.xhtml#three">Chapter III</a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="one">Chapter I</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="two">Chapter II</h1><p>${repeatedWords('second', 120)}</p>
            <h1 id="three">Chapter III</h1><p>${repeatedWords('third', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const firstSources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Chapter I', 'Chapter II', 'Chapter III']);
        expect(plan.chapters.every((chapter) => chapter.source === 'heading')).toBe(true);
        expect(firstSources.map((source) => source.text).join(' ')).not.toContain('second0');
    });

    it('orders reversed TOC fragments by their physical document position', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Reversed Navigation</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#chapter-two">Chapter II</a></li>
                <li><a href="book.xhtml#chapter-one">Chapter I</a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="chapter-one">Chapter I</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="chapter-two">Chapter II</h1><p>${repeatedWords('second', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);
        const firstSources = await loadPlannedChapterSources(zip, plan.chapters[0].slices);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Chapter I', 'Chapter II']);
        expect(firstSources.map((source) => source.text).join(' ')).not.toContain('second0');
    });

    it('rejects semantic pagebreak links that masquerade as chapter navigation', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Pagebreak Navigation</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#page-1">1</a></li>
                <li><a href="book.xhtml#page-2">2</a></li>
                <li><a href="book.xhtml#page-3">3</a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <span id="page-1" epub:type="pagebreak">1</span>
            <h1>Chapter I</h1><p>${repeatedWords('first', 120)}</p>
            <span id="page-2" role="doc-pagebreak">2</span>
            <h1>Chapter II</h1><p>${repeatedWords('second', 120)}</p>
            <span id="page-3" epub:type="pagebreak">3</span>
            <h1>Chapter III</h1><p>${repeatedWords('third', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Chapter I',
            'Chapter II',
            'Chapter III',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'heading')).toBe(true);
    });

    it('repairs repeated low-information TOC labels from their exact target headings', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Weak Labels</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#one">Untitled</a></li>
                <li><a href="book.xhtml#two">Untitled</a></li>
                <li><a href="book.xhtml#three"></a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="one">Chapter One: Arrival</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="two">Chapter Two: Discovery</h1><p>${repeatedWords('second', 120)}</p>
            <h1 id="three">Chapter Three: Return</h1><p>${repeatedWords('third', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Chapter One: Arrival',
            'Chapter Two: Discovery',
            'Chapter Three: Return',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
    });

    it('enriches generic Roman-numeral TOC labels from target headings', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Richer Headings</dc:title></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="book" href="book.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine><itemref idref="book" /></spine>
            </package>
        `);
        zip.file('OPS/nav.xhtml', xhtml(`
            <nav epub:type="toc"><ol>
                <li><a href="book.xhtml#one">Chapter I</a></li>
                <li><a href="book.xhtml#two">Chapter II</a></li>
            </ol></nav>
        `));
        zip.file('OPS/book.xhtml', xhtml(`
            <h1 id="one">Chapter I: Arrival</h1><p>${repeatedWords('first', 120)}</p>
            <h1 id="two">Chapter II: Discovery</h1><p>${repeatedWords('second', 120)}</p>
        `));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Chapter I: Arrival',
            'Chapter II: Discovery',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'toc')).toBe(true);
    });

    it('groups page-like spine files under conservative authored headings', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Page Spine</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml" />
                    <item id="page2" href="page2.xhtml" media-type="application/xhtml+xml" />
                    <item id="page3" href="page3.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="page1" />
                    <itemref idref="page2" />
                    <itemref idref="page3" />
                </spine>
            </package>
        `);
        zip.file('OPS/page1.xhtml', xhtml(`<h1>Chapter I</h1><p>${repeatedWords('first', 100)}</p>`));
        zip.file('OPS/page2.xhtml', xhtml(`<p>${repeatedWords('continued', 100)}</p>`));
        zip.file('OPS/page3.xhtml', xhtml(`<h1>Chapter II</h1><p>${repeatedWords('second', 100)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Chapter I', 'Chapter II']);
        expect(plan.chapters[0].slices.map((slice) => slice.path)).toEqual([
            'OPS/page1.xhtml',
            'OPS/page2.xhtml',
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'heading')).toBe(true);
    });

    it('recovers coherent headings from leading paragraph blocks in page-like spine files', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Paragraph Headings</dc:title></metadata>
                <manifest>
                    <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml" />
                    <item id="page2" href="page2.xhtml" media-type="application/xhtml+xml" />
                    <item id="page3" href="page3.xhtml" media-type="application/xhtml+xml" />
                    <item id="page4" href="page4.xhtml" media-type="application/xhtml+xml" />
                    <item id="page5" href="page5.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="page1" />
                    <itemref idref="page2" />
                    <itemref idref="page3" />
                    <itemref idref="page4" />
                    <itemref idref="page5" />
                </spine>
            </package>
        `);
        zip.file('OPS/page1.xhtml', xhtml(`<p>CHAPTER I ARRIVAL THE first body begins here. ${repeatedWords('first', 100)}</p>`));
        zip.file('OPS/page2.xhtml', xhtml(`<p>${repeatedWords('first', 100)}</p>`));
        zip.file('OPS/page3.xhtml', xhtml(`<p>CHAPTER II DISCOVERY THE second body begins here. ${repeatedWords('second', 100)}</p>`));
        zip.file('OPS/page4.xhtml', xhtml(`<p>${repeatedWords('second', 100)}</p>`));
        zip.file('OPS/page5.xhtml', xhtml(`<p>CHAPTER III RETURN THE third body begins here. ${repeatedWords('third', 100)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
            'Chapter I: Arrival',
            'Chapter II: Discovery',
            'Chapter III: Return',
        ]);
        expect(plan.chapters.map((chapter) => chapter.slices.map((slice) => slice.path))).toEqual([
            ['OPS/page1.xhtml', 'OPS/page2.xhtml'],
            ['OPS/page3.xhtml', 'OPS/page4.xhtml'],
            ['OPS/page5.xhtml'],
        ]);
        expect(plan.chapters.every((chapter) => chapter.source === 'heading')).toBe(true);
        expect(plan.chapters.every((chapter) => chapter.boundaryEvidence?.includes('scan-heading'))).toBe(true);
        expect(plan.structureMode).toBe('authored');
    });

    it('keeps an isolated paragraph heading in generated fallback mode', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Ambiguous Paragraph Heading</dc:title></metadata>
                <manifest>
                    <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml" />
                    <item id="page2" href="page2.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="page1" />
                    <itemref idref="page2" />
                </spine>
            </package>
        `);
        zip.file('OPS/page1.xhtml', xhtml('<p>CHAPTER I ARRIVAL The text continues without a peer heading.</p>'));
        zip.file('OPS/page2.xhtml', xhtml(`<p>${repeatedWords('continued', 100)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.structureMode).toBe('generated');
        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Section 1']);
        expect(plan.chapters.every((chapter) => chapter.boundaryEvidence?.includes('source-spine'))).toBe(true);
    });

    it('retains material before recovered headings without calling it authored structure', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Recovered Opening</dc:title></metadata>
                <manifest>
                    <item id="opening" href="opening.xhtml" media-type="application/xhtml+xml" />
                    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml" />
                    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="opening" />
                    <itemref idref="chapter1" />
                    <itemref idref="chapter2" />
                </spine>
            </package>
        `);
        zip.file('OPS/opening.xhtml', xhtml(`<h1>Prologue</h1><p>${repeatedWords('preface', 100)}</p>`));
        zip.file('OPS/chapter1.xhtml', xhtml(`<h1>Chapter I</h1><p>${repeatedWords('first', 100)}</p>`));
        zip.file('OPS/chapter2.xhtml', xhtml(`<h1>Chapter II</h1><p>${repeatedWords('second', 100)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Prologue', 'Chapter I', 'Chapter II']);
        expect(plan.chapters.map((chapter) => chapter.source)).toEqual(['spine', 'heading', 'heading']);
    });

    it('uses a generated section for repeated document pagination labels', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata><dc:title>Unstructured Book</dc:title></metadata>
                <manifest>
                    <item id="page1" href="page1.xhtml" media-type="application/xhtml+xml" />
                    <item id="page2" href="page2.xhtml" media-type="application/xhtml+xml" />
                    <item id="page3" href="page3.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="page1" />
                    <itemref idref="page2" />
                    <itemref idref="page3" />
                </spine>
            </package>
        `);
        zip.file('OPS/page1.xhtml', xhtml(`<p>${repeatedWords('first', 100)}</p>`));
        zip.file('OPS/page2.xhtml', xhtml(`<p>${repeatedWords('second', 100)}</p>`));
        zip.file('OPS/page3.xhtml', xhtml(`<p>${repeatedWords('third', 100)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['Section 1']);
        expect(plan.chapters[0].source).toBe('merged');
        expect(plan.structureMode).toBe('generated');
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

    it('preserves image-only spine sections so the reader can cue nearby illustrations', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', containerXml('OPS/content.opf'));
        zip.file('OPS/content.opf', `
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                <metadata>
                    <dc:title>Illustrated Book</dc:title>
                    <dc:creator>Tester</dc:creator>
                </metadata>
                <manifest>
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                    <item id="plate" href="plate.xhtml" media-type="application/xhtml+xml" />
                    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="chap1" />
                    <itemref idref="plate" />
                    <itemref idref="chap2" />
                </spine>
            </package>
        `);
        zip.file('OPS/chap1.xhtml', xhtml(`<h1>Chapter 1</h1><p>${repeatedWords('opening', 120)}</p>`));
        zip.file('OPS/plate.xhtml', xhtml('<h1>Plate 1</h1><img src="plate.jpg" alt="Plate 1" />'));
        zip.file('OPS/chap2.xhtml', xhtml(`<h1>Chapter 2</h1><p>${repeatedWords('closing', 120)}</p>`));

        const plan = await buildEpubStructurePlan(zip);

        expect(plan.chapters.some((chapter) => chapter.title === 'Plate 1')).toBe(true);
    });
});

describe('normalizeReadingSections', () => {
    const pageUnits = (count: number, wordsPerPage = 400): PlannedChapter[] => Array.from({ length: count }, (_, index) => ({
        title: `Page ${index + 1}`,
        slices: [{ path: `OPS/page_${index + 1}.xhtml` }],
        estimatedWords: wordsPerPage,
        source: 'spine',
    }));

    it('groups page-like source units into stable sections without changing order or totals', () => {
        const structure = normalizeReadingSections(pageUnits(150));

        expect(structure.mode).toBe('generated');
        expect(structure.sections).toHaveLength(19);
        expect(structure.sections.map((section) => section.title)).toEqual(
            Array.from({ length: 19 }, (_, index) => `Section ${index + 1}`),
        );
        expect(structure.sections.reduce((total, section) => total + section.estimatedWords, 0)).toBe(60_000);
        expect(structure.sections.flatMap((section) => section.slices.map((slice) => slice.path))).toEqual(
            pageUnits(150).map((unit) => unit.slices[0].path),
        );
        expect(structure.sections.every((section) => section.estimatedWords <= 5_000)).toBe(true);
    });

    it('rebalances a short final page bucket when the hard maximum allows it', () => {
        const structure = normalizeReadingSections(pageUnits(20));
        const lastSection = structure.sections.at(-1);

        expect(lastSection?.reason).toBe('short-section-merge');
        expect(lastSection?.estimatedWords).toBe(4_800);
        expect(lastSection?.slices).toHaveLength(12);
        expect(lastSection?.estimatedWords).toBeLessThanOrEqual(5_000);
    });

    it('does not cross authored boundaries while grouping adjacent generic units', () => {
        const structure = normalizeReadingSections([
            {
                title: 'Chapter One',
                slices: [{ path: 'OPS/chapter-one.xhtml' }],
                estimatedWords: 1_500,
                source: 'toc',
            },
            ...pageUnits(4, 500),
            {
                title: 'Chapter Two',
                slices: [{ path: 'OPS/chapter-two.xhtml' }],
                estimatedWords: 1_500,
                source: 'toc',
            },
        ]);

        expect(structure.mode).toBe('hybrid');
        expect(structure.sections.map((section) => section.title)).toEqual([
            'Chapter One',
            'Section 1',
            'Chapter Two',
        ]);
        expect(structure.sections[1].slices).toHaveLength(4);
        expect(structure.sections[0].boundaryEvidence).toEqual(['publisher-toc']);
        expect(structure.sections[2].boundaryEvidence).toEqual(['publisher-toc']);
    });

    it('splits oversized authored groups at source-slice boundaries', () => {
        const structure = normalizeReadingSections([{
            title: 'A Very Long Chapter',
            slices: Array.from({ length: 5 }, (_, index) => ({ path: `OPS/part-${index + 1}.xhtml` })),
            sliceEstimatedWords: [3_000, 3_000, 3_000, 3_000, 3_000],
            estimatedWords: 15_000,
            source: 'toc',
        }]);

        expect(structure.mode).toBe('hybrid');
        expect(structure.sections.map((section) => section.title)).toEqual([
            'A Very Long Chapter - Part 1',
            'A Very Long Chapter - Part 2',
            'A Very Long Chapter - Part 3',
            'A Very Long Chapter - Part 4',
            'A Very Long Chapter - Part 5',
        ]);
        expect(structure.sections.every((section) => section.authoredGroupTitle === 'A Very Long Chapter')).toBe(true);
        expect(structure.sections.every((section) => section.reason === 'long-section-split')).toBe(true);
        expect(structure.sections.reduce((total, section) => total + section.estimatedWords, 0)).toBe(15_000);
        expect(structure.sections.flatMap((section) => section.slices.map((slice) => slice.path))).toEqual([
            'OPS/part-1.xhtml',
            'OPS/part-2.xhtml',
            'OPS/part-3.xhtml',
            'OPS/part-4.xhtml',
            'OPS/part-5.xhtml',
        ]);
    });
});
