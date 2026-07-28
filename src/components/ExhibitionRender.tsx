import { useEffect, useRef, useState } from 'react';
import { getSpeedFactor, getVisualProcessingDelay } from '../core/rsvp/timing';
import { getVelocireaderORPIndex, getLuminance, getFontWeight } from '../core/rsvp/display/velocireader';
import {
  getFocusCharWidth,
  getFocusFontSizeScale,
  getFocusMargin,
  getAnchoredSlantAngle,
} from '../core/rsvp/display/velocireader-focus-slant';
import { isPauseToken } from '../core/rsvp/tokenize';

/**
 * ExhibitionRender
 * ----------------
 * Standalone, chrome-free RSVP renderer used by the automated exhibition
 * pipeline (see docs/exhibition.md). It is mounted directly from main.tsx when
 * the URL carries `?exhibition=true`, bypassing routing, onboarding and
 * StrictMode double-mounting so recording is deterministic.
 *
 * URL parameters:
 *   book       required   book id -> /exhibition-texts/<book>.json (word array)
 *   duration   seconds    total recording length (default 30)
 *   wpm        number     base reading speed (default 450)
 *   fps        number     capture frame rate (default 30)
 *   start      0..1|0..100 fractional/percent start offset into the book
 *                        (default 0; e.g. 0.3 or 30 starts around 30%)
 *
 * Anamorphic output: each grid cell is 1280x1080 and the exhibition monitors
 * stretch it horizontally, so the text is pre-compressed by 0.666667. Because
 * we capture the <canvas> pixel stream (CSS transforms are NOT captured), the
 * compression is baked directly into the canvas drawing.
 *
 * Orchestrator handshake (read by scripts/render_books.js):
 *   window.__EXHIBITION_STATE__  'loading' | 'recording' | 'done' | 'error'
 *   window.__EXHIBITION_DONE__   boolean
 *   window.__EXHIBITION_ERROR__  string | undefined
 */

const CELL_WIDTH = 1280;
const CELL_HEIGHT = 1080;
const ANAMORPHIC_SCALE_X = 0.666667;
const TEXT_COLOR = '#FFFFFF';
const BASE_FONT_PX = 150;
// Same monospace stack the Velocireader plugins request in the app.
const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Roboto Mono", monospace';
// Museum-label caption: an italic serif title over a tracked, uppercase author.
// Proportional faces set it apart from the monospace RSVP word so it reads as a
// quiet gallery credit rather than part of the text.
const CAPTION_SERIF = 'Georgia, "Times New Roman", "Iowan Old Style", serif';
const CAPTION_SANS = 'ui-sans-serif, "Helvetica Neue", Helvetica, Arial, sans-serif';

declare global {
  interface Window {
    __EXHIBITION_STATE__?: 'loading' | 'recording' | 'done' | 'error';
    __EXHIBITION_DONE__?: boolean;
    __EXHIBITION_ERROR__?: string;
  }
}

function setState(state: NonNullable<Window['__EXHIBITION_STATE__']>, error?: string) {
  window.__EXHIBITION_STATE__ = state;
  window.__EXHIBITION_DONE__ = state === 'done' || state === 'error';
  if (error) window.__EXHIBITION_ERROR__ = error;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

export function ExhibitionRender() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState(() => (
    new URLSearchParams(window.location.search).get('book')
      ? 'loading'
      : 'error: missing ?book='
  ));

  useEffect(() => {
    setState('loading');

    const params = new URLSearchParams(window.location.search);
    const book = params.get('book') || '';
    const duration = Math.max(1, Number(params.get('duration') || 30));
    const wpm = Math.max(50, Number(params.get('wpm') || 450));
    const fps = Math.max(1, Number(params.get('fps') || 30));
    const rawStart = Number(params.get('start') ?? params.get('startPct') ?? 0);
    const startFraction = Number.isFinite(rawStart)
      ? Math.min(0.99, Math.max(0, rawStart > 1 ? rawStart / 100 : rawStart))
      : 0;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CELL_WIDTH;
    canvas.height = CELL_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('error: no 2d context');
      setState('error', 'no 2d context');
      return;
    }

    let rafId = 0;
    let stopTimer: number | undefined;
    let recorder: MediaRecorder | undefined;
    let cancelled = false;

    // Book metadata for the unobtrusive credit line; populated from index.json
    // before recording starts.
    let captionTitle = '';
    let captionAuthor = '';

    const paintBackground = () => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, CELL_WIDTH, CELL_HEIGHT);
    };

    // A quiet, gallery-label credit pinned to the bottom of every cell so
    // passers-by can see who wrote it without it competing with the word.
    // Drawn under the same anamorphic compression so it stays proportional
    // once the exhibition monitors stretch the frame back out.
    const drawCaption = () => {
      if (!captionTitle && !captionAuthor) return;
      // letterSpacing is a modern-Chrome canvas property; the render runs in a
      // recent headless Chromium, but keep the cast so the build stays happy.
      const c = ctx as CanvasRenderingContext2D & { letterSpacing: string };

      ctx.save();
      ctx.translate(CELL_WIDTH / 2, CELL_HEIGHT);
      ctx.scale(ANAMORPHIC_SCALE_X, 1); // bake in horizontal compression
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // Widest a line may be drawn before the anamorphic squeeze; keeps the
      // credit inside a comfortable margin.
      const budget = (CELL_WIDTH * 0.84) / ANAMORPHIC_SCALE_X;

      const fitFont = (base: number, min: number, text: string, font: string) => {
        c.font = font.replace('{px}', String(base));
        const w = c.measureText(text).width;
        return w > budget ? Math.max(min, Math.floor((base * budget) / w)) : base;
      };

      const author = captionAuthor.toUpperCase();
      const authorFont = captionAuthor
        ? (c.letterSpacing = '3px', fitFont(23, 12, author, `{px}px ${CAPTION_SANS}`))
        : 0;
      c.letterSpacing = '0px';
      const titleFont = captionTitle
        ? fitFont(31, 15, captionTitle, `italic {px}px ${CAPTION_SERIF}`)
        : 0;

      const bottomPad = 48;
      if (captionAuthor) {
        c.letterSpacing = '3px';
        c.font = `${authorFont}px ${CAPTION_SANS}`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(author, 0, -bottomPad);
        c.letterSpacing = '0px';
      }
      if (captionTitle) {
        c.font = `italic ${titleFont}px ${CAPTION_SERIF}`;
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.fillText(captionTitle, 0, -bottomPad - authorFont - 16);
      }
      ctx.restore();
    };

    // Per-character layout + visual params, mirroring the production
    // `velocireader-focus-slant` display plugin (luma-weight anchoring +
    // focus compression + anchored slant). CSS transforms are visual-only and
    // do NOT affect the inline-block layout advance, so the horizontal advance
    // for each glyph is (naturalWidth + 2*margin); the width/size/skew are
    // painted on top.
    type Glyph = {
      ch: string;
      weight: number;
      opacity: number;
      widthScale: number;
      sizeScale: number;
      slant: number;
      natural: number;
      center: number;
    };

    const layoutWord = (word: string, fontPx: number) => {
      const chars = Array.from(word);
      const len = chars.length;
      const orp = getVelocireaderORPIndex(word);

      const glyphs: Glyph[] = chars.map((ch, i) => {
        const weight = getFontWeight(i, orp, len);
        ctx.font = `${weight} ${fontPx}px ${FONT_STACK}`;
        return {
          ch,
          weight,
          opacity: getLuminance(i, orp, len) / 100,
          widthScale: getFocusCharWidth(i, orp, len) / 100,
          sizeScale: getFocusFontSizeScale(i, orp, len),
          slant: getAnchoredSlantAngle(i, orp),
          natural: ctx.measureText(ch).width,
          center: 0,
        };
      });

      let cursor = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      // Compute advances/centers using per-index margin.
      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];
        const margin = getFocusMargin(i, orp);
        const boxLeft = cursor + margin;
        g.center = boxLeft + g.natural / 2;
        cursor += g.natural + 2 * margin;

        const skewRad = (Math.abs(g.slant) * Math.PI) / 180;
        const halfVisual =
          (g.natural * g.widthScale * g.sizeScale) / 2 +
          fontPx * g.sizeScale * 0.5 * Math.tan(skewRad);
        minX = Math.min(minX, g.center - halfVisual);
        maxX = Math.max(maxX, g.center + halfVisual);
      }

      const visualWidth = maxX - minX;
      const visualCenter = (minX + maxX) / 2;
      return { glyphs, visualWidth, visualCenter };
    };

    const drawWord = (word: string) => {
      paintBackground();

      if (isPauseToken(word)) {
        // Pause tokens render as a dim em-dash (matches the plugin).
        ctx.save();
        ctx.translate(CELL_WIDTH / 2, CELL_HEIGHT / 2);
        ctx.scale(ANAMORPHIC_SCALE_X, 1);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `300 ${BASE_FONT_PX}px ${FONT_STACK}`;
        ctx.fillText('\u2014', 0, 0);
        ctx.restore();
      } else if (word) {
        // Shrink to fit the anamorphically-compressed cell width.
        let fontPx = BASE_FONT_PX;
        let layout = layoutWord(word, fontPx);
        const maxScaledWidth = CELL_WIDTH * 0.9;
        while (layout.visualWidth * ANAMORPHIC_SCALE_X > maxScaledWidth && fontPx > 40) {
          fontPx -= 8;
          layout = layoutWord(word, fontPx);
        }

        ctx.save();
        ctx.translate(CELL_WIDTH / 2, CELL_HEIGHT / 2);
        ctx.scale(ANAMORPHIC_SCALE_X, 1); // bake in horizontal compression
        ctx.translate(-layout.visualCenter, 0); // center the whole word block
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const g of layout.glyphs) {
          ctx.save();
          ctx.globalAlpha = g.opacity;
          ctx.translate(g.center, 0);
          // Match CSS `transform: skewX(-slant) scaleX(width) scale(size)`.
          const skewRad = (-g.slant * Math.PI) / 180;
          ctx.transform(1, 0, Math.tan(skewRad), 1, 0, 0);
          ctx.scale(g.widthScale, 1);
          ctx.scale(g.sizeScale, g.sizeScale);
          ctx.font = `${g.weight} ${fontPx}px ${FONT_STACK}`;
          ctx.fillStyle = TEXT_COLOR;
          ctx.fillText(g.ch, 0, 0);
          ctx.restore();
        }
        ctx.restore();
      }

      // The credit sits on top of the cleared background every frame.
      drawCaption();
    };

    const finish = (chunks: Blob[], mimeType: string) => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2000);
      setStatus(`done: ${(blob.size / 1e6).toFixed(1)} MB`);
      setState('done');
    };

    const run = (words: string[]) => {
      if (cancelled) return;
      const mimeType = pickMimeType();
      let stream: MediaStream;
      try {
        stream = canvas.captureStream(fps);
      } catch (e) {
        setStatus('error: captureStream failed');
        setState('error', String(e));
        return;
      }

      const chunks: Blob[] = [];
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      } catch (e) {
        setStatus('error: MediaRecorder failed');
        setState('error', String(e));
        return;
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => finish(chunks, mimeType);

      let index = Math.min(words.length - 1, Math.floor(words.length * startFraction));
      // Paint the first frame before recording starts (avoid a black lead-in).
      drawWord(words[index] || '');

      const speedFactor = getSpeedFactor(wpm);
      const baseInterval = 60000 / wpm;
      const tFloor = 75 * speedFactor;

      let accumulator = 0;
      let lastTime = performance.now();
      const startTime = lastTime;

      const stop = () => {
        if (rafId) cancelAnimationFrame(rafId);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      };

      const loop = (time: number) => {
        if (cancelled) return;
        const elapsed = time - startTime;
        if (elapsed >= duration * 1000) {
          stop();
          return;
        }

        accumulator += time - lastTime;
        lastTime = time;
        if (accumulator > Math.max(1000, baseInterval * 10)) accumulator = baseInterval;

        // Advance as many words as fit into the accumulated time budget.
        // Loop back to the start when the book ends so the full duration fills.
        while (true) {
          const word = words[index] || '';
          const visualDelay = getVisualProcessingDelay(word, speedFactor);
          const targetInterval = tFloor + baseInterval + visualDelay;
          if (accumulator < targetInterval) break;
          accumulator -= targetInterval;
          index = (index + 1) % words.length;
          drawWord(words[index] || '');
        }

        rafId = requestAnimationFrame(loop);
      };

      recorder.start();
      setStatus('recording');
      setState('recording');
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
      // Safety backstop in case rAF is throttled.
      stopTimer = window.setTimeout(stop, duration * 1000 + 500);
    };

    if (!book) {
      setState('error', 'missing book param');
      return;
    }

    fetch(`/exhibition-texts/${book}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${book}.json`);
        return r.json();
      })
      .then(async (words: unknown) => {
        if (!Array.isArray(words) || words.length === 0) {
          throw new Error('empty or invalid word array');
        }
        // Best-effort metadata lookup for the credit line; never blocks render.
        try {
          const idx = await fetch('/exhibition-texts/index.json');
          if (idx.ok) {
            const manifest = await idx.json();
            const meta = Array.isArray(manifest?.books)
              ? manifest.books.find((b: { id?: string }) => b.id === book)
              : undefined;
            if (meta) {
              captionTitle = typeof meta.title === 'string' ? meta.title : '';
              captionAuthor = typeof meta.author === 'string' ? meta.author : '';
            }
          }
        } catch {
          /* caption is optional; carry on without it */
        }
        run(words as string[]);
      })
      .catch((e) => {
        setStatus(`error: ${e.message}`);
        setState('error', e.message);
        paintBackground();
      });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stopTimer) clearTimeout(stopTimer);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000000',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* The canvas holds the anamorphically pre-compressed frame that is
          captured verbatim into the recording. It is displayed at native 1280x1080. */}
      <canvas
        ref={canvasRef}
        width={CELL_WIDTH}
        height={CELL_HEIGHT}
        style={{ width: CELL_WIDTH, height: CELL_HEIGHT, background: '#000' }}
      />
      <div
        data-testid="exhibition-status"
        style={{
          position: 'fixed',
          bottom: 8,
          left: 8,
          fontFamily: 'monospace',
          fontSize: 11,
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        {status}
      </div>
    </div>
  );
}

export default ExhibitionRender;
