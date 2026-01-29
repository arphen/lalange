import React, { useEffect, useState, useCallback, useRef } from 'react';

// Type for the registerSW function from vite-plugin-pwa
type RegisterSWOptions = {
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
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
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    
    useEffect(() => {
        // Only run in production (PWA is disabled in dev - see vite.config.ts)
        if (import.meta.env.DEV || import.meta.env.MODE === 'test') return;
        
        // Use dynamic import with try/catch to handle the virtual module not existing
        // This pattern avoids eval-like constructs while still handling test environments
        const loadPWA = async () => {
            try {
                // Dynamic import of virtual module - wrapped in try/catch for environments
                // where the module doesn't exist (tests, non-PWA builds)
                const pwaModule = await import('virtual:pwa-register');
                const { registerSW } = pwaModule as { registerSW: (opts: RegisterSWOptions) => (reload?: boolean) => Promise<void> };
                
                const updateSW = registerSW({
                    onNeedRefresh() {
                        // New content available, show the prompt
                        setShowPrompt(true);
                        setUpdateFn(() => updateSW);
                    },
                    onOfflineReady() {
                        console.log('[SW] App ready for offline use');
                    },
                    onRegisteredSW(swUrl: string, registration: ServiceWorkerRegistration | undefined) {
                        // Check for updates every 5 minutes
                        if (registration) {
                            intervalRef.current = setInterval(() => {
                                registration.update();
                            }, 5 * 60 * 1000);
                        }
                        console.log('[SW] Registered:', swUrl);
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
        
        // Cleanup interval on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    const handleUpdate = useCallback(() => {
        if (updateFn) {
            updateFn(true); // true = reload page after update
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
                                className="px-3 py-1.5 bg-dune-gold text-black text-xs font-bold rounded hover:bg-white transition-colors"
                            >
                                Update Now
                            </button>
                            <button
                                onClick={handleDismiss}
                                className="px-3 py-1.5 text-gray-400 text-xs hover:text-white transition-colors"
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
