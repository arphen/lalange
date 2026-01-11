/**
 * Content Cleaning Module
 * 
 * Provides comprehensive text cleaning for EPUB content, including:
 * - License/boilerplate detection and removal
 * - Page number detection and removal
 * - Chapter classification (content vs. non-content)
 * - Table of contents detection
 */

// ============================================================================
// Types
// ============================================================================

export interface CleaningResult {
    cleanedText: string;
    removedContent: {
        type: 'license' | 'toc' | 'page-numbers' | 'boilerplate';
        content: string;
    }[];
    metadata: {
        detectedLicense?: string;
        pageNumbersRemoved: number;
    };
}

export interface ChapterClassification {
    type: 'content' | 'license' | 'toc' | 'cover' | 'frontmatter' | 'backmatter' | 'image';
    confidence: number;
    reason: string;
    shouldIncludeInReading: boolean;
    /** If the chapter is a license, this contains the license info */
    licenseInfo?: {
        publisher: string;
        text: string;
    };
    /** If the chapter is a TOC, this contains extracted links */
    tocEntries?: { title: string; href?: string }[];
}

// ============================================================================
// License Detection Patterns
// ============================================================================

/**
 * Patterns for detecting Project Gutenberg content
 */
const GUTENBERG_PATTERNS = {
    // Start markers
    startMarkers: [
        /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^*]*\*{3}/i,
        /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}/i,
        /<span[^>]*>\s*\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG/i,
        // Concatenated versions (no spaces)
        /\*{3}STARTOF(?:THE)?PROJECTGUTENBERGE?BOOK[^*]*\*{3}/i,
        /STARTOF(?:THE)?PROJECTGUTENBERGE?BOOK/i,
    ],
    // End markers
    endMarkers: [
        /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^*]*\*{3}/i,
        /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}/i,
        /<span[^>]*>\s*\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG/i,
        // Concatenated versions (no spaces)
        /\*{3}ENDOF(?:THE)?PROJECTGUTENBERGE?BOOK[^*]*\*{3}/i,
        /ENDOF(?:THE)?PROJECTGUTENBERGE?BOOK/i,
    ],
    // Header elements
    headerPatterns: [
        /The Project Gutenberg (?:eBook|EBook) of/i,
        /This (?:eBook|ebook) is for the use of anyone anywhere/i,
        /Project Gutenberg License/i,
        /www\.gutenberg\.org/i,
        /gutenberg\.org\/license/i,
    ],
    // License section markers
    licenseMarkers: [
        /START:\s*FULL LICENSE/i,
        /THE FULL PROJECT GUTENBERG LICENSE/i,
        /Section 1\.\s*General Terms of Use/i,
        /Project Gutenberg Literary Archive Foundation/i,
        /PGLAF/i,
    ],
    // Footer patterns
    footerPatterns: [
        /End of the Project Gutenberg/i,
        /End of Project Gutenberg/i,
        /Updated editions will replace the previous one/i,
        /Creating the works from print editions/i,
    ],
    // Metadata patterns (at start of chapters)
    metadataPatterns: [
        /^\s*Title:\s*.+$/gim,
        /^\s*Author:\s*.+$/gim,
        /^\s*Release [Dd]ate:\s*.+$/gim,
        /^\s*Language:\s*.+$/gim,
        /^\s*Credits:\s*.+$/gim,
        /^\s*Produced by\s*.+$/gim,
        /^\s*Transcriber['']?s?\s*[Nn]ote/gim,
        /^\s*Most recently updated:\s*.+$/gim,
        /^.*\[eBook #\d+\].*$/gim,
    ],
    // Boilerplate divs (HTML class-based detection)
    boilerplateClasses: [
        'pg-boilerplate',
        'pg-header',
        'pg-footer',
        'pg-machine-header',
        'pg-end-separator',
        'pg-start-separator',
    ],
};

/**
 * Patterns for detecting Standard Ebooks content
 */
const STANDARD_EBOOKS_PATTERNS = {
    headerPatterns: [
        /This is a publication of Standard Ebooks/i,
        /standardebooks\.org/i,
        /The Standard Ebooks project/i,
    ],
    colophonPatterns: [
        /colophon/i,
        /This ebook was produced for Standard Ebooks/i,
    ],
};

// ============================================================================
// Page Number Detection
// ============================================================================

/**
 * Patterns for detecting page numbers in text
 */
const PAGE_NUMBER_PATTERNS = [
    // Standalone numbers that look like page numbers
    // Must be careful not to remove content numbers
    /^[[({]?\s*\d{1,4}\s*[\])}]?\s*$/gm,
    // "Page X" or "Page: X"
    /\bpage\s*:?\s*\d{1,4}\b/gi,
    // "- X -" or "— X —" style
    /[-—]\s*\d{1,4}\s*[-—]/g,
    // "[X]" at start of line (common in OCR books)
    /^\s*\[\d{1,4}\]\s*$/gm,
    // Roman numerals as page numbers (typically front matter)
    /^\s*[ivxlcdm]+\s*$/gim,
];

/**
 * Heuristic patterns for detecting page number artifacts
 * These check for patterns that strongly suggest page numbering
 */
const PAGE_NUMBER_HEURISTICS = {
    // Sequential number patterns (e.g., finding "42" then "43" within reasonable distance)
    sequentialThreshold: 5, // If we find N sequential numbers, it's likely page numbers
    
    // Numbers at consistent positions (start/end of blocks)
    positionPatterns: [
        /^\s*\d{1,4}\s*\n/gm,  // Number at start of line followed by newline
        /\n\s*\d{1,4}\s*$/gm,  // Number at end preceded by newline
    ],
    
    // Numbers that appear with consistent formatting
    formattedPatterns: [
        /\[\s*\d+\s*\]/g,       // [42]
        /\(\s*\d+\s*\)/g,       // (42)
        /\{\s*\d+\s*\}/g,       // {42}
        /«\s*\d+\s*»/g,         // «42»
    ],
};

// ============================================================================
// Table of Contents Detection
// ============================================================================

const TOC_PATTERNS = {
    // Title patterns
    titlePatterns: [
        /^(?:Table of )?Contents?$/im,
        /^Index$/im,
        /^Inhalt$/im,  // German
        /^Índice$/im,  // Spanish
        /^Sommaire$/im, // French
    ],
    // Content patterns (chapters with page numbers or links)
    entryPatterns: [
        /^(?:Chapter|Part|Section|Book|Volume)\s+[\dIVXLCDMivxlcdm]+/gim,
        /^\s*(?:\d+|[ivxlcdm]+)\.\s*.+\s*(?:\d+|[ivxlcdm]+)?\s*$/gim,
        /^.+\.{3,}\s*\d+\s*$/gm,  // "Chapter Title ... 42"
        /^(?:Part|Chapter)\s+[IVXLCDM]+:/gim, // "Part I:" format
    ],
    // High ratio of links suggests TOC
    linkDensityThreshold: 0.5, // If >50% of text is links, likely TOC
};

// ============================================================================
// Chapter Classification
// ============================================================================

/**
 * Classifies a chapter based on its content
 */
export function classifyChapter(
    content: string,
    htmlContent?: string,
    title?: string,
    chapterIndex?: number
): ChapterClassification {
    const normalizedTitle = (title || '').toLowerCase();
    const wordCount = content.trim().split(/\s+/).filter(w => w.length > 0).length;

    // Check for image-only chapters (very little text, probably just image placeholders)
    if (wordCount < 10) {
        // Check if the HTML is mostly images
        const imageTagCount = (htmlContent || '').match(/<img[^>]*>/gi)?.length || 0;
        const textRatio = wordCount / Math.max(1, (htmlContent || '').length / 100);
        
        if (imageTagCount > 0 && textRatio < 0.5) {
            return {
                type: 'image',
                confidence: 0.9,
                reason: 'Chapter contains primarily images with minimal text',
                shouldIncludeInReading: false,
            };
        }
    }

    // Check for cover pages (usually first, short, image-heavy)
    if (chapterIndex === 0 || normalizedTitle.includes('cover')) {
        if (wordCount < 20) {
            return {
                type: 'cover',
                confidence: 0.9,
                reason: 'Short content at beginning, likely cover page',
                shouldIncludeInReading: false,
            };
        }
    }

    // Check for Gutenberg license chapter
    if (isGutenbergLicenseChapter(content, htmlContent)) {
        return {
            type: 'license',
            confidence: 0.95,
            reason: 'Contains Project Gutenberg license markers',
            shouldIncludeInReading: false,
            licenseInfo: {
                publisher: 'Project Gutenberg',
                text: extractLicenseText(content),
            },
        };
    }

    // Check for Standard Ebooks license/colophon
    if (isStandardEbooksBoilerplate(content)) {
        return {
            type: 'license',
            confidence: 0.9,
            reason: 'Contains Standard Ebooks boilerplate',
            shouldIncludeInReading: false,
            licenseInfo: {
                publisher: 'Standard Ebooks',
                text: content,
            },
        };
    }

    // Check for Table of Contents
    const tocResult = detectTableOfContents(content, htmlContent);
    if (tocResult.isToc) {
        return {
            type: 'toc',
            confidence: tocResult.confidence,
            reason: tocResult.reason,
            shouldIncludeInReading: false,
            tocEntries: tocResult.entries,
        };
    }

    // Check for front matter (dedications, epigraphs, etc.)
    if (chapterIndex !== undefined && chapterIndex < 3) {
        if (isFrontMatter(content, normalizedTitle)) {
            return {
                type: 'frontmatter',
                confidence: 0.7,
                reason: 'Appears to be front matter (dedication, epigraph, etc.)',
                shouldIncludeInReading: true, // Front matter is usually readable
            };
        }
    }

    // Check for back matter (appendices, notes, etc.)
    if (isBackMatter(content, normalizedTitle)) {
        return {
            type: 'backmatter',
            confidence: 0.7,
            reason: 'Appears to be back matter (appendix, notes, etc.)',
            shouldIncludeInReading: true, // Back matter might be readable
        };
    }

    // Default: Regular content chapter
    return {
        type: 'content',
        confidence: 0.8,
        reason: 'Standard content chapter',
        shouldIncludeInReading: true,
    };
}

/**
 * Checks if a chapter is a Gutenberg license chapter
 */
function isGutenbergLicenseChapter(content: string, htmlContent?: string): boolean {
    // Check for boilerplate classes in HTML
    if (htmlContent) {
        for (const className of GUTENBERG_PATTERNS.boilerplateClasses) {
            if (htmlContent.includes(className)) {
                // Also check if this is primarily license content
                const hasEndMarker = GUTENBERG_PATTERNS.endMarkers.some(p => p.test(content));
                const hasLicenseMarker = GUTENBERG_PATTERNS.licenseMarkers.some(p => p.test(content));
                if (hasEndMarker || hasLicenseMarker) {
                    return true;
                }
            }
        }
    }

    // Check for license markers in content
    const hasLicenseMarker = GUTENBERG_PATTERNS.licenseMarkers.some(p => p.test(content));
    const hasEndMarker = GUTENBERG_PATTERNS.endMarkers.some(p => p.test(content));
    const hasFooterPattern = GUTENBERG_PATTERNS.footerPatterns.some(p => p.test(content));

    // If it has end marker + license content, it's a license chapter
    if (hasEndMarker && (hasLicenseMarker || hasFooterPattern)) {
        return true;
    }

    // Check for high density of license-related text
    const licenseKeywords = [
        'project gutenberg',
        'trademark',
        'license',
        'copyright',
        'royalty',
        'redistribute',
        'electronic work',
        'gutenberg.org',
    ];
    const lowerContent = content.toLowerCase();
    const keywordHits = licenseKeywords.filter(kw => lowerContent.includes(kw)).length;
    
    // If more than half of the keywords appear, likely a license
    if (keywordHits >= licenseKeywords.length / 2) {
        return true;
    }

    return false;
}

/**
 * Checks if content is Standard Ebooks boilerplate
 */
function isStandardEbooksBoilerplate(content: string): boolean {
    return STANDARD_EBOOKS_PATTERNS.headerPatterns.some(p => p.test(content)) ||
           STANDARD_EBOOKS_PATTERNS.colophonPatterns.some(p => p.test(content));
}

/**
 * Extracts license text for storage/display
 */
function extractLicenseText(content: string): string {
    // Try to find the license section
    const licenseStart = content.match(/START:\s*FULL LICENSE/i);
    if (licenseStart && licenseStart.index !== undefined) {
        return content.substring(licenseStart.index).slice(0, 5000); // Cap at 5000 chars
    }
    return content.slice(0, 2000);
}

/**
 * Detects if content is a Table of Contents
 */
function detectTableOfContents(
    content: string,
    htmlContent?: string
): { isToc: boolean; confidence: number; reason: string; entries?: { title: string; href?: string }[] } {

    // Check title patterns
    const hasTocTitle = TOC_PATTERNS.titlePatterns.some(p => p.test(content));
    
    // Check for high link density in HTML
    if (htmlContent) {
        const linkMatches = htmlContent.match(/<a[^>]*href/gi);
        const textLength = content.replace(/\s/g, '').length;
        if (linkMatches && textLength > 0) {
            const linkDensity = linkMatches.length / (textLength / 50); // Rough estimate
            if (linkDensity > TOC_PATTERNS.linkDensityThreshold) {
                return {
                    isToc: true,
                    confidence: 0.85,
                    reason: 'High link density suggests table of contents',
                };
            }
        }
    }

    // Check for chapter entry patterns - count all matches across all patterns
    let entryMatches = 0;
    for (const pattern of TOC_PATTERNS.entryPatterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        const matches = content.match(pattern);
        if (matches) {
            entryMatches += matches.length;
        }
    }

    // Check for dotted lines (common TOC pattern)
    const dottedLineMatches = content.match(/\.{3,}/g);
    const hasManyDottedLines = dottedLineMatches && dottedLineMatches.length > 3;

    if (hasTocTitle && (entryMatches > 3 || hasManyDottedLines)) {
        return {
            isToc: true,
            confidence: 0.9,
            reason: 'Contains TOC title and chapter entries',
        };
    }

    if (hasManyDottedLines && entryMatches > 5) {
        return {
            isToc: true,
            confidence: 0.75,
            reason: 'Contains many dotted lines with entries',
        };
    }

    // Additional heuristic: if many Chapter/Part entries found, likely a TOC
    if (entryMatches >= 5 && hasTocTitle) {
        return {
            isToc: true,
            confidence: 0.8,
            reason: 'Contains TOC title with multiple chapter/part entries',
        };
    }

    // More lenient: if has TOC title and some structure
    if (hasTocTitle && entryMatches >= 3) {
        return {
            isToc: true,
            confidence: 0.7,
            reason: 'Contains TOC title with structured entries',
        };
    }

    return { isToc: false, confidence: 0, reason: '' };
}

/**
 * Checks if content is front matter
 */
function isFrontMatter(content: string, title: string): boolean {
    const frontMatterPatterns = [
        /dedication/i,
        /epigraph/i,
        /preface/i,
        /foreword/i,
        /acknowledgment/i,
        /introduction/i,
        /prologue/i,
    ];

    return frontMatterPatterns.some(p => 
        p.test(title) || (content.length < 1000 && p.test(content))
    );
}

/**
 * Checks if content is back matter
 */
function isBackMatter(_content: string, title: string): boolean {
    const backMatterPatterns = [
        /appendix/i,
        /notes?$/i,
        /glossary/i,
        /bibliography/i,
        /index$/i,
        /afterword/i,
        /epilogue/i,
        /about the author/i,
    ];

    return backMatterPatterns.some(p => p.test(title));
}

// ============================================================================
// Text Cleaning Functions
// ============================================================================

/**
 * Main cleaning function - cleans text content
 */
export function cleanText(text: string, options: {
    removeLicense?: boolean;
    removePageNumbers?: boolean;
    normalizeWhitespace?: boolean;
} = {}): CleaningResult {
    const {
        removeLicense = true,
        removePageNumbers = true,
        normalizeWhitespace = true,
    } = options;

    let cleaned = text;
    const removedContent: CleaningResult['removedContent'] = [];
    const metadata: CleaningResult['metadata'] = { pageNumbersRemoved: 0 };

    // Remove license/boilerplate
    if (removeLicense) {
        const licenseResult = removeLicenseContent(cleaned);
        cleaned = licenseResult.text;
        if (licenseResult.removed) {
            removedContent.push({
                type: 'license',
                content: licenseResult.removed,
            });
            metadata.detectedLicense = licenseResult.publisher;
        }
    }

    // Remove page numbers
    if (removePageNumbers) {
        const pageResult = removePageNumbers_internal(cleaned);
        cleaned = pageResult.text;
        metadata.pageNumbersRemoved = pageResult.count;
        if (pageResult.count > 0) {
            removedContent.push({
                type: 'page-numbers',
                content: `Removed ${pageResult.count} page number artifacts`,
            });
        }
    }

    // Normalize whitespace
    if (normalizeWhitespace) {
        // Collapse multiple newlines to double newline
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        // Collapse multiple spaces to single space
        cleaned = cleaned.replace(/[ \t]+/g, ' ');
        // Remove leading/trailing whitespace from lines
        cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
    }

    return {
        cleanedText: cleaned.trim(),
        removedContent,
        metadata,
    };
}

/**
 * Removes license and boilerplate content from text
 */
function removeLicenseContent(text: string): { text: string; removed?: string; publisher?: string } {
    let cleaned = text;
    let removed = '';
    let publisher: string | undefined;

    // Project Gutenberg: Remove everything before START marker
    for (const pattern of GUTENBERG_PATTERNS.startMarkers) {
        const match = cleaned.match(pattern);
        if (match && match.index !== undefined) {
            // Only remove if the start marker is near the beginning (within first 15000 chars)
            if (match.index < 15000) {
                removed += cleaned.substring(0, match.index + match[0].length);
                cleaned = cleaned.substring(match.index + match[0].length);
                publisher = 'Project Gutenberg';
            }
        }
    }

    // Project Gutenberg: Remove everything after END marker
    for (const pattern of GUTENBERG_PATTERNS.endMarkers) {
        const match = cleaned.match(pattern);
        if (match && match.index !== undefined) {
            removed += cleaned.substring(match.index);
            cleaned = cleaned.substring(0, match.index);
            publisher = publisher || 'Project Gutenberg';
        }
    }

    // Remove metadata lines at the start
    for (const pattern of GUTENBERG_PATTERNS.metadataPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    // =========================================================================
    // AGGRESSIVE: Handle concatenated text (no whitespace) from bad extraction
    // =========================================================================
    
    // Pattern for concatenated Gutenberg boilerplate (no spaces between words)
    // These patterns catch the blob when all whitespace is stripped
    const concatenatedPatterns = [
        // Catch the common "mostotherpartsoftheworld..." blob
        /most\s*other\s*parts\s*of\s*the\s*world\s*at\s*no\s*cost[\s\S]*?(?:gutenberg\.org|GUTENBERG)/gi,
        // Without any spaces at all
        /mostotherpartsoftheworldatnocost[\s\S]*?(?:gutenberg|GUTENBERG)/gi,
        // The "You may copy it" section
        /You\s*may\s*copy\s*it,?\s*give\s*it\s*away[\s\S]*?(?:License|license)/gi,
        /Youmaycopyit[\s\S]*?(?:License|license|eBook|ebook)/gi,
        // Credits blob
        /Credits:?\s*An\s*Anonymous\s*Volunteer[\s\S]*?(?:Widger|volunteer)/gi,
        /Credits:?AnAnonymousVolunteer[\s\S]*?(?:Widger|Volunteer)/gi,
        // Recently updated blob
        /Most\s*recently\s*updated:?[\s\S]*?(?:Credits|Language|English)/gi,
        /Mostrecentlyupdated:?[\s\S]*?(?:Credits|Language|English|Volunteer|Widger)/gi,
        // START marker without spaces
        /\*{3}\s*START\s*OF\s*THE\s*PROJECT\s*GUTENBERG\s*E-?BOOK[^*]*\*{3}/gi,
        /\*{3}STARTOFTHEPROJECTGUTENBERGE?BOOK[^*]*\*{3}/gi,
        /STARTOFTHEPROJECTGUTENBERGEBOOK/gi,
        // END marker without spaces
        /\*{3}\s*END\s*OF\s*THE\s*PROJECT\s*GUTENBERG\s*E-?BOOK[^*]*\*{3}/gi,
        /\*{3}ENDOFTHEPROJECTGUTENBERGE?BOOK[^*]*\*{3}/gi,
        /ENDOFTHEPROJECTGUTENBERGEBOOK/gi,
        // Project Gutenberg License blob
        /ProjectGutenbergLicense/gi,
        /Project\s*Gutenberg\s*License/gi,
        // The eBook header blob  
        /This\s*e?[Bb]ook\s*is\s*for\s*the\s*use\s*of\s*anyone\s*anywhere/gi,
        /Thisebookisfortheuseof/gi,
        /thise[Bb]ookisfortheuseof/gi,
        // If you are not located...
        /If\s*you\s*are\s*not\s*located\s*in\s*the\s*United\s*States[\s\S]*?e[Bb]ook/gi,
        /IfyouarenotlocatedintheUnitedStates[\s\S]*?e[Bb]ook/gi,
        // The laws of the country
        /you\s*will\s*have\s*to\s*check\s*the\s*laws[\s\S]*?e[Bb]ook/gi,
        /youwillhavetocheckthelaws[\s\S]*?e[Bb]ook/gi,
        // www.gutenberg.org references
        /online\s*at\s*www\.?gutenberg\.?org/gi,
        /onlineatwww\.?gutenberg\.?org/gi,
        /atwww\.?gutenberg\.?org/gi,
    ];

    for (const pattern of concatenatedPatterns) {
        cleaned = cleaned.replace(pattern, ' ');
    }

    // Standard Ebooks patterns
    for (const pattern of STANDARD_EBOOKS_PATTERNS.headerPatterns) {
        if (pattern.test(cleaned)) {
            cleaned = cleaned.replace(pattern, '');
            publisher = publisher || 'Standard Ebooks';
        }
    }

    // Remove orphaned license markers
    for (const pattern of GUTENBERG_PATTERNS.headerPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    for (const pattern of GUTENBERG_PATTERNS.footerPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    return { text: cleaned, removed: removed || undefined, publisher };
}

/**
 * Removes page number artifacts from text using heuristics
 */
function removePageNumbers_internal(text: string): { text: string; count: number } {
    let cleaned = text;
    let count = 0;

    // First pass: Remove obvious page number patterns
    for (const pattern of PAGE_NUMBER_PATTERNS) {
        const matches = cleaned.match(pattern);
        if (matches) {
            count += matches.length;
        }
        cleaned = cleaned.replace(pattern, '');
    }

    // Second pass: Use heuristics to detect sequential numbers
    const lines = cleaned.split('\n');
    const suspectIndices: number[] = [];
    const numberPattern = /^\s*(\d{1,4})\s*$/;

    // Find lines that are just numbers
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(numberPattern);
        if (match) {
            suspectIndices.push(i);
        }
    }

    // Check for sequential patterns
    if (suspectIndices.length >= PAGE_NUMBER_HEURISTICS.sequentialThreshold) {
        // Extract the numbers
        const numbers = suspectIndices.map(i => {
            const match = lines[i].match(numberPattern);
            return match ? parseInt(match[1], 10) : 0;
        }).filter(n => n > 0);

        // Check if they're mostly sequential
        let sequentialCount = 0;
        for (let i = 1; i < numbers.length; i++) {
            if (numbers[i] === numbers[i - 1] + 1 || numbers[i] === numbers[i - 1] + 2) {
                sequentialCount++;
            }
        }

        // If more than 50% are sequential, remove them all
        if (sequentialCount > numbers.length * 0.5) {
            for (const idx of suspectIndices) {
                lines[idx] = '';
                count++;
            }
            cleaned = lines.join('\n');
        }
    }

    // Clean up formatted page numbers
    for (const pattern of PAGE_NUMBER_HEURISTICS.formattedPatterns) {
        const matches = cleaned.match(pattern);
        if (matches) {
            // Only remove if they look like page numbers (sequential)
            const nums = matches.map(m => parseInt(m.replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
            let isSequential = false;
            for (let i = 1; i < nums.length; i++) {
                if (nums[i] === nums[i - 1] + 1) {
                    isSequential = true;
                    break;
                }
            }
            if (isSequential && matches.length > 5) {
                count += matches.length;
                cleaned = cleaned.replace(pattern, '');
            }
        }
    }

    return { text: cleaned, count };
}

/**
 * Removes page numbers using DOM-based detection
 * This works on the HTML before text extraction for better accuracy
 */
export function removePageNumbersFromHtml(html: string): string {
    // Page break elements
    let cleaned = html.replace(/<[^>]*class="[^"]*(?:pagenum|page-?break|folionum)[^"]*"[^>]*>.*?<\/[^>]+>/gi, '');
    
    // Empty page number spans/divs
    cleaned = cleaned.replace(/<(?:span|div|p)[^>]*class="[^"]*(?:pagenum|page-?number)[^"]*"[^>]*>\s*\d+\s*<\/(?:span|div|p)>/gi, '');
    
    // [Page X] markers
    cleaned = cleaned.replace(/\[(?:Page|Pg\.?)\s*\d+\]/gi, '');
    
    // Anchor-based page numbers (common in some ebooks)
    cleaned = cleaned.replace(/<a[^>]*id="(?:page|pg)_?\d+"[^>]*>.*?<\/a>/gi, '');
    
    return cleaned;
}

/**
 * Removes Gutenberg boilerplate elements from HTML
 */
export function removeGutenbergBoilerplateFromHtml(html: string): string {
    let cleaned = html;

    // Remove boilerplate divs by class
    for (const className of GUTENBERG_PATTERNS.boilerplateClasses) {
        const pattern = new RegExp(
            `<div[^>]*class="[^"]*${className}[^"]*"[^>]*>[\\s\\S]*?<\\/div>`,
            'gi'
        );
        cleaned = cleaned.replace(pattern, '');
    }

    // Remove the separator spans
    cleaned = cleaned.replace(/<span[^>]*>\s*\*{3}\s*(?:START|END) OF (?:THE |THIS )?PROJECT GUTENBERG[^<]*<\/span>/gi, '');

    return cleaned;
}

// ============================================================================
// Exports for testing
// ============================================================================

export const _testExports = {
    GUTENBERG_PATTERNS,
    STANDARD_EBOOKS_PATTERNS,
    PAGE_NUMBER_PATTERNS,
    isGutenbergLicenseChapter,
    removeLicenseContent,
    removePageNumbers_internal,
    detectTableOfContents,
};
