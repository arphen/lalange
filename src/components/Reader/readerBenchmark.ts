import { getFrameTargetInterval } from '../../core/rsvp/timing';
import { planRsvpFrame } from '../../core/rsvp/phrases/grouping';
import {
    createReaderSessionControllerForBook,
    type ReaderSessionController,
} from '../../core/reader/controller';
import { ContextWindowProjector, createVelocireaderContextWordModel } from './contextWindowProjector';

export interface ReaderBenchmarkOptions {
    words: readonly string[];
    densities?: readonly number[];
    wpm?: number;
    contextWindowSize?: number;
    chapterId?: string;
}

export interface ReaderBenchmarkSnapshot {
    elapsedMs: number;
    framesAdvanced: number;
    centerProjections: number;
    riverProjectionCalls: number;
    riverRebuilds: number;
    riverNodesCreated: number;
    cursor: number;
    mode: string;
    transport: string;
    playing: boolean;
}

export interface ReaderBenchmarkFixture {
    playRsvp: () => void;
    claimTts: () => void;
    releaseTts: () => void;
    seek: (wordIndex: number) => void;
    beginSummary: (summaryWords: readonly string[]) => void;
    completeSummary: () => void;
    beginChapterTransition: (targetChapterId: string) => void;
    completeChapterTransition: (targetChapterId: string, wordIndex?: number) => void;
    runRsvp: (durationMs: number) => void;
    snapshot: () => ReaderBenchmarkSnapshot;
}

export const createReaderBenchmarkFixture = ({
    words,
    densities = [],
    wpm = 600,
    contextWindowSize = 150,
    chapterId = 'chapter-1',
}: ReaderBenchmarkOptions): ReaderBenchmarkFixture => {
    const sessionController: ReaderSessionController = createReaderSessionControllerForBook(
        'benchmark-book',
        chapterId,
    );
    const previousContainer = document.createElement('div');
    const nextContainer = document.createElement('div');
    const previousProjector = new ContextWindowProjector();
    const nextProjector = new ContextWindowProjector();
    let activeWords = words;
    let savedTextCursor = 0;
    let cursor = 0;
    let elapsedMs = 0;
    let framesAdvanced = 0;
    let centerProjections = 0;
    let riverProjectionCalls = 0;
    let riverRebuilds = 0;
    let riverNodesCreated = 0;

    const projectRiver = (
        projector: ContextWindowProjector,
        container: HTMLElement,
        start: number,
        end: number,
    ) => {
        const result = projector.project(container, activeWords, start, end, {
            getColorClass: () => 'text-gray-400',
            createWordModel: createVelocireaderContextWordModel,
            modelKey: 'velocireader',
        });
        riverProjectionCalls += 1;
        if (result.rebuilt) riverRebuilds += 1;
        riverNodesCreated += result.createdNodes;
    };

    const projectFrame = (renderContext: boolean) => {
        const frame = planRsvpFrame(activeWords, cursor, { phraseRankLimit: 0 });
        centerProjections += 1;
        if (!renderContext) return frame;

        projectRiver(
            previousProjector,
            previousContainer,
            Math.max(0, cursor - contextWindowSize),
            frame.startIndex,
        );
        const frameEnd = frame.startIndex + frame.sourceWordCount;
        projectRiver(
            nextProjector,
            nextContainer,
            frameEnd,
            Math.min(activeWords.length, frameEnd + contextWindowSize),
        );
        return frame;
    };

    projectFrame(true);

    const playRsvp = () => {
        sessionController.dispatch({ type: 'play', transport: 'rsvp' });
    };

    const claimTts = () => {
        sessionController.dispatch({ type: 'claim-transport', transport: 'tts' });
    };

    const releaseTts = () => {
        sessionController.dispatch({ type: 'release-transport', transport: 'tts' });
    };

    const seek = (wordIndex: number) => {
        cursor = Math.max(0, Math.min(activeWords.length - 1, Math.floor(wordIndex)));
        sessionController.dispatch({ type: 'seek', chapterId, wordIndex: cursor });
        previousProjector.reset(previousContainer);
        nextProjector.reset(nextContainer);
        projectFrame(true);
    };

    const beginSummary = (summaryWords: readonly string[]) => {
        savedTextCursor = cursor;
        activeWords = summaryWords;
        cursor = 0;
        sessionController.dispatch({ type: 'pause' });
        sessionController.dispatch({ type: 'set-mode', mode: 'summary' });
        previousProjector.reset(previousContainer);
        nextProjector.reset(nextContainer);
        projectFrame(true);
    };

    const completeSummary = () => {
        activeWords = words;
        cursor = savedTextCursor;
        sessionController.dispatch({ type: 'set-mode', mode: 'text' });
        previousProjector.reset(previousContainer);
        nextProjector.reset(nextContainer);
        projectFrame(true);
    };

    const beginChapterTransition = (targetChapterId: string) => {
        sessionController.dispatch({
            type: 'begin-transition',
            phase: 'crossing',
            targetChapterId,
        });
    };

    const completeChapterTransition = (targetChapterId: string, wordIndex = 0) => {
        cursor = Math.max(0, Math.min(activeWords.length - 1, Math.floor(wordIndex)));
        sessionController.dispatch({
            type: 'complete-transition',
            chapterId: targetChapterId,
            wordIndex: cursor,
        });
        previousProjector.reset(previousContainer);
        nextProjector.reset(nextContainer);
        projectFrame(true);
    };

    const runRsvp = (durationMs: number) => {
        const targetDuration = Math.max(0, durationMs);
        while (
            elapsedMs < targetDuration
            && cursor < activeWords.length
            && sessionController.getSnapshot().playing
            && sessionController.getSnapshot().transport === 'rsvp'
        ) {
            const frame = projectFrame(framesAdvanced % 3 === 0);
            const interval = getFrameTargetInterval(
                frame,
                densities,
                activeWords[frame.startIndex - 1],
                Math.max(1, wpm),
            );
            elapsedMs += interval;
            cursor = frame.startIndex + frame.sourceWordCount;
            framesAdvanced += 1;

            if (cursor < activeWords.length && framesAdvanced % 3 === 0) {
                projectFrame(true);
            }
        }
    };

    const snapshot = (): ReaderBenchmarkSnapshot => {
        const session = sessionController.getSnapshot();
        return {
            elapsedMs,
            framesAdvanced,
            centerProjections,
            riverProjectionCalls,
            riverRebuilds,
            riverNodesCreated,
            cursor,
            mode: session.mode,
            transport: session.transport,
            playing: session.playing,
        };
    };

    return {
        playRsvp,
        claimTts,
        releaseTts,
        seek,
        beginSummary,
        completeSummary,
        beginChapterTransition,
        completeChapterTransition,
        runRsvp,
        snapshot,
    };
};