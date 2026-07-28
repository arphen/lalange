import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding';

const setAiEnabled = vi.fn();
const setHasCompletedOnboarding = vi.fn();

vi.mock('../../core/store/settings', () => ({
    useSettingsStore: () => ({
        displayPlugin: 'velocireader',
        setAiEnabled,
        setHasCompletedOnboarding,
    }),
}));

vi.mock('../../core/store/ai', () => ({
    useAIStore: () => ({ isLoading: false, progressValue: 0 }),
}));

vi.mock('../../core/ai/webllm', () => ({
    downloadModelToCache: vi.fn(),
}));

describe('Onboarding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enters the library without starting the optional AI setup', () => {
        render(<Onboarding />);

        fireEvent.click(screen.getByRole('button', { name: 'Enter Library' }));

        expect(setAiEnabled).toHaveBeenCalledWith(false);
        expect(setHasCompletedOnboarding).toHaveBeenCalledWith(true);
    });
});