import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from './App';

let mockTheme: 'volcanic' | 'day' | 'ash' | 'dunes' = 'volcanic';
const mockSetTheme = vi.fn();

// Mock child components to avoid complex setup
vi.mock('./components/Library/Archive', () => ({
    Archive: ({ onScanHandoff }: { onScanHandoff: () => void }) => (
        <button type="button" data-testid="archive" onClick={onScanHandoff}>Scan handoff from Archive</button>
    )
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
vi.mock('./components/Exchange/ExchangePage', () => ({
    ExchangePage: () => <div data-testid="exchange-scanner">In-app handoff scanner</div>
}));

// Mock stores
vi.mock('./core/store/settings', () => ({
    useSettingsStore: () => ({ 
        theme: mockTheme,
        editorModel: 'tiny',
        setTheme: mockSetTheme,
        setEditorModel: vi.fn(),
        setLibrarianModelTier: vi.fn(),
        setSummarizerModel: vi.fn()
    })
}));

vi.mock('./core/store/ai', () => ({
        useAIStore: (selector?: (state: Record<string, unknown>) => unknown) => {
            const state = {
        activity: null,
        isLoading: false,
                isSetupOpen: false,
                setupIntent: 'pacing',
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
                getSummaryProgress: () => null,
                closeSetup: vi.fn(),
                requestSetup: vi.fn()
            };
            return selector ? selector(state) : state;
        }
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
        expect(screen.getByTitle('Deployed application version')).toHaveTextContent('Version unknown');

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

    it('opens the handoff scanner inside the app', async () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Scan handoff from Archive' }));

        expect(await screen.findByTestId('exchange-scanner')).toBeInTheDocument();
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
