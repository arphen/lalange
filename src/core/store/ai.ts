import { create } from 'zustand';

/**
 * Model lifecycle states
 */
export type ModelLifecycleState = 
    | 'idle'           // No model loaded, not loading
    | 'downloading'    // Downloading model weights from network
    | 'loading'        // Loading model into GPU memory from cache
    | 'ready'          // Model loaded and ready for inference
    | 'crashed'        // Model crashed or encountered error
    | 'unloading';     // Model being unloaded

export type AISetupIntent = 'pacing' | 'summaries';

interface ModelStats {
    /** Model name/tier */
    name: string | null;
    /** Model size in bytes (if known) */
    sizeBytes: number;
    /** Time when loading started */
    loadStartTime: number | null;
    /** Time when loading completed */
    loadEndTime: number | null;
    /** Number of crashes since session start */
    crashCount: number;
    /** Last crash error message */
    lastCrashError: string | null;
    /** Number of successful inferences */
    inferenceCount: number;
}

/**
 * Tracking data for summarization timing interpolation
 */
interface SummaryTimingData {
    /** Historical durations of completed summaries (in ms) */
    durations: number[];
    /** When current summary started (if in progress) */
    currentStartTime: number | null;
    /** Average duration based on historical data */
    averageDuration: number | null;
}

interface AIState {
    // === Legacy fields (keeping for compatibility) ===
    isReady: boolean;
    isLoading: boolean;
    loadingModel: string | null;
    activeModel: string | null;
    activeModelName: string | null;
    activity: string | null;
    progress: string;
    progressValue: number; // 0-1
    error: string | null;
    tps: number;

    // === New enhanced fields ===
    /** Current lifecycle state of the model */
    lifecycleState: ModelLifecycleState;
    /** Detailed model statistics */
    modelStats: ModelStats;
    /** Whether the status panel is expanded */
    isPanelExpanded: boolean;
    /** Current task being processed (for progress display) */
    currentTask: {
        type: 'density' | 'summary' | 'inference' | null;
        chunkIndex: number;
        totalChunks: number;
        wordsProcessed: number;
        totalWords: number;
    } | null;
    /** Summarization timing data for progress interpolation */
    summaryTiming: SummaryTimingData;
    /** Optional setup is shown only after a user requests an AI feature. */
    isSetupOpen: boolean;
    setupIntent: AISetupIntent;

    // === Actions ===
    setLoading: (loading: boolean, model?: string) => void;
    setProgress: (text: string, value: number) => void;
    setReady: (ready: boolean) => void;
    setActivity: (activity: string | null, model?: string) => void;
    setError: (error: string | null) => void;
    setTPS: (tps: number) => void;
    setActiveModelName: (name: string | null) => void;
    
    // New actions
    setLifecycleState: (state: ModelLifecycleState, error?: string) => void;
    setPanelExpanded: (expanded: boolean) => void;
    togglePanelExpanded: () => void;
    recordCrash: (error: string) => void;
    recordInference: () => void;
    startModelLoad: (modelName: string, sizeBytes?: number) => void;
    completeModelLoad: () => void;
    setCurrentTask: (task: AIState['currentTask']) => void;
    updateTaskProgress: (wordsProcessed: number, totalWords: number) => void;
    
    // Summary timing actions
    startSummaryTiming: () => void;
    completeSummaryTiming: () => void;
    getSummaryProgress: () => number | null;
    requestSetup: (intent: AISetupIntent) => void;
    closeSetup: () => void;
}

const initialModelStats: ModelStats = {
    name: null,
    sizeBytes: 0,
    loadStartTime: null,
    loadEndTime: null,
    crashCount: 0,
    lastCrashError: null,
    inferenceCount: 0,
};

const initialSummaryTiming: SummaryTimingData = {
    durations: [],
    currentStartTime: null,
    averageDuration: null,
};

export const useAIStore = create<AIState>((set, get) => ({
    // Legacy fields
    isReady: false,
    isLoading: false,
    loadingModel: null,
    activeModel: null,
    activeModelName: null,
    activity: null,
    progress: '',
    progressValue: 0,
    error: null,
    tps: 0,

    // New fields
    lifecycleState: 'idle',
    modelStats: { ...initialModelStats },
    isPanelExpanded: false,
    currentTask: null,
    summaryTiming: { ...initialSummaryTiming },
    isSetupOpen: false,
    setupIntent: 'pacing',

    // Legacy actions (updated to also set lifecycle state)
    setLoading: (isLoading, model) => set(state => ({ 
        isLoading, 
        loadingModel: model || null, 
        error: null,
        lifecycleState: isLoading ? 'loading' : state.lifecycleState,
    })),
    
    setProgress: (progress, progressValue) => set({ progress, progressValue }),
    
    setReady: (isReady) => set(state => ({ 
        isReady,
        lifecycleState: isReady ? 'ready' : state.lifecycleState,
    })),
    
    setActivity: (activity, model) => set({ activity, activeModel: model || null }),
    
    setError: (error) => set(state => ({ 
        error, 
        isLoading: false, 
        isReady: false,
        lifecycleState: error ? 'crashed' : state.lifecycleState,
        modelStats: error ? {
            ...state.modelStats,
            crashCount: state.modelStats.crashCount + 1,
            lastCrashError: error,
        } : state.modelStats,
    })),
    
    setTPS: (tps) => set({ tps }),
    
    setActiveModelName: (activeModelName) => set({ activeModelName }),

    // New actions
    setLifecycleState: (lifecycleState, error) => set(state => ({
        lifecycleState,
        error: error || state.error,
        modelStats: error ? {
            ...state.modelStats,
            crashCount: state.modelStats.crashCount + 1,
            lastCrashError: error,
        } : state.modelStats,
    })),

    setPanelExpanded: (isPanelExpanded) => set({ isPanelExpanded }),
    
    togglePanelExpanded: () => set(state => ({ isPanelExpanded: !state.isPanelExpanded })),

    recordCrash: (error) => set(state => ({
        lifecycleState: 'crashed',
        error,
        modelStats: {
            ...state.modelStats,
            crashCount: state.modelStats.crashCount + 1,
            lastCrashError: error,
        },
    })),

    recordInference: () => set(state => ({
        modelStats: {
            ...state.modelStats,
            inferenceCount: state.modelStats.inferenceCount + 1,
        },
    })),

    startModelLoad: (modelName, sizeBytes) => set(state => ({
        isLoading: true,
        loadingModel: modelName,
        lifecycleState: 'downloading',
        progress: `Loading ${modelName}...`,
        progressValue: 0,
        modelStats: {
            ...state.modelStats,
            name: modelName,
            sizeBytes: sizeBytes || state.modelStats.sizeBytes,
            loadStartTime: Date.now(),
            loadEndTime: null,
        },
    })),

    completeModelLoad: () => set(state => ({
        isLoading: false,
        isReady: true,
        lifecycleState: 'ready',
        modelStats: {
            ...state.modelStats,
            loadEndTime: Date.now(),
        },
    })),

    setCurrentTask: (currentTask) => set({ currentTask }),

    updateTaskProgress: (wordsProcessed, totalWords) => set(state => ({
        currentTask: state.currentTask ? {
            ...state.currentTask,
            wordsProcessed,
            totalWords,
        } : null,
    })),

    requestSetup: (setupIntent) => set({ isSetupOpen: true, setupIntent }),
    closeSetup: () => set({ isSetupOpen: false }),

    // Summary timing for interpolated progress
    startSummaryTiming: () => set(state => ({
        summaryTiming: {
            ...state.summaryTiming,
            currentStartTime: Date.now(),
        },
    })),

    completeSummaryTiming: () => set(state => {
        const { currentStartTime, durations } = state.summaryTiming;
        if (!currentStartTime) return state;
        
        const duration = Date.now() - currentStartTime;
        const newDurations = [...durations, duration].slice(-10); // Keep last 10
        const averageDuration = newDurations.reduce((a, b) => a + b, 0) / newDurations.length;
        
        return {
            summaryTiming: {
                durations: newDurations,
                currentStartTime: null,
                averageDuration,
            },
        };
    }),

    getSummaryProgress: () => {
        const state = get();
        const { currentStartTime, averageDuration } = state.summaryTiming;
        
        if (!currentStartTime) return null;
        
        const elapsed = Date.now() - currentStartTime;
        
        // No history yet - return null to indicate "indeterminate"
        if (!averageDuration) return null;
        
        // Interpolate progress, cap at 95% (never show 100% until actually done)
        const progress = Math.min(0.95, elapsed / averageDuration);
        return progress;
    },
}));
