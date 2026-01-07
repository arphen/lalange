import React, { useState, useEffect } from 'react';
import { useSettingsStore, type PromptFragment } from '../../core/store/settings';
import { useAIStore } from '../../core/store/ai';
import { getEngine, MODEL_INFO, type ModelTier, isModelCached, deleteModel } from '../../core/ai/webllm';
import { clsx } from 'clsx';

interface SettingsPanelProps {
    onClose: () => void;
}

type SettingsTab = 'general' | 'ai' | 'styling' | 'pacing' | 'librarian' | 'summarizer';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});
    const settings = useSettingsStore();
    const aiState = useAIStore();

    const checkCache = React.useCallback(async () => {
        const status: Record<string, boolean> = {};
        for (const tier of Object.keys(MODEL_INFO) as ModelTier[]) {
            status[tier] = await isModelCached(tier);
        }
        setCachedModels(status);
    }, []);

    useEffect(() => {
        if (activeTab === 'ai') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            checkCache();
        }
    }, [activeTab, checkCache]);

    const tabs: { id: SettingsTab; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
        { id: 'ai', label: 'Model Manager', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
        { id: 'styling', label: 'Editor (Styling)', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
        { id: 'pacing', label: 'Pacing Engine', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
        { id: 'librarian', label: 'Librarian', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
        { id: 'summarizer', label: 'Summarizer', icon: 'M4 6h16M4 12h16M4 18h7' },
    ];

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
        <div className="w-full h-full flex bg-basalt text-white font-mono overflow-hidden">
            {/* Sidebar */}
            <div className="w-64 flex-shrink-0 border-r border-white/10 bg-black/20 flex flex-col">
                <div className="p-6 border-b border-white/10">
                    <h2 className="text-xl font-bold text-dune-gold tracking-widest uppercase">SETTINGS</h2>
                    <p className="text-xs text-gray-500 mt-1">SYSTEM CONFIGURATION</p>
                </div>
                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={clsx(
                                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all",
                                activeTab === tab.id
                                    ? "bg-dune-gold text-black font-bold"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                            )}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                            </svg>
                            {tab.label}
                        </button>
                    ))}
                </nav>
                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={onClose}
                        className="w-full py-2 border border-white/10 rounded text-xs text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
                    >
                        [ CLOSE SETTINGS ]
                    </button>
                    <div className="mt-4 text-center">
                        <p className="text-[10px] text-gray-600 font-mono">
                            v0.1.0-{__COMMIT_HASH__}
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto bg-basalt">
                <div className="max-w-4xl mx-auto p-8 md:p-12">

                    {/* General Tab */}
                    {activeTab === 'general' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">Preprocessing</h3>
                                <p className="text-gray-500 text-sm">Configure how books are cleaned before ingestion.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-6">
                                <Toggle
                                    label="License Annihilator"
                                    description="Detects and hard-removes Project Gutenberg/Standard Ebooks legal headers."
                                    checked={settings.licenseAnnihilator}
                                    onChange={settings.toggleLicenseAnnihilator}
                                />
                                <Toggle
                                    label="Generative Junk Removal"
                                    description="Uses AI to detect and skip non-content chunks (TOC, Copyright, etc) during summarization."
                                    checked={settings.enableJunkRemoval}
                                    onChange={settings.setEnableJunkRemoval}
                                />
                                <Toggle
                                    label="Structural Scrubber"
                                    description="Strips out 'Chapter 1', page numbers, and Transcriber’s notes."
                                    checked={settings.structuralScrubber}
                                    onChange={settings.setStructuralScrubber}
                                />
                                <Toggle
                                    label="Footnote Suppressor"
                                    description="Hides [1] or (p. 42) references that trigger 'eye-glitch'."
                                    checked={settings.footnoteSuppressor}
                                    onChange={settings.setFootnoteSuppressor}
                                />
                                <div className="pt-6 border-t border-white/5">
                                    <label className="block text-sm text-dune-gold mb-2">MANUAL OVERRIDE RULES</label>
                                    <textarea
                                        className="w-full h-32 bg-black/30 border border-white/10 rounded p-4 text-sm text-gray-300 focus:border-dune-gold focus:outline-none transition-colors font-mono"
                                        placeholder="Global Find & Replace rules (e.g. Change 'Rand' to 'The Dragon')"
                                        value={settings.manualOverrideRules}
                                        onChange={(e) => settings.setManualOverrideRules(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Model Manager Tab */}
                    {activeTab === 'ai' && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">Model Manager</h3>
                                <p className="text-gray-500 text-sm">Download and manage local AI models (WebLLM).</p>
                            </div>

                            {/* Model Availability Section */}
                            <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
                                <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                                    <h4 className="font-bold text-dune-gold text-sm tracking-widest">AVAILABLE MODELS</h4>
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
                                                        <span className={clsx("font-bold capitalize", isCached ? "text-green-400" : "text-white")}>{info.name}</span>
                                                        <span className="text-xs text-gray-500 font-mono">({info.id})</span>
                                                        {isCached && <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded border border-green-800">CACHED</span>}
                                                    </div>
                                                    <div className="text-xs text-gray-400 mt-1">
                                                        Required Disk Space: <span className="text-dune-gold">{info.size}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    {isCached ? (
                                                        <button
                                                            onClick={() => handleDeleteModel(tier)}
                                                            disabled={aiState.isLoading}
                                                            className="px-4 py-2 text-xs font-bold rounded border border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500 transition-all disabled:opacity-50"
                                                        >
                                                            EVICT
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleDownloadModel(tier)}
                                                            disabled={aiState.isLoading}
                                                            className="px-4 py-2 text-xs font-bold rounded border border-white/20 text-gray-400 hover:border-dune-gold hover:text-dune-gold transition-all disabled:opacity-50"
                                                        >
                                                            DOWNLOAD / CACHE
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
                                                {aiState.loadingModel ? `LOADING ${aiState.loadingModel.toUpperCase()}...` : 'DOWNLOADING / LOADING...'}
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
                                {aiState.activity && (
                                    <div className="p-4 bg-dune-gold/10 border-t border-dune-gold/20">
                                        <div className="flex items-center gap-2 text-xs text-dune-gold">
                                            <span className="animate-pulse">●</span>
                                            <span className="font-bold">ACTIVE:</span>
                                            <span>{aiState.activity}</span>
                                            {aiState.activeModel && <span className="opacity-50">({aiState.activeModel})</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Editor (Styling) Tab */}
                    {activeTab === 'styling' && (
                        <AgentConfig
                            title="The Editor"
                            description="Configure the AI agent responsible for rewriting and styling text."
                            model={settings.editorModel}
                            setModel={settings.setEditorModel}
                            basePrompt={settings.editorBasePrompt}
                            setBasePrompt={settings.setEditorBasePrompt}
                            fragments={settings.editorFragments}
                            toggleFragment={settings.toggleEditorFragment}
                        />
                    )}

                    {/* Pacing Tab */}
                    {activeTab === 'pacing' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">The Pacing Engine</h3>
                                <p className="text-gray-500 text-sm">Control how the reader adapts to text density.</p>
                            </div>

                            <div className="bg-black/20 p-8 rounded-lg border border-white/10">
                                <div className="flex justify-between text-sm text-gray-400 mb-4">
                                    <span>BASE VELOCITY</span>
                                    <span className="text-dune-gold font-bold">{settings.wpm} WPM</span>
                                </div>
                                <input
                                    type="range" aria-label="WPM" min="100"
                                    max="1000"
                                    step="50"
                                    value={settings.wpm}
                                    onChange={(e) => settings.setWpm(parseInt(e.target.value))}
                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-dune-gold"
                                />
                                <div className="flex justify-between text-[10px] text-gray-600 mt-2 uppercase tracking-widest">
                                    <span>Slow</span>
                                    <span>Speed Reader</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Analysis Granularity removed - using Pacing Sensitivity instead */}
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
                            </div>
                        </div>
                    )}

                    {/* Librarian Tab */}
                    {activeTab === 'librarian' && (
                        <div className="space-y-8">
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

                            <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-8">
                                <div>
                                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Persona</label>
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

                                <div>
                                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">Monetization</label>
                                    <Toggle
                                        label="Support Development"
                                        description="(You) generate affiliate links for arphen so he can pay for his domain name"
                                        checked={settings.affiliateLinksEnabled}
                                        onChange={settings.setAffiliateLinksEnabled}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Summarizer Tab */}
                    {activeTab === 'summarizer' && (
                        <AgentConfig
                            title="The Summarizer"
                            description="Configure the agent responsible for chapter summaries and plot analysis."
                            model={settings.summarizerModel}
                            setModel={settings.setSummarizerModel}
                            basePrompt={settings.summarizerBasePrompt}
                            setBasePrompt={settings.setSummarizerBasePrompt}
                            fragments={settings.summarizerFragments}
                            toggleFragment={settings.toggleSummarizerFragment}
                        />
                    )}

                </div>
            </div>
        </div>
    );
};

const Toggle = ({ label, description, checked, onChange }: { label: string, description: string, checked: boolean, onChange: (v: boolean) => void }) => (
    <div className="flex items-start justify-between group p-4 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
        <div>
            <div className="text-sm text-gray-200 font-bold group-hover:text-dune-gold transition-colors">{label}</div>
            <div className="text-xs text-gray-500 mt-1">{description}</div>
        </div>
        <button
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

            <div className="bg-white/5 rounded-lg p-8 border border-white/10 space-y-8">
                {/* Model Selection */}
                <div>
                    <label className="block text-xs text-dune-gold mb-4 uppercase tracking-widest font-bold">AI Model</label>
                    <div className="grid grid-cols-3 gap-4">
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
                        className="w-full h-32 bg-black/30 border border-white/10 rounded p-4 text-sm text-gray-300 focus:border-dune-gold focus:outline-none transition-colors font-mono leading-relaxed"
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