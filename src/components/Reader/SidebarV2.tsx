import React from 'react';
import { type ChapterDocType, type GlobalSummaryType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';
import type { StructureMode } from '../../core/ingest/structure';
import { clsx } from 'clsx';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Ellipsis, Info, ListTree, MapPin, Search, X } from 'lucide-react';
import { getSubchapterDisplayName } from './Sidebar.utils';
import { isReadingChapter } from './readerNavigation';

type ContentsView =
    | { kind: 'outline' }
    | { kind: 'search'; query: string }
    | { kind: 'passages'; chapterId: string }
    | { kind: 'recaps' }
    | { kind: 'about'; returnTo: { kind: 'outline' } | { kind: 'passages'; chapterId: string } };

export interface SidebarV2Props {
    chapters: ChapterDocType[];
    currentChapter: ChapterDocType | null;
    onLoadChapter: (id: string, wordIndex?: number) => void;
    onFocusCurrent?: () => void;
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

type Passage = NonNullable<ChapterDocType['subchapters']>[number];

const normalizeSearchText = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

const getPassages = (chapter: ChapterDocType): Passage[] => (
    (chapter.subchapters || []).filter((passage) => passage.startWordIndex > 0)
);

const getSections = (chapter: ChapterDocType) => chapter.subchapters || [];

const getStructureExplanation = (structureMode: StructureMode | undefined, chapters: ChapterDocType[]) => {
    const hasLongParts = chapters.some((chapter) => chapter.metadata?.reformationReason === 'long-section-split');

    if (structureMode === 'generated') {
        return 'This file did not include a reliable contents list, so reading stops were created from the order of its text. The book\'s words were not rewritten.';
    }

    if (hasLongParts) {
        return 'Some long parts are shown as shorter reading stops so they open and navigate reliably. The book\'s words were not rewritten.';
    }

    if (structureMode === 'hybrid') {
        return 'This file did not include a fully reliable contents list, so some reading stops were organized from the order of its text. The book\'s words were not rewritten.';
    }

    return 'This list follows the chapter headings provided by the book.';
};

const getChapterContext = (summary: GlobalSummaryType, chapters: ChapterDocType[]) => {
    const startChapter = chapters.find((chapter) => chapter.id === summary.startChapterId);
    const endChapter = chapters.find((chapter) => chapter.id === summary.endChapterId);

    if (!startChapter) return null;
    if (!endChapter || endChapter.id === startChapter.id) return startChapter.title;
    return `${startChapter.title} - ${endChapter.title}`;
};

export const SidebarV2: React.FC<SidebarV2Props> = ({
    chapters,
    currentChapter,
    onLoadChapter,
    onFocusCurrent,
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
    const displayChapters = chapters.filter(isReadingChapter);
    const [view, setView] = React.useState<ContentsView>(() => (
        activeSummaryId ? { kind: 'recaps' } : { kind: 'outline' }
    ));
    const [actionChapterId, setActionChapterId] = React.useState<string | null>(null);
    const [expandedChapterIds, setExpandedChapterIds] = React.useState<Set<string>>(() => new Set());
    const [collapsedChapterIds, setCollapsedChapterIds] = React.useState<Set<string>>(() => new Set());
    const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const tabsRef = React.useRef<HTMLDivElement>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const activeDestinationRef = React.useRef<HTMLButtonElement>(null);
    const outlineListRef = React.useRef<HTMLDivElement>(null);
    const outlineScrollTopRef = React.useRef(0);
    const restoreOutlineScrollRef = React.useRef(false);

    const currentView = view;
    const totalPassageCount = displayChapters.reduce((count, chapter) => count + getPassages(chapter).length, 0);
    const searchableDestinationCount = displayChapters.length + totalPassageCount;
    const canSearch = searchableDestinationCount >= 12;
    const recapsExpanded = currentView.kind === 'recaps';
    const passageChapter = currentView.kind === 'passages'
        ? displayChapters.find((chapter) => chapter.id === currentView.chapterId) || null
        : null;
    const passageRows = passageChapter ? getPassages(passageChapter) : [];
    const normalizedSearchQuery = normalizeSearchText(searchQuery.trim());
    const totalWords = displayChapters.reduce((total, chapter) => total + (chapter.content?.length || 0), 0);
    const totalReadingTime = formatReadingTime(totalWords / wpm);
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

    React.useEffect(() => {
        if (isOpen && isModal) closeButtonRef.current?.focus();
    }, [isOpen, isModal]);

    React.useEffect(() => {
        if (!isOpen || currentView.kind !== 'outline' || !outlineListRef.current) return;

        const frame = window.requestAnimationFrame(() => {
            if (restoreOutlineScrollRef.current) {
                if (outlineListRef.current) outlineListRef.current.scrollTop = outlineScrollTopRef.current;
                restoreOutlineScrollRef.current = false;
                return;
            }

            activeDestinationRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [currentView.kind, isOpen]);

    React.useEffect(() => {
        if (currentView.kind !== 'search') return;
        const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [currentView.kind]);

    const getChapterReadingTime = (chapter: ChapterDocType) => {
        const reportedWords = chapter.content?.length || 0;

        if (chapter.status === 'ready') return formatReadingTime(reportedWords / wpm);

        if (chapter.status === 'processing') {
            const speed = chapter.processingSpeed || 0;
            const lastChunkTime = chapter.lastChunkCompletedAt || 0;

            if (speed > 0 && lastChunkTime > 0) {
                const timeSinceLastChunk = (now - lastChunkTime) / 60000;
                const estimatedTotalWords = reportedWords + Math.floor(speed * timeSinceLastChunk);
                return `~${formatReadingTime(estimatedTotalWords / wpm)}`;
            }

            if (reportedWords > 0) return `~${formatReadingTime(reportedWords / wpm)}`;
        }

        return null;
    };

    const getChapterProgressPercent = (chapter: ChapterDocType) => {
        const chapterPosition = displayChapters.findIndex((candidate) => candidate.id === chapter.id);
        if (currentChapterPosition < 0 || chapterPosition < 0) return 0;
        if (chapterPosition < currentChapterPosition) return 100;
        if (chapterPosition > currentChapterPosition) return 0;

        const wordCount = chapter.content?.length || 0;
        return wordCount > 0
            ? Math.min(100, Math.max(0, Math.round(((currentWordIndex || 0) / wordCount) * 100)))
            : 0;
    };

    const getSectionProgressPercent = (chapter: ChapterDocType, section: Passage) => {
        if (currentChapter?.id !== chapter.id) return 0;

        const wordIndex = currentWordIndex ?? 0;
        if (wordIndex >= section.endWordIndex) {
            return 100;
        }
        if (wordIndex <= section.startWordIndex) return 0;

        const sectionLength = Math.max(1, section.endWordIndex - section.startWordIndex);
        return Math.min(100, Math.max(0, Math.round(((wordIndex - section.startWordIndex) / sectionLength) * 100)));
    };

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

    const isCurrentPassage = (chapter: ChapterDocType, passage: Passage) => {
        if (currentChapter?.id !== chapter.id) return false;
        const wordIndex = currentWordIndex ?? 0;
        return wordIndex >= passage.startWordIndex
            && (wordIndex < passage.endWordIndex || passage === getPassages(chapter).at(-1));
    };

    const openPassages = (chapter: ChapterDocType) => {
        if (outlineListRef.current) outlineScrollTopRef.current = outlineListRef.current.scrollTop;
        setActionChapterId(null);
        setHeaderMenuOpen(false);
        setView({ kind: 'passages', chapterId: chapter.id });
    };

    const returnToOutline = () => {
        restoreOutlineScrollRef.current = true;
        setActionChapterId(null);
        setHeaderMenuOpen(false);
        setView({ kind: 'outline' });
    };

    const openSearch = () => {
        setActionChapterId(null);
        setHeaderMenuOpen(false);
        setSearchQuery('');
        setView({ kind: 'search', query: '' });
    };

    const openAbout = () => {
        setHeaderMenuOpen(false);
        setView({
            kind: 'about',
            returnTo: currentView.kind === 'passages'
                ? { kind: 'passages', chapterId: currentView.chapterId }
                : { kind: 'outline' },
        });
    };

    const handleEscape = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape') return;
        if (actionChapterId || headerMenuOpen) {
            event.preventDefault();
            event.stopPropagation();
            setActionChapterId(null);
            setHeaderMenuOpen(false);
            return;
        }

        if (currentView.kind === 'search' || currentView.kind === 'passages') {
            event.preventDefault();
            event.stopPropagation();
            returnToOutline();
        } else if (currentView.kind === 'about') {
            event.preventDefault();
            event.stopPropagation();
            setView(currentView.returnTo);
        }
    };

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!tabsRef.current) return;
        const tabs = Array.from(tabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const currentIndex = tabs.indexOf(event.currentTarget);
        if (currentIndex < 0) return;

        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        setView(nextIndex === 1 ? { kind: 'recaps' } : { kind: 'outline' });
        tabs[nextIndex].focus();
    };

    const handleChapterClick = (chapter: ChapterDocType) => {
        if (chapter.id === currentChapter?.id) {
            if (onFocusCurrent) onFocusCurrent();
            else onLoadChapter(chapter.id, currentWordIndex);
            return;
        }

        onLoadChapter(chapter.id);
    };

    const handlePassageClick = (chapter: ChapterDocType, startWordIndex: number) => {
        onLoadChapter(chapter.id, startWordIndex);
    };

    const searchResults = normalizedSearchQuery
        ? displayChapters.flatMap((chapter) => {
            const results: Array<{
                type: 'chapter' | 'passage';
                chapter: ChapterDocType;
                passage?: Passage;
            }> = [];
            if (normalizeSearchText(chapter.title).includes(normalizedSearchQuery)) {
                results.push({ type: 'chapter', chapter });
            }
            getPassages(chapter).forEach((passage) => {
                const label = getSubchapterDisplayName(passage, chapter.content);
                if (normalizeSearchText(label).includes(normalizedSearchQuery)) {
                    results.push({ type: 'passage', chapter, passage });
                }
            });
            return results;
        })
        : [];

    const renderChapterRow = (chapter: ChapterDocType) => {
        const isCurrent = currentChapter?.id === chapter.id;
        const isReady = chapter.status === 'ready';
        const hasContent = Boolean(chapter.content?.length);
        const sections = getSections(chapter);
        const hasSections = sections.length > 0;
        const isExpanded = hasSections
            && !collapsedChapterIds.has(chapter.id)
            && (expandedChapterIds.has(chapter.id) || isCurrent || (!currentChapter && chapter === displayChapters[0]));
        const isHandoffTarget = chapterHandoffActive && chapterHandoffSelection?.chapterId === chapter.id;
        const isActionsOpen = actionChapterId === chapter.id;
        const readingTime = getChapterReadingTime(chapter);
        const chapterProgressPercent = getChapterProgressPercent(chapter);

        return (
            <div key={chapter.id} className={clsx('reader-chapter-entry', isActionsOpen && 'reader-chapter-entry--menu-open')}>
                <div className={clsx(
                    'reader-chapter-line',
                    isCurrent && 'reader-chapter-line--active',
                    chapterHandoffActive && !isHandoffTarget && 'reader-chapter-line--dimmed',
                    chapterHandoffActive && isHandoffTarget && 'reader-chapter-line--handoff',
                )}>
                    <button
                        ref={isCurrent && (!hasSections || !isExpanded) ? activeDestinationRef : undefined}
                        type="button"
                        onClick={() => handleChapterClick(chapter)}
                        disabled={!isReady && !hasContent}
                        data-testid="sidebar-chapter-button"
                        aria-current={isCurrent ? 'page' : undefined}
                        className="reader-chapter-row"
                    >
                        <span className="reader-chapter-ordinal" aria-hidden="true">{String(chapter.index + 1).padStart(2, '0')}</span>
                        <span className="reader-chapter-copy">
                            <span className="reader-chapter-title">{chapter.title}</span>
                            <span className="reader-chapter-meta">
                                {isCurrent ? 'Current' : (readingTime || (chapter.status === 'processing' ? 'Preparing text' : 'Unavailable'))}
                            </span>
                        </span>
                    </button>
                    <span
                        className="reader-chapter-progress"
                        role="progressbar"
                        aria-label={`${chapter.title} reading progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={chapterProgressPercent}
                        data-testid={`chapter-progress-${chapter.id}`}
                    >
                        <span style={{ width: `${chapterProgressPercent}%` }} />
                    </span>
                    {hasSections && (
                        <button
                            type="button"
                            className="reader-chapter-disclosure"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} sections for ${chapter.title}`}
                            aria-expanded={isExpanded}
                            aria-controls={`reader-sections-${chapter.id}`}
                            onClick={() => toggleChapterExpansion(chapter.id, isExpanded)}
                        >
                            {isExpanded
                                ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    )}
                    {hasSections && (
                        <button
                            type="button"
                            className="reader-chapter-more"
                            aria-label={`More options for ${chapter.title}`}
                            aria-expanded={isActionsOpen}
                            onClick={() => {
                                setHeaderMenuOpen(false);
                                setActionChapterId(isActionsOpen ? null : chapter.id);
                            }}
                        >
                            <Ellipsis className="h-5 w-5" aria-hidden="true" />
                        </button>
                    )}
                </div>
                {isActionsOpen && (
                    <div className="reader-chapter-actions" role="menu" aria-label={`Actions for ${chapter.title}`}>
                        <button type="button" role="menuitem" onClick={() => openPassages(chapter)}>
                            Browse passages
                        </button>
                        {isCurrent && (currentWordIndex ?? 0) > 0 && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setActionChapterId(null);
                                    onLoadChapter(chapter.id, 0);
                                }}
                            >
                                Start from beginning
                            </button>
                        )}
                    </div>
                )}
                {isExpanded && (
                    <div id={`reader-sections-${chapter.id}`} className="reader-section-list" aria-label={`${chapter.title} sections`}>
                        <div className="reader-section-heading">
                            <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Sections</span>
                            <span className="reader-section-count">{sections.length}</span>
                        </div>
                        {sections.map((section, sectionIndex) => {
                            const hasStarted = (chapter.content?.length || 0) > section.startWordIndex;
                            const isActive = isCurrent
                                && (currentWordIndex ?? 0) >= section.startWordIndex
                                && ((currentWordIndex ?? 0) < section.endWordIndex || (sectionIndex === sections.length - 1 && (currentWordIndex ?? 0) >= section.startWordIndex));
                            const sectionProgressPercent = getSectionProgressPercent(chapter, section);
                            const isHandoffSelection = chapterHandoffActive
                                && chapterHandoffSelection?.chapterId === chapter.id
                                && chapterHandoffSelection.startWordIndex === section.startWordIndex;

                            return (
                                <button
                                    key={`${chapter.id}-${section.startWordIndex}`}
                                    ref={isActive ? activeDestinationRef : undefined}
                                    type="button"
                                    className={clsx(
                                        'reader-section-row',
                                        isActive && 'reader-section-row--active',
                                        !hasStarted && 'reader-section-row--unavailable',
                                        chapterHandoffActive && !isHandoffSelection && 'reader-section-row--dimmed',
                                        chapterHandoffActive && isHandoffSelection && 'reader-section-row--handoff',
                                    )}
                                    onClick={() => handlePassageClick(chapter, section.startWordIndex)}
                                    disabled={!hasStarted}
                                    aria-current={isActive ? 'location' : undefined}
                                    data-testid={`subchapter-btn-${sectionIndex}`}
                                >
                                    {isActive ? <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                                    <span className="reader-section-copy">
                                        <span className="reader-section-title">{getSubchapterDisplayName(section, chapter.content)}</span>
                                        <span className="reader-section-progress-track" aria-hidden="true">
                                            <span style={{ width: `${sectionProgressPercent}%` }} />
                                        </span>
                                    </span>
                                    {(isActive || sectionProgressPercent === 100) && (
                                        <span className="reader-section-progress-value">{sectionProgressPercent}%</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderHeader = () => {
        const isSearch = currentView.kind === 'search';
        const isPassages = currentView.kind === 'passages';
        const isAbout = currentView.kind === 'about';

        return (
            <div className="reader-contents-header">
                <div className="reader-contents-nav">
                    {isPassages || isAbout ? (
                        <button
                            type="button"
                            className="reader-contents-back"
                            onClick={() => isPassages ? returnToOutline() : setView(currentView.returnTo)}
                            aria-label={isPassages ? 'Back to Contents' : 'Back to contents'}
                        >
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            <span>{isPassages ? 'Contents' : 'Back'}</span>
                        </button>
                    ) : isSearch ? (
                        <label className="reader-contents-search-inline">
                            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="sr-only">Search contents</span>
                            <input
                                ref={searchInputRef}
                                type="search"
                                value={searchQuery}
                                onChange={(event) => {
                                    setSearchQuery(event.target.value);
                                    setView({ kind: 'search', query: event.target.value });
                                }}
                                placeholder="Search chapters and passages"
                                aria-label="Search chapters and passages"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="reader-contents-search-clear"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setView({ kind: 'search', query: '' });
                                    }}
                                    aria-label="Clear contents search"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            )}
                        </label>
                    ) : (
                        <h2 id="reader-contents-title" className="reader-contents-title">Contents</h2>
                    )}
                    {isPassages && passageChapter && <span className="reader-contents-subtitle">{passageChapter.title}</span>}
                    {isAbout && <span className="reader-contents-subtitle">About this contents list</span>}
                    {isSearch && (
                        <button type="button" className="reader-contents-cancel" onClick={returnToOutline}>Cancel</button>
                    )}
                    {!isSearch && !isPassages && !isAbout && canSearch && (
                        <button type="button" className="reader-contents-icon-button" onClick={openSearch} aria-label="Search contents" title="Search contents">
                            <Search className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                    {!isSearch && !isAbout && (
                        <div className="relative">
                            <button
                                type="button"
                                className="reader-contents-icon-button"
                                aria-label="More contents options"
                                aria-expanded={headerMenuOpen}
                                title="More contents options"
                                onClick={() => {
                                    setActionChapterId(null);
                                    setHeaderMenuOpen((open) => !open);
                                }}
                            >
                                <Info className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {headerMenuOpen && (
                                <div className="reader-contents-menu" role="menu" aria-label="Contents options">
                                    <button type="button" role="menuitem" onClick={openAbout}>About this contents list</button>
                                </div>
                            )}
                        </div>
                    )}
                    {onClose && (
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={onClose}
                            className="reader-contents-icon-button reader-contents-close"
                            title="Close contents"
                            aria-label="Close contents"
                        >
                            <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                    )}
                </div>
                {currentView.kind === 'outline' && (
                    <div className="reader-contents-overview">
                        <div className="reader-contents-overview-meta">
                            <span>{displayChapters.length} {displayChapters.length === 1 ? 'chapter' : 'chapters'}</span>
                            <span>{totalReadingTime} total</span>
                        </div>
                        <div
                            className="reader-contents-progress"
                            role="progressbar"
                            aria-label="Book reading progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={bookProgressPercent}
                            data-testid="book-progress"
                        >
                            <div className="reader-contents-progress-label">
                                <span>Book progress</span>
                                <span>{bookProgressPercent}%</span>
                            </div>
                            <div className="reader-progress-track">
                                <span style={{ width: `${bookProgressPercent}%` }} />
                            </div>
                        </div>
                    </div>
                )}
                {isSearch && <h2 id="reader-contents-title" className="sr-only">Search contents</h2>}
                {isPassages && passageChapter && (
                    <h2 id="reader-contents-title" className="reader-contents-title reader-contents-title--passages">Passages</h2>
                )}
                {isAbout && (
                    <h2 id="reader-contents-title" className="reader-contents-title reader-contents-title--passages">About this contents list</h2>
                )}
            </div>
        );
    };

    const renderTabs = () => {
        if (globalSummaries.length === 0 || currentView.kind === 'search' || currentView.kind === 'passages' || currentView.kind === 'about') return null;
        return (
            <div ref={tabsRef} className="reader-contents-tabs" role="tablist" aria-label="Reader views">
                <button
                    type="button"
                    role="tab"
                    aria-selected={!recapsExpanded}
                    aria-controls="reader-contents-list"
                    tabIndex={recapsExpanded ? -1 : 0}
                    className={clsx('reader-contents-tab', !recapsExpanded && 'reader-contents-tab--active')}
                    onClick={() => setView({ kind: 'outline' })}
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
                    onClick={() => setView({ kind: 'recaps' })}
                    onKeyDown={handleTabKeyDown}
                >
                    Recaps
                </button>
            </div>
        );
    };

    const renderPassages = () => (
        <div id="reader-passages-list" role="tabpanel" aria-label="Passages" className="reader-scroll-surface reader-contents-list">
            {passageChapter ? (
                <>
                    <button
                        type="button"
                        className={clsx('reader-passage-row', currentChapter?.id === passageChapter.id && (currentWordIndex ?? 0) === 0 && 'reader-passage-row--active')}
                        onClick={() => handlePassageClick(passageChapter, 0)}
                    >
                        <span className="reader-passage-title">Start of chapter</span>
                        <span className="reader-passage-meta">{getChapterReadingTime(passageChapter) || 'Preparing text'}</span>
                        {currentChapter?.id === passageChapter.id && (currentWordIndex ?? 0) === 0 && <span className="reader-passage-state">Here</span>}
                    </button>
                    {passageRows.map((passage) => {
                        const isActive = isCurrentPassage(passageChapter, passage);
                        const isHandoffSelection = chapterHandoffActive
                            && chapterHandoffSelection?.chapterId === passageChapter.id
                            && chapterHandoffSelection.startWordIndex === passage.startWordIndex;
                        const passageLength = Math.max(1, passage.endWordIndex - passage.startWordIndex);
                        return (
                            <button
                                key={`${passageChapter.id}-${passage.startWordIndex}`}
                                type="button"
                                className={clsx(
                                    'reader-passage-row',
                                    isActive && 'reader-passage-row--active',
                                    chapterHandoffActive && !isHandoffSelection && 'reader-passage-row--dimmed',
                                )}
                                onClick={() => handlePassageClick(passageChapter, passage.startWordIndex)}
                                disabled={passageChapter.content?.length === 0 || passage.startWordIndex >= (passageChapter.content?.length || 0)}
                                aria-current={isActive ? 'location' : undefined}
                            >
                                <span className="reader-passage-title">{getSubchapterDisplayName(passage, passageChapter.content)}</span>
                                <span className="reader-passage-meta">{formatReadingTime(passageLength / wpm)}</span>
                                {isActive && <span className="reader-passage-state">Here</span>}
                            </button>
                        );
                    })}
                </>
            ) : (
                <div className="reader-contents-empty"><p>This reading stop is no longer available.</p></div>
            )}
        </div>
    );

    const renderSearch = () => (
        <div id="reader-search-results" role="tabpanel" aria-label="Search results" className="reader-scroll-surface reader-contents-list">
            {!normalizedSearchQuery && <div className="reader-contents-empty"><p>Search chapters and passages.</p></div>}
            {normalizedSearchQuery && searchResults.length === 0 && (
                <div className="reader-contents-empty"><p>No chapters or passages match this search.</p></div>
            )}
            {searchResults.map((result) => {
                if (result.type === 'chapter') {
                    const isCurrent = result.chapter.id === currentChapter?.id;
                    return (
                        <button
                            key={`chapter-${result.chapter.id}`}
                            type="button"
                            className={clsx('reader-search-result', isCurrent && 'reader-search-result--active')}
                            onClick={() => handleChapterClick(result.chapter)}
                        >
                            <span className="reader-search-result-kind">Chapter</span>
                            <span className="reader-search-result-title">{result.chapter.title}</span>
                            <span className="reader-search-result-meta">{isCurrent ? 'Current' : (getChapterReadingTime(result.chapter) || 'Preparing text')}</span>
                        </button>
                    );
                }

                const passage = result.passage!;
                return (
                    <button
                        key={`passage-${result.chapter.id}-${passage.startWordIndex}`}
                        type="button"
                        className="reader-search-result"
                        onClick={() => handlePassageClick(result.chapter, passage.startWordIndex)}
                    >
                        <span className="reader-search-result-kind">Passage in {result.chapter.title}</span>
                        <span className="reader-search-result-title">{getSubchapterDisplayName(passage, result.chapter.content)}</span>
                        <span className="reader-search-result-meta">{formatReadingTime(Math.max(1, passage.endWordIndex - passage.startWordIndex) / wpm)}</span>
                    </button>
                );
            })}
        </div>
    );

    const renderRecaps = () => (
        <div id="reader-recaps-list" role="tabpanel" aria-label="Recaps" className="reader-scroll-surface reader-contents-list">
            {globalSummaries.map((summary, index) => {
                const isActive = activeSummaryId === summary.id;
                const context = getChapterContext(summary, displayChapters) || `Recap ${index + 1}`;
                const duration = formatReadingTime(Math.max(1, summary.endWordIndex - summary.startWordIndex) / wpm);
                return (
                    <button
                        key={summary.id}
                        type="button"
                        onClick={() => onPlayGlobalSummary?.(summary)}
                        className={clsx('reader-recap-row', isActive && 'reader-recap-row--active')}
                    >
                        <span className="reader-recap-title"><BookOpen className="h-4 w-4" aria-hidden="true" />{context}</span>
                        <span className="reader-recap-meta">{isActive ? 'Playing' : duration}</span>
                    </button>
                );
            })}
        </div>
    );

    const renderAbout = (aboutView: Extract<ContentsView, { kind: 'about' }>) => (
        <div id="reader-contents-about" role="tabpanel" aria-label="About this contents list" className="reader-scroll-surface reader-contents-about">
            <p className="reader-about-label">How this list is organized</p>
            <p>{getStructureExplanation(structureMode, displayChapters)}</p>
            <p className="reader-about-label">Passages</p>
            <p>Passages are optional shortcuts within a reading stop. They are named from the words where each passage begins.</p>
            <button type="button" className="reader-about-back" onClick={() => setView(aboutView.returnTo)}>
                Back to contents
            </button>
        </div>
    );

    return (
        <div className={clsx('reader-contents flex h-full flex-col', className)} onKeyDown={handleEscape}>
            {renderHeader()}
            {renderTabs()}
            {currentView.kind === 'outline' && (
                <div
                    ref={outlineListRef}
                    id="reader-contents-list"
                    role="tabpanel"
                    aria-label="Contents"
                    className="reader-scroll-surface reader-contents-list"
                    onScroll={() => {
                        outlineScrollTopRef.current = outlineListRef.current?.scrollTop || 0;
                    }}
                >
                    {displayChapters.map(renderChapterRow)}
                    {displayChapters.length === 0 && (
                        <div className="reader-contents-empty"><p>No readable chapters are available yet.</p></div>
                    )}
                </div>
            )}
            {currentView.kind === 'passages' && renderPassages()}
            {currentView.kind === 'search' && renderSearch()}
            {currentView.kind === 'recaps' && renderRecaps()}
            {currentView.kind === 'about' && renderAbout(currentView)}
        </div>
    );
};
