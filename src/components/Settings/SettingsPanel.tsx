import React, { useState, useEffect } from 'react';
import { useParams, Navigate } from 'react-router';
import { useSettingsStore, type PromptFragment } from '../../core/store/settings';
import { useAIStore } from '../../core/store/ai';
import { useTTSStore, type TTSBackendPreference } from '../../core/store/tts';
import { getEngine, MODEL_INFO, PACING_MODEL_TIER, type ModelTier, isModelCached, deleteModel } from '../../core/ai/webllm';
import { getAvailableStrategies, type DurationStrategyId } from '../../core/rsvp/duration';
import { getAllDisplayPlugins, type DisplayPluginId } from '../../core/rsvp/display';
import { VOICES, initTTS, clearTTSCache, isTTSModelCached, isTTSReady, getVoice, getVoiceEngine, type VoiceInfo } from '../../core/tts';
import { clsx } from 'clsx';
import { BrandName } from '../BrandName';
import { SeoHead } from '../SeoHead';

interface SettingsPanelProps {
    onClose: () => void;
}

type SettingsTab = 'librarian' | 'pacing' | 'summarizer' | 'tts';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
    const { tab } = useParams<{ tab: string }>();
    const activeTabRaw = (tab as SettingsTab) || 'pacing';
    const isValidTab = ['librarian', 'pacing', 'summarizer', 'tts'].includes(activeTabRaw);
    const activeTab = isValidTab ? activeTabRaw : 'pacing';

    const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});
    const settings = useSettingsStore();
    const aiState = useAIStore();
    const isDayTheme = settings.theme === 'day' || settings.theme === 'dunes';

    const checkCache = React.useCallback(async () => {
        const status: Record<string, boolean> = {};
        for (const tier of Object.keys(MODEL_INFO) as ModelTier[]) {
            status[tier] = await isModelCached(tier);
        }
        setCachedModels(status);
    }, []);

    useEffect(() => {
        // Always check cache on mount since we show models in Librarian tab now
        // eslint-disable-next-line
        checkCache().catch(console.error);
    }, [checkCache]);

    if (!isValidTab) {
        return <Navigate to="/settings/pacing" replace />;
    }

    const handleDownloadModel = async (tier: ModelTier) => {
        try {
            await getEngine(tier);
            await checkCache();
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteModel = async (tier: ModelTier) => {
        if (!confirm(`Are you sure you want to delete the ${tier} model from cache?`)) return;
        try {
            await deleteModel(tier);
            await checkCache();
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-basalt text-white font-mono">
            <SeoHead
                title={`Settings - ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                description="Configure XYZ reader settings, LLM models, and display preferences."
                robots="noindex, nofollow"
            />
            <div className="max-w-4xl mx-auto pt-16 px-4 pb-8 md:p-12">
                <div className="mb-8 border-b border-white/10 pb-4 flex justify-between items-center">
                     <div>
                        <h2 className="text-xl font-bold text-dune-gold tracking-widest uppercase">
                            SETTINGS / {activeTab.toUpperCase()}
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">SYSTEM CONFIGURATION</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border border-white/10 rounded text-xs text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                    >
                        [ CLOSE ]
                    </button>
                </div>

                <div className="mb-8 rounded-lg border border-white/10 bg-black/20 p-4 md:p-6">
                    <label className="block text-xs text-dune-gold mb-3 uppercase tracking-widest font-bold">Appearance</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <ThemeButton
                            label="Volcanic"
                            subtitle="Night"
                            active={settings.theme === 'volcanic'}
                            onClick={() => settings.setTheme('volcanic')}
                        />
                        <ThemeButton
                            label="Day"
                            subtitle="Sandlight"
                            active={isDayTheme}
                            onClick={() => settings.setTheme('day')}
                        />
                        <ThemeButton
                            label="Ash"
                            subtitle="Monochrome"
                            active={settings.theme === 'ash'}
                            onClick={() => settings.setTheme('ash')}
                        />
                    </div>
                </div>

                    {/* Librarian Tab (Includes General + Model Manager) */}
                    {activeTab === 'librarian' && (
                        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            
                            {/* Librarian Agent Config */}
                            <AgentConfig
                                title="The Librarian"
                                description="Configure the recommendation and analysis engine."
                                model={settings.librarianModelTier}
                                setModel={settings.setLibrarianModelTier}
                                basePrompt={settings.librarianBasePrompt}
                                setBasePrompt={settings.setLibrarianBasePrompt}
                                fragments={settings.librarianFragments}
                                toggleFragment={settings.toggleLibrarianFragment}
                            />

                            {/* Ingestion & Formatting Rules (Formerly General) */}
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-xl font-bold text-white mb-2">Ingestion Protocols</h3>
                                    <p className="text-gray-500 text-sm">Rules for cleaning and structuring incoming texts.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Toggle
                                        label="License Annihilator"
                                        description="Hard-removes legal headers (Project Gutenberg etc)."
                                        checked={settings.licenseAnnihilator}
                                        onChange={settings.toggleLicenseAnnihilator}
                                    />
                                    <Toggle
                                        label="Structural Scrubber"
                                        description="Strips chapter headers, page numbers, notes."
                                        checked={settings.structuralScrubber}
                                        onChange={settings.setStructuralScrubber}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-dune-gold mb-2 uppercase tracking-widest font-bold">Manual Overrides</label>
                                    <textarea
                                        className="w-full h-24 bg-black/30 border border-white/10 rounded p-4 text-xs text-gray-300 focus:border-dune-gold focus:outline-none transition-colors font-mono"
                                        placeholder="Global Find & Replace rules (e.g. Change 'Rand' to 'The Dragon')"
                                        value={settings.manualOverrideRules}
                                        onChange={(e) => settings.setManualOverrideRules(e.target.value)}
                                    />
                                </div>
                            </div>

                             {/* Persona & Monetization */}
                             <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-8">
                                <div>
                                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Librarian Persona</label>
                                    <div className="grid grid-cols-3 gap-4">
                                        {(['standard', 'lacanian', 'custom'] as const).map(persona => (
                                            <button
                                                key={persona}
                                                onClick={() => settings.setLibrarianPersona(persona)}
                                                className={clsx(
                                                    "p-4 rounded border text-left transition-all",
                                                    settings.librarianPersona === persona
                                                        ? "bg-dune-gold text-black border-dune-gold"
                                                        : "bg-black/20 border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                                                )}
                                            >
                                                <div className="font-bold uppercase text-sm">{persona}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <Toggle
                                        label="Support Development"
                                        description={<>(You) generate affiliate links so <BrandName /> can pay for hosting.</>}
                                        checked={settings.affiliateLinksEnabled}
                                        onChange={settings.setAffiliateLinksEnabled}
                                    />
                            </div>


                            {/* Model Vault (Formerly separate tab) */}
                            <div className="space-y-6 pt-6 border-t border-white/10">
                                <div>
                                    <h3 className="text-xl font-bold text-white mb-2">The Model Vault</h3>
                                    <p className="text-gray-500 text-sm">Manage the local LLM weights stored in your browser.</p>
                                </div>
                                <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
                                     {/* ... (Model List Code) ... */}
                                    <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                                        <h4 className="font-bold text-dune-gold text-xs tracking-widest">LOCAL CACHE STATUS</h4>
                                        {aiState.isLoading && (
                                            <span className="text-xs text-magma-vent animate-pulse">
                                                {aiState.progress || 'BUSY...'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="divide-y divide-white/5">
                                        {(Object.keys(MODEL_INFO) as ModelTier[]).map(tier => {
                                            const info = MODEL_INFO[tier];
                                            const isCached = cachedModels[tier];

                                            return (
                                                <div key={tier} className={clsx(
                                                    "p-4 flex items-center justify-between transition-colors hover:bg-white/5",
                                                    isCached && "bg-green-900/10"
                                                )}>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={clsx("font-bold capitalize text-sm", isCached ? "text-green-400" : "text-white")}>{info.name}</span>
                                                            <span className="text-[10px] text-gray-500 font-mono">({info.id})</span>
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 mt-1">
                                                            Size: <span className="text-dune-gold">{info.size}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        {isCached ? (
                                                            <button
                                                                onClick={() => handleDeleteModel(tier)}
                                                                disabled={aiState.isLoading}
                                                                className="px-3 py-1.5 text-[10px] font-bold rounded border border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500 transition-all disabled:opacity-50"
                                                            >
                                                                EVICT
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleDownloadModel(tier)}
                                                                disabled={aiState.isLoading}
                                                                className="px-3 py-1.5 text-[10px] font-bold rounded border border-white/20 text-gray-400 hover:border-dune-gold hover:text-dune-gold transition-all disabled:opacity-50"
                                                            >
                                                                DOWNLOAD
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {aiState.isLoading && (
                                    <div className="p-4 bg-black/40 border-t border-white/10">
                                        <div className="flex justify-between text-xs text-gray-400 mb-2">
                                            <span className="font-bold text-dune-gold">
                                                {aiState.loadingModel ? `LOADING ${aiState.loadingModel.toUpperCase()}...` : 'WORKING...'}
                                            </span>
                                            <span>{Math.round(aiState.progressValue * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-gray-800 h-1 rounded overflow-hidden">
                                            <div
                                                className="bg-dune-gold h-full transition-all duration-300"
                                                style={{ width: `${aiState.progressValue * 100}%` }}
                                            />
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-2 font-mono truncate">
                                            {aiState.progress}
                                        </div>
                                    </div>
                                )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Pacing Tab */}
                    {activeTab === 'pacing' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">The Pacing Engine</h3>
                                <p className="text-gray-500 text-sm">Control how the reader adapts to text density.</p>
                            </div>

                            <Toggle
                                label="Adaptive AI Pacing"
                                description={aiState.isLoading
                                    ? 'Preparing the on-device model \u2014 reading remains available while this finishes.'
                                    : 'Speeds through predictable words and slows for dense or surprising passages, using a small model that runs entirely on this device.'}
                                checked={settings.aiEnabled}
                                onChange={(enabled) => {
                                    if (!enabled) settings.setAiEnabled(false);
                                    else if (!aiState.isLoading) aiState.requestSetup('pacing');
                                }}
                            />

                            {/* Pacing Engine Explanation */}
                            <div className="bg-white/5 rounded-lg border border-white/10 p-6 space-y-4">
                                <h4 className="text-dune-gold font-bold uppercase tracking-widest text-xs">How It Works</h4>
                                <p className="text-sm text-gray-400 leading-relaxed">
                                    Fixed-speed RSVP treats every word the same, whether it's "the" or a dense clause packed with new information. <BrandName /> instead runs a small model on this device that estimates how predictable each upcoming word is, then adjusts its display time to match.
                                </p>
                                <ul className="space-y-2 text-xs text-gray-500 border-l-2 border-white/10 pl-4 py-2">
                                    <li>
                                        <strong className="text-gray-300">Dense or unexpected text</strong> slows down so it has time to land.
                                    </li>
                                    <li>
                                        <strong className="text-gray-300">Predictable or repetitive text</strong> speeds up to keep the flow going.
                                    </li>
                                </ul>
                                <p className="text-xs text-gray-500">
                                    Use Sensitivity below to control how strongly pacing reacts to text density.
                                </p>
                            </div>

                            {/* Pacing Engine Model */}
                            <div className="bg-white/5 rounded-lg p-8 border border-white/10">
                                <div>
                                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Pacing Model</label>
                                    <div className="flex items-center justify-between gap-4 rounded border border-white/10 bg-black/20 p-4">
                                        <div>
                                            <div className="font-bold uppercase text-sm text-white">{MODEL_INFO[PACING_MODEL_TIER].name}</div>
                                            <div className="mt-1 text-[10px] text-gray-500">Optimized for adaptive pacing</div>
                                        </div>
                                        <div className="shrink-0 text-xs text-dune-gold">{MODEL_INFO[PACING_MODEL_TIER].size}</div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-4">
                                        Fixed automatically — pacing needs log-probability output, which only this model provides here.
                                    </p>
                                </div>
                            </div>

                            {/* Duration Strategy Selection */}
                            <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-6">
                                <div>
                                    <label className="block text-xs text-dune-gold mb-2 uppercase tracking-widest font-bold">Duration Strategy</label>
                                    <p className="text-xs text-gray-500 mb-4">
                                        Controls how word display times are calculated from the complexity analysis.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {getAvailableStrategies().filter(s => s.id !== 'constant').map(strategy => (
                                            <button
                                                key={strategy.id}
                                                onClick={() => settings.setDurationStrategy(strategy.id as DurationStrategyId)}
                                                className={clsx(
                                                    "p-4 rounded border text-left transition-all",
                                                    settings.durationStrategy === strategy.id
                                                        ? "bg-dune-gold text-black border-dune-gold"
                                                        : "bg-black/20 border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                                                )}
                                            >
                                                <div className="font-bold text-sm">{strategy.name}</div>
                                                <div className="text-[10px] opacity-70 mt-2 leading-relaxed">{strategy.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Display Style Selection */}
                            <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-6">
                                <div>
                                    <label className="block text-xs text-dune-gold mb-2 uppercase tracking-widest font-bold">Display Style</label>
                                    <p className="text-xs text-gray-500 mb-4">
                                        Customize the visual presentation of the RSVP stream.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {getAllDisplayPlugins().map(plugin => (
                                            <button
                                                key={plugin.id}
                                                onClick={() => settings.setDisplayPlugin(plugin.id as DisplayPluginId)}
                                                className={clsx(
                                                    "p-4 rounded border text-left transition-all",
                                                    settings.displayPlugin === plugin.id
                                                        ? "bg-dune-gold text-black border-dune-gold"
                                                        : "bg-black/20 border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                                                )}
                                            >
                                                <div className="font-bold text-sm">{plugin.name}</div>
                                                <div className="text-[10px] opacity-70 mt-2 leading-relaxed">{plugin.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-black/20 p-8 rounded-lg border border-white/10">
                                <div className="flex justify-between text-sm text-gray-400 mb-4">
                                    <span className="uppercase tracking-widest">Velocity Weighting</span>
                                    <span className="text-dune-gold font-bold">{settings.wpm}</span>
                                </div>
                                <input
                                    type="range" aria-label="Velocity Weighting" 
                                    min="50"
                                    max="2000"
                                    step="10"
                                    value={settings.wpm}
                                    onChange={(e) => settings.setWpm(parseInt(e.target.value))}
                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-dune-gold"
                                />
                                <p className="text-xs text-gray-500 mt-6 italic text-center">
                                    "This controls the baseline frequency of the RSVP stream. It determines the standard delay weighting applied to each word before density adjustments."
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <label className="block text-sm text-dune-gold mb-4 uppercase tracking-widest">Sensitivity Dial</label>
                                    <div className="bg-black/20 p-6 rounded-lg border border-white/10 h-full flex flex-col justify-center">
                                        <div className="flex justify-between text-xs text-gray-400 mb-4">
                                            <span>DENSITY IMPACT</span>
                                            <span className="text-magma-vent font-bold">{settings.pacingSensitivity}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0" max="100"
                                            value={settings.pacingSensitivity}
                                            onChange={(e) => settings.setPacingSensitivity(parseInt(e.target.value))}
                                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-magma-vent"
                                        />
                                        <p className="text-xs text-gray-500 mt-6 italic text-center">
                                            "Higher sensitivity means the reader slows down more aggressively when complex text is detected."
                                        </p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm text-dune-gold mb-4 uppercase tracking-widest">Visual Output</label>
                                     <Toggle
                                        label="Footnote Suppressor"
                                        description="Hides [1] or (p. 42) references that trigger 'eye-glitch' during RSVP."
                                        checked={settings.footnoteSuppressor}
                                        onChange={settings.setFootnoteSuppressor}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Summarizer Tab */}
                    {activeTab === 'summarizer' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <Toggle
                                label="Automatic Summaries"
                                description="Generate periodic book summaries in the background. Adaptive pacing works without this."
                                checked={settings.summariesEnabled}
                                onChange={(enabled) => {
                                    if (!enabled) {
                                        settings.setSummariesEnabled(false);
                                    } else if (settings.aiEnabled) {
                                        settings.setSummariesEnabled(true);
                                    } else if (!aiState.isLoading) {
                                        aiState.requestSetup('summaries');
                                    }
                                }}
                            />
                             <AgentConfig
                                title="The Summarizer"
                                description="Your automated reading journal."
                                infoBlock={
                                    <div className="bg-white/5 rounded-lg border border-white/10 p-6 space-y-4">
                                        <h4 className="text-dune-gold font-bold uppercase tracking-widest text-xs">Keeping the Thread</h4>
                                        <p className="text-sm text-gray-400 leading-relaxed">
                                            When you're reading at high speeds (RSVP), it's easy to lose track of the broader context, especially in long novels. It's like driving fast—sometimes you miss the scenery.
                                        </p>
                                        <h4 className="text-dune-gold font-bold uppercase tracking-widest text-xs pt-2">How It Helps</h4>
                                        <p className="text-sm text-gray-400 leading-relaxed">
                                            The Summarizer works quietly in the background. As you finish a chapter, it <span className="text-white font-bold">digests the events</span> and adds them to a long-term memory bank.
                                        </p>
                                        <p className="text-xs text-gray-500 italic border-l-2 border-white/10 pl-4 py-2">
                                            This allows the "Librarian" (the chat assistant) to answer questions like "Who was that guy from Chapter 1?" or "What just happened?" without you having to re-read.
                                        </p>
                                    </div>
                                }
                                model={settings.summarizerModel}
                                setModel={settings.setSummarizerModel}
                                basePrompt={settings.summarizerBasePrompt}
                                setBasePrompt={settings.setSummarizerBasePrompt}
                                fragments={settings.summarizerFragments}
                                toggleFragment={settings.toggleSummarizerFragment}
                            />
                            
                            <div className="pt-6 border-t border-white/10">
                                <h3 className="text-xl font-bold text-white mb-4">Content Filtering</h3>
                                <Toggle
                                    label="Generative Junk Removal"
                                    description="Uses AI to detect and skip non-content chunks (TOC, Copyright, etc) during summarization."
                                    checked={settings.enableJunkRemoval}
                                    onChange={settings.setEnableJunkRemoval}
                                />
                            </div>
                        </div>
                    )}

                    {/* TTS Tab */}
                    {activeTab === 'tts' && <TTSSettings />}

                    {/* Version Footer */}
                    <div className="mt-12 pt-6 border-t border-white/10 text-center">
                        <p className="text-xs text-gray-600 font-mono">
                            Build: <span className="text-gray-500">{__COMMIT_HASH__}</span>
                        </p>
                    </div>

                </div>
            </div>
    );
};

interface ThemeButtonProps {
    label: string;
    subtitle: string;
    active: boolean;
    onClick: () => void;
}

const ThemeButton: React.FC<ThemeButtonProps> = ({ label, subtitle, active, onClick }) => (
    <button
        onClick={onClick}
        className={clsx(
            'p-3 rounded border text-left transition-all',
            active
                ? 'bg-dune-gold text-black border-dune-gold'
                : 'bg-black/20 border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
        )}
    >
        <div className="text-xs font-bold uppercase tracking-widest">{label}</div>
        <div className="text-[10px] mt-1 opacity-70 uppercase tracking-wide">{subtitle}</div>
    </button>
);

const Toggle = ({ label, description, checked, onChange }: { label: string, description: React.ReactNode, checked: boolean, onChange: (v: boolean) => void }) => (
    <div className="flex items-start justify-between group p-4 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 bg-black/20">
        <div>
            <div className="text-sm text-gray-200 font-bold group-hover:text-dune-gold transition-colors">{label}</div>
            <div className="text-xs text-gray-500 mt-1">{description}</div>
        </div>
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            className={clsx(
                "w-12 h-6 rounded-full relative transition-colors flex-shrink-0 ml-4",
                checked ? "bg-dune-gold" : "bg-gray-700"
            )}
        >
            <div className={clsx(
                "absolute top-1 w-4 h-4 rounded-full bg-black transition-all shadow-sm",
                checked ? "left-7" : "left-1"
            )} />
        </button>
    </div>
);

interface AgentConfigProps {
    title: string;
    description: string;
    infoBlock?: React.ReactNode;
    model: ModelTier;
    setModel: (m: ModelTier) => void;
    basePrompt: string;
    setBasePrompt: (p: string) => void;
    fragments: PromptFragment[];
    toggleFragment: (id: string) => void;
}

const AgentConfig: React.FC<AgentConfigProps> = ({
    title,
    description,
    infoBlock,
    model,
    setModel,
    basePrompt,
    setBasePrompt,
    fragments,
    toggleFragment
}) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
                <h3 className="text-2xl font-bold text-white mb-2">{title}</h3>
                <p className="text-gray-500 text-sm">{description}</p>
            </div>

            {infoBlock}

            <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-8">
                {/* Model Selection */}
                <div>
                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">AI Model</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {(Object.keys(MODEL_INFO) as ModelTier[]).map(tier => (
                            <button
                                key={tier}
                                onClick={() => setModel(tier)}
                                className={clsx(
                                    "p-4 rounded border text-left transition-all",
                                    model === tier
                                        ? "bg-dune-gold text-black border-dune-gold"
                                        : "bg-black/20 border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                                )}
                            >
                                <div className="font-bold uppercase text-sm">{MODEL_INFO[tier].name}</div>
                                <div className="text-[10px] opacity-70 mt-1">{MODEL_INFO[tier].size}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Base Prompt */}
                <div>
                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Base System Prompt</label>
                    <textarea
                        className="w-full h-32 bg-black/30 border border-white/10 rounded p-4 text-xs text-gray-300 focus:border-dune-gold focus:outline-none transition-colors font-mono leading-relaxed"
                        value={basePrompt}
                        onChange={(e) => setBasePrompt(e.target.value)}
                    />
                </div>

                {/* Fragments */}
                <div>
                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Prompt Fragments</label>
                    <div className="space-y-3">
                        {fragments.map(fragment => (
                            <div key={fragment.id} className="flex items-start gap-4 p-4 rounded bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
                                <button
                                    onClick={() => toggleFragment(fragment.id)}
                                    className={clsx(
                                        "w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                                        fragment.enabled ? "bg-dune-gold border-dune-gold" : "border-gray-600 hover:border-white"
                                    )}
                                >
                                    {fragment.enabled && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                </button>
                                <div>
                                    <div className="text-sm font-bold text-white">{fragment.label}</div>
                                    <div className="text-xs text-gray-500 mt-1 font-mono">"{fragment.text}"</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * TTS Settings Component
 */
export const TTSSettings: React.FC = () => {
    const {
        voice,
        setVoice,
        backendPreference,
        setBackendPreference,
        bufferAhead,
        setBufferAhead,
        speed,
        setSpeed,
        volume,
        setVolume,
        isLoading,
        loadProgress,
        loadStatus,
    } = useTTSStore();
    
    const [isDownloading, setIsDownloading] = useState(false);
    const [isClearingCache, setIsClearingCache] = useState(false);
    const [isModelCached, setIsModelCached] = useState(false);
    const [isCheckingCache, setIsCheckingCache] = useState(true);
    const selectedDevice = backendPreference === 'auto' ? undefined : backendPreference;

    // Each voice's engine keeps its own weights, so model status is per voice.
    const selectedVoice = getVoice(voice);
    const selectedEngine = getVoiceEngine(voice);
    const isSelectedEngineReady = isTTSReady(voice);

    const voiceGroups = React.useMemo(() => {
        const groups = new Map<string, VoiceInfo[]>();
        for (const entry of VOICES) {
            if (entry.quality === 'D') continue;
            const group = groups.get(entry.languageLabel) ?? [];
            group.push(entry);
            groups.set(entry.languageLabel, group);
        }
        return Array.from(groups, ([label, entries]) => ({ label, voices: entries }));
    }, []);

    const refreshCacheStatus = React.useCallback(async () => {
        setIsCheckingCache(true);
        try {
            setIsModelCached(await isTTSModelCached(voice, selectedDevice));
        } finally {
            setIsCheckingCache(false);
        }
    }, [selectedDevice, voice]);

    useEffect(() => {
        let cancelled = false;

        void isTTSModelCached(voice, selectedDevice)
            .then((cached) => {
                if (!cancelled) setIsModelCached(cached);
            })
            .finally(() => {
                if (!cancelled) setIsCheckingCache(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedDevice, voice]);

    const handleDownloadModel = async () => {
        setIsDownloading(true);
        try {
            await initTTS(voice, selectedDevice);
            await refreshCacheStatus();
        } catch (e) {
            console.error('Failed to download TTS model:', e);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleClearCache = async () => {
        setIsClearingCache(true);
        try {
            await clearTTSCache(voice);
            setIsModelCached(false);
        } catch (e) {
            console.error('Failed to clear TTS cache:', e);
        } finally {
            setIsClearingCache(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
                <h3 className="text-2xl font-bold text-white mb-2">Text to Speech</h3>
                <p className="text-gray-500 text-sm">Listen to your books with local AI-powered voice synthesis.</p>
            </div>

            {/* Info Block */}
            <div className="bg-white/5 rounded-lg border border-white/10 p-6 space-y-4">
                <h4 className="text-purple-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                            d="M12 3c-4.97 0-9 4.03-9 9v7a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-1a2 2 0 00-2 2v3a2 2 0 002 2h1a2 2 0 002-2v-7c0-4.97-4.03-9-9-9z" />
                    </svg>
                    Seamless Reading ↔ Listening
                </h4>
                <p className="text-sm text-gray-400 leading-relaxed">
                    Switch between reading and listening at any point. When you pause audio, the reader picks up exactly where you left off. Perfect for commutes—read on the bus, listen while walking.
                </p>
                <h4 className="text-purple-400 font-bold uppercase tracking-widest text-xs pt-2">Two Local Engines</h4>
                <p className="text-sm text-gray-400 leading-relaxed">
                    English voices use <span className="text-white font-bold">Kokoro-82M</span>; Slovenian uses <span className="text-white font-bold">Piper</span>. Both are open-weight models that run entirely in your browser. No cloud APIs, no subscription, no text sent anywhere.
                </p>
                <ul className="space-y-2 text-xs text-gray-500 font-mono border-l-2 border-purple-500/30 pl-4 py-2">
                    <li>
                        <strong className="text-gray-300">Kokoro:</strong> FP32 on desktop · Q8 on iPhone/iPad · ~92 MB mobile download
                    </li>
                    <li>
                        <strong className="text-gray-300">Piper:</strong> sl_SI-artur-medium · ~63 MB · WASM only
                    </li>
                    <li>
                        <strong className="text-gray-300">Generation:</strong> Runs locally; speed varies by browser, backend, and hardware
                    </li>
                    <li>
                        <strong className="text-gray-300">Switching language</strong> unloads the other engine to keep memory in check
                    </li>
                </ul>
            </div>

            {/* Model Status & Download */}
            <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-xs text-purple-400 uppercase tracking-widest font-bold">
                            {selectedEngine === 'piper' ? 'Piper Model Status' : 'Kokoro Model Status'}
                        </h4>
                        <p className="text-sm text-gray-400 mt-1">
                            {isSelectedEngineReady
                                ? `Loaded in memory · ${loadStatus || 'FP32'}`
                                : isLoading
                                    ? 'Loading model into memory...'
                                    : isCheckingCache
                                        ? 'Checking browser cache...'
                                        : isModelCached
                                            ? 'Compatible model cached locally · not loaded in memory'
                                            : 'Compatible model not cached · first load requires download'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {isSelectedEngineReady && (
                            <button
                                onClick={handleClearCache}
                                disabled={isClearingCache}
                                className={clsx(
                                    "px-3 py-2 rounded text-xs font-bold transition-all",
                                    isClearingCache
                                        ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                                        : "bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/30"
                                )}
                                title="Clear cached model to force re-download. Fixes gibberish audio."
                            >
                                {isClearingCache ? 'CLEARING...' : 'CLEAR CACHE'}
                            </button>
                        )}
                        {!isSelectedEngineReady && (
                            <button
                                onClick={handleDownloadModel}
                                disabled={isLoading || isDownloading}
                                className={clsx(
                                    "px-4 py-2 rounded text-sm font-bold transition-all",
                                    isLoading || isDownloading
                                        ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                                        : "bg-purple-600 hover:bg-purple-500 text-white"
                                )}
                            >
                                {isLoading
                                    ? 'LOADING...'
                                    : isCheckingCache
                                        ? 'CHECKING CACHE...'
                                        : isModelCached
                                            ? 'LOAD CACHED MODEL'
                                            : 'DOWNLOAD & LOAD MODEL'}
                            </button>
                        )}
                    </div>
                </div>
                
                {(isLoading || isDownloading) && (
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>{loadStatus}</span>
                            <span>{Math.round(loadProgress * 100)}%</span>
                        </div>
                        <div className="w-full bg-gray-800 h-1.5 rounded overflow-hidden">
                            <div
                                className="bg-purple-500 h-full transition-all duration-300"
                                style={{ width: `${loadProgress * 100}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Voice Selection */}
            <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-6">
                <label className="block text-xs text-purple-400 uppercase tracking-widest font-bold">Voice</label>
                {voiceGroups.map(group => (
                    <div key={group.label} className="space-y-3">
                        <div className="text-[11px] text-gray-400 uppercase tracking-widest">
                            {group.voices[0].flag} {group.label}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {group.voices.map(v => (
                                <button
                                    key={v.id}
                                    onClick={() => setVoice(v.id)}
                                    className={clsx(
                                        "p-4 rounded border text-left transition-all",
                                        voice === v.id
                                            ? "bg-purple-600 text-white border-purple-400"
                                            : "bg-black/20 border-white/10 text-gray-400 hover:border-purple-400/50 hover:text-white"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm">{v.name}</span>
                                        <span className="text-[10px] opacity-60">
                                            {v.gender === 'female' ? '♀' : '♂'}
                                        </span>
                                    </div>
                                    <div className="text-[10px] opacity-70 mt-1">
                                        {v.description ?? v.languageLabel}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Speed & Volume */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-4">
                    <div className="flex justify-between">
                        <label className="text-xs text-purple-400 uppercase tracking-widest font-bold">Speech Speed</label>
                        <span className="text-purple-400 font-bold">{speed}x</span>
                    </div>
                    <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.25"
                        value={speed}
                        onChange={(e) => setSpeed(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <p className="text-xs text-gray-500 italic">
                        {selectedEngine === 'piper'
                            ? 'Piper has no speed setting of its own, so this stretches playback and shifts pitch slightly. Stay near 1x for the most natural voice.'
                            : 'Slower speeds are more natural, faster speeds help cover more ground.'}
                    </p>
                </div>
                
                <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-4">
                    <div className="flex justify-between">
                        <label className="text-xs text-purple-400 uppercase tracking-widest font-bold">Volume</label>
                        <span className="text-purple-400 font-bold">{Math.round(volume * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                </div>
            </div>

            {/* Performance Controls */}
            <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-4">
                <label className="block text-xs text-purple-400 uppercase tracking-widest font-bold">Performance Controls</label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-400 uppercase tracking-wider">Backend</span>
                            <span className="text-xs text-purple-300 uppercase">{backendPreference}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(['auto', 'wasm', 'webgpu'] as TTSBackendPreference[]).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setBackendPreference(mode)}
                                    className={clsx(
                                        'px-3 py-2 rounded text-xs font-bold uppercase transition-all border',
                                        backendPreference === mode
                                            ? 'bg-purple-600 text-white border-purple-400'
                                            : 'bg-black/20 border-white/10 text-gray-400 hover:border-purple-400/50 hover:text-white'
                                    )}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500 italic">
                            {selectedEngine === 'piper'
                                ? `Applies to English voices only — ${selectedVoice?.name ?? 'this voice'} always runs on WASM.`
                                : 'Desktop uses FP32. iPhone and iPad use lower-memory Q8 on WASM.'}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-xs text-gray-400 uppercase tracking-wider">Buffer Ahead</label>
                            <span className="text-xs text-purple-300">{bufferAhead} sentences</span>
                        </div>
                        <input
                            type="range"
                            min="3"
                            max="12"
                            step="1"
                            value={bufferAhead}
                            onChange={(e) => setBufferAhead(parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <p className="text-xs text-gray-500 italic">
                            Playback starts after this many sentences are ready, then maintains the same lead.
                        </p>
                    </div>
                </div>
            </div>

        </div>
    );
};
