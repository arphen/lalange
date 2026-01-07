import { create } from 'zustand';

interface AIState {
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

    setLoading: (loading: boolean, model?: string) => void;
    setProgress: (text: string, value: number) => void;
    setReady: (ready: boolean) => void;
    setActivity: (activity: string | null, model?: string) => void;
    setError: (error: string | null) => void;
    setTPS: (tps: number) => void;
    setActiveModelName: (name: string | null) => void;
}

export const useAIStore = create<AIState>((set) => ({
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

    setLoading: (isLoading, model) => set({ isLoading, loadingModel: model || null, error: null }), // Clear error on load
    setProgress: (progress, progressValue) => set({ progress, progressValue }),
    setReady: (isReady) => set({ isReady }),
    setActivity: (activity, model) => set({ activity, activeModel: model || null }),
    setError: (error) => set({ error, isLoading: false, isReady: false }),
    setTPS: (tps) => set({ tps }),
    setActiveModelName: (activeModelName) => set({ activeModelName }),
}));
