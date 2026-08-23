import { describe, expect, it } from 'vitest';
import { scanTextForAnomalies } from './anomalyScanner';

describe('scanTextForAnomalies', () => {
    const scan = (text: string) => scanTextForAnomalies({
        bookId: 'book-1',
        sourceUnitId: 'chapter-1',
        revisionHash: 'revision-1',
        text,
    });

    it('emits source-anchored candidates for deterministic corruption signals', async () => {
        const text = `${Array.from({ length: 30 }, () => 'ordinary prose').join(' ')} The th3 text has .5 residue and &amp; markup.`;
        const result = await scan(text);

        expect(result.circuitBroken).toBe(false);
        expect(result.candidates.map((candidate) => candidate.detectorIds).flat()).toEqual(expect.arrayContaining([
            'numeric-alphanumeric-intrusion',
            'numeric-lone-fragment',
            'markup-residue',
        ]));
        const numericCandidate = result.candidates.find((candidate) => candidate.detectorIds.includes('numeric-alphanumeric-intrusion'));
        expect(numericCandidate).toMatchObject({
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash: 'revision-1',
            startOffset: text.indexOf('th3'),
            endOffset: text.indexOf('th3') + 3,
            severity: 'medium',
            ambiguity: 'high',
        });
    });

    it('keeps valid numeric and protected content out of the candidate index', async () => {
        const text = 'Chapter 2 contains 3.14 and H2O, plus th3.';
        const result = await scanTextForAnomalies({
            bookId: 'book-1',
            sourceUnitId: 'chapter-1',
            revisionHash: 'revision-1',
            text,
            protectedRanges: [{
                startOffset: text.indexOf('th3'),
                endOffset: text.indexOf('th3') + 3,
                reason: 'code span',
            }],
        });

        expect(result.candidates.some((candidate) => candidate.originalHash)).toBe(false);
    });

    it('merges overlapping detector evidence into one candidate', async () => {
        const text = 'Broken th3 !';
        const result = await scan(text);
        const overlapping = result.candidates.find((candidate) => candidate.startOffset === text.indexOf('th3'));

        expect(overlapping?.detectorIds).toEqual(expect.arrayContaining(['numeric-alphanumeric-intrusion']));
        expect(result.candidates.filter((candidate) => candidate.startOffset === text.indexOf('th3'))).toHaveLength(1);
    });

    it('reports a circuit breaker when candidate density is excessive', async () => {
        const text = Array.from({ length: 30 }, (_, index) => `th${index}`).join(' ');
        const result = await scan(text);

        expect(result.circuitBroken).toBe(true);
        expect(result.circuitBreakerReason).toBe('candidate-ratio');
    });
});
