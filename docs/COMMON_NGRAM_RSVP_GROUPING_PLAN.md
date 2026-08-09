# Common N-gram RSVP Grouping Plan

## Purpose

Add a Pacing setting that lets the reader combine a configurable number of
the most common English bigrams and trigrams into one RSVP flash.

For example, instead of displaying `in` for one interval and `the` for another,
the reader may display `in the` for 1.5 intervals. This plan interprets the
example as a relative timing rule, not literal 1.5 ms exposure. The current
reader has a 75 ms display floor, and literal 1.5 ms text would not be
perceptible.

The feature should make predictable phrases easier to absorb at high speed
without changing the book's stored tokenization, navigation indexes, progress,
notes, summaries, or source text.

## Product Contract

- Add one `Common phrase grouping` slider to Settings > Pacing.
- The slider selects how many ranked bigrams and how many ranked trigrams are
  eligible. A value of 100 enables the top 100 entries in each list.
- `0` means `Off` and remains the default so existing readers retain their
  current cadence until they opt in.
- Use a range of 0-500 with a step of 10. The displayed value is `Off` or
  `Top N bigrams + trigrams`, not an unexplained integer.
- Prefer an eligible trigram over an eligible bigram at the same cursor
  position. Matches never overlap because the winning phrase is consumed as
  one frame.
- Keep the original spelling, capitalization, apostrophes, and trailing
  punctuation in the displayed phrase. Normalization is for lookup only.
- Apply grouping to normal Reader text, Reader summaries, and the Manifesto
  RSVP reader. Do not apply it to TTS, ingestion, context-river text, search,
  or the deterministic Exhibition renderer.
- The configured WPM remains the baseline single-word cadence. Grouping is an
  intentional throughput increase, so actual WPM continues to count consumed
  source words and may be higher than the configured baseline.

## Non-Goals

- Do not merge or rewrite `chapter.content` arrays in storage.
- Do not change EPUB/PDF ingestion or AI density generation.
- Do not generate phrases with an LLM or require network access at runtime.
- Do not infer arbitrary grammatical phrases outside the ranked lists.
- Do not group across chapter, summary, note, reference, or pause boundaries.
- Do not add separate bigram and trigram sliders in the first version.
- Do not tune the compression factor through the UI in the first version.

## Current Architecture

- `src/core/store/settings.ts` owns persisted reader settings in the
  `xyz-settings` Zustand store.
- `src/components/Settings/SettingsPanel.tsx` renders Pacing controls,
  including display style, target WPM, and density sensitivity.
- `src/components/Reader/Reader.tsx` owns the live source-word cursor. Its
  battery-optimized loop renders one token, waits for `getTargetInterval`, and
  increments `indexRef.current` by one.
- `src/components/ManifestoRsvp.tsx` has a second, simpler RSVP loop over a word
  array and uses the same timing function.
- `src/core/rsvp/timing.ts` owns live display cadence. Reader, Manifesto, and
  Exhibition call it directly.
- Display plugins currently accept one string. Passing a phrase as if it were
  one word would calculate one visual anchor across spaces, so grouped frames
  need an explicit multi-token renderer.
- Reader progress, summaries, note cues, actual WPM, long-word segmentation,
  and context rivers all assume that one frame consumes one source token.

## Ranked Phrase Data

Create a checked-in, runtime-only artifact such as
`src/core/rsvp/phrases/commonEnglishNgrams.ts` containing 500 ranked English
bigrams and 500 ranked English trigrams.

Generate the artifact from an explicitly versioned public-domain Project
Gutenberg corpus using a script such as
`scripts/generate_common_ngrams.mjs`. Reuse the repository's Gutenberg corpus
workflow where practical. Commit the generated lists so the application does
not parse EPUBs, download data, or count phrases at startup.

The generator must:

1. Record the corpus identifiers, generator version, and source hash in a
   header next to the generated lists.
2. Use the same Unicode-aware lexical normalization as the runtime matcher.
3. Count within sentences only; never form an n-gram across terminal
   punctuation or a standalone pause token.
4. Sort by descending count and then normalized phrase text for deterministic
   ties.
5. Exclude entries containing reference markers, numerals-only tokens,
   malformed OCR fragments, or tokens longer than 12 lexical characters.
6. Cap eligible rendered phrases at 24 characters including spaces so common
   phrases remain viable on a 320 px reader lane.
7. Emit both ordered arrays and lookup maps from normalized phrase to its
   zero-based rank.

The generated artifact must be deterministic. Running the generator twice
against the same corpus must produce byte-identical output.

## Pure Frame Planner

Add a pure module such as `src/core/rsvp/phrases/grouping.ts`. It should plan
the next visual frame without mutating the source words or reader state.

Suggested contract:

```ts
interface RsvpFrame {
    startIndex: number;
    sourceWordCount: 1 | 2 | 3;
    tokens: string[];
    displayText: string;
}

interface PlanRsvpFrameOptions {
    phraseRankLimit: number;
    blockedIndexes?: ReadonlySet<number>;
}

function planRsvpFrame(
    words: readonly string[],
    startIndex: number,
    options: PlanRsvpFrameOptions,
): RsvpFrame;
```

### Matching Rules

1. Return one source token when the rank limit is 0.
2. Test a trigram first, then a bigram.
3. Lowercase with a fixed English locale and normalize Unicode consistently.
4. Strip surrounding quote/bracket punctuation and trailing sentence or
   clause punctuation for lookup while retaining the source token for display.
5. Allow sentence-initial capitalization, so `In the` can match `in the`.
6. Reject a candidate if an internal token ends a sentence or clause.
7. Reject a candidate containing a pause token, compact reference token,
   slash fragment, hyphen continuation, empty lexical token, or a token that
   would require compact-landscape long-word segmentation.
8. Reject a candidate if any covered index is blocked by Reader semantics.
9. Return the original tokens joined by one normal space. Never reconstruct
   words from normalized lookup text.

`blockedIndexes` makes the planner reusable while allowing Reader to protect
its own semantic boundaries. In Reader, block every index participating in:

- a subchapter end that can launch a summary;
- a retained PDF note anchor;
- a compact reference or standalone pause;
- a chapter handoff or any future word-index cue that must be observed alone.

Blocking the entire annotated phrase candidate is preferable to displaying a
note-bearing second word without moving the active note cursor to it.

## Group Timing

Add a pure timing helper that receives the planned frame, constituent
densities, previous source token, and effective WPM. Preserve the existing
single-token `getTargetInterval` behavior exactly.

For a grouped frame, calculate each token's current target timing separately
so density, token adjustments, and proper-noun handling are not averaged away.
Then apply a fixed first-version compression factor of 0.75 to lexical display
time while retaining punctuation wrap-up time:

$$
T_{group} = 0.75 \sum_{i=1}^{n}(T_i - P_i) + \sum_{i=1}^{n}P_i
$$

Here, $T_i$ is the existing calculated duration for token $i$, and $P_i$ is
its punctuation component. Internal punctuation is already disallowed, so in
practice only the final token should contribute wrap-up time.

At 600 WPM with neutral density and no punctuation:

- `in` is 100 ms and `the` is 100 ms;
- separate display takes 200 ms;
- grouped `in the` takes 150 ms;
- `one of the` takes 225 ms rather than 300 ms.

Do not multiply one averaged density or one concatenated phrase interval. That
would lose per-token AI pacing and make terminal punctuation inconsistent.

## Multi-token Rendering

Extend the display layer with one shared frame renderer rather than teaching
each playback loop to concatenate plugin HTML independently. A helper such as
`renderDisplayFrame(plugin, frame.tokens)` should:

- call the active plugin's word renderer once per source token;
- join rendered tokens with a stable visible space;
- preserve each word's own gradient, emphasis, or recognition anchor;
- expose the phrase as one no-wrap visual group;
- call container positioning with the full display text;
- leave single-token output byte-for-byte equivalent to current rendering;
- keep source-derived text escaped under the same safety contract as existing
  plugin output.

A React rerender must be able to reconstruct the same active frame. Store the
planned frame in a ref and derive paused/state-driven rendering from its
`startIndex` and `sourceWordCount`; do not let React replace a grouped phrase
with only its first word.

Grouped frames should bypass long-word segmentation because every candidate
has already passed the short-token eligibility rules. If the rendered group
still exceeds the RSVP lane after plugin transforms and user lens scaling,
apply a phrase-only fit scale based on measured width. Do not wrap the phrase,
clip it, or change the user's persisted lens scale.

Update context-river bounds so a two- or three-word frame does not repeat its
second or third token in the upcoming river. The previous river ends at
`frame.startIndex`; the next river begins at
`frame.startIndex + frame.sourceWordCount`.

## Reader Playback Integration

Replace the loop's implicit one-token frame with an explicit planned frame.
Keep `indexRef.current` as the source index of the active frame.

On each advancement:

1. Calculate the active frame from the current source index and setting.
2. Calculate the frame duration from all of its source tokens and densities.
3. Render the frame once and wait for its grouped duration.
4. Advance `indexRef.current` by `frame.sourceWordCount`.
5. Subtract the grouped duration from the accumulator.
6. Run cursor synchronization, progress milestones, and boundary checks at the
   first unread source index.
7. Plan and render the next frame.

The frame planner must cap itself at the remaining source length. At the end of
a chapter or summary, a final bigram/trigram may consume the remaining two or
three tokens and then enter the existing completion path without rendering an
empty frame.

Summary transitions currently depend on landing exactly on a subchapter end.
The blocked-index set must therefore prevent a frame from jumping over such an
index. Add an assertion in the advancement helper so future callers cannot
silently skip a protected boundary even if the planner regresses.

Manual seek, wheel seek, chapter load, TTS handoff, pause, and resume should
reset the active frame and re-plan from the selected source index. Persist the
first unread source index, not a synthetic phrase index.

### Actual WPM

Replace unweighted display timestamps with consumption events:

```ts
interface ConsumptionEvent {
    timeMs: number;
    sourceWordCount: number;
}
```

Actual WPM is the sum of `sourceWordCount` in the rolling window divided by
elapsed active reading time. Do not count one grouped flash as one word, and do
not push several identical timestamps as a shortcut.

## Manifesto Integration

Use the same planner, timing helper, frame renderer, and source-word accounting
in `ManifestoRsvp`. Its external `currentIndex` and `onJumpToIndex` contract
remains source-index based.

River clicks and wheel navigation continue to land on individual source words.
After a manual jump, the component may plan a phrase beginning at that word
when playback resumes. The static rivers remain ungrouped and the upcoming
river skips all tokens currently visible in the grouped frame.

Do not add grouping to `ExhibitionRender` in this work. Exhibition output is
URL-configured, canvas-rendered, and expected to remain deterministic across
recording runs; it does not consume user settings.

## Settings And UI

Add to `SettingsState`:

```ts
commonPhraseRankLimit: number;
setCommonPhraseRankLimit: (limit: number) => void;
```

Default to 0. Clamp values in the setter to the generated data range and round
to the slider step. Add a custom persisted-state merge (or store migration)
that applies the same normalization during hydration, because hydration does
not call action setters. The merge should supply the default for existing
profiles; add hydration regressions for both a missing value and a malformed
value rather than assuming either behavior.

Place the slider in the Pacing tab after Display Style and before Velocity
Weighting. Use:

- visible label: `Common phrase grouping`;
- `aria-label`: `Common phrase grouping`;
- value text: `Off` or `Top N bigrams and trigrams`;
- concise description: predictable two- and three-word phrases appear in one
  flash, with trigrams preferred;
- inline example: `in` + `the` becomes `in the` for about 75% of their combined
  display time.

Do not describe the control in literal milliseconds. The real duration depends
on WPM, density, punctuation, and the 75 ms per-token floor.

## Test Plan

### Phrase Planner Unit Tests

Add focused tests beside the grouping module for:

- rank limit 0 preserving one-token frames;
- rank cutoff enabling rank `N - 1` and excluding rank `N`;
- trigram precedence over an overlapping bigram;
- sentence-initial capitalization and Unicode apostrophe normalization;
- original casing and punctuation preservation in `displayText`;
- rejection across sentence/clause punctuation;
- rejection of pauses, references, continuation fragments, and blocked
  indexes;
- graceful behavior with one or two words left in the source;
- deterministic output from the checked-in production lists.

Inject small rank maps in most unit tests so corpus ranking changes do not make
behavior tests brittle.

### Timing Unit Tests

Extend `src/core/rsvp/timing.test.ts` or add a phrase timing test file:

- at 600 WPM and density 1, `in the` is exactly 150 ms;
- at 600 WPM and density 1, a neutral trigram is exactly 225 ms;
- constituent densities affect their own portions of grouped time;
- terminal punctuation time is not compressed;
- single-token timing remains unchanged;
- effective WPM momentum is applied before grouped timing.

### Store And Settings Tests

- New profiles default to `commonPhraseRankLimit: 0`.
- Old persisted settings hydrate with 0.
- Setter clamping and step rounding are deterministic.
- The slider shows `Off`, updates the store, and exposes useful accessible
  value text.

### Reader And Manifesto Tests

- Enabling a list that contains `in the` renders both words in one RSVP frame.
- The next frame starts after both consumed source words.
- An eligible trigram advances by three and does not repeat words in the next
  river.
- A summary boundary, retained note, reference, and pause remain individually
  observable.
- Pause/resume and manual seek re-plan from the correct source index.
- Saved progress is the first unread source token after a grouped frame.
- Actual WPM counts two or three source words for a grouped flash.
- Compact landscape does not split or overflow an eligible phrase.
- Each display plugin preserves separate per-word emphasis inside a phrase.

### Commands

Run tests non-interactively:

```sh
npx vitest run src/core/rsvp/phrases/grouping.test.ts
npx vitest run src/core/rsvp/timing.test.ts
npx vitest run src/core/store/settings.defaults.test.ts src/components/Settings/SettingsPanel.test.tsx
npx vitest run src/components/Reader/Reader.test.tsx src/components/ManifestoRsvp.test.tsx
npm run lint
npm run build
npx playwright test e2e/screenshots.spec.ts --project=chromium --grep "Reader Journey Key Flows"
npx playwright test e2e/screenshots.spec.ts --project=mobile --grep "Reader Journey Key Flows"
```

The Manifesto test file may need to be created if it does not exist when this
work begins.

## Implementation Sequence

### Phase 1: Freeze Phrase And Timing Semantics

1. Add the deterministic corpus generator and checked-in ranked artifact.
2. Add the pure frame planner with injected rank maps in tests.
3. Add grouped timing with the 0.75 lexical compression rule.
4. Prove the `in the` 600 WPM case before touching playback loops.

Deliverable: phrase selection and duration are deterministic without UI or
Reader changes.

### Phase 2: Persist And Expose The Setting

1. Add `commonPhraseRankLimit` and its clamped setter to the settings store.
2. Add default and persisted-state hydration tests.
3. Add the Pacing slider, value text, explanation, and component tests.

Deliverable: users can configure the feature, but playback still ignores it.

### Phase 3: Add Frame Rendering

1. Add the shared multi-token display renderer.
2. Preserve per-word plugin styling and single-word output.
3. Add active-frame state/ref handling and phrase width fitting.
4. Add display-plugin and narrow-viewport tests.

Deliverable: every display style can render a stable phrase without cursor
changes.

### Phase 4: Integrate Reader Playback

1. Build Reader blocked indexes from summaries, notes, references, and pauses.
2. Plan one explicit frame at the current source cursor.
3. Advance by frame source-word count while protecting exact boundaries.
4. Update React fallback rendering, context rivers, progress, save/restore, and
   weighted actual-WPM accounting.
5. Add Reader tests for grouping, transitions, seeking, and mobile layout.

Deliverable: normal text and Reader summaries group phrases without losing any
source-index behavior.

### Phase 5: Integrate Manifesto And Validate

1. Reuse the frame path in Manifesto RSVP.
2. Keep Exhibition and TTS unchanged.
3. Run focused unit/component tests, lint, and production build.
4. Run desktop and mobile Reader journeys and inspect at least one long
   eligible trigram in every display style.

Deliverable: the setting behaves consistently across user-facing visual RSVP
streams and remains off by default.

## Acceptance Criteria

- With the setting off, Reader and Manifesto cadence, rendering, and source
  indexes are unchanged.
- With the limit set to N, only the top N bigrams and top N trigrams are
  eligible.
- `in the` at neutral density and 600 WPM displays once for 150 ms when it is
  within the configured rank limit.
- An overlapping eligible trigram is chosen before a bigram.
- Grouped phrases retain original text and each word's display-plugin styling.
- No source word is skipped, repeated, duplicated in the upcoming river, or
  lost from saved progress.
- Summary transitions, note cues, pause/reference tokens, chapter handoffs,
  and TTS handoffs still occur at their exact source indexes.
- Actual WPM counts source words rather than visual flashes.
- Grouped phrases remain legible and non-overlapping at 320 px mobile width and
  compact landscape.
- Ranked data and all tests are deterministic and require no runtime network
  access.

## Follow-up Experiment

Keep the first version's compression factor fixed at 0.75. After the behavior
is stable, add an opt-in local comprehension experiment comparing:

- no grouping;
- grouped phrases at 0.85 of combined lexical time;
- grouped phrases at 0.75;
- grouped phrases at 0.65.

Record results only on-device and only with explicit consent. The goal is to
decide whether one factor works across bigrams and trigrams or whether trigrams
need a less aggressive duration. Do not add another production control until
the experiment shows that the distinction is useful.