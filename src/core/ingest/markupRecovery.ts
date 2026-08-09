export type MalformedMarkupKind =
    | 'invalid-pseudo-tag'
    | 'synthetic-empty-element'
    | 'known-tag-collision'
    | 'ambiguous-markup';

export type MarkupRecoveryAction = 'repair' | 'abstain';

export interface MarkupRecoveryRecord {
    kind: MalformedMarkupKind;
    action: MarkupRecoveryAction;
    confidence: number;
    startOffset: number;
    endOffset: number;
    recoveredTokenCount: number;
    rawSample: string;
    recoveredSample: string;
    reason: string;
    protectedContext?: string;
}

export interface MarkupRecoveryResult {
    html: string;
    records: MarkupRecoveryRecord[];
    recoveredTokenCount: number;
    recoveredCharacterCount: number;
    unresolvedCandidateCount: number;
}

export const MARKUP_RECOVERY_THRESHOLDS = {
    minimumAttributeCount: 4,
    highConfidenceAttributeCount: 8,
    highConfidenceLexicalRatio: 0.75,
    highConfidenceRecognizedAttributeRatio: 0.25,
    highConfidenceEmptyValueRatio: 1,
    diagnosticSampleLength: 240,
} as const;

interface AttributeOccurrence {
    name: string;
    valueKind: 'absent' | 'empty' | 'non-empty';
}

interface ScannedTag {
    endOffset: number;
    head: string;
    attributes: AttributeOccurrence[];
    isClosing: boolean;
    isSelfClosing: boolean;
    isTerminated: boolean;
    hasUnterminatedQuote: boolean;
}

interface CandidateSignals {
    lexicalRatio: number;
    recognizedRatio: number;
    emptyValueRatio: number;
    punctuationSignal: boolean;
    surroundingTextSignal: boolean;
    invalidHead: boolean;
    knownTag: boolean;
    protectedContext?: string;
}

interface Candidate {
    startOffset: number;
    tag: ScannedTag;
    signals: CandidateSignals;
    readerFacing: boolean;
    rawValue: string;
}

const KNOWN_TAGS = new Set([
    'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'blockquote', 'body', 'br', 'button',
    'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn',
    'dialog', 'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1',
    'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
    'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta',
    'meter', 'nav', 'noscript', 'object', 'ol', 'option', 'p', 'picture', 'pre', 'progress', 'q',
    'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span',
    'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea',
    'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
    'svg', 'math', 'annotation', 'foreignobject',
]);

const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
    'track', 'wbr',
]);

const RECOGNIZED_ATTRIBUTES = new Set([
    'abbr', 'accept', 'accept-charset', 'accesskey', 'action', 'align', 'alt', 'async', 'autocapitalize',
    'autocomplete', 'autofocus', 'autoplay', 'charset', 'checked', 'cite', 'class', 'cols', 'colspan',
    'content', 'contenteditable', 'controls', 'coords', 'crossorigin', 'datetime', 'decoding', 'default',
    'defer', 'dir', 'dirname', 'disabled', 'download', 'draggable', 'enctype', 'for', 'form', 'formaction',
    'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'headers', 'height', 'hidden', 'high',
    'href', 'hreflang', 'id', 'inert', 'inputmode', 'ismap', 'kind', 'label', 'lang', 'list', 'loading',
    'loop', 'low', 'max', 'maxlength', 'media', 'method', 'min', 'multiple', 'muted', 'name', 'nonce',
    'novalidate', 'open', 'optimum', 'pattern', 'ping', 'placeholder', 'playsinline', 'poster', 'preload',
    'readonly', 'referrerpolicy', 'rel', 'required', 'reversed', 'role', 'rows', 'rowspan', 'sandbox',
    'scope', 'selected', 'shape', 'size', 'sizes', 'slot', 'span', 'spellcheck', 'src', 'srcdoc', 'srclang',
    'srcset', 'start', 'step', 'style', 'tabindex', 'target', 'title', 'translate', 'type', 'usemap',
    'value', 'width', 'wrap', 'xmlns', 'xmlns:xlink', 'xlink:actuate', 'xlink:arcrole', 'xlink:href',
    'xlink:role', 'xlink:show', 'xlink:title', 'xlink:type', 'xml:base', 'xml:lang', 'xml:space',
]);

const RAW_TEXT_CONTEXTS = new Set(['script', 'style', 'noscript']);
const PROTECTED_CONTEXTS = new Set(['pre', 'code']);
const EXCLUDED_CONTEXTS = new Set(['script', 'style', 'noscript', 'svg', 'math']);

const isWhitespace = (character: string): boolean => /\s/u.test(character);

const skipWhitespace = (value: string, startOffset: number, endOffset: number): number => {
    let offset = startOffset;
    while (offset < endOffset && isWhitespace(value[offset])) offset += 1;
    return offset;
};

const isNameTerminator = (character: string): boolean => isWhitespace(character)
    || character === '='
    || character === '/'
    || character === '>';

const findTagEnd = (value: string, startOffset: number): { endOffset: number; hasUnterminatedQuote: boolean } => {
    let quote = '';
    let expectingValueQuote = false;
    for (let offset = startOffset; offset < value.length; offset += 1) {
        const character = value[offset];
        if (quote) {
            if (character === quote) quote = '';
            continue;
        }
        if (character === '=') {
            expectingValueQuote = true;
            continue;
        }
        if (expectingValueQuote && isWhitespace(character)) continue;
        if (expectingValueQuote && (character === '"' || character === "'")) {
            quote = character;
            expectingValueQuote = false;
            continue;
        }
        expectingValueQuote = false;
        if (character === '>') {
            return { endOffset: offset + 1, hasUnterminatedQuote: false };
        }
    }
    return { endOffset: value.length, hasUnterminatedQuote: Boolean(quote) };
};

const scanTag = (value: string, startOffset: number): ScannedTag | null => {
    let offset = startOffset + 1;
    const isClosing = value[offset] === '/';
    if (isClosing) offset += 1;
    if (value[offset] === '!' || value[offset] === '?') return null;

    const headStart = offset;
    while (offset < value.length && !isNameTerminator(value[offset])) offset += 1;
    if (offset === headStart) return null;

    const head = value.slice(headStart, offset);
    const tagEnd = findTagEnd(value, offset);
    const attributeEnd = tagEnd.endOffset - (tagEnd.endOffset > 0 && value[tagEnd.endOffset - 1] === '>' ? 1 : 0);
    const attributes: AttributeOccurrence[] = [];
    let isSelfClosing = false;

    if (!isClosing) {
        while (offset < attributeEnd) {
            offset = skipWhitespace(value, offset, attributeEnd);
            if (offset >= attributeEnd) break;
            if (value[offset] === '/') {
                isSelfClosing = true;
                offset += 1;
                continue;
            }
            if (value[offset] === '>') break;

            const nameStart = offset;
            while (offset < attributeEnd && !isNameTerminator(value[offset])) offset += 1;
            if (offset === nameStart) {
                offset += 1;
                continue;
            }

            const name = value.slice(nameStart, offset);
            offset = skipWhitespace(value, offset, attributeEnd);
            let valueKind: AttributeOccurrence['valueKind'] = 'absent';
            if (value[offset] === '=') {
                offset = skipWhitespace(value, offset + 1, attributeEnd);
                if (offset < attributeEnd && (value[offset] === '"' || value[offset] === "'")) {
                    const quote = value[offset];
                    const valueStart = offset + 1;
                    offset = value.indexOf(quote, valueStart);
                    if (offset < 0 || offset >= attributeEnd) {
                        return {
                            endOffset: tagEnd.endOffset,
                            head,
                            attributes: [...attributes, { name, valueKind: 'non-empty' }],
                            isClosing,
                            isSelfClosing,
                            isTerminated: tagEnd.endOffset <= value.length && value[tagEnd.endOffset - 1] === '>',
                            hasUnterminatedQuote: true,
                        };
                    }
                    valueKind = offset === valueStart ? 'empty' : 'non-empty';
                    offset += 1;
                } else {
                    const valueStart = offset;
                    while (offset < attributeEnd && !isWhitespace(value[offset]) && value[offset] !== '>') offset += 1;
                    valueKind = offset === valueStart ? 'empty' : 'non-empty';
                }
            }
            attributes.push({ name, valueKind });
        }
    }

    if (!isClosing && tagEnd.endOffset > 0) {
        isSelfClosing ||= value.slice(Math.max(headStart, tagEnd.endOffset - 3), tagEnd.endOffset).replace(/\s/g, '') === '/>';
    }

    return {
        endOffset: tagEnd.endOffset,
        head,
        attributes,
        isClosing,
        isSelfClosing,
        isTerminated: tagEnd.endOffset <= value.length && value[tagEnd.endOffset - 1] === '>',
        hasUnterminatedQuote: tagEnd.hasUnterminatedQuote,
    };
};

const isValidTagHead = (head: string): boolean => /^[A-Za-z][A-Za-z0-9_.:-]*$/u.test(head);

const isRecognizedAttribute = (name: string): boolean => {
    const normalized = name.toLocaleLowerCase();
    return RECOGNIZED_ATTRIBUTES.has(normalized)
        || normalized.startsWith('aria-')
        || normalized.startsWith('data-')
        || normalized.startsWith('on')
        || normalized.startsWith('bind:')
        || normalized.startsWith('v-')
        || normalized.startsWith(':');
};

const isLexicalName = (name: string): boolean => /[\p{L}\p{N}]/u.test(name);

const getProtectedContext = (stack: string[]): string | undefined => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (PROTECTED_CONTEXTS.has(stack[index])) return stack[index];
    }
    return undefined;
};

const isExcludedContext = (stack: string[]): boolean => stack.some((name) => EXCLUDED_CONTEXTS.has(name));

const hasReaderFacingBody = (stack: string[], hasBodyElement: boolean): boolean => (
    stack.includes('body') || (!hasBodyElement && !stack.includes('head'))
);

const hasSurroundingTextSignal = (value: string, startOffset: number, endOffset: number): boolean => {
    const before = value[startOffset - 1] || '';
    const after = value[endOffset] || '';
    return before === '>'
        || after === '<'
        || /[\p{L}\p{N}]/u.test(before)
        || /[\p{L}\p{N}]/u.test(after);
};

const getCandidateSignals = (
    value: string,
    startOffset: number,
    tag: ScannedTag,
    stack: string[],
): CandidateSignals => {
    const lexicalNames = tag.attributes.filter((attribute) => isLexicalName(attribute.name));
    const recognizedNames = tag.attributes.filter((attribute) => isRecognizedAttribute(attribute.name));
    const emptyValues = tag.attributes.filter((attribute) => attribute.valueKind !== 'non-empty');
    const headLower = tag.head.toLocaleLowerCase();
    return {
        lexicalRatio: lexicalNames.length / Math.max(1, tag.attributes.length),
        recognizedRatio: recognizedNames.length / Math.max(1, tag.attributes.length),
        emptyValueRatio: emptyValues.length / Math.max(1, tag.attributes.length),
        punctuationSignal: tag.attributes.some((attribute) => /[.,;:]/u.test(attribute.name)),
        surroundingTextSignal: hasSurroundingTextSignal(value, startOffset, tag.endOffset),
        invalidHead: !isValidTagHead(tag.head),
        knownTag: KNOWN_TAGS.has(headLower),
        protectedContext: getProtectedContext(stack),
    };
};

const isCandidateLike = (candidate: Candidate): boolean => {
    const { tag, signals } = candidate;
    if (!candidate.readerFacing || tag.attributes.length < MARKUP_RECOVERY_THRESHOLDS.minimumAttributeCount) return false;
    if (signals.lexicalRatio < MARKUP_RECOVERY_THRESHOLDS.highConfidenceLexicalRatio) return false;
    if (signals.recognizedRatio > 0.5) return false;
    if (!tag.isSelfClosing && !signals.invalidHead && !tag.hasUnterminatedQuote) return false;
    return signals.invalidHead
        || signals.punctuationSignal
        || signals.surroundingTextSignal
        || tag.attributes.length >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceAttributeCount;
};

const isHighConfidenceCandidate = (candidate: Candidate): boolean => {
    const { tag, signals } = candidate;
    return tag.isTerminated
        && tag.isSelfClosing
        && !tag.hasUnterminatedQuote
        && tag.attributes.length >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceAttributeCount
        && signals.lexicalRatio >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceLexicalRatio
        && signals.recognizedRatio <= MARKUP_RECOVERY_THRESHOLDS.highConfidenceRecognizedAttributeRatio
        && signals.emptyValueRatio >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceEmptyValueRatio
        && !signals.protectedContext;
};

const classifyKind = (signals: CandidateSignals, action: MarkupRecoveryAction): MalformedMarkupKind => {
    if (action === 'abstain') return 'ambiguous-markup';
    if (signals.invalidHead) return 'invalid-pseudo-tag';
    if (signals.knownTag) return 'known-tag-collision';
    return 'synthetic-empty-element';
};

const getConfidence = (candidate: Candidate): number => {
    const { tag, signals } = candidate;
    let confidence = 0.3;
    if (tag.attributes.length >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceAttributeCount) confidence += 0.2;
    if (signals.lexicalRatio >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceLexicalRatio) confidence += 0.15;
    if (signals.recognizedRatio <= MARKUP_RECOVERY_THRESHOLDS.highConfidenceRecognizedAttributeRatio) confidence += 0.15;
    if (signals.emptyValueRatio >= MARKUP_RECOVERY_THRESHOLDS.highConfidenceEmptyValueRatio) confidence += 0.1;
    if (signals.punctuationSignal) confidence += 0.04;
    if (signals.surroundingTextSignal) confidence += 0.03;
    if (tag.isSelfClosing) confidence += 0.03;
    if (signals.invalidHead) confidence += 0.05;
    return Math.min(0.99, Number(confidence.toFixed(2)));
};

const escapeText = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const compactSample = (value: string): string => value
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MARKUP_RECOVERY_THRESHOLDS.diagnosticSampleLength);

const getReason = (candidate: Candidate, action: MarkupRecoveryAction): string => {
    const { tag, signals } = candidate;
    if (signals.protectedContext) return `Candidate is inside authored ${signals.protectedContext} literal context`;
    if (!tag.isTerminated || tag.hasUnterminatedQuote) return 'Candidate boundary or quoted value is unterminated';
    if (tag.attributes.some((attribute) => attribute.valueKind === 'non-empty')) return 'Candidate mixes prose-like names with meaningful attribute values';
    if (action === 'repair') {
        if (signals.invalidHead) return 'Invalid tag head with a long empty-attribute prose run';
        if (signals.knownTag) return 'Known tag head with enough independent evidence of swallowed prose';
        return 'Long empty-attribute run is more consistent with serialized prose than authored markup';
    }
    return 'Candidate has prose-like attribute evidence but does not meet the automatic repair threshold';
};

const buildRecord = (candidate: Candidate): MarkupRecoveryRecord => {
    const tokens = [candidate.tag.head, ...candidate.tag.attributes.map((attribute) => attribute.name)];
    const recoveredSample = tokens.join(' ');
    const action: MarkupRecoveryAction = isHighConfidenceCandidate(candidate) ? 'repair' : 'abstain';
    return {
        kind: classifyKind(candidate.signals, action),
        action,
        confidence: getConfidence(candidate),
        startOffset: candidate.startOffset,
        endOffset: candidate.tag.endOffset,
        recoveredTokenCount: tokens.length,
        rawSample: compactSample(candidate.rawValue || ''),
        recoveredSample: compactSample(recoveredSample),
        reason: getReason(candidate, action),
        protectedContext: candidate.signals.protectedContext,
    };
};

const updateStack = (stack: string[], tag: ScannedTag): void => {
    const normalizedHead = tag.head.toLocaleLowerCase();
    if (tag.isClosing) {
        const matchingIndex = stack.lastIndexOf(normalizedHead);
        if (matchingIndex >= 0) stack.splice(matchingIndex);
        return;
    }
    if (!tag.isSelfClosing && !VOID_TAGS.has(normalizedHead)) stack.push(normalizedHead);
};

export const recoverMalformedProseMarkup = (rawHtml: string): MarkupRecoveryResult => {
    const hasBodyElement = /<body(?:\s|>)/iu.test(rawHtml);
    const stack: string[] = [];
    const candidates: Candidate[] = [];
    let offset = 0;

    while (offset < rawHtml.length) {
        const openingOffset = rawHtml.indexOf('<', offset);
        if (openingOffset < 0) break;
        offset = openingOffset;

        const rawContext = stack.at(-1);
        if (rawContext && RAW_TEXT_CONTEXTS.has(rawContext)) {
            const closingPattern = new RegExp(`^<\\/\\s*${rawContext}\\b`, 'iu');
            if (!closingPattern.test(rawHtml.slice(offset))) {
                const closingOffset = rawHtml.toLocaleLowerCase().indexOf(`</${rawContext}`, offset + 1);
                if (closingOffset < 0) break;
                offset = closingOffset;
            }
        }

        if (rawHtml.startsWith('<!--', offset)) {
            const commentEnd = rawHtml.indexOf('-->', offset + 4);
            offset = commentEnd < 0 ? rawHtml.length : commentEnd + 3;
            continue;
        }
        if (rawHtml.startsWith('<![CDATA[', offset)) {
            const cdataEnd = rawHtml.indexOf(']]>', offset + 9);
            offset = cdataEnd < 0 ? rawHtml.length : cdataEnd + 3;
            continue;
        }
        if (rawHtml.startsWith('<?', offset)) {
            const processingEnd = rawHtml.indexOf('?>', offset + 2);
            offset = processingEnd < 0 ? rawHtml.length : processingEnd + 2;
            continue;
        }
        if (rawHtml.startsWith('<!', offset)) {
            const declarationEnd = findTagEnd(rawHtml, offset + 2).endOffset;
            offset = declarationEnd;
            continue;
        }

        const tag = scanTag(rawHtml, offset);
        if (!tag) {
            offset += 1;
            continue;
        }

        const readerFacing = hasReaderFacingBody(stack, hasBodyElement);
        const signals = getCandidateSignals(rawHtml, offset, tag, stack);
        const candidate = {
            startOffset: offset,
            tag,
            signals,
            readerFacing,
            rawValue: rawHtml.slice(offset, tag.endOffset),
        };
        if (!tag.isClosing && !isExcludedContext(stack) && isCandidateLike(candidate)) {
            candidates.push(candidate);
        }

        updateStack(stack, tag);
        offset = Math.max(offset + 1, tag.endOffset);
    }

    const records: MarkupRecoveryRecord[] = candidates.map((candidate) => buildRecord(candidate));
    const repairs = candidates
        .map((candidate, index) => ({ candidate, record: records[index] }))
        .filter(({ record }) => record.action === 'repair')
        .sort((left, right) => right.candidate.startOffset - left.candidate.startOffset);
    let html = rawHtml;
    for (const { candidate } of repairs) {
        const recoveredText = [candidate.tag.head, ...candidate.tag.attributes.map((attribute) => attribute.name)].join(' ');
        html = `${html.slice(0, candidate.startOffset)}${escapeText(recoveredText)}${html.slice(candidate.tag.endOffset)}`;
    }

    const repairedRecords = records.filter((record) => record.action === 'repair');
    return {
        html,
        records,
        recoveredTokenCount: repairedRecords.reduce((total, record) => total + record.recoveredTokenCount, 0),
        recoveredCharacterCount: repairs.reduce((total, { candidate }) => total + [
            candidate.tag.head,
            ...candidate.tag.attributes.map((attribute) => attribute.name),
        ].join(' ').length, 0),
        unresolvedCandidateCount: records.filter((record) => record.action === 'abstain').length,
    };
};