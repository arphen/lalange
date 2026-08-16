import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDisplayPlugin, projectDisplayFrame } from '../core/rsvp/display';
import { getFrameTargetInterval } from '../core/rsvp/timing';
import { planRsvpFrame } from '../core/rsvp/phrases/grouping';
import { useSettingsStore } from '../core/store/settings';
import { ContextWindowProjector } from './Reader/contextWindowProjector';

const getDensityColor = (score: number) => {
  if (score === 0) return 'text-gray-700 opacity-50';
  if (score <= 0.6) return 'text-blue-400';
  if (score <= 0.8) return 'text-blue-300';
  if (score <= 1.0) return 'text-gray-400';
  if (score <= 1.2) return 'text-yellow-200';
  if (score <= 1.5) return 'text-yellow-500';
  if (score <= 2.0) return 'text-orange-500';
  return 'text-white font-bold';
};

const createContextWordModel = (displayPlugin: ReturnType<typeof getDisplayPlugin>, word: string) => {
  const { bold, light } = displayPlugin.splitWord(word);
  return {
    runs: [
      ...(bold ? [{ text: bold, className: 'font-bold' }] : []),
      ...(light ? [{ text: light, className: 'font-light opacity-80' }] : []),
    ],
  };
};

interface ManifestoRsvpProps {
  words: string[];
  densities: number[];
  currentIndex: number;
  onJumpToIndex: (index: number) => void;
}

export function ManifestoRsvp({ words, densities, currentIndex, onJumpToIndex }: ManifestoRsvpProps) {
  const { wpm, setWpm, displayPlugin: displayPluginId, commonPhraseRankLimit } = useSettingsStore();
  
  // Get active display plugin
  const displayPlugin = useMemo(() => getDisplayPlugin(displayPluginId), [displayPluginId]);

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const wpmRef = useRef(wpm);

  const rsvpRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const prevProjectorRef = useRef<ContextWindowProjector | null>(null);
  const nextProjectorRef = useRef<ContextWindowProjector | null>(null);

  if (prevProjectorRef.current == null) prevProjectorRef.current = new ContextWindowProjector();
  if (nextProjectorRef.current == null) nextProjectorRef.current = new ContextWindowProjector();

  const indexRef = useRef(currentIndex);
  const accumulatorRef = useRef(0);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const rafRef = useRef<number | null>(null);
  const loopRef = useRef<(time: number) => void>(() => undefined);

  // actual WPM (rolling minute), weighted by source words consumed per frame
  const wordTimestampsRef = useRef<Array<{ timeMs: number; sourceWordCount: number }>>([]);
  const [actualWpm, setActualWpm] = useState(0);

  // momentum-based speed controls
  const speedMomentumRef = useRef<{ lastPress: number; intensity: number }>({ lastPress: 0, intensity: 0 });

  const speedColor = useMemo(() => {
    if (actualWpm === 0) return 'text-gray-500';
    if (actualWpm < wpm * 0.8) return 'text-blue-400';
    if (actualWpm > wpm * 1.2) return 'text-red-400';
    return 'text-dune-gold';
  }, [actualWpm, wpm]);

  const renderAt = useCallback((idx: number) => {
    const frame = planRsvpFrame(words, idx, { phraseRankLimit: commonPhraseRankLimit });
    const frameEnd = frame.startIndex + frame.sourceWordCount;

    if (rsvpRef.current) {
      if (frame.displayText) {
        projectDisplayFrame(rsvpRef.current, displayPlugin, frame.tokens);
      } else {
        rsvpRef.current.replaceChildren();
      }
      
      // Apply plugin container styling
      const containerStyle = displayPlugin.getContainerStyle?.(frame.displayText);
      if (containerStyle) {
        Object.assign(rsvpRef.current.style, containerStyle);
      } else {
        rsvpRef.current.style.transform = '';
        rsvpRef.current.style.marginLeft = '';
      }
    }

    const startPrev = Math.max(0, idx - 150);
    const endPrev = frame.startIndex;

    if (prevRef.current) {
      const prevContainer = prevRef.current;
      prevProjectorRef.current?.project(prevContainer, words, startPrev, endPrev, {
        getColorClass: (actualIndex) => getDensityColor(densities[actualIndex] ?? 1.0),
        createWordModel: (word) => createContextWordModel(displayPlugin, word),
        getWordClassName: (_word, colorClass) => `word-span inline-block mr-1.5 mb-1 transition-all duration-200 cursor-pointer ${colorClass} opacity-60 hover:opacity-100 hover:text-white`,
        isParagraphEnd: (word) => /[.!?]["']?$/.test(word),
        modelKey: displayPlugin.id,
      });
      prevContainer.scrollTop = prevContainer.scrollHeight;
    }

    const startNext = frameEnd;
    const endNext = Math.min(words.length, frameEnd + 150);

    if (nextRef.current) {
      const nextContainer = nextRef.current;
      nextProjectorRef.current?.project(nextContainer, words, startNext, endNext, {
        getColorClass: (actualIndex) => getDensityColor(densities[actualIndex] ?? 1.0),
        createWordModel: (word) => createContextWordModel(displayPlugin, word),
        getWordClassName: (_word, colorClass) => `word-span inline-block mr-1.5 mb-1 transition-all duration-200 cursor-pointer ${colorClass} opacity-60 hover:opacity-100 hover:text-white`,
        isParagraphEnd: (word) => /[.!?]["']?$/.test(word),
        modelKey: displayPlugin.id,
      });
      nextContainer.scrollTop = 0;
    }
  }, [commonPhraseRankLimit, densities, words, displayPlugin]);

  const handleRiverClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wordSpan = target.closest('[data-index]');
    if (!wordSpan) {
      setIsPlaying(p => !p);
      return;
    }

    const indexStr = wordSpan.getAttribute('data-index');
    if (!indexStr) return;

    const newIndex = parseInt(indexStr, 10);
    if (Number.isNaN(newIndex)) return;

    // pause on manual navigation
    setIsPlaying(false);
    indexRef.current = newIndex;
    onJumpToIndex(newIndex);
    renderAt(newIndex);
  }, [onJumpToIndex, renderAt]);

  const calculateMomentumDelta = useCallback(() => {
    const now = performance.now();
    const momentum = speedMomentumRef.current;
    const timeSinceLastPress = (now - momentum.lastPress) / 1000;
    const decayFactor = Math.exp(-timeSinceLastPress / 0.3);
    const decayedIntensity = momentum.intensity * decayFactor;
    const newIntensity = decayedIntensity + 1.0;
    speedMomentumRef.current = { lastPress: now, intensity: newIntensity };
    const baseDelta = 25;
    return Math.round(baseDelta * Math.min(newIntensity, 8));
  }, []);

  const handleSlower = useCallback(() => {
    const delta = calculateMomentumDelta();
    setWpm(Math.max(50, wpm - delta));
  }, [calculateMomentumDelta, setWpm, wpm]);

  const handleFaster = useCallback(() => {
    const delta = calculateMomentumDelta();
    setWpm(wpm + delta);
  }, [calculateMomentumDelta, setWpm, wpm]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    if (isPlayingRef.current) {
      setIsPlaying(false);
    }

    const deltaY = e.deltaY;

    let scrollAmount: number;
    if (e.deltaMode === 1) {
      scrollAmount = Math.sign(deltaY) * Math.ceil(Math.abs(deltaY));
    } else if (e.deltaMode === 2) {
      scrollAmount = Math.sign(deltaY) * 10;
    } else {
      scrollAmount = Math.sign(deltaY) * Math.ceil(Math.abs(deltaY) / 50);
    }

    scrollAmount = Math.max(-20, Math.min(20, scrollAmount));
    if (scrollAmount === 0) return;

    const newIndex = Math.max(0, Math.min(words.length - 1, indexRef.current + scrollAmount));
    if (newIndex === indexRef.current) return;

    indexRef.current = newIndex;
    onJumpToIndex(newIndex);
    renderAt(newIndex);
  }, [onJumpToIndex, renderAt, words.length]);

  const loop = useCallback((time: number) => {
    if (!isPlayingRef.current) return;

    if (!lastTimeRef.current) lastTimeRef.current = time;

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;

    accumulatorRef.current += deltaTime;
    const baseInterval = 60000 / wpmRef.current;

    // avoid huge catchups
    if (accumulatorRef.current > Math.max(1000, baseInterval * 10)) {
      accumulatorRef.current = baseInterval;
    }

    while (true) {
      const frame = planRsvpFrame(words, indexRef.current, {
        phraseRankLimit: commonPhraseRankLimit,
      });
      const targetInterval = getFrameTargetInterval(
        frame,
        densities,
        words[frame.startIndex - 1],
        wpmRef.current,
      );

      if (accumulatorRef.current < targetInterval) break;

      wordTimestampsRef.current.push({ timeMs: time, sourceWordCount: frame.sourceWordCount });
      const nextIndex = frame.startIndex + frame.sourceWordCount;
      if (nextIndex < words.length) {
        indexRef.current = nextIndex;
        accumulatorRef.current -= targetInterval;
        onJumpToIndex(indexRef.current);
        renderAt(indexRef.current);
      } else {
        indexRef.current = Math.max(0, words.length - 1);
        onJumpToIndex(indexRef.current);
        setIsPlaying(false);
        break;
      }
    }

    rafRef.current = requestAnimationFrame(loopRef.current);
  }, [commonPhraseRankLimit, densities, onJumpToIndex, renderAt, words]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // sync external index changes
  useEffect(() => {
    indexRef.current = currentIndex;
    renderAt(currentIndex);
  }, [currentIndex, renderAt]);

  // sync refs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) {
      lastTimeRef.current = undefined;
      accumulatorRef.current = 0;
      rafRef.current = requestAnimationFrame(loopRef.current);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    wpmRef.current = wpm;
  }, [wpm]);

  // calculate actual WPM (rolling minute)
  useEffect(() => {
    const calc = () => {
      const now = performance.now();
      const oneMinuteAgo = now - 60000;
      const recent = wordTimestampsRef.current.filter(({ timeMs }) => timeMs > oneMinuteAgo);
      wordTimestampsRef.current = recent;

      if (recent.length >= 2) {
        const oldest = recent[0].timeMs;
        const consumedWords = recent.reduce((total, event) => total + event.sourceWordCount, 0);
        const spanMin = (now - oldest) / 60000;
        setActualWpm(Math.round(consumedWords / spanMin));
      } else {
        setActualWpm(0);
      }
    };

    if (!isPlaying) return;

    const id = window.setInterval(calc, 500);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  return (
    <div className="w-full h-full min-h-0 bg-basalt text-white overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col relative group">
        {/* Top Zone */}
        <div className="flex-1 w-full overflow-hidden relative mask-gradient-top flex justify-center">
          <div
            ref={prevRef}
            className="w-full max-w-2xl h-full flex flex-wrap content-end justify-start p-6 md:p-10 font-mono text-base md:text-lg leading-relaxed select-none overflow-hidden border-x border-white/5 cursor-ns-resize"
            onClick={handleRiverClick}
            onWheel={handleWheel}
          />
        </div>

        {/* RSVP Zone */}
        <div
          data-testid="rsvp-container"
          className="relative h-44 md:h-48 w-full flex items-center justify-center z-30"
          onClick={() => setIsPlaying(p => !p)}
        >
          <div
            className="w-full max-w-2xl h-full flex items-center justify-center bg-black/20 border border-white/5 hover:border-white/10 transition-colors cursor-ns-resize"
            onWheel={handleWheel}
          >
            <div
              ref={rsvpRef}
              className="text-5xl md:text-7xl font-mono tracking-tight whitespace-nowrap drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]"
            />
          </div>

          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-in fade-in duration-200">
              <div className="bg-black/40 backdrop-blur-sm p-5 rounded-full border border-white/10 shadow-2xl">
                <svg className="w-10 h-10 text-white/80 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Zone */}
        <div className="flex-1 w-full overflow-hidden relative mask-gradient-bottom flex justify-center">
          <div
            ref={nextRef}
            className="w-full max-w-2xl h-full flex flex-wrap content-start justify-start p-6 md:p-10 font-mono text-base md:text-lg leading-relaxed select-none overflow-hidden border-x border-white/5 cursor-ns-resize"
            onClick={handleRiverClick}
            onWheel={handleWheel}
          />
        </div>

        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 opacity-0 group-hover:opacity-30 transition-opacity duration-500 pointer-events-none">
          <div className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
            scroll to navigate
          </div>
        </div>
      </div>

      {/* Speed Control Overlay */}
      <div className="absolute bottom-6 right-6 z-[70] flex items-center gap-3 opacity-40 hover:opacity-100 transition-opacity duration-300">
        <button
          onClick={handleSlower}
          className="p-2 bg-black/60 backdrop-blur-sm rounded-full border border-white/10 text-white/60 hover:text-white hover:bg-black/80 hover:border-white/30 transition-all active:scale-95"
          title="Slower"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>

        <div className="flex flex-col items-center px-4 py-2 bg-black/60 backdrop-blur-sm rounded-lg border border-white/10 min-w-[90px]">
          <div className="flex items-baseline gap-1">
            <span className={`text-xl font-mono font-bold tabular-nums ${speedColor}`}>{actualWpm > 0 ? actualWpm : '—'}</span>
          </div>
          <span className="text-[9px] text-gray-500 tracking-widest uppercase">{actualWpm > 0 ? 'WPM' : 'PAUSED'}</span>
          {actualWpm > 0 && <span className="text-[8px] text-gray-600 mt-0.5">target: {wpm}</span>}
        </div>

        <button
          onClick={handleFaster}
          className="p-2 bg-black/60 backdrop-blur-sm rounded-full border border-white/10 text-white/60 hover:text-white hover:bg-black/80 hover:border-white/30 transition-all active:scale-95"
          title="Faster"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
