import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen } from './useFullscreen';

type FullscreenTestDocument = Document & {
    fullscreenElement?: Element | null;
    exitFullscreen?: () => Promise<void> | void;
};

const TestHarness = () => {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    const { isFullscreen, isFullscreenSupported, toggleFullscreen } = useFullscreen(target);

    return (
        <div>
            <div ref={setTarget} data-testid="fullscreen-target" />
            <div data-testid="supported">{isFullscreenSupported ? 'yes' : 'no'}</div>
            <div data-testid="active">{isFullscreen ? 'yes' : 'no'}</div>
            <button type="button" onClick={() => void toggleFullscreen()}>
                toggle
            </button>
        </div>
    );
};

describe('useFullscreen', () => {
    let requestFullscreenMock: ReturnType<typeof vi.fn>;
    let exitFullscreenMock: ReturnType<typeof vi.fn>;
    let fullscreenElement: Element | null;
    let originalRequestFullscreen: PropertyDescriptor | undefined;
    let originalExitFullscreen: PropertyDescriptor | undefined;
    let originalFullscreenElement: PropertyDescriptor | undefined;

    beforeEach(() => {
        fullscreenElement = null;

        originalRequestFullscreen = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
        originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
        originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');

        requestFullscreenMock = vi.fn(async () => {
            fullscreenElement = document.querySelector('[data-testid="fullscreen-target"]');
            document.dispatchEvent(new Event('fullscreenchange'));
        });

        exitFullscreenMock = vi.fn(async () => {
            fullscreenElement = null;
            document.dispatchEvent(new Event('fullscreenchange'));
        });

        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
            configurable: true,
            value: requestFullscreenMock,
        });

        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreenMock,
        });

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
    });

    afterEach(() => {
        if (originalRequestFullscreen) {
            Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalRequestFullscreen);
        } else {
            delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
        }

        if (originalExitFullscreen) {
            Object.defineProperty(document, 'exitFullscreen', originalExitFullscreen);
        } else {
            delete (document as Partial<FullscreenTestDocument>).exitFullscreen;
        }

        if (originalFullscreenElement) {
            Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement);
        } else {
            delete (document as Partial<FullscreenTestDocument>).fullscreenElement;
        }
    });

    it('detects support and toggles fullscreen on and off', async () => {
        render(<TestHarness />);

        expect(screen.getByTestId('supported')).toHaveTextContent('yes');
        expect(screen.getByTestId('active')).toHaveTextContent('no');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
        });

        expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active')).toHaveTextContent('yes');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
        });

        expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active')).toHaveTextContent('no');
    });

    it('reports unsupported when fullscreen APIs are missing', () => {
        delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
        delete (document as Partial<FullscreenTestDocument>).exitFullscreen;

        render(<TestHarness />);

        expect(screen.getByTestId('supported')).toHaveTextContent('no');
        expect(screen.getByTestId('active')).toHaveTextContent('no');
    });
});