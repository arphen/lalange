# TTS Optimization Phase 2: Validation And Follow-Up

## Status

- Date: 2026-08-09
- Machine: MacBook Pro `Mac15,3`, Apple M3, 8 CPU cores, 10 GPU cores,
  16 GB memory
- Browser used for application traces: VS Code Electron 42.6 / Chromium 148
- Standalone browsers available for the next energy run: Google Chrome and
  Brave
- Measured revision: `3d12a85-dirty`
- Input: Luna's implementation of the Phase 1 recommendations in
  `PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PLAN.md`
- Scope: validate the implementation, remove the remaining low-risk runtime
  churn, and define the next evidence gate without reducing speech quality

## Executive Conclusion

Luna's implementation fixed the largest confirmed application-owned hotspot.
The production TTS settings key went from 4,707 synchronous writes during a
16.6-second startup and playback trace to zero writes during a longer
48.5-second confirmation trace.

This follow-up found and fixed three adjacent issues:

1. The TTS controls still subscribed to each spoken word and generated
   sentence solely to persist a handoff every two seconds.
2. Lookahead generation and audible playback both wrote `currentSentence`, so
   a saved handoff could combine an audible word with a sentence several items
   ahead in the generation queue.
3. The audio player still emitted lifecycle and queue diagnostics, including
   one production log per generated sentence.

The final production confirmation recorded zero settings writes, no player
debug logs, and no invalid-audio fallback. Desktop Kokoro remains FP32 WebGPU
at 24 kHz with the same voice, sentence boundaries, validation, trimming,
serial inference, and Web Audio scheduling.

This pass does **not** claim a measured reduction in package or GPU energy.
Application churn is lower, but macOS energy counters were not available in the
current environment. The next backend decision still requires a standalone
browser Energy Log or privileged `powermetrics` run.

## Luna Implementation Audit

### Confirmed Complete

- Settings persistence is driven by an equality-checked settings selector
  instead of every runtime store update.
- Existing `xyz-tts-settings` data still hydrates through the compatibility
  path.
- Kokoro and Piper use one shared progress reporter with duplicate suppression,
  quantized progress, a 10 Hz ceiling, and immediate terminal updates.
- TTS controls use a shallow selector rather than subscribing to the complete
  store.
- Routine TTS UI progress, generation, queue, and lifecycle logs were removed.
- Tests cover unchanged-runtime persistence, one write per settings action,
  legacy hydration, bounded progress, and immediate terminal states.

### Incomplete Or Deferred

- No checked-in opt-in TTS profiler or fixed real-model corpus was found.
- No application hook currently selects WebGPU `high-performance` versus
  `low-power` adapter preference.
- No controlled package-energy, GPU-energy, or thermal-pressure run has been
  completed.
- Buffering remains sentence-count based. There is not yet evidence that an
  audio-time horizon would reduce total energy rather than merely reshape the
  same inference work.

## Production Measurements

The original and post-Luna traces used the same production origin so cached
model and library state could be reused. Trace lengths differ, so storage and
logging are valid behavioral comparisons; long-task totals are not normalized
energy comparisons.

| Signal | Original baseline | After Luna | Final follow-up |
| --- | ---: | ---: | ---: |
| Trace duration | 16.6 s | 48.5 s | 21.885 s |
| `xyz-tts-settings` writes | 4,707 | 0 | 0 |
| Settings bytes serialized | 578,961 | 0 | 0 |
| Production TTS logs | Unbounded progress and queue output | 14 | 1 |
| `[TTS Player]` logs | Present | Present | 0 |
| Invalid-audio fallback | 0 | 0 | 0 |
| Resolved runtime | FP32 WebGPU | FP32 WebGPU | FP32 WebGPU |

The one retained final log is the intended runtime summary:

```text
[TTS] Kokoro initialized: fp32 on webgpu
```

The final trace included cached model/session initialization and about seven
seconds of audible playback before pause. It observed six browser long tasks,
1,535 ms total, with a 930 ms maximum. The run was too short and too integrated
with VS Code to attribute those tasks to a thermal outcome. Model/session
startup remains a profiling target, not a regression conclusion.

## Follow-Up Changes

### 1. Sample Handoff Position Without Word Subscriptions

`TTSPlayer` now reads sentence, word, and audio time directly from the store on
a two-second timer while active and once immediately on pause. It no longer
subscribes React rendering to `currentWordIndex` or `currentSentence`.

This preserves the existing handoff cadence and payload while avoiding a
control-panel render for every spoken word or generated sentence. The visible
clock remains at the existing 5 Hz publication rate.

### 2. Make Playback The Position Owner

`streamSpeech` no longer writes `currentSentence` when lookahead generation
starts. The audio player is now the sole owner of the audible sentence, word,
and clock tuple.

This is both a redundant-update removal and a correctness fix. With five
sentences generated ahead, generation could previously publish sentence `N+5`
while playback was still speaking sentence `N`. A handoff sampler could then
save internally inconsistent position fields.

### 3. Gate Player Diagnostics

Routine player queue, waiting, playback, pause, stop, and disposal diagnostics
now use a development-only logger. Warnings and errors remain in production,
as does the single resolved Kokoro runtime summary.

## Validation

The complete focused suite passed after the follow-up:

```text
Test Files  11 passed (11)
Tests       163 passed (163)
```

The suite covers:

- TTS settings persistence and legacy hydration;
- shared progress coalescing;
- Kokoro and Piper initialization;
- engine routing and generation ownership;
- sample validation and silence trimming;
- sentence boundaries;
- queueing, scheduling, pause, resume, and cancellation;
- direct-store handoff persistence on pause; and
- TTS control and Reader synchronization behavior.

`npm run build` also passed, including TypeScript, Vite, PWA service-worker
generation, prerendering, and route validation. VS Code reported no diagnostics
in the five directly changed source and test files checked before the full
suite.

## Quality-Preservation Check

This follow-up does not alter any speech-producing input or audio operation:

- desktop dtype remains FP32;
- iOS retains its existing Q8 memory fallback;
- sample rate remains 24 kHz mono;
- selected voice and speed semantics are unchanged;
- authored sentence boundaries remain unchanged;
- inference remains serial;
- audio validation and stable fallback remain enabled;
- edge-silence trimming remains unchanged; and
- Web Audio clock scheduling and queue bounds remain unchanged.

No waveform comparison is required for these state and logging changes because
the model call, text, options, samples, and scheduling path are untouched. The
existing audio and sentence regression tests still pass.

## Phase 2 Energy Experiment

### Environment Blocker

Both `xctrace` and `powermetrics` exist on the machine, but neither supplied an
energy trace in this session:

- `xctrace` refused to run because the active developer directory is the
  Command Line Tools installation rather than full Xcode.
- `powermetrics` normally requires elevated privileges, which are deliberately
  not requested through the coding-agent terminal.

Install or select full Xcode and use Instruments Energy Log, or run
`powermetrics` manually with administrator authorization. Until then, browser
long tasks, CPU snapshots, and subjective heat are useful clues but not energy
acceptance metrics.

### Controlled Run

Use a standalone production browser, not the VS Code integrated browser:

1. Build and serve the app on the same COOP/COEP-enabled origin.
2. Launch Chrome or Brave with a dedicated profile and extensions disabled.
3. Prime the model once before warm tests; use a fresh profile only for cold
   cache tests.
4. Hold charger state, display brightness, volume, voice, speed, corpus, and
   browser version constant.
5. Record two minutes idle, ten minutes TTS, and two minutes recovery.
6. Capture package energy, GPU energy, thermal pressure, generated audio
   duration, inference wall time, RTF, first-audio latency, and underruns.
7. Repeat each condition at least three times and compare median and spread.

Test FP32 conditions in this order:

| Condition | Purpose |
| --- | --- |
| WebGPU `high-performance` | Current baseline |
| WebGPU `low-power` | Test whether adapter policy lowers energy |
| WASM, current thread policy | CPU fallback comparison |
| WASM, two threads | Lower-concurrency comparison |
| WASM, one thread | Diagnostic lower-power bound |

Add adapter and thread overrides only behind the profiling path. Recreate the
model session between conditions and verify the resolved runtime in every
result.

### Decision Gate

Do not change the production backend unless a candidate meets all of these:

- at least 15% lower median total energy per generated audio minute;
- warm RTF and time to first audio regress by no more than 5%;
- no additional underruns or sentence gaps;
- no increase in invalid-audio fallback;
- no quality-gate failure; and
- the result reproduces on more than one hardware class.

If no candidate passes, retain FP32 WebGPU `high-performance`. The existing M3
benchmark showed warm WebGPU synthesis approximately 2.1 to 2.3 times faster
than FP32 WASM, so lower instantaneous GPU activity would not by itself prove
lower total energy.

## Recommended Next Work

1. Add the opt-in bounded profiler and fixed public-domain corpus that remained
   incomplete from Phase 0.
2. Capture standalone-browser energy for WebGPU adapter preference and WASM
   thread counts.
3. Keep the current backend unless the energy decision gate passes.
4. Only then test an audio-time buffer horizon against the current fixed
   sentence count.
5. Reject buffering changes that preserve the same total energy and only move
   the heat in time.

The next meaningful result is an energy-per-audio-minute table, not another
backend guess. The application-owned storage, subscription, state-ownership,
and production-log amplification identified so far are now removed without a
speech-quality tradeoff.