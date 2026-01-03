import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../core/store/settings';
import { useAIStore } from '../core/store/ai';
import { MODEL_INFO, type ModelTier, isModelCached, getEngine, deleteModel } from '../core/ai/webllm';
import { clsx } from 'clsx';

// Define which models are available for each purpose
const DENSITY_MODELS: ModelTier[] = ['tiny', 'balanced'];
const COMPLEX_MODELS: ModelTier[] = ['creative', 'reliable', 'pro', 'balanced'];

export const ModelDownloadModal: React.FC = () => {
    const { librarianModelTier, setLibrarianModelTier, summarizerModel, setSummarizerModel, setEditorModel } = useSettingsStore();
    const { isLoading, progressValue } = useAIStore();
    const [isOpen, setIsOpen] = useState(false);
    const [densityModel, setDensityModel] = useState<ModelTier>(librarianModelTier || 'tiny');
    const [complexModel, setComplexModel] = useState<ModelTier>(summarizerModel || 'creative');
    const [error, setError] = useState<string | null>(null);
    const [downloadPhase, setDownloadPhase] = useState<'idle' | 'density' | 'complex' | 'done'>('idle');
    const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});

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
            
            // Check if both required models are cached
            const densityCached = await isModelCached(librarianModelTier);
            const complexCached = await isModelCached(summarizerModel);
            
            if (!densityCached || !complexCached) {
                setIsOpen(true);
            }
        };
        init();
    }, [librarianModelTier, summarizerModel, checkCache]);

    const handleDownload = async () => {
        console.log("Initializing dual-model download:", { densityModel, complexModel });
        setError(null);

        // Save model choices to settings
        setLibrarianModelTier(densityModel);
        setSummarizerModel(complexModel);
        setEditorModel(complexModel); // Editor uses the complex model

        try {
            // Phase 1: Download density model (lightweight)
            setDownloadPhase('density');
            console.log("Downloading density model:", densityModel);
            await getEngine(densityModel);
            
            // Phase 2: Download complex model (only if different from density)
            if (complexModel !== densityModel) {
                setDownloadPhase('complex');
                console.log("Downloading complex model:", complexModel);
                await getEngine(complexModel);
            }
            
            setDownloadPhase('done');
            console.log("Both engines initialized successfully");
            setIsOpen(false);
        } catch (error) {
            console.error("Download failed", error);
            if (error instanceof Error && (error.message.includes("QuotaExceeded") || error.message.includes("NS_ERROR_FILE_NO_DEVICE_SPACE"))) {
                setError("BROWSER STORAGE QUOTA EXCEEDED. Please delete unused models to free up space.");
            } else {
                setError(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            setDownloadPhase('idle');
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

    const showProgress = isLoading || downloadPhase !== 'idle';
    const isDownloading = downloadPhase !== 'idle' && downloadPhase !== 'done';

    if (!isOpen && !showProgress) return null;

    // If loading, we show the progress bar (even if modal was closed, but usually it stays open)
    // Actually, if it's loading, we should probably show the modal or a loading indicator.
    // The user wants "loading bars in red indicating progress".

    const ModelOption: React.FC<{
        tier: ModelTier;
        selected: boolean;
        onSelect: () => void;
        disabled?: boolean;
    }> = ({ tier, selected, onSelect, disabled }) => {
        const info = MODEL_INFO[tier];
        const isCached = cachedModels[tier];
        return (
            <button
                onClick={onSelect}
                disabled={disabled}
                className={clsx(
                    "flex items-center justify-between p-3 border rounded transition-all text-left",
                    disabled && "opacity-50 cursor-not-allowed",
                    selected
                        ? "border-dune-gold bg-dune-gold/10"
                        : "border-white/10 hover:border-white/30 hover:bg-white/5"
                )}
            >
                <div>
                    <div className={clsx(
                        "font-mono font-bold uppercase tracking-wider text-sm flex items-center gap-2",
                        selected ? "text-dune-gold" : "text-gray-300"
                    )}>
                        {info.name}
                        {isCached && <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded border border-green-800">CACHED</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{info.description}</div>
                </div>
                <div className="flex items-center gap-2">
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
    };

    const getPhaseLabel = () => {
        if (downloadPhase === 'density') return `DOWNLOADING DENSITY ENGINE (1/2)`;
        if (downloadPhase === 'complex') return `DOWNLOADING CREATIVE ENGINE (2/2)`;
        return 'INITIALIZING NEURAL ENGINES';
    };

    const getTotalSize = () => {
        const densitySize = parseFloat(MODEL_INFO[densityModel].size);
        const complexSize = densityModel === complexModel ? 0 : parseFloat(MODEL_INFO[complexModel].size);
        return `${(densitySize + complexSize).toFixed(1)} GB total`;
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-basalt border border-white/10 rounded-lg max-w-2xl w-full shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/10 bg-black/20">
                    <h2 className="text-xl font-mono font-bold text-dune-gold tracking-widest uppercase">
                        {isDownloading ? getPhaseLabel() : 'CONFIGURE NEURAL ENGINES'}
                    </h2>
                    <p className="text-xs text-gray-400 mt-2 font-mono">
                        {isDownloading
                            ? 'Downloading model parameters to local storage. This happens only once.'
                            : 'Arphen uses two models: a fast one for analysis, and a powerful one for summaries.'}
                    </p>
                </div>

                <div className="p-6 space-y-6">
                    {error && (
                        <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-400 text-xs font-mono">
                            <span className="font-bold">ERROR:</span> {error}
                        </div>
                    )}

                    {isDownloading ? (
                        <div className="space-y-4">
                            {/* Density Model Progress */}
                            <div className={clsx(
                                "p-4 border rounded",
                                downloadPhase === 'density' ? "border-dune-gold bg-dune-gold/5" : "border-white/10 opacity-50"
                            )}>
                                <div className="flex justify-between text-xs font-mono text-gray-400 mb-2">
                                    <span>DENSITY ENGINE: {MODEL_INFO[densityModel].name}</span>
                                    {downloadPhase === 'density' && <span className="text-dune-gold">{Math.round(progressValue * 100)}%</span>}
                                    {downloadPhase !== 'density' && cachedModels[densityModel] && <span className="text-green-400">✓ READY</span>}
                                </div>
                                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-dune-gold transition-all duration-300 ease-out"
                                        style={{ width: downloadPhase === 'density' ? `${progressValue * 100}%` : (downloadPhase === 'complex' || downloadPhase === 'done' ? '100%' : '0%') }}
                                    />
                                </div>
                            </div>

                            {/* Complex Model Progress */}
                            {densityModel !== complexModel && (
                                <div className={clsx(
                                    "p-4 border rounded",
                                    downloadPhase === 'complex' ? "border-magma-vent bg-magma-vent/5" : "border-white/10 opacity-50"
                                )}>
                                    <div className="flex justify-between text-xs font-mono text-gray-400 mb-2">
                                        <span>CREATIVE ENGINE: {MODEL_INFO[complexModel].name}</span>
                                        {downloadPhase === 'complex' && <span className="text-magma-vent">{Math.round(progressValue * 100)}%</span>}
                                        {downloadPhase !== 'complex' && <span className="text-gray-500">PENDING</span>}
                                    </div>
                                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-magma-vent transition-all duration-300 ease-out"
                                            style={{ width: downloadPhase === 'complex' ? `${progressValue * 100}%` : '0%' }}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="text-[10px] text-gray-500 font-mono text-center mt-4">
                                DO NOT CLOSE THIS WINDOW
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Density Model Selection */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-3 h-3 rounded-full bg-dune-gold"></div>
                                    <h3 className="text-sm font-mono font-bold text-dune-gold uppercase tracking-wider">Density Engine</h3>
                                </div>
                                <p className="text-xs text-gray-500 mb-3">Fast, lightweight model for real-time text analysis and pacing.</p>
                                <div className="grid gap-2">
                                    {DENSITY_MODELS.map(tier => (
                                        <ModelOption
                                            key={tier}
                                            tier={tier}
                                            selected={densityModel === tier}
                                            onSelect={() => setDensityModel(tier)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Complex Model Selection */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-3 h-3 rounded-full bg-magma-vent"></div>
                                    <h3 className="text-sm font-mono font-bold text-magma-vent uppercase tracking-wider">Creative Engine</h3>
                                </div>
                                <p className="text-xs text-gray-500 mb-3">Powerful model for generating summaries and chapter titles.</p>
                                <div className="grid gap-2">
                                    {COMPLEX_MODELS.map(tier => (
                                        <ModelOption
                                            key={tier}
                                            tier={tier}
                                            selected={complexModel === tier}
                                            onSelect={() => setComplexModel(tier)}
                                        />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {!isDownloading && (
                    <div className="p-6 border-t border-white/10 bg-black/20 flex items-center justify-between">
                        <div className="text-xs font-mono text-gray-500">
                            {getTotalSize()}
                        </div>
                        <button
                            onClick={handleDownload}
                            className="px-6 py-2 font-mono font-bold uppercase tracking-widest transition-colors text-xs bg-dune-gold text-black hover:bg-white"
                        >
                            Initialize Engines
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
