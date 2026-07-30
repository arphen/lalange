import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateStatus } from './PwaUpdateStatus';

const { controller } = vi.hoisted(() => {
    const snapshot = {
        status: 'available' as const,
        attempt: 0,
        error: null,
        hash: 'd34db33',
        changelogUrl: 'https://github.com/arpheno/lalange/compare/c96fe5f...d34db33',
    };
    return { controller: {
        subscribe: vi.fn(() => () => undefined),
        getSnapshot: vi.fn(() => snapshot),
        applyUpdate: vi.fn(),
        retry: vi.fn(),
        dismiss: vi.fn(),
    } };
});

vi.mock('../core/pwa/browserUpdateController', () => ({
    pwaUpdateController: controller,
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('PwaUpdateStatus', () => {
    it('links the proposed hash to its GitHub changelog before reloading', () => {
        render(<PwaUpdateStatus />);

        expect(screen.getByRole('heading', { name: 'Update Available' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /d34db33.*changelog/i })).toHaveAttribute(
            'href',
            'https://github.com/arpheno/lalange/compare/c96fe5f...d34db33',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Update Now' }));

        expect(controller.applyUpdate).toHaveBeenCalledOnce();
    });
});