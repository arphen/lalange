import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDocType } from '../../core/sync/db';
import { ExchangeSheet } from './ExchangeSheet';

const mockApplyAnswerCode = vi.hoisted(() => vi.fn());
const mockCreateExchangeBundle = vi.hoisted(() => vi.fn());
const mockCreateOpticalExchangeOffer = vi.hoisted(() => vi.fn());

vi.mock('../../core/exchange', () => ({
    applyExchangeBundle: vi.fn(),
    createExchangeBundle: mockCreateExchangeBundle,
    createOpticalExchangeOffer: mockCreateOpticalExchangeOffer,
    discardStagedExchangeBundle: vi.fn(),
    getDefaultExchangeSelection: vi.fn(() => ({
        content: true,
        analysis: false,
        progress: false,
        highlights: false,
        listening: false,
    })),
    planExchangeImport: vi.fn(),
    stageExchangeBundle: vi.fn(),
    summarizeExchangeInvitation: vi.fn(() => ({})),
}));

vi.mock('./QrCameraScanner', () => ({
    QrCameraScanner: () => <div>Camera scanner</div>,
}));

describe('ExchangeSheet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateExchangeBundle.mockResolvedValue({
            manifest: { intent: 'handoff' },
            books: [],
        });
        mockCreateOpticalExchangeOffer.mockResolvedValue({
            invitationUrl: 'https://arphen.xyz/exchange#offer=payload',
            pairingCode: 'FBCA7B',
            peer: {
                applyAnswerCode: mockApplyAnswerCode,
                close: vi.fn(),
            },
        });
    });

    it('keeps a pasted verification code on the scan step with actionable guidance', async () => {
        const book = { id: 'book-1', title: 'Book', author: 'Author' } as BookDocType;
        render(<ExchangeSheet isOpen books={[book]} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /Show transfer code/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Scan their answer/i }));

        fireEvent.change(screen.getByPlaceholderText('Or paste full answer code'), {
            target: { value: 'FBCA7B' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(await screen.findByText(/six-character verification code/i)).toBeInTheDocument();
        expect(screen.getByText('Camera scanner')).toBeInTheDocument();
        expect(mockApplyAnswerCode).not.toHaveBeenCalled();
    });
});