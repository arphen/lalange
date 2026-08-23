import { fingerprintValue } from '../exchange/fingerprint';
import { localAIBroker } from '../ai/broker';
import type { ModelTier } from '../ai/modelManifest';
import { initDB, type ContentRevisionDocType, type RepairAnnotationDocType } from '../sync/db';
import type { TextIssueCandidate } from './anomalyScanner';
import { scanTextForAnomalies } from './anomalyScanner';

export type RepairAction = 'keep' | 'replace' | 'delete' | 'merge' | 'split';
export type RepairReasonCode =
    | 'encoding-artifact'
    | 'ocr-substitution'
    | 'stray-page-marker'
    | 'broken-boundary'
    | 'punctuation-artifact'
    | 'consistent-book-form'
    | 'uncertain';

export interface RepairProposal {
    candidateId: string;
    action: RepairAction;
    replacement?: string;
    reasonCode: RepairReasonCode;
}

export interface RepairContext {
    text: string;
    startOffset: number;
    endOffset: number;
    candidateText: string;
    contextStartOffset: number;
    contextEndOffset: number;
    context: string;
}

export interface RepairValidationResult {
    valid: boolean;
    proposal?: RepairProposal;
    reason?: string;
}

export interface AcceptedRepairResult {
    nextText: string;
    revision: ContentRevisionDocType;
    annotation: RepairAnnotationDocType;
}

export interface AnomalyScanReport {
    booksScanned: number;
    chaptersScanned: number;
    candidatesFound: number;
    circuitBroken: boolean;
}

export interface ActivatedRepairResult {
    nextText: string;
    revision: ContentRevisionDocType;
    annotation: RepairAnnotationDocType;
}

const MAX_CONTEXT_LENGTH = 1500;
const MAX_REPLACEMENT_LENGTH = 256;
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
const SCAN_PIPELINE_VERSION = 'deterministic-anomaly-scan-v1';

const containsControlCharacters = (value: string): boolean => [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0 && codePoint <= 8)
        || codePoint === 11
        || codePoint === 12
        || (codePoint >= 14 && codePoint <= 31)
        || codePoint === 127;
});

const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const remapWordIndex = (
    wordIndex: number,
    oldStartWordIndex: number,
    oldEndWordIndex: number,
    replacementWordCount: number,
): number => {
    if (wordIndex <= oldStartWordIndex) return wordIndex;
    if (wordIndex >= oldEndWordIndex) {
        return wordIndex + replacementWordCount - (oldEndWordIndex - oldStartWordIndex);
    }
    return oldStartWordIndex + replacementWordCount;
};

const scanBook = async (bookId: string): Promise<AnomalyScanReport> => {
    const db = await initDB();
    const book = await db.books.findOne(bookId).exec();
    if (!book) return { booksScanned: 0, chaptersScanned: 0, candidatesFound: 0, circuitBroken: false };

    const chapters = await db.chapters.find({
        selector: { bookId },
        sort: [{ index: 'asc' }],
    }).exec();
    let chaptersScanned = 0;
    let candidatesFound = 0;
    let circuitBroken = false;

    for (const chapter of chapters) {
        const text = chapter.content.join(' ').trim();
        if (!text) continue;
        chaptersScanned += 1;

        const activeRevisions = await db.content_revisions.find({
            selector: { bookId, sourceUnitId: chapter.id, state: 'active' },
            sort: [{ createdAt: 'desc' }],
            limit: 1,
        }).exec();
        const currentRevision = activeRevisions[0];
        const textHash = await fingerprintValue(text);
        if (!currentRevision || currentRevision.textHash !== textHash) {
            if (currentRevision && currentRevision.textHash !== textHash) {
                await currentRevision.incrementalPatch({ state: 'superseded' });
            }
            const now = Date.now();
            await db.content_revisions.bulkUpsert([{
                id: `${chapter.id}:${SCAN_PIPELINE_VERSION}:${textHash}`,
                bookId,
                sourceUnitId: chapter.id,
                sourceHash: currentRevision?.sourceHash || textHash,
                textHash,
                pipelineVersion: SCAN_PIPELINE_VERSION,
                acceptedPatchIds: [],
                createdAt: now,
                state: 'active',
            }]);
        }

        const result = await scanTextForAnomalies({
            bookId,
            sourceUnitId: chapter.id,
            revisionHash: textHash,
            text,
        });
        candidatesFound += result.candidates.length;
        circuitBroken ||= result.circuitBroken;

        const existingIssues = await db.text_issues.find({
            selector: { bookId, sourceUnitId: chapter.id },
        }).exec();
        const existingById = new Map(existingIssues.map((issue) => [issue.id, issue]));
        const currentCandidateIds = new Set(result.candidates.map((candidate) => candidate.id));
        const now = Date.now();
        if (result.candidates.length > 0) {
            await db.text_issues.bulkUpsert(result.candidates.map((candidate) => {
                const existing = existingById.get(candidate.id);
                return {
                    ...candidate,
                    state: existing?.state || 'open',
                    ...(existing?.proposal ? { proposal: existing.proposal } : {}),
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                };
            }));
        }
        await Promise.all(existingIssues
            .filter((issue) => !currentCandidateIds.has(issue.id) && issue.state === 'open')
            .map((issue) => issue.incrementalPatch({ state: 'stale', updatedAt: now })));
    }

    return { booksScanned: 1, chaptersScanned, candidatesFound, circuitBroken };
};

export const scanBookForAnomalies = async (bookId: string): Promise<AnomalyScanReport> => scanBook(bookId);

export const scanLibraryForAnomalies = async (): Promise<AnomalyScanReport> => {
    const db = await initDB();
    const books = await db.books.find().exec();
    const reports = [];
    for (const book of books) reports.push(await scanBook(book.id));
    return reports.reduce((total, report) => ({
        booksScanned: total.booksScanned + report.booksScanned,
        chaptersScanned: total.chaptersScanned + report.chaptersScanned,
        candidatesFound: total.candidatesFound + report.candidatesFound,
        circuitBroken: total.circuitBroken || report.circuitBroken,
    }), { booksScanned: 0, chaptersScanned: 0, candidatesFound: 0, circuitBroken: false });
};

const findContextStart = (text: string, startOffset: number): number => {
    const lowerBound = Math.max(0, startOffset - MAX_CONTEXT_LENGTH);
    const sentenceStart = Math.max(
        text.lastIndexOf('.', startOffset - 1),
        text.lastIndexOf('!', startOffset - 1),
        text.lastIndexOf('?', startOffset - 1),
        text.lastIndexOf('\n', startOffset - 1),
    );
    return Math.max(lowerBound, sentenceStart < 0 ? 0 : sentenceStart + 1);
};

const findContextEnd = (text: string, endOffset: number): number => {
    const upperBound = Math.min(text.length, endOffset + MAX_CONTEXT_LENGTH);
    const sentenceEndings = ['.', '!', '?', '\n']
        .map((character) => text.indexOf(character, endOffset))
        .filter((index) => index >= 0);
    const sentenceEnd = sentenceEndings.length > 0 ? Math.min(...sentenceEndings) + 1 : text.length;
    return Math.min(upperBound, sentenceEnd);
};

export const createRepairContext = (text: string, candidate: TextIssueCandidate): RepairContext => {
    let contextStartOffset = findContextStart(text, candidate.startOffset);
    let contextEndOffset = findContextEnd(text, candidate.endOffset);
    if (contextEndOffset - contextStartOffset > MAX_CONTEXT_LENGTH) {
        const halfWindow = Math.floor(MAX_CONTEXT_LENGTH / 2);
        contextStartOffset = Math.max(0, candidate.startOffset - halfWindow);
        contextEndOffset = Math.min(text.length, contextStartOffset + MAX_CONTEXT_LENGTH);
        if (contextEndOffset < candidate.endOffset) {
            contextEndOffset = candidate.endOffset;
            contextStartOffset = Math.max(0, contextEndOffset - MAX_CONTEXT_LENGTH);
        }
    }
    const context = text.slice(contextStartOffset, contextEndOffset);
    return {
        text,
        startOffset: candidate.startOffset,
        endOffset: candidate.endOffset,
        candidateText: text.slice(candidate.startOffset, candidate.endOffset),
        contextStartOffset,
        contextEndOffset: contextStartOffset + context.length,
        context,
    };
};

const parseStrictProposal = (response: string): RepairProposal => {
    const parsed: unknown = JSON.parse(response);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Repair response must be a JSON object');
    }
    const record = parsed as Record<string, unknown>;
    const allowedKeys = new Set(['candidateId', 'action', 'replacement', 'reasonCode']);
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new Error('Repair response contains unknown fields');
    }
    if (typeof record.candidateId !== 'string' || typeof record.action !== 'string' || typeof record.reasonCode !== 'string') {
        throw new Error('Repair response is missing required fields');
    }
    if (!REPAIR_ACTIONS.has(record.action as RepairAction) || !REPAIR_REASON_CODES.has(record.reasonCode as RepairReasonCode)) {
        throw new Error('Repair response contains an unsupported action or reason code');
    }
    if (record.replacement !== undefined && typeof record.replacement !== 'string') {
        throw new Error('Repair replacement must be a string');
    }
    return {
        candidateId: record.candidateId,
        action: record.action as RepairAction,
        ...(record.replacement !== undefined ? { replacement: record.replacement } : {}),
        reasonCode: record.reasonCode as RepairReasonCode,
    };
};

export const parseRepairProposal = (response: string): RepairProposal => {
    if (response.trim() !== response || response.includes('```')) {
        throw new Error('Repair response must contain only JSON');
    }
    return parseStrictProposal(response);
};

export const validateRepairProposal = async (
    candidate: TextIssueCandidate,
    originalText: string,
    proposal: RepairProposal,
    expectedRevisionHash?: string,
): Promise<RepairValidationResult> => {
    if (expectedRevisionHash && candidate.revisionHash !== expectedRevisionHash) {
        return { valid: false, reason: 'candidate revision is stale' };
    }
    if (candidate.endOffset <= candidate.startOffset || originalText.length === 0 && proposal.action !== 'delete') {
        return { valid: false, reason: 'candidate span is invalid' };
    }
    if (proposal.candidateId !== candidate.id) {
        return { valid: false, reason: 'candidate ID does not match' };
    }
    if (proposal.action === 'keep' || proposal.action === 'delete') {
        if (proposal.replacement !== undefined) {
            return { valid: false, reason: `${proposal.action} cannot include replacement text` };
        }
    } else if (typeof proposal.replacement !== 'string' || proposal.replacement.length === 0) {
        return { valid: false, reason: `${proposal.action} requires replacement text` };
    }
    if (proposal.replacement && proposal.replacement.length > Math.min(MAX_REPLACEMENT_LENGTH, Math.max(32, originalText.length * 4))) {
        return { valid: false, reason: 'replacement exceeds bounded repair size' };
    }
    if (proposal.replacement && (containsControlCharacters(proposal.replacement) || MARKUP_RESIDUE.test(proposal.replacement))) {
        return { valid: false, reason: 'replacement contains control characters or markup residue' };
    }

    const actualHash = await fingerprintValue(originalText);
    if (actualHash !== candidate.originalHash) {
        return { valid: false, reason: 'candidate text no longer matches its source hash' };
    }

    if (proposal.replacement) {
        const replacementScan = await scanTextForAnomalies({
            bookId: candidate.bookId,
            sourceUnitId: candidate.sourceUnitId,
            revisionHash: candidate.revisionHash,
            text: proposal.replacement,
        });
        if (replacementScan.candidates.length > 0) {
            return { valid: false, reason: 'replacement introduces a new deterministic anomaly' };
        }
    }

    return { valid: true, proposal };
};

export const applyRepairProposal = (text: string, candidate: TextIssueCandidate, proposal: RepairProposal): string => {
    const replacement = proposal.action === 'delete' || proposal.action === 'keep'
        ? proposal.action === 'delete' ? '' : text.slice(candidate.startOffset, candidate.endOffset)
        : proposal.replacement ?? '';
    return text.slice(0, candidate.startOffset) + replacement + text.slice(candidate.endOffset);
};

export const acceptRepairProposal = async (options: {
    candidate: TextIssueCandidate;
    proposal: RepairProposal;
    sourceText: string;
    sourceRevisionId: string;
    currentRevisionId: string;
    pipelineFingerprint: string;
    validatorFingerprint: string;
    modelFingerprint?: string;
    promptFingerprint?: string;
    acceptanceAction?: 'accept' | 'accept-all-safe';
}): Promise<AcceptedRepairResult> => {
    const sourceHash = await fingerprintValue(options.sourceText);
    if (sourceHash !== options.candidate.revisionHash) {
        throw new Error('Repair source text does not match the candidate revision');
    }
    const validation = await validateRepairProposal(
        options.candidate,
        options.sourceText.slice(options.candidate.startOffset, options.candidate.endOffset),
        options.proposal,
        options.candidate.revisionHash,
    );
    if (!validation.valid || !validation.proposal) {
        throw new Error(validation.reason ?? 'Repair proposal failed validation');
    }

    const nextText = applyRepairProposal(options.sourceText, options.candidate, validation.proposal);
    const originalText = options.sourceText.slice(options.candidate.startOffset, options.candidate.endOffset);
    const replacementText = validation.proposal.action === 'keep'
        ? originalText
        : validation.proposal.action === 'delete'
            ? ''
            : validation.proposal.replacement ?? '';
    const [sourceContextHash, canonicalAnchorHash, nextTextHash] = await Promise.all([
        fingerprintValue(options.sourceText.slice(Math.max(0, options.candidate.startOffset - 80), options.candidate.endOffset + 80)),
        fingerprintValue(replacementText),
        fingerprintValue(nextText),
    ]);
    const now = Date.now();
    const nextRevision: ContentRevisionDocType = {
        id: `${options.candidate.sourceUnitId}:${options.pipelineFingerprint}:${nextTextHash}`,
        bookId: options.candidate.bookId,
        sourceUnitId: options.candidate.sourceUnitId,
        parentRevisionId: options.currentRevisionId,
        sourceHash: options.candidate.revisionHash,
        textHash: nextTextHash,
        pipelineVersion: options.pipelineFingerprint,
        acceptedPatchIds: [options.candidate.id],
        createdAt: now,
        state: 'prepared',
    };
    const canonicalEndOffset = options.candidate.startOffset + replacementText.length;
    const annotation: RepairAnnotationDocType = {
        id: `${options.candidate.id}:${nextTextHash.slice(0, 12)}`,
        bookId: options.candidate.bookId,
        sourceUnitId: options.candidate.sourceUnitId,
        sourceRevisionId: options.sourceRevisionId,
        canonicalRevisionId: nextRevision.id,
        sourceAnchor: {
            startOffset: options.candidate.startOffset,
            endOffset: options.candidate.endOffset,
            contextHash: sourceContextHash,
        },
        canonicalAnchor: {
            startOffset: options.candidate.startOffset,
            endOffset: canonicalEndOffset,
            anchorHash: canonicalAnchorHash,
        },
        originalText,
        replacementText,
        action: validation.proposal.action,
        detectorIds: options.candidate.detectorIds,
        detectorEvidence: options.candidate.evidence,
        ...(options.modelFingerprint ? { modelFingerprint: options.modelFingerprint } : {}),
        ...(options.promptFingerprint ? { promptFingerprint: options.promptFingerprint } : {}),
        validatorFingerprint: options.validatorFingerprint,
        pipelineFingerprint: options.pipelineFingerprint,
        proposalState: 'accepted',
        acceptedAt: now,
        acceptanceAction: options.acceptanceAction ?? 'accept',
        renderRange: {
            kind: 'text-range',
            startOffset: options.candidate.startOffset,
            endOffset: canonicalEndOffset,
            anchorHash: canonicalAnchorHash,
        },
    };

    const db = await initDB();
    const currentRevision = await db.content_revisions.findOne(options.currentRevisionId).exec();
    if (!currentRevision || currentRevision.state !== 'active' || currentRevision.textHash !== options.candidate.revisionHash) {
        throw new Error('Repair candidate is stale for the active revision');
    }
    await db.content_revisions.bulkUpsert([nextRevision]);
    await db.repair_annotations.bulkUpsert([annotation]);
    const issue = await db.text_issues.findOne(options.candidate.id).exec();
    if (!issue) throw new Error('Repair candidate no longer exists');
    await issue.incrementalPatch({
        proposal: validation.proposal,
        state: 'accepted',
        updatedAt: now,
    });

    return { nextText, revision: nextRevision, annotation };
};

export const keepRepairOriginal = async (options: {
    candidate: TextIssueCandidate;
    sourceText: string;
    revisionId: string;
    pipelineFingerprint: string;
    validatorFingerprint: string;
}): Promise<RepairAnnotationDocType> => {
    const originalText = options.sourceText.slice(options.candidate.startOffset, options.candidate.endOffset);
    const [sourceHash, sourceContextHash, anchorHash] = await Promise.all([
        fingerprintValue(options.sourceText),
        fingerprintValue(options.sourceText.slice(Math.max(0, options.candidate.startOffset - 80), options.candidate.endOffset + 80)),
        fingerprintValue(originalText),
    ]);
    if (sourceHash !== options.candidate.revisionHash || anchorHash !== options.candidate.originalHash) {
        throw new Error('Repair candidate is stale for the current chapter text');
    }
    const now = Date.now();
    const annotation: RepairAnnotationDocType = {
        id: `${options.candidate.id}:kept:${anchorHash.slice(0, 12)}`,
        bookId: options.candidate.bookId,
        sourceUnitId: options.candidate.sourceUnitId,
        sourceRevisionId: options.revisionId,
        canonicalRevisionId: options.revisionId,
        sourceAnchor: {
            startOffset: options.candidate.startOffset,
            endOffset: options.candidate.endOffset,
            contextHash: sourceContextHash,
        },
        canonicalAnchor: {
            startOffset: options.candidate.startOffset,
            endOffset: options.candidate.endOffset,
            anchorHash,
        },
        originalText,
        replacementText: originalText,
        action: 'keep',
        detectorIds: options.candidate.detectorIds,
        detectorEvidence: options.candidate.evidence,
        validatorFingerprint: options.validatorFingerprint,
        pipelineFingerprint: options.pipelineFingerprint,
        proposalState: 'kept-original',
        acceptedAt: now,
        acceptanceAction: 'keep-original',
        renderRange: {
            kind: 'text-range',
            startOffset: options.candidate.startOffset,
            endOffset: options.candidate.endOffset,
            anchorHash,
        },
    };
    const db = await initDB();
    await db.repair_annotations.bulkUpsert([annotation]);
    const issue = await db.text_issues.findOne(options.candidate.id).exec();
    if (!issue) throw new Error('Repair candidate no longer exists');
    await issue.incrementalPatch({
        proposal: {
            candidateId: options.candidate.id,
            action: 'keep',
            reasonCode: 'uncertain',
        },
        state: 'kept-original',
        updatedAt: now,
    });
    return annotation;
};

export const activateRepairRevision = async (options: {
    candidate: TextIssueCandidate;
    nextText: string;
    revision: ContentRevisionDocType;
    annotation: RepairAnnotationDocType;
}): Promise<ActivatedRepairResult> => {
    const db = await initDB();
    const preparedRevision = await db.content_revisions.findOne(options.revision.id).exec();
    if (!preparedRevision || preparedRevision.state !== 'prepared') {
        throw new Error('Repair revision is no longer prepared');
    }
    if (preparedRevision.textHash !== options.revision.textHash) {
        throw new Error('Repair revision hash changed before activation');
    }

    const currentRevision = await db.content_revisions.findOne(preparedRevision.parentRevisionId || '').exec();
    if (
        !currentRevision
        || currentRevision.state !== 'active'
        || currentRevision.textHash !== options.candidate.revisionHash
    ) {
        throw new Error('Repair revision is stale for the active chapter');
    }

    const chapter = await db.chapters.findOne(options.candidate.sourceUnitId).exec();
    if (!chapter) throw new Error('Repair chapter no longer exists');
    const sourceText = chapter.content.join(' ');
    const sourceHash = await fingerprintValue(sourceText);
    if (sourceHash !== options.candidate.revisionHash) {
        throw new Error('Repair chapter text changed before activation');
    }
    const nextTextHash = await fingerprintValue(options.nextText);
    if (nextTextHash !== preparedRevision.textHash) {
        throw new Error('Repair revision does not match the proposed text');
    }

    const nextWords = options.nextText.trim().split(/\s+/).filter(Boolean);
    const oldStartWordIndex = countWords(sourceText.slice(0, options.candidate.startOffset));
    const oldEndWordIndex = countWords(sourceText.slice(0, options.candidate.endOffset));
    const replacementWordCount = countWords(options.annotation.replacementText || '');
    const remapIndex = (wordIndex: number) => remapWordIndex(
        wordIndex,
        oldStartWordIndex,
        oldEndWordIndex,
        replacementWordCount,
    );

    const oldDensities = chapter.densities || [];
    const oldAnalysisData = chapter.analysisData || [];
    const densities = nextWords.map((_, index) => {
        const oldIndex = index < oldStartWordIndex
            ? index
            : index >= oldStartWordIndex + replacementWordCount
                ? index - replacementWordCount + (oldEndWordIndex - oldStartWordIndex)
                : -1;
        return oldIndex >= 0 && oldIndex < oldDensities.length ? oldDensities[oldIndex] : 0;
    });
    const analysisData = nextWords.map((_, index) => {
        const oldIndex = index < oldStartWordIndex
            ? index
            : index >= oldStartWordIndex + replacementWordCount
                ? index - replacementWordCount + (oldEndWordIndex - oldStartWordIndex)
                : -1;
        return oldIndex >= 0 && oldIndex < oldAnalysisData.length
            ? oldAnalysisData[oldIndex]
            : { tokens: [], surprisals: [] };
    });
    const subchapters = (chapter.subchapters || []).map((subchapter) => ({
        ...subchapter,
        startWordIndex: remapIndex(subchapter.startWordIndex),
        endWordIndex: remapIndex(subchapter.endWordIndex),
        summary: '',
    }));

    await chapter.incrementalPatch({
        content: nextWords,
        densities,
        analysisData,
        subchapters,
    });

    const readingState = await db.reading_states.findOne({ selector: { bookId: options.candidate.bookId } }).exec();
    if (readingState) {
        await readingState.incrementalPatch({
            currentWordIndex: readingState.currentChapterId === chapter.id
                ? remapIndex(readingState.currentWordIndex)
                : readingState.currentWordIndex,
            highlights: readingState.highlights.map((highlight) => highlight.chapterId === chapter.id
                ? {
                    ...highlight,
                    startWordIndex: remapIndex(highlight.startWordIndex),
                    endWordIndex: remapIndex(highlight.endWordIndex),
                }
                : highlight),
            ...(readingState.ttsPosition?.chapterId === chapter.id ? {
                ttsPosition: {
                    ...readingState.ttsPosition,
                    wordIndex: remapIndex(readingState.ttsPosition.wordIndex),
                },
            } : {}),
        });
    }

    await currentRevision.incrementalPatch({ state: 'superseded' });
    await preparedRevision.incrementalPatch({ state: 'active' });
    await db.repair_annotations.findOne(options.annotation.id).exec()
        .then((annotation) => annotation?.incrementalPatch({ proposalState: 'accepted', acceptedAt: Date.now() }));

    return {
        nextText: options.nextText,
        revision: { ...options.revision, state: 'active' },
        annotation: options.annotation,
    };
};

export const buildRepairPrompt = (candidate: TextIssueCandidate, repairContext: RepairContext): string => (
    [
        'Return exactly one JSON object with these keys: candidateId, action, replacement, reasonCode.',
        'Do not rewrite or repeat the context. Change only the suspicious span.',
        'Allowed actions: keep, replace, delete, merge, split.',
        'Use replacement only for replace, merge, or split. Use null by omitting replacement for keep or delete.',
        `candidateId: ${candidate.id}`,
        `suspicious text: ${JSON.stringify(repairContext.candidateText)}`,
        `detectors: ${candidate.detectorIds.join(', ')}`,
        `evidence: ${JSON.stringify(candidate.evidence)}`,
        `context: ${JSON.stringify(repairContext.context)}`,
    ].join('\n')
);

export const requestRepairProposal = async (
    candidate: TextIssueCandidate,
    sourceText: string,
    modelTier: ModelTier,
    signal?: AbortSignal,
): Promise<RepairProposal> => {
    const context = createRepairContext(sourceText, candidate);
    const prompt = buildRepairPrompt(candidate, context);
    const result = await localAIBroker.execute(
        {
            feature: 'repair',
            modelTier,
            signal,
            dedupeKey: `repair:${candidate.id}:${candidate.originalHash}`,
            priority: 40,
        },
        async (engine) => await engine.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You propose bounded text repairs. Output strict JSON only.',
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0,
            max_tokens: 128,
        }),
    );
    const response = result.choices[0]?.message.content;
    if (!response) throw new Error('Repair model returned an empty response');
    const proposal = parseRepairProposal(response);
    const validation = await validateRepairProposal(candidate, context.candidateText, proposal);
    if (!validation.valid || !validation.proposal) {
        throw new Error(validation.reason ?? 'Repair proposal failed validation');
    }
    return validation.proposal;
};
