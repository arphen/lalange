import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ModelTier } from '../ai/webllm';
import { type DurationStrategyId, DEFAULT_STRATEGY_ID } from '../rsvp/duration';
import { type DisplayPluginId, DEFAULT_DISPLAY_PLUGIN } from '../rsvp/display';

export type ThemeMode = 'volcanic' | 'dunes' | 'ash';

export interface PromptFragment {
    id: string;
    label: string;
    text: string;
    enabled: boolean;
}

interface SettingsState {
    // Appearance
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;

    // Reading
    wpm: number;
    setWpm: (wpm: number) => void;
    summaryWpm: number;
    setSummaryWpm: (wpm: number) => void;
    fontScale: number;
    setFontScale: (scale: number) => void;
    durationStrategy: DurationStrategyId;
    setDurationStrategy: (strategy: DurationStrategyId) => void;
    displayPlugin: DisplayPluginId;
    setDisplayPlugin: (plugin: DisplayPluginId) => void;

    // Features
    saccadeEnabled: boolean;
    setSaccadeEnabled: (enabled: boolean) => void;
    riverTopEnabled: boolean;
    setRiverTopEnabled: (enabled: boolean) => void;
    riverBottomEnabled: boolean;
    setRiverBottomEnabled: (enabled: boolean) => void;
    focusModeEnabled: boolean;
    setFocusModeEnabled: (enabled: boolean) => void;
    aiEnabled: boolean;
    setAiEnabled: (enabled: boolean) => void;

    // UI
    sidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;

    // Advanced / Janitor
    licenseAnnihilator: boolean;
    toggleLicenseAnnihilator: () => void;
    structuralScrubber: boolean;
    setStructuralScrubber: (enabled: boolean) => void;
    enableJunkRemoval: boolean;
    setEnableJunkRemoval: (enabled: boolean) => void;
    footnoteSuppressor: boolean;
    setFootnoteSuppressor: (enabled: boolean) => void;
    manualOverrideRules: string;
    setManualOverrideRules: (rules: string) => void;

    // Transformation (Editor)
    editorModel: ModelTier;
    setEditorModel: (model: ModelTier) => void;
    editorBasePrompt: string;
    setEditorBasePrompt: (prompt: string) => void;
    editorFragments: PromptFragment[];
    toggleEditorFragment: (id: string) => void;

    // Legacy Transformation
    llmModel: 'tiny' | 'balanced' | 'pro';
    setLlmModel: (model: 'tiny' | 'balanced' | 'pro') => void;
    autoUpgradeEngine: boolean;
    setAutoUpgradeEngine: (enabled: boolean) => void;
    stylingPreset: 'analyst' | 'pirate' | 'zoomer' | 'stoic' | 'victorian' | 'custom';
    setStylingPreset: (preset: 'analyst' | 'pirate' | 'zoomer' | 'stoic' | 'victorian' | 'custom') => void;
    customStylingPrompt: string;
    setCustomStylingPrompt: (prompt: string) => void;
    stylingIntensity: number;
    setStylingIntensity: (intensity: number) => void;

    // Pacing
    pacingModelTier: ModelTier;
    setPacingModelTier: (model: ModelTier) => void;
    pacingContextTokens: number;
    setPacingContextTokens: (tokens: number) => void;
    pacingOverlapTokens: number;
    setPacingOverlapTokens: (tokens: number) => void;
    pacingSensitivity: number;
    setPacingSensitivity: (sensitivity: number) => void;

    // Onboarding
    hasCompletedOnboarding: boolean;
    setHasCompletedOnboarding: (completed: boolean) => void;

    // Librarian
    librarianModelTier: ModelTier;
    setLibrarianModelTier: (model: ModelTier) => void;
    librarianBasePrompt: string;
    setLibrarianBasePrompt: (prompt: string) => void;
    librarianFragments: PromptFragment[];
    toggleLibrarianFragment: (id: string) => void;
    affiliateLinksEnabled: boolean;
    setAffiliateLinksEnabled: (enabled: boolean) => void;
    librarianPersona: 'standard' | 'lacanian' | 'custom';
    setLibrarianPersona: (persona: 'standard' | 'lacanian' | 'custom') => void;

    // Legacy Librarian
    librarianModel: 'mistral' | 'llama' | 'other';
    setLibrarianModel: (model: 'mistral' | 'llama' | 'other') => void;

    // Summarizer
    summarizerModel: ModelTier;
    setSummarizerModel: (model: ModelTier) => void;
    summarizerBasePrompt: string;
    setSummarizerBasePrompt: (prompt: string) => void;
    summarizerFragments: PromptFragment[];
    toggleSummarizerFragment: (id: string) => void;

    // Legacy Summarizer
    summaryChunkSize: number;
    setSummaryChunkSize: (size: number) => void;
    summaryPrompt: string;
    setSummaryPrompt: (prompt: string) => void;
}

const defaultFragments: PromptFragment[] = [
    { id: 'concise', label: 'Concise Mode', text: 'Keep the output concise and to the point.', enabled: false },
    { id: 'simple', label: 'Simple English', text: 'Use simple vocabulary and short sentences.', enabled: false },
    { id: 'creative', label: 'Creative Flourish', text: 'Use evocative and creative language.', enabled: false },
];

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            theme: 'volcanic',
            setTheme: (theme) => set({ theme }),

            wpm: 300,
            setWpm: (wpm) => set({ wpm }),

            summaryWpm: 400,
            setSummaryWpm: (summaryWpm) => set({ summaryWpm }),

            fontScale: 1,
            setFontScale: (fontScale) => set({ fontScale }),

            durationStrategy: DEFAULT_STRATEGY_ID,
            setDurationStrategy: (durationStrategy) => set({ durationStrategy }),

            displayPlugin: DEFAULT_DISPLAY_PLUGIN,
            setDisplayPlugin: (displayPlugin) => set({ displayPlugin }),

            saccadeEnabled: true,
            setSaccadeEnabled: (saccadeEnabled) => set({ saccadeEnabled }),

            riverTopEnabled: true,
            setRiverTopEnabled: (riverTopEnabled) => set({ riverTopEnabled }),
            riverBottomEnabled: true,
            setRiverBottomEnabled: (riverBottomEnabled) => set({ riverBottomEnabled }),
            focusModeEnabled: false,
            setFocusModeEnabled: (focusModeEnabled) => set({ focusModeEnabled }),
            aiEnabled: true,
            setAiEnabled: (aiEnabled) => set({ aiEnabled }),

            sidebarOpen: true,
            setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

            licenseAnnihilator: true,
            toggleLicenseAnnihilator: () => set((state) => ({ licenseAnnihilator: !state.licenseAnnihilator })),
            structuralScrubber: true,
            setStructuralScrubber: (structuralScrubber) => set({ structuralScrubber }),
            enableJunkRemoval: true,
            setEnableJunkRemoval: (enableJunkRemoval) => set({ enableJunkRemoval }),
            footnoteSuppressor: true,
            setFootnoteSuppressor: (footnoteSuppressor) => set({ footnoteSuppressor }),
            manualOverrideRules: '',
            setManualOverrideRules: (manualOverrideRules) => set({ manualOverrideRules }),

            // Editor Defaults
            editorModel: 'tiny',
            setEditorModel: (editorModel) => set({ editorModel }),
            editorBasePrompt: 'You are an expert editor. Rewrite the following text to improve clarity and flow.',
            setEditorBasePrompt: (editorBasePrompt) => set({ editorBasePrompt }),
            editorFragments: [...defaultFragments],
            toggleEditorFragment: (id) => set((state) => ({
                editorFragments: state.editorFragments.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
            })),

            // Legacy Editor
            llmModel: 'tiny',
            setLlmModel: (llmModel) => set({ llmModel }),
            autoUpgradeEngine: true,
            setAutoUpgradeEngine: (autoUpgradeEngine) => set({ autoUpgradeEngine }),
            stylingPreset: 'analyst',
            setStylingPreset: (stylingPreset) => set({ stylingPreset }),
            customStylingPrompt: '',
            setCustomStylingPrompt: (customStylingPrompt) => set({ customStylingPrompt }),
            stylingIntensity: 0,
            setStylingIntensity: (stylingIntensity) => set({ stylingIntensity }),

            pacingModelTier: 'tiny',
            setPacingModelTier: (pacingModelTier) => set({ pacingModelTier }),
            
            pacingContextTokens: 128,
            setPacingContextTokens: (pacingContextTokens) => set({ pacingContextTokens }),
            pacingOverlapTokens: 16,
            hasCompletedOnboarding: false,
            setHasCompletedOnboarding: (hasCompletedOnboarding) => set({ hasCompletedOnboarding }),

            setPacingOverlapTokens: (pacingOverlapTokens) => set({ pacingOverlapTokens }),
            pacingSensitivity: 50,
            setPacingSensitivity: (pacingSensitivity) => set({ pacingSensitivity }),

            // Librarian Defaults (used for density estimation)
            librarianModelTier: 'tiny',
            setLibrarianModelTier: (librarianModelTier) => set({ librarianModelTier }),
            librarianBasePrompt: 'You are the Scansion Librarian, a knowledgeable, slightly eccentric guide to the world\'s classics. Your goal is to recommend public domain books from Project Gutenberg.',
            setLibrarianBasePrompt: (librarianBasePrompt) => set({ librarianBasePrompt }),
            librarianFragments: [...defaultFragments],
            toggleLibrarianFragment: (id) => set((state) => ({
                librarianFragments: state.librarianFragments.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
            })),
            affiliateLinksEnabled: false,
            setAffiliateLinksEnabled: (affiliateLinksEnabled) => set({ affiliateLinksEnabled }),
            librarianPersona: 'standard',
            setLibrarianPersona: (librarianPersona) => set({ librarianPersona }),

            // Legacy Librarian
            librarianModel: 'mistral',
            setLibrarianModel: (librarianModel) => set({ librarianModel }),

            // Summarizer Defaults
            summarizerModel: 'tiny',
            setSummarizerModel: (summarizerModel) => set({ summarizerModel }),
            summarizerBasePrompt: 'Summarize the following text in 5 sentences.',
            setSummarizerBasePrompt: (summarizerBasePrompt) => set({ summarizerBasePrompt }),
            summarizerFragments: [...defaultFragments],
            toggleSummarizerFragment: (id) => set((state) => ({
                summarizerFragments: state.summarizerFragments.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
            })),

            // Legacy Summarizer
            summaryChunkSize: 2500,
            setSummaryChunkSize: (summaryChunkSize) => set({ summaryChunkSize }),

            summaryPrompt: "Summarize the following text in 5 sentences. Focus on the plot and key events.",
            setSummaryPrompt: (summaryPrompt) => set({ summaryPrompt }),
        }),
        {
            name: 'xyz-settings',
        }
    )
);
