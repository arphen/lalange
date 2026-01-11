
import { describe, it, expect } from 'vitest';
import { getSaccadeSplit, getSaccadeGradientHtml, getDashHtml, isDashToken } from './saccade';

describe('getSaccadeSplit', () => {
    it('should handle empty string', () => {
        expect(getSaccadeSplit('')).toEqual({ bold: '', light: '' });
    });

    it('should handle single character', () => {
        expect(getSaccadeSplit('a')).toEqual({ bold: 'a', light: '' });
    });

    it('should handle short words', () => {
        expect(getSaccadeSplit('the')).toEqual({ bold: 't', light: 'he' });
        expect(getSaccadeSplit('and')).toEqual({ bold: 'a', light: 'nd' });
    });

    it('should handle medium words', () => {
        expect(getSaccadeSplit('hello')).toEqual({ bold: 'he', light: 'llo' });
        expect(getSaccadeSplit('world')).toEqual({ bold: 'wo', light: 'rld' });
    });

    it('should handle long words', () => {
        expect(getSaccadeSplit('information')).toEqual({ bold: 'infor', light: 'mation' });
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
        const html = getDashHtml();
        expect(html).toContain('rsvp-dash');
    });

    it('should normalize all dashes to em-dash display', () => {
        // The function always returns em-dash regardless of usage context
        const html = getDashHtml();
        expect(html).toContain('—');
    });
});

describe('getSaccadeGradientHtml', () => {
    it('should return dash HTML for dash tokens', () => {
        const html = getSaccadeGradientHtml('—');
        expect(html).toContain('rsvp-dash');
        expect(html).toContain('—');
    });

    it('should return gradient HTML for regular words', () => {
        const html = getSaccadeGradientHtml('hello');
        expect(html).toContain('font-bold');
        expect(html).toContain('font-semibold');
    });

    it('should handle em-dash token correctly', () => {
        const html = getSaccadeGradientHtml('—');
        // Should use dash rendering, not gradient rendering
        expect(html).not.toContain('font-bold');
        expect(html).toContain('rsvp-dash');
    });
});
