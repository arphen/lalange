import React from 'react';
import { clsx } from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useAIStore, type ModelLifecycleState } from '../core/store/ai';

/**
 * Get the status color and icon for a lifecycle state
 */
const getStatusIndicator = (state: ModelLifecycleState, error: string | null): { 
    color: string; 
    bgColor: string;
    label: string;
    animate: boolean;
} => {
    if (error) {
        return { color: 'text-red-500', bgColor: 'bg-red-500', label: 'CRASHED', animate: true };
    }
    
    switch (state) {
        case 'idle':
            return { color: 'text-gray-500', bgColor: 'bg-gray-500', label: 'OFFLINE', animate: false };
        case 'downloading':
            return { color: 'text-blue-400', bgColor: 'bg-blue-400', label: 'DOWNLOADING', animate: true };
        case 'loading':
            return { color: 'text-yellow-500', bgColor: 'bg-yellow-500', label: 'LOADING', animate: true };
        case 'ready':
            return { color: 'text-green-500', bgColor: 'bg-green-500', label: 'READY', animate: false };
        case 'crashed':
            return { color: 'text-red-500', bgColor: 'bg-red-500', label: 'CRASHED', animate: true };
        case 'unloading':
            return { color: 'text-orange-400', bgColor: 'bg-orange-400', label: 'UNLOADING', animate: true };
        default:
            return { color: 'text-gray-500', bgColor: 'bg-gray-500', label: 'UNKNOWN', animate: false };
    }
};

/**
 * Format bytes to human-readable string
 */
const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

/**
 * Format duration in ms to human-readable string
 */
const formatDuration = (startTime: number | null, endTime: number | null): string => {
    if (!startTime) return '—';
    const end = endTime || Date.now();
    const ms = end - startTime;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

interface AIStatusPanelProps {
    /** Where to render - 'sidebar' (compact) or 'global' (full) */
    variant?: 'sidebar' | 'global';
    /** Custom class name */
    className?: string;
}

/**
 * AI Status Panel - Shows model lifecycle, loading progress, and stats.
 * Expandable to show detailed information.
 */
export const AIStatusPanel: React.FC<AIStatusPanelProps> = ({ 
    variant = 'sidebar',
    className 
}) => {
    const {
        lifecycleState,
        error,
        activeModelName,
        progress,
        progressValue,
        tps,
        activity,
        modelStats,
        isPanelExpanded,
        togglePanelExpanded,
        currentTask,
        summaryTiming,
        getSummaryProgress,
    } = useAIStore(useShallow((state) => ({
        lifecycleState: state.lifecycleState,
        error: state.error,
        activeModelName: state.activeModelName,
        progress: state.progress,
        progressValue: state.progressValue,
        tps: state.tps,
        activity: state.activity,
        modelStats: state.modelStats,
        isPanelExpanded: state.isPanelExpanded,
        togglePanelExpanded: state.togglePanelExpanded,
        currentTask: state.currentTask,
        summaryTiming: state.summaryTiming,
        getSummaryProgress: state.getSummaryProgress,
    })));

    const status = getStatusIndicator(lifecycleState, error);
    const isLoading = lifecycleState === 'downloading' || lifecycleState === 'loading';

    const shouldHideSidebarIdle =
        variant === 'sidebar' &&
        lifecycleState === 'idle' &&
        !error &&
        !activeModelName &&
        !activity &&
        !currentTask &&
        progressValue <= 0;
    
    // For summary tasks, use interpolated progress that updates in real-time
    const [summaryTick, setSummaryTick] = React.useState(0);
    const isSummaryTask = currentTask?.type === 'summary' && Boolean(summaryTiming.currentStartTime);
    
    React.useEffect(() => {
        if (!isSummaryTask) return;
        
        // Update progress every 250ms (was 100ms - smoother on battery)
        const interval = setInterval(() => {
            setSummaryTick((prev) => prev + 1);
        }, 250);
        
        return () => clearInterval(interval);
    }, [isSummaryTask]);

    const summaryProgress = React.useMemo(() => {
        void summaryTick;
        if (!isSummaryTask) return null;
        return getSummaryProgress();
    }, [summaryTick, isSummaryTask, getSummaryProgress]);
    
    // Determine if we're in indeterminate mode (no historical data for summary)
    const isSummaryIndeterminate = currentTask?.type === 'summary' && summaryProgress === null;
    
    // Calculate loading ETA
    const [loadingEta, setLoadingEta] = React.useState<string | null>(null);
    const loadStartTime = modelStats.loadStartTime ?? null;
    const canEstimateLoadingEta = isLoading && loadStartTime !== null && progressValue > 0 && progressValue < 1;

    React.useEffect(() => {
        if (!canEstimateLoadingEta || loadStartTime === null) return;

        const interval = setInterval(() => {
             const elapsed = Date.now() - loadStartTime;
             const estimated = elapsed / progressValue;
             const remaining = estimated - elapsed;
             if (remaining <= 0 || !isFinite(remaining)) {
                 setLoadingEta(null);
                 return;
             }
             
             const mins = Math.floor(remaining / 60000);
             const secs = Math.floor((remaining % 60000) / 1000);
             setLoadingEta(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
        }, 2000); // Update ETA every 2s (was 1s)

        return () => clearInterval(interval);
    }, [canEstimateLoadingEta, loadStartTime, progressValue]);

    const displayedLoadingEta = canEstimateLoadingEta ? loadingEta : null;

    if (shouldHideSidebarIdle) {
        return null;
    }

    return (
        <div className={clsx('font-mono', className)}>
            {/* Compact Header - Always Visible */}
            <button
                onClick={togglePanelExpanded}
                className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded transition-all',
                    'border border-white/5 hover:border-white/20',
                    'bg-black/30 hover:bg-black/50',
                    'group cursor-pointer text-left'
                )}
            >
                {/* Status Indicator */}
                <div className={clsx(
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    status.bgColor,
                    status.animate && 'animate-pulse'
                )} />

                {/* Model Name + Status */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={clsx(
                            'text-xs tracking-wider truncate',
                            lifecycleState === 'ready' ? 'text-dune-gold' : 'text-white/60'
                        )}>
                            {activeModelName || status.label}
                        </span>
                        {tps > 0 && (
                            <span className="text-[10px] text-gray-500 tabular-nums">
                                {tps.toFixed(1)} TPS
                            </span>
                        )}
                    </div>
                    
                    {/* Loading Progress */}
                    {isLoading && (
                        <div className="mt-1.5">
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                <div 
                                    className={clsx(
                                        'h-full transition-all duration-300 rounded-full',
                                        lifecycleState === 'downloading' ? 'bg-blue-400' : 'bg-yellow-500'
                                    )}
                                    style={{ width: `${progressValue * 100}%` }}
                                />
                            </div>
                            <div className="flex justify-between mt-0.5">
                                <span className="text-[9px] text-gray-500 truncate max-w-[60%]">
                                    {progress || 'Loading...'}
                                </span>
                                <span className="text-[9px] text-gray-500 tabular-nums">
                                    {Math.round(progressValue * 100)}%
                                    {displayedLoadingEta && ` · ${displayedLoadingEta}`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Activity Indicator */}
                    {!isLoading && activity && (
                        <div className={clsx(
                            'text-[10px] truncate mt-0.5',
                            currentTask?.type === 'summary' ? 'text-purple-400' : 'text-magma-vent',
                            'animate-pulse'
                        )}>
                            {activity}
                        </div>
                    )}

                    {/* Task Progress - Density (gold) */}
                    {!isLoading && currentTask?.type === 'density' && currentTask.totalWords > 0 && (
                        <div className="mt-1.5">
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-dune-gold/70 transition-all duration-150 rounded-full"
                                    style={{ 
                                        width: `${(currentTask.wordsProcessed / currentTask.totalWords) * 100}%` 
                                    }}
                                />
                            </div>
                        </div>
                    )}
                    
                    {/* Task Progress - Summary (purple with indeterminate/interpolated) */}
                    {!isLoading && currentTask?.type === 'summary' && (
                        <div className="mt-1.5">
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden relative">
                                {isSummaryIndeterminate ? (
                                    /* Indeterminate pulsing bar */
                                    <div 
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]"
                                        style={{
                                            backgroundSize: '200% 100%',
                                        }}
                                    />
                                ) : (
                                    /* Interpolated progress */
                                    <div 
                                        className="h-full bg-purple-500 transition-all duration-100 rounded-full"
                                        style={{ 
                                            width: `${(summaryProgress || 0) * 100}%` 
                                        }}
                                    />
                                )}
                            </div>
                            {summaryTiming.averageDuration && !isSummaryIndeterminate && (
                                <div className="text-[9px] text-purple-400/60 mt-0.5 text-right">
                                    ~{Math.round(summaryTiming.averageDuration / 1000)}s avg
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Expand/Collapse Icon */}
                <svg 
                    className={clsx(
                        'w-4 h-4 text-gray-500 transition-transform shrink-0',
                        isPanelExpanded && 'rotate-180'
                    )}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Expanded Details */}
            {isPanelExpanded && (
                <div className={clsx(
                    'mt-2 p-3 rounded border border-white/10 bg-black/40',
                    'text-[10px] space-y-3'
                )}>
                    {/* Error Display */}
                    {error && (
                        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded">
                            <div className="text-red-400 font-bold mb-1">ERROR</div>
                            <div className="text-red-300/80 break-words">{error}</div>
                        </div>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <StatRow label="Status" value={status.label} valueClass={status.color} />
                        <StatRow label="Model" value={modelStats.name || '—'} />
                        <StatRow label="Size" value={formatBytes(modelStats.sizeBytes)} />
                        <StatRow 
                            label="Load Time" 
                            value={formatDuration(modelStats.loadStartTime, modelStats.loadEndTime)} 
                        />
                        <StatRow 
                            label="Crashes" 
                            value={modelStats.crashCount.toString()}
                            valueClass={modelStats.crashCount > 0 ? 'text-red-400' : undefined}
                        />
                        <StatRow 
                            label="Inferences" 
                            value={modelStats.inferenceCount.toLocaleString()} 
                        />
                    </div>

                    {/* Last Crash Error */}
                    {modelStats.lastCrashError && modelStats.crashCount > 0 && (
                        <div className="pt-2 border-t border-white/5">
                            <div className="text-gray-500 mb-1">LAST CRASH</div>
                            <div className="text-red-400/70 break-words text-[9px]">
                                {modelStats.lastCrashError}
                            </div>
                        </div>
                    )}

                    {/* Current Task Details */}
                    {currentTask && currentTask.type && (
                        <div className="pt-2 border-t border-white/5">
                            <div className="text-gray-500 mb-1">CURRENT TASK</div>
                            <div className="text-white/70">
                                {currentTask.type.toUpperCase()} · Chunk {currentTask.chunkIndex + 1}/{currentTask.totalChunks}
                            </div>
                            {currentTask.totalWords > 0 && (
                                <div className="text-gray-500">
                                    {currentTask.wordsProcessed} / {currentTask.totalWords} words
                                </div>
                            )}
                        </div>
                    )}

                    {/* Lifecycle State Visual */}
                    <div className="pt-2 border-t border-white/5">
                        <div className="text-gray-500 mb-2">LIFECYCLE</div>
                        <div className="flex items-center gap-1">
                            {(['idle', 'downloading', 'loading', 'ready'] as ModelLifecycleState[]).map((state, i) => (
                                <React.Fragment key={state}>
                                    <div 
                                        className={clsx(
                                            'h-1.5 flex-1 rounded-full transition-colors',
                                            lifecycleState === state 
                                                ? getStatusIndicator(state, null).bgColor
                                                : 'bg-white/10'
                                        )}
                                        title={state}
                                    />
                                    {i < 3 && <div className="text-gray-600">→</div>}
                                </React.Fragment>
                            ))}
                        </div>
                        <div className="flex justify-between mt-1 text-[8px] text-gray-600 uppercase">
                            <span>Idle</span>
                            <span>Download</span>
                            <span>Load</span>
                            <span>Ready</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/** Helper component for stat rows */
const StatRow: React.FC<{ 
    label: string; 
    value: string; 
    valueClass?: string;
}> = ({ label, value, valueClass }) => (
    <div className="flex justify-between">
        <span className="text-gray-500 uppercase tracking-wider">{label}</span>
        <span className={valueClass || 'text-white/80'}>{value}</span>
    </div>
);

export default AIStatusPanel;
