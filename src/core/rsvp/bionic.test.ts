
import { describe, it, expect } from 'vitest';
import { getBionicSplit, getBionicGradientHtml, getDashHtml, isDashToken } from './bionic';

describe('getBionicSplit', () => {
    it('should handle empty string', () => {
        expect(getBionicSplit('')).toEqual({ bold: '', light: '' });
    });

    it('should handle single character', () => {
        expect(getBionicSplit('a')).toEqual({ bold: 'a', light: '' });
    });

    it('should handle short words', () => {
        expect(getBionicSplit('the')).toEqual({ bold: 't', light: 'he' });
        expect(getBionicSplit('and')).toEqual({ bold: 'a', light: 'nd' });
    });

    it('should handle medium words', () => {
        expect(getBionicSplit('hello')).toEqual({ bold: 'he', light: 'llo' });
        expect(getBionicSplit('world')).toEqual({ bold: 'wo', light: 'rld' });
    });

    it('should handle long words', () => {
        expect(getBionicSplit('information')).toEqual({ bold: 'infor', light: 'mation' });
    });
});

describe('isDashToken', () => {
    it('should recognize em-dash as dash token', () => {
        expect(isDashToken('—')).toBe(true);
    });

    it('should recognize en-dash as dash token', () => {
        expect(isDashToken('–')).toBe(true);
    });

    it('should recognize double hyphen as dash token', () => {
        expect(isDashToken('--')).toBe(true);
    });

    it('should NOT recognize regular words as dash tokens', () => {
        expect(isDashToken('hello')).toBe(false);
        expect(isDashToken('perhaps')).toBe(false);
    });

    it('should NOT recognize single hyphen as dash token', () => {
        expect(isDashToken('-')).toBe(false);
    });
});

describe('getDashHtml', () => {
    it('should return HTML with rsvp-dash class', () => {
        const html = getDashHtml('—');
        expect(html).toContain('rsvp-dash');
    });

    it('should normalize all dashes to em-dash display', () => {
        // All dash types should display as em-dash
        const emDashHtml = getDashHtml('—');
        const enDashHtml = getDashHtml('–');
        const doubleDashHtml = getDashHtml('--');
        
        // All should contain em-dash character
        expect(emDashHtml).toContain('—');
        expect(enDashHtml).toContain('—');
        expect(doubleDashHtml).toContain('—');
    });
});

describe('getBionicGradientHtml', () => {
    it('should return dash HTML for dash tokens', () => {
        const html = getBionicGradientHtml('—');
        expect(html).toContain('rsvp-dash');
        expect(html).toContain('—');
    });

    it('should return gradient HTML for regular words', () => {
        const html = getBionicGradientHtml('hello');
        expect(html).toContain('font-bold');
        expect(html).toContain('font-semibold');
    });

    it('should handle em-dash token correctly', () => {
        const html = getBionicGradientHtml('—');
        // Should use dash rendering, not gradient rendering
        expect(html).not.toContain('font-bold');
        expect(html).toContain('rsvp-dash');
    });
});
