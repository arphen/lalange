import { describe, expect, it } from 'vitest';
import { PlainTextIngestReader } from './plainTextReader';

describe('PlainTextIngestReader', () => {
    it('joins a line-end hyphenated wrap when loading chapters', async () => {
        const reader = new PlainTextIngestReader();
        const data = new TextEncoder().encode('A theory of evo-\nlution took hold.');

        const chapters = await reader.loadChapters(data);

        expect(chapters[0].slices[0].text).toBe('A theory of evolution took hold.');
    });

    it('leaves an unattested, unhyphenated wrap split', async () => {
        const reader = new PlainTextIngestReader();
        const data = new TextEncoder().encode('The broken everythin\ng token appears here.');

        const chapters = await reader.loadChapters(data);

        expect(chapters[0].slices[0].text).toContain('everythin\ng');
    });
});
