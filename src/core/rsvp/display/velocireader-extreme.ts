/**
 * Velocireader Extreme Display Plugin
 * 
 * An exaggerated version of the Velocireader protocol.
 * Features:
 * 1. Extreme Width Expansion: Edges stretch to 130% width.
 * 2. Peripheral Keystone: Font size increases linearly outside the parafoveal view (edges get larger).
 * 3. Standard Velocireader effects (Luma-weight, Vortex slant).
 */

import { type DisplayPlugin, type WordSplit } from './types';
import { isPauseToken } from '../tokenize';
import { 
    getVelocireaderORPIndex, 
    getLuminance, 
    getFontWeight, 
    getSlantAngle,
    getVelocireaderSplit
} from './velocireader';

/**
 * Calculate the character width scale (100-130) based on distance from ORP.
 * ORP is 100%, edges expand to 130%.
 */
export const getExtremeCharWidth = (charIndex: number, orpIndex: number, wordLength: number): number => {
    if (wordLength === 0) return 100;
    
    const distance = Math.abs(charIndex - orpIndex);
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    
    if (maxDistance === 0) return 100;
    
    // Linear expansion: 100% at ORP, +3% per character distance
    // This prevents short words from exploding in width (clownish effect)
    const widthScalingFactor = 3; // 3% per char
    const width = 100 + (distance * widthScalingFactor);
    
    // Cap at 150% to prevent excessive distortion on very long words
    return Math.min(150, Math.round(width));
};

/**
 * Calculate font size scale (1.0 - 1.5) based on distance from ORP.
 * Keeps standard size within parafoveal radius (2 chars), then expands linearly.
 */
export const getFontSizeScale = (charIndex: number, orpIndex: number, wordLength: number): number => {
    const distance = Math.abs(charIndex - orpIndex);
    const parafovealRadius = 2; // Central 5 chars (Focus + 2 each side) are stable
    
    if (distance <= parafovealRadius) return 1.0;
    
    const maxDistance = Math.max(orpIndex, wordLength - 1 - orpIndex);
    if (maxDistance <= parafovealRadius) return 1.0;

    const effectiveDist = distance - parafovealRadius;
    
    // Scale linearly by number of letters distance, capped at max letters for reasonable scaling
    // We want a few points difference over the entire word.
    // Let's say we want to reach 1.15x at distance 10.
    const scalingFactorPerChar = 0.015; // 1.5% increase per char
    
    return 1.0 + (effectiveDist * scalingFactorPerChar); 
};

export const getVelocireaderExtremeHtml = (word: string): string => {
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
        const width = getExtremeCharWidth(i, orpIndex, len);
        const slant = getSlantAngle(i, len);
        const sizeScale = getFontSizeScale(i, orpIndex, len);
        
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
            `margin: 0 ${sizeScale > 1.2 ? '1px' : '0'}`, // Add slight margin for very large letters to prevent clipping
        ].join('; ');
        
        const isORP = i === orpIndex;
        const orpClass = isORP ? 'velocireader-orp' : '';
        
        html += `<span class="${orpClass}" style="${styles}">${word[i]}</span>`;
    }

    return html;
};

export const velocireaderExtremePlugin: DisplayPlugin = {
    id: 'velocireader-extreme',
    name: 'Velocireader X',
    description: 'Extreme peripheral scaling. Edges stretch to 130% width and increase in size, creating a heavy fisheye/keystone effect.',
    
    renderWord(word: string): string {
        return getVelocireaderExtremeHtml(word);
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

export default velocireaderExtremePlugin;
