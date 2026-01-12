/**
 * Velocireader (Centered) Display Plugin
 * 
 * Applies the Velocireader visual effects (Luma-Weight, Vortex Slant, Variable Width)
 * but centers the word on the screen instead of left-aligning it.
 */

import { type DisplayPlugin, type WordSplit } from './types';
import { getVelocireaderHtml, getVelocireaderSplit } from './velocireader';

export const velocireaderCenteredPlugin: DisplayPlugin = {
    id: 'velocireader-centered',
    name: 'Velocireader (Centered)',
    description: 'The "Vortex" effects (slant, gradient, variable width) centered on the screen.',
    
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
        // Center alignment
        return 'text-center';
    },
    
    getContainerStyle(): React.CSSProperties | undefined {
        // Centered monospace
        return {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            width: '100%',
            textAlign: 'center',
            display: 'block' // Ensure textAlign applies
        };
    }
};

export default velocireaderCenteredPlugin;
