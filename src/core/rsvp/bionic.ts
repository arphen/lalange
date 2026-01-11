import { isPauseToken } from './tokenize';

export const getBionicSplit = (word: string): { bold: string, light: string } => {
    if (word.length === 0) return { bold: '', light: '' };
    if (word.length === 1) return { bold: word, light: '' };

    // Bold roughly the first half, favoring slightly less for longer words to avoid overwhelming
    let boldLength = 1;
    if (word.length <= 3) boldLength = 1;
    else if (word.length <= 5) boldLength = 2;
    else if (word.length <= 9) boldLength = 3;
    else boldLength = Math.ceil(word.length * 0.4);

    return {
        bold: word.slice(0, boldLength),
        light: word.slice(boldLength)
    };
};

/**
 * Check if a token is a pause/dash token that should get special rendering.
 */
export const isDashToken = isPauseToken;

/**
 * Generates an HTML string for displaying a dash/pause token.
 * Dashes get special visual treatment - larger, centered, with a subtle glow
 * to emphasize the cognitive pause they represent.
 */
export const getDashHtml = (dash: string): string => {
    // Use em-dash (—) as the canonical display, regardless of input
    // This normalizes en-dash, double hyphen, etc. to a consistent visual
    const displayChar = '—';
    
    return `<span class="rsvp-dash font-light opacity-80 text-gray-400">${displayChar}</span>`;
};

/**
 * Generates an HTML string with a font-weight gradient for the first 4 characters.
 * 1st char: Bold (700) / Opacity 100%
 * 2nd char: SemiBold (600) / Opacity 90%
 * 3rd char: Medium (500) / Opacity 80%
 * 4th char: Regular (400) / Opacity 70%
 * Rest: Light (300) / Opacity 50%
 * 
 * For dash tokens, returns special dash rendering instead.
 */
export const getBionicGradientHtml = (word: string): string => {
    if (!word) return '';

    // Handle dash/pause tokens with special rendering
    if (isPauseToken(word)) {
        return getDashHtml(word);
    }

    // Handle Hyphenated Words (Split and process parts)
    if (word.includes('-') && !word.endsWith('-')) {
        const parts = word.split('-');
        return parts.map(part => getBionicGradientHtml(part)).join('<span class="opacity-50">-</span><br/>');
    }

    let html = '';
    const len = word.length;

    // Character 1: Bold (700)
    if (len > 0) html += `<span class="font-bold opacity-100">${word[0]}</span>`;

    // Character 2: SemiBold (600)
    if (len > 1) html += `<span class="font-semibold opacity-90">${word[1]}</span>`;

    // Character 3: Medium (500)
    if (len > 2) html += `<span class="font-medium opacity-80">${word[2]}</span>`;

    // Character 4: Regular (400)
    if (len > 3) html += `<span class="font-normal opacity-70">${word[3]}</span>`;

    // Rest: Light/Normal with opacity
    if (len > 4) {
        html += `<span class="font-light opacity-50">${word.slice(4)}</span>`;
    }

    return html;
};
