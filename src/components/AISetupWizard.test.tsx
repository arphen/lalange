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
        summarizerModel: 'tiny',
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
    WEBLLM_ERROR_CODES: {
        STORAGE_QUOTA_EXCEEDED: 'BROWSER_STORAGE_QUOTA_EXCEEDED',
        WEBGPU_LIMIT_UNSUPPORTED: 'WEBGPU_LIMIT_UNSUPPORTED',
        WEBGPU_UNAVAILABLE: 'WEBGPU_UNAVAILABLE',
    },
    isModelCached: vi.fn().mockResolvedValue(false),
    getEngine: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/ai/modelManifest', () => ({
    MODEL_INFO: {
        tiny: { name: 'Tiny', size: '700 MB', description: 'Local AI' },
        qwen: { name: 'Qwen', size: '980 MB', description: 'Larger local AI' },
    },
    PACING_MODEL_TIER: 'tiny',
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
        expect(screen.getByText('Tiny')).toBeInTheDocument();
        expect(screen.queryByText('Qwen')).not.toBeInTheDocument();
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

        fireEvent.click(screen.getByRole('button', { name: 'Download & enable pacing' }));

        expect(mocks.closeSetup).toHaveBeenCalled();
        expect(getEngine).toHaveBeenCalledWith('tiny');
        expect(mocks.setAiEnabled).not.toHaveBeenCalled();

        finishSetup?.();
        await waitFor(() => expect(mocks.setAiEnabled).toHaveBeenCalledWith(true));
        expect(mocks.setPacingModelTier).toHaveBeenCalledWith('tiny');
        expect(mocks.setSummariesEnabled).not.toHaveBeenCalled();
    });

    it('enables summaries after summary setup completes', async () => {
        mocks.isSetupOpen = true;
        mocks.setupIntent = 'summaries';
        render(<AISetupWizard />);

        fireEvent.click(screen.getByRole('button', { name: 'Download & enable summaries' }));

        await waitFor(() => expect(mocks.setSummariesEnabled).toHaveBeenCalledWith(true));
        expect(mocks.setAiEnabled).not.toHaveBeenCalled();
    });

    it('shows a compatibility message when WebGPU limits are too low', async () => {
        mocks.isSetupOpen = true;
        vi.mocked(getEngine).mockRejectedValueOnce(new Error('WEBGPU_LIMIT_UNSUPPORTED'));
        render(<AISetupWizard />);

        fireEvent.click(screen.getByRole('button', { name: 'Download & enable pacing' }));

        await waitFor(() => expect(mocks.setAiEnabled).toHaveBeenCalledWith(false));
        expect(mocks.requestSetup).toHaveBeenCalledWith('pacing');
        expect(screen.getByText(/currently exposes too few WebGPU resources/i)).toBeInTheDocument();
    });
});
