import React, { useState } from 'react';
import { type ChapterDocType, type GlobalSummaryType } from '../../core/sync/db';
import { formatReadingTime } from '../../hooks/useReadingTimeEstimate';
import { useAIStore } from '../../core/store/ai';
import { clsx } from 'clsx';
import { getSubchapterDisplayName } from './Sidebar.utils';

interface SidebarProps {
    chapters: ChapterDocType[];
    currentChapter: ChapterDocType | null;
    onLoadChapter: (id: string, wordIndex?: number) => void;
    onInspectChapter: (chapter: ChapterDocType) => void;
    wpm: number;
    className?: string;
    currentWordIndex?: number;
    now: number;
    activeSummaryId?: string | null;
    globalSummaries?: GlobalSummaryType[];
    onPlayGlobalSummary?: (summary: GlobalSummaryType) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    chapters,
    currentChapter,
    onLoadChapter,
    onInspectChapter,
    wpm,
    className,
    currentWordIndex,
    now,
    activeSummaryId,
    globalSummaries = [],
    onPlayGlobalSummary
}) => {
    const [expandedSummary, setExpandedSummary] = useState<string | null>(null);
    useAIStore(); // Keep subscription for re-renders but ignore returned object

    // Sync expanded summary with active summary from parent (Reader)
    React.useEffect(() => {
        if (activeSummaryId) {
            setExpandedSummary(activeSummaryId);
        }
    }, [activeSummaryId]);

    // Filter out image chapters
    const displayChapters = chapters.filter(c => c.metadata?.classificationType !== 'image');

    // Calculate total stats
    const totalWords = displayChapters.reduce((acc, c) => acc + (c.content?.length || 0), 0);
    const totalTimeMinutes = totalWords / wpm;
    const timeBank = formatReadingTime(totalTimeMinutes);

    // Calculate average ingest speed (from processing chapters)
    const processingChapters = displayChapters.filter(c => c.status === 'processing');
    const ingestSpeed = processingChapters.length > 0
        ? Math.round(processingChapters.reduce((acc, c) => acc + (c.lastTPM || 0), 0) / processingChapters.length)
        : 0;

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
        <div className={clsx("flex flex-col h-full bg-basalt font-mono text-xs", className)}>
            {/* Header */}
            <div className="p-4 border-b border-white/10">
                <h3 className="text-dune-gold font-bold tracking-widest mb-1">LIBRARIAN</h3>
                <div className="flex justify-between text-gray-500">
                    <span>{chapters.length} CHUNKS</span>
                    <span>{timeBank} BANKED</span>
                </div>
            </div>

            {/* Chapter List (Fill-Bars) */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {/* Global Summaries Section */}
                {globalSummaries.length > 0 && (
                    <div className="mb-3 pb-3 border-b border-purple-500/20">
                        <div className="text-[10px] text-purple-400 uppercase tracking-widest mb-2 px-1">
                            📚 Book Summaries
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
                                                ? "bg-purple-900/40 border-purple-500/50 text-purple-200" 
                                                : "bg-black/20 border-white/5 text-gray-400 hover:border-purple-500/30 hover:text-purple-300"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-500">▶</span>
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

                    // Calculate fill percentage for processing chapters
                    // For ready chapters, it's 100%. For processing, use progress or estimate.
                    let fillPercent = 0;
                    if (isReady) fillPercent = 100;
                    else if (isProcessing) fillPercent = chapter.progress || 0;

                    return (
                        <div key={chapter.id} className="relative group flex flex-col">
                            {/* Background Fill Bar */}
                            <div
                                className="absolute inset-0 bg-white/5 transition-all duration-1000 ease-linear pointer-events-none"
                                style={{ width: `${fillPercent}%`, opacity: isCurrent ? 0.2 : 0.1 }}
                            />

                            <div className="relative flex items-stretch">
                                <button
                                    onClick={() => onLoadChapter(chapter.id)}
                                    disabled={!isReady && (!chapter.content || chapter.content.length === 0)}
                                    className={clsx(
                                        "flex-1 text-left p-3 transition-colors border-l-2",
                                        isCurrent ? "border-magma-vent bg-white/5 text-white" : "border-transparent text-gray-400 hover:text-white hover:bg-white/5",
                                        (!isReady && (!chapter.content || chapter.content.length === 0)) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    <div className="flex justify-between items-center w-full mb-1">
                                        <span className="truncate font-bold">{chapter.title}</span>
                                        {isProcessing && (
                                            <span className="w-1.5 h-1.5 bg-dune-gold rounded-full animate-pulse" />
                                        )}
                                    </div>

                                    <div className="flex justify-between items-center text-[10px] uppercase tracking-wider">
                                        <span className={isReady ? "text-canarian-pine" : "text-dune-shadow"}>
                                            {readingTime || "PENDING"}
                                        </span>
                                        {isProcessing && (
                                            <span className="text-gray-600">
                                                {chapter.lastTPM ? `${chapter.lastTPM} TPM` : `${chapter.processingSpeed} WPM`}
                                            </span>
                                        )}
                                    </div>
                                </button>

                                {/* Inspect Button (Hover only) */}
                                <button
                                    onClick={() => onInspectChapter(chapter)}
                                    disabled={!isReady}
                                    className="w-8 flex items-center justify-center text-gray-600 hover:text-dune-gold opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Inspect Density"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                </button>
                            </div>

                            {/* Subchapters */}
                            {chapter.subchapters && chapter.subchapters.length > 0 && (
                                <div className="pl-4 border-l border-white/10 ml-2 mb-2 space-y-2">
                                    {chapter.subchapters.map((sub, idx) => {
                                        const summaryId = `${chapter.id}_${idx}`;
                                        const isExpanded = expandedSummary === summaryId;
                                        const isPlayingSummary = activeSummaryId === summaryId;
                                        // Check if we have ANY content for this subchapter (start index exists in content array)
                                        const currentContentLength = chapter.content?.length || 0;
                                        const hasStarted = currentContentLength > sub.startWordIndex;
                                        const isFullyReady = currentContentLength >= sub.endWordIndex;

                                        // Safe to read if user WPM is slower than processing speed (or if fully ready)
                                        const processingSpeed = chapter.processingSpeed || 0;
                                        const isSafeSpeed = wpm < processingSpeed;
                                        const isSafeToRead = isFullyReady || (hasStarted && isSafeSpeed);

                                        // Check if this is the currently active subchapter being read
                                        const isActive = isCurrent && currentWordIndex !== undefined &&
                                            currentWordIndex >= sub.startWordIndex &&
                                            (currentWordIndex < sub.endWordIndex || (idx === chapter.subchapters!.length - 1 && currentWordIndex >= sub.startWordIndex));

                                        // Calculate Density Progress
                                        // Densities are initialized with 0 (pending) and filled with values >= 0.5 when processed
                                        const densitySlice = chapter.densities?.slice(sub.startWordIndex, sub.endWordIndex) || [];
                                        const expectedLength = sub.endWordIndex - sub.startWordIndex;
                                        // Count densities that have been processed (> 0 means analyzed, since pending = 0)
                                        const processedDensityCount = densitySlice.filter(d => d > 0).length;
                                        // Progress is based on how many we have vs how many we expect
                                        const densityProgress = expectedLength > 0 ? Math.min(1, processedDensityCount / expectedLength) : 0;
                                        
                                        // Check if summary exists and is non-empty
                                        const hasSummary = Boolean(sub.summary && sub.summary.trim().length > 0);

                                        return (
                                            <div key={idx} className="flex flex-col relative group/sub">
                                                {/* Active Reading Highlight */}
                                                <div
                                                    className={clsx(
                                                        "absolute inset-0 transition-opacity duration-300 rounded-sm border border-white/10",
                                                        isActive ? "opacity-100 bg-white/5" : "opacity-0"
                                                    )}
                                                />
                                                {/* Health Bar Background (Readiness) */}
                                                <div
                                                    className={clsx(
                                                        "absolute inset-0 transition-all duration-1000 ease-out rounded-sm",
                                                        isFullyReady ? "opacity-0" : "opacity-100 animate-pulse",
                                                        isSafeToRead ? "bg-canarian-pine/20" : "bg-dune-gold/10"
                                                    )}
                                                    style={{
                                                        width: '100%',
                                                    }}
                                                />

                                                <div className="flex items-center justify-between relative z-10 pl-1 py-1">
                                                    <div className="flex-1 min-w-0 pr-2">
                                                        <button
                                                            className={clsx(
                                                                "text-left text-[10px] transition-colors truncate w-full cursor-pointer",
                                                                isActive ? "text-white font-bold" : (isFullyReady ? "text-gray-500 hover:text-dune-gold" : (isSafeToRead ? "text-canarian-pine font-bold" : "text-dune-gold font-bold"))
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                e.preventDefault();
                                                                setExpandedSummary(isExpanded ? null : summaryId);
                                                            }}
                                                            data-testid={`subchapter-btn-${idx}`}
                                                        >
                                                            {getSubchapterDisplayName(sub, chapter.content)}
                                                        </button>
                                                        
                                                        {/* Fused 2px Progress Bar: 1px red (density) + 1px purple (summary) */}
                                                        {(densityProgress < 1 || !hasSummary) && (
                                                            <div className="w-full mt-1 h-[2px] flex flex-col" data-testid={`progress-bar-${idx}`}>
                                                                {/* Row 1: Density (Red/Magma) - 1px */}
                                                                <div className="w-full h-[1px] bg-gray-800/50 overflow-hidden relative" data-testid={`density-bar-${idx}`}>
                                                                    <div 
                                                                        className="absolute inset-y-0 left-0 bg-magma-vent transition-all duration-500"
                                                                        style={{ width: `${densityProgress * 100}%` }}
                                                                        data-testid={`density-fill-${idx}`}
                                                                    />
                                                                </div>
                                                                {/* Row 2: Summary (Purple) - 1px */}
                                                                <div className="w-full h-[1px] bg-gray-800/50 overflow-hidden relative" data-testid={`summary-bar-${idx}`}>
                                                                    {densityProgress >= 1 && !hasSummary ? (
                                                                        /* Shimmer animation while summarizing */
                                                                        <div 
                                                                            className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-shimmer" 
                                                                            data-testid={`summary-shimmer-${idx}`}
                                                                        />
                                                                    ) : hasSummary ? (
                                                                        /* Complete - solid purple */
                                                                        <div 
                                                                            className="absolute inset-y-0 left-0 bg-purple-500 w-full" 
                                                                            data-testid={`summary-complete-${idx}`}
                                                                        />
                                                                    ) : (
                                                                        /* Waiting for density - gray/empty */
                                                                        <div 
                                                                            className="absolute inset-y-0 left-0 bg-gray-700 w-0" 
                                                                            data-testid={`summary-waiting-${idx}`}
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (hasStarted) {
                                                                onLoadChapter(chapter.id, sub.startWordIndex);
                                                            }
                                                        }}
                                                        disabled={!hasStarted}
                                                        className={clsx(
                                                            "p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0",
                                                            hasStarted ? "text-dune-gold" : "text-gray-600 opacity-50 cursor-not-allowed"
                                                        )}
                                                        title="Read Subchapter"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                        </svg>
                                                    </button>
                                                </div>

                                                {/* Summary Slide-out */}
                                                <div 
                                                    className={clsx(
                                                        "overflow-hidden transition-all duration-300 ease-out",
                                                        isExpanded ? "max-h-96 opacity-100 mt-1" : "max-h-0 opacity-0"
                                                    )}
                                                >
                                                    {hasSummary ? (
                                                        <div 
                                                            className={clsx(
                                                                "text-[10px] italic p-2 rounded border relative z-10 transition-colors",
                                                                isPlayingSummary 
                                                                    ? "bg-purple-900/40 text-purple-200 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)]" 
                                                                    : "bg-black/30 text-gray-400 border-white/10"
                                                            )}
                                                            data-testid={`summary-content-${idx}`}
                                                        >
                                                            {sub.summary}
                                                        </div>
                                                    ) : densityProgress >= 1 ? (
                                                        <div 
                                                            className="text-[10px] text-purple-400 italic bg-purple-500/10 p-2 rounded border border-purple-500/20 animate-pulse relative z-10"
                                                            data-testid={`summary-generating-${idx}`}
                                                        >
                                                            Generating summary...
                                                        </div>
                                                    ) : (
                                                        <div 
                                                            className="text-[10px] text-gray-600 italic bg-black/20 p-2 rounded border border-white/5 relative z-10"
                                                            data-testid={`summary-pending-${idx}`}
                                                        >
                                                            Analyzing density...
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    
                                    {/* Processing Indicator for Next Chunk */}
                                    {isProcessing && (
                                        <div className="pl-1 py-1 text-[10px] text-dune-gold animate-pulse italic flex items-center gap-2">
                                            <span className="w-1 h-1 bg-dune-gold rounded-full"/>
                                            Summarizing next chunk...
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Telemetry Footer */}
            <div className="p-4 border-t border-white/10 bg-black/40 space-y-3">
                {/* Pipeline Status */}
                {ingestSpeed > 0 && (
                    <div className="pt-2 border-t border-white/5">
                        <div className="text-[10px] text-gray-500 tracking-widest mb-1">PIPELINE VELOCITY</div>
                        <div className="text-xs font-mono text-gray-400 flex items-baseline gap-2">
                            {ingestSpeed} <span className="text-[10px] text-gray-600">TPM</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
