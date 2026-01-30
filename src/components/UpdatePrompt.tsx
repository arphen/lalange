import React, { useEffect, useState, useCallback, useRef } from 'react';

// Type for the registerSW function from vite-plugin-pwa
type RegisterSWOptions = {
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
    immediate?: boolean;
};

/**
 * UpdatePrompt - Shows a toast when a new version of the app is available.
 * Users can choose when to update (preserves their workflow).
 * 
 * LLM models are stored in IndexedDB and are NOT affected by app updates.
 * 
 * This component dynamically imports the PWA registration to avoid breaking
 * in test environments where the virtual module doesn't exist.
 */
export const UpdatePrompt: React.FC = () => {
    const [showPrompt, setShowPrompt] = useState(false);
    const [updateFn, setUpdateFn] = useState<((reload?: boolean) => Promise<void>) | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
    
    useEffect(() => {
        // Only run in production (PWA is disabled in dev - see vite.config.ts)
        if (import.meta.env.DEV || import.meta.env.MODE === 'test') return;
        
        // Listen for controller change - this fires when a new SW takes control
        // Reload the page to ensure we're running the latest code
        const handleControllerChange = () => {
            console.log('[SW] Controller changed, reloading page...');
            window.location.reload();
        };
        navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);
        
        // Use dynamic import with try/catch to handle the virtual module not existing
        // This pattern avoids eval-like constructs while still handling test environments
        const loadPWA = async () => {
            try {
                // Dynamic import of virtual module - wrapped in try/catch for environments
                // where the module doesn't exist (tests, non-PWA builds)
                const pwaModule = await import('virtual:pwa-register');
                const { registerSW } = pwaModule as { registerSW: (opts: RegisterSWOptions) => (reload?: boolean) => Promise<void> };
                
                const updateSW = registerSW({
                    immediate: true, // Check for updates immediately on load
                    onNeedRefresh() {
                        // New content available, show the prompt
                        console.log('[SW] New content available, showing update prompt');
                        setShowPrompt(true);
                        setUpdateFn(() => updateSW);
                    },
                    onOfflineReady() {
                        console.log('[SW] App ready for offline use');
                    },
                    onRegisteredSW(swUrl: string, registration: ServiceWorkerRegistration | undefined) {
                        console.log('[SW] Registered:', swUrl);
                        if (registration) {
                            registrationRef.current = registration;
                            
                            // Check for updates every 60 seconds (more aggressive)
                            intervalRef.current = setInterval(() => {
                                console.log('[SW] Checking for updates...');
                                registration.update().catch(console.error);
                            }, 60 * 1000);
                            
                            // Also check immediately
                            registration.update().catch(console.error);
                        }
                    },
                    onRegisterError(error: Error) {
                        console.error('[SW] Registration error:', error);
                    },
                });
            } catch (err) {
                // PWA module not available (e.g., in tests)
                const error = err as Error;
                console.debug('[SW] PWA not available:', error.message);
            }
        };
        
        void loadPWA();
        
        // Cleanup on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
        };
    }, []);

    const handleUpdate = useCallback(async () => {
        setIsUpdating(true);
        
        try {
            // First, try to get the waiting service worker to skip waiting
            const registration = registrationRef.current;
            if (registration?.waiting) {
                console.log('[SW] Telling waiting worker to skip waiting...');
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            
            // Then call the updateSW function
            if (updateFn) {
                console.log('[SW] Calling updateSW(true)...');
                await updateFn(true); // true = reload page after update
            } else {
                // Fallback: just reload the page
                console.log('[SW] No updateFn, reloading page directly...');
                window.location.reload();
            }
        } catch (error) {
            console.error('[SW] Update failed:', error);
            // Fallback: reload anyway
            window.location.reload();
        }
    }, [updateFn]);

    const handleDismiss = useCallback(() => {
        setShowPrompt(false);
    }, []);

    if (!showPrompt) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[100] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="bg-black/90 backdrop-blur-xl border border-dune-gold/30 rounded-lg shadow-2xl p-4">
                <div className="flex items-start gap-3">
                    {/* Update Icon */}
                    <div className="shrink-0 w-10 h-10 bg-dune-gold/20 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-dune-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <h4 className="font-mono text-sm font-bold text-white tracking-wide">
                            Update Available
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                            A new version is ready. Your AI models will be preserved.
                        </p>
                        
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={handleUpdate}
                                disabled={isUpdating}
                                className="px-3 py-1.5 bg-dune-gold text-black text-xs font-bold rounded hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-wait"
                            >
                                {isUpdating ? 'Updating...' : 'Update Now'}
                            </button>
                            <button
                                onClick={handleDismiss}
                                disabled={isUpdating}
                                className="px-3 py-1.5 text-gray-400 text-xs hover:text-white transition-colors disabled:opacity-50"
                            >
                                Later
                            </button>
                        </div>
                    </div>
                    
                    {/* Close button */}
                    <button
                        onClick={handleDismiss}
                        className="shrink-0 text-gray-500 hover:text-white transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpdatePrompt;
