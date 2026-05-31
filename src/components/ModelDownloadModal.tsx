import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSettingsStore } from '../core/store/settings';
import { MODEL_INFO, type ModelTier, isModelCached, getEngine } from '../core/ai/webllm';
import { clsx } from 'clsx';
import { BrandName } from './BrandName';

/**
 * Optional local processing setup.
 * Once setup starts, progress is shown in the status panel instead of this modal.
 */
export const ModelDownloadModal: React.FC = () => {
    const location = useLocation();
    const { editorModel, setEditorModel, setLibrarianModelTier, setSummarizerModel } = useSettingsStore();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedTier, setSelectedTier] = useState<ModelTier>(editorModel);
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(false);

    const shouldPromptOnRoute =
        location.pathname.startsWith('/reader') ||
        location.pathname.startsWith('/settings');

    useEffect(() => {
        if (!shouldPromptOnRoute) return;
        
        const checkCache = async () => {
            const cached = await isModelCached(editorModel);
            if (!cached) {
                setIsOpen(true);
            }
        };
        checkCache();
    }, [editorModel, shouldPromptOnRoute]);

    const handleDownload = async () => {
        // Update all models to the selected tier for consistency
        setEditorModel(selectedTier);
        setLibrarianModelTier(selectedTier);
        setSummarizerModel(selectedTier);
        setError(null);
        setIsInitializing(true);

        try {
            // Close the modal immediately - progress will show in AIStatusPanel
            setIsOpen(false);
            await getEngine(selectedTier);
        } catch (error) {
            console.error("Download failed", error);
            // Re-open modal on error to allow retry
            setIsOpen(true);
            if (error instanceof Error && error.message === "BROWSER_STORAGE_QUOTA_EXCEEDED") {
                setError("Storage quota exceeded. Clear site data or adjust browser storage settings.");
            } else {
                setError("Setup failed. Check your connection and try again.");
            }
        } finally {
            setIsInitializing(false);
        }
    };

    const handleSkip = () => {
        setError(null);
        setIsOpen(false);
    };

    // Show only when setup is needed for the current route.
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-basalt border border-white/10 rounded-lg max-w-2xl w-full shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/10 bg-black/20">
                    <h2 className="text-xl font-mono font-bold text-dune-gold tracking-widest uppercase">
                        LOCAL PROCESSING SETUP
                    </h2>
                    <p className="text-xs text-gray-400 mt-2 font-mono">
                        <BrandName /> runs on your device. Choose a profile to enable local processing.
                    </p>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-400 text-xs font-mono mb-4">
                            <span className="font-bold">Setup Error:</span> {error}
                        </div>
                    )}
                    <div className="grid gap-4">
                        {(Object.entries(MODEL_INFO) as [ModelTier, typeof MODEL_INFO[ModelTier]][]).map(([tier, info]) => (
                            <button
                                key={tier}
                                onClick={() => setSelectedTier(tier)}
                                className={clsx(
                                    "flex items-center justify-between p-4 border rounded transition-all text-left group",
                                    selectedTier === tier 
                                        ? "border-dune-gold bg-dune-gold/10" 
                                        : "border-white/10 hover:border-white/30 hover:bg-white/5"
                                )}
                            >
                                <div>
                                    <div className={clsx(
                                        "font-mono font-bold uppercase tracking-wider",
                                        selectedTier === tier ? "text-dune-gold" : "text-gray-300"
                                    )}>
                                        {info.name}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">{info.description}</div>
                                </div>
                                <div className="text-xs font-mono text-gray-400 bg-black/30 px-2 py-1 rounded border border-white/5">
                                    {info.size}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
                    <button
                        onClick={handleSkip}
                        disabled={isInitializing}
                        className={clsx(
                            "px-6 py-2 font-mono font-bold uppercase tracking-widest text-xs transition-colors border border-white/20",
                            isInitializing
                                ? "text-gray-500 border-white/10 cursor-not-allowed"
                                : "text-gray-300 hover:text-white hover:border-white/40"
                        )}
                    >
                        Not now
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={isInitializing}
                        className={clsx(
                            "px-6 py-2 font-mono font-bold uppercase tracking-widest text-xs transition-colors",
                            isInitializing 
                                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                                : "bg-dune-gold text-black hover:bg-white"
                        )}
                    >
                        {isInitializing ? 'Starting...' : 'Start setup'}
                    </button>
                </div>
            </div>
        </div>
    );
};
