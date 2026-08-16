import { beforeEach, describe, expect, it } from 'vitest';
import { selectAIIsLoading, selectAIIsReady, useAIStore } from './ai';

describe('AI lifecycle compatibility state', () => {
    beforeEach(() => {
        useAIStore.setState({
            lifecycleState: 'idle',
            isLoading: false,
            isReady: false,
            error: null,
            loadingModel: null,
        });
    });

    it('derives compatibility selectors from lifecycle state', () => {
        expect(selectAIIsLoading({ lifecycleState: 'downloading' })).toBe(true);
        expect(selectAIIsLoading({ lifecycleState: 'unloading' })).toBe(true);
        expect(selectAIIsLoading({ lifecycleState: 'ready' })).toBe(false);
        expect(selectAIIsReady({ lifecycleState: 'ready' })).toBe(true);
        expect(selectAIIsReady({ lifecycleState: 'loading' })).toBe(false);
    });

    it('keeps legacy readiness fields synchronized with lifecycle actions', () => {
        const { setLifecycleState, setLoading, setReady, setError } = useAIStore.getState();

        setLifecycleState('downloading');
        expect(useAIStore.getState()).toMatchObject({ isLoading: true, isReady: false });

        setLifecycleState('ready');
        expect(useAIStore.getState()).toMatchObject({ isLoading: false, isReady: true });

        setLoading(false);
        expect(useAIStore.getState()).toMatchObject({ lifecycleState: 'ready', isLoading: false, isReady: true });

        setReady(false);
        expect(useAIStore.getState()).toMatchObject({ lifecycleState: 'idle', isLoading: false, isReady: false });

        setLoading(true, 'tiny');
        expect(useAIStore.getState()).toMatchObject({ lifecycleState: 'loading', isLoading: true, isReady: false });

        setError('failed');
        expect(useAIStore.getState()).toMatchObject({ lifecycleState: 'crashed', isLoading: false, isReady: false });
    });
});
