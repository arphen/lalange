import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepairReviewPanel } from './RepairReviewPanel';

const mocks = vi.hoisted(() => ({
    initDB: vi.fn(),
}));

vi.mock('../../core/sync/db', () => ({
    initDB: mocks.initDB,
}));

vi.mock('../../core/ingest/repair', () => ({
    acceptRepairProposal: vi.fn(),
    activateRepairRevision: vi.fn(),
    createRepairContext: vi.fn(),
    keepRepairOriginal: vi.fn(),
    requestRepairProposal: vi.fn(),
}));

describe('RepairReviewPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
        mocks.initDB.mockResolvedValue({
            text_issues: { find: vi.fn(() => ({ $: { subscribe } })) },
            chapters: { find: vi.fn(() => ({ $: { subscribe } })) },
        });
    });

    it('mounts without an external-store update loop', async () => {
        render(
            <RepairReviewPanel
                bookId="book-1"
                bookTitle="Test Book"
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByRole('dialog', { name: 'Test Book' })).toBeInTheDocument();
        await waitFor(() => expect(mocks.initDB).toHaveBeenCalledOnce());
    });
});