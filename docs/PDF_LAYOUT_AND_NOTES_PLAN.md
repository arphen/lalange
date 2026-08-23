# PDF Layout And Contextual Notes Plan

## Status

- Partially implemented as of 2026-08-23. `pdfLayout.ts`, `pdfNotes.ts`, and
   their tests now provide geometry-based layout and note extraction/linking
   foundations.
- Broader multi-column corpus validation, note presentation policy, and the
   remaining source-map and inspection work are still future work.

## Goal

Make difficult scanned scholarly PDFs readable without flattening each page into
one top-to-bottom word stream. Preserve the main argument in its intended
reading order, retain footnotes and endnotes as first-class text, connect notes
to the passages they annotate when evidence is strong, and present those notes
at a useful moment in the RSVP reader without forcing the reader through every
note inline.

The motivating material is scanned Lacan and Lacan-adjacent scholarship, where
pages may contain multiple columns, bottom-of-page notes, translator notes,
marginal material, formulas, diagrams, French terms, and references that matter
to the argument. Production logic must remain document-generic. Do not encode a
private PDF filename, a fixed page number, or a phrase from one book.

This plan extends `docs/PDF_ON_DEVICE_OCR_PLAN.md`. It does not replace the
existing local OCR work.

## Reader Outcome

The completed experience should behave like this:

1. The body of a page is read in column and paragraph order, not raw OCR order.
2. Running heads, folios, and bottom notes do not interrupt the body stream.
3. A note callout remains attached to the body position where it occurs.
4. When playback reaches that position, the reader shows a compact note cue and
   the relevant note preview in the context area.
5. The reader may open, dismiss, defer, or explicitly read the full note.
6. Continuing closes the preview and resumes at the following body token.
7. Every extracted note remains available in a Notes view, including notes that
   could not be linked confidently.
8. The original page number, geometry, extraction source, and confidence remain
   available for inspection.

The default must support close reading without making every citation part of the
RSVP stream. Retention and presentation are separate policies: hiding a cue must
never delete the note data.

## Non-Negotiable Requirements

1. Never determine reading order by sorting every word only by `y`, then `x`.
2. Preserve word geometry from both PDF text layers and local OCR until page
   regions, lines, columns, body blocks, and note blocks have been resolved.
3. Select one extraction candidate per page region. Do not concatenate an
   embedded text layer and whole-page OCR output.
4. Keep body text, note text, callouts, running furniture, captions, and unknown
   regions distinct until after classification.
5. Never discard a likely note because it cannot be linked to a callout.
6. Never classify all small text, all bottom text, or all superscripts as notes.
7. Preserve mathematical notation, Lacanian mathemes, French diacritics, Greek,
   symbols, and intentional typography. `S(Ⱥ)`, `$`, `a`, exponents, and diagram
   labels are not reference markers merely because they are spatially unusual.
8. Note extraction and linking must be deterministic and local. A local model may
   later help label uncertain material, but it must not be the source of truth.
9. Main-body token indexes must remain stable after notes are attached so reading
   progress, highlights, TTS, summaries, and device exchange do not drift.
10. All pages and all accepted regions must be accounted for exactly once.
11. Uncertain decisions must degrade to retained, inspectable content rather than
    silent deletion or invented links.
12. PDF bytes, rendered pages, OCR text, note text, and diagnostics remain local.

## Current Repository State

Useful foundations already exist:

- `pdfjsAdapter.ts` extracts embedded text and renders empty-text pages for OCR.
- `pdfOcrAdapter.ts` already returns OCR words with bounding boxes, block IDs,
  line IDs, confidence, and language.
- OCR runtime, WASM, and English data are served from `/ocr-assets/` and cached
  from the app's own origin.
- `contentQuality.ts` has a document-profile stage and an initial `notes` content
  zone for EPUB material.
- `cleaning.ts` and `tokenize.ts` recognize reference-like tokens and can replace
  them with `[ref]`.
- `Reader.tsx` already renders `[ref]` as a brief `REF` state and has upper and
  lower context rivers that can host a contextual note preview.
- Chapters have stable word indexes, subchapter ranges, highlights, and reading
  state.

The gaps are structural:

- `pdfjsAdapter.ts` flattens text items before preserving their coordinates.
- OCR word boxes are discarded as soon as `ocrResult.text` is selected.
- Every PDF page becomes only `{ pageNumber, label, text }`.
- The current reference cleaner destroys identity. Several different markers
  become the same inert `[ref]` token.
- A chapter stores only `content: string[]`; it has nowhere to persist notes,
  anchors, page regions, or source mappings.
- The boolean `footnoteSuppressor` conflates extraction, retention, and display.
- The reader knows that a token resembles a reference but cannot retrieve the
  note that belongs to it.

The central correction is: **resolve layout and note relationships before text
cleaning and RSVP tokenization**.

## Why Naive Page Order Fails

A physical page is a two-dimensional composition, not a string. Sorting all OCR
words from top to bottom can produce sequences such as:

```text
left-column line 1
right-column line 1
left-column line 2
right-column line 2
footnote 1
folio
footnote 2
```

The intended order may instead be:

```text
left body column, top to bottom
right body column, top to bottom
body callout -> linked note relationship
notes retained outside the body stream
```

Position is evidence, not the decision. A bottom block may be a footnote, a
caption, a continuation of the body, or a running footer. A small elevated token
may be a note callout, an exponent, a formula, or part of a diagram. Classification
must combine geometry, typography, lexical structure, recurrence, and matching
evidence.

## Terminology

- **Word**: A text item with a bounding box and extraction metadata.
- **Line**: Words sharing a baseline and reading direction.
- **Block**: Related lines separated from neighbors by whitespace or indentation.
- **Region**: A page-level semantic candidate such as body, note, caption, or
  running furniture.
- **Callout**: A body marker that may point to a note.
- **Note entry**: One footnote, endnote, translator note, or editorial note.
- **Anchor**: A stable relationship from a body token boundary to a note entry.
- **Unlinked note**: A retained note entry without a sufficiently confident body
  anchor.
- **Source map**: The relationship from persisted body/note tokens back to page
  coordinates and extraction candidates.

## Target Pipeline

```text
PDF bytes
  -> PDF.js document session
  -> page text runs with geometry
  -> local OCR words with geometry when needed
  -> select one candidate per page/region
  -> normalized layout words
  -> line clustering
  -> block segmentation
  -> column and region inference
  -> classify body | note | caption | furniture | figure | unknown
  -> body reading-order graph
  -> note-entry segmentation
  -> body callout detection
  -> callout-to-note matching with confidence
  -> page-level content quality and furniture cleanup
  -> body text tokenization with stable source positions
  -> notes and anchors persisted beside body tokens
  -> contextual note presentation in Reader
```

Do not flatten to a plain page string before the region and relationship stages
are complete.

## Proposed Data Model

Use page-normalized coordinates in the inclusive range `0..1`. Keep original
pixel or PDF coordinates only in adapter-local data. This lets embedded text and
OCR share one layout implementation and makes tests independent of DPI.

```ts
export interface PdfBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface PdfLayoutWord {
    id: string;
    pageNumber: number;
    text: string;
    box: PdfBox;
    baseline: number;
    confidence?: number;
    fontName?: string;
    fontSize?: number;
    direction: 'ltr' | 'rtl' | 'ttb';
    source: 'embedded' | 'ocr';
    sourceBlockId?: string;
    sourceLineId?: string;
}

export interface PdfLayoutLine {
    id: string;
    pageNumber: number;
    words: PdfLayoutWord[];
    box: PdfBox;
    baseline: number;
    medianWordHeight: number;
    text: string;
}

export type PdfRegionRole =
    | 'body'
    | 'footnote'
    | 'endnote'
    | 'marginal-note'
    | 'caption'
    | 'heading'
    | 'running-furniture'
    | 'figure'
    | 'unknown';

export interface PdfLayoutRegion {
    id: string;
    pageNumber: number;
    role: PdfRegionRole;
    lines: PdfLayoutLine[];
    box: PdfBox;
    columnIndex?: number;
    confidence: number;
    evidence: string[];
}

export interface PdfNoteEntry {
    id: string;
    kind: 'footnote' | 'endnote' | 'translator-note' | 'editor-note' | 'unknown';
    label?: string;
    text: string;
    pageStart: number;
    pageEnd: number;
    sourceRegionIds: string[];
    confidence: number;
    issues: string[];
}

export interface PdfNoteAnchor {
    id: string;
    noteId: string;
    chapterId: string;
    wordIndex: number;
    sourcePage: number;
    markerText?: string;
    confidence: number;
    evidence: string[];
}

export interface PdfSourceSpan {
    chapterId: string;
    startWordIndex: number;
    endWordIndex: number;
    pageNumber: number;
    regionId: string;
    box: PdfBox;
}
```

Every ID must be deterministic. Derive it from document extraction version,
page number, role, source region, and source ordinal rather than `crypto.randomUUID()`.
Stable IDs are required for resume, re-ingestion comparison, highlights, and
device exchange.

## Phase 1: Preserve Geometry

### Embedded Text

Replace the current string-only `PdfTextItem` with the relevant PDF.js fields:

- `str`, `transform`, `width`, `height`, `dir`, `fontName`, and `hasEOL`;
- page viewport width, height, rotation, and transform;
- font metadata where PDF.js exposes it reliably.

Normalize each item to page coordinates. Preserve raw item order for diagnostics,
but do not treat it as reading order.

### OCR Text

Retain every `PdfOcrWord` returned by Tesseract. Convert its canvas box back to
normalized page coordinates. Preserve Tesseract block and line IDs as evidence,
not authority: poor scans can produce incorrect block grouping.

### Candidate Selection

Keep the existing rule that clean embedded prose avoids OCR. When a text layer
is sparse or corrupt, OCR the page and score both candidates. If the page has a
usable body text layer but missing note glyphs, allow **region OCR** as a later
optimization; never concatenate whole-page candidates.

The first implementation may select one candidate for the whole page. The data
model must still permit region-level selection without a migration.

### Focused Check

Add adapter tests proving that embedded runs and OCR words produce equivalent
normalized boxes on the same synthetic page. Assert rotations of `0`, `90`,
`180`, and `270` degrees.

## Phase 2: Build A Deterministic Layout Graph

Create `src/core/ingest/readers/pdfLayout.ts` as a pure module. It must not
import PDF.js, Tesseract, React, RxDB, or Zustand.

### Line Clustering

1. Partition words by page and direction.
2. Estimate the page's median word height from robust percentiles.
3. Join words whose baseline distance and vertical overlap fall within named
   tolerances.
4. Split lines at persistent horizontal gaps, direction changes, or incompatible
   sizes.
5. Sort words within a line according to direction.
6. Reconstruct spaces from box gaps relative to local character width.

Do not use one global pixel threshold. Thresholds must scale with local median
word height and have boundary tests.

### Block Segmentation

Group neighboring lines using:

- vertical gap relative to line height;
- horizontal overlap;
- shared left edge or indentation pattern;
- compatible font/word height;
- punctuation and sentence continuation;
- Tesseract block identity as weak supporting evidence.

Headings, centered lines, display formulas, and captions should remain separate
blocks rather than being forced into the nearest paragraph.

### Column Detection

Detect columns before sorting blocks:

1. Build an occupancy profile across the page width using body-sized lines.
2. Find persistent vertical gutters supported across multiple line bands.
3. Cluster blocks by horizontal overlap and gutter boundaries.
4. Reject a gutter hypothesis that exists only around one short heading or
   figure.
5. Permit a full-width heading followed by two columns.
6. Permit a two-column body followed by a full-width footnote region.

For left-to-right documents, traverse body columns left to right and lines top
to bottom within each column. For right-to-left documents, reverse the column
order. Full-width headings enter the graph before the columns they introduce.

### Reading-Order Graph

Represent ordering as graph edges between regions and blocks, then topologically
sort. This is easier to inspect than one opaque comparator and can express:

```text
full-width heading -> left body column -> right body column
body columns -> page continuation
body callout -> note relationship (not a body-order edge)
```

Footnotes, marginal notes, captions, and running furniture must not become body
successors simply because they are lower on the page.

### Safe Fallback

If column inference is ambiguous:

- choose the simplest stable body order with the highest overlap evidence;
- retain uncertain blocks as `unknown` regions;
- emit diagnostics;
- never interleave columns line by line.

## Phase 3: Classify Note Regions

Create `src/core/ingest/readers/pdfNotes.ts` as another pure module. Region
classification should produce evidence and confidence, not just a boolean.

### Footnote Region Evidence

Positive signals include:

- the region begins below most body content;
- its median word height is smaller than the local body median;
- a horizontal separator or strong whitespace boundary appears above it;
- lines use hanging indentation;
- entries begin with compact labels such as `1`, `2.`, `*`, `†`, or Roman
  numerals;
- matching callout candidates occur in body regions;
- note-like regions recur in a consistent page zone and style;
- prose contains bibliographic patterns, page references, quoted source titles,
  or compact citation syntax;
- the block continues a note from the preceding page.

Negative signals include:

- body-sized text continuing the same paragraph across the boundary;
- a figure directly above with caption-like syntax;
- mathematical alignment, equation numbering, or diagram labels;
- a single short folio or running footer;
- a bottom paragraph sharing the body column, font size, and indentation;
- poetry, numbered lists, or seminar formulas whose numbering has no matching
  note region.

Require multiple independent positive signals. Bottom position alone and small
type alone are insufficient.

### Marginal Notes

Treat narrow outer-margin blocks separately. Possible marginal-note evidence:

- stable placement outside the body column;
- smaller size and short line length;
- a leader line or nearby body callout;
- repeated editorial style across pages.

Do not automatically read marginal notes in the body stream. Retain them in the
Notes view and link them when evidence supports an anchor.

### Endnote Sections

Detect document-level note zones from coherent headings such as `Notes`,
`Translator's Notes`, or chapter-specific notes, followed by repeated entries.
Endnote classification must use several pages of evidence and chapter/page
labels where available. A paragraph discussing “notes” is not an endnote zone.

Keep endnote sections out of the main argument stream by default, but retain all
entries and make them navigable as an authored section.

### Running Furniture And Captions

Run the document-level recurring-edge analysis before final note classification.
A repeated footer is furniture, not a footnote. A short block adjacent to a
figure with no callout match is more likely a caption. Keep captions associated
with figure cues rather than with notes.

## Phase 4: Segment Note Entries

A note region may contain one note, several notes, or a note continued from the
previous page. Segment entries using:

- explicit leading labels;
- hanging indent changes;
- line spacing and paragraph boundaries;
- monotonically advancing note labels;
- lexical continuation when a page starts without a new label;
- chapter/endnote heading context.

Preserve paragraph boundaries inside a note. Do not collapse several citations
into one string merely because they share a bottom region.

### Continued Notes

Support these cases explicitly:

- a footnote begins on page `N` and continues at the top or bottom of `N + 1`;
- the continuation has no repeated marker;
- an endnote entry spans multiple pages;
- numbering restarts at each chapter;
- symbols (`*`, `†`, `‡`) are reused on later pages.

Continuation requires style compatibility, boundary position, sentence
incompleteness, and sequence evidence. If confidence is low, keep two retained
entries and mark them `possible-continuation`; do not silently merge them.

## Phase 5: Detect Callouts Without Damaging Formulas

Callout candidates come from geometry before text regexes.

### Embedded Callouts

Use relative baseline and font size to identify compact elevated text attached
to a body line. Preserve the exact marker text and its position between body
words.

### OCR Callouts

Use small bounding-box height, elevated baseline, proximity to a body word, and
marker shape. OCR may merge a callout into punctuation or the preceding word, so
also inspect short suffixes when a matching note label exists.

### False-Positive Protection

Do not classify a candidate as a callout when it is plausibly:

- an exponent or subscript in an equation;
- part of `S1`, `S2`, `a`, `$`, `Ⱥ`, a fraction, or another matheme;
- an ordinal, date, section number, page range, or list label;
- inside a URL, identifier, bibliography entry, or diagram region;
- a standalone symbol with no candidate note entry.

No note candidate means no destructive callout normalization. Preserve the
original body token and record the unresolved candidate only in diagnostics.

## Phase 6: Link Callouts To Notes

Build candidate edges between body callouts and note entries, then score them.
Do not greedily consume the first matching number.

### Matching Evidence

Score:

- exact normalized marker match;
- same-page footnote region;
- callout and note sequence consistency;
- geometric proximity within the page;
- chapter-local numbering scope;
- note style consistency across neighboring pages;
- symbol-series order (`*`, `†`, `‡`);
- endnote heading/chapter correspondence;
- explicit page references in an endnote entry;
- whether an alternative match would cross already established monotonic links.

### Confidence Tiers

- **High**: Persist an active anchor and show it contextually during reading.
- **Medium**: Persist a tentative anchor, show a subdued “possible note” cue,
  and keep the note in the page Notes list.
- **Low**: Persist no anchor. Retain the callout text and the unlinked note.

Use named thresholds and save evidence with every link. Never invent a link to
make coverage reach 100%.

### Global Assignment

Use a deterministic maximum-weight, monotonic matching pass within a page or
chapter. This avoids linking several body callouts to the first note labeled `1`
and supports numbering that restarts in later chapters.

## Phase 7: Produce Separate Body And Note Streams

After layout and links are resolved:

1. Clean body regions with the shared content-quality path.
2. Clean note entries independently, preserving citation punctuation and note
   labels as metadata rather than body tokens.
3. Tokenize only body text into the chapter's primary `content` array.
4. Build source spans while tokenizing so page and region provenance survives.
5. Convert a linked callout to an anchor at a token boundary; do not insert an
   ambiguous `[ref]` into body text.
6. Persist note text and optional note tokens separately.
7. Keep captions and figure cues on their existing non-body path.

Main-body word indexes must not include note words. This keeps reading progress,
highlights, summaries, density arrays, and TTS aligned.

The old `[ref]` token remains valid for legacy EPUB or unstructured content, but
structured PDF anchors should render from `noteAnchors`, not token text.

## Persistence And Migration

Extend `ChapterDocType` with optional structured fields:

```ts
notes?: PdfNoteEntry[];
noteAnchors?: PdfNoteAnchor[];
sourceSpans?: PdfSourceSpan[];
noteDiagnostics?: {
    unlinkedNoteIds: string[];
    unresolvedCallouts: number;
    uncertainRegionIds: string[];
};
```

Use a generic name such as `notes`, not `pdfNotes`, if EPUB structured notes will
share the same reader behavior. Keep PDF-specific geometry in source metadata.

The chapter schema is already versioned. Adding persisted fields requires:

1. incrementing the chapter schema version;
2. adding every required migration strategy;
3. migrating old chapters to absent or empty optional note fields without
   changing existing content indexes;
4. adding a persisted old-schema close/reopen regression;
5. updating device-exchange serialization intentionally;
6. checking replication document size for long scholarly note sections.

Do not place all page-layout diagnostics in chapter documents by default. Store
the compact reader contract permanently and keep verbose word boxes in ingest
checkpoints or an optional inspection collection.

## Reader Presentation

### Replace The Boolean Policy

Replace `footnoteSuppressor` with separate settings:

```ts
notePresentation: 'guided' | 'markers' | 'notes-only';
noteAutoPause: boolean;
includeNotesInTts: boolean;
```

- **Guided**: show the relevant preview at a high-confidence anchor.
- **Markers**: show a compact cue; open the note only on request.
- **Notes only**: do not interrupt the body, but retain the complete Notes view.

Migration from the old boolean:

- `footnoteSuppressor: true` -> `notes-only`;
- `footnoteSuppressor: false` -> `guided`.

Extraction always retains notes regardless of these settings.

### Contextual Preview

When `currentWordIndex` reaches a high-confidence anchor:

1. Render a compact note indicator near the RSVP focus word.
2. Show the note label and a bounded preview in the lower context river.
3. If `noteAutoPause` is enabled, pause after the body token rather than before
   it, so the sentence fragment remains intelligible.
4. Provide familiar icon controls with tooltips to open, defer, and dismiss.
5. Opening the note uses an unframed side sheet or bottom sheet, not a modal card
   nested inside the reader.
6. Resuming returns to the next body token and never advances the body index by
   the number of note words.

Do not replace the focus word with the entire note. The note is contextual
material adjacent to the body stream.

### Full Note View

The expanded view should show:

- full note text and paragraphs;
- note label and kind;
- originating page number;
- linked body excerpt with the anchor highlighted;
- previous/next note navigation;
- an “unlinked” or “possible match” state when appropriate;
- an optional source-page crop for inspection, generated locally on demand;
- an explicit “Read note” command for RSVP or TTS playback.

For RSVP note playback, use a temporary note stream with its own index. Preserve
the body index and restore it on close. Do not add note tokens to chapter
progress or density arrays.

### Context Rivers

Annotate body words in the upper and lower rivers with accessible note buttons.
Clicking a cue pauses playback and opens its note. Imperative `innerHTML`
rendering must use precomputed safe markup or React-managed overlays; never
inject OCR note HTML.

### Notes View

Add a `Notes` tab beside the chapter contents surface containing:

- linked notes in body order;
- unlinked notes grouped by source page;
- endnotes grouped by authored chapter when known;
- extraction confidence and issue indicators only when useful;
- navigation back to the body anchor.

This is the no-loss escape hatch. Even imperfect linking must leave the scholarly
apparatus usable.

### TTS, Summaries, And Pacing

- Exclude notes from body TTS by default.
- When requested, read one note and return to the body position.
- Exclude note text from body density and summary chunks unless a future explicit
  scholarly mode requests it.
- A note anchor may add a small configurable dwell, but note length must not slow
  unrelated body tokens.
- Summaries may cite that notes exist, but must not silently merge note claims
  into the author's body argument.

## Diagnostics And Inspector

Extend the planned PDF inspector with layout and note records:

```json
{
  "page": 24,
  "regions": [
    { "id": "p24-r0", "role": "body", "column": 0, "confidence": 0.96 },
    { "id": "p24-r1", "role": "body", "column": 1, "confidence": 0.94 },
    { "id": "p24-r2", "role": "footnote", "confidence": 0.91 }
  ],
  "bodyOrder": ["p24-r0", "p24-r1"],
  "notes": [
    { "id": "p24-n1", "label": "3", "linked": true, "confidence": 0.93 }
  ],
  "unresolvedCallouts": 0,
  "unlinkedNotes": 0,
  "issues": []
}
```

Support optional local visual overlays showing boxes, line clusters, columns,
region roles, reading-order arrows, and anchor links. Never commit rendered pages
from private books. Diagnostics should default to counts and bounded samples.

## Implementation Sequence

### Phase 0: Characterize Without Hard-Coding

1. Keep target PDFs under ignored `books/`.
2. Record page dimensions, rotations, scan DPI, text-layer coverage, and note
   styles for representative opening, middle, and closing pages.
3. Record whether numbering is page-local, chapter-local, or global.
4. Identify two-column, full-width, footnote-heavy, formula-heavy, diagram, and
   continued-note pages.
5. Save only generic observations and synthetic derivatives in committed tests.

### Phase 1: Geometry Contract

1. Extend PDF.js extraction to retain transforms and page geometry.
2. Normalize embedded and OCR boxes into one type.
3. Preserve selected word boxes in parsed page results.
4. Add rotation and scale-invariance tests.
5. Keep current plain-text output as a compatibility projection.

### Phase 2: Lines, Blocks, And Columns

1. Implement pure line clustering.
2. Implement block segmentation.
3. Implement gutter/column inference.
4. Implement the reading-order graph and safe fallback.
5. Verify no test interleaves two columns line by line.

### Phase 3: Region Roles And Note Entries

1. Add recurring furniture evidence.
2. Add body, note, caption, marginal-note, and unknown classification.
3. Segment same-page footnote entries.
4. Detect endnote zones and continued notes.
5. Retain all uncertain note candidates.

### Phase 4: Callouts And Linking

1. Detect geometry-based embedded callouts.
2. Detect OCR callout candidates.
3. Add formula and matheme counterexamples.
4. Implement scored monotonic matching.
5. Persist confidence and evidence.

### Phase 5: Canonical Body And Notes

1. Run body and notes through separate quality-cleaning calls.
2. Build stable body tokens and source spans.
3. Build note entries and body anchors.
4. Preserve old `[ref]` behavior only as a fallback.
5. Add complete page/region/note accounting guards.

### Phase 6: Persistence

1. Add optional chapter note, anchor, and source-span fields.
2. Increment the RxDB chapter schema version.
3. Add complete migrations and persisted reopen coverage.
4. Update exchange and replication tests.
5. Measure chapter document sizes with note-heavy books.

### Phase 7: Reader Experience

1. Add the three note-presentation modes.
2. Add contextual preview and optional auto-pause.
3. Add full note reading with body-index restoration.
4. Add the Notes view and unlinked-note group.
5. Integrate note cues into context rivers, mobile layout, TTS, and keyboard
   navigation.
6. Add accessible labels, focus management, reduced-motion behavior, and screen
   reader announcements.

### Phase 8: Target Acceptance And Tuning

1. Run the inspector on representative private PDFs.
2. Inspect every low-confidence region and link before changing thresholds.
3. Tune only named, generic thresholds.
4. Measure body-order accuracy, note recall, link precision, OCR time, and memory.
5. Verify warmed offline behavior and local-only network invariants.

## Synthetic Test Corpus

Generate small redistributable PDFs rather than committing private pages:

1. Single-column body with two numbered bottom footnotes.
2. Two-column body with one full-width footnote region.
3. Full-width heading followed by two body columns.
4. A body paragraph continuing into the bottom quarter with no notes.
5. Bottom figure caption that must not become a footnote.
6. Marginal translator note linked to a symbol callout.
7. Footnote continued onto the next page.
8. Endnotes with numbering restarted by chapter.
9. A page containing exponents, section numbers, dates, and list labels but no
   notes.
10. A formula/matheme page containing `$`, `S1`, `S2`, `S(Ⱥ)`, `a`, superscripts,
    subscripts, Greek, and diagram labels.
11. Mixed embedded body text and scanned note region.
12. Rotated pages and right-to-left column direction.
13. A blank page, illustration page, and one failed OCR page between prose pages.
14. OCR damage that loses one callout while preserving its note.
15. Duplicate marker labels on different chapters and pages.

Each fixture must carry an expected region graph, body order, note entries, and
anchor set. Text assertions should use durable anchors rather than exact OCR
punctuation.

## Unit Tests

### Layout

- Cluster words into lines across varying DPI and page sizes.
- Preserve punctuation and direction within lines.
- Detect one, two, and mixed-width column layouts.
- Keep full-width headings before columns.
- Never interleave left and right column lines.
- Keep formulas and captions as distinct blocks.
- Produce deterministic IDs and order across repeated runs.

### Note Classification

- Detect bottom notes only when several signals agree.
- Preserve a bottom body paragraph.
- Distinguish a caption and repeated footer from a footnote.
- Detect marginal and endnote regions.
- Split multiple entries and preserve multiline paragraphs.
- Join only high-confidence continued notes.
- Retain medium-confidence candidates as inspectable notes.

### Linking

- Link exact same-page numeric markers.
- Handle symbol sequences and chapter-local numbering resets.
- Match endnotes monotonically within chapter scope.
- Preserve formulas, years, ordinals, and mathemes as body text.
- Leave ambiguous callouts and notes unlinked.
- Never attach two unrelated callouts to one note unless repeated references are
  explicitly supported and evidenced.

### Persistence

- Keep body word indexes unchanged when notes are added or presentation changes.
- Migrate a persisted previous-schema database on close/reopen.
- Exchange notes and anchors without geometry loss required by the reader.
- Resume ingestion without duplicating note IDs or anchors.

### Reader

- Show a preview at the correct word index.
- Auto-pause after the anchored body token when enabled.
- Dismiss and resume at the next body token.
- Read a note in a temporary stream and restore the body index.
- Navigate linked and unlinked notes.
- Keep notes available in `notes-only` mode.
- Avoid changing body progress, density, or summary ranges.
- Work in desktop and compact landscape layouts without overlap.

## Integration And Browser Tests

Use non-interactive commands:

```sh
npx vitest run \
  src/core/ingest/readers/pdfLayout.test.ts \
  src/core/ingest/readers/pdfNotes.test.ts \
  src/core/ingest/readers/pdfReader.test.ts \
  src/core/ingest/readers/pdfOcrAdapter.test.ts

npx vitest run \
  src/core/sync/db.test.ts \
  src/components/Reader/Reader.test.tsx

npx playwright test e2e/pdf-notes.spec.ts --project=chromium
npm run lint
npm run build
```

The Playwright journey should:

1. import a generated two-column scanned PDF;
2. wait for local OCR and layout resolution;
3. open the body at a known anchor;
4. prove the next body words come from the correct column;
5. reach a note cue;
6. open the linked note and verify its durable text anchor;
7. resume at the next body word;
8. open the Notes view and find an intentionally unlinked note;
9. repeat after reload;
10. warm OCR assets, switch offline, and repeat without remote requests.

## Quality Metrics

Measure the system with separate metrics. A single “OCR accuracy” number hides
the failures that matter to reading.

- **Body-order accuracy**: expected adjacent body block pairs recovered.
- **Body contamination**: note/furniture words incorrectly inserted into body.
- **Note recall**: expected note entries retained.
- **Note precision**: detected entries that are actually notes.
- **Link precision**: active anchors that point to the correct note.
- **Link recall**: expected high-evidence links recovered.
- **No-loss accounting**: all accepted words belong to one body, note, caption,
  furniture, figure, or unknown region.

Prioritize link precision over link recall. A retained unlinked note is usable;
a confidently displayed wrong note is actively misleading.

## Acceptance Criteria For Difficult Scholarly PDFs

1. Two-column body text is read one column at a time in intended order.
2. Footnotes do not appear as the next body paragraph merely because they are
   lower on the page.
3. At least every confidently detected footnote and endnote is retained in the
   Notes view.
4. High-confidence callouts show the correct note at the relevant body position.
5. Medium- and low-confidence material remains inspectable and is never silently
   discarded.
6. Formulae, mathemes, diagrams, French, Greek, accents, and meaningful symbols
   survive without being normalized into note markers.
7. Reading a or dismissing a note does not corrupt body progress.
8. Continued notes and numbering resets do not create cross-chapter mislinks.
9. Running heads, footers, folios, and captions remain outside the body stream.
10. Every page and region has one auditable disposition.
11. The same extraction produces deterministic body order, note IDs, and anchors.
12. A warmed installation performs extraction and note display offline with no
   document-derived network request.

## Definition Of Done

- PDF geometry survives from extraction through layout resolution.
- Body reading order is graph-based and covered by multi-column tests.
- Footnotes, marginal notes, and endnotes are retained as structured entries.
- High-confidence body callouts link to the correct notes without damaging
  formula or matheme notation.
- The chapter schema persists notes, anchors, and compact source mappings with a
  complete migration.
- The reader offers guided, marker-only, and notes-only presentation while always
  retaining the full Notes view.
- Note playback restores the exact body position and does not alter body metrics.
- Synthetic layout, linking, migration, reader, offline, privacy, lint, and build
  checks pass.
- Representative private PDFs meet the acceptance criteria without filename,
  page-number, or quote-specific production rules.

## Implementation Execution Brief

Implement one phase at a time. Start with pure geometry and synthetic expected
graphs; do not touch the reader UI until two-column body order and note regions
are deterministic. Preserve all uncertain material, use confidence tiers rather
than forced matches, and keep note retention independent from note presentation.
After every production edit, run the narrowest non-interactive test that can
falsify it. Stop and inspect overlay diagnostics whenever a body paragraph is
classified as a note or a formula token is classified as a callout.