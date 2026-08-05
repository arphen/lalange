# Internal Reading Sections Plan

## Purpose

Build a deterministic internal representation of every imported book so reader
navigation is useful even when the source EPUB has no meaningful chapter model.
The internal reading sections may coincide with publisher chapters, combine
page-like source files, or split unusually long chapters.

The motivating fixture is `books/giftformsfunctio00maus.epub`. It currently
produces 152 reader chapters from 153 spine documents. Most are OCR page files
such as `page_30.html`, contain about 379 words, have no authored chapter
boundary, and are shown as generic `Chapter N` entries with `Recovered` repeated
under every entry.

## Product Outcome

- Every format produces the same normalized reading-section model before the
  reader or analysis pipeline sees it.
- A source page is never automatically treated as a user-facing chapter.
- Valid publisher chapters and document headings remain recognizable.
- Unstructured page sequences become stable, comfortably sized `Section N`
  entries.
- Very long authored chapters can be split into reading sections while retaining
  their authored parent title.
- The Contents UI describes reformation once at book level. It does not repeat
  implementation labels such as `Recovered` on every row.
- Reformation is deterministic, offline, and does not depend on an LLM.

## Non-Goals

- Do not invent semantic chapter names with AI in the first implementation.
- Do not rewrite or modify the uploaded EPUB.
- Do not treat density-analysis chunks as navigation structure.
- Do not weaken TOC fragment validation or publication-artifact filtering.
- Do not infer chapter boundaries from typography alone when the evidence is
  ambiguous.

## Terms

**Source unit**: An ordered readable unit from the input format. For EPUB this is
a spine document or a validated fragment slice; for PDF it is a page; for plain
text it may be a paragraph range.

**Authored boundary**: A validated publisher TOC target or a coherent document
heading boundary.

**Reading section**: XYZ's canonical navigation and playback unit. This is what
the database currently calls a chapter.

**Analysis chunk**: The approximately 2,500-word unit used for density work and
currently stored as a `subchapter`. It is not a chapter and must not determine
the book outline.

## Required Invariants

1. Every readable source unit appears in exactly one reading section, in source
   order.
2. Reformation cannot duplicate, omit, or reorder readable text.
3. Publication artifacts remain excluded before section normalization.
4. The same file and settings always produce the same sections, titles, and IDs.
5. Authored boundaries are never silently crossed by generated sections.
6. A generated title must be useful to a reader. Do not expose `Recovered`,
   `Merged`, file names, page numbers, or provenance as the primary title.
7. Image-only source units and image cues retain their source order.
8. Analysis chunk size changes must not alter reading-section boundaries.

## Canonical Model

Introduce an explicit normalized model rather than making `ChapterSource` carry
both provenance and presentation semantics.

```ts
type BoundaryEvidence = 'publisher-toc' | 'document-heading' | 'source-spine';
type SectionOwnership = 'authored' | 'xyz';
type ReformationReason =
    | 'authored-boundary'
    | 'page-sequence'
    | 'long-section-split'
    | 'short-section-merge'
    | 'format-fallback';

interface SourceUnit {
    ordinal: number;
    slices: ChapterSlice[];
    estimatedWords: number;
    title?: string;
    boundaryEvidence: BoundaryEvidence;
    authoredGroupTitle?: string;
}

interface ReadingSectionPlan {
    title: string;
    slices: ChapterSlice[];
    estimatedWords: number;
    ownership: SectionOwnership;
    reason: ReformationReason;
    boundaryEvidence: BoundaryEvidence[];
    authoredGroupTitle?: string;
    originalTitles: string[];
}

interface NormalizedBookStructure {
    version: number;
    sourceUnits: SourceUnit[];
    sections: ReadingSectionPlan[];
    mode: 'authored' | 'hybrid' | 'generated';
}
```

The existing `PlannedChapter` can temporarily implement `ReadingSectionPlan` to
keep the change incremental. Preserve `source: 'toc' | 'heading' | 'spine' |
'merged'` as a compatibility field until callers and stored documents migrate.
Do not use that compatibility field for UI copy.

Persist enough section metadata to explain and migrate the result:

```ts
metadata: {
    structureOwnership: 'authored' | 'xyz';
    reformationReason: ReformationReason;
    authoredGroupTitle?: string;
    originalTitles?: string[];
    structureVersion: number;
}
```

Add these properties to both `ChapterDocType` and `chapterSchema`. Add a
book-level `structureVersion` and `structureMode` to `BookDocType` and
`bookSchema`. Follow the repository's RxDB migration requirements when bumping
schema versions; do not add type-only fields that the runtime schema cannot
store.

## Reformation Algorithm

Implement normalization as a pure function over ordered `SourceUnit[]`. Keep it
separate from ZIP parsing, cleaning, tokenization, persistence, and AI work.

### 1. Build Source Units

- Resolve and validate TOC fragments exactly as today.
- Recover only coherent heading families exactly as today.
- Filter cover, TOC, license, title-page, and other publication matter exactly
  as today.
- Produce ordered source units with estimated words and boundary evidence.
- Mark generic fallback titles (`Chapter N`, `Section N`, `Page N`, numeric
  labels, repeated document titles) as non-authored labels.

### 2. Select Structural Mode

Use `authored` when validated TOC or coherent headings cover the book.

Use `generated` when the book is primarily raw spine/page units with generic
titles and no reliable authored boundaries.

Use `hybrid` when authored groups exist but one or more groups need splitting or
short adjacent source units need joining.

The gift fixture must be detected as `generated`: its many `page_*.html` files
and `Page N` document titles are pagination, not chapters.

### 3. Preserve Authored Groups

- Keep validated publisher chapter titles as `authoredGroupTitle`.
- Keep a normally sized authored chapter as one reading section.
- Preserve short intentional matter such as a dedication, prologue, or epilogue
  when it has a meaningful authored label.
- Never merge content across two validated authored chapter boundaries.

### 4. Group Unstructured Page Sequences

Initial deterministic thresholds:

- Target: 3,500 words.
- Soft minimum: 2,000 words.
- Hard maximum: 5,000 words.
- Start a new section before a reliable authored boundary.
- Add whole source units until adding the next would exceed the hard maximum.
- If the current section is below the soft minimum, allow it to approach the
  hard maximum before closing.
- Rebalance the final undersized section with the preceding section when both
  can remain under the hard maximum.

These are navigation thresholds, not analysis settings. Define named constants
next to the pure normalizer and cover them with tests. Tune only with corpus
evidence.

For a generated book, title the outputs `Section 1`, `Section 2`, and so on.
Do not title them from OCR first words; headers and running text make that noisy.

### 5. Split Oversized Authored Chapters

An authored chapter above 10,000 words should be eligible for internal sections.
Prefer, in order:

1. Valid lower-level headings inside the authored chapter.
2. Paragraph boundaries nearest the 3,500-word target.
3. Existing source-unit boundaries.

Name these sections using their authored context:

- Use the lower-level heading when one exists.
- Otherwise use `<Authored chapter> - Part 1`, `Part 2`, and so on.

This requires representing text/block offsets if one source slice itself exceeds
the hard maximum. Add block or word-range boundaries to `ChapterSlice` rather
than copying text into the plan. Slice resolution must remain deterministic.

### 6. Final Validation

Before accepting a plan, verify:

- All source-unit ordinals are covered exactly once.
- Section source ranges are monotonic and non-overlapping.
- Every section has a non-empty title and at least one source slice.
- Estimated word totals before and after reformation match.
- No generated section exceeds the hard maximum unless a single indivisible
  source unit exceeds it; log that case explicitly.

Fail with a useful diagnostic rather than silently reverting to hundreds of raw
spine chapters.

## Reader Presentation

Replace per-row provenance labels with reader-facing structure.

- Remove `Recovered`, `Document heading`, `Publisher contents`, and `Combined by
  XYZ` from every chapter row.
- Display the reading-section title as the row's primary label.
- Show a single book-level note only when `structureMode !== 'authored'`:
  `This edition used page-based structure. XYZ grouped it into 17 reading
  sections.`
- For hybrid books, group generated child sections under their authored parent
  title when practical. If grouping is deferred, retain `authoredGroupTitle` so
  it can be added without re-ingestion.
- Change the Contents count from `chapters` to `sections` for generated books.
  Authored books may continue to say `chapters`.
- Keep the existing info tooltip for analysis chunks separate and rename its
  copy so it describes analysis/recap ranges, not recovered book structure.

Update `Sidebar.utils.ts`, `Sidebar.tsx`, and their tests. Delete
`getChapterStructureLabel` after all usages are removed.

## Pipeline Integration

1. `buildEpubStructurePlan` extracts source evidence and source units.
2. A format-independent normalizer creates `ReadingSectionPlan[]`.
3. `EpubIngestReader.prepareInitial` returns normalized sections and metadata.
4. `initialIngest` creates placeholders only for normalized sections.
5. `loadChapters` resolves section slices to text.
6. Cleaning and RSVP tokenization operate on resolved section text as today.
7. `chunkText(..., 2500)` creates analysis chunks inside a reading section. Rename
   the `subchapters` concept in a later isolated migration; do not make it part
   of this structural algorithm.

PDF, Markdown, and plain-text readers should eventually emit `SourceUnit[]` and
use the same normalizer. Land EPUB first, then move each reader behind the shared
contract with format-specific tests.

## Existing Book Migration

Changing section boundaries changes chapter IDs, saved positions, highlights,
TTS positions, scheduler tasks, and global-summary chapter references.

Implement migration deliberately:

1. Store `structureVersion` on newly imported books.
2. Initially apply the new model to new imports and explicit re-imports.
3. Add a `Reformat book` action for old books that still have a raw file.
4. Before rebuilding, convert chapter-local positions and highlights to global
   word offsets.
5. Re-ingest from the retained raw file using the new structure version.
6. Map global offsets into the new section IDs and local word indexes.
7. Remap reading position, highlights, TTS position, and global-summary endpoint
   chapter IDs.
8. Cancel old scheduler tasks and discard stale per-chapter analysis whose ranges
   no longer match.
9. Keep a backup until the new book, chapters, and reading state commit
   successfully. Do not partially replace a book.

Automatic background migration can follow only after the explicit path is
covered by integration tests.

## Implementation Sequence

### Phase 1: Pure Normalizer

- Extract source-unit and section types from `structure.ts` if that improves
  testability.
- Implement generic-title detection and structural-mode selection.
- Implement grouping, final-bucket rebalance, naming, and plan validation.
- Replace the existing tiny-only `normalizeChapterGranularity` behavior.
- Keep valid TOC and heading plans unchanged unless an authored chapter exceeds
  the oversized threshold.

### Phase 2: Gift Fixture and Corpus

- Add a focused opt-in integration test using
  `books/giftformsfunctio00maus.epub`.
- Run the six-book downloaded Gutenberg corpus.
- Emit one JSON diagnostic per book with input units, output sections, mode,
  reasons, and min/median/max section words.
- Fix parser defects revealed by the corpus; do not weaken assertions solely to
  make unusual books pass.

### Phase 3: Persistence and Pipeline

- Thread ownership, reason, authored group, and structure version through reader
  types, placeholders, resolved chapters, and final chapter patches.
- Update RxDB runtime schemas and migrations.
- Verify image cues and global word indexes across merged sections.

### Phase 4: Contents UI

- Remove repeated `Recovered` labels.
- Add one book-level reformatted-structure explanation.
- Render generated section names and authored grouping.
- Keep keyboard, handoff, progress, and accessibility behavior intact.

### Phase 5: Existing Imports

- Add explicit atomic reformatting and global-offset remapping.
- Add automatic migration only after explicit migration is stable.

### Phase 6: Other Formats

- Route PDF pages through the same normalizer.
- Route Markdown heading blocks through it while preserving authored headings.
- Route plain text paragraph blocks through it.
- Remove format-specific assumptions that a page or input file equals a chapter.

## Test Matrix

### Pure Unit Tests

- 150 generic spine units of 350-450 words become approximately 12-25 sections.
- Generated titles are sequential and deterministic.
- No source-unit marker is duplicated, omitted, or reordered.
- A short final bucket is rebalanced without crossing the hard maximum.
- A single oversized source unit is retained and reported.
- Two valid authored chapters remain two authored groups.
- A short named dedication remains intentional structure.
- A 15,000-word authored chapter splits while retaining its parent title.
- Broken/reversed TOC fragments continue to use current validation behavior.
- Image-only units retain their ordering and cue relationship.

### Gift EPUB Acceptance Test

For `giftformsfunctio00maus.epub`:

- Input is recognized as page-based/generated structure.
- Output contains substantially fewer than 152 sections; expected range is
  12-25 with the initial thresholds.
- Titles are `Section N`, not `Chapter N`, `Page N`, or `Recovered`.
- Total readable word count matches the pre-reformation plan.
- Every `page_*.html` readable slice appears once and in order.
- Every resolved section contains readable text.
- Median generated section size is between 2,000 and 5,000 words.
- The Contents UI shows the book-level explanation once and never shows
  `Recovered`.

### Regression Tests

- Existing TOC fragment, heading fallback, artifact filtering, and image tests.
- `npm run test:epub-corpus` against repository EPUBs, with malformed archives
  reported separately from structure failures.
- `npm run gutenberg:corpus -- --count=6 --seed=xyz-epub-corpus`.
- Reader navigation across section boundaries.
- Global word-index calculations before and after reformatted boundaries.
- Handoff, highlight, TTS, and reading-position remapping during reformatting.

## Observability

Keep corpus diagnostics concise and machine-readable:

```json
{
  "file": "giftformsfunctio00maus.epub",
  "mode": "generated",
  "sourceUnits": 152,
  "readingSections": 17,
  "reasons": { "page-sequence": 17 },
  "words": { "total": 57610, "min": 2810, "median": 3420, "max": 4870 }
}
```

Add an inspection command that runs one local EPUB through planning without
persisting it. It should print section titles, word counts, source paths, and
reformation reasons. This becomes the fastest debugging loop for new fixtures.

## Definition of Done

- The gift EPUB meets every fixture acceptance criterion.
- No readable text is lost, duplicated, or reordered across the tested corpus.
- Valid authored TOC/heading books preserve meaningful titles and boundaries.
- Reader rows contain useful titles and no repeated `Recovered` label.
- New metadata survives a real RxDB round trip.
- New imports work end to end without AI availability.
- Existing-book reformatting preserves reading position and highlights in an
  integration test before automatic migration is enabled.
- Focused tests, the regular non-interactive suite, lint, and the downloaded
  Gutenberg corpus all pass.