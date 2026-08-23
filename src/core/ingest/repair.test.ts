import { describe, expect, it } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import {
    buildRepairPrompt,
    createRepairContext,
    parseRepairProposal,
    validateRepairProposal,
} from './repair';
import type { TextIssueCandidate } from './anomalyScanner';

const makeCandidate = async (originalText = 'th3'): Promise<TextIssueCandidate> => ({
    id: 'chapter-1:4:7:hash',
    bookId: 'book-1',
    sourceUnitId: 'chapter-1',
    revisionHash: 'revision-1',
    startOffset: 4,
    endOffset: 7,
    originalHash: await fingerprintValue(originalText),
    detectorIds: ['numeric-alphanumeric-intrusion'],
    evidence: { value: originalText },
    severity: 'medium',
    ambiguity: 'high',
});

describe('bounded repair protocol', () => {
    it('builds bounded context while retaining exact candidate offsets', async () => {
        const text = 'A sentence before. ' + 'word '.repeat(500) + 'th3. A sentence after.';
        const candidate = await makeCandidate();
        candidate.startOffset = text.indexOf('th3');
        candidate.endOffset = candidate.startOffset + 3;
        const context = createRepairContext(text, candidate);

        expect(context.candidateText).toBe('th3');
        expect(context.context.length).toBeLessThanOrEqual(1500);
        expect(context.context).toContain('th3');
        expect(buildRepairPrompt(candidate, context)).toContain('OUTPUT ONLY THE REPLACEMENT FOR SUSPICIOUS SPAN:');
        expect(buildRepairPrompt(candidate, context)).not.toContain('candidateId');
    });

    it('accepts direct replacement text and legacy proposal objects', async () => {
        const candidate = await makeCandidate();
        expect(parseRepairProposal(JSON.stringify({
            candidateId: 'candidate-1',
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        }))).toEqual({
            candidateId: 'candidate-1',
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        });
        expect(parseRepairProposal(' the \n', candidate)).toEqual({
            candidateId: candidate.id,
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        });
        expect(parseRepairProposal('```text\nthe\n```', candidate)).toMatchObject({ action: 'replace', replacement: 'the' });
        expect(parseRepairProposal('{"candidateId":"candidate-1","action":"replace","replacement":"the","reasonCode":"uncertain","extra":true}')).toEqual({
            candidateId: 'candidate-1',
            action: 'replace',
            replacement: 'the',
            reasonCode: 'uncertain',
        });
    });

    it('validates a bounded replacement against the candidate source hash', async () => {
        const candidate = await makeCandidate();
        const result = await validateRepairProposal(candidate, 'th3', {
            candidateId: candidate.id,
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        }, 'revision-1');

        expect(result).toEqual({
            valid: true,
            proposal: {
                candidateId: candidate.id,
                action: 'replace',
                replacement: 'the',
                reasonCode: 'ocr-substitution',
            },
        });
    });

    it('rejects stale candidates and replacements that introduce anomalies', async () => {
        const candidate = await makeCandidate();
        const stale = await validateRepairProposal(candidate, 'th3', {
            candidateId: candidate.id,
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        }, 'different-revision');
        const anomalous = await validateRepairProposal(candidate, 'th3', {
            candidateId: candidate.id,
            action: 'replace',
            replacement: 'th4',
            reasonCode: 'ocr-substitution',
        });

        expect(stale).toMatchObject({ valid: false, reason: 'candidate revision is stale' });
        expect(anomalous).toMatchObject({ valid: false, reason: 'replacement introduces a new deterministic anomaly' });
    });
});
