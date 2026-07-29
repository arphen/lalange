import { describe, expect, it } from 'vitest';
import { getDefaultExchangeSelection } from './bundle';

describe('exchange mode defaults', () => {
    it('gives books without personal state', () => {
        expect(getDefaultExchangeSelection('give')).toEqual({
            content: true,
            analysis: true,
            progress: false,
            highlights: false,
            listening: false,
        });
    });

    it('hands off live progress and listening state', () => {
        expect(getDefaultExchangeSelection('handoff')).toEqual({
            content: true,
            analysis: true,
            progress: true,
            highlights: false,
            listening: true,
        });
    });

    it('reconciles every book-scoped state class', () => {
        expect(getDefaultExchangeSelection('reconcile')).toEqual({
            content: true,
            analysis: true,
            progress: true,
            highlights: true,
            listening: true,
        });
    });
});
