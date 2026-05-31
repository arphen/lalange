import {
    cleanReferencesFromHtml,
    cleanText,
    removeGutenbergBoilerplateFromHtml,
    removePageNumbersFromHtml,
    type ReferenceHandlingMode,
} from './cleaning';

/**
 * Removes license text from plain text content.
 * This is a wrapper around the more comprehensive cleaning module.
 */
export const removeLicenseText = (text: string): string => {
    const result = cleanText(text, {
        removeLicense: true,
        removePageNumbers: true,
        normalizeWhitespace: true,
        referenceHandling: 'suppress',
    });
    return result.cleanedText;
};

/**
 * Legacy function for backwards compatibility.
 * Use cleanText from './cleaning' for more control.
 * @deprecated Use cleanText from './cleaning' instead
 */
export const removeLicenseTextLegacy = (text: string): string => {
    let cleaned = text;

    // Common Project Gutenberg headers/footers
    const patterns = [
        /^\s*The Project Gutenberg EBook of.*$/gim,
        /^\s*The Project Gutenberg eBook of.*$/gim,
        /^\s*This eBook is for the use of anyone anywhere.*$/gim,
        /^\s*This ebook is for the use of anyone anywhere.*$/gim,
        /^\s*Copyright laws are changing all over the world.*$/gim,
        /^\s*Be sure to check the copyright laws for your country.*$/gim,
        /^\s*Title:.*$/gim,
        /^\s*Author:.*$/gim,
        /^\s*Release [Dd]ate:.*$/gim,
        /^\s*Language:.*$/gim,
        /^\s*Credits:.*$/gim,
        /^\s*\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}.*$/gim,
        /^\s*\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}.*$/gim,
        /^\s*Produced by.*$/gim,
        /^\s*End of (?:the )?Project Gutenberg.*$/gim,
        // Standard Ebooks
        /^\s*This is a publication of Standard Ebooks.*$/gim,
        /^\s*The Standard Ebooks project is a volunteer effort.*$/gim,
        /^\s*standardebooks\.org.*$/gim,
        // Gutenberg license sections
        /^\s*START:\s*FULL LICENSE.*$/gim,
        /^\s*THE FULL PROJECT GUTENBERG LICENSE.*$/gim,
        /^\s*Section 1\.\s*General Terms of Use.*$/gim,
        // More Gutenberg specific
        /^\s*Updated editions will replace the previous one.*$/gim,
        /^\s*Creating the works from print editions.*$/gim,
        /^\s*Project Gutenberg Literary Archive Foundation.*$/gim,
        /^\s*www\.gutenberg\.org.*$/gim,
        // Transcriber notes
        /^\s*Transcriber['']?s?\s*[Nn]ote[s]?:?.*$/gim,
    ];

    // Remove specific blocks
    // Project Gutenberg Header - more flexible pattern
    const pgHeaderStart = /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}/i;
    const pgHeaderEnd = /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[^*]*\*{3}/i;

    // Sometimes the header is at the beginning, sometimes there is metadata before it.
    // We can try to find the start marker and remove everything before it.
    const startMatch = cleaned.match(pgHeaderStart);
    if (startMatch && startMatch.index !== undefined) {
        // Check if it's reasonably close to the start (e.g. within first 15000 chars)
        // If it is, we assume everything before it is license/metadata
        if (startMatch.index < 15000) {
            cleaned = cleaned.substring(startMatch.index + startMatch[0].length);
        }
    }

    // Remove footer - everything after END marker
    const endMatch = cleaned.match(pgHeaderEnd);
    if (endMatch && endMatch.index !== undefined) {
        cleaned = cleaned.substring(0, endMatch.index);
    }

    // Remove single line patterns
    patterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // Remove multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
};

/**
 * Cleans HTML content before text extraction.
 * Removes boilerplate elements and page numbers from the DOM.
 */
export const cleanHtmlBeforeExtraction = (
    html: string,
    options: { referenceHandling?: ReferenceHandlingMode } = {},
): string => {
    const { referenceHandling = 'suppress' } = options;

    let cleaned = html;
    cleaned = removeGutenbergBoilerplateFromHtml(cleaned);
    cleaned = removePageNumbersFromHtml(cleaned);
    cleaned = cleanReferencesFromHtml(cleaned, { referenceHandling });
    return cleaned;
};
