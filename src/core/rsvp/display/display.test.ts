import { describe, it, expect } from 'vitest';
import { 
    getDisplayPlugin, 
    getAllDisplayPlugins, 
    getAllDisplayPluginIds,
    isValidPluginId,
    DEFAULT_DISPLAY_PLUGIN,
    saccadePlugin,
    velocireaderPlugin,
    getSaccadeSplit,
    getSaccadeGradientHtml,
    getVelocireaderORPIndex,
    getVelocireaderHtml,
    getLuminance,
    getFontWeight,
    getCharWidth,
    getSlantAngle
} from './index';

describe('Display Plugin System', () => {
    describe('getDisplayPlugin', () => {
        it('should return saccade plugin for saccade id', () => {
            const plugin = getDisplayPlugin('saccade');
            expect(plugin.id).toBe('saccade');
            expect(plugin.name).toBe('Gradient Anchoring');
        });

        it('should return velocireader plugin for velocireader id', () => {
            const plugin = getDisplayPlugin('velocireader');
            expect(plugin.id).toBe('velocireader');
            expect(plugin.name).toBe('Velocireader');
        });

        it('should return default plugin for unknown id', () => {
            // @ts-expect-error - testing invalid input
            const plugin = getDisplayPlugin('unknown');
            expect(plugin.id).toBe(DEFAULT_DISPLAY_PLUGIN);
        });
    });

    describe('getAllDisplayPlugins', () => {
        it('should return all plugins sorted by name', () => {
            const plugins = getAllDisplayPlugins();
            expect(plugins.length).toBeGreaterThanOrEqual(2);
            // Check sorting
            for (let i = 1; i < plugins.length; i++) {
                expect(plugins[i].name >= plugins[i - 1].name).toBe(true);
            }
        });
    });

    describe('getAllDisplayPluginIds', () => {
        it('should return all plugin ids', () => {
            const ids = getAllDisplayPluginIds();
            expect(ids).toContain('saccade');
            expect(ids).toContain('velocireader');
        });
    });

    describe('isValidPluginId', () => {
        it('should return true for valid ids', () => {
            expect(isValidPluginId('saccade')).toBe(true);
            expect(isValidPluginId('velocireader')).toBe(true);
        });

        it('should return false for invalid ids', () => {
            expect(isValidPluginId('unknown')).toBe(false);
            expect(isValidPluginId('')).toBe(false);
        });
    });
});

describe('Saccade Plugin', () => {
    describe('getSaccadeSplit', () => {
        it('should return empty for empty string', () => {
            const result = getSaccadeSplit('');
            expect(result).toEqual({ bold: '', light: '' });
        });

        it('should bold single character', () => {
            const result = getSaccadeSplit('a');
            expect(result).toEqual({ bold: 'a', light: '' });
        });

        it('should bold first char of 2-char word', () => {
            const result = getSaccadeSplit('hi');
            expect(result).toEqual({ bold: 'h', light: 'i' });
        });

        it('should bold first 2 chars of 4-char word', () => {
            const result = getSaccadeSplit('test');
            expect(result).toEqual({ bold: 'te', light: 'st' });
        });

        it('should bold first 3 chars of 7-char word', () => {
            const result = getSaccadeSplit('example');
            expect(result).toEqual({ bold: 'exa', light: 'mple' });
        });
    });

    describe('getSaccadeGradientHtml', () => {
        it('should return empty for empty string', () => {
            expect(getSaccadeGradientHtml('')).toBe('');
        });

        it('should render dash tokens specially', () => {
            const html = getSaccadeGradientHtml('—');
            expect(html).toContain('rsvp-dash');
        });

        it('should apply gradient to first 4+ chars', () => {
            const html = getSaccadeGradientHtml('testing');
            expect(html).toContain('font-bold');
            expect(html).toContain('font-semibold');
            expect(html).toContain('font-medium');
            expect(html).toContain('font-normal');
            expect(html).toContain('font-light');
        });

        it('should handle hyphenated words', () => {
            const html = getSaccadeGradientHtml('self-aware');
            expect(html).toContain('<br/>'); // Split at hyphen
        });
    });

    describe('saccadePlugin interface', () => {
        it('should implement renderWord', () => {
            const html = saccadePlugin.renderWord('hello');
            expect(html).toContain('font-bold');
        });

        it('should implement splitWord', () => {
            const result = saccadePlugin.splitWord('hello');
            expect(result.bold).toBeTruthy();
            expect(typeof result.light).toBe('string');
        });

        it('should return text-center for container class', () => {
            expect(saccadePlugin.getContainerClass()).toBe('text-center');
        });

        it('should return undefined for container style', () => {
            expect(saccadePlugin.getContainerStyle?.('hello')).toBeUndefined();
        });
    });
});

describe('Velocireader Plugin', () => {
    describe('getVelocireaderORPIndex', () => {
        it('should return 0 for empty string', () => {
            expect(getVelocireaderORPIndex('')).toBe(0);
        });

        it('should return 0 for 1-2 letter words', () => {
            expect(getVelocireaderORPIndex('a')).toBe(0);
            expect(getVelocireaderORPIndex('hi')).toBe(0);
        });

        it('should return 1 for 3-letter words', () => {
            expect(getVelocireaderORPIndex('the')).toBe(1);
        });

        it('should return ~35% for longer words', () => {
            // 'testing' = 7 chars, 35% = 2.45 -> floor = 2
            expect(getVelocireaderORPIndex('testing')).toBe(2);
            // 'internationalization' = 20 chars, 35% = 7
            expect(getVelocireaderORPIndex('internationalization')).toBe(7);
        });
    });

    describe('getLuminance', () => {
        it('should return 100 for ORP character', () => {
            const orpIndex = 2;
            expect(getLuminance(orpIndex, orpIndex, 5)).toBe(100);
        });

        it('should return ~50 for edge characters', () => {
            const orpIndex = 2;
            const wordLength = 5;
            // At position 0, distance from ORP(2) is 2, max distance is 2
            expect(getLuminance(0, orpIndex, wordLength)).toBe(50);
            // At position 4, distance from ORP(2) is 2, max distance is 2
            expect(getLuminance(4, orpIndex, wordLength)).toBe(50);
        });

        it('should return intermediate values for middle characters', () => {
            const orpIndex = 2;
            const wordLength = 5;
            // At position 1, distance from ORP(2) is 1
            const lum = getLuminance(1, orpIndex, wordLength);
            expect(lum).toBeGreaterThan(50);
            expect(lum).toBeLessThan(100);
        });
    });

    describe('getFontWeight', () => {
        it('should return 800 for ORP character', () => {
            const orpIndex = 2;
            expect(getFontWeight(orpIndex, orpIndex, 5)).toBe(800);
        });

        it('should return 300 for edge characters', () => {
            const orpIndex = 2;
            const wordLength = 5;
            expect(getFontWeight(0, orpIndex, wordLength)).toBe(300);
            expect(getFontWeight(4, orpIndex, wordLength)).toBe(300);
        });

        it('should return intermediate values for middle characters', () => {
            const orpIndex = 2;
            const wordLength = 5;
            const weight = getFontWeight(1, orpIndex, wordLength);
            expect(weight).toBeGreaterThan(300);
            expect(weight).toBeLessThan(800);
        });
    });

    describe('getCharWidth', () => {
        it('should return 100 for ORP character', () => {
            const orpIndex = 2;
            expect(getCharWidth(orpIndex, orpIndex, 5)).toBe(100);
        });

        it('should return 120 for edge characters', () => {
            const orpIndex = 2;
            const wordLength = 5;
            expect(getCharWidth(0, orpIndex, wordLength)).toBe(120);
            expect(getCharWidth(4, orpIndex, wordLength)).toBe(120);
        });
    });

    describe('getSlantAngle', () => {
        it('should return -10 for first character', () => {
            expect(getSlantAngle(0, 5)).toBe(-10);
        });

        it('should return +10 for last character', () => {
            expect(getSlantAngle(4, 5)).toBe(10);
        });

        it('should return 0 for middle character', () => {
            // Middle of 5-char word is index 2
            expect(getSlantAngle(2, 5)).toBe(0);
        });

        it('should return 0 for single character word', () => {
            expect(getSlantAngle(0, 1)).toBe(0);
        });
    });

    describe('getVelocireaderHtml', () => {
        it('should return empty for empty string', () => {
            expect(getVelocireaderHtml('')).toBe('');
        });

        it('should handle dash tokens', () => {
            const html = getVelocireaderHtml('—');
            expect(html).toContain('—');
        });

        it('should apply inline styles to each character', () => {
            const html = getVelocireaderHtml('hello');
            expect(html).toContain('font-weight:');
            expect(html).toContain('opacity:');
            expect(html).toContain('transform:');
        });

        it('should mark ORP character with special class', () => {
            const html = getVelocireaderHtml('hello');
            expect(html).toContain('velocireader-orp');
        });

        it('should render all characters', () => {
            const html = getVelocireaderHtml('test');
            expect(html).toContain('>t<');
            expect(html).toContain('>e<');
            expect(html).toContain('>s<');
        });
    });

    describe('velocireaderPlugin interface', () => {
        it('should implement renderWord', () => {
            const html = velocireaderPlugin.renderWord('hello');
            expect(html).toContain('font-weight');
        });

        it('should implement splitWord', () => {
            const result = velocireaderPlugin.splitWord('hello');
            expect(result.bold).toBeTruthy();
            expect(typeof result.light).toBe('string');
        });

        it('should return text-left for container class', () => {
            expect(velocireaderPlugin.getContainerClass()).toBe('text-left');
        });

        it('should return positioning style with paddingLeft', () => {
            const style = velocireaderPlugin.getContainerStyle?.('hello');
            expect(style).toBeDefined();
            expect(style?.paddingLeft).toBe('20%');
            expect(style?.fontFamily).toContain('monospace');
        });
    });
});