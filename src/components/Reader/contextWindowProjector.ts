import { appendDisplayWordModel, getVelocireaderORPIndex, type DisplayWordModel } from '../../core/rsvp/display';

const CONTEXT_WORD_BASE_CLASS = 'word-span inline-block mr-1.5 mb-1 cursor-pointer';

interface ContextWordEntry {
    word: string;
    wordElement: HTMLSpanElement;
    breakElement: HTMLDivElement | null;
}

export interface ContextWindowProjectionResult {
    createdNodes: number;
    removedNodes: number;
    reusedWords: number;
    rebuilt: boolean;
}

const createContextWordModel = (word: string): DisplayWordModel => {
    const orp = getVelocireaderORPIndex(word);
    const runs: DisplayWordModel['runs'] = [];

    for (let characterIndex = 0; characterIndex < word.length; characterIndex++) {
        const distance = Math.abs(characterIndex - orp);
        const className = distance === 0
            ? 'font-extrabold opacity-100'
            : distance === 1
                ? 'font-medium opacity-80'
                : 'font-light opacity-60';
        runs.push({ text: word[characterIndex], className });
    }

    return { runs };
};

const createContextWordEntry = (
    word: string,
    actualIndex: number,
    colorClass: string,
): ContextWordEntry => {
    const wordElement = document.createElement('span');
    wordElement.className = `${CONTEXT_WORD_BASE_CLASS} ${colorClass}`;
    wordElement.dataset.index = String(actualIndex);
    appendDisplayWordModel(wordElement, createContextWordModel(word));

    const breakElement = /[.!?]$/.test(word)
        ? document.createElement('div')
        : null;
    if (breakElement) {
        breakElement.className = 'w-full h-2';
    }

    return { word, wordElement, breakElement };
};

const countCreatedNodes = (word: string): number => (
    1 + word.length + (/[.!?]$/.test(word) ? 1 : 0)
);

export class ContextWindowProjector {
    private readonly entries = new Map<number, ContextWordEntry>();
    private sourceWords: readonly string[] | null = null;

    reset(container?: HTMLElement | null): void {
        this.entries.clear();
        this.sourceWords = null;
        if (container) container.replaceChildren();
    }

    project(
        container: HTMLElement,
        words: readonly string[],
        start: number,
        end: number,
        getColorClass: (index: number) => string,
    ): ContextWindowProjectionResult {
        const safeStart = Math.max(0, Math.min(words.length, start));
        const safeEnd = Math.max(safeStart, Math.min(words.length, end));
        const sourceChanged = this.sourceWords !== words;
        const hasDetachedEntries = [...this.entries.values()].some((entry) => (
            entry.wordElement.parentElement !== container
            || (entry.breakElement !== null && entry.breakElement.parentElement !== container)
        ));
        const rebuilt = sourceChanged || hasDetachedEntries;
        let createdNodes = 0;
        let removedNodes = 0;
        let reusedWords = 0;

        if (rebuilt) {
            container.replaceChildren();
            this.entries.clear();
        }

        for (const [index, entry] of this.entries) {
            if (index < safeStart || index >= safeEnd) {
                entry.wordElement.remove();
                entry.breakElement?.remove();
                this.entries.delete(index);
                removedNodes += countCreatedNodes(entry.word);
            }
        }

        for (let index = safeStart; index < safeEnd; index++) {
            const word = words[index] || '';
            const existingEntry = this.entries.get(index);
            if (existingEntry && existingEntry.word === word) {
                this.updateColorClass(existingEntry.wordElement, getColorClass(index));
                reusedWords++;
                continue;
            }

            if (existingEntry) {
                existingEntry.wordElement.remove();
                existingEntry.breakElement?.remove();
                this.entries.delete(index);
                removedNodes += countCreatedNodes(existingEntry.word);
            }

            const entry = createContextWordEntry(word, index, getColorClass(index));
            const nextEntry = [...this.entries.entries()]
                .filter(([entryIndex]) => entryIndex > index)
                .sort(([left], [right]) => left - right)[0]?.[1];
            if (nextEntry) {
                container.insertBefore(entry.wordElement, nextEntry.wordElement);
                if (entry.breakElement) container.insertBefore(entry.breakElement, nextEntry.wordElement);
            } else {
                container.appendChild(entry.wordElement);
                if (entry.breakElement) container.appendChild(entry.breakElement);
            }
            this.entries.set(index, entry);
            createdNodes += countCreatedNodes(word);
        }

        this.sourceWords = words;

        return { createdNodes, removedNodes, reusedWords, rebuilt };
    }

    private updateColorClass(wordElement: HTMLSpanElement, colorClass: string): void {
        wordElement.className = `${CONTEXT_WORD_BASE_CLASS} ${colorClass}`;
    }
}
