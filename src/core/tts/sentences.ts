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

const SENTENCE_END_PATTERN = /(?:[.!?]|\u2026)["'\u2019\u201d)\]}]*$/;

/**
 * Split text into sentences for TTS processing
 * This enables smooth reading <-> listening transitions
 */
export function splitIntoSentences(words: string[]): SentenceBoundary[] {
    const sentences: SentenceBoundary[] = [];
    let currentSentence: string[] = [];
    let sentenceStartIndex = 0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        currentSentence.push(word);

        const isEnd = SENTENCE_END_PATTERN.test(word);

        if (isEnd || i === words.length - 1) {
            sentences.push({
                index: sentences.length,
                text: currentSentence.join(' '),
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
