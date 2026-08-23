import { describe, expect, it } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import type { TextIssueCandidate } from './anomalyScanner';
import { buildChapterRepairPlan, projectRepairChapterState, type RepairBatchSelection } from './repairBatch';

const makeSelection = async (
    sourceText: string,
    id: string,
    startOffset: number,
    endOffset: number,
    replacement: string | undefined,
    action: 'keep' | 'replace' | 'delete' = replacement === undefined ? 'keep' : 'replace',
): Promise<RepairBatchSelection> => {
    const candidate: TextIssueCandidate = {
        id,
        bookId: 'book-1',
        sourceUnitId: 'chapter-1',
        revisionHash: await fingerprintValue(sourceText),
        startOffset,
        endOffset,
        originalHash: await fingerprintValue(sourceText.slice(startOffset, endOffset)),
        detectorIds: ['numeric-alphanumeric-intrusion'],
        evidence: { value: sourceText.slice(startOffset, endOffset) },
        severity: 'medium',
        ambiguity: 'high',
    };
    return {
        candidate,
        proposal: {
            candidateId: id,
            action,
            ...(replacement !== undefined ? { replacement } : {}),
            reasonCode: 'ocr-substitution',
        },
    };
};

describe('chapter repair batch planning', () => {
    it('applies replacements against original offsets in descending order', async () => {
        const sourceText = 'A th3 and h0p are here.';
        const first = await makeSelection(sourceText, 'first', sourceText.indexOf('th3'), sourceText.indexOf('th3') + 3, 'the');
        const second = await makeSelection(sourceText, 'second', sourceText.indexOf('h0p'), sourceText.indexOf('h0p') + 3, 'hope');
        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: first.candidate.revisionHash,
            selections: [first, second],
        });

        expect(plan.valid).toBe(true);
        expect(plan.finalText).toBe('A the and hope are here.');
        expect(plan.changingPatches.map(({ candidate }) => candidate.id)).toEqual(['first', 'second']);
        expect(plan.finalTextHash).toBe(await fingerprintValue(plan.finalText));
    });

    it('keeps deletion and keep decisions separate from changing patches', async () => {
        const sourceText = 'A th3 and h0p stay.';
        const replace = await makeSelection(sourceText, 'replace', sourceText.indexOf('th3'), sourceText.indexOf('th3') + 3, 'the');
        const keep = await makeSelection(sourceText, 'keep', sourceText.indexOf('h0p'), sourceText.indexOf('h0p') + 3, undefined, 'keep');
        const deletion = await makeSelection(sourceText, 'delete', sourceText.indexOf('stay'), sourceText.indexOf('stay') + 4, undefined, 'delete');
        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: replace.candidate.revisionHash,
            selections: [replace, keep, deletion],
        });

        expect(plan.finalText).toBe('A the and h0p .');
        expect(plan.changingPatches.map(({ candidate }) => candidate.id)).toEqual(['replace', 'delete']);
        expect(plan.keepDecisions.map(({ candidate }) => candidate.id)).toEqual(['keep']);
    });

    it('accepts adjacent spans and rejects overlapping spans as a whole plan', async () => {
        const sourceText = 'th3h0p';
        const adjacentOne = await makeSelection(sourceText, 'one', 0, 3, 'the');
        const adjacentTwo = await makeSelection(sourceText, 'two', 3, 6, 'hope');
        const adjacentPlan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: adjacentOne.candidate.revisionHash,
            selections: [adjacentOne, adjacentTwo],
        });
        expect(adjacentPlan.valid).toBe(true);
        expect(adjacentPlan.finalText).toBe('thehope');

        const overlap = await makeSelection(sourceText, 'overlap', 2, 5, 'x');
        const overlapPlan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: adjacentOne.candidate.revisionHash,
            selections: [adjacentOne, overlap],
        });
        expect(overlapPlan.valid).toBe(false);
        expect(overlapPlan.errors).toContainEqual(expect.objectContaining({ code: 'overlap' }));
        expect(overlapPlan.finalText).toBe(sourceText);
    });

    it('projects canonical offsets using cumulative character deltas', async () => {
        const sourceText = 'th3 middle h0p end';
        const first = await makeSelection(sourceText, 'first', 0, 3, 'the-long');
        const secondStart = sourceText.indexOf('h0p');
        const second = await makeSelection(sourceText, 'second', secondStart, secondStart + 3, 'hope');
        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: first.candidate.revisionHash,
            selections: [first, second],
        });

        expect(plan.changingPatches.map(({ canonicalStartOffset, canonicalEndOffset }) => ({ canonicalStartOffset, canonicalEndOffset }))).toEqual([
            { canonicalStartOffset: 0, canonicalEndOffset: 8 },
            { canonicalStartOffset: secondStart + 5, canonicalEndOffset: secondStart + 9 },
        ]);
        expect(plan.finalText.slice(plan.changingPatches[1].canonicalStartOffset, plan.changingPatches[1].canonicalEndOffset)).toBe('hope');
    });

    it('rejects stale source, mixed revisions, and invalid original spans', async () => {
        const sourceText = 'A th3 text.';
        const selection = await makeSelection(sourceText, 'candidate', sourceText.indexOf('th3'), sourceText.indexOf('th3') + 3, 'the');
        const stalePlan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: 'different-revision',
            selections: [selection],
        });
        expect(stalePlan.valid).toBe(false);
        expect(stalePlan.errors.map(({ code }) => code)).toContain('stale-source');

        const wrongSpan = {
            ...selection,
            candidate: {
                ...selection.candidate,
                originalHash: await fingerprintValue('bad'),
            },
        };
        const invalidPlan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: selection.candidate.revisionHash,
            selections: [wrongSpan],
        });
        expect(invalidPlan.valid).toBe(false);
        expect(invalidPlan.errors).toContainEqual(expect.objectContaining({ code: 'invalid-proposal' }));
    });

    it('projects analysis and reader anchors once across word additions and deletions', async () => {
        const sourceText = 'one th3 three h0p five six';
        const first = await makeSelection(sourceText, 'first', sourceText.indexOf('th3'), sourceText.indexOf('th3') + 3, 'two words');
        const secondStart = sourceText.indexOf('h0p');
        const second = await makeSelection(sourceText, 'second', secondStart, secondStart + 3, undefined, 'delete');
        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-1',
            sourceRevisionHash: first.candidate.revisionHash,
            selections: [first, second],
        });
        const projection = projectRepairChapterState({
            sourceText,
            finalText: plan.finalText,
            patches: plan.changingPatches.map((patch) => ({
                sourceStartOffset: patch.candidate.startOffset,
                sourceEndOffset: patch.candidate.endOffset,
                canonicalStartOffset: patch.canonicalStartOffset,
                canonicalEndOffset: patch.canonicalEndOffset,
                replacementText: patch.replacementText,
            })),
            densities: [10, 20, 30, 40, 50, 60],
            analysisData: [0, 1, 2, 3, 4, 5].map((value) => ({ tokens: [`token-${value}`], surprisals: [value] })),
            subchapters: [{ title: 'Section', summary: 'old summary', startWordIndex: 0, endWordIndex: 6 }],
            currentWordIndex: 4,
            highlights: [{ chapterId: 'chapter-1', startWordIndex: 1, endWordIndex: 5, text: 'selected' }],
            ttsPosition: { chapterId: 'chapter-1', wordIndex: 3, sentenceIndex: 0, audioTime: 0, timestamp: 1 },
        });

        expect(projection.content).toEqual(['one', 'two', 'words', 'three', 'five', 'six']);
        expect(projection.densities).toEqual([10, 0, 0, 30, 50, 60]);
        expect(projection.analysisData.map(({ tokens }) => tokens)).toEqual([
            ['token-0'], [], [], ['token-2'], ['token-4'], ['token-5'],
        ]);
        expect(projection.subchapters[0]).toMatchObject({ startWordIndex: 0, endWordIndex: 6, summary: '' });
        expect(projection.currentWordIndex).toBe(4);
        expect(projection.highlights?.[0]).toMatchObject({ startWordIndex: 1, endWordIndex: 5 });
        expect(projection.ttsPosition).toMatchObject({ wordIndex: 4 });
    });
});