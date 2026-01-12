/**
 * Velocireader Focus Slant Display Plugin
 * 
 * An exaggerated version of the Velocireader protocol with center compression
 * and RE-ANCHORED slant.
 * 
 * Features:
 * 1. Focus Compression: Center characters are compressed (-3.5px margin).
 * 2. Extreme Width Expansion: Edges stretch to 130% width.
 * 3. Anchored Slant: Slant is 0° at the ORP (instead of center of word), protecting the focal point.
 * 4. Standard Velocireader effects (Luma-weight).
 */

import { type DisplayPlugin, type WordSplit } from './types';
import { isPauseToken } from '../tokenize';
import { 
    getVelocireaderORPIndex, 
    getLuminance, 
    getFontWeight, 
    getVelocireaderSplit
} from './velocireader';

/**
 * Calculate the character width scale (85-130) based on distance from ORP.
 * ORP is 85% (packed), edges expand to 130%.
 */
export const getFocusCharWidth = (charIndex: number, orpIndex: number, wordLength: number): number => {
    if (wordLength === 0) return 100;
    
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 85; 
    
    // Linear expansion: 85% at ORP, +4% per character distance
    // This prevents short words from exploding in width
    const widthScalingFactor = 4; // 4% per char
    const width = 85 + (distance * widthScalingFactor);
    
    // Cap at 150%
    return Math.min(150, Math.round(width));
};

/**
 * Calculate font size scale (0.9 - 1.5) based on distance from ORP.
 * Center is slightly smaller (0.9) to aid packing.
 * Scales up to 1.5 at edges.
 */
export const getFocusFontSizeScale = (charIndex: number, orpIndex: number, wordLength: number): number => {
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 0.9;

    // Scale linearly by number of letters distance
    // We want a few points difference over the entire word.
    // Start at 0.95 at center (dist 0), scale up by 0.025 per char
    // This provides stronger "fisheye" effect for long words.
    const scalingFactorPerChar = 0.025;
    
    return 0.95 + (distance * scalingFactorPerChar); 
};

/**
 * Calculate the horizontal margin (spacing) for a character.
 * Compresses characters near the ORP, expands them at edges.
 */
export const getFocusMargin = (charIndex: number, orpIndex: number): number => {
    const distance = Math.abs(charIndex - orpIndex);
    
    // -3.5px at ORP (Very strong compression)
    // +0.7px per character distance to recover
    const margin = -3.5 + (distance * 0.7);
    
    return Math.min(2, margin);
};

/**
 * Calculate the slant angle (-15 to +15) anchored at the ORP.
 * ORP is 0° (vertical).
 * Left of ORP: Negative angles (Back slant).
 * Right of ORP: Positive angles (Forward slant).
 */
export const getAnchoredSlantAngle = (charIndex: number, orpIndex: number): number => {
    const distance = charIndex - orpIndex; // Signed distance

    if (distance === 0) return 0;
    
    const absDistance = Math.abs(distance);

    // Start at 6 degrees, increments of 2
    const magnitude = 6 + ((absDistance - 1) * 2);
    
    const angle = Math.sign(distance) * magnitude;
    
    // Cap at +/- 15 degrees
    return Math.max(-15, Math.min(15, angle));
};

export const getVelocireaderFocusSlantHtml = (word: string): string => {
    if (!word) return '';

    if (isPauseToken(word)) {
        return `<span class="text-gray-400 font-light">—</span>`;
    }

    const orpIndex = getVelocireaderORPIndex(word);
    const len = word.length;
    let html = '';

    for (let i = 0; i < len; i++) {
        const luminance = getLuminance(i, orpIndex, len);
        const weight = getFontWeight(i, orpIndex, len);
        const width = getFocusCharWidth(i, orpIndex, len);
        
        // Use new Anchored Slant
        const slant = getAnchoredSlantAngle(i, orpIndex);
        
        const sizeScale = getFocusFontSizeScale(i, orpIndex, len);
        const margin = getFocusMargin(i, orpIndex);
        
        const opacity = luminance / 100;
        
        // Combine scales. Note: scaling font-size via transform
        // We use display: inline-block to allow transforms
        const styles = [
            `font-weight: ${weight}`,
            `opacity: ${opacity.toFixed(2)}`,
            `display: inline-block`,
            // Apply Slant, then Width expansion, then Size expansion
            `transform: skewX(${-slant}deg) scaleX(${width / 100}) scale(${sizeScale})`,
            `transform-origin: bottom center`, // Keep baseline aligned
            // Variable margin for compression/expansion
            `margin: 0 ${margin}px`, 
        ].join('; ');
        
        const isORP = i === orpIndex;
        const orpClass = isORP ? 'velocireader-orp' : '';
        
        html += `<span class="${orpClass}" style="${styles}">${word[i]}</span>`;
    }

    return html;
};

export const velocireaderFocusSlantPlugin: DisplayPlugin = {
    id: 'velocireader-focus-slant',
    name: 'Velocireader Focus S',
    description: 'Compressed center, expanded edges, with slant anchored to the ORP for maximum stability.',
    
    renderWord(word: string): string {
        return getVelocireaderFocusSlantHtml(word);
    },
    
    renderContextWord(word: string): string {
        const { bold, light } = getVelocireaderSplit(word);
        return `<span class="font-bold">${bold}</span><span class="font-light opacity-70">${light}</span>`;
    },
    
    splitWord(word: string): WordSplit {
        return getVelocireaderSplit(word);
    },
    
    getContainerClass(): string {
        return 'flex justify-center items-center w-full text-center';
    },
    
    getContainerStyle(): React.CSSProperties | undefined {
        return {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            width: '100%',
        };
    }
};

export default velocireaderFocusSlantPlugin;
