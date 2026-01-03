import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../core/store/settings';
import { useAIStore } from '../core/store/ai';
import { MODEL_INFO, type ModelTier, isModelCached, getEngine, deleteModel } from '../core/ai/webllm';
import { clsx } from 'clsx';

export const ModelDownloadModal: React.FC = () => {
    const { editorModel, setEditorModel, setLibrarianModelTier, setSummarizerModel } = useSettingsStore();
    const { isLoading, progress, progressValue } = useAIStore();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedTier, setSelectedTier] = useState<ModelTier>(editorModel);
    const [error, setError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});

    const isValidSelection = selectedTier in MODEL_INFO;

    const checkCache = React.useCallback(async () => {
        const status: Record<string, boolean> = {};
        for (const tier of Object.keys(MODEL_INFO) as ModelTier[]) {
            status[tier] = await isModelCached(tier);
        }
        setCachedModels(status);
    }, []);

    useEffect(() => {
        const init = async () => {
            await checkCache();
            // If the current model is invalid, don't check cache, just open modal
            if (!(editorModel in MODEL_INFO)) {
                setIsOpen(true);
                return;
            }
            
            const cached = await isModelCached(editorModel);
            if (!cached) {
                setIsOpen(true);
            }
        };
        init();
    }, [editorModel, checkCache]);

    const handleDownload = async () => {
        if (!isValidSelection) return;

        console.log("Initializing download for tier:", selectedTier);
        setIsStarting(true);

        // Update all models to the selected tier for consistency
        setEditorModel(selectedTier);
        setLibrarianModelTier(selectedTier);
        setSummarizerModel(selectedTier);
        setError(null);

        try {
            await getEngine(selectedTier);
            console.log("Engine initialized successfully");
            setIsOpen(false);
        } catch (error) {
            console.error("Download failed", error);
            if (error instanceof Error && (error.message.includes("QuotaExceeded") || error.message.includes("NS_ERROR_FILE_NO_DEVICE_SPACE"))) {
                setError("BROWSER STORAGE QUOTA EXCEEDED. Please delete unused models to free up space.");
            } else {
                setError(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            setIsStarting(false);
        }
    };

    const handleDelete = async (tier: ModelTier, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete ${MODEL_INFO[tier].name} from cache?`)) return;
        try {
            await deleteModel(tier);
            await checkCache();
        } catch (e) {
            console.error("Failed to delete model", e);
        }
    };

    const showProgress = isLoading || isStarting;

    if (!isOpen && !showProgress) return null;

    // If loading, we show the progress bar (even if modal was closed, but usually it stays open)
    // Actually, if it's loading, we should probably show the modal or a loading indicator.
    // The user wants "loading bars in red indicating progress".

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-basalt border border-white/10 rounded-lg max-w-2xl w-full shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/10 bg-black/20">
                    <h2 className="text-xl font-mono font-bold text-dune-gold tracking-widest uppercase">
                        {showProgress ? 'INITIALIZING NEURAL ENGINE' : 'SELECT NEURAL ENGINE'}
                    </h2>
                    <p className="text-xs text-gray-400 mt-2 font-mono">
                        {showProgress 
                            ? 'Downloading model parameters to local storage. This happens only once.' 
                            : 'Arphen runs entirely on your device. Select a model to download.'}
                    </p>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-400 text-xs font-mono mb-4">
                            <span className="font-bold">ERROR:</span> {error}
                        </div>
                    )}
                    {showProgress ? (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs font-mono text-dune-gold uppercase">
                                <span>{progress || 'Preparing Neural Engine...'}</span>
                                <span>{Math.round(progressValue * 100)}%</span>
                            </div>
                            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-magma-vent transition-all duration-300 ease-out"
                                    style={{ width: `${progressValue * 100}%` }}
                                />
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono text-center mt-4">
                                DO NOT CLOSE THIS WINDOW
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {(Object.entries(MODEL_INFO) as [ModelTier, typeof MODEL_INFO[ModelTier]][]).map(([tier, info]) => {
                                const isCached = cachedModels[tier];
                                return (
                                    <button
                                        key={tier}
                                        onClick={() => setSelectedTier(tier)}
                                        className={clsx(
                                            "flex items-center justify-between p-4 border rounded transition-all text-left group relative",
                                            selectedTier === tier 
                                                ? "border-dune-gold bg-dune-gold/10" 
                                                : "border-white/10 hover:border-white/30 hover:bg-white/5"
                                        )}
                                    >
                                        <div>
                                            <div className={clsx(
                                                "font-mono font-bold uppercase tracking-wider flex items-center gap-2",
                                                selectedTier === tier ? "text-dune-gold" : "text-gray-300"
                                            )}>
                                                {info.name}
                                                {isCached && <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded border border-green-800">CACHED</span>}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">{info.description}</div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-xs font-mono text-gray-400 bg-black/30 px-2 py-1 rounded border border-white/5">
                                                {info.size}
                                            </div>
                                            {isCached && (
                                                <div
                                                    onClick={(e) => handleDelete(tier, e)}
                                                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors z-10"
                                                    title="Delete from cache"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {!showProgress && (
                    <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end">
                        <button
                            onClick={handleDownload}
                            disabled={!isValidSelection}
                            className={clsx(
                                "px-6 py-2 font-mono font-bold uppercase tracking-widest transition-colors text-xs",
                                isValidSelection 
                                    ? "bg-dune-gold text-black hover:bg-white" 
                                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                            )}
                        >
                            {isValidSelection ? 'Initialize System' : 'Select a Model'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
