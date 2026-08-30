import React, { useEffect, useState } from 'react';
import { Check, Download, Gauge, Lock, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../core/store/settings';
import { useAIStore } from '../core/store/ai';
import { localAIBroker } from '../core/ai/broker';
import { MODEL_INFO, PACING_MODEL_TIER, type ModelTier } from '../core/ai/modelManifest';
import { WEBLLM_ERROR_CODES } from '../core/ai/webllm';

/**
 * Intent-driven local AI setup. It never blocks navigation or reading, and AI
 * remains disabled until the chosen model is ready.
 */
export const AISetupWizard: React.FC = () => {
    const {
        setAiEnabled,
        setPacingModelTier,
        setSummariesEnabled,
        summarizerModel,
        setSummarizerModel,
    } = useSettingsStore();
    const { isSetupOpen, setupIntent, closeSetup, requestSetup } = useAIStore(useShallow((state) => ({
        isSetupOpen: state.isSetupOpen,
        setupIntent: state.setupIntent,
        closeSetup: state.closeSetup,
        requestSetup: state.requestSetup,
    })));
    const [selectedTier, setSelectedTier] = useState<ModelTier>(summarizerModel);
    const [cachedModels, setCachedModels] = useState<Partial<Record<ModelTier, boolean>>>({});
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(false);

    useEffect(() => {
        if (!isSetupOpen) return;

        const checkCaches = async () => {
            const tiers = setupIntent === 'pacing'
                ? [PACING_MODEL_TIER]
                : Object.keys(MODEL_INFO) as ModelTier[];
            const entries = await Promise.all(
                tiers.map(async (tier) => (
                    [tier, await localAIBroker.isCached(tier)] as const
                )),
            );
            setCachedModels(Object.fromEntries(entries));
        };

        checkCaches().catch(() => setCachedModels({}));
    }, [isSetupOpen, setupIntent]);

    const handleSetup = async () => {
        const intent = setupIntent;
        const setupTier = intent === 'pacing' ? PACING_MODEL_TIER : selectedTier;
        if (intent === 'pacing') setPacingModelTier(setupTier);
        else setSummarizerModel(setupTier);
        setError(null);
        setIsInitializing(true);
        closeSetup();

        try {
            await localAIBroker.prepareModel(setupTier);
            if (intent === 'pacing') {
                setAiEnabled(true);
            } else {
                setSummariesEnabled(true);
            }
        } catch (setupError) {
            console.error('AI setup failed', setupError);
            if (intent === 'pacing') setAiEnabled(false);
            requestSetup(intent);
            if (setupError instanceof Error) {
                if (setupError.message === WEBLLM_ERROR_CODES.STORAGE_QUOTA_EXCEEDED) {
                    setError('Storage quota exceeded. Clear site data or adjust browser storage settings.');
                } else if (setupError.message === WEBLLM_ERROR_CODES.WEBGPU_LIMIT_UNSUPPORTED) {
                    setError('This browser currently exposes too few WebGPU resources for the local model. Fully restart it or try Chrome or Brave.');
                } else if (setupError.message === WEBLLM_ERROR_CODES.WEBGPU_UNAVAILABLE) {
                    setError('WebGPU is unavailable in this browser/device. Enable WebGPU or use a supported browser.');
                } else {
                    setError('The model could not be prepared. Check your connection and try again.');
                }
            } else {
                setError('The model could not be prepared. Check your connection and try again.');
            }
        } finally {
            setIsInitializing(false);
        }
    };

    const handleClose = () => {
        setError(null);
        closeSetup();
    };

    if (!isSetupOpen) return null;

    const isSummarySetup = setupIntent === 'summaries';
    const setupTier = isSummarySetup ? selectedTier : PACING_MODEL_TIER;
    const selectedIsCached = cachedModels[setupTier] === true;
    const pacingModel = MODEL_INFO[PACING_MODEL_TIER];

    return (
        <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="ai-setup-title"
            className="fixed inset-x-3 bottom-[calc(6rem+var(--safe-bottom))] z-[100] max-h-[calc(100dvh-7rem-var(--safe-top)-var(--safe-bottom))] overflow-y-auto rounded-lg border border-dune-gold/30 bg-basalt/95 shadow-2xl backdrop-blur-xl md:inset-x-auto md:bottom-6 md:right-6 md:w-[28rem]"
        >
            <div className="flex items-start gap-3 border-b border-white/10 p-4">
                <div className="mt-0.5 rounded bg-dune-gold/15 p-2 text-dune-gold">
                    {isSummarySetup ? <Download className="h-5 w-5" /> : <Gauge className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                    <h2 id="ai-setup-title" className="text-base font-bold text-white">
                        {isSummarySetup ? 'Set up automatic summaries' : 'Set up adaptive pacing'}
                    </h2>
                    <p className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/40">
                        <Lock className="h-3 w-3" /> Optional · runs on this device
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-white/50">
                        {isSummarySetup
                            ? "Downloads a small language model to this browser. Reading stays available while it prepares, and summaries turn on automatically once it's ready."
                            : "Downloads a small language model to this browser. Reading stays available while it prepares, and pacing turns on automatically once it's ready."}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleClose}
                    className="rounded p-2 text-white/40 hover:bg-white/5 hover:text-white"
                    aria-label="Close AI setup"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-3 p-4">
                {error && (
                    <div className="rounded border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300">
                        <span className="font-bold">Setup failed:</span> {error}
                    </div>
                )}

                {isSummarySetup ? (
                    <div className="grid gap-2">
                    {(Object.entries(MODEL_INFO) as [ModelTier, typeof MODEL_INFO[ModelTier]][]).map(([tier, info]) => {
                        const isSelected = selectedTier === tier;
                        const isCached = cachedModels[tier] === true;

                        return (
                            <button
                                key={tier}
                                type="button"
                                onClick={() => setSelectedTier(tier)}
                                className={clsx(
                                    'flex min-h-16 items-center gap-3 rounded border p-3 text-left transition-colors',
                                    isSelected
                                        ? 'border-dune-gold bg-dune-gold/10'
                                        : 'border-white/10 bg-black/20 hover:border-white/25',
                                )}
                            >
                                <span className={clsx(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                    isSelected ? 'border-dune-gold bg-dune-gold text-black' : 'border-white/20',
                                )}>
                                    {isSelected && <Check className="h-3.5 w-3.5" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-bold text-white">{info.name}</span>
                                    <span className="mt-0.5 block text-[10px] text-white/45">{info.description}</span>
                                </span>
                                <span className="shrink-0 text-right text-[10px] text-white/45">
                                    <span className="block text-dune-gold">{info.size}</span>
                                    <span className="block">{isCached ? 'On device' : 'One-time'}</span>
                                </span>
                            </button>
                        );
                    })}
                    </div>
                ) : (
                    <div className="flex min-h-16 items-center gap-3 rounded border border-white/10 bg-black/20 p-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dune-gold/15 text-dune-gold">
                            <Gauge className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-white">{pacingModel.name}</span>
                            <span className="mt-0.5 block text-[10px] text-white/45">The only model here that supports pacing's log-probability analysis.</span>
                        </span>
                        <span className="shrink-0 text-right text-[10px] text-white/45">
                            <span className="block text-dune-gold">{pacingModel.size}</span>
                            <span className="block">{selectedIsCached ? 'Already on device' : 'One-time download'}</span>
                        </span>
                    </div>
                )}

                <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-[10px] leading-relaxed text-white/45">
                    Your book text never leaves this device. Close this and setup continues in the background.
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isInitializing}
                        className="rounded border border-white/15 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-white/30 hover:text-white disabled:opacity-40"
                    >
                        Keep reading
                    </button>
                    <button
                        type="button"
                        onClick={handleSetup}
                        disabled={isInitializing}
                        className="rounded bg-dune-gold px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-black hover:bg-white disabled:cursor-wait disabled:opacity-50"
                    >
                        {isInitializing
                            ? 'Starting\u2026'
                            : selectedIsCached
                                ? (isSummarySetup ? 'Enable summaries' : 'Enable pacing')
                                : (isSummarySetup ? 'Download & enable summaries' : 'Download & enable pacing')}
                    </button>
                </div>
            </div>
        </section>
    );
};

export const ModelDownloadModal = AISetupWizard;