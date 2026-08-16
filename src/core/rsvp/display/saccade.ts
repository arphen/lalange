/**
 * Saccade Display Plugin
 * 
 * Uses a continuous font-weight gradient to guide the reader's eye.
 * This creates "saccade anchoring" where the bold start of each word
 * draws the fovea to the optimal viewing position.
 * 
 * The gradient flows: Bold (700) → SemiBold (600) → Medium (500) → Regular (400) → Light (300)
 * 
 * This approach uses a continuous gradient rather than discrete bolding,
 * creating a more natural visual flow.
 */

import { type DisplayPlugin, type DisplayWordModel, type WordSplit } from './types';
import { isPauseToken } from '../tokenize';

/**
 * Check if a token is a dash/pause token.
 */
export const isDashToken = isPauseToken;

/**
 * Split a word into bold and light portions for the saccade effect.
 * The split point is determined by word length.
 */
export const getSaccadeSplit = (word: string): WordSplit => {
    if (word.length === 0) return { bold: '', light: '' };
    if (word.length === 1) return { bold: word, light: '' };

    // Bold roughly the first portion, favoring slightly less for longer words
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
 * Generates an HTML string for displaying a dash/pause token.
 */
const getDashHtml = (): string => {
    const displayChar = '—';
    return `<span class="rsvp-dash font-light opacity-80 text-gray-400">${displayChar}</span>`;
};

/**
 * Generates an HTML string with a font-weight gradient for the first 4 characters.
 * 
 * 1st char: Bold (700) / Opacity 100%
 * 2nd char: SemiBold (600) / Opacity 90%
 * 3rd char: Medium (500) / Opacity 80%
 * 4th char: Regular (400) / Opacity 70%
 * Rest: Light (300) / Opacity 50%
 */
export const getSaccadeGradientHtml = (word: string): string => {
    if (!word) return '';

    // Handle dash/pause tokens with special rendering
    if (isPauseToken(word)) {
        return getDashHtml();
    }

    // Handle Hyphenated Words (Split and process parts)
    if (word.includes('-') && !word.endsWith('-')) {
        const parts = word.split('-');
        return parts.map(part => getSaccadeGradientHtml(part)).join('<span class="opacity-50">-</span><br/>');
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

const getSaccadeWordModel = (word: string): DisplayWordModel => {
    if (!word) return { runs: [] };
    if (isPauseToken(word)) {
        return { runs: [{ text: '—', className: 'rsvp-dash font-light opacity-80 text-gray-400' }] };
    }
    if (word.includes('-') && !word.endsWith('-')) {
        const runs: DisplayWordModel['runs'] = [];
        const parts = word.split('-');
        parts.forEach((part, index) => {
            runs.push(...getSaccadeWordModel(part).runs);
            if (index < parts.length - 1) {
                runs.push({ text: '-', className: 'opacity-50', breakAfter: true });
            }
        });
        return { runs };
    }

    const runs: DisplayWordModel['runs'] = [];
    const addCharacter = (text: string, className: string) => runs.push({ text, className });
    const length = word.length;

    if (length > 0) addCharacter(word[0], 'font-bold opacity-100');
    if (length > 1) addCharacter(word[1], 'font-semibold opacity-90');
    if (length > 2) addCharacter(word[2], 'font-medium opacity-80');
    if (length > 3) addCharacter(word[3], 'font-normal opacity-70');
    if (length > 4) addCharacter(word.slice(4), 'font-light opacity-50');

    return { runs };
};

/**
 * The Saccade Display Plugin implementation.
 */
export const saccadePlugin: DisplayPlugin = {
    id: 'saccade',
    name: 'Gradient Anchoring',
    description: 'Uses a font-weight gradient (bold→light) to guide your eye to the start of each word.',
    
    renderWord(word: string): string {
        return getSaccadeGradientHtml(word);
    },

    renderWordModel(word: string): DisplayWordModel {
        return getSaccadeWordModel(word);
    },
    
    renderContextWord(word: string): string {
        const { bold, light } = getSaccadeSplit(word);
        return `<span class="font-bold">${bold}</span><span class="font-light opacity-80">${light}</span>`;
    },
    
    splitWord(word: string): WordSplit {
        return getSaccadeSplit(word);
    },
    
    getContainerClass(): string {
        // Saccade uses default centering - the gradient naturally centers the word visually
        return 'text-center';
    },
    
    getContainerStyle(): React.CSSProperties | undefined {
        // No special positioning needed for saccade
        return undefined;
    }
};

export default saccadePlugin;
