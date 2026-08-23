# EPUB Content Hardening Plan

## Status

- Partially implemented as of 2026-08-23. `contentQuality.ts`, `lineWrap.ts`,
  and their regression tests now provide the quality-analysis and hard-wrap
  foundations described here.
- Full source-unit accounting, recurrence-aware furniture policy, and all
  fixture acceptance criteria remain future work.

## Goal

Prevent low-quality extraction output from reaching the reader without solving
only for one fixture or deleting legitimate typography. The parser should make
an explicit quality decision for every source unit, remove book-level furniture
only when there is repeated evidence, normalize recognized OCR artifacts, and
retain an audit trail of every destructive decision.

The motivating fixture is `books/giftformsfunctio00maus.epub`, but the design
must remain useful for normal EPUBs, other languages, mathematical text, and
books that legitimately contain symbols such as `©`, `®`, `£`, `§`, or `^`.

## Audit Of The Gift EPUB

The file contains several independent failure classes:

| Failure class | Examples found | Required treatment |
| --- | --- | --- |
| Explicit low-confidence OCR pages | `page_0.html` says `0.19% accurate`; `page_161.html` through `page_163.html` say less than `1% accurate` | Reject the whole source unit before section grouping |
| Library and scan matter | Due-date stamps on `page_158.html`; barcode-like text on `page_159.html` | Reject as non-reading matter |
| Publication matter | French title page, English title page, copyright page, contents | Keep useful title metadata, but do not expose these as reading text |
| Running furniture | `8 THE GIFT`, `DISTRIBUTION OF THE SYSTEM 23`, `CONCLUSIONS 69`, and similar alternating headers | Detect recurrence at source-unit edges and strip only there |
| OCR footnote callouts | `ritual.^'`, `property.^*`, `^^`, `^®^`, stray `•`, `®`, `♦`, and `■` between prose and citations | Classify as reference markers under an OCR profile; suppress or compact according to settings |
| Notes section | Bibliographical abbreviations and chapter notes occupy roughly `page_104.html` through `page_152.html` | Treat as editorial notes, not generic trash; include or suppress according to reference settings |
| Hard-wrapped words | `everythin g`, `propert y`, `individ ual` caused by newlines inserted inside words | Repair only high-confidence wrap boundaries before whitespace collapse |
| Corrupted spans | `lackdie^coH©fflie-«iaE ket`, `right_o£^lirsuit^`, `Ti«i€Jias_tOL43ass^` | Score as local OCR corruption; reject a unit if dense, otherwise retain prose and remove only recognized debris |
| Invalid controls | Three `U+007F` characters occur in the text | Remove forbidden control characters unconditionally and count them |

Important audit findings:

- The book has `35` registered-mark glyphs, but in context they are mangled
  superscript note numbers rather than trademarks.
- A global rule that removes `®` would still be wrong. Another book may contain
  `Acme®`, and the same applies to `©`, currency signs, section signs, Greek
  text, and mathematical carets.
- The current gift corpus test requires every `page_*.html` path to survive in
  the reading plan. That invariant preserves known garbage pages and must be
  replaced with accepted-plus-rejected source accounting.
- Cleaning after several pages have been concatenated loses the page-edge and
  recurrence evidence needed to identify headers, footers, and bad scan pages.

## Root Cause

The current pipeline has good publication-structure filtering, but content
quality is split across incompatible stages:

1. `structure.ts` examines individual slices for classification and estimates.
2. `loadPlannedChapterSources` resolves readable HTML again.
3. `pipeline.ts` concatenates all slices in a generated section.
4. `cleanText` applies license, page-number, whitespace, and reference regexes
   to the combined text.

This is too late for page-level quality decisions. It also means structure
estimates and reader output are not guaranteed to use exactly the same cleaned
source text.

## Design Principles

1. Clean source units before grouping them into reading sections.
2. Never use a broad non-ASCII or symbol blacklist.
3. Separate evidence from policy: detect `reference-callout`, `page-furniture`,
   `low-confidence-ocr`, and `unknown-corruption`, then decide what to do.
4. Prefer rejecting a provably unusable source unit over displaying garbage or
   inventing replacement prose.
5. Preserve uncertain text. Do not silently spell-correct or reconstruct words
   when confidence is low.
6. Make destructive cleanup idempotent, deterministic, and observable.
7. Run the same canonical cleaning path for word estimates and final ingestion.
8. Keep editorial notes distinct from OCR trash.

## Target Pipeline

```text
EPUB HTML
  -> slice extraction with source boundaries preserved
  -> HTML semantic cleanup
  -> raw source-unit text with line boundaries preserved
  -> per-unit signal extraction
  -> book-level recurrence analysis
  -> source-unit decision: accept | accept-degraded | reject
  -> conservative OCR normalization
  -> reading-section normalization
  -> final text cleanup and RSVP tokenization
```

Do not concatenate source units until after the quality and furniture stages.

## Proposed Model

Create `src/core/ingest/contentQuality.ts` and keep its public API independent
of EPUB ZIP parsing:

```ts
export type ContentQualityDecision = 'accept' | 'accept-degraded' | 'reject';

export type ContentIssueType =
    | 'low-ocr-confidence'
    | 'scan-matter'
    | 'publication-matter'
    | 'page-furniture'
    | 'reference-marker'
    | 'control-character'
    | 'hard-wrap'
    | 'corrupt-span';

export interface RawContentUnit {
    ordinal: number;
    path: string;
    html: string;
    text: string;
    lines: string[];
}

export interface ContentQualityIssue {
    type: ContentIssueType;
    confidence: number;
    count: number;
    samples: string[];
}

export interface ContentQualityResult {
    decision: ContentQualityDecision;
    cleanedHtml: string;
    cleanedText: string;
    issues: ContentQualityIssue[];
    removedCharacters: number;
    qualityScore: number;
    reason?: string;
}
```

Use a two-pass API:

```ts
const profile = analyzeContentUnits(rawUnits);
const results = rawUnits.map((unit) => cleanContentUnit(unit, profile, options));
```

The first pass gathers repeated edge signatures and document-wide OCR signals.
The second pass makes local decisions using that evidence.

## Detection And Cleanup Rules

### 1. Preserve Raw Boundaries

Extract block and line boundaries before normalizing whitespace. The current
plain `text()` path erases evidence required for hard-wrap and page-edge logic.
Represent paragraph boundaries separately from source-code line wraps.

For EPUBs like the gift fixture, retain the raw newlines inside each `<p>` long
enough to determine whether the producer hard-wrapped text at a fixed column.

### 2. Reject Strong Whole-Unit Artifacts

Reject a source unit without token-level repair when any strong rule matches:

- It contains `The text on this page is estimated to be only X% accurate` and
  `X < 5`.
- It contains that warning with `X < 35` and also has high symbol density, low
  alphabetic-token ratio, or publication/scan-matter evidence.
- It is empty after semantic HTML cleanup and has no image cue needed by the
  reader.
- It is dominated by a barcode-like token, stamp/date fragments, or repeated
  scanner metadata such as `University ... Library`, `DUE`, `RECEIVED`, or
  `ARTS LIBRARY`.
- More than a configured percentage of its tokens are corrupt clusters and it
  has too little continuous prose to recover safely.

Thresholds must be named constants and covered by boundary tests. Do not reject
a source unit based only on one unusual Unicode character.

For rejected units, keep path, reason, score, and short samples in diagnostics.
Do not include their text in section estimates or the reader.

### 3. Detect Repeated Page Furniture

Build normalized signatures from the first and last 3-12 tokens of every
accepted page-like unit:

- Case-fold and normalize whitespace.
- Replace plausible page numbers and Roman folios with `<number>`.
- Keep lexical words; do not remove punctuation from the whole body.
- Consider a signature furniture only when it recurs at the same edge on at
  least three units and has strong support across neighboring units.
- Strip only the matched edge span, never the same phrase in body text.

This should remove `THE GIFT`, chapter running heads, and folios while
preserving one-off chapter headings. Alternating left/right headers must form
separate recurring signatures.

### 4. Normalize OCR Reference Markers Contextually

Extend reference handling with an OCR-aware marker classifier rather than a
list of global substitutions.

A candidate is likely an OCR reference marker when several signals agree:

- It is adjacent to sentence punctuation or a completed word.
- It is a short cluster of carets, quote marks, digits, or symbol glyphs.
- Similar clusters recur throughout the same book.
- The book has a trailing notes section or other footnote evidence.
- The candidate occurs at a prose/citation boundary, not inside a known word,
  URL, formula, brand, currency amount, or copyright line.

Under `referenceHandling: 'suppress'`, remove a recognized callout. Under
`'compact'`, replace it with one `[ref]`. Under `'keep'`, preserve it.

Examples that the gift profile should recognize include `^'`, `^^`, `^*`,
`^®^`, and isolated `®`, `•`, `♦`, or `■` used in the same callout positions.

Examples the generic cleaner must preserve include `x^2`, `Acme®`, `© 2026`,
`£5`, `§ 4`, `C#`, URLs, Greek text, accented names, and intentional bullets.

### 5. Remove Invalid Characters Safely

Unconditionally remove C0/C1 controls other than tab, line feed, and carriage
return, plus `U+007F`, nulls, and isolated Unicode replacement characters when
they carry no recoverable information. Normalize line endings and use NFC for
Unicode normalization.

Do not use NFKD plus ASCII folding on reading text. That would damage names,
non-English prose, mathematical symbols, and composed punctuation.

### 6. Repair Hard-Wrapped Words Conservatively

First detect a fixed-column wrapping profile across source lines. Only attempt
repairs when the source has strong evidence of machine-inserted hard wraps.

For each newline inside a prose block, compare the split and joined forms:

- Join when the concatenated token occurs intact elsewhere in the same book
  and one or both fragments are not observed as standalone words.
- Join when one fragment is a one-character alphabetic shard and the joined
  token is otherwise word-like.
- Preserve the space when both sides are plausible standalone words.
- Preserve hyphenated compounds unless the source uses an end-of-line hyphen
  and the joined form has stronger book-local evidence.
- Record every join and sample in diagnostics.

This book-local evidence is language-neutral and avoids shipping a large
English dictionary. A later language-specific dictionary may improve recall,
but it must not be required for the first implementation.

Do not attempt broad spelling correction in this phase. A misspelled word is
preferable to silently invented prose.

### 7. Handle Corrupt Spans With A Quality Score

Score short sliding windows for:

- control or replacement characters;
- multiple symbol categories embedded in alphabetic tokens;
- underscores between prose words;
- long punctuation runs;
- implausible digit/letter mixtures;
- very low alphabetic-token ratio;
- explicit OCR confidence warnings.

Use the score for unit decisions, not as permission to delete arbitrary spans.
Only remove a span when it matches a recognized class such as a warning,
barcode, callout, or page-furniture signature. Unknown medium-density
corruption should make the unit `accept-degraded`; unknown high-density
corruption should reject the unit.

### 8. Model Notes As A Content Zone

Detect trailing notes from coherent heading runs such as `NOTES`, `CH. I NOTES`,
and `BIBLIOGRAPHICAL ABBREVIATIONS USED IN THE NOTES`. Store a source-zone value
such as `body | notes | publication-matter | rejected-ocr`.

- `keep`: retain note pages and callouts.
- `compact`: omit note pages and replace callouts with `[ref]`.
- `suppress`: omit note pages and remove callouts.

Do not label notes as low-quality OCR merely because they contain many numbers
and citations. The reference setting, not a quality heuristic, controls whether
they appear.

The structure plan must receive the reference mode before it creates section
placeholders, or it will leave empty note sections in the Contents UI.

### 9. Add A Final Output Guard

Before saving chapter tokens, assert and report:

- no forbidden controls remain;
- no rejected OCR warning text remains;
- output is non-empty for an accepted prose section;
- artifact density did not increase during concatenation/tokenization;
- cleaning is idempotent for the resolved text.

The guard should fail ingestion with a useful diagnostic for invariant
violations. It should not silently replace the chapter with an empty array.

## Integration Changes

### `src/core/ingest/contentQuality.ts`

- Add pure signal extraction, document profile, quality scoring, decisions,
  furniture detection, control cleanup, OCR callout handling, and hard-wrap
  repair.
- Keep all thresholds named and exported through test-only helpers where useful.

### `src/core/ingest/cleaning.ts`

- Keep license and generic reference cleanup here.
- Delegate OCR-specific behavior to `contentQuality.ts`.
- Extend `CleaningResult.metadata` with counts for rejected units, furniture,
  OCR markers, controls, corrupt spans, and hard-wrap joins.
- Preserve the existing default behavior for non-OCR plain text.

### `src/core/ingest/structure.ts`

- Build raw units, analyze them as one book, and filter rejected units before
  `normalizeReadingSections`.
- Use canonical cleaned text for `estimatedWords`.
- Replace the gift test's "every page path survives" invariant with:
  every source path appears exactly once in either accepted slices or rejected
  diagnostics.
- Carry source-zone and quality metadata on planned slices or source units.

### `src/core/ingest/readers/epubReader.ts`

- Resolve the already planned quality result rather than independently
  recreating a less-clean version of the same slice.
- Thread the reference mode into planning and loading.

### `src/core/ingest/pipeline.ts`

- Clean each resolved slice before joining section text.
- Aggregate metadata after per-slice cleanup.
- Keep section concatenation, chunking, and RSVP tokenization after the final
  source-unit quality decision.

### `scripts/inspect_epub_quality.mjs`

Add a read-only inspector:

```sh
node scripts/inspect_epub_quality.mjs books/giftformsfunctio00maus.epub
```

It should print one JSON record per source unit with path, zone, score, decision,
issues, removed counts, and short before/after samples, followed by aggregate
counts. It must use production functions rather than duplicate their regexes.

## Implementation Sequence

### Phase 1: Characterization And Quality Gate

1. Add the inspector using the current extraction path.
2. Add unit tests for controls, explicit OCR warnings, scan matter, symbol
   preservation, idempotence, and quality-score boundaries.
3. Implement `contentQuality.ts` with only strong whole-unit rejection and
   invalid-control cleanup.
4. Integrate it before reading-section normalization.
5. Update source accounting so accepted plus rejected paths equals all planned
   source paths exactly once.

Run the focused tests immediately. Do not add symbol substitutions yet.

### Phase 2: Page Furniture

1. Add synthetic alternating-header fixtures.
2. Implement document-level edge signatures.
3. Strip only recurring edge matches.
4. Verify one-off chapter headings and body occurrences are unchanged.
5. Run the gift corpus test and inspect removed samples.

### Phase 3: OCR References And Notes

1. Add real gift-book callout samples and legitimate-symbol counterexamples.
2. Implement the contextual OCR marker classifier.
3. Add body/notes zone detection.
4. Thread `referenceHandling` into structure planning.
5. Test `keep`, `compact`, and `suppress` independently.

### Phase 4: Hard-Wrap Repair

1. Add a raw-line fixture matching the gift producer's fixed-width format.
2. Build the book-local intact-token evidence map.
3. Implement only high-confidence joins.
4. Record joins and verify idempotence.
5. Leave ambiguous boundaries unchanged.

### Phase 5: Final Guard And Observability

1. Add final output invariants before chapter persistence.
2. Aggregate issue counts in ingestion logs.
3. Persist quality metadata only if it is needed after ingestion; if runtime
   schemas change, bump RxDB schema versions and provide complete migrations.
4. Add a concise import warning only when meaningful prose was rejected, with
   counts rather than raw technical details.

## Test Plan

### Unit Tests

Create `src/core/ingest/contentQuality.test.ts` with these cases:

- Reject explicit `0.19%`, `0.41%`, and `0.73%` OCR-warning garbage.
- Do not reject a prose page solely because it contains `©`, `®`, `£`, `§`,
  bullets, Greek, accents, or em dashes.
- Remove `U+0000`, `U+007F`, and unsupported controls while preserving newlines.
- Detect repeated left/right headers with changing folios.
- Preserve a one-off heading that resembles a running header.
- Suppress gift-style caret and symbol callouts under an OCR profile.
- Preserve `x^2`, `Acme®`, `© 2026`, and `£5` without that evidence.
- Compact adjacent callouts to one `[ref]`.
- Join `everythin` plus `g` when `everything` appears intact in book evidence.
- Keep `or` plus `influential` as two words.
- Produce identical output on a second cleaning pass.
- Reject a high-corruption unit but retain a low-corruption prose unit as
  `accept-degraded`.

### Gift EPUB Integration Test

Update `src/core/ingest/structure.corpus.integration.test.ts` to assert:

- Every page source is accounted for exactly once as accepted or rejected.
- Pages containing explicit sub-1% OCR warnings are rejected.
- The due-date and barcode pages are rejected.
- No output contains `The text on this page is estimated to be only`.
- No output contains forbidden controls.
- With reference suppression enabled, output contains no caret callout clusters
  or gift-style `®`/`•` callouts.
- With reference retention enabled, editorial note pages remain available.
- Repeated `THE GIFT`, chapter running heads, and folios do not begin resolved
  slices after cleanup.
- Known prose anchors from the introduction, body, and conclusion survive.
- Accepted source order remains monotonic and no accepted source is duplicated.
- Section estimates equal the final canonical cleaned word count.

Do not assert that all unusual Unicode disappears. Assert that known artifacts
disappear and legitimate counterexamples survive.

### Regression Commands

Use non-interactive commands:

```sh
npx vitest run src/core/ingest/contentQuality.test.ts src/core/ingest/cleaning.test.ts src/core/ingest/structure.test.ts
npm run test:epub-corpus
npm run lint
npm run build
```

## Gift Fixture Acceptance Criteria

With the default reference suppression setting:

1. No explicit OCR-confidence warning, due-date stamp, barcode string, or
   forbidden control character reaches chapter content.
2. `page_0.html`, `page_158.html`, `page_159.html`, and `page_161.html` through
   `page_163.html` are rejected with specific reasons. Other pages are decided
   by evidence rather than a hard-coded filename list.
3. No resolved slice starts with a recurring running header and folio.
4. Gift-style malformed reference markers are absent from reader tokens.
5. Notes are absent under `suppress`, represented by `[ref]` under `compact`,
   and retained under `keep` according to the content-zone policy.
6. High-confidence split words are repaired; ambiguous text is not invented.
7. Introduction, chapter body, conclusions, and their source order remain
   intact.
8. The quality inspector explains every rejected page and every destructive
   cleanup category with counts and bounded samples.

## Definition Of Done

- The gift EPUB meets all acceptance criteria without fixture-specific path
  checks in production code.
- The cleaner is deterministic and idempotent.
- Legitimate Unicode and symbol regression cases pass.
- Accepted and rejected source accounting is complete and non-overlapping.
- Planning estimates and persisted reader text use the same canonical output.
- Focused tests, the opt-in EPUB corpus, lint, and build pass.
- A developer can diagnose the next bad EPUB with one inspector command instead
  of adding a regex from a screenshot.

## Implementation Execution Brief

Implement one phase at a time. Start by making the inspector and tests expose
the current failures, then add the smallest production behavior needed for that
phase. After every production edit, run the focused non-interactive test before
continuing. Never add a blanket non-ASCII removal rule, never hard-code gift
page filenames, and stop to inspect samples if a threshold rejects continuous
prose. Keep notes policy separate from OCR quality, and use accepted-plus-
rejected source accounting as the central no-loss invariant.