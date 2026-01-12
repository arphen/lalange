/**
 * Velocireader Display Plugin
 * 
 * Left-Aligned Monospace RSVP with Luma-Weight Anchoring & Peripheral Notching.
 * 
 * This plugin eliminates "saccadic exhaustion" of standard RSVP without infringing
 * on "Fixed ORP" patents. It transforms reading into a high-velocity data stream
 * by stabilizing the eye's start position while making the word's center (ORP)
 * visually irresistible via contrast and shape manipulation.
 * 
 * Key Features:
 * 1. Left-Aligned Monospace - Words left-aligned with predictable character spacing
 * 2. Luma-Weight Gradient - ORP is bright/bold, edges fade to dim/light
 * 3. Variable Width Expansion - Characters near edges stretch wider (simulated)
 * 4. Vortex Slant - Start slants back, end slants forward (guides eye flow)
 * 
 * Target: 600+ WPM with high comprehension and low cognitive load.
 */

import { type DisplayPlugin, type WordSplit } from './types';
import { isPauseToken } from '../tokenize';

/**
 * Calculate the ORP (Optimal Recognition Point) index for a word.
 * The ORP is approximately 35% into the word.
 */
export const getVelocireaderORPIndex = (word: string): number => {
    const len = word.length;
    if (len === 0) return 0;
    if (len === 1) return 0;
    if (len === 2) return 0;
    if (len === 3) return 1;
    // ~35% into the word for longer words
    return Math.floor(len * 0.35);
};

/**
 * Calculate the luminance value (0-100) for a character based on distance from ORP.
 * Uses a Gaussian-like falloff from 100% at ORP to ~50% at edges.
 */
export const getLuminance = (charIndex: number, orpIndex: number, wordLength: number): number => {
    if (wordLength === 0) return 100;
    
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 100;
    
    // Gaussian-like falloff: 100% at ORP, ~50% at max distance
    const normalizedDistance = distance / maxDistance;
    const luminance = 100 - (normalizedDistance * 50);
    
    return Math.round(luminance);
};

/**
 * Calculate the font weight (300-800) for a character based on distance from ORP.
 * ORP is Extra-Bold (800), edges fade to Light (300).
 */
export const getFontWeight = (charIndex: number, orpIndex: number, wordLength: number): number => {
    if (wordLength === 0) return 800;
    
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 800;
    
    // Linear falloff: 800 at ORP, 300 at max distance
    const normalizedDistance = distance / maxDistance;
    const weight = 800 - (normalizedDistance * 500);
    
    return Math.round(weight);
};

/**
 * Calculate the character width scale (100-120) based on distance from ORP.
 * ORP is 100%, edges expand to 120%.
 */
export const getCharWidth = (charIndex: number, orpIndex: number, wordLength: number): number => {
    if (wordLength === 0) return 100;
    
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 100;
    
    // Linear expansion: 100% at ORP, 120% at max distance
    const normalizedDistance = distance / maxDistance;
    const width = 100 + (normalizedDistance * 20);
    
    return Math.round(width);
};

/**
 * Calculate the slant angle (-10 to +10) for a character.
 * Start of word: -10° (back slant), End: +10° (forward slant).
 * This creates the "vortex" effect that guides the eye.
 */
export const getSlantAngle = (charIndex: number, wordLength: number): number => {
    if (wordLength <= 1) return 0;
    
    // Linear interpolation from -10° at start to +10° at end
    const normalizedPosition = charIndex / (wordLength - 1);
    const angle = -10 + (normalizedPosition * 20);
    
    return Math.round(angle);
};

/**
 * Generates HTML for Velocireader display with all the visual effects applied.
 */
export const getVelocireaderHtml = (word: string): string => {
    if (!word) return '';

    // Handle dash/pause tokens
    if (isPauseToken(word)) {
        return `<span class="text-gray-400 font-light">—</span>`;
    }

    const orpIndex = getVelocireaderORPIndex(word);
    const len = word.length;
    let html = '';

    for (let i = 0; i < len; i++) {
        const luminance = getLuminance(i, orpIndex, len);
        const weight = getFontWeight(i, orpIndex, len);
        const width = getCharWidth(i, orpIndex, len);
        const slant = getSlantAngle(i, len);
        
        // Convert luminance to opacity (50-100 -> 0.5-1.0)
        const opacity = luminance / 100;
        
        // Build inline styles for the character
        // Using CSS custom properties and inline styles for maximum control
        const styles = [
            `font-weight: ${weight}`,
            `opacity: ${opacity.toFixed(2)}`,
            `display: inline-block`,
            `transform: skewX(${-slant}deg) scaleX(${width / 100})`,
            `transform-origin: bottom center`,
        ].join('; ');
        
        // Mark ORP character with a special class for potential additional styling
        const isORP = i === orpIndex;
        const orpClass = isORP ? 'velocireader-orp' : '';
        
        html += `<span class="${orpClass}" style="${styles}">${word[i]}</span>`;
    }

    return html;
};

/**
 * Split word for context display.
 * For Velocireader, we emphasize up to the ORP.
 */
export const getVelocireaderSplit = (word: string): WordSplit => {
    if (word.length === 0) return { bold: '', light: '' };
    if (word.length === 1) return { bold: word, light: '' };
    
    const orpIndex = getVelocireaderORPIndex(word);
    return {
        bold: word.slice(0, orpIndex + 1),
        light: word.slice(orpIndex + 1)
    };
};

/**
 * The Velocireader Display Plugin implementation.
 */
export const velocireaderPlugin: DisplayPlugin = {
    id: 'velocireader',
    name: 'Velocireader',
    description: 'Left-aligned with luma-weight gradient anchoring. The ORP glows bright while edges fade, with a subtle vortex slant effect.',
    
    renderWord(word: string): string {
        return getVelocireaderHtml(word);
    },
    
    renderContextWord(word: string): string {
        const { bold, light } = getVelocireaderSplit(word);
        return `<span class="font-bold">${bold}</span><span class="font-light opacity-70">${light}</span>`;
    },
    
    splitWord(word: string): WordSplit {
        return getVelocireaderSplit(word);
    },
    
    getContainerClass(): string {
        // Velocireader uses left alignment - the eye stays on the left edge
        return 'text-left';
    },
    
    getContainerStyle(): React.CSSProperties | undefined {
        // Left-aligned at a fixed position (20% from left edge)
        return {
            paddingLeft: '20%',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            width: '100%',
        };
    }
};

export default velocireaderPlugin;
