import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepairReviewPanel } from './RepairReviewPanel';

const mocks = vi.hoisted(() => ({
    initDB: vi.fn(),
    repairQueue: {
        startBook: vi.fn(),
        applyReady: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
        retryFailed: vi.fn(),
    },
}));

vi.mock('../../core/sync/db', () => ({
    initDB: mocks.initDB,
}));

vi.mock('../../core/store/settings', () => ({
    useSettingsStore: (selector: (state: { textRepairMode: 'review'; repairModelId: 'qwen' }) => unknown) => selector({
        textRepairMode: 'review',
        repairModelId: 'qwen',
    }),
}));

vi.mock('../../core/ingest/repairQueue', () => ({
    repairQueue: mocks.repairQueue,
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

    it('starts all preparation from one queue action', async () => {
        mocks.repairQueue.startBook.mockResolvedValue({ total: 4 });
        render(
            <RepairReviewPanel
                bookId="book-1"
                bookTitle="Test Book"
                onClose={vi.fn()}
            />,
        );

        fireEvent.click(await screen.findByTestId('repair-prepare-all'));

        await waitFor(() => expect(mocks.repairQueue.startBook).toHaveBeenCalledWith('book-1', 'qwen'));
    });

    it('routes fix all to every ready issue in the current book', async () => {
        const issue = {
            id: 'issue-1',
            state: 'open',
            proposal: { candidateId: 'issue-1', action: 'replace', replacement: 'the', reasonCode: 'ocr-substitution' },
            detectorIds: ['numeric-alphanumeric-intrusion'],
            severity: 'medium',
            ambiguity: 'high',
        };
        const issueSubscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback([{ toJSON: () => issue }]);
            return { unsubscribe: vi.fn() };
        });
        const chapterSubscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback([]);
            return { unsubscribe: vi.fn() };
        });
        mocks.initDB.mockResolvedValue({
            text_issues: { find: vi.fn(() => ({ $: { subscribe: issueSubscribe } })) },
            chapters: { find: vi.fn(() => ({ $: { subscribe: chapterSubscribe } })) },
        });
        mocks.repairQueue.applyReady.mockResolvedValue({ selected: 1, applied: 1, blocked: 0, errors: [] });
        vi.stubGlobal('confirm', vi.fn(() => true));

        render(
            <RepairReviewPanel
                bookId="book-1"
                bookTitle="Test Book"
                onClose={vi.fn()}
            />,
        );

        fireEvent.click(await screen.findByTestId('repair-fix-all'));

        await waitFor(() => expect(mocks.repairQueue.applyReady).toHaveBeenCalledWith('book-1', ['issue-1']));
        vi.unstubAllGlobals();
    });

    it('applies only checked ready issues', async () => {
        const issues = [
            { id: 'issue-1', state: 'open', proposal: { candidateId: 'issue-1', action: 'replace', replacement: 'the', reasonCode: 'ocr-substitution' }, detectorIds: ['numeric-alphanumeric-intrusion'], severity: 'medium', ambiguity: 'high' },
            { id: 'issue-2', state: 'open', proposal: { candidateId: 'issue-2', action: 'replace', replacement: 'hope', reasonCode: 'ocr-substitution' }, detectorIds: ['numeric-alphanumeric-intrusion'], severity: 'medium', ambiguity: 'high' },
        ];
        const issueSubscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback(issues.map((issue) => ({ toJSON: () => issue })));
            return { unsubscribe: vi.fn() };
        });
        const chapterSubscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback([]);
            return { unsubscribe: vi.fn() };
        });
        mocks.initDB.mockResolvedValue({
            text_issues: { find: vi.fn(() => ({ $: { subscribe: issueSubscribe } })) },
            chapters: { find: vi.fn(() => ({ $: { subscribe: chapterSubscribe } })) },
        });
        mocks.repairQueue.applyReady.mockResolvedValue({ selected: 1, applied: 1, blocked: 0, errors: [] });
        vi.stubGlobal('confirm', vi.fn(() => true));

        render(
            <RepairReviewPanel
                bookId="book-1"
                bookTitle="Test Book"
                onClose={vi.fn()}
            />,
        );

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Select repair issue-2' }));
        fireEvent.click(screen.getByTestId('repair-apply-selected'));

        await waitFor(() => expect(mocks.repairQueue.applyReady).toHaveBeenCalledWith('book-1', ['issue-2']));
        vi.unstubAllGlobals();
    });

    it('switches from pause to resume while pending jobs remain', async () => {
        const job = {
            id: 'repair-job-1',
            state: 'pending',
            feature: 'repair',
            bookId: 'book-1',
        };
        const subscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback([]);
            return { unsubscribe: vi.fn() };
        });
        const jobSubscribe = vi.fn((callback: (documents: unknown[]) => void) => {
            callback([{ toJSON: () => job }]);
            return { unsubscribe: vi.fn() };
        });
        mocks.initDB.mockResolvedValue({
            text_issues: { find: vi.fn(() => ({ $: { subscribe } })) },
            chapters: { find: vi.fn(() => ({ $: { subscribe } })) },
            processing_jobs: { find: vi.fn(() => ({ $: { subscribe: jobSubscribe } })) },
        });

        render(
            <RepairReviewPanel
                bookId="book-1"
                bookTitle="Test Book"
                onClose={vi.fn()}
            />,
        );

        fireEvent.click(await screen.findByTestId('repair-pause'));
        await waitFor(() => expect(mocks.repairQueue.pause).toHaveBeenCalledWith('book-1'));
        expect(screen.getByTestId('repair-resume')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('repair-resume'));
        await waitFor(() => expect(mocks.repairQueue.resume).toHaveBeenCalledWith('book-1'));
    });
});