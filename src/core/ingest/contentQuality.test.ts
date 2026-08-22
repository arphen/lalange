import { describe, expect, it } from 'vitest';
import {
    analyzeContentUnits,
    cleanContentUnit,
    type RawContentUnit,
} from './contentQuality';
import { recoverMalformedProseMarkup } from './markupRecovery';

const unit = (text: string, path = 'page.html'): RawContentUnit => ({
    ordinal: 0,
    path,
    html: `<p>${text}</p>`,
    text,
    lines: text.split('\n'),
});

describe('content quality gate', () => {
    it('rejects pages with unusably low OCR confidence', () => {
        const result = cleanContentUnit(unit(
            'The text on this page is estimated to be only 0.19% accurate >^\'U VH ^- ?.',
            'page_0.html',
        ));

        expect(result.decision).toBe('reject');
        expect(result.reason).toContain('OCR confidence');
        expect(result.issues.map((issue) => issue.type)).toContain('low-ocr-confidence');
    });

    it('rejects short library scan matter', () => {
        const result = cleanContentUnit(unit(
            'University of California Library. This book is DUE on the last date stamped below. RECEIVED.',
            'page_158.html',
        ));

        expect(result.decision).toBe('reject');
        expect(result.issues.map((issue) => issue.type)).toContain('scan-matter');
    });

    it('removes forbidden controls but preserves reading whitespace', () => {
        const result = cleanContentUnit(unit('First\u0000 line\u007f\nSecond line'));

        expect(result.cleanedText).toBe('First line\nSecond line');
        expect(result.removedCharacters).toBe(2);
        expect(result.issues[0]?.type).toBe('control-character');
    });

    it('does not reject legitimate symbols by themselves', () => {
        const result = cleanContentUnit(unit(
            'Acme® paid £5. Section § 4 preserves © 2026, x^2, Greek α, and an em dash.',
        ));

        expect(result.decision).toBe('accept');
        expect(result.cleanedText).toContain('Acme®');
        expect(result.cleanedText).toContain('x^2');
    });

    it('marks moderate OCR evidence as degraded without discarding prose', () => {
        const result = cleanContentUnit(unit(
            'The text on this page is estimated to be only 21.92% accurate. The discussion continues with substantial prose that should remain available to the reader.',
        ));

        expect(result.decision).toBe('accept-degraded');
        expect(result.cleanedText).toContain('substantial prose');
    });

    it('builds book-local token evidence for later normalization phases', () => {
        const profile = analyzeContentUnits([
            unit('The everything word appears here.', 'page_1.html'),
            unit('The everything word appears again.', 'page_2.html'),
        ]);

        expect(profile.intactTokens.has('everything')).toBe(true);
        expect(profile.repeatedEdgeSignatures.size).toBe(0);
    });

    it('removes recurring edge furniture but preserves a one-off heading', () => {
        const units = [
            unit('8 THE GIFT\nFirst page prose.', 'page_1.html'),
            unit('9 THE GIFT\nSecond page prose.', 'page_2.html'),
            unit('10 THE GIFT\nThird page prose.', 'page_3.html'),
            unit('Chapter One\nA one-off heading remains.', 'page_4.html'),
        ];
        const profile = analyzeContentUnits(units);
        const results = units.map((source) => cleanContentUnit(source, profile));

        expect(profile.repeatedEdgeSignatures.has('<number> the gift')).toBe(true);
        expect(results[0]?.cleanedText).toBe('First page prose.');
        expect(results[1]?.cleanedText).toBe('Second page prose.');
        expect(results[2]?.cleanedText).toBe('Third page prose.');
        expect(results[3]?.cleanedText).toBe('Chapter One\nA one-off heading remains.');
        expect(results[0]?.issues.map((issue) => issue.type)).toContain('page-furniture');
    });

    it('handles OCR reference markers only when the book has marker evidence', () => {
        const profile = analyzeContentUnits([
            unit("A ritual.^' marker appears here.", 'page_1.html'),
            unit('A second note ^^ appears here.', 'page_2.html'),
            unit('A property.^* marker appears here.', 'page_3.html'),
        ]);
        const source = unit("The ritual.^' continues with x^2 and Acme®. ");

        const suppressed = cleanContentUnit(source, profile, { referenceHandling: 'suppress' });
        const compacted = cleanContentUnit(source, profile, { referenceHandling: 'compact' });
        const kept = cleanContentUnit(source, profile, { referenceHandling: 'keep' });

        expect(suppressed.cleanedText).toContain('The ritual. continues');
        expect(suppressed.cleanedText).toContain('x^2');
        expect(suppressed.cleanedText).toContain('Acme®');
        expect(compacted.cleanedText).toContain('ritual. [ref] continues');
        expect(kept.cleanedText).toContain("ritual.^'");
        expect(suppressed.issues.map((issue) => issue.type)).toContain('reference-marker');
    });

    it('joins only book-supported hard-wrapped words', () => {
        const units = [
            unit('The complete everything token appears intact.', 'page_1.html'),
            unit('The broken everythin\ng token appears here.', 'page_2.html'),
            unit('The ambiguous or\ninfluential boundary remains split.', 'page_3.html'),
        ];
        const profile = analyzeContentUnits(units);
        const repaired = cleanContentUnit(units[1], profile);
        const ambiguous = cleanContentUnit(units[2], profile);

        expect(repaired.cleanedText).toContain('everything token');
        expect(repaired.issues.map((issue) => issue.type)).toContain('hard-wrap');
        expect(ambiguous.cleanedText).toContain('or\ninfluential');
    });

    it('joins a line-end hyphenated word without book attestation', () => {
        const source = unit('The evo-\nlution of species is discussed here.');
        const profile = analyzeContentUnits([source]);
        const result = cleanContentUnit(source, profile);

        expect(result.cleanedText).toContain('evolution of');
        expect(result.issues.map((issue) => issue.type)).toContain('hard-wrap');
    });

    it('preserves a compound the book attests as hyphenated', () => {
        const units = [
            unit('The mind can be self-aware in rare moments.', 'page_1.html'),
            unit('A self-\naware mind notices itself.', 'page_2.html'),
        ];
        const profile = analyzeContentUnits(units);
        const result = cleanContentUnit(units[1], profile);

        expect(result.cleanedText).toContain('self-aware mind');
    });

    it('drops soft hyphens end to end', () => {
        const withinLine = unit('An evo­lution of species.');
        const acrossLines = unit('An evo­\nlution of species.');
        const profile = analyzeContentUnits([withinLine, acrossLines]);

        const withinResult = cleanContentUnit(withinLine, profile);
        const acrossResult = cleanContentUnit(acrossLines, profile);

        expect(withinResult.cleanedText).toContain('evolution');
        expect(withinResult.cleanedText).not.toContain('­');
        expect(acrossResult.cleanedText).toContain('evolution');
        expect(acrossResult.cleanedText).not.toContain('­');
    });

    it('does not introduce a paragraph break when repairing a wrap', () => {
        const source = unit('a b evo-\nlution c\nd e');
        const profile = analyzeContentUnits([source]);
        const result = cleanContentUnit(source, profile);

        expect(result.cleanedText).not.toContain('\n\n');
    });

    it('keeps notes in keep mode and omits the notes zone otherwise', () => {
        const source = unit('NOTES 83 A bibliographical note with a citation.', 'page_105.html');
        const bibliography = unit('Page 104 BIBLIOGRAPHICAL ABBREVIATIONS USED IN THE NOTES 5th Report.', 'page_104.html');
        const chapterNotes = unit('Page 107 CH. I NOTES 85 Chapter I 1 Davy.', 'page_107.html');

        expect(cleanContentUnit(source, undefined, { referenceHandling: 'keep' }).cleanedText).toContain('NOTES 83');
        expect(cleanContentUnit(source, undefined, { referenceHandling: 'suppress' })).toMatchObject({
            cleanedText: '',
            zone: 'notes',
        });
        expect(cleanContentUnit(source, undefined, { referenceHandling: 'compact' })).toMatchObject({
            cleanedText: '',
            zone: 'notes',
        });
        expect(cleanContentUnit(bibliography, undefined, { referenceHandling: 'keep' }).zone).toBe('notes');
        expect(cleanContentUnit(chapterNotes, undefined, { referenceHandling: 'keep' }).zone).toBe('notes');
    });

    it('surfaces repaired markup as degraded quality evidence', () => {
        const recovery = recoverMalformedProseMarkup('<body><p><f alpha="" beta="" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></p></body>');
        const source = unit('f alpha beta gamma delta epsilon zeta eta theta', 'markup.html');
        source.html = recovery.html;
        source.markupRecovery = recovery;

        const result = cleanContentUnit(source);

        expect(result.decision).toBe('accept-degraded');
        expect(result.issues.map((issue) => issue.type)).toContain('malformed-prose-markup');
        expect(result.cleanedText).toContain('alpha beta gamma delta');
    });

    it('rejects substantial unresolved markup outside protected literal contexts', () => {
        const recovery = recoverMalformedProseMarkup('<body><p><f alpha="" beta="meaningful" gamma="" delta="" epsilon="" zeta="" eta="" theta=""/></p></body>');
        const source = unit('Visible prose before the unresolved candidate.', 'markup.html');
        source.markupRecovery = recovery;

        const result = cleanContentUnit(source);

        expect(result.decision).toBe('reject');
        expect(result.reason).toContain('Unresolved malformed prose markup');
    });
});