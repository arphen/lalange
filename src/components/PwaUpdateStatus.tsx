import { useSyncExternalStore } from 'react';
import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { pwaUpdateController } from '../core/pwa/browserUpdateController';

export const PwaUpdateStatus = () => {
    const snapshot = useSyncExternalStore(
        pwaUpdateController.subscribe,
        pwaUpdateController.getSnapshot,
        pwaUpdateController.getSnapshot,
    );

    if (snapshot.status === 'idle') return null;

    const isApplying = snapshot.status === 'applying';
    const isError = snapshot.status === 'error';
    const title = isError
        ? 'Update Failed'
        : isApplying
            ? 'Applying Update'
            : 'Update Available';
    const detail = isError
        ? snapshot.error ?? 'The update could not be activated.'
        : isApplying
            ? `Verifying activation${snapshot.attempt > 0 ? ` · attempt ${snapshot.attempt}` : ''}...`
            : 'A verified version is ready. Local books and AI models will be preserved.';

    const handlePrimaryAction = () => {
        if (isError) {
            void pwaUpdateController.retry();
        } else {
            void pwaUpdateController.applyUpdate();
        }
    };

    return (
        <div className="fixed bottom-4 left-4 z-[100] max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="bg-black/90 backdrop-blur-xl border border-dune-gold/30 rounded-lg shadow-2xl p-4">
                <div className="flex items-start gap-3">
                    <div className="shrink-0 w-10 h-10 bg-dune-gold/20 rounded-full flex items-center justify-center">
                        {isError ? (
                            <TriangleAlert className="w-5 h-5 text-lacan-red" aria-hidden />
                        ) : (
                            <RefreshCw
                                className={`w-5 h-5 text-dune-gold ${isApplying ? 'animate-spin' : ''}`}
                                aria-hidden
                            />
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        <h4 className="font-mono text-sm font-bold text-white tracking-wide">
                            {title}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1 break-words">
                            {detail}
                        </p>

                        {!isApplying && (
                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={handlePrimaryAction}
                                    className="px-3 py-1.5 bg-dune-gold text-black text-xs font-bold rounded hover:bg-white transition-colors"
                                >
                                    {isError ? 'Retry' : 'Update Now'}
                                </button>
                                <button
                                    type="button"
                                    onClick={pwaUpdateController.dismiss}
                                    className="px-3 py-1.5 text-gray-400 text-xs hover:text-white transition-colors"
                                >
                                    Later
                                </button>
                            </div>
                        )}
                    </div>

                    {!isApplying && (
                        <button
                            type="button"
                            onClick={pwaUpdateController.dismiss}
                            className="shrink-0 text-gray-500 hover:text-white transition-colors"
                            title="Dismiss update"
                            aria-label="Dismiss update"
                        >
                            <X className="w-4 h-4" aria-hidden />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};