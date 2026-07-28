import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelDownloadModal } from './ModelDownloadModal';
import { isModelCached } from '../core/ai/webllm';

let aiEnabled = false;

vi.mock('../core/store/settings', () => ({
    useSettingsStore: () => ({
        aiEnabled,
        editorModel: 'tiny',
        setEditorModel: vi.fn(),
        setLibrarianModelTier: vi.fn(),
        setSummarizerModel: vi.fn(),
    }),
}));

vi.mock('../core/ai/webllm', () => ({
    MODEL_INFO: { tiny: { name: 'Tiny', size: '700MB', description: 'Local AI' } },
    isModelCached: vi.fn().mockResolvedValue(false),
    getEngine: vi.fn(),
}));

describe('ModelDownloadModal', () => {
    beforeEach(() => {
        aiEnabled = false;
        vi.clearAllMocks();
    });

    it('does not prompt or check model storage when AI is disabled', async () => {
        render(
            <MemoryRouter initialEntries={['/reader/book-1']}>
                <ModelDownloadModal />
            </MemoryRouter>,
        );

        await waitFor(() => expect(isModelCached).not.toHaveBeenCalled());
        expect(screen.queryByRole('heading', { name: 'Local Processing Setup' })).not.toBeInTheDocument();
    });
});