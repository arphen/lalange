import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('index.html prerender fallback', () => {
    it('uses a single non-nested noscript block', () => {
        const openingNoscriptTags = indexHtml.match(/<noscript>/g) ?? [];
        const closingNoscriptTags = indexHtml.match(/<\/noscript>/g) ?? [];

        expect(openingNoscriptTags).toHaveLength(1);
        expect(closingNoscriptTags).toHaveLength(1);
    });

    it('does not ship a prerender CTA button that can flash before app boot', () => {
        expect(indexHtml).not.toMatch(/class="cta"/);
        expect(indexHtml).not.toMatch(/START READING NOW/i);
    });
});
