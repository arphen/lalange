/**
 * Tests for what the voice picker tells a listener about each voice.
 *
 * Download size does not separate the engines — Kokoro's quantised weights are
 * 88 MB and every Piper voice is 60 MB — so `weight` is the only field that
 * says which voice will actually keep up on a phone.
 */

import { describe, expect, it } from 'vitest';
import { listVoices } from './engine';
import { getKokoroDownloadMB } from './kokoro';

describe('voice catalogue', () => {
    it('marks Piper voices light and Kokoro voices heavy', () => {
        const voices = listVoices();

        expect(voices.find((voice) => voice.id === 'en_US-amy-low')?.weight).toBe('light');
        expect(voices.find((voice) => voice.id === 'sl_SI-artur-medium')?.weight).toBe('light');
        expect(voices.find((voice) => voice.id === 'af_heart')?.weight).toBe('heavy');
    });

    it('gives every voice a download size, so none renders a blank cost', () => {
        for (const voice of listVoices()) {
            expect(voice.downloadMB, `${voice.id} has no size`).toBeGreaterThan(0);
        }
    });

    it('offers a light voice in every language a heavy one is offered in', () => {
        const languagesWithHeavy = new Set(
            listVoices().filter((voice) => voice.weight === 'heavy').map((voice) => voice.language),
        );
        const languagesWithLight = new Set(
            listVoices().filter((voice) => voice.weight === 'light').map((voice) => voice.language),
        );

        for (const language of languagesWithHeavy) {
            expect(languagesWithLight.has(language), `no light voice for ${language}`).toBe(true);
        }
    });

    it('quotes the smaller quantised weights on iOS, which never loads fp32', () => {
        expect(getKokoroDownloadMB(true)).toBeLessThan(getKokoroDownloadMB(false));
    });
});
