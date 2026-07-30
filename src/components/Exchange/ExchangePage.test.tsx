import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExchangePage } from './ExchangePage';

const mockAnswerOpticalExchangeOffer = vi.hoisted(() => vi.fn());
const mockWriteText = vi.hoisted(() => vi.fn());

vi.mock('../../core/exchange', () => ({
    answerOpticalExchangeOffer: mockAnswerOpticalExchangeOffer,
    applyExchangeBundle: vi.fn(),
    createExchangeBundle: vi.fn(),
    decodePairingSignal: vi.fn().mockResolvedValue({
        kind: 'offer',
        sessionId: 'session',
        secret: 'fbc-a7b',
        description: { type: 'offer', sdp: 'offer' },
        invitation: {
            sourceDevice: { name: 'Phone' },
            intent: 'handoff',
            books: [],
            bookCount: 1,
        },
    }),
    discardStagedExchangeBundle: vi.fn(),
    extractPairingCode: vi.fn(),
    planExchangeImport: vi.fn(),
    stageExchangeBundle: vi.fn(),
}));

vi.mock('./QrCameraScanner', () => ({
    QrCameraScanner: ({ onScan }: { onScan: (value: string) => void }) => (
        <button type="button" onClick={() => onScan('offer-code')}>Scan invitation QR</button>
    ),
}));

describe('ExchangePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: mockWriteText },
        });
        mockWriteText.mockResolvedValue(undefined);
        mockAnswerOpticalExchangeOffer.mockResolvedValue({
            peer: {
                close: vi.fn(),
                receiveBundle: vi.fn(() => new Promise(() => undefined)),
            },
            answerCode: 'xchg1.j.full-answer-payload',
            pairingCode: 'FBCA7B',
            invitation: {
                sourceDevice: { name: 'Phone' },
                intent: 'handoff',
                books: [],
                bookCount: 1,
            },
        });
    });

    it('copies the full answer payload and labels the short code as verification-only', async () => {
        render(<MemoryRouter><ExchangePage /></MemoryRouter>);

        fireEvent.click(screen.getByRole('button', { name: 'Scan invitation QR' }));
        fireEvent.click(await screen.findByRole('button', { name: /Accept and show answer/i }));

        const copyButton = await screen.findByRole('button', { name: 'Copy full answer code' });
        expect(screen.getByText('Verify only')).toBeInTheDocument();
        expect(screen.getByLabelText('Full answer code')).toHaveValue('xchg1.j.full-answer-payload');

        fireEvent.click(copyButton);

        await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith('xchg1.j.full-answer-payload'));
        expect(await screen.findByRole('button', { name: 'Full answer copied' })).toBeInTheDocument();
    });
});