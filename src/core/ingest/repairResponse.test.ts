import { describe, expect, it } from 'vitest';
import {
    buildRepairPrompt,
    parseRepairResponse,
    RepairResponseError,
    REPAIR_RESPONSE_CONTRACT_VERSION,
    REPAIR_SYSTEM_PROMPT,
} from './repairResponse';

const candidate = {
    id: 'chapter-1:4:7:hash',
    detectorIds: ['numeric-lone-fragment'],
};

const options = {
    candidate,
    candidateText: '.1',
    leftContext: 'social theory',
    rightContext: 'Likewise, in social theory the fragment is suspicious.',
};

const expectFailure = (response: string, code: RepairResponseError['code']) => {
    try {
        parseRepairResponse(response, options);
        throw new Error('expected parser to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(RepairResponseError);
        expect((error as RepairResponseError).code).toBe(code);
    }
};

describe('repair response contract', () => {
    it.each([
        ['the', 'the'],
        ['  the\r\n', 'the'],
        ['```text\nthe\n```', 'the'],
        ['Replacement: the', 'the'],
        ['Corrected text: the', 'the'],
        ['"the"', 'the'],
        ['{"replacement":"the","extra":"ignored"}', 'the'],
        ['{"correctedText":"the"}', 'the'],
        ['{"corrected_text":"the"}', 'the'],
    ])('parses %j as direct replacement %j', (response, replacement) => {
        expect(parseRepairResponse(response, options)).toEqual({
            candidateId: candidate.id,
            action: 'replace',
            replacement,
            reasonCode: 'ocr-substitution',
        });
    });

    it('derives keep and delete without asking the model for metadata', () => {
        expect(parseRepairResponse('<KEEP>', options)).toEqual({
            candidateId: candidate.id,
            action: 'keep',
            reasonCode: 'ocr-substitution',
        });
        expect(parseRepairResponse('<DELETE>', options)).toEqual({
            candidateId: candidate.id,
            action: 'delete',
            reasonCode: 'ocr-substitution',
        });
        expect(parseRepairResponse('.1', options)).toEqual({
            candidateId: candidate.id,
            action: 'keep',
            reasonCode: 'ocr-substitution',
        });
    });

    it('accepts one legacy JSON object inside short surrounding prose', () => {
        expect(parseRepairResponse(
            'The answer is:\n```json\n{"candidateId":"chapter-1:4:7:hash","action":"replace","replacement":"the","reasonCode":"ocr-substitution","newField":true}\n```',
            options,
        )).toMatchObject({
            candidateId: candidate.id,
            action: 'replace',
            replacement: 'the',
            reasonCode: 'ocr-substitution',
        });
    });

    it.each([
        ['   ', 'empty-response'],
        ['```text\nthe\n```\n```text\nword\n```', 'multiple-fenced-blocks'],
        ['```text\nthe', 'invalid-fenced-block'],
        ['{"replacement":"the"} {"replacement":"word"}', 'multiple-json-objects'],
        ['{}', 'invalid-legacy-proposal'],
        ['{"candidateId":"other","replacement":"the"}', 'mismatched-candidate'],
        ['', 'empty-response'],
        ['<div>the</div>', 'forbidden-content'],
        ['the\u0007', 'forbidden-content'],
        ['Likewise, in social theory the fragment is suspicious.', 'context-echo'],
        ['x'.repeat(257), 'replacement-too-long'],
    ] as const)('rejects unsafe or ambiguous response %j with %s', (response, code) => {
        expectFailure(response, code);
    });

    it('keeps the prompt bounded and focused on replacement text', () => {
        const prompt = buildRepairPrompt(
            { detectorIds: candidate.detectorIds, evidence: { value: '.1' } },
            {
                candidateText: '.1',
                context: 'social theory. .1 Likewise, in social theory the fragment is suspicious.',
                contextStartOffset: 0,
                startOffset: 15,
                endOffset: 17,
            },
        );
        expect(prompt).toContain(REPAIR_RESPONSE_CONTRACT_VERSION);
        expect(prompt).toContain(REPAIR_SYSTEM_PROMPT);
        expect(prompt).toContain('LEFT CONTEXT:');
        expect(prompt).toContain('RIGHT CONTEXT:');
        expect(prompt).toContain('SUSPICIOUS SPAN:');
        expect(prompt).toContain('.1');
        expect(prompt).not.toContain('candidateId');
        expect(prompt).not.toContain('exactly one JSON object');
        expect(prompt.match(/\.1/g)).toHaveLength(2);
    });
});