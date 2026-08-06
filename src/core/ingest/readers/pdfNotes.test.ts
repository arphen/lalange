import { describe, expect, it } from 'vitest';
import { extractPdfNotes, linkPdfNoteAnchors, type PdfNoteEntry } from './pdfNotes';
import type { PdfLayoutRegion } from './pdfLayout';

const makeRegion = (
    id: string,
    pageNumber: number,
    text: string,
    box: PdfLayoutRegion['box'],
    wordHeight: number,
    role: PdfLayoutRegion['role'] = 'body',
): PdfLayoutRegion => {
    const lines = text.split('\n').map((lineText, lineIndex) => {
        const lineWords = lineText.split(' ').map((wordText, wordIndex) => ({
            id: `${id}-w${lineIndex}-${wordIndex}`,
            pageNumber,
            text: wordText,
            box: {
                x0: box.x0 + wordIndex * 0.02,
                y0: box.y0 + lineIndex * wordHeight * 1.5,
                x1: box.x0 + wordIndex * 0.02 + 0.015,
                y1: box.y0 + lineIndex * wordHeight * 1.5 + wordHeight,
            },
            baseline: box.y0 + lineIndex * wordHeight * 1.5 + wordHeight,
            direction: 'ltr' as const,
            source: 'embedded' as const,
        }));
        return {
            id: `${id}-l${lineIndex}`,
            pageNumber,
            words: lineWords,
            box: {
                x0: box.x0,
                y0: box.y0 + lineIndex * wordHeight * 1.5,
                x1: box.x1,
                y1: box.y0 + lineIndex * wordHeight * 1.5 + wordHeight,
            },
            baseline: box.y0 + lineIndex * wordHeight * 1.5 + wordHeight,
            medianWordHeight: wordHeight,
            text: lineText,
        };
    });
    return {
        id,
        pageNumber,
        role,
        lines,
        box,
        confidence: 1,
        evidence: [],
        text,
    };
};

describe('pdfNotes', () => {
    it('classifies a small labeled bottom region as a footnote', () => {
        const result = extractPdfNotes([
            makeRegion('p1-body', 1, 'The body argument continues above.', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }, 0.02),
            makeRegion('p1-note', 1, '1. A note explains the argument.\n2. A second note gives context.', { x0: 0.1, y0: 0.74, x1: 0.9, y1: 0.9 }, 0.01),
        ]);

        expect(result.regions.find((region) => region.id === 'p1-note')?.role).toBe('footnote');
        expect(result.notes.map((note) => note.label)).toEqual(['1', '2']);
        expect(result.notes[0].text).toBe('A note explains the argument.');
    });

    it('keeps a normal bottom body paragraph in the body stream', () => {
        const result = extractPdfNotes([
            makeRegion('p1-body', 1, 'The body argument continues above.', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }, 0.02),
            makeRegion('p1-bottom-body', 1, 'The paragraph continues at the bottom without a note marker.', { x0: 0.1, y0: 0.74, x1: 0.9, y1: 0.9 }, 0.02),
        ]);

        expect(result.regions.find((region) => region.id === 'p1-bottom-body')?.role).toBe('body');
        expect(result.notes).toHaveLength(0);
    });

    it('does not turn a repeated footer or figure caption into a note', () => {
        const result = extractPdfNotes([
            makeRegion('p1-footer', 1, 'Lacan Studies 12', { x0: 0.35, y0: 0.94, x1: 0.65, y1: 0.96 }, 0.01),
            makeRegion('p2-footer', 2, 'Lacan Studies 12', { x0: 0.35, y0: 0.94, x1: 0.65, y1: 0.96 }, 0.01),
            makeRegion('p1-caption', 1, 'Figure 1. The schema of the relation.', { x0: 0.2, y0: 0.6, x1: 0.8, y1: 0.64 }, 0.01),
        ]);

        expect(result.regions.find((region) => region.id === 'p1-footer')?.role).toBe('running-furniture');
        expect(result.regions.find((region) => region.id === 'p1-caption')?.role).toBe('caption');
        expect(result.notes).toHaveLength(0);
    });

    it('retains an unlabeled continuation inside the preceding note', () => {
        const result = extractPdfNotes([
            makeRegion('p1-body', 1, 'The body argument continues above.', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }, 0.02),
            makeRegion('p1-note', 1, '1. The first paragraph of the note.\nThe note continues with another sentence.', { x0: 0.1, y0: 0.74, x1: 0.9, y1: 0.9 }, 0.01),
        ]);

        const note: PdfNoteEntry = result.notes[0];
        expect(note.label).toBe('1');
        expect(note.text).toBe('The first paragraph of the note.\nThe note continues with another sentence.');
    });

    it('links an elevated body marker to the matching note at a stable body index', () => {
        const body = makeRegion('p1-body', 1, 'Argument', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }, 0.02);
        body.lines[0].words.push({
            id: 'p1-body-marker',
            pageNumber: 1,
            text: '1',
            box: { x0: 0.3, y0: 0.09, x1: 0.31, y1: 0.1 },
            baseline: 0.1,
            direction: 'ltr',
            source: 'embedded',
        });
        body.lines[0].words.sort((left, right) => left.box.x0 - right.box.x0);
        const extracted = extractPdfNotes([
            body,
            makeRegion('p1-note', 1, '1. The matching note.', { x0: 0.1, y0: 0.74, x1: 0.9, y1: 0.9 }, 0.01),
        ]);

        const links = linkPdfNoteAnchors(extracted.regions, extracted.notes, 'chapter-1');

        expect(links.anchors).toMatchObject([{
            noteId: 'p1-note-n0',
            chapterId: 'chapter-1',
            wordIndex: 1,
            markerText: '1',
            confidence: 0.96,
        }]);
        expect(links.unresolvedCallouts).toBe(0);
    });

    it('does not link an elevated exponent-like token as a note marker', () => {
        const body = makeRegion('p1-body', 1, 'S', { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 }, 0.02);
        body.lines[0].words.push({
            id: 'p1-exponent',
            pageNumber: 1,
            text: '1',
            box: { x0: 0.2, y0: 0.09, x1: 0.21, y1: 0.1 },
            baseline: 0.1,
            direction: 'ltr',
            source: 'embedded',
        });
        const extracted = extractPdfNotes([
            body,
            makeRegion('p1-note', 1, '1. The note remains available.', { x0: 0.1, y0: 0.74, x1: 0.9, y1: 0.9 }, 0.01),
        ]);

        expect(linkPdfNoteAnchors(extracted.regions, extracted.notes).anchors).toHaveLength(0);
    });
});