import { describe, it, expect } from 'vitest';
import {
    cleanText,
    classifyChapter,
    removePageNumbersFromHtml,
    removeGutenbergBoilerplateFromHtml,
    _testExports,
} from './cleaning';

const { GUTENBERG_PATTERNS, isGutenbergLicenseChapter, detectTableOfContents } = _testExports;

describe('cleanText', () => {
    describe('license removal', () => {
        it('should remove Project Gutenberg start marker and content before it', () => {
            const text = `
The Project Gutenberg EBook of Alice's Adventures in Wonderland
Title: Alice's Adventures in Wonderland
Author: Lewis Carroll
Release Date: June 25, 2008

*** START OF THE PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES IN WONDERLAND ***

CHAPTER I. Down the Rabbit-Hole

Alice was beginning to get very tired of sitting by her sister on the bank.
            `;
            const result = cleanText(text);
            expect(result.cleanedText).not.toContain('*** START OF THE PROJECT GUTENBERG');
            expect(result.cleanedText).not.toContain('Title: Alice');
            expect(result.cleanedText).toContain('Alice was beginning');
        });

        it('should remove Project Gutenberg end marker and content after it', () => {
            const text = `
The End of the story.

*** END OF THE PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES IN WONDERLAND ***

Updated editions will replace the previous one—the old editions will
be renamed.

THE FULL PROJECT GUTENBERG LICENSE
PLEASE READ THIS BEFORE YOU DISTRIBUTE
            `;
            const result = cleanText(text);
            expect(result.cleanedText).not.toContain('*** END OF THE PROJECT GUTENBERG');
            expect(result.cleanedText).not.toContain('Updated editions');
            expect(result.cleanedText).not.toContain('FULL PROJECT GUTENBERG LICENSE');
            expect(result.cleanedText).toContain('The End of the story');
        });

        it('should handle modern Gutenberg format with "THE" instead of "THIS"', () => {
            const text = `
Title: The Yellow Wallpaper
*** START OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***
It was very seldom that ordinary people secure ancestral halls.
*** END OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***
License text here.
            `;
            const result = cleanText(text);
            expect(result.cleanedText).toContain('It was very seldom');
            expect(result.cleanedText).not.toContain('START OF THE PROJECT');
            expect(result.cleanedText).not.toContain('END OF THE PROJECT');
            expect(result.cleanedText).not.toContain('License text');
        });

        it('should remove Standard Ebooks boilerplate', () => {
            const text = `
This is a publication of Standard Ebooks.
The Standard Ebooks project is a volunteer effort.

Chapter 1

It was the best of times.
            `;
            const result = cleanText(text);
            expect(result.cleanedText).not.toContain('Standard Ebooks');
            expect(result.cleanedText).toContain('It was the best of times');
        });

        it('should remove transcriber notes', () => {
            const text = `
Transcriber's Note: Some minor corrections have been made.

Chapter 1

The story begins here.
            `;
            const result = cleanText(text);
            expect(result.cleanedText).not.toContain("Transcriber's Note");
            expect(result.cleanedText).toContain('The story begins here');
        });

        it('should report detected license in metadata', () => {
            const text = `
*** START OF THE PROJECT GUTENBERG EBOOK TEST ***
Chapter 1
            `;
            const result = cleanText(text);
            expect(result.metadata.detectedLicense).toBe('Project Gutenberg');
        });
    });

    describe('page number removal', () => {
        it('should remove standalone page numbers', () => {
            const text = `
Chapter 1

42

The story continues here.

43

More content follows.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.cleanedText).not.toMatch(/^\s*42\s*$/m);
            expect(result.cleanedText).not.toMatch(/^\s*43\s*$/m);
            expect(result.cleanedText).toContain('Chapter 1');
            expect(result.cleanedText).toContain('The story continues');
        });

        it('should remove bracketed page numbers', () => {
            const text = `
[42]
The story continues here.
[43]
More content follows.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.cleanedText).not.toContain('[42]');
            expect(result.cleanedText).not.toContain('[43]');
        });

        it('should remove "Page X" format', () => {
            const text = `
Page 42
The story continues here.
Page: 43
More content follows.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.cleanedText).not.toContain('Page 42');
            expect(result.cleanedText).not.toContain('Page: 43');
        });

        it('should remove dash-wrapped page numbers', () => {
            const text = `
Some text here.
— 42 —
More content follows.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.cleanedText).not.toContain('— 42 —');
        });

        it('should report page numbers removed count', () => {
            const text = `
42
43
44
Content here.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.metadata.pageNumbersRemoved).toBeGreaterThan(0);
        });

        it('should not remove numbers that are part of content', () => {
            const text = `
There were 42 people at the party.
The year was 1984.
            `;
            const result = cleanText(text, { removePageNumbers: true });
            expect(result.cleanedText).toContain('42 people');
            expect(result.cleanedText).toContain('1984');
        });
    });

    describe('whitespace normalization', () => {
        it('should collapse multiple newlines', () => {
            const text = `
Chapter 1



The story begins here.




More content.
            `;
            const result = cleanText(text, { normalizeWhitespace: true });
            expect(result.cleanedText).not.toMatch(/\n{3,}/);
        });

        it('should collapse multiple spaces', () => {
            const text = `The    story    begins    here.`;
            const result = cleanText(text, { normalizeWhitespace: true });
            expect(result.cleanedText).toBe('The story begins here.');
        });

        it('should trim lines', () => {
            const text = `   Leading spaces   \n   More spaces   `;
            const result = cleanText(text, { normalizeWhitespace: true });
            expect(result.cleanedText).toBe('Leading spaces\nMore spaces');
        });
    });
});

describe('classifyChapter', () => {
    describe('content chapters', () => {
        it('should classify regular content as content type', () => {
            const content = `
Chapter 1

Alice was beginning to get very tired of sitting by her sister on the bank,
and of having nothing to do. Once or twice she had peeped into the book her
sister was reading, but it had no pictures or conversations in it.
            `;
            const result = classifyChapter(content, undefined, 'Chapter 1', 2);
            expect(result.type).toBe('content');
            expect(result.shouldIncludeInReading).toBe(true);
        });
    });

    describe('license chapters', () => {
        it('should classify Gutenberg license chapter correctly', () => {
            const content = `
*** END OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***

Updated editions will replace the previous one.

THE FULL PROJECT GUTENBERG LICENSE

PLEASE READ THIS BEFORE YOU DISTRIBUTE OR USE THIS WORK

To protect the Project Gutenberg mission of promoting the free
distribution of electronic works, by using or distributing this work
you agree to comply with all the terms of the Full Project Gutenberg License.

Section 1. General Terms of Use

Project Gutenberg Literary Archive Foundation
            `;
            const result = classifyChapter(content);
            expect(result.type).toBe('license');
            expect(result.shouldIncludeInReading).toBe(false);
            expect(result.licenseInfo?.publisher).toBe('Project Gutenberg');
        });

        it('should classify Standard Ebooks colophon as license', () => {
            const content = `
This is a publication of Standard Ebooks.
The Standard Ebooks project is a volunteer effort.
This ebook was produced for Standard Ebooks by a producer.
            `;
            const result = classifyChapter(content);
            expect(result.type).toBe('license');
            expect(result.shouldIncludeInReading).toBe(false);
        });

        it('should detect license based on keyword density', () => {
            const content = `
Project Gutenberg trademark license agreement.
Copyright and trademark information.
Royalty payments and redistribution rules.
Electronic work distribution at www.gutenberg.org.
            `;
            const result = classifyChapter(content);
            expect(result.type).toBe('license');
        });
    });

    describe('cover chapters', () => {
        it('should classify short first chapter as cover', () => {
            const content = `Cover Image`;
            const result = classifyChapter(content, undefined, 'Cover', 0);
            expect(result.type).toBe('cover');
            expect(result.shouldIncludeInReading).toBe(false);
        });
    });

    describe('table of contents', () => {
        it('should classify TOC by title and entries', () => {
            const content = `
Contents

Chapter 1 ........................... 1
Chapter 2 ........................... 15
Chapter 3 ........................... 28
Chapter 4 ........................... 42
Chapter 5 ........................... 55
            `;
            const result = classifyChapter(content, undefined, 'Table of Contents');
            expect(result.type).toBe('toc');
            expect(result.shouldIncludeInReading).toBe(false);
        });

        it('should classify chapter list as TOC', () => {
            const content = `
Table of Contents

Part I
Chapter 1. The Beginning
Chapter 2. The Middle
Chapter 3. The End

Part II
Chapter 4. The Continuation
Chapter 5. The Finale
            `;
            const result = classifyChapter(content);
            expect(result.type).toBe('toc');
        });
    });

    describe('frontmatter', () => {
        it('should classify dedication as frontmatter', () => {
            const content = `
To my beloved wife.
            `;
            const result = classifyChapter(content, undefined, 'Dedication', 1);
            expect(result.type).toBe('frontmatter');
            expect(result.shouldIncludeInReading).toBe(true); // Frontmatter is readable
        });

        it('should classify preface as frontmatter', () => {
            const content = `
This book was written during a tumultuous period.
            `;
            const result = classifyChapter(content, undefined, 'Preface', 1);
            expect(result.type).toBe('frontmatter');
        });
    });

    describe('backmatter', () => {
        it('should classify appendix as backmatter', () => {
            const content = `
Additional notes and references.
            `;
            const result = classifyChapter(content, undefined, 'Appendix A', 50);
            expect(result.type).toBe('backmatter');
            expect(result.shouldIncludeInReading).toBe(true); // Backmatter may be readable
        });

        it('should classify glossary as backmatter', () => {
            const content = `
Term definitions.
            `;
            const result = classifyChapter(content, undefined, 'Glossary', 50);
            expect(result.type).toBe('backmatter');
        });
    });
});

describe('removePageNumbersFromHtml', () => {
    it('should remove pagenum class elements', () => {
        const html = `<div class="pagenum">42</div><p>Content here.</p>`;
        const result = removePageNumbersFromHtml(html);
        expect(result).not.toContain('pagenum');
        expect(result).toContain('Content here');
    });

    it('should remove page-number class elements', () => {
        const html = `<span class="page-number">42</span><p>Content here.</p>`;
        const result = removePageNumbersFromHtml(html);
        expect(result).not.toContain('42');
    });

    it('should remove [Page X] markers', () => {
        const html = `<p>Some text. [Page 42] More text.</p>`;
        const result = removePageNumbersFromHtml(html);
        expect(result).not.toContain('[Page 42]');
        expect(result).toContain('Some text');
    });

    it('should remove page anchor elements', () => {
        const html = `<a id="page_42"></a><p>Content here.</p>`;
        const result = removePageNumbersFromHtml(html);
        expect(result).not.toContain('page_42');
    });
});

describe('removeGutenbergBoilerplateFromHtml', () => {
    it('should remove pg-boilerplate class elements', () => {
        const html = `<div class="pg-boilerplate">License info</div><p>Content here.</p>`;
        const result = removeGutenbergBoilerplateFromHtml(html);
        expect(result).not.toContain('License info');
        expect(result).toContain('Content here');
    });

    it('should remove pg-header class elements', () => {
        const html = `<div class="pg-header section">Header content</div><p>Story content.</p>`;
        const result = removeGutenbergBoilerplateFromHtml(html);
        expect(result).not.toContain('Header content');
        expect(result).toContain('Story content');
    });

    it('should remove start/end separator spans', () => {
        const html = `<span>*** START OF THE PROJECT GUTENBERG EBOOK TEST ***</span><p>Content.</p>`;
        const result = removeGutenbergBoilerplateFromHtml(html);
        expect(result).not.toContain('START OF THE PROJECT');
        expect(result).toContain('Content');
    });
});

describe('Gutenberg pattern matching', () => {
    it('should match various START marker formats', () => {
        const markers = [
            "*** START OF THIS PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES ***",
            "*** START OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***",
            "***START OF THIS PROJECT GUTENBERG EBOOK TEST***",
        ];
        
        for (const marker of markers) {
            const matched = GUTENBERG_PATTERNS.startMarkers.some(p => p.test(marker));
            expect(matched, `Should match: ${marker}`).toBe(true);
        }
    });

    it('should match various END marker formats', () => {
        const markers = [
            "*** END OF THIS PROJECT GUTENBERG EBOOK ALICE'S ADVENTURES ***",
            "*** END OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***",
            "***END OF THIS PROJECT GUTENBERG EBOOK TEST***",
        ];
        
        for (const marker of markers) {
            const matched = GUTENBERG_PATTERNS.endMarkers.some(p => p.test(marker));
            expect(matched, `Should match: ${marker}`).toBe(true);
        }
    });
});

describe('isGutenbergLicenseChapter', () => {
    it('should detect chapter with boilerplate classes in HTML', () => {
        const content = `
*** END OF THE PROJECT GUTENBERG EBOOK TEST ***
Updated editions will replace the previous one.
        `;
        const html = `<div class="pg-boilerplate pg-footer">*** END OF THE PROJECT GUTENBERG EBOOK TEST ***</div>`;
        
        const result = isGutenbergLicenseChapter(content, html);
        expect(result).toBe(true);
    });

    it('should detect license chapter by keyword density', () => {
        const content = `
Project Gutenberg trademark license.
Copyright and redistribute electronic work.
Royalty payments to gutenberg.org.
        `;
        
        const result = isGutenbergLicenseChapter(content);
        expect(result).toBe(true);
    });

    it('should not flag normal content as license', () => {
        const content = `
Chapter 1

It was a bright cold day in April, and the clocks were striking thirteen.
Winston Smith, his chin nuzzled into his breast in an effort to escape
the vile wind, slipped quickly through the glass doors of Victory Mansions.
        `;
        
        const result = isGutenbergLicenseChapter(content);
        expect(result).toBe(false);
    });
});

describe('detectTableOfContents', () => {
    it('should detect TOC with title and dotted entries', () => {
        const content = `
Contents

Chapter 1 ........................... 1
Chapter 2 ........................... 15
Chapter 3 ........................... 28
Chapter 4 ........................... 42
        `;
        
        const result = detectTableOfContents(content);
        expect(result.isToc).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect TOC with Part/Chapter entries', () => {
        const content = `
Table of Contents

Part I: The Beginning
    Chapter 1: First Steps
    Chapter 2: Moving Forward
Part II: The Journey
    Chapter 3: Obstacles
    Chapter 4: Resolution
        `;
        
        const result = detectTableOfContents(content);
        expect(result.isToc).toBe(true);
    });

    it('should detect TOC by high link density in HTML', () => {
        const content = `Chapter 1 Chapter 2 Chapter 3`;
        const html = `
<div>
    <a href="#ch1">Chapter 1</a>
    <a href="#ch2">Chapter 2</a>
    <a href="#ch3">Chapter 3</a>
</div>
        `;
        
        const result = detectTableOfContents(content, html);
        expect(result.isToc).toBe(true);
    });

    it('should not flag normal content as TOC', () => {
        const content = `
Chapter 1

It was the best of times, it was the worst of times. The story begins
with a description of the era in which it takes place.
        `;
        
        const result = detectTableOfContents(content);
        expect(result.isToc).toBe(false);
    });
});
