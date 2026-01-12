/**
 * ORP (Optimal Recognition Point) Display Plugin
 * 
 * Centers each word on a fixed position, typically the 3rd letter.
 * This approach is based on research showing that the optimal viewing
 * position for word recognition is slightly left of center.
 * 
 * The ORP is highlighted (often in a different color) to draw the eye
 * to the fixation point. The word is positioned so that the ORP letter
 * always appears at the same horizontal position on screen.
 * 
 * This is similar to the Spritz-style display, but implemented as a
 * plugin within our system.
 */

import { type DisplayPlugin, type WordSplit } from './types';
import { isPauseToken } from '../tokenize';

/**
 * Calculate the ORP (Optimal Recognition Point) index for a word.
 * 
 * The ORP is typically:
 * - 1st letter for 1-letter words
 * - 1st letter for 2-letter words  
 * - 2nd letter for 3-4 letter words
 * - 3rd letter for 5+ letter words
 * 
 * This follows Spritz's documented algorithm.
 */
export const getORPIndex = (word: string): number => {
    const len = word.length;
    if (len === 0) return 0;
    if (len <= 2) return 0;  // Focus on 1st letter
    if (len <= 4) return 1;  // Focus on 2nd letter
    if (len <= 6) return 2;  // Focus on 3rd letter
    if (len <= 9) return 3;  // Focus on 4th letter
    return Math.floor(len * 0.35);  // ~35% through for very long words
};

/**
 * Generates HTML for ORP display with the focus letter highlighted.
 */
export const getORPHtml = (word: string): string => {
    if (!word) return '';

    // Handle dash/pause tokens
    if (isPauseToken(word)) {
        return `<span class="text-gray-400">—</span>`;
    }

    const orpIndex = getORPIndex(word);
    let html = '';

    for (let i = 0; i < word.length; i++) {
        if (i === orpIndex) {
            // ORP letter - highlighted with accent color
            html += `<span class="text-red-500 font-bold">${word[i]}</span>`;
        } else if (i < orpIndex) {
            // Before ORP - normal weight
            html += `<span class="opacity-90">${word[i]}</span>`;
        } else {
            // After ORP - slightly lighter
            html += `<span class="opacity-70">${word[i]}</span>`;
        }
    }

    return html;
};

/**
 * Calculate the left margin offset needed to center the ORP letter.
 * 
 * This is the key to ORP display - we need to position the word
 * so that the ORP letter always appears at the same screen position.
 * 
 * We use CSS transform to shift the word left based on which letter is the ORP.
 * Assuming monospace font, each character is approximately the same width.
 */
export const getORPOffset = (word: string): string => {
    if (!word || word.length === 0) return '0';
    
    const orpIndex = getORPIndex(word);
    // Shift left by (orpIndex) character widths, plus half a character to center on it
    // Using ch units for character width (works well with monospace fonts)
    return `-${orpIndex + 0.5}ch`;
};

/**
 * Split word for context display - ORP uses uniform styling
 */
const getORPSplit = (word: string): WordSplit => {
    // For ORP, we don't emphasize a portion - we highlight the ORP letter only
    // For context, we'll still bold the start for consistency
    if (word.length === 0) return { bold: '', light: '' };
    if (word.length === 1) return { bold: word, light: '' };
    
    const orpIndex = getORPIndex(word);
    return {
        bold: word.slice(0, orpIndex + 1),
        light: word.slice(orpIndex + 1)
    };
};

/**
 * The ORP Display Plugin implementation.
 */
export const orpPlugin: DisplayPlugin = {
    id: 'orp',
    name: 'Center Focus (ORP)',
    description: 'Centers each word on its Optimal Recognition Point (typically the 3rd letter), highlighted in red.',
    
    renderWord(word: string): string {
        return getORPHtml(word);
    },
    
    renderContextWord(word: string): string {
        const { bold, light } = getORPSplit(word);
        return `<span class="font-bold">${bold}</span><span class="font-light opacity-80">${light}</span>`;
    },
    
    splitWord(word: string): WordSplit {
        return getORPSplit(word);
    },
    
    getContainerClass(): string {
        // ORP needs the word to be positioned relative to a center point
        return 'text-left';
    },
    
    getContainerStyle(word: string): React.CSSProperties | undefined {
        if (!word) return undefined;
        
        // Position the word so the ORP letter is centered
        // We use transform to shift the word horizontally
        return {
            transform: `translateX(${getORPOffset(word)})`,
            marginLeft: '50%',  // Start from center
        };
    }
};

export default orpPlugin;
