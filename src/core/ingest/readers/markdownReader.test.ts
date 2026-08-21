import { describe, expect, it } from 'vitest';
import { MarkdownIngestReader } from './markdownReader';

describe('MarkdownIngestReader', () => {
    it('joins a line-end hyphenated wrap when loading chapters', async () => {
        const reader = new MarkdownIngestReader();
        const data = new TextEncoder().encode('# Title\n\nA theory of evo-\nlution took hold.');

        const chapters = await reader.loadChapters(data);

        expect(chapters[0].slices[0].text).toContain('evolution took hold.');
    });
});
