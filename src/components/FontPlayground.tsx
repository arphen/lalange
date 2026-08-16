import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDisplayPlugin, projectDisplayFrame, type DisplayPlugin } from '../core/rsvp/display';
import { useSettingsStore } from '../core/store/settings';

const ProjectedWord: React.FC<{ plugin: DisplayPlugin; word: string }> = ({ plugin, word }) => {
    const containerRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            projectDisplayFrame(containerRef.current, plugin, [word]);
        }
    }, [plugin, word]);

    return <span ref={containerRef} />;
};

export const FontPlayground: React.FC = () => {
    const { displayPlugin: displayPluginId } = useSettingsStore();
    const displayPlugin = useMemo(() => getDisplayPlugin(displayPluginId), [displayPluginId]);
    
    const [testWord, setTestWord] = useState('Gradient');
    const [baseColor, setBaseColor] = useState('text-white');

    const words = ['Hello', 'World', 'Velocity', 'Reading', 'Gradient', 'Architecture', 'Maspalomas'];

    return (
        <div className="w-full h-full p-8 bg-basalt text-white overflow-y-auto font-mono">
            <h1 className="text-2xl font-bold mb-8 text-dune-gold">Font Gradient Playground</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                {/* Controls */}
                <div className="space-y-6 p-6 bg-white/5 rounded-xl border border-white/10">
                    <div>
                        <label className="block text-xs text-gray-400 mb-2">TEST WORD</label>
                        <input
                            type="text"
                            value={testWord}
                            onChange={(e) => setTestWord(e.target.value)}
                            className="w-full bg-black/20 border border-white/10 rounded p-2 text-white font-mono"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-gray-400 mb-2">BASE COLOR</label>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={() => setBaseColor('text-white')} className="px-3 py-1 bg-white text-black rounded text-xs">White</button>
                            <button onClick={() => setBaseColor('text-dune-gold')} className="px-3 py-1 bg-dune-gold text-black rounded text-xs">Gold</button>
                            <button onClick={() => setBaseColor('text-magma-vent')} className="px-3 py-1 bg-magma-vent text-white rounded text-xs">Red</button>
                            <button onClick={() => setBaseColor('text-canarian-pine')} className="px-3 py-1 bg-canarian-pine text-white rounded text-xs">Pine</button>
                            <button onClick={() => setBaseColor('text-neon-pride')} className="px-3 py-1 bg-neon-pride text-black rounded text-xs">Neon</button>
                        </div>
                    </div>

                    <div className="text-xs text-gray-500">
                        <p>Roboto Mono Weights Available: 100-700</p>
                        <p>Current Mapping:</p>
                        <ul className="list-disc pl-4 mt-1 space-y-1">
                            <li>1st: Bold (700) / 100% Opacity</li>
                            <li>2nd: SemiBold (600) / 90% Opacity</li>
                            <li>3rd: Medium (500) / 80% Opacity</li>
                            <li>4th: Regular (400) / 70% Opacity</li>
                            <li>Rest: Light (300) / 50% Opacity</li>
                        </ul>
                    </div>
                </div>

                {/* Preview Area */}
                <div className="space-y-12">
                    {/* Large Display */}
                    <div>
                        <h3 className="text-xs text-gray-500 mb-4">LARGE DISPLAY (RSVP) - {displayPlugin.name}</h3>
                        <div className={`text-8xl ${baseColor} tracking-tight ${displayPlugin.getContainerClass()}`}>
                            <ProjectedWord plugin={displayPlugin} word={testWord} />
                        </div>
                    </div>

                    {/* Medium Display */}
                    <div>
                        <h3 className="text-xs text-gray-500 mb-4">MEDIUM DISPLAY</h3>
                        <div className={`text-4xl ${baseColor} tracking-tight ${displayPlugin.getContainerClass()}`}>
                            <ProjectedWord plugin={displayPlugin} word={testWord} />
                        </div>
                    </div>

                    {/* List of Words */}
                    <div>
                        <h3 className="text-xs text-gray-500 mb-4">WORD LIST</h3>
                        <div className="flex flex-wrap gap-4">
                            {words.map(w => (
                                <div key={w} className={`text-2xl ${baseColor}`}>
                                    <ProjectedWord plugin={displayPlugin} word={w} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Weight Scale Reference */}
            <div className="mt-12 p-6 bg-white/5 rounded-xl border border-white/10">
                <h3 className="text-xs text-gray-500 mb-4">WEIGHT SCALE REFERENCE</h3>
                <div className="grid grid-cols-7 gap-4 text-center">
                    <div>
                        <div className="text-4xl font-thin">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">100 Thin</div>
                    </div>
                    <div>
                        <div className="text-4xl font-extralight">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">200 XLight</div>
                    </div>
                    <div>
                        <div className="text-4xl font-light">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">300 Light</div>
                    </div>
                    <div>
                        <div className="text-4xl font-normal">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">400 Normal</div>
                    </div>
                    <div>
                        <div className="text-4xl font-medium">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">500 Medium</div>
                    </div>
                    <div>
                        <div className="text-4xl font-semibold">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">600 Semi</div>
                    </div>
                    <div>
                        <div className="text-4xl font-bold">Aa</div>
                        <div className="text-xs text-gray-500 mt-2">700 Bold</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
