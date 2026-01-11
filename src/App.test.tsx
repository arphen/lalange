import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock child components to avoid complex setup
vi.mock('./components/Library/Archive', () => ({
    Archive: () => <div data-testid="archive">Archive</div>
}));
vi.mock('./components/Library/Librarian', () => ({
    Librarian: () => <div data-testid="librarian">Librarian</div>
}));
vi.mock('./components/Reader/Reader', () => ({
    Reader: () => <div data-testid="reader">Reader</div>
}));
vi.mock('./components/Settings/SettingsPanel', () => ({
    SettingsPanel: () => <div data-testid="settings">Settings</div>
}));
vi.mock('./components/Manifesto', () => ({
    Manifesto: () => <div data-testid="manifesto">Manifesto</div>
}));

// Mock stores
vi.mock('./core/store/settings', () => ({
    useSettingsStore: () => ({ 
        theme: 'volcanic',
        editorModel: 'tiny',
        hasCompletedOnboarding: true,
        setEditorModel: vi.fn(),
        setLibrarianModelTier: vi.fn(),
        setSummarizerModel: vi.fn()
    })
}));

vi.mock('./core/store/ai', () => ({
    useAIStore: () => ({ 
        activity: null,
        isLoading: false,
        progress: '',
        progressValue: 0,
        lifecycleState: 'idle',
        error: null,
        activeModelName: null,
        tps: 0,
        isPanelExpanded: false,
        togglePanelExpanded: vi.fn(),
        currentTask: null,
        modelStats: {
            name: null,
            sizeBytes: 0,
            loadStartTime: null,
            loadEndTime: null,
            crashCount: 0,
            lastCrashError: null,
            inferenceCount: 0
        },
        summaryTiming: {
            durations: [],
            currentStartTime: null,
            averageDuration: null
        },
        getSummaryProgress: () => null
    })
}));

// Mock WebLLM
vi.mock('./core/ai/webllm', () => ({
    MODEL_INFO: {
        tiny: { name: 'Tiny', size: '600 MB', description: 'Desc' }
    },
    isModelCached: vi.fn().mockResolvedValue(true),
    getEngine: vi.fn()
}));

describe('App Component', () => {
    it('renders the correct header title', () => {
        render(<App />);
        // The brand name "XYZ" is split into X and YZ
        expect(screen.getByText('X')).toBeInTheDocument();
        expect(screen.getByText('YZ')).toBeInTheDocument();
    });

    it('renders the correct footer text with styling', () => {
        render(<App />);
        expect(screen.getByText(/Made by/i)).toBeInTheDocument();

        const arphen = screen.getByText('Arphen');
        expect(arphen).toBeInTheDocument();
        expect(arphen).toHaveClass('text-neon-pride');
        expect(arphen).toHaveClass('font-bold');
    });
});
