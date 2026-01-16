/**
 * Velocireader Focus Center Display Plugin
 * 
 * An exaggerated version of the Velocireader protocol with center compression
 * (calculated from geometric center, NOT OVP) and even more aggressive spacing reduction.
 * 
 * Features:
 * 1. Geometric Center Compression: Center characters are heavily compressed.
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
import {
    getFocusCharWidth,
    getFocusFontSizeScale,
    getAnchoredSlantAngle
} from './velocireader-focus-slant';

/**
 * Calculate the horizontal margin (spacing) for a character.
 * Compresses characters near the GEOMETRIC CENTER (0.5), expands them at edges.
 * Recovery is weaker on the left side (keeps it tighter) than on the right.
 */
export const getCenterFocusMargin = (charIndex: number, wordLength: number): number => {
    const centerIndex = (wordLength - 1) / 2;
    const signedDistance = charIndex - centerIndex;
    const absDistance = Math.abs(signedDistance);
    
    // -7.0px at Center (Maximum compression)
    const baseCompression = -7.0;

    // Asymmetric Recovery:
    // Left side (< 0): 0.6 (Very weak recovery -> stays compressed)
    // Right side (>= 0): 1.3 (Stronger recovery -> expands normally)
    const recoveryRate = signedDistance < 0 ? 0.6 : 1.3;

    const margin = baseCompression + (absDistance * recoveryRate);
    
    return Math.min(2, margin);
};

export const getVelocireaderFocusCenterHtml = (word: string): string => {
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
        
        // Re-use logic from Focus S for width/size/slant
        const width = getFocusCharWidth(i, orpIndex, len);
        const slant = getAnchoredSlantAngle(i, orpIndex);
        const sizeScale = getFocusFontSizeScale(i, orpIndex, len);
        
        // Use new Center Margin logic
        const margin = getCenterFocusMargin(i, len);
        
        const opacity = luminance / 100;
        
        const styles = [
            `font-weight: ${weight}`,
            `opacity: ${opacity.toFixed(2)}`,
            `display: inline-block`,
            `transform: skewX(${-slant}deg) scaleX(${width / 100}) scale(${sizeScale})`,
            `transform-origin: bottom center`, 
            `margin: 0 ${margin}px`, 
        ].join('; ');
        
        const isORP = i === orpIndex;
        const orpClass = isORP ? 'velocireader-orp' : '';
        
        html += `<span class="${orpClass}" style="${styles}">${word[i]}</span>`;
    }

    return html;
};

export const velocireaderFocusCenterPlugin: DisplayPlugin = {
    id: 'velocireader-focus-center',
    name: 'Velocireader Focus Center',
    description: 'Aggressively compressed geometric center, expanded edges, with anchored slant.',
    
    renderWord(word: string): string {
        return getVelocireaderFocusCenterHtml(word);
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

export default velocireaderFocusCenterPlugin;
