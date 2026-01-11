import React, { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../core/store/settings';
import { useAIStore } from '../../core/store/ai';
import { downloadModelToCache } from '../../core/ai/webllm';
import { getSaccadeGradientHtml } from '../../core/rsvp/saccade';
import { clsx } from 'clsx';
import { BrandName } from '../BrandName';

const DEMO_TEXT = `Reading is a technology. For centuries, we have been limited by the mechanics of the eye (the saccade). We jump from word to word, wasting cognitive cycles on navigation rather than metabolism. XYZ intervention changes this. By presenting text serially, at high velocity, we bypass the spatial constraints of the page. The meaning is injected directly into the nervous system.`;
const SUMMARY_TEXT = `The reader consumes text at high velocity, bypassing spatial constraints. To prevent semantic drift, the system retroactively stabilizes meaning through periodic summarization.`;

const DEMO_WORDS = DEMO_TEXT.split(' ');
const SUMMARY_WORDS = SUMMARY_TEXT.split(' ');

export const Onboarding: React.FC = () => {
    const { setHasCompletedOnboarding } = useSettingsStore();
    const aiState = useAIStore();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [downloadStarted, setDownloadStarted] = useState(false);
    
    // Demo RSVP State
    const [rsvpIndex, setRsvpIndex] = useState(0);
    const [isPlaying] = useState(true);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // RSVP Loop
    useEffect(() => {
        if (!isPlaying || (step !== 2 && step !== 3)) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        const words = step === 2 ? DEMO_WORDS : SUMMARY_WORDS;
        const speed = step === 2 ? 200 : 350; // 300 WPM vs ~170 WPM

        // Reset removed from here to avoid lint error

        intervalRef.current = setInterval(() => {
            setRsvpIndex(prev => (prev + 1) % words.length);
        }, speed);

        return () => {
             if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isPlaying, step]);

    const handleStartDownload = () => {
        setDownloadStarted(true);
        setStep(2);
        setRsvpIndex(0);
        // Trigger background download of TinyLlama
        downloadModelToCache('tiny').catch(console.error);
    };

    const handleFinish = () => {
        setHasCompletedOnboarding(true);
    };

    // Actually, downloadModelToCache sets loading=true, then loading=false.
    // We can track completion roughly by checking if loading went back to false and we started it.
    // A more robust way is checking `isModelCached('tiny')` but that's async. 
    // For FTUE, if it finishes, aiState.isLoading becomes false.
    const canFinish = !aiState.isLoading && downloadStarted;

    return (
        <div className="w-full h-full flex flex-col bg-basalt text-white relative overflow-hidden">
            {/* Background Texture */}
            <div className="absolute inset-0 mica-dust-layer opacity-50 pointer-events-none" />

            <div className="relative z-10 flex-1 flex flex-col">
                {/* Header */}
                <div className="p-8 border-b border-white/10 flex justify-between items-center">
                    <h1 className="flex items-center gap-3">
                        <BrandName /> <span className="text-white/30 text-sm tracking-normal">INITIALIZATION PROTOCOL</span>
                    </h1>
                    <div className="text-xs font-mono text-dune-gold">
                        STEP {step} / 3
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto">
                    {step === 1 && (
                        <div className="max-w-3xl mx-auto mt-20 p-8 space-y-12 animate-in fade-in zoom-in-95 duration-500">
                            <div className="space-y-6">
                                <h2 className="text-4xl font-bold text-white">Neuro-Semantic Initialization</h2>
                                <p className="text-lg text-gray-400 leading-relaxed font-light">
                                    You are about to install the <BrandName /> <span className="text-white font-bold">Pacing Engine</span>. 
                                    This requires downloading a local AI model (TinyLlama, ~700MB) directly to your browser storage.
                                </p>
                            </div>

                            <div className="bg-white/5 border border-white/10 rounded-lg p-6 space-y-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-8 h-8 rounded bg-dune-gold/20 flex items-center justify-center text-dune-gold font-bold">
                                        1
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white">Local Intelligence</h3>
                                        <p className="text-sm text-gray-400 mt-1">
                                            The model runs entirely on your device (Offline). No text is ever sent to the cloud.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <div className="w-8 h-8 rounded bg-dune-gold/20 flex items-center justify-center text-dune-gold font-bold">
                                        2
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white">TinyLlama Default</h3>
                                        <p className="text-sm text-gray-400 mt-1">
                                            We start with the smallest, fastest model. You can switch to more powerful engines (like Qwen 2.5) in the Settings menu later.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleStartDownload}
                                className="w-full py-6 bg-dune-gold hover:bg-white text-black font-bold text-xl tracking-widest uppercase transition-all rounded"
                            >
                                Acknowledge & Install Model
                            </button>
                            
                            <p className="text-center text-xs text-gray-600 font-mono">
                                By proceeding, you agree to become a Pilot of the text, not merely a reader.
                            </p>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="h-full flex flex-col">
                           <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8 p-8 items-center max-w-7xl mx-auto w-full">
                                
                                {/* Column 1: The Old Way (Static) */}
                                <div className="space-y-4 opacity-50 hover:opacity-100 transition-opacity">
                                    <div className="text-xs font-mono text-gray-500 uppercase tracking-widest border-b border-gray-700 pb-2">
                                        Paradigm: Classical
                                    </div>
                                    <h3 className="text-xl font-bold text-white">The Spatial Trap</h3>
                                    <p className="text-sm text-gray-400 leading-relaxed font-serif">
                                        When you read a paragraph like this, your eyes perform saccades—jumping from word to word. 
                                        You re-read lines. You scan. You get distracted by the layout. 
                                        Your brain spends energy just navigating the 2D space of the page.
                                    </p>
                                    <div className="p-4 bg-white text-black font-serif text-sm leading-relaxed rounded opacity-80 select-none">
                                        {DEMO_TEXT}
                                    </div>
                                </div>

                                {/* Column 2: The Explanation */}
                                <div className="space-y-6 text-center lg:px-4">
                                     <div className="w-16 h-1 bg-dune-gold mx-auto mb-8" />
                                     <h3 className="text-2xl font-bold text-white">The Injection</h3>
                                     <p className="text-base text-gray-300 leading-relaxed">
                                        <strong className="text-dune-gold">RSVP</strong> (Rapid Serial Visual Presentation) solves this by placing every word in the exact same spot: your foveal center.
                                     </p>
                                     <p className="text-sm text-gray-500"><BrandName /> uses the AI you are downloading right now. It predicts the "density" of the text and <strong className="text-white">slows down</strong> for complex ideas, just like your brain wants to.
                                     </p>
                                     <div className="w-16 h-1 bg-dune-gold mx-auto mt-8" />
                                </div>

                                {/* Column 3: The New Way (RSVP) */}
                                <div className="space-y-4">
                                    <div className="text-xs font-mono text-neon-pride uppercase tracking-widest border-b border-neon-pride/30 pb-2 text-right">
                                        Paradigm: <BrandName />
                                    </div>
                                    <div className="aspect-square bg-black border-2 border-white/20 rounded-lg flex flex-col items-center justify-center relative overflow-hidden shadow-2xl shadow-black">
                                         {/* Guides */}
                                         <div className="absolute top-0 bottom-0 w-px bg-red-900/30 left-1/2 -translate-x-1/2" />
                                         <div className="absolute left-0 right-0 h-px bg-red-900/30 top-1/2 -translate-y-1/2" />
                                         
                                         {/* The Word */}
                                         <div 
                                            className="relative z-10 text-4xl md:text-5xl text-white font-serif tracking-tight text-center drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]"
                                            dangerouslySetInnerHTML={{ __html: getSaccadeGradientHtml(step === 2 ? DEMO_WORDS[rsvpIndex] : SUMMARY_WORDS[rsvpIndex]) }}
                                         />
                                         
                                         {/* Status */}
                                         <div className="absolute bottom-4 left-0 right-0 text-center">
                                            <div className="text-[10px] font-mono text-dune-gold">
                                            {step === 2 ? '300 WPM' : '170 WPM'}
                                            </div>
                                         </div>
                                    </div>
                                    <p className="text-xs text-center text-gray-500 font-mono">
                                        Look at the center. Do not move your eyes.
                                    </p>
                                </div>
                           </div>

                           {/* Footer / Download Status */}
                           <div className="border-t border-white/10 bg-black/40 backdrop-blur p-6">
                                <div className="max-w-3xl mx-auto space-y-4">
                                    <div className="flex justify-between items-end text-xs font-mono">
                                        <span className="text-dune-gold uppercase">
                                            {canFinish ? "INSTALLATION COMPLETE" : "INSTALLING NEURAL ENGINE..."}
                                        </span>
                                        <span className="text-gray-400">
                                            {aiState.isLoading ? Math.round(aiState.progressValue * 100) + "%" : (canFinish ? "100%" : "WAITING")}
                                        </span>
                                    </div>
                                    
                                    {/* Progress Bar */}
                                    <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                                        <div 
                                            className={clsx(
                                                "h-full transition-all duration-300",
                                                canFinish ? "bg-green-500" : "bg-dune-gold"
                                            )}
                                            style={{ width: canFinish ? '100%' : `${aiState.progressValue * 100}%` }}
                                        />
                                    </div>

                                    <div className="flex justify-center pt-4">
                                        <button
                                            disabled={!canFinish}
                                            onClick={() => {
                                                setStep(3);
                                                setRsvpIndex(0);
                                            }}
                                            className={clsx(
                                                "px-8 py-3 rounded font-bold tracking-widest uppercase transition-all",
                                                canFinish 
                                                    ? "bg-white text-black hover:bg-dune-gold"
                                                    : "bg-gray-800 text-gray-500 cursor-not-allowed border border-white/5"
                                            )}
                                        >
                                            {canFinish ? (
                                                <span>NEXT: THE QUILTING POINT</span>
                                            ) : "Please Wait for Install..."}
                                        </button>
                                    </div>
                                    {!canFinish && (
                                        <p className="text-center text-[10px] text-gray-600 animate-pulse">
                                            Downloading ~700MB. Please do not close this tab.
                                        </p>
                                    )}
                                </div>
                           </div>
                        </div>
                    )}
                    
                    {step === 3 && (
                        <div className="max-w-4xl mx-auto mt-20 p-8 space-y-12 animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="space-y-6 text-center">
                                <h2 className="text-4xl font-bold text-white">The Quilting Point</h2>
                                <p className="text-lg text-gray-400 leading-relaxed font-light italic">
                                    "Point de Capiton"
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                                <div className="space-y-6 text-sm text-gray-400 leading-relaxed font-serif text-justify">
                                    <p>
                                        <strong className="text-white">The Problem:</strong> Speed reading is like drinking from a firehose. You ingest data faster than your "phonological loop" (inner voice) can process. It's easy to read 50 pages and realize you've lost the thread.
                                    </p>
                                    <p>
                                        <strong className="text-white">The Solution:</strong> The <strong className="text-dune-gold">Summarizer Agent</strong> acts as an auto-save for your brain. It generates periodic "Quilting Points" that anchor the narrative, ensuring you don't drift away.
                                    </p>
                                    <p className="border-l-2 border-dune-gold pl-4 text-xs font-mono text-gray-500">
                                        "Ideally, the system remembers for you, allowing you to focus entirely on the velocity of the text."
                                    </p>
                                </div>
                                
                                <div className="relative">
                                     <div className="aspect-video bg-black/80 border border-white/10 rounded-lg flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
                                         {/* Guides */}
                                         <div className="absolute top-0 bottom-0 w-px bg-white/5 left-1/2 -translate-x-1/2" />
                                         <div className="absolute left-0 right-0 h-px bg-white/5 top-1/2 -translate-y-1/2" />
                                         
                                         {/* The Word */}
                                         <div 
                                            className="relative z-10 text-3xl md:text-4xl text-amber-400 italic font-mono tracking-tight text-center drop-shadow-[0_0_15px_rgba(251,191,36,0.3)] px-8"
                                            dangerouslySetInnerHTML={{ __html: getSaccadeGradientHtml(SUMMARY_WORDS[rsvpIndex]) }}
                                         />
                                         
                                         {/* Status Overlay */}
                                         <div className="absolute top-4 left-4 flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                            <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Consolidating Pattern...</span>
                                         </div>

                                          {/* Status */}
                                          <div className="absolute bottom-4 left-0 right-0 text-center">
                                            <div className="text-[10px] font-mono text-gray-600">170 WPM</div>
                                         </div>
                                    </div>
                                    <div className="mt-4 text-center">
                                        <p className="text-xs text-amber-400/60 font-mono">
                                            *Simulation of retroactive summary injection
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-center pt-8">
                                <button
                                    onClick={handleFinish}
                                    className="px-8 py-3 bg-dune-gold hover:bg-white text-black font-bold text-xl tracking-widest uppercase transition-all rounded"
                                >
                                    Enter <BrandName /> System
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
