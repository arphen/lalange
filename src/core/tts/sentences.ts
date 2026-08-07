/**
 * Sentence segmentation and reading/listening position mapping.
 *
 * Engine-agnostic: sentences are the unit every TTS engine generates and the
 * player queues, and they are what keeps the RSVP word position and the audio
 * position in sync.
 */

export interface SentenceBoundary {
    index: number;
    text: string;
    startWordIndex: number;
    endWordIndex: number;
    audioStartTime?: number;
    audioEndTime?: number;
}

const SENTENCE_END_PATTERN = /(?:[.!?\u0589\u061f\u0964\u0965\u2026\u3002\uff01\uff1f\u1362])["'\u2019\u201d)\]}]*$/;
const TRAILING_PUNCTUATION_PATTERN = /[.!?,:;\u0589\u061b\u061f\u0964\u0965\u2026\u3001\u3002\uff01\uff0c\uff1a\uff1b\uff1f\u1362]["'\u2019\u201d)\]}]*$/;
const NUMBERED_HEADING_PATTERN = /^(?:\d+|[ivxlcdm]+)[.)]$/i;
const HEADING_CONNECTORS = new Set([
    'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of',
    'on', 'or', 'the', 'to', 'with', 'without',
]);

const cleanHeadingToken = (word: string): string => word
    .replace(/^["'\u2018\u201c([{]+/, '')
    .replace(/["'\u2019\u201d)\]},:;]+$/, '');

const isCapitalizedHeadingWord = (word: string): boolean => {
    const token = cleanHeadingToken(word);
    return /^\p{Lu}[\p{L}\p{M}'\u2019-]*$/u.test(token) || /^\p{Lu}{2,}$/u.test(token);
};

const isLowercaseBodyWord = (word: string): boolean => {
    const token = cleanHeadingToken(word);
    return /^\p{Ll}/u.test(token) && !HEADING_CONNECTORS.has(token.toLocaleLowerCase());
};

const findInferredHeadingBreaks = (words: string[]): Set<number> => {
    const breaks = new Set<number>();

    for (let markerIndex = 0; markerIndex < words.length - 3; markerIndex++) {
        if (!NUMBERED_HEADING_PATTERN.test(words[markerIndex])) continue;

        const titleStart = markerIndex + 1;
        const titleLimit = Math.min(words.length - 1, titleStart + 24);
        for (let wordIndex = titleStart; wordIndex <= titleLimit; wordIndex++) {
            const token = cleanHeadingToken(words[wordIndex]);
            const normalized = token.toLocaleLowerCase();
            const isHeadingWord = isCapitalizedHeadingWord(words[wordIndex]) || HEADING_CONNECTORS.has(normalized);
            if (!isHeadingWord || SENTENCE_END_PATTERN.test(words[wordIndex])) break;

            const nextWord = words[wordIndex + 1];
            if (
                wordIndex - titleStart >= 2
                && isCapitalizedHeadingWord(words[wordIndex])
                && nextWord
                && isLowercaseBodyWord(nextWord)
            ) {
                breaks.add(wordIndex - 1);
                break;
            }
        }
    }

    return breaks;
};

const closeStructuralUtterance = (text: string): string =>
    TRAILING_PUNCTUATION_PATTERN.test(text) ? text : `${text}.`;

/**
 * Split text into sentences for TTS processing
 * This enables smooth reading <-> listening transitions
 */
export function splitIntoSentences(
    words: string[],
    breakAfterWordIndices: Iterable<number> = [],
): SentenceBoundary[] {
    const sentences: SentenceBoundary[] = [];
    let currentSentence: string[] = [];
    let sentenceStartIndex = 0;
    const structuralBreaks = findInferredHeadingBreaks(words);
    for (const wordIndex of breakAfterWordIndices) {
        if (Number.isInteger(wordIndex) && wordIndex >= 0 && wordIndex < words.length - 1) {
            structuralBreaks.add(wordIndex);
        }
    }

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        currentSentence.push(word);

        const isEnd = SENTENCE_END_PATTERN.test(word);
        const isStructuralBreak = structuralBreaks.has(i);

        if (isEnd || isStructuralBreak || i === words.length - 1) {
            const text = currentSentence.join(' ');
            sentences.push({
                index: sentences.length,
                text: isStructuralBreak && !isEnd ? closeStructuralUtterance(text) : text,
                startWordIndex: sentenceStartIndex,
                endWordIndex: i,
            });
            currentSentence = [];
            sentenceStartIndex = i + 1;
        }
    }

    return sentences;
}

/**
 * Find the sentence containing a given word index
 */
export function findSentenceForWord(
    wordIndex: number,
    sentences: SentenceBoundary[]
): SentenceBoundary | null {
    return sentences.find(
        s => wordIndex >= s.startWordIndex && wordIndex <= s.endWordIndex
    ) ?? null;
}

/**
 * Calculate audio timestamp from word index (approximate)
 */
export function estimateAudioTimeForWord(
    wordIndex: number,
    sentences: SentenceBoundary[],
    totalAudioDuration: number
): number {
    const sentence = findSentenceForWord(wordIndex, sentences);
    if (!sentence || sentence.audioStartTime === undefined) {
        // Fallback: linear interpolation based on total words
        const totalWords = sentences[sentences.length - 1]?.endWordIndex ?? 0;
        return (wordIndex / totalWords) * totalAudioDuration;
    }

    // Interpolate within the sentence
    const sentenceWordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
    const wordOffsetInSentence = wordIndex - sentence.startWordIndex;
    const sentenceDuration = (sentence.audioEndTime ?? 0) - sentence.audioStartTime;

    return sentence.audioStartTime + (wordOffsetInSentence / sentenceWordCount) * sentenceDuration;
}

/**
 * Find word index from audio timestamp
 */
export function findWordForAudioTime(
    audioTime: number,
    sentences: SentenceBoundary[]
): number {
    // Find the sentence containing this timestamp
    for (const sentence of sentences) {
        if (
            sentence.audioStartTime !== undefined &&
            sentence.audioEndTime !== undefined &&
            audioTime >= sentence.audioStartTime &&
            audioTime <= sentence.audioEndTime
        ) {
            // Interpolate within sentence
            const progress = (audioTime - sentence.audioStartTime) /
                           (sentence.audioEndTime - sentence.audioStartTime);
            const sentenceWordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
            const wordOffset = Math.floor(progress * sentenceWordCount);
            return Math.min(sentence.startWordIndex + wordOffset, sentence.endWordIndex);
        }
    }

    // Fallback: find closest sentence by time and handle out-of-range audioTime
    if (sentences.length === 0) {
        return 0;
    }

    let closestSentence: SentenceBoundary | undefined;
    let maxEndTime = -Infinity;

    for (const sentence of sentences) {
        if (sentence.audioStartTime === undefined) {
            continue;
        }

        const endTime = sentence.audioEndTime ?? sentence.audioStartTime;

        // Track the furthest point in time covered by any sentence
        if (endTime > maxEndTime) {
            maxEndTime = endTime;
        }

        // Find the last sentence that starts before or at audioTime
        if (sentence.audioStartTime <= audioTime) {
            closestSentence = sentence;
        }
    }

    if (!closestSentence) {
        // No sentences with timing information; fall back to first sentence or index 0
        return sentences[0]?.startWordIndex ?? 0;
    }

    // If audioTime is beyond all sentences, snap to the end of the last sentence
    if (audioTime > maxEndTime && maxEndTime !== -Infinity) {
        return closestSentence.endWordIndex;
    }

    return closestSentence.startWordIndex;
}
