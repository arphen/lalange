import React from 'react';
import { type ChapterDocType, type GlobalSummaryType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';
import { clsx } from 'clsx';
import { BookOpen, ChevronRight, MapPin, X } from 'lucide-react';
import { getSubchapterDisplayName } from './Sidebar.utils';
import { isReadingChapter } from './readerNavigation';

interface SidebarProps {
    chapters: ChapterDocType[];
    currentChapter: ChapterDocType | null;
    onLoadChapter: (id: string, wordIndex?: number) => void;
    wpm: number;
    className?: string;
    currentWordIndex?: number;
    now: number;
    activeSummaryId?: string | null;
    globalSummaries?: GlobalSummaryType[];
    onPlayGlobalSummary?: (summary: GlobalSummaryType) => void;
    onClose?: () => void;
    chapterHandoffSelection?: {
        chapterId: string;
        startWordIndex: number | null;
    } | null;
    chapterHandoffActive?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
    chapters,
    currentChapter,
    onLoadChapter,
    wpm,
    className,
    currentWordIndex,
    now,
    activeSummaryId,
    globalSummaries = [],
    onPlayGlobalSummary,
    onClose,
    chapterHandoffSelection = null,
    chapterHandoffActive = false,
}) => {
    // Filter out image chapters
    const displayChapters = chapters.filter(isReadingChapter);

    // Calculate total stats
    const totalWords = displayChapters.reduce((acc, c) => acc + (c.content?.length || 0), 0);
    const totalTimeMinutes = totalWords / wpm;
    const timeBank = formatReadingTime(totalTimeMinutes);
    const currentChapterPosition = displayChapters.findIndex((chapter) => chapter.id === currentChapter?.id);
    const wordsBeforeCurrentChapter = currentChapterPosition > 0
        ? displayChapters
            .slice(0, currentChapterPosition)
            .reduce((total, chapter) => total + (chapter.content?.length || 0), 0)
        : 0;
    const bookProgress = currentChapterPosition >= 0 && totalWords > 0
        ? Math.min(1, Math.max(0, (wordsBeforeCurrentChapter + (currentWordIndex || 0)) / totalWords))
        : 0;
    const bookProgressPercent = Math.round(bookProgress * 100);

    const getChapterReadingTime = (chapter: ChapterDocType) => {
        const reportedWords = chapter.content?.length || 0;

        if (chapter.status === 'ready') {
            const minutes = reportedWords / wpm;
            return formatReadingTime(minutes);
        }

        if (chapter.status === 'processing') {
            const speed = chapter.processingSpeed || 0; // WPM
            const lastChunkTime = chapter.lastChunkCompletedAt || 0;

            if (speed > 0 && lastChunkTime > 0) {
                const timeSinceLastChunk = (now - lastChunkTime) / 60000;
                const projectedNewWords = Math.floor(speed * timeSinceLastChunk);
                const estimatedTotalWords = reportedWords + projectedNewWords;
                const minutes = estimatedTotalWords / wpm;
                return `~${formatReadingTime(minutes)}`;
            } else if (reportedWords > 0) {
                const minutes = reportedWords / wpm;
                return `~${formatReadingTime(minutes)}`;
            }
        }

        return null;
    };

    return (
        <div className={clsx("reader-contents flex flex-col h-full font-mono text-xs", className)}>
            {/* Header */}
            <div className="reader-contents-header p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-white font-bold tracking-wide mb-1">Contents</h3>
                    <div className="flex justify-between text-gray-500">
                        <span>{displayChapters.length} {displayChapters.length === 1 ? 'chapter' : 'chapters'}</span>
                        <span>{timeBank} total</span>
                    </div>
                    <div
                        className="reader-contents-progress mt-3"
                        role="progressbar"
                        aria-label="Book progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={bookProgressPercent}
                    >
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                            <span>Book progress</span>
                            <span className="reader-progress-value">{bookProgressPercent}%</span>
                        </div>
                        <div className="reader-progress-track mt-1.5">
                            <span style={{ width: `${bookProgressPercent}%` }} />
                        </div>
                    </div>
                </div>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 -mt-1 -mr-1 text-white/60 hover:text-white transition-colors"
                        title="Close contents"
                        aria-label="Close contents"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            <div className="reader-scroll-surface flex-1 overflow-y-auto p-3 space-y-2">
                {/* Global Summaries Section */}
                {globalSummaries.length > 0 && (
                    <div className="mb-3 pb-3 border-b border-cyan-400/15">
                        <div className="text-[10px] text-cyan-300/70 uppercase tracking-widest mb-2 px-1">
                            Recaps
                        </div>
                        {globalSummaries.map((summary, idx) => {
                            const isActive = activeSummaryId === summary.id;
                            const wordRange = `${summary.startWordIndex.toLocaleString()}-${summary.endWordIndex.toLocaleString()}`;
                            return (
                                <div key={summary.id} className="mb-1">
                                    <button
                                        onClick={() => onPlayGlobalSummary?.(summary)}
                                        className={clsx(
                                            "w-full text-left p-2 rounded border transition-all",
                                            isActive 
                                                ? "bg-cyan-950/40 border-cyan-400/40 text-cyan-100"
                                                : "bg-black/20 border-white/5 text-gray-400 hover:border-cyan-400/25 hover:text-cyan-200"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-cyan-400">▶</span>
                                            <span className="font-bold">Summary {idx + 1}</span>
                                        </div>
                                        <div className="text-[9px] text-gray-500 mt-1 truncate">
                                            Words {wordRange}
                                        </div>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
                
                {displayChapters.map(chapter => {
                    const readingTime = getChapterReadingTime(chapter);
                    const isCurrent = currentChapter?.id === chapter.id;
                    const isProcessing = chapter.status === 'processing';
                    const isReady = chapter.status === 'ready';
                    const wordCount = chapter.content?.length || 0;
                    const chapterProgress = isCurrent && wordCount > 0
                        ? Math.min(1, Math.max(0, (currentWordIndex || 0) / wordCount))
                        : 0;
                    const chapterProgressPercent = Math.round(chapterProgress * 100);
                    const chapterIsHandoffTarget = chapterHandoffActive && chapterHandoffSelection?.chapterId === chapter.id;

                    return (
                        <div key={chapter.id} className="relative group flex flex-col">
                            <div className="relative flex items-stretch">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!isCurrent) onLoadChapter(chapter.id);
                                    }}
                                    disabled={!isReady && (!chapter.content || chapter.content.length === 0)}
                                    data-testid="sidebar-chapter-button"
                                    aria-current={isCurrent ? 'page' : undefined}
                                    className={clsx(
                                        "reader-chapter-row flex-1 relative overflow-hidden text-left p-3 transition-colors",
                                        isCurrent ? "reader-chapter-row--active text-white" : "text-gray-400",
                                        (!isReady && (!chapter.content || chapter.content.length === 0)) && "opacity-50 cursor-not-allowed",
                                        chapterHandoffActive && !chapterIsHandoffTarget && "opacity-35",
                                        chapterHandoffActive && chapterIsHandoffTarget && "opacity-95"
                                    )}
                                >
                                    <div className="relative z-10">
                                        <div className="flex justify-between items-center gap-2 w-full mb-1">
                                            <span className="truncate font-bold text-sm">{chapter.title}</span>
                                            {isProcessing && (
                                                <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
                                            )}
                                            {isCurrent ? (
                                                <span className="flex items-center gap-1 text-[9px] uppercase text-emerald-300">
                                                    <BookOpen className="w-3 h-3" /> Reading
                                                </span>
                                            ) : (
                                                <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                                            )}
                                        </div>

                                        <div className="flex justify-between items-center text-[10px] tracking-wide">
                                            <span className={isReady ? "text-white/50" : "text-dune-shadow"}>
                                                {readingTime || "Preparing text"}
                                            </span>
                                            {isProcessing && (
                                                <span className="text-cyan-300/70">Still importing</span>
                                            )}
                                            {isCurrent && (
                                                <span className="reader-progress-value">{chapterProgressPercent}%</span>
                                            )}
                                        </div>
                                        <div
                                            className={clsx("reader-progress-track mt-2", !isCurrent && "reader-progress-track--idle")}
                                            role="progressbar"
                                            aria-label={`${chapter.title} reading progress`}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={chapterProgressPercent}
                                            data-testid={`chapter-progress-${chapter.id}`}
                                        >
                                            <span style={{ width: `${chapterProgressPercent}%` }} />
                                        </div>
                                    </div>
                                </button>
                            </div>

                            {/* Subchapters */}
                            {chapter.subchapters && chapter.subchapters.length > 0 && (
                                <div className="reader-section-list pl-3 ml-2 mb-2 space-y-1">
                                    {chapter.subchapters.map((sub, idx) => {
                                        // Check if we have ANY content for this subchapter (start index exists in content array)
                                        const currentContentLength = chapter.content?.length || 0;
                                        const hasStarted = currentContentLength > sub.startWordIndex;
                                        // Check if this is the currently active subchapter being read
                                        const isActive = isCurrent && currentWordIndex !== undefined &&
                                            currentWordIndex >= sub.startWordIndex &&
                                            (currentWordIndex < sub.endWordIndex || (idx === chapter.subchapters!.length - 1 && currentWordIndex >= sub.startWordIndex));
                                        const sectionLength = Math.max(1, sub.endWordIndex - sub.startWordIndex);
                                        const sectionProgress = isCurrent && currentWordIndex !== undefined
                                            ? Math.min(1, Math.max(0, (currentWordIndex - sub.startWordIndex) / sectionLength))
                                            : 0;
                                        const isHandoffSelection = chapterHandoffActive
                                            && chapterHandoffSelection?.chapterId === chapter.id
                                            && chapterHandoffSelection.startWordIndex === sub.startWordIndex;

                                        return (
                                            <div key={idx} className="relative">
                                                <button
                                                    type="button"
                                                    className={clsx(
                                                        "reader-section-row w-full min-h-11 relative overflow-hidden flex items-center gap-2 px-3 py-2 text-left transition-colors",
                                                        isActive ? "reader-section-row--active text-white" : "text-white/60 hover:text-white",
                                                        !hasStarted && "opacity-40 cursor-not-allowed",
                                                        chapterHandoffActive && !isHandoffSelection && "opacity-25",
                                                        chapterHandoffActive && isHandoffSelection && "opacity-100 ring-1 ring-emerald-300/40"
                                                    )}
                                                    onClick={() => {
                                                        if (hasStarted) onLoadChapter(chapter.id, sub.startWordIndex);
                                                    }}
                                                    disabled={!hasStarted}
                                                    aria-current={isActive ? 'location' : undefined}
                                                    data-testid={`subchapter-btn-${idx}`}
                                                >
                                                    <span className="relative z-10 contents">
                                                        {isActive ? <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-white/30 shrink-0" />}
                                                        <span className="truncate text-xs">{getSubchapterDisplayName(sub, chapter.content)}</span>
                                                        {isActive && (
                                                            <span className="ml-auto text-[9px] uppercase tracking-wide text-emerald-300">
                                                                Here · {Math.round(sectionProgress * 100)}%
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

        </div>
    );
};
