import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrowOnRender = false;

const MaybeCrash = () => {
    if (shouldThrowOnRender) {
        throw new Error('render crash');
    }

    return <div>healthy subtree</div>;
};

const dispatchUnhandledRejection = (reason: unknown) => {
    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: reason, configurable: true });
    window.dispatchEvent(event);
};

describe('ErrorBoundary', () => {
    beforeEach(() => {
        shouldThrowOnRender = false;
        vi.spyOn(console, 'error').mockImplementation(() => {
            // silence expected React/runtime error logs in test output
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders children when no error is present', () => {
        render(
            <ErrorBoundary>
                <MaybeCrash />
            </ErrorBoundary>,
        );

        expect(screen.getByText('healthy subtree')).toBeInTheDocument();
    });

    it('recovers after a render crash when user chooses recovery', async () => {
        shouldThrowOnRender = true;

        render(
            <ErrorBoundary>
                <MaybeCrash />
            </ErrorBoundary>,
        );

        expect(screen.getByText('SYSTEM FAILURE')).toBeInTheDocument();

        shouldThrowOnRender = false;
        fireEvent.click(screen.getByRole('button', { name: 'TRY RECOVERY' }));

        await waitFor(() => {
            expect(screen.getByText('healthy subtree')).toBeInTheDocument();
        });
    });

    it('surfaces unhandled promise rejections in the boundary', async () => {
        render(
            <ErrorBoundary>
                <MaybeCrash />
            </ErrorBoundary>,
        );

        act(() => {
            dispatchUnhandledRejection(new Error('async crash'));
        });

        await waitFor(() => {
            expect(screen.getByText('SYSTEM FAILURE')).toBeInTheDocument();
            expect(screen.getByText(/async crash/i)).toBeInTheDocument();
        });
    });

    it('ignores aborted async operations to avoid false-positive crashes', async () => {
        render(
            <ErrorBoundary>
                <MaybeCrash />
            </ErrorBoundary>,
        );

        act(() => {
            const abortError = new Error('operation aborted');
            abortError.name = 'AbortError';
            dispatchUnhandledRejection(abortError);
        });

        await waitFor(() => {
            expect(screen.queryByText('SYSTEM FAILURE')).not.toBeInTheDocument();
            expect(screen.getByText('healthy subtree')).toBeInTheDocument();
        });
    });
});