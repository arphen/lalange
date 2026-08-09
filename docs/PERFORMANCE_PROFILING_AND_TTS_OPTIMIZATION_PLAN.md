# Performance Profiling And No-Quality-Loss TTS Optimization Plan

## Status

- Prepared: 2026-08-09
- Profiling machine: MacBook Pro `Mac15,3`, Apple M3, 8 CPU cores
  (4 performance and 4 efficiency), 10 GPU cores, 16 GB memory
- Browser used for controlled runs: VS Code Electron 42.6 / Chromium 148
- Measured revision: `3d12a85-dirty`
- Intended implementation owner: Luna
- Scope of this pass: profile, identify likely causes, and define an execution
  plan. No runtime optimization is included in this document change.

## Objective

Make the application, and local TTS in particular, use less energy and produce
less heat without changing speech quality or weakening the reading experience.

For this plan, **no quality loss** means:

- keep Kokoro FP32 on desktop;
- retain the existing iOS-only Q8 memory fallback;
- keep the selected voice, 24 kHz sample rate, speed semantics, authored
  sentence boundaries, sentence-final prosody, and silence-trimming behavior;
- do not introduce new underruns, sentence gaps, startup regressions, or visible
  reader desynchronization; and
- reject an optimization if an output or listening comparison detects a speech
  regression.

## Executive Conclusion

Kokoro is already using the GPU on supported desktop browsers. On the measured
M3 machine, steady FP32 WebGPU synthesis was about 2.1 to 2.3 times faster than
FP32 WASM for the same text and audio duration. Switching the default to WASM
would move work to the CPU and keep the machine active for longer; it is not a
promising first thermal optimization.

The first pass should instead remove two confirmed sources of avoidable
main-thread work:

1. Every TTS runtime state update is currently written to `localStorage`, even
   though the persisted payload contains only unchanged settings.
2. Model loading can emit thousands of progress callbacks. Each callback
   updates the store, rewrites the settings payload, rerenders the TTS controls,
   and logs to the console.

The Reader's steady playback integration is otherwise in good shape. It avoids
React state updates for every spoken word, redraws the context rivers once per
second, publishes the audio clock at 5 Hz, pre-schedules contiguous Web Audio
sources, bounds its queue, and synthesizes sentences serially.

After removing the confirmed churn, measure actual package and GPU energy before
changing backend selection or buffering. The most useful GPU experiment is
`high-performance` versus `low-power` adapter preference with the same FP32
model. It must be decided by energy per minute of generated audio, not by GPU
utilization alone.

## Current Architecture

The active English TTS path is:

```text
TTSPlayer
  -> splitIntoSentences
  -> initTTS
  -> initKokoro (FP32 WebGPU on desktop when available)
  -> streamSpeech (serial sentence loop)
  -> KokoroTTS.generate
  -> validate and trim samples
  -> TTSAudioPlayer queue
  -> Web Audio clock scheduling
  -> throttled clock and word-position updates
  -> imperative Reader RSVP update
```

Important code anchors:

- `src/components/Reader/TTSPlayer.tsx:119-149` subscribes the controls to the
  complete TTS store.
- `src/components/Reader/TTSPlayer.tsx:325-399` initializes playback and fills
  the first sentence buffer.
- `src/components/Reader/TTSPlayer.tsx:401-447` refills the rolling buffer.
- `src/core/tts/kokoro.ts:169-247` resolves the runtime and initializes Kokoro.
- `src/core/tts/kokoro.ts:216-226` forwards every model progress event to the
  Zustand store.
- `src/core/tts/kokoro.ts:327-382` runs, validates, and trims one synthesis.
- `src/core/tts/engine.ts:196-232` synthesizes sentences serially.
- `src/core/tts/player.ts:13-15` bounds buffers and sets the 5 Hz clock update.
- `src/core/tts/player.ts:522-560` tracks audio time and spoken words.
- `src/core/store/tts.ts:76-154` wraps both settings and runtime fields in one
  persisted Zustand store.
- `src/components/Reader/Reader.tsx:1643-1662` samples both context rivers once
  per second during TTS.
- `src/components/Reader/Reader.tsx:2784-2794` updates the center RSVP display
  without rebuilding the context rivers for every spoken word.

Dependency behavior also matters:

- Transformers.js serializes browser inference through one global promise chain
  (`node_modules/@huggingface/transformers/src/backends/onnx.js:169-184`).
- Transformers.js sets WebGPU to `high-performance` by default
  (`node_modules/@huggingface/transformers/src/backends/onnx.js:221-224`).
- ONNX Runtime defaults WASM to one thread without cross-origin isolation and
  otherwise to at most four threads
  (`node_modules/@huggingface/transformers/node_modules/onnxruntime-web/lib/backend-wasm.ts:37-55`).
- The application serves COOP and COEP headers locally and in production, so
  the measured WASM run could use the normal multithreaded path.

## Profiling Method

The profiling pass used three complementary views.

### 1. Static Runtime Trace

The code path was traced from the React control through model initialization,
serial generation, queue refill, audio scheduling, Zustand updates, and Reader
DOM synchronization. Kokoro, Transformers.js, and ONNX Runtime defaults were
checked where they affect providers, thread count, or power preference.

### 2. Controlled Synthesis Benchmark

Three fixed English samples were generated with:

- voice: `af_heart`;
- speed: `1.0`;
- dtype: FP32;
- identical input text for WebGPU and WASM; and
- output validation and the application's normal edge-silence trimming enabled.

For each sample the run recorded wall time, output duration, real-time factor,
sample count, RMS, peak amplitude, heap delta, and browser long tasks.

Real-time factor is:

```text
RTF = synthesis wall time / generated audio duration
```

An RTF below `1.0` means synthesis is faster than playback.

### 3. End-To-End Reader Trace

The bundled demo book was played through the real Reader and TTS controls. The
trace recorded model and queue logs, long tasks, heap, DOM mutation counts by
surface, TTS store transitions, and calls to `Storage.setItem`.

The production confirmation used `npm run build` and `npm run preview` on the
same origin so the cached FP32 model and demo library were reused.

## Measurements

### Runtime Capability

| Item | Observed value |
| --- | --- |
| Logical CPU cores exposed to Chromium | 8 |
| Browser memory hint | 16 GB |
| Cross-origin isolated | Yes |
| WebGPU adapter available | Yes |
| WebGPU timestamp queries | Supported |
| Maximum WebGPU buffer size | About 4 GB |
| macOS thermal warning during the run | None recorded |

The adapter did not expose identifying information in this Electron build. The
hardware is the integrated 10-core Apple M3 GPU.

### Initialization

| Scenario | Time | Interpretation |
| --- | ---: | --- |
| Empty browser model cache, FP32 WebGPU | 32.90 s | Includes the roughly 326 MB model transfer and session creation |
| Cached FP32 WebGPU production start | About 1.50 s | IndexedDB/cache read plus session creation |
| Cached switch to FP32 WASM | 0.83 s | Session creation from the cached model |

Cold network initialization is not a steady performance number. It is useful
for finding progress and startup churn, not for comparing inference providers.

### Controlled FP32 Synthesis

| Words | Audio | WebGPU wall | WebGPU RTF | WASM wall | WASM RTF |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 3.675 s | 3.181 s | 0.866 | 2.041 s | 0.555 |
| 17 | 7.540 s | 1.826 s | 0.242 | 3.689 s | 0.489 |
| 44 | 18.140 s | 3.789 s | 0.209 | 8.636 s | 0.476 |

The first WebGPU sentence includes provider warm-up and shader compilation. On
the two representative warm samples, WebGPU was 2.02 to 2.28 times faster than
WASM. Direct inference produced no browser long tasks in either backend.

Both backends returned the exact same sample count and duration for each input.
RMS differed by less than `0.05%` on the two longer samples. Peak amplitude was
close but not bit-identical, as expected from provider floating-point behavior.
This is a useful smoke check, not a substitute for the quality gate below.

### Steady Reader Playback

A 20-second rolling-playback window after initialization observed:

| Signal | Result |
| --- | ---: |
| Sentences generated and queued | 3 |
| Invalid-audio fallbacks | 0 |
| Long tasks | 3 |
| Long-task total | 230 ms |
| Longest long task | 85 ms |
| Heap delta | +1.2 MB |
| Top context-river mutation batches | 20 |
| Bottom context-river mutation batches | 20 |
| TTS panel mutation records | 136 |
| Center RSVP mutation records | 301 |

One observed refill generated 8.54 seconds of audio in 1.84 seconds, an RTF of
about `0.215`. The context-river counts exactly match their intended 1 Hz
sampler. Mutation records are not React commit counts, but they show that the
large context surfaces are not being rebuilt per word.

This steady UI trace ran while the integrated browser reported itself hidden,
so requestAnimationFrame cadence from that run was discarded. Audio, store,
queue, storage, and timer measurements remained usable.

### Confirmed Store And Persistence Amplification

During 12 seconds of steady playback:

| Signal | Count |
| --- | ---: |
| TTS store updates | 125 |
| Writes to `xyz-tts-settings` | 125 |
| Serialized characters written | 15,375 |
| `currentTime` changes | 60 |
| `currentWordIndex` changes | 38 |
| `isGenerating` changes | 6 |
| `duration` changes | 3 |
| `currentSentence` changes | 6 |
| `currentPosition` changes | 6 |

No setting changed during this window. Zustand `partialize` limits what is
serialized, but it does not limit when persistence runs. Runtime updates still
cause synchronous writes of the same settings object.

The production startup trace made this effect more visible. A cached WebGPU
initialization and 15 seconds of playback produced:

| Signal | Result |
| --- | ---: |
| Writes to `xyz-tts-settings` | 4,707 |
| Serialized characters written | 578,961 |
| Sentences generated and queued | 9 |
| Invalid-audio fallbacks | 0 |
| Long tasks | 3 |
| Long-task total | 780 ms |
| Longest long task | 661 ms |

Most startup writes were driven by model progress events emitted while cached
weights were expanded. The same events also updated React state and produced a
large volume of production console logging.

### Coarse Process Snapshot

While production TTS was active, VS Code renderer and helper processes were each
using substantial CPU in a point-in-time `ps` sample. Copilot, the integrated
browser, extensions, the GPU process, and the editor share those helpers, so the
sample cannot attribute a reliable percentage to TTS and is deliberately not
used as an acceptance baseline.

`pmset -g therm` reported no thermal or performance warning. Actual package
power, GPU energy, fan state, and chassis temperature were not available without
a dedicated Instruments or privileged `powermetrics` run. The execution plan
must collect those values before claiming a thermal improvement.

## Findings

### Finding 1: Runtime State Is Persisted At Playback Frequency

**Confidence: confirmed. Priority: P0.**

The persisted middleware wraps a store that also owns clock, word, sentence,
generation, loading, and playback state. Every runtime `set` invokes persistence
after partialization. This produces synchronous storage and serialization work
that has no recovery value because runtime fields are explicitly removed from
the saved payload.

The target behavior is zero settings writes during playback when the user has
not changed a setting.

### Finding 2: Model Progress Is An Unbounded UI And Logging Stream

**Confidence: confirmed. Priority: P0.**

Kokoro forwards every progress event to the store. Cache reads can produce many
events at the same displayed percentage, and the UI only needs a human-scale
status update. In production this amplified into thousands of store updates,
storage writes, React notifications, and console messages during a cached start.

Piper uses a similar progress callback and should receive the same coalescing
policy even though Kokoro was the measured case.

### Finding 3: FP32 WebGPU Is Already Effective

**Confidence: confirmed on Apple M3. Priority: preserve while testing.**

Warm WebGPU RTF was about `0.21-0.24`, versus `0.48-0.49` on WASM. No invalid
audio fallback occurred. ONNX logged that some shape operations remained on the
CPU, which is expected provider behavior and not evidence that the model failed
to use the GPU.

Do not make WASM the desktop default based only on the observation that the GPU
gets hot. Compare total energy per generated audio minute and thermal pressure.

### Finding 4: The TTS Controls Subscribe More Broadly Than They Render

**Confidence: code-confirmed, cost not yet isolated. Priority: P1.**

`TTSPlayer` calls `useTTSStore()` without a selector. It is therefore notified
for word position, handoff position, clock, generation, and settings updates.
Only a subset is needed to render the controls. `useFormattedTime` also creates
separate clock and duration subscriptions.

This was not a large long-task source in steady playback, but narrowing the
subscription is low risk after persistence and progress are fixed.

### Finding 5: Fixed Sentence Count Shapes Startup Bursts

**Confidence: code-confirmed, thermal effect unmeasured. Priority: experiment.**

The default target is five sentences ahead, while sentence audio duration varies
widely. The player starts after the first sentence but generation continues
until the initial target is filled. A chapter with many short sentences causes
many calls and progress transitions; a chapter with long sentences can prepare
far more audio than needed.

Changing the buffer does not remove model compute. It can only alter burst
shape, memory, and underrun margin. Replace sentence count with an audio-time
horizon only if energy and underrun measurements support it.

### Finding 6: Existing Playback Work Should Be Preserved

**Confidence: confirmed. Priority: regression guard.**

The current implementation already includes several important optimizations:

- serial inference, avoiding unsupported concurrent ONNX session execution;
- one in-flight generator and cancellation guards;
- Web Audio clock scheduling across all contiguous queued sentences;
- a queue cap with cleanup behind the current sentence;
- 5 Hz displayed-clock publication while retaining frame-accurate audio time;
- word-state updates only when the estimated spoken word changes;
- imperative center-word rendering without per-word React Reader state;
- 1 Hz context-river refresh during TTS;
- edge-silence trimming without changing authored sentence boundaries; and
- automatic invalid-audio validation and stable FP32 WASM fallback.

These are constraints for the optimization, not surfaces to rewrite casually.

## Execution Plan For Luna

### Phase 0: Land A Reproducible Profiler

Add a profiling mode before changing model or scheduling behavior. It should be
off by default, keep a bounded in-memory record, and export or print one compact
summary at the end of a run.

Record at minimum:

- revision, browser, OS, hardware concurrency, memory hint, and visibility;
- voice, speed, backend, dtype, cache state, and adapter preference;
- initialization time split into library load, model read, session creation,
  and first inference warm-up where the dependency permits it;
- sentence characters, words, generation wall time, output duration, and RTF;
- queue depth in seconds and sentences, refill requests, and underruns;
- invalid-output fallback count;
- TTS store updates, settings writes, and progress updates;
- long tasks, JS heap, and memory slope; and
- external CPU package energy, GPU energy, and thermal pressure for controlled
  energy runs.

Use User Timing marks around `initKokoro`, `generateValidatedAudio`, queueing,
and first audible playback. Do not emit a console line for every progress chunk
or animation update.

Create a manual real-model benchmark that is excluded from normal CI. It should
use a fixed public-domain corpus containing short, medium, long, punctuated, and
quoted sentences. Separate cold cache, warm session, and steady playback runs.

#### Phase 0 Acceptance

- The same corpus produces comparable JSON summaries across runs.
- Warm-up is reported separately from steady inference.
- Profiling disabled has negligible work and no console noise.
- The profiler never persists generated text or audio without an explicit local
  export action.

### Phase 1: Remove Confirmed Main-Thread Churn

#### 1A. Separate Runtime State From Settings Persistence

Choose one of these repository-compatible designs:

1. split persisted TTS settings and transient playback state into separate
   Zustand stores; or
2. retain one public store but replace middleware-wide persistence with an
   equality-checked subscription that writes only when the selected settings
   object changes.

Persist only:

- voice;
- backend preference;
- buffer target;
- autoplay;
- volume; and
- speed.

Do not persist loading, progress, readiness, generation, sentence, word, clock,
duration, playback, error, or handoff position through the settings key.

Keep backward-compatible hydration from `xyz-tts-settings`, including removal
of the obsolete `quantization` field.

#### 1B. Coalesce Model Progress

Implement one shared Kokoro/Piper progress policy:

- publish when the displayed file or status changes;
- publish when the quantized percentage advances;
- rate-limit repeated events to at most 10 Hz;
- always publish terminal success and error states immediately; and
- suppress duplicate percentage/status pairs.

Gate verbose per-sentence and per-progress console logging behind a local debug
flag or development mode. Keep warnings, errors, fallback messages, and the
single resolved runtime summary in production.

#### 1C. Narrow TTS React Subscriptions

Use selectors, with shallow comparison where a grouped selector is useful, so
the control panel subscribes only to values it renders. Keep high-frequency word
tracking outside the controls. Avoid subscribing twice to the same clock fields
through both the whole store and `useFormattedTime`.

Do not move the Reader's imperative center-word update back into React state.

#### 1D. Remove Proven Redundant Updates

After instrumentation is present, remove only state writes that set an already
equal value. Candidate areas include nested `setGenerating` ownership and
sentence state published by both generation and playback. Define one owner for
each visible state before deleting a write.

#### Phase 1 Tests

Add deterministic tests that prove:

- 30 seconds of simulated playback with unchanged settings performs zero
  settings writes;
- one settings action produces one persisted update;
- old persisted settings still hydrate and obsolete fields are ignored;
- thousands of synthetic progress events produce a bounded number of visible
  updates and preserve the final `100%`/ready state;
- progress errors are never delayed or dropped;
- TTS controls do not rerender for fields they do not consume; and
- existing queue, cancellation, chapter continuation, sentence boundary,
  silence trim, and Reader synchronization tests remain green.

#### Phase 1 Acceptance

- Zero `xyz-tts-settings` writes during steady playback without a setting
  change.
- At most one persisted write per settings action.
- Cached initialization emits no duplicate visible progress states and no
  unbounded production logging.
- App-owned progress handling introduces no long task over 50 ms.
- No regression in time to first audio, underruns, handoff persistence, or
  speech output.

### Phase 2: Measure Energy And Backend Policy

Run this phase in standalone Chrome or Brave, not inside VS Code, so process
energy can be attributed cleanly. Use the production bundle with COOP/COEP and a
fresh browser profile for cold tests.

For each run:

1. close unrelated heavy applications;
2. hold display brightness, charger state, volume, voice, speed, text, and
   browser version constant;
3. allow the machine to return to a stable idle baseline;
4. record two minutes idle, ten minutes TTS, and two minutes recovery;
5. capture Chrome Performance plus WebGPU/ONNX timing where available;
6. capture Instruments Energy Log or `powermetrics` package/GPU energy and
   thermal pressure; and
7. repeat each condition at least three times and report median and spread.

Test these conditions with FP32 unchanged:

| Experiment | Purpose | Decision rule |
| --- | --- | --- |
| WebGPU `high-performance` | Current baseline | Keep unless another mode lowers energy with no UX regression |
| WebGPU `low-power` | Test adapter/power policy | Adopt only if energy per audio minute improves materially and RTF/underruns pass |
| WASM 4 threads | Current CPU fallback comparison | Do not default unless total energy beats WebGPU |
| WASM 2 threads | Test lower CPU concurrency | Keep only as an optional policy if energy improves without startup or underrun regression |
| WASM 1 thread | Lower-power bound | Diagnostic only unless it remains comfortably faster than playback |

Transformers.js currently assigns `high-performance` before session creation.
Override it only before constructing the Kokoro session, and unload/recreate the
session between adapter-policy runs.

Enable ONNX WebGPU profiling only in diagnostic runs. The measured adapter
supports timestamp queries, so operator-level GPU timing may be available, but
profiling overhead makes it unsuitable as a production default.

#### Phase 2 Acceptance

An energy policy can replace the current default only if all are true:

- at least 15% lower median total energy per generated audio minute across
  repeated ten-minute runs;
- warm RTF and time to first audio regress by no more than 5%;
- no additional underruns or sentence gaps;
- no increase in invalid-audio fallback rate;
- no quality-gate failure; and
- the result holds on more than one hardware class.

If no candidate meets the energy threshold, retain high-performance WebGPU. A
hot GPU that finishes quickly may still consume less total energy than a cooler
CPU running more than twice as long.

### Phase 3: Smooth Generation Without Changing Speech

Only begin scheduling experiments after Phases 1 and 2 establish clean metrics.

#### 3A. Use An Audio-Time Buffer Target

Compare the fixed five-sentence target with a target expressed in estimated or
measured audible seconds. Keep sentence generation atomic. A starting experiment
is one sentence required for startup and 20 to 30 seconds prepared ahead after
playback begins.

Use actual generated durations as soon as they are known. Clamp both sentence
count and buffered seconds so pathological one-word or very long sentences do
not create an unbounded queue.

#### 3B. Avoid Unnecessary Initial Burst Work

Measure whether filling the complete target immediately creates the user's
thermal spike. Compare it with staged refill that preserves an adequate underrun
margin. Do not delay first audio to build a larger buffer.

#### 3C. Keep Serial Inference

Do not parallelize Kokoro sentence calls. Transformers.js already serializes web
inference, and parallel promises would add queueing and memory pressure without
proven throughput. They would also concentrate power rather than reduce total
work.

#### Phase 3 Acceptance

- Zero underruns in a ten-minute corpus run at `0.75x`, `1x`, `1.5x`, and `2x`.
- Time to first audio is no slower than the Phase 1 baseline.
- Queue memory reaches a stable bound.
- Median energy and peak thermal pressure improve; queue reshaping is rejected
  if it merely changes the timing of the same heat.
- Sentence boundaries and output audio remain unchanged.

### Phase 4: Broaden Profiling Beyond TTS

Once the TTS pass is complete, retain the same profiling vocabulary for the
rest of the application. Establish production traces for:

| Workload | Main question |
| --- | --- |
| Archive idle for two minutes | Is there background polling or rendering while nothing changes? |
| Reader paused | Do density, sync, or clock tasks continue unnecessarily? |
| RSVP at 300, 600, and 1,000 WPM | Do frame time and DOM work scale safely with cadence? |
| TTS startup and ten-minute playback | Are energy, storage, queue, and memory stable? |
| EPUB and PDF ingestion | Which parse, OCR, image, or persistence stages dominate? |
| Local AI setup and generation | Are WebGPU sessions co-resident or competing for memory and power? |
| Navigation and chapter changes | Are large components or data sets repeatedly reconstructed? |

Use traces to choose the next optimization. Do not infer app-wide priorities
from TTS alone.

## Quality Gate

Use a checked-in manifest of representative text, not checked-in generated
audio. Include:

- short and long sentences;
- commas, semicolons, dashes, questions, and exclamations;
- straight and curly closing quotation marks;
- paragraph endings;
- numbers, initials, and uncommon names;
- at least two American and two British voices; and
- speeds `0.75`, `1.0`, `1.5`, and `2.0`.

For every optimization candidate:

1. confirm runtime config remains FP32 and 24 kHz on desktop;
2. confirm sentence inputs and boundaries are identical;
3. pass the existing invalid-audio checks;
4. compare sample count and duration against the same-backend baseline;
5. compare RMS, peak, leading/trailing retained padding, and waveform error with
   documented floating-point tolerances;
6. listen blind to a representative subset on headphones; and
7. reject the candidate on any repeatable cadence, pronunciation, prosody,
   clipping, gap, or synchronization regression.

Backend floating-point output need not be bit-identical, but an optimization
that does not intentionally alter the model should have no audible difference.

## Explicit Non-Goals For The First Pass

Do not use these as early thermal fixes:

- Q8 or lower precision on desktop;
- lower sample rate;
- arbitrary word-count chunks that alter Kokoro sentence-final prosody;
- concurrent sentence inference;
- defaulting all desktop users to WASM;
- disabling validation or silence trimming;
- moving WebGPU inference to a worker without evidence that it lowers energy;
- persistent generated-audio caching before storage and invalidation costs are
  understood; or
- broad Reader rewrites while its measured context update rate is already low.

WASM proxying may improve responsiveness on a CPU fallback, but moving work to a
worker does not remove the compute or prove an energy reduction.

## Recommended Delivery Order

1. Profiling marks and reproducible real-model benchmark.
2. Settings/runtime persistence separation.
3. Progress coalescing and production log cleanup.
4. Narrow TTS store selectors and remove measured redundant writes.
5. Production regression and quality baseline.
6. External energy runs for WebGPU power preference and WASM thread counts.
7. Audio-time buffer experiment if startup bursts remain thermally significant.
8. Broader application workload matrix.

Each item should land separately with its own measurements. Do not combine a
backend change, scheduling change, and state-management rewrite in one result;
that would make quality, energy, and rollback attribution ambiguous.

## Luna Handoff Checklist

- [ ] Reproduce the baseline on the target browser and record the exact revision.
- [ ] Add the opt-in profiler and fixed corpus before optimizing.
- [ ] Add storage-call assertions around the TTS settings key.
- [ ] Separate settings persistence from runtime updates.
- [ ] Coalesce Kokoro and Piper progress events.
- [ ] Remove production progress/per-sentence log floods.
- [ ] Narrow React subscriptions without changing Reader word synchronization.
- [ ] Run focused Vitest tests in non-interactive mode.
- [ ] Run `npm run build`.
- [ ] Run the real-model production benchmark with cold and warm cache states.
- [ ] Run the quality gate before and after every backend or scheduling change.
- [ ] Capture standalone-browser energy and thermal measurements.
- [ ] Record accepted and rejected experiments in this document or a dated
  companion report.

## Final Decision Rule

The first implementation is successful if it removes storage/progress churn and
reduces measured energy or thermal pressure while preserving the current audio,
startup, buffering, and Reader synchronization experience.

Lower utilization is not the goal by itself. The decision metric is lower total
energy for the same high-quality listening minute, with no detectable quality or
interaction regression.