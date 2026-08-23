import type { TextIssueCandidate } from './anomalyScanner';
import type {
    RepairAction,
    RepairProposal,
    RepairReasonCode,
    RepairContext,
} from './repair';

export const REPAIR_RESPONSE_CONTRACT_VERSION = 'repair-response-v2';
export const MAX_REPAIR_RESPONSE_LENGTH = 4096;
export const MAX_REPLACEMENT_LENGTH = 256;

export const REPAIR_SYSTEM_PROMPT = [
    'Repair only the text inside SUSPICIOUS SPAN.',
    'Return only its exact replacement text.',
    'Do not return JSON, Markdown, quotes, labels, explanation, or surrounding text.',
    'If it is already correct, return exactly <KEEP>.',
    'If it should be removed, return exactly <DELETE>.',
].join(' ');

export type RepairResponseFailureCode =
    | 'response-too-large'
    | 'empty-response'
    | 'candidate-context-required'
    | 'multiple-fenced-blocks'
    | 'invalid-fenced-block'
    | 'multiple-json-objects'
    | 'unsupported-json'
    | 'invalid-legacy-proposal'
    | 'mismatched-candidate'
    | 'empty-replacement'
    | 'context-echo'
    | 'replacement-too-long'
    | 'forbidden-content';

export class RepairResponseError extends Error {
    public readonly code: RepairResponseFailureCode;

    constructor(code: RepairResponseFailureCode, message: string) {
        super(message);
        this.name = 'RepairResponseError';
        this.code = code;
    }
}

export interface RepairResponseOptions {
    candidate?: Pick<TextIssueCandidate, 'id' | 'detectorIds'>;
    candidateText?: string;
    leftContext?: string;
    rightContext?: string;
}

const REPAIR_REASON_CODES = new Set<RepairReasonCode>([
    'encoding-artifact',
    'ocr-substitution',
    'stray-page-marker',
    'broken-boundary',
    'punctuation-artifact',
    'consistent-book-form',
    'uncertain',
]);
const REPAIR_ACTIONS = new Set<RepairAction>(['keep', 'replace', 'delete', 'merge', 'split']);
const MARKUP_RESIDUE = /<\/?[A-Za-z][^>]*>|&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9A-F]+);/i;

const containsControlCharacters = (value: string): boolean => [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0 && codePoint <= 8)
        || codePoint === 11
        || codePoint === 12
        || (codePoint >= 14 && codePoint <= 31)
        || codePoint === 127;
});

const fail = (code: RepairResponseFailureCode, message: string): never => {
    throw new RepairResponseError(code, message);
};

const deriveReasonCode = (detectorIds: string[]): RepairReasonCode => {
    const families = new Set<RepairReasonCode>();
    for (const detectorId of detectorIds.flatMap((value) => value.split(','))) {
        if (detectorId.startsWith('encoding-') || detectorId === 'markup-residue') families.add('encoding-artifact');
        else if (detectorId.startsWith('numeric-')) families.add('ocr-substitution');
        else if (detectorId.startsWith('repeated-page-marker')) families.add('stray-page-marker');
        else if (detectorId.startsWith('word-boundary-')) families.add('broken-boundary');
        else if (detectorId.startsWith('punctuation-')) families.add('punctuation-artifact');
        else families.add('uncertain');
    }
    return families.size === 1 ? [...families][0] : 'uncertain';
};

const candidateIdFor = (candidate: RepairResponseOptions['candidate'], legacyCandidateId?: unknown): string => {
    if (candidate?.id) return candidate.id;
    if (typeof legacyCandidateId === 'string' && legacyCandidateId.length > 0) return legacyCandidateId;
    return fail('candidate-context-required', 'Direct repair responses require the candidate context.');
};

const ensureCandidateId = (candidate: RepairResponseOptions['candidate'], legacyCandidateId: unknown): string => {
    const candidateId = candidateIdFor(candidate, legacyCandidateId);
    if (candidate?.id && legacyCandidateId !== undefined && legacyCandidateId !== candidate.id) {
        fail('mismatched-candidate', 'Repair response candidate ID does not match the requested candidate.');
    }
    return candidateId;
};

const makeDirectProposal = (replacement: string, options: RepairResponseOptions): RepairProposal => {
    const candidate = options.candidate;
    if (!candidate) throw new RepairResponseError('candidate-context-required', 'Direct repair responses require the candidate context.');
    const normalized = replacement.trim();
    if (!normalized) fail('empty-replacement', 'Repair response is empty; use <DELETE> to remove the span.');
    if (normalized === '<KEEP>') {
        return {
            candidateId: candidate.id,
            action: 'keep',
            reasonCode: deriveReasonCode(candidate.detectorIds),
        };
    }
    if (normalized === '<DELETE>') {
        return {
            candidateId: candidate.id,
            action: 'delete',
            reasonCode: deriveReasonCode(candidate.detectorIds),
        };
    }
    if (normalized.length > MAX_REPLACEMENT_LENGTH) {
        fail('replacement-too-long', 'Repair replacement exceeds the bounded repair size.');
    }
    if (containsControlCharacters(normalized) || MARKUP_RESIDUE.test(normalized)) {
        fail('forbidden-content', 'Repair replacement contains control characters or markup residue.');
    }
    const context = `${options.leftContext || ''}\n${options.rightContext || ''}`.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const responseText = normalized.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (responseText.length >= 24 && context.includes(responseText)) {
        fail('context-echo', 'Repair response echoes surrounding context instead of replacing the suspicious span.');
    }
    return {
        candidateId: candidate.id,
        action: normalized === options.candidateText?.trim() ? 'keep' : 'replace',
        ...(normalized === options.candidateText?.trim() ? {} : { replacement: normalized }),
        reasonCode: deriveReasonCode(candidate.detectorIds),
    };
};

const findJsonObjects = (value: string): unknown[] => {
    const objects: unknown[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (character === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                try {
                    objects.push(JSON.parse(value.slice(start, index + 1)) as unknown);
                } catch {
                    // A brace pair in prose is not a legacy JSON response.
                }
                start = -1;
            }
        }
    }
    return objects;
};

const stripOneFence = (value: string): string => {
    const matches = [...value.matchAll(/```[^\n]*\n?([\s\S]*?)\n?```/g)];
    if (matches.length > 1) fail('multiple-fenced-blocks', 'Repair response contains multiple fenced blocks.');
    if (matches.length === 1) return matches[0][1].trim();
    if (value.includes('```')) fail('invalid-fenced-block', 'Repair response contains an incomplete Markdown fence.');
    return value;
};

const stripKnownLabel = (value: string): string => value.replace(
    /^(?:replacement|corrected(?:\s+text)?|answer)\s*:\s*/i,
    '',
).trim();

const parseLegacyObject = (value: Record<string, unknown>, options: RepairResponseOptions): RepairProposal => {
    const knownKeys = ['candidateId', 'action', 'replacement', 'correctedText', 'corrected_text', 'reasonCode'];
    if (!knownKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
        fail('invalid-legacy-proposal', 'Repair response does not contain a supported proposal.');
    }
    const candidateId = ensureCandidateId(options.candidate, value.candidateId);
    const replacementKeys = ['replacement', 'correctedText', 'corrected_text']
        .filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    if (replacementKeys.length > 1) fail('invalid-legacy-proposal', 'Repair response contains multiple replacement fields.');
    const replacementValue = replacementKeys.length === 1 ? value[replacementKeys[0]] : undefined;
    if (replacementValue !== undefined && replacementValue !== null && typeof replacementValue !== 'string') {
        fail('invalid-legacy-proposal', 'Repair replacement must be a string.');
    }
    const actionValue = value.action;
    const action = actionValue === undefined
        ? replacementValue === undefined || replacementValue === null ? 'keep' : 'replace'
        : actionValue;
    if (typeof action !== 'string' || !REPAIR_ACTIONS.has(action as RepairAction)) {
        fail('invalid-legacy-proposal', 'Repair response contains an unsupported action.');
    }
    const reasonCode = value.reasonCode === undefined
        ? deriveReasonCode(options.candidate?.detectorIds || [])
        : value.reasonCode;
    if (typeof reasonCode !== 'string' || !REPAIR_REASON_CODES.has(reasonCode as RepairReasonCode)) {
        fail('invalid-legacy-proposal', 'Repair response contains an unsupported reason code.');
    }
    if ((action === 'keep' || action === 'delete') && replacementValue !== undefined && replacementValue !== null) {
        fail('invalid-legacy-proposal', `${action} cannot include replacement text.`);
    }
    if (action !== 'keep' && action !== 'delete' && typeof replacementValue !== 'string') {
        fail('invalid-legacy-proposal', `${action} requires replacement text.`);
    }
    return {
        candidateId,
        action: action as RepairAction,
        ...(typeof replacementValue === 'string' ? { replacement: replacementValue } : {}),
        reasonCode: reasonCode as RepairReasonCode,
    };
};

const parseJsonValue = (value: string, options: RepairResponseOptions): RepairProposal | null => {
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'string') return makeDirectProposal(parsed, options);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parseLegacyObject(parsed as Record<string, unknown>, options);
        }
        if (parsed !== undefined) fail('unsupported-json', 'Repair response JSON must be a string or proposal object.');
    } catch (error) {
        if (error instanceof RepairResponseError) throw error;
    }
    return null;
};

export const parseRepairResponse = (response: string, options: RepairResponseOptions = {}): RepairProposal => {
    if (response.length > MAX_REPAIR_RESPONSE_LENGTH) {
        fail('response-too-large', 'Repair response exceeds the transport size limit.');
    }
    const normalized = response.replace(/\r\n?/g, '\n').trim();
    if (!normalized) fail('empty-response', 'Repair model returned an empty response.');
    if (normalized === '<KEEP>' || normalized === '<DELETE>') return makeDirectProposal(normalized, options);

    const fenced = stripOneFence(normalized);
    const directJson = parseJsonValue(fenced, options);
    if (directJson) return directJson;

    const objects = findJsonObjects(fenced);
    if (objects.length > 1) fail('multiple-json-objects', 'Repair response contains multiple JSON objects.');
    if (objects.length === 1) {
        const object = objects[0];
        if (!object || typeof object !== 'object' || Array.isArray(object)) {
            fail('unsupported-json', 'Repair response contains unsupported JSON.');
        }
        return parseLegacyObject(object as Record<string, unknown>, options);
    }

    const labeled = stripKnownLabel(fenced);
    return makeDirectProposal(labeled, options);
};

export const buildRepairPrompt = (
    candidate: Pick<TextIssueCandidate, 'detectorIds' | 'evidence'>,
    repairContext: Pick<RepairContext, 'candidateText' | 'context' | 'contextStartOffset' | 'startOffset' | 'endOffset'>,
): string => {
    const leftContext = repairContext.context.slice(0, repairContext.startOffset - repairContext.contextStartOffset);
    const rightContext = repairContext.context.slice(repairContext.endOffset - repairContext.contextStartOffset);
    return [
        `RESPONSE CONTRACT: ${REPAIR_RESPONSE_CONTRACT_VERSION}`,
        REPAIR_SYSTEM_PROMPT,
        `DETECTOR: ${candidate.detectorIds.join(', ')}`,
        `EVIDENCE: ${JSON.stringify(candidate.evidence)}`,
        '',
        'LEFT CONTEXT:',
        leftContext,
        '',
        'SUSPICIOUS SPAN:',
        repairContext.candidateText,
        '',
        'RIGHT CONTEXT:',
        rightContext,
        '',
        'OUTPUT ONLY THE REPLACEMENT FOR SUSPICIOUS SPAN:',
    ].join('\n');
};

export const buildRepairRetryPrompt = (
    candidate: Pick<TextIssueCandidate, 'detectorIds' | 'evidence'>,
    repairContext: Pick<RepairContext, 'candidateText' | 'context' | 'contextStartOffset' | 'startOffset' | 'endOffset'>,
    failureMessage: string,
): string => [
    `RESPONSE CONTRACT: ${REPAIR_RESPONSE_CONTRACT_VERSION}`,
    REPAIR_SYSTEM_PROMPT,
    `DETECTOR: ${candidate.detectorIds.join(', ')}`,
    `EVIDENCE: ${JSON.stringify(candidate.evidence)}`,
    `PREVIOUS FORMAT FAILURE: ${failureMessage.slice(0, 240)}`,
    `SUSPICIOUS SPAN: ${repairContext.candidateText}`,
    'OUTPUT ONLY THE REPLACEMENT OR THE EXACT SENTINEL <KEEP> OR <DELETE>.',
].join('\n');