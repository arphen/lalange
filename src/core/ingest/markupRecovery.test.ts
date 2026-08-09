import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { recoverMalformedProseMarkup } from './markupRecovery';

const xhtml = (body: string): string => `<html><head><title>Fixture</title></head><body>${body}</body></html>`;

describe('malformed prose markup recovery', () => {
    it('recovers invalid pseudo-tags before HTML parsing can expose scaffolding', () => {
        const source = xhtml('<p><..case-- exchange="" so="" the="" potlatch="" in="" north-="" west="" america="" types=""/></p>');

        const result = recoverMalformedProseMarkup(source);

        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({
            kind: 'invalid-pseudo-tag',
            action: 'repair',
            recoveredTokenCount: 10,
        });
        expect(result.html).toContain('..case-- exchange so the potlatch in north- west america types');
        expect(result.html).not.toContain('=""');
        expect(result.unresolvedCandidateCount).toBe(0);
    });

    it('recovers words that a valid-looking synthetic element would swallow', () => {
        const source = xhtml('<p><f cf.="" also="" venia="" venus="" venenum="" vanati="" to="" give="" pleasure="" and="" disposition=""/></p>');

        const result = recoverMalformedProseMarkup(source);

        expect(result.records[0]?.kind).toBe('synthetic-empty-element');
        expect(result.records[0]?.action).toBe('repair');
        expect(result.html).toContain('f cf. also venia venus venenum vanati to give pleasure and disposition');
        expect(result.recoveredTokenCount).toBe(12);
    });

    it('demonstrates why recovery must happen before DOM parsing', () => {
        const invalidSource = xhtml('<p><..case-- exchange="" so="" the="" potlatch="" in="" north-="" west="" america="" types=""/></p>');
        const swallowedSource = xhtml('<p><f cf.="" also="" venia="" venus="" venenum="" vanati="" to="" give="" pleasure="" and="" disposition=""/></p>');
        const invalidBeforeRecovery = cheerio.load(invalidSource)('body').text();
        const swallowedBeforeRecovery = cheerio.load(swallowedSource)('body').text();
        const invalidAfterRecovery = cheerio.load(recoverMalformedProseMarkup(invalidSource).html)('body').text();
        const swallowedAfterRecovery = cheerio.load(recoverMalformedProseMarkup(swallowedSource).html)('body').text();

        expect(invalidBeforeRecovery).toContain('exchange=""');
        expect(swallowedBeforeRecovery).not.toContain('venia');
        expect(invalidAfterRecovery).toContain('exchange so the potlatch');
        expect(swallowedAfterRecovery).toContain('cf. also venia venus');
    });

    it('preserves duplicate names, Unicode, entities, punctuation, and order', () => {
        const source = xhtml('<p><f Café="" café="" 你好="" l\'été="" cf.="" one="" two="" three="" four=""/></p>');

        const result = recoverMalformedProseMarkup(source);

        expect(result.html).toContain('f Café café 你好 l\'été cf. one two three four');
        expect(result.records[0]?.recoveredTokenCount).toBe(10);
    });

    it('escapes recovered markup-looking token text', () => {
        const source = xhtml('<p><f alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></p>');
        const result = recoverMalformedProseMarkup(source.replace('alpha=""', 'alpha&lt;=""'));

        expect(result.html).toContain('alpha&amp;lt; beta gamma delta epsilon zeta eta theta');
        expect(result.html).not.toContain('<alpha');
    });

    it('repairs independent candidates without offset drift and is idempotent', () => {
        const source = xhtml([
            '<p><f first="" second="" third="" fourth="" fifth="" sixth="" seventh="" eighth=""/></p>',
            '<p><..another-- ninth="" tenth="" eleventh="" twelfth="" thirteenth="" fourteenth="" fifteenth="" sixteenth=""/></p>',
        ].join(''));

        const result = recoverMalformedProseMarkup(source);
        const repeated = recoverMalformedProseMarkup(result.html);

        expect(result.records).toHaveLength(2);
        expect(result.html).toContain('f first second third fourth fifth sixth seventh eighth');
        expect(result.html).toContain('..another-- ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth');
        expect(repeated.html).toBe(result.html);
        expect(repeated.records).toHaveLength(0);
    });

    it('leaves ordinary, semantic, and machine attributes unchanged', () => {
        const source = xhtml([
            '<input disabled="" checked="" required="" readonly="">',
            '<custom-element data-first="" data-second="" aria-label="" role="">',
        ].join(''));

        const result = recoverMalformedProseMarkup(source);

        expect(result.html).toBe(source);
        expect(result.records).toHaveLength(0);
    });

    it('abstains inside authored code literals and on short mixed candidates', () => {
        const source = xhtml([
            '<pre><f alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></pre>',
            '<code><f alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></code>',
            '<p><f alpha="" beta="meaningful" gamma="" delta="" epsilon=""/></p>',
        ].join(''));

        const result = recoverMalformedProseMarkup(source);

        expect(result.html).toBe(source);
        expect(result.records).toHaveLength(3);
        expect(result.records.every((record) => record.action === 'abstain')).toBe(true);
    });

    it('does not inspect SVG or MathML attribute sets', () => {
        const source = xhtml([
            '<svg><path alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></svg>',
            '<math><mi alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></math>',
        ].join(''));

        const result = recoverMalformedProseMarkup(source);

        expect(result.html).toBe(source);
        expect(result.records).toHaveLength(0);
    });

    it('abstains on an unterminated quoted candidate', () => {
        const source = xhtml('<p><f alpha="" beta="" gamma="" delta="" epsilon="unterminated');

        const result = recoverMalformedProseMarkup(source);

        expect(result.html).toBe(source);
        expect(result.records[0]).toMatchObject({ action: 'abstain' });
        expect(result.records[0]?.reason).toContain('unterminated');
    });

    it('requires the full threshold before repairing a known tag collision', () => {
        const source = xhtml('<p><p alpha="" beta="" gamma="" delta=""/></p>');
        const result = recoverMalformedProseMarkup(source);

        expect(result.records[0]?.action).toBe('abstain');
        expect(result.html).toBe(source);

        const highEvidenceSource = xhtml('<p><p alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></p>');
        const highEvidenceResult = recoverMalformedProseMarkup(highEvidenceSource);
        expect(highEvidenceResult.records[0]).toMatchObject({
            kind: 'known-tag-collision',
            action: 'repair',
        });
    });
});