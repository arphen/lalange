import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AISetupWizard } from './ModelDownloadModal';
import { getEngine, isModelCached } from '../core/ai/webllm';

const mocks = vi.hoisted(() => ({
    isSetupOpen: false,
    setupIntent: 'pacing' as 'pacing' | 'summaries',
    closeSetup: vi.fn(),
    requestSetup: vi.fn(),
    setAiEnabled: vi.fn(),
    setEditorModel: vi.fn(),
    setLibrarianModelTier: vi.fn(),
    setPacingModelTier: vi.fn(),
    setSummariesEnabled: vi.fn(),
    setSummarizerModel: vi.fn(),
}));

vi.mock('../core/store/settings', () => ({
    useSettingsStore: () => ({
        pacingModelTier: 'tiny',
        setAiEnabled: mocks.setAiEnabled,
        setEditorModel: mocks.setEditorModel,
        setLibrarianModelTier: mocks.setLibrarianModelTier,
        setPacingModelTier: mocks.setPacingModelTier,
        setSummariesEnabled: mocks.setSummariesEnabled,
        setSummarizerModel: mocks.setSummarizerModel,
    }),
}));

vi.mock('../core/store/ai', () => ({
    useAIStore: () => ({
        isSetupOpen: mocks.isSetupOpen,
        setupIntent: mocks.setupIntent,
        closeSetup: mocks.closeSetup,
        requestSetup: mocks.requestSetup,
    }),
}));

vi.mock('../core/ai/webllm', () => ({
    MODEL_INFO: { tiny: { name: 'Tiny', size: '700 MB', description: 'Local AI' } },
    isModelCached: vi.fn().mockResolvedValue(false),
    getEngine: vi.fn().mockResolvedValue(undefined),
}));

describe('AISetupWizard', () => {
    beforeEach(() => {
        mocks.isSetupOpen = false;
        mocks.setupIntent = 'pacing';
        vi.clearAllMocks();
        vi.mocked(isModelCached).mockResolvedValue(false);
        vi.mocked(getEngine).mockResolvedValue({} as Awaited<ReturnType<typeof getEngine>>);
    });

    it('does not inspect storage or appear until setup is explicitly requested', async () => {
        render(<AISetupWizard />);

        await waitFor(() => expect(isModelCached).not.toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('can be dismissed without enabling AI', () => {
        mocks.isSetupOpen = true;
        render(<AISetupWizard />);

        expect(screen.getByRole('heading', { name: 'Set up adaptive pacing' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Keep reading' }));

        expect(mocks.closeSetup).toHaveBeenCalled();
        expect(mocks.setAiEnabled).not.toHaveBeenCalled();
        expect(getEngine).not.toHaveBeenCalled();
    });

    it('enables AI only after the selected model is ready', async () => {
        let finishSetup: (() => void) | undefined;
        vi.mocked(getEngine).mockReturnValueOnce(new Promise<Awaited<ReturnType<typeof getEngine>>>((resolve) => {
            finishSetup = () => resolve({} as Awaited<ReturnType<typeof getEngine>>);
        }));
        mocks.isSetupOpen = true;
        render(<AISetupWizard />);

        fireEvent.click(screen.getByRole('button', { name: 'Set up in background' }));

        expect(mocks.closeSetup).toHaveBeenCalled();
        expect(getEngine).toHaveBeenCalledWith('tiny');
        expect(mocks.setAiEnabled).not.toHaveBeenCalled();

        finishSetup?.();
        await waitFor(() => expect(mocks.setAiEnabled).toHaveBeenCalledWith(true));
        expect(mocks.setSummariesEnabled).not.toHaveBeenCalled();
    });

    it('enables summaries after summary setup completes', async () => {
        mocks.isSetupOpen = true;
        mocks.setupIntent = 'summaries';
        render(<AISetupWizard />);

        fireEvent.click(screen.getByRole('button', { name: 'Set up in background' }));

        await waitFor(() => expect(mocks.setSummariesEnabled).toHaveBeenCalledWith(true));
        expect(mocks.setAiEnabled).toHaveBeenCalledWith(true);
    });
});