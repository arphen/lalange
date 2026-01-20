import React, { useCallback, useMemo, useState } from 'react';
import { SeoHead } from './SeoHead';
import { BrandName } from './BrandName';
import { MANIFESTO_DENSITIES, MANIFESTO_PARAGRAPHS, MANIFESTO_WORDS } from '../content/manifesto';
import { ManifestoRsvp } from './ManifestoRsvp';

const getDensityColor = (score: number) => {
    if (score === 0) return 'text-gray-700 opacity-50';
    if (score <= 0.6) return 'text-blue-400';
    if (score <= 0.8) return 'text-blue-300';
    if (score <= 1.0) return 'text-gray-400';
    if (score <= 1.2) return 'text-yellow-200';
    if (score <= 1.5) return 'text-yellow-500';
    if (score <= 2.0) return 'text-orange-500';
    return 'text-red-500 font-bold';
};

export const Manifesto: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [pauseEpoch, setPauseEpoch] = useState(0);

    const paragraphsAsWords = useMemo(() => {
        return MANIFESTO_PARAGRAPHS
            .map(p => p.trim().split(/\s+/).filter(Boolean))
            .reduce<{ cursor: number; blocks: Array<{ words: string[]; start: number }> }>((state, words) => {
                return {
                    cursor: state.cursor + words.length,
                    blocks: [...state.blocks, { words, start: state.cursor }],
                };
            }, { cursor: 0, blocks: [] }).blocks;
    }, []);

    const jumpFromText = useCallback((idx: number) => {
        setCurrentIndex(Math.max(0, Math.min(MANIFESTO_WORDS.length - 1, idx)));
        setPauseEpoch(e => e + 1);
    }, []);

    const jumpFromRsvp = useCallback((idx: number) => {
        setCurrentIndex(Math.max(0, Math.min(MANIFESTO_WORDS.length - 1, idx)));
    }, []);

    return (
        <div className="w-full h-full min-h-0 overflow-hidden font-mono">
            <SeoHead
                title="Manifesto"
                description="XYZ represents a shift towards local-only usage of LLMs. Experience high-velocity data ingestion with complete digital sovereignty."
                canonicalUrl="https://xyz.com/manifesto"
            />
            <div className="w-full h-full min-h-0 flex flex-col lg:flex-row">
                {/* Left: Regular reading */}
                <div className="w-full lg:w-1/2 h-full min-h-0 overflow-hidden flex flex-col border-b lg:border-b-0 lg:border-r border-white/10 bg-basalt">
                    <div className="p-6 md:p-8 border-b border-white/10 flex items-center justify-between">
                        <button
                            onClick={onBack}
                            className="text-sm text-white/60 hover:text-white hover:underline"
                        >
                            ← Back
                        </button>

                        <div className="text-xs text-white/40 tracking-widest uppercase">Regular reading</div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-10">
                        <h1 className="text-4xl font-bold mb-8 text-lacan-red">MANIFESTO</h1>

                        <div className="space-y-6 text-lg leading-relaxed text-white/90">
                            <p>
                                <BrandName /> represents a shift towards <strong>local-only usage of LLMs</strong> as a means to wrest control from Big AI.
                            </p>

                            <p>
                                We utilize already available models to perform LLM-agent interactions locally on the user side,
                                <strong>without any interaction with any other server</strong>.
                            </p>

                            <ul className="list-disc pl-6 space-y-2 text-white/80">
                                <li>No logins.</li>
                                <li>No tracking.</li>
                                <li>Just free, open source software.</li>
                            </ul>

                            <p>
                                Even the code on the user side could theoretically be made to be analyzed with an LLM to assert
                                no malicious code was injected.
                            </p>

                            <div className="pt-4 border-t border-white/20 mt-8">
                                <div className="flex flex-col gap-6 select-none">
                                    {paragraphsAsWords.map((block, pIdx) => (
                                        <div key={pIdx} className="flex flex-wrap gap-x-2 gap-y-2">
                                            {block.words.map((word, wIdx) => {
                                                const globalIndex = block.start + wIdx;
                                                const density = MANIFESTO_DENSITIES[globalIndex] ?? 1.0;
                                                const colorClass = getDensityColor(density);
                                                const isCurrent = globalIndex === currentIndex;

                                                return (
                                                    <button
                                                        key={`${pIdx}-${wIdx}`}
                                                        type="button"
                                                        onClick={() => jumpFromText(globalIndex)}
                                                        className={`inline-block text-left transition-all ${colorClass} ${isCurrent ? 'text-white opacity-100 underline underline-offset-4' : 'opacity-70 hover:opacity-100 hover:text-white'}`}
                                                        title={`density: ${density}`}
                                                    >
                                                        {word}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/20 mt-8 text-sm text-white/70">
                                <div className="uppercase tracking-widest text-[10px] text-white/50 mb-2">Source</div>
                                <a
                                    href="https://github.com/arpheno/lalange"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 text-dune-gold/80 hover:text-dune-gold hover:underline"
                                >
                                    View on GitHub
                                    <span aria-hidden className="text-white/40">↗</span>
                                </a>
                            </div>

                            <p className="text-xl font-bold pt-4 border-t border-white/20 mt-8">
                                This is the next generation of open software.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right: RSVP demo */}
                <div className="w-full lg:w-1/2 h-full min-h-0 overflow-hidden flex flex-col bg-basalt">
                    <div className="p-6 md:p-8 border-b border-white/10 flex items-center justify-between">
                        <div className="text-xs text-white/40 tracking-widest uppercase">RSVP demo</div>
                        <div className="text-xs text-white/40 tabular-nums">
                            {currentIndex + 1} / {MANIFESTO_WORDS.length}
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden">
                        <ManifestoRsvp
                            key={pauseEpoch}
                            words={MANIFESTO_WORDS}
                            densities={MANIFESTO_DENSITIES}
                            currentIndex={currentIndex}
                            onJumpToIndex={jumpFromRsvp}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
