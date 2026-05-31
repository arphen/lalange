import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

let mockTheme: 'volcanic' | 'day' | 'ash' | 'dunes' = 'volcanic';
const mockSetTheme = vi.fn();

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
        theme: mockTheme,
        editorModel: 'tiny',
        hasCompletedOnboarding: true,
        setTheme: mockSetTheme,
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
    beforeEach(() => {
        mockTheme = 'volcanic';
        mockSetTheme.mockClear();
        document.body.className = '';
    });

    it('renders the correct header title', () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );
        // The brand name "XYZ" is split into X and YZ
        expect(screen.getByText('X')).toBeInTheDocument();
        expect(screen.getByText('YZ')).toBeInTheDocument();
    });

    it('renders the correct footer text with styling', () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );
        expect(screen.getByText(/Made by/i)).toBeInTheDocument();

        const arphen = screen.getByText('Arphen');
        expect(arphen).toBeInTheDocument();
        expect(arphen).toHaveClass('text-neon-pride');
        expect(arphen).toHaveClass('font-bold');
    });

    it('renders a visible global theme toggle control', () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByRole('button', { name: 'Switch to day theme' })).toBeInTheDocument();
    });

    it('switches from dark to day when toggle is clicked', () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch to day theme' }));
        expect(mockSetTheme).toHaveBeenCalledWith('day');
    });

    it('switches from day to dark when toggle is clicked', () => {
        mockTheme = 'day';

        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
        expect(mockSetTheme).toHaveBeenCalledWith('volcanic');
    });

    it('applies the day theme class when day mode is selected', () => {
        mockTheme = 'day';

        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        expect(document.body).toHaveClass('theme-day');
        expect(document.body).not.toHaveClass('theme-ash');
    });

    it('maps legacy dunes mode to the day theme class', () => {
        mockTheme = 'dunes';

        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        expect(document.body).toHaveClass('theme-day');
    });

    it('applies ash class for ash mode', () => {
        mockTheme = 'ash';

        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        expect(document.body).toHaveClass('theme-ash');
        expect(document.body).not.toHaveClass('theme-day');
    });
});
