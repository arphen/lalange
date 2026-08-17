import React from 'react';
import { type ChapterDocType, type GlobalSummaryType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';
import type { StructureMode } from '../../core/ingest/structure';
import { clsx } from 'clsx';
import { BookOpen, ChevronDown, ChevronRight, ListTree, MapPin, Search, X } from 'lucide-react';
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
    structureMode?: StructureMode;
    onPlayGlobalSummary?: (summary: GlobalSummaryType) => void;
    onClose?: () => void;
    isOpen?: boolean;
    isModal?: boolean;
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
    structureMode,
    onPlayGlobalSummary,
    onClose,
    isOpen = false,
    isModal = false,
    chapterHandoffSelection = null,
    chapterHandoffActive = false,
}) => {
    const [showRecaps, setShowRecaps] = React.useState<boolean | null>(() => (
        activeSummaryId ? true : null
    ));
    const [searchQuery, setSearchQuery] = React.useState('');
    const [expandedChapterIds, setExpandedChapterIds] = React.useState<Set<string>>(new Set());
    const [collapsedChapterIds, setCollapsedChapterIds] = React.useState<Set<string>>(new Set());
    const tabsRef = React.useRef<HTMLDivElement>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const activeDestinationRef = React.useRef<HTMLButtonElement>(null);
    const latestWordIndexRef = React.useRef(currentWordIndex ?? 0);
    const [sampledProgress, setSampledProgress] = React.useState({
        chapterId: currentChapter?.id,
        wordIndex: currentWordIndex ?? 0,
    });
    const recapsExpanded = showRecaps ?? Boolean(activeSummaryId);
    const sectionInfoLabel = 'Analysis ranges are generated inside each reading section for density work and recaps.';
    const isReformattedStructure = structureMode === 'generated' || structureMode === 'hybrid';
    const structureCountLabel = isReformattedStructure ? 'section' : 'chapter';

    React.useEffect(() => {
        if (isOpen && isModal) closeButtonRef.current?.focus();
    }, [isOpen, isModal]);

    React.useEffect(() => {
        latestWordIndexRef.current = currentWordIndex ?? 0;
    }, [currentWordIndex]);

    React.useEffect(() => {
        const chapterId = currentChapter?.id;

        if (chapterId == null) return;

        const interval = window.setInterval(() => {
            setSampledProgress({
                chapterId,
                wordIndex: latestWordIndexRef.current,
            });
        }, 2000);

        return () => window.clearInterval(interval);
    }, [currentChapter?.id]);

    const displayWordIndex = sampledProgress.chapterId === currentChapter?.id
        ? sampledProgress.wordIndex
        : currentWordIndex ?? 0;

    // Filter out image chapters
    const displayChapters = chapters.filter(isReadingChapter);
    const readingSectionNoun = displayChapters.length === 1 ? 'section' : 'sections';
    const hasPageGrouping = displayChapters.some((chapter) => (
        chapter.metadata?.reformationReason === 'page-sequence'
        || chapter.metadata?.reformationReason === 'short-section-merge'
    ));
    const hasLongSectionSplits = displayChapters.some((chapter) => (
        chapter.metadata?.reformationReason === 'long-section-split'
    ));
    const structureNotice = structureMode === 'generated'
        ? `This edition used page-based structure. XYZ grouped it into ${displayChapters.length} reading ${readingSectionNoun}.`
        : structureMode === 'hybrid'
            ? hasLongSectionSplits && !hasPageGrouping
                ? `This edition uses mixed structure. XYZ split long authored sections into ${displayChapters.length} reading ${readingSectionNoun}.`
                : `This edition uses mixed structure. XYZ grouped page-like passages into ${displayChapters.length} reading ${readingSectionNoun}.`
            : null;

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

    const destinationCount = displayChapters.reduce(
        (count, chapter) => count + 1 + (chapter.subchapters?.length || 0),
        0,
    );
    const showSearch = destinationCount >= 12;
    const normalizedSearchQuery = searchQuery
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .trim();
    const visibleChapters = displayChapters
        .map((chapter) => {
            if (!normalizedSearchQuery) return { chapter, subchapters: chapter.subchapters || [] };

            const matchesChapter = chapter.title
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase()
                .includes(normalizedSearchQuery);
            const subchapters = (chapter.subchapters || []).filter((sub) => getSubchapterDisplayName(sub, chapter.content)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase()
                .includes(normalizedSearchQuery));

            return matchesChapter || subchapters.length > 0
                ? { chapter, subchapters: matchesChapter ? chapter.subchapters || [] : subchapters }
                : null;
        })
        .filter((entry): entry is { chapter: ChapterDocType; subchapters: NonNullable<ChapterDocType['subchapters']> } => entry !== null);

    const activeSubchapterStart = currentChapter?.subchapters?.find((sub, index, subchapters) => (
        currentWordIndex !== undefined
        && currentWordIndex >= sub.startWordIndex
        && (currentWordIndex < sub.endWordIndex || (index === subchapters.length - 1 && currentWordIndex >= sub.startWordIndex))
    ))?.startWordIndex;

    React.useEffect(() => {
        if (!isOpen || showRecaps || !activeDestinationRef.current) return;
        activeDestinationRef.current.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, [activeSubchapterStart, currentChapter?.id, isOpen, showRecaps]);

    const toggleChapterExpansion = (chapterId: string, isExpanded: boolean) => {
        if (isExpanded) {
            setExpandedChapterIds((current) => {
                const next = new Set(current);
                next.delete(chapterId);
                return next;
            });
            setCollapsedChapterIds((current) => new Set(current).add(chapterId));
            return;
        }

        setCollapsedChapterIds((current) => {
            const next = new Set(current);
            next.delete(chapterId);
            return next;
        });
        setExpandedChapterIds((current) => new Set(current).add(chapterId));
    };

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!tabsRef.current) return;

        const tabs = Array.from(tabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const currentIndex = tabs.indexOf(event.currentTarget);
        if (currentIndex < 0) return;

        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = tabs.length - 1;
        }

        if (nextIndex === null) return;

        event.preventDefault();
        setShowRecaps(nextIndex === 1);
        tabs[nextIndex].focus();
    };

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
            <div className="reader-contents-header">
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="reader-contents-kicker">Reading index</p>
                            <h2 id="reader-contents-title" className="reader-contents-title">Contents</h2>
                            <div className="reader-contents-meta">
                                <span>{displayChapters.length} {displayChapters.length === 1 ? structureCountLabel : `${structureCountLabel}s`}</span>
                                <span>{timeBank} total</span>
                            </div>
                        </div>
                        {onClose && (
                            <button
                                ref={closeButtonRef}
                                type="button"
                                onClick={onClose}
                                className="reader-contents-close"
                                title="Close contents"
                                aria-label="Close contents"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        )}
                    </div>
                    {structureNotice && (
                        <p className="reader-contents-notice" data-testid="structure-notice">
                            {structureNotice}
                        </p>
                    )}
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
            </div>

            {showSearch && (
                <label className="reader-contents-search">
                    <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only">Search contents</span>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search chapters and sections"
                        aria-label="Search chapters and sections"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            className="reader-contents-search-clear"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear contents search"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </label>
            )}

            {globalSummaries.length > 0 && (
                <div ref={tabsRef} className="reader-contents-tabs" role="tablist" aria-label="Reader views">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={!recapsExpanded}
                        aria-controls="reader-contents-list"
                        tabIndex={recapsExpanded ? -1 : 0}
                        className={clsx('reader-contents-tab', !recapsExpanded && 'reader-contents-tab--active')}
                        onClick={() => setShowRecaps(false)}
                        onKeyDown={handleTabKeyDown}
                    >
                        Contents
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={recapsExpanded}
                        aria-controls="reader-recaps-list"
                        tabIndex={recapsExpanded ? 0 : -1}
                        className={clsx('reader-contents-tab', recapsExpanded && 'reader-contents-tab--active')}
                        onClick={() => setShowRecaps(true)}
                        onKeyDown={handleTabKeyDown}
                    >
                        Recaps <span className="reader-contents-tab-count">{globalSummaries.length}</span>
                    </button>
                </div>
            )}

            <div
                id={recapsExpanded ? 'reader-recaps-list' : 'reader-contents-list'}
                role="tabpanel"
                aria-label={recapsExpanded ? 'Recaps' : 'Contents'}
                className="reader-scroll-surface flex-1 overflow-y-auto p-3 space-y-2"
            >
                {!recapsExpanded && visibleChapters.map(({ chapter, subchapters }, chapterIndex) => {
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
                    const hasSections = subchapters.length > 0;
                    const isExpanded = hasSections
                        && !collapsedChapterIds.has(chapter.id)
                        && (expandedChapterIds.has(chapter.id) || isCurrent || !currentChapter && chapterIndex === 0 || Boolean(normalizedSearchQuery));
                    return (
                        <div key={chapter.id} className="relative group flex flex-col">
                            <div className="relative flex items-stretch">
                                <button
                                    ref={isCurrent && (!hasSections || activeSubchapterStart === undefined) ? activeDestinationRef : undefined}
                                    type="button"
                                    onClick={() => {
                                        if (isCurrent) {
                                            onLoadChapter(chapter.id, currentWordIndex);
                                        } else {
                                            onLoadChapter(chapter.id);
                                        }
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
                                        <div className="flex justify-between items-start gap-2 w-full mb-1">
                                            <span className="min-w-0 flex-1">
                                                <span className="reader-chapter-ordinal">{String(chapter.index + 1).padStart(2, '0')}</span>
                                                <span className="reader-chapter-title">{chapter.title}</span>
                                            </span>
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

                                        <div className="flex justify-between items-center text-[11px] tracking-wide">
                                            <span className={isReady ? "text-white/55" : "text-dune-shadow"}>
                                                {readingTime || "Preparing text"}
                                            </span>
                                            {isProcessing && (
                                                <span className="text-cyan-300/70">Still importing</span>
                                            )}
                                            {isCurrent && (
                                                <span className="reader-progress-value">{chapterProgressPercent}%</span>
                                            )}
                                        </div>
                                        {isCurrent && (
                                            <div
                                                className="reader-progress-track mt-2"
                                                role="progressbar"
                                                aria-label={`${chapter.title} reading progress`}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-valuenow={chapterProgressPercent}
                                                data-testid={`chapter-progress-${chapter.id}`}
                                            >
                                                <span style={{ width: `${chapterProgressPercent}%` }} />
                                            </div>
                                        )}
                                    </div>
                                </button>
                                {hasSections && (
                                    <button
                                        type="button"
                                        className="reader-chapter-disclosure"
                                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} sections for ${chapter.title}`}
                                        aria-expanded={isExpanded}
                                        onClick={() => toggleChapterExpansion(chapter.id, isExpanded)}
                                    >
                                        <ChevronDown className={clsx('h-4 w-4 transition-transform', !isExpanded && '-rotate-90')} />
                                    </button>
                                )}
                            </div>

                            {isExpanded && hasSections && (
                                <div className="reader-section-list pl-3 ml-2 mb-2 space-y-1">
                                    <div className="reader-section-heading">
                                        <ListTree className="w-3 h-3" aria-hidden="true" />
                                        <span>Reading sections</span>
                                        <span className="group/section-info relative inline-flex">
                                            <button
                                                type="button"
                                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[9px] font-bold leading-none text-white/60 transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/10 hover:text-cyan-200 focus:outline-none focus:ring-1 focus:ring-cyan-300/40"
                                                aria-label="About XYZ-created sections"
                                                aria-describedby="xyz-created-sections-help"
                                            >
                                                i
                                            </button>
                                            <span
                                                id="xyz-created-sections-help"
                                                role="tooltip"
                                                className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 rounded border border-white/15 bg-black/90 px-2 py-1 text-[10px] normal-case tracking-normal text-white/85 opacity-0 shadow-lg transition-opacity duration-100 group-hover/section-info:opacity-100 group-focus-within/section-info:opacity-100"
                                            >
                                                {sectionInfoLabel}
                                            </span>
                                        </span>
                                    </div>
                                    <p className="reader-section-help">Jump within this chapter by its opening words.</p>
                                    {subchapters.map((sub, idx) => {
                                        // Check if we have ANY content for this subchapter (start index exists in content array)
                                        const currentContentLength = chapter.content?.length || 0;
                                        const hasStarted = currentContentLength > sub.startWordIndex;
                                        // Check if this is the currently active subchapter being read
                                        const isActive = isCurrent && currentWordIndex !== undefined &&
                                            currentWordIndex >= sub.startWordIndex &&
                                            (currentWordIndex < sub.endWordIndex || (idx === subchapters.length - 1 && currentWordIndex >= sub.startWordIndex));
                                        const sectionLength = Math.max(1, sub.endWordIndex - sub.startWordIndex);
                                        const sectionProgress = isCurrent && displayWordIndex !== undefined
                                            ? Math.min(1, Math.max(0, (displayWordIndex - sub.startWordIndex) / sectionLength))
                                            : 0;
                                        const isHandoffSelection = chapterHandoffActive
                                            && chapterHandoffSelection?.chapterId === chapter.id
                                            && chapterHandoffSelection.startWordIndex === sub.startWordIndex;

                                        return (
                                                <div key={`${chapter.id}-${sub.startWordIndex}`} className="relative">
                                                <button
                                                    ref={isActive ? activeDestinationRef : undefined}
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
                                                        <span className="reader-section-title">{getSubchapterDisplayName(sub, chapter.content)}</span>
                                                        {isActive && (
                                                            <span className="ml-auto text-[9px] uppercase tracking-wide text-emerald-300">
                                                                {Math.round(sectionProgress * 100)}%
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

                {!recapsExpanded && visibleChapters.length === 0 && (
                    <div className="reader-contents-empty">
                        <p>{normalizedSearchQuery ? 'No chapters or sections match this search.' : 'No readable chapters are available yet.'}</p>
                        {normalizedSearchQuery && (
                            <button type="button" onClick={() => setSearchQuery('')}>
                                Clear search
                            </button>
                        )}
                    </div>
                )}

                {recapsExpanded && globalSummaries.map((summary, idx) => {
                            const isActive = activeSummaryId === summary.id;
                            const wordRange = `${summary.startWordIndex.toLocaleString()}-${summary.endWordIndex.toLocaleString()}`;
                            return (
                                <div key={summary.id} className="reader-recap-entry">
                                    <button
                                        type="button"
                                        onClick={() => onPlayGlobalSummary?.(summary)}
                                        className={clsx(
                                            "reader-recap-row w-full text-left",
                                            isActive
                                                ? "reader-recap-row--active"
                                                : "text-gray-400 hover:text-cyan-200"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-cyan-400">▶</span>
                                            <span className="font-bold">Summary {idx + 1}</span>
                                        </div>
                                        <div className="reader-recap-meta">
                                            Words {wordRange}
                                        </div>
                                    </button>
                                </div>
                            );
                        })}
            </div>

        </div>
    );
};
