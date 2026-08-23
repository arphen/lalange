# Rendering And Services Architecture Performance Plan

## Status

- Prepared: 2026-08-11
- Scope: architecture and performance analysis only
- Implementation status: partially landed; architecture follow-up remains
- Reviewed against `main` at `cfa2c76` on 2026-08-23
- Primary runtime surface: `src/components/Reader/Reader.tsx`
- Related surfaces: RSVP display plugins, TTS, AI/ingest, library read models,
  sync, exchange, and progress reporting

## Current Reality

The following foundations from this plan now exist and have focused tests:

- `src/core/reader/controller.ts` provides a session-scoped semantic controller.
- `src/components/Reader/contextWindowProjector.ts` provides structured,
  incremental context projection.
- `src/components/Reader/readerBenchmark.ts` and its tests provide a
  deterministic reader baseline.
- `src/core/rsvp/display/model.ts` projects display models with DOM text nodes.
- `src/core/operations/progressReporter.ts` provides throttled operation
  progress for AI, ingest, and related long-running work.

The Reader still contains substantial orchestration and paired refs/state, so
the ownership refactor described below is not complete. The structured display
model is an available path, not proof that every display plugin has migrated.
Fresh browser measurements are still required before changing scheduling,
subscription, or service-lifetime decisions.

## Executive Conclusion

The application is not fundamentally broken, and several important performance
decisions are already sound. In particular, the Reader avoids a React render for
every RSVP frame, the playback loop sleeps with `setTimeout` before using
`requestAnimationFrame` for final timing, TTS uses a bounded audio queue, and
TTS model progress is throttled and deduplicated.

The architecture has nevertheless crossed a complexity threshold. The central
problem is not the absence of one large service. It is unclear ownership across
four different kinds of state:

1. high-frequency reading position;
2. low-frequency React UI state;
3. long-running operation progress;
4. persisted application state.

`Reader.tsx` currently coordinates all four while also loading data, managing
transitions, handling input, scheduling playback, building HTML, writing the DOM,
and saving progress. Other features independently implement progress callbacks,
polling, cancellation, and lifecycle cleanup. This has produced duplicated clocks,
paired React state and refs, broad subscriptions, repeated DOM construction, and
services whose lifetime is implicit.

The recommended direction is:

- keep the center RSVP lane as an imperative rendering island;
- replace HTML-string display contracts with structured render models and one
  text-safe DOM projector;
- make a Reader session controller the canonical owner of cursor, mode,
  transport, and transition state;
- give RSVP and TTS explicit, mutually exclusive ownership of that cursor;
- publish sampled UI snapshots instead of copying every hot-path update into
  React;
- add a small shared operation reporter for throttling, deduplication,
  cancellation, and terminal states;
- keep reading cursor progress, operation progress, and visual interpolation as
  separate concepts; and
- replace component-level polling and per-card subscriptions with reactive read
  models where measurements show scaling costs.

A universal `ProgressService` should **not** become a global event bus. A shared
operation primitive is warranted, but word-level playback, AI-specific summary
estimation, audio buffering, and transfer protocol details must remain owned by
their domains.

## Evidence And Confidence

This plan is based on a static trace of the current source plus the measurements
already recorded in:

- `docs/PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PLAN.md`;
- `docs/PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PHASE_2.md`; and
- existing Reader and TTS tests.

No new browser performance trace was captured for this planning pass. Findings
below are marked as **confirmed** when the current control flow directly shows the
behavior. Performance impact is marked **to measure** where source inspection
shows repeated work but does not quantify its share of frame time or energy.

At this review, `Reader.tsx` is 3,124 lines and the TTS controls are 852 lines.
File size alone is not a defect, but the Reader's size reflects genuine
responsibility concentration rather than one cohesive algorithm.

## Current Runtime Model

```text
RxDB documents and live queries
  -> React component state and refs
  -> Reader orchestration
       -> playback timing loop
       -> phrase/frame planning
       -> RSVP HTML-string generation
       -> direct DOM writes
       -> context-river HTML rebuilds
       -> React snapshots and overlays
       -> scheduler cursor updates
       -> periodic reading-state persistence

TTS player and Web Audio clock
  -> TTS Zustand runtime store
  -> TTSPlayer callbacks
  -> Reader cursor ref
  -> the same RSVP DOM writer

Ingest scheduler / AI / TTS / sync / exchange
  -> separate progress callbacks or stores
  -> separate component state, timers, and cleanup
```

The data path is workable, but the boundaries do not say which layer is allowed
to advance the cursor, render a frame, interpolate progress, persist state, or
cancel an operation.

## Findings

### P0: The Reader Still Has Split Runtime Ownership

**Partially resolved.** `Reader.tsx` still owns transport state, cursor state, summary mode,
chapter transitions, TTS handoff, gesture state, display projection, RxDB
subscriptions, scheduler updates, and persistence.

The hot cursor is stored in `indexRef`, while UI position is stored separately in
`currentWordIndex`. The same paired-state pattern exists for `isPlaying`, WPM,
current chapter, compact layout, image cues, and summary mode. Some duplication
is intentional because React should not rerender on every word, but there is no
abstraction enforcing which copy is authoritative or when snapshots are
published.

Consequences:

- RSVP, TTS, manual seeking, chapter transitions, summaries, and React effects can
  all write related state through different paths;
- synchronization rules live in comments and effect ordering;
- transition cancellation requires manual cleanup of many timer refs;
- testing a playback rule requires mounting the full Reader; and
- extracting JSX into smaller components would move code without fixing
  ownership.

The first structural refactor must therefore be a state and ownership refactor,
not a cosmetic component split.

### P0: Display Plugins Return Markup Instead Of A Render Model

**Confirmed.** `src/core/rsvp/display/types.ts` defines `renderWord()` and
`renderContextWord()` as HTML-string producers. `renderDisplayFrame()` composes
those strings, and Reader/Manifesto/FontPlayground assign them through
`innerHTML` or `dangerouslySetInnerHTML`.

This creates four problems:

1. literal book text can be reinterpreted as markup unless every producer
   escapes it correctly;
2. the domain plugin API is coupled to browser DOM serialization;
3. the Reader duplicates context-word rendering instead of using the plugin's
   context contract; and
4. incremental or keyed DOM updates are difficult because the only result is an
   opaque string.

The ingestion hardening plans improve source text quality but do not make
`innerHTML` a safe rendering boundary. Text safety belongs in the projector too.

Do not respond by sending every word through React. Keep an imperative hot path,
but make plugins return structured, inert data such as glyph runs, emphasis
roles, and container style tokens. A single projector should create or update DOM
nodes using `textContent`.

### P1: Context Rivers Rebuild Far More DOM Than The Cursor Needs

**Confirmed behavior; impact to measure.** Reader builds up to 150 previous and
150 next words as HTML. It loops over each character to add emphasis spans,
replaces each container's complete `innerHTML`, and reads `scrollHeight`, which
can force layout. During RSVP playback this occurs whenever the source index is
divisible by three; TTS separately refreshes the rivers once per second.

`ManifestoRsvp` implements another complete version of the same 150-word river
construction and rebuilds both rivers on each displayed frame.

The desired model is a shared `ContextWindowProjector` with stable keyed word
nodes. Advancing one frame should remove expired nodes, append newly visible
nodes, and update only changed density/emphasis metadata. Full rebuilds should be
reserved for chapter, plugin, density, or layout changes.

### P1: Cursor Consumers Recompute And Publish On Different Cadences

**Confirmed.** The Reader currently has independent schedules for:

- RSVP advancement;
- TTS word callbacks;
- TTS river refresh;
- actual-WPM calculation;
- reading-state persistence;
- sidebar progress sampling;
- processing-time display;
- summary countdowns; and
- chapter momentum and notification timers.

Multiple cadences are not inherently wrong. The missing structure is a canonical
cursor snapshot plus declared publication policies. For example, every RSVP word
currently calls `updateProgressMilestone()`, which repeatedly filters chapters,
sums total words, and derives the global index even though React only needs a
milestone update occasionally. Persistence separately queries the reading-state
document on a five-second interval and again on pause/unmount.

Derived values should be computed from a prebuilt chapter prefix index. Cursor
publication should have named channels:

- **frame:** every visual word/frame, consumed only by the projector;
- **UI:** sampled at a bounded cadence or semantic boundary;
- **scheduler:** distance- or time-throttled lookahead updates;
- **persistence:** deduplicated trailing save plus explicit flush; and
- **milestone:** only when a threshold is crossed.

### P1: Progress Is Fragmented, But One Global Progress Store Is The Wrong Fix

**Confirmed.** TTS has a good `createTTSProgressReporter()` that clamps,
quantizes, throttles, deduplicates, flushes terminal states, and disposes its
timer. AI model loading writes raw WebLLM callbacks directly to its store.
Ingestion passes message callbacks directly to readers, including page/OCR
updates. Density estimation, exchange, sync, and archive ingestion each define
their own progress shape and component state.

There are also several different meanings hidden behind the word "progress":

- model download/load completion;
- chapter ingestion and OCR completion;
- background density task completion;
- bytes transferred;
- book reading position;
- TTS audio position; and
- synthetic/interpolated summary time.

Create a generic reporting primitive, not a generic domain model:

```ts
interface OperationProgress {
    operationId: string;
    kind: 'model-load' | 'ingest' | 'analysis' | 'sync' | 'exchange';
    phase: string;
    completed?: number;
    total?: number;
    message?: string;
    state: 'running' | 'completed' | 'failed' | 'cancelled';
    updatedAt: number;
}

interface OperationHandle {
    readonly id: string;
    readonly signal: AbortSignal;
    report(update: Omit<OperationProgress, 'operationId' | 'updatedAt'>): void;
    complete(message?: string): void;
    fail(error: unknown): void;
    cancel(): void;
    dispose(): void;
}
```

The reporter should provide configurable throttling, duplicate suppression,
immediate terminal delivery, stale-generation protection, and cancellation. It
should publish to a callback by default. Add an operation registry only for work
that outlives the initiating component or must appear in global UI.

Do **not** send Reader word position, Web Audio clock ticks, summary interpolation,
or internal scheduler priorities through this service.

### P1: Several Stores Contain Duplicate Or Over-Broad Runtime State

**Confirmed.** The AI store keeps legacy flags (`isReady`, `isLoading`) beside a
new `lifecycleState`. Actions update different subsets, so the values can diverge.
`AIStatusPanel` subscribes to the complete store and also maintains two local
timers. `App` subscribes to the complete settings store even though it only needs
theme and sidebar state.

The Phase 2 TTS follow-up moved handoff persistence to direct-store sampling,
and the current controls no longer subscribe to `currentWordIndex` or
`currentSentence` for that purpose. Keep this as a regression contract when
changing the player rather than as a current defect.

Prefer one canonical state representation and derived selectors. Use narrow or
shallow subscriptions for UI. High-frequency values needed only by periodic
persistence should be sampled through `store.getState()` rather than subscribed
through React.

### P1: Reactive Data Is Sometimes Converted Back Into Polling Or N Queries

**Confirmed.** Each `BookCard` opens its own live chapter query and five-second
projection timer. This scales subscription and repeated aggregation work with
the number of books. A library-level reactive read model could subscribe once,
aggregate chapter status by `bookId`, and pass stable card summaries.

`SyncPage` polls RxDB with two asynchronous queries every second. The cleanup
function returned inside its async `start()` function is not returned by the
effect, so that interval is not directly cleaned up on unmount. Overlapping polls
are also possible if a query takes longer than the interval.

Use RxDB observables to derive sync completion, or a serialized recursive timeout
when an observable cannot express the condition. All service starts should
return an explicit lifecycle handle whose `dispose()` owns subscriptions,
intervals, buffers, and peer cancellation.

### P2: Service Lifetime Is Implicit

**Confirmed architecture; not all instances are leaks.** The ingest scheduler,
AI engine, TTS engine/player, database promise, and several module-level job maps
are application singletons. The scheduler subscribes to settings in its
constructor without retaining an unsubscribe function.

An app-lifetime subscription is acceptable if the service is explicitly
app-scoped and constructed once. The problem is that this is not encoded in its
API, which makes HMR, tests, reset, and future multi-session behavior fragile.

Every stateful singleton should declare one lifecycle:

- app-scoped singleton with idempotent `start()` and `dispose()` for tests/HMR;
- session-scoped controller created by a route and disposed on unmount; or
- operation-scoped handle tied to an `AbortSignal`.

Avoid a generic subscription registry. Ownership-local disposables and composite
operation handles are easier to reason about than a second global place that
tracks subscriptions.

### P2: Existing Documents And Source Have Drifted

**Confirmed.** The original TTS profiling plan describes a persistence write on
every store update, but current selector-based persistence has fixed it. The
Phase 2 document and current `TTSPlayer` both use direct-store sampling for
spoken word/sentence handoff fields.

Performance contracts need executable regression tests or counters. Otherwise
well-intentioned feature work can silently restore update amplification.

## What Is Already Good And Must Be Preserved

- Reader's timeout-plus-rAF playback loop avoids continuous 60 Hz polling.
- The RSVP center lane does not require a React commit for every frame.
- Context rendering can already be skipped independently from center-word
  rendering.
- Scheduler cursor updates are less frequent than word advancement.
- Progress milestone announcements occur only at semantic thresholds.
- TTS model progress is throttled, quantized, deduplicated, and immediately
  flushes terminal states.
- TTS settings persistence uses a selected settings slice and shallow equality;
  runtime clock updates no longer rewrite settings.
- TTS audio scheduling and queueing are bounded and remain domain-specific.
- RxDB live queries are already the normal data flow in much of the application.
- Reader chapter live updates refresh refs during playback to avoid visual
  flicker.

The refactor should preserve these properties with tests before moving code.

## Target Architecture

```text
Reader route
  -> ReaderSessionController (session-scoped, canonical state)
       - cursor and active chapter
       - transport owner: none | rsvp | tts
       - reading mode: text | summary | transition | image-break
       - commands: play, pause, seek, enterTts, leaveTts, changeChapter
       - sampled UI snapshots via subscribe/getSnapshot
       - explicit dispose
       |
       +-> RsvpPlaybackClock
       |    - timing only
       |    - emits planned frames
       |
       +-> RsvpProjector
       |    - center display DOM only
       |    - consumes structured DisplayFrameModel
       |
       +-> ContextWindowProjector
       |    - stable previous/next word nodes
       |    - incremental window movement
       |
       +-> ReaderProgressCoordinator
       |    - precomputed global-position index
       |    - sampled UI progress
       |    - scheduler cursor policy
       |    - deduplicated persistence and flush
       |
       +-> ReaderDataSource
            - RxDB subscriptions
            - chapter/image/summary snapshots
            - composite disposal

Long-running domains
  -> createOperationHandle/createProgressReporter
       - throttling and deduplication
       - AbortSignal and generation guard
       - terminal state
       - optional operation registry for global UI
```

### Canonical Reader State

Use one pure state model, driven by commands/events, for semantic state:

```ts
type TransportOwner = 'none' | 'rsvp' | 'tts';
type ReaderMode = 'text' | 'summary' | 'chapter-transition' | 'image-break';

interface ReaderSessionSnapshot {
    bookId: string;
    chapterId: string;
    wordIndex: number;
    mode: ReaderMode;
    transport: TransportOwner;
    playing: boolean;
    transition?: { phase: string; targetChapterId?: string };
}
```

Refs may still cache hot implementation details, but they must be private to the
controller/projector. React should not maintain a second semantic source of
truth. Use `useSyncExternalStore` or an equivalent selector hook to expose
coarse snapshots to controls and accessibility UI.

### Structured Display Model

Replace HTML-producing plugin methods incrementally with a data contract:

```ts
interface DisplayGlyphRun {
    text: string;
    role: 'normal' | 'focus' | 'neighbor' | 'dash' | 'reference';
    weight?: number;
    opacity?: number;
    transform?: string;
}

interface DisplayTokenModel {
    runs: DisplayGlyphRun[];
}

interface DisplayFrameModel {
    tokens: DisplayTokenModel[];
    container: {
        alignment: 'left' | 'center';
        styleVariant: string;
    };
}
```

Keep dynamic numeric styling where a plugin needs it, but validate/assign style
properties rather than serializing style attributes. Provide a temporary adapter
for one plugin at a time; remove the HTML path once all plugins and tests migrate.

## Measurement Plan

### Baseline Scenarios

Capture production traces before structural changes:

1. RSVP at 300, 600, and 1,000 WPM with both rivers enabled.
2. The same runs with rivers disabled.
3. TTS initialization plus two minutes of steady playback.
4. Manual seek, summary transition, chapter transition, and TTS/RSVP handoff.
5. Archive with 10, 100, and a synthetic 500 books.
6. PDF OCR ingestion with frequent progress callbacks.
7. Device sync of a multi-chapter book with large chunked documents.

Record:

- React commits per component and per second;
- store updates per field;
- DOM nodes created/removed and river mutation batches;
- long-task count, total, and maximum;
- scripting, style, layout, and paint time;
- timer/rAF wakeups;
- RxDB query/subscription counts;
- reading-state and settings writes;
- heap growth after operation disposal; and
- displayed frame timing versus the requested WPM.

Add bounded development counters behind a query parameter or build flag. Do not
leave per-word console logging in production.

### Performance Budgets

Validate exact budgets against the baseline, then enforce at least these
behavioral constraints:

- no Reader shell React commit is required for an ordinary RSVP frame;
- TTS controls do not rerender because only word/sentence handoff fields changed;
- operation reporters publish at no more than 10 Hz by default and deliver
  terminal states immediately;
- a one-word context-window shift does not replace both complete rivers;
- unchanged reading snapshots do not write RxDB;
- no polling callback can overlap itself;
- all route/session/operation resources reach zero after disposal; and
- playback timing stays within 5% of the expected weighted frame schedule in
  deterministic fake-clock tests.

## Implementation Phases

### Phase 0: Freeze Behavior And Add Instrumentation

Deliverables:

- Add a production-like Reader benchmark fixture and deterministic fake-clock
  tests for RSVP, summary, chapter transition, seek, and TTS handoff.
- Add counters for Reader commits, center projections, river rebuilds, created
  nodes, scheduler cursor publications, and persistence writes.
- Add tests proving literal strings resembling HTML render as text.
- Capture and check in a baseline results table, not a browser trace artifact.
- Document current ownership and disposal for app-, session-, and
  operation-scoped services.

Exit criteria:

- The baseline scenarios are repeatable.
- Existing timing, transitions, notes, phrase grouping, and TTS continuation are
  covered before moving ownership.

### Phase 1: Remove Known Update Amplification

This is the smallest low-risk pass and should precede the Reader rewrite.

Deliverables:

- Restore direct-store sampling for TTS handoff fields so `TTSPlayer` subscribes
  only to values it renders.
- Replace full-store subscriptions in `App`, `AIStatusPanel`, and other hot
  surfaces with narrow/shallow selectors.
- Collapse AI lifecycle flags into one canonical lifecycle state and expose
  compatibility selectors during migration.
- Precompute chapter word-prefix totals instead of filtering/reducing all
  chapters on each cursor advance.
- Cache the current reading-state document or use an upsert helper; skip
  unchanged persistence writes and flush on pause, chapter change, page hide,
  and dispose.
- Replace the `SyncPage` async interval with a reactive completion subscription
  or a non-overlapping cancellable loop.

Exit criteria:

- React Profiler confirms no TTS control commit for word-only changes.
- AI state cannot represent contradictory legacy/lifecycle combinations.
- Sync has one explicit disposal path and no live poll after route unmount.

### Phase 2: Introduce The Shared Operation Primitive

Deliverables:

- Generalize the tested mechanics in `core/tts/progress.ts` into
  `core/operations/progressReporter.ts`.
- Add `OperationHandle` with `AbortController`, generation identity, terminal
  state, and composite disposal.
- Migrate AI model loading and PDF/OCR ingestion first, where callback volume is
  highest.
- Migrate density estimation and background ingest reporting.
- Keep exchange callbacks local unless progress must survive sheet unmount.
- Add a small registry only after at least two global UI consumers require the
  same active-operation view.

Exit criteria:

- Duplicate progress values are suppressed.
- Stale callbacks from cancelled/replaced operations cannot update current UI.
- Terminal updates bypass throttling.
- Operation completion, failure, cancellation, and disposal are deterministic.

### Phase 3: Replace The Display HTML Contract

Deliverables:

- Add structured display models and a DOM projector using `textContent`.
- Migrate one representative plugin and compare pixels/timing against the current
  implementation.
- Migrate all browser display plugins, `Reader`, `ManifestoRsvp`, and
  `FontPlayground`.
- Centralize reference/dash/grouped-frame projection.
- Decide separately whether the Exhibition canvas renderer should consume the
  same model; do not force DOM-specific concepts into canvas.
- Delete the HTML-string interface after compatibility tests pass.

Exit criteria:

- Reader-facing book text never enters `innerHTML`.
- Every plugin has visual regression coverage.
- Center projection remains imperative and does not add per-frame React commits.

### Phase 4: Build The Reader Session Controller

Deliverables:

- Implement a pure Reader session reducer/state machine and command tests.
- Make it the canonical owner of cursor, mode, transport, and transition state.
- Give RSVP or TTS an explicit cursor lease; entering one transport pauses and
  releases the other before ownership changes.
- Move playback timing into `RsvpPlaybackClock` without changing its
  timeout-plus-rAF algorithm.
- Replace timer-ref choreography for transitions with abortable sequences owned
  by the session.
- Publish coarse UI snapshots through `useSyncExternalStore` selectors.
- Move RxDB subscriptions into a session-scoped data source with composite
  disposal.

Exit criteria:

- One semantic source of truth exists for cursor and mode.
- There is no paired React state/ref for the same semantic field outside the
  session boundary.
- RSVP and TTS cannot advance the cursor concurrently.
- Reader behavior tests pass against the controller without mounting the full
  Reader UI.

### Phase 5: Make Context Projection Incremental

Deliverables:

- Implement one shared `ContextWindowProjector` for Reader and Manifesto.
- Reuse stable word nodes keyed by source index.
- Shift the window incrementally and rebuild only on invalidation.
- Cache plugin context models for immutable source words.
- Separate density-class updates from text/glyph construction.
- Avoid forced layout on every update; scroll only when the visible boundary
  actually changes.
- Tune UI publication and river cadence from measurements rather than `% 3`.

Exit criteria:

- Normal advancement mutates only the delta between context windows.
- DOM node churn and scripting time improve materially with rivers enabled.
- Clicking/scrolling river words, density colors, punctuation gaps, and chapter
  history boundaries remain correct.

### Phase 6: Add Shared Read Models And Explicit Service Lifetimes

Deliverables:

- Replace per-card chapter subscriptions/timers with a library-level reactive
  summary model if the archive scaling benchmark confirms the cost.
- Define `start()`/`dispose()` or operation handles for scheduler, sync, AI, and
  TTS lifecycles.
- Retain unsubscribe handles for app-scoped subscriptions so tests/HMR can reset
  them.
- Replace loose module maps/flags with session or operation objects where their
  lifetime is shorter than the app.
- Split Reader JSX into focused components only after controller and projector
  boundaries exist.

Exit criteria:

- Subscription count is bounded by active screens/operations rather than card
  count where practical.
- Repeated mount/unmount and HMR-style start/dispose tests leave no listeners,
  timers, peers, or in-flight callbacks.
- `Reader.tsx` becomes a composition root rather than an engine hidden inside a
  component.

## Proposed Module Boundaries

Names can follow local conventions, but ownership should resemble:

```text
src/core/reader/
  session.ts                  # pure semantic state and commands
  controller.ts               # runtime orchestration and subscriptions
  playbackClock.ts            # RSVP timing only
  progressCoordinator.ts      # derived/sampled/persisted reading progress
  dataSource.ts               # RxDB session data

src/core/rsvp/display/
  model.ts                    # inert display model
  projector.ts                # center DOM projection
  contextProjector.ts         # incremental river projection

src/core/operations/
  types.ts
  progressReporter.ts
  operationHandle.ts
  registry.ts                 # optional; add only when needed

src/hooks/
  useReaderSession.ts
  useOperation.ts             # only if registry is introduced
```

Avoid placing the core clock, projector, or state machine in React hooks. Hooks
should adapt independently testable runtime objects to React, not become the new
home for the same coupled logic.

## Testing Strategy

### Unit

- fake-clock playback timing and sleep/rAF scheduling;
- Reader state transitions and transport ownership;
- cursor publication policies and prefix-index calculations;
- operation reporter throttle, deduplication, cancellation, stale generation,
  and terminal flush;
- display model generation for every plugin;
- text-safe projection of `<`, `>`, `&`, quotes, entities, and markup-like book
  content;
- incremental context-window diffs; and
- persistence deduplication and lifecycle flush.

### Integration

- RxDB chapter updates during active playback;
- TTS/RSVP handoff in both directions;
- chapter and summary transition cancellation;
- OCR/model-load progress after component unmount;
- sync completion and cleanup; and
- archive aggregation with many books.

### End To End

- desktop and mobile RSVP playback at several speeds;
- rivers on/off, focus mode, notes, long-word segmentation, grouped phrases, and
  plugin switching;
- TTS initialization, playback, seek, pause, and chapter continuation;
- import cancellation and reopening a partially processed book; and
- device exchange/sync cancellation and completion.

Use non-interactive test commands (`npx vitest run` and Playwright's normal
non-interactive runner). Include browser screenshots for visual plugin parity,
but use DOM/performance counters for architecture budgets.

## Migration Rules

1. Do not rewrite the Reader in one pass.
2. Establish behavior tests and counters before each ownership move.
3. Keep old and new implementations behind a temporary adapter, not two active
   sources of truth.
4. Move one responsibility at a time and rerun the same focused benchmark.
5. Preserve the battery-optimized playback scheduling algorithm.
6. Do not introduce React state updates for every RSVP frame.
7. Do not route high-frequency cursor or audio-clock updates through a global
   operation store.
8. Do not persist derived UI progress when it can be recomputed.
9. Delete compatibility state and adapters at the end of each migration phase.
10. Reject a refactor that improves code shape but regresses timing, energy,
    visual parity, cancellation, or accessibility.

## Recommended Execution Order

Start with Phase 0 and the six Phase 1 amplification fixes. They provide a
measured baseline and immediate reductions without destabilizing the Reader.
Then implement the operation primitive and structured display model in parallel,
because they touch different ownership boundaries. Build the Reader session
controller only after the display projector has a stable contract. Optimize the
rivers after the controller can provide canonical window snapshots.

The expected result is not merely a smaller `Reader.tsx`. It is a system in
which each update has one owner, one intended cadence, one projection path, and
one disposal path.