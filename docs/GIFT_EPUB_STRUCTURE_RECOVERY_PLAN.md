# Gift EPUB Structure Recovery Plan

## Status

- Future fixture-focused work as of 2026-08-23. The current PDF outline work
  does not implement this EPUB's authored-boundary recovery contract.
- This document is an acceptance appendix to
  `INTERNAL_READING_SECTIONS_PLAN.md`, not a second generic structure design.
- Keep the fixture observations and boundary oracle; verify every expected
  result against the current ingest pipeline before treating it as achieved.

## Purpose

Improve EPUB structure recovery using
`books/giftformsfunctio00maus.epub` as a regression fixture without writing
rules that only work for this book.

The current Gift regression proves that 152 page-like files can be compressed
into a tolerable number of generated sections. It does not prove that the
book's authored structure was recovered. The test currently accepts 12-25
anonymous `Section N` entries and requires none of the real boundaries such as
`Introduction`, `Chapter I`, or `Conclusions`.

The implementation should recover an authored outline when several independent
signals agree and should retain generated sections when they do not. Incorrect
semantic structure is worse than an explicit, deterministic fallback.

## Observed Fixture Structure

The Gift EPUB has several unusual but internally consistent properties:

- `EPUB/nav.xhtml` exists, but its table-of-contents `<ol>` is empty.
- `EPUB/toc.ncx` exists, but its `<navMap>` is empty.
- The spine contains approximately one HTML document per scanned page.
- Documents are named `page_N.html` and use `<title>Page N</title>`.
- Real headings are at the beginning of ordinary `<p>` elements, not in
  `<h1>` or `<h2>` elements.
- Scan page 21 contains an OCR version of the printed contents page.
- Main-text scan pages and printed folios have a stable offset of 22. For
  example, printed page 6 begins on `page_28.html` and printed page 17 begins
  on `page_39.html`.
- Running headers repeat chapter titles on later pages and must not be treated
  as new boundaries.
- Pages 104-152 are editorial notes. Their running headers contain strings such
  as `CH. I NOTES`, which must not become body chapters.
- Low-confidence and library scan matter exists at the beginning and end of the
  archive and is already handled by the content-quality layer.

The parser's existing heading fallback cannot recover this structure because
`buildHeadingChapters` currently searches only `<h1>` and `<h2>` elements.

## Product Outcome

- Valid EPUB 3 navigation and EPUB 2 NCX structures remain authoritative.
- Coherent semantic document headings remain the next-best source.
- Page-per-spine scan exports can recover conservative authored groups from
  leading text when stronger metadata is empty or unusable.
- Printed contents pages can corroborate inferred headings and titles but never
  create boundaries by themselves.
- Generated reading sections may split long recovered groups, but they never
  cross a recovered authored boundary.
- Ambiguous books continue to use deterministic generated sections rather than
  guessed chapter titles.
- Every accepted source slice remains present exactly once and in source order.

## Non-Goals

- Do not add rules keyed to this EPUB's filename, UUID, author, title, or exact
  list of pages.
- Do not trust arbitrary all-caps text as a heading.
- Do not parse a printed contents page as if it were publisher navigation.
- Do not infer a boundary solely from a page number or filename.
- Do not use an LLM, network service, or language-specific model.
- Do not weaken fragment validation, publication-artifact filtering, or
  content-quality rejection.
- Do not turn every subsection listed on a printed contents page into a reader
  section in the first implementation.
- Do not reintroduce one reader chapter per scanned page.

## Evidence Hierarchy

Structure evidence must have explicit provenance and a fixed precedence:

1. `epub-nav`: validated links from an EPUB 3 navigation document.
2. `ncx`: validated links from an EPUB 2 NCX navigation map.
3. `dom-heading`: coherent headings from semantic heading elements.
4. `scan-heading`: coherent heading-shaped leading blocks in page-like source
   documents.
5. `source-spine`: format fallback with no authored claim.

`printed-outline` and `folio-map` are corroborating evidence. They may increase
confidence in a `scan-heading`, improve its label, or reject an inconsistent
candidate. They must not independently create an authored boundary.

Represent recovered scan evidence distinctly from publisher TOC evidence. A
minimal compatible change is to add `scan-heading` to `BoundaryEvidence` while
retaining `ChapterSource: 'heading'` for current persistence and UI callers.

## Gift Acceptance Contract

### Body Structure

With `referenceHandling: 'suppress'`, recover these authored groups:

| Authored group | Heading scan page | Included scan pages |
| --- | ---: | ---: |
| Introduction | 13 | 13-18 |
| Translator's Note | 19 | 19 |
| Introductory: Gifts and Return Gifts | 23 | 22-27 |
| Chapter I: Gifts and the Obligation to Return Gifts | 28 | 28-38 |
| Chapter II: Distribution of the System: Generosity, Honour and Money | 39 | 39-67 |
| Chapter III: Survivals in Early Literature | 68 | 68-84 |
| Chapter IV: Conclusions | 85 | 85-103 |

Page 22 is an epigraph immediately before `Introductory`. It should attach
forward to that group instead of becoming a tiny anonymous section. Page 21 is
the printed contents page and must not appear in reading text.

Long authored groups may be divided into approximately 3,500-word reading
sections. Each child section must retain the correct `authoredGroupTitle`. The
book should therefore be `hybrid`, not wholly `generated` and not one section
per authored group regardless of size.

No reading section may cross the starts at pages 28, 39, 68, 85, or 104.

### Notes Structure

With `referenceHandling: 'keep'`, pages 104-152 should form one authored Notes
group or one parent group with size-based child sections. With
`referenceHandling: 'compact'` or `'suppress'`, the notes zone should remain
omitted according to current policy.

`CH. I NOTES`, `CH. II NOTES`, `CH. III NOTES`, and `CH. IV NOTES` are running
heads inside the notes zone. They are not body chapter starts.

### Content Invariants

- Accepted, rejected, and policy-skipped source paths are disjoint.
- Together they account for every page-like source path.
- Each accepted path appears in exactly one planned authored group.
- Final reading-section slices are monotonic and non-overlapping.
- Estimated word totals equal resolved word totals.
- Sentinel text on either side of every recovered boundary appears only in the
  expected group.
- The printed contents text and recurring running furniture do not leak into
  resolved reading text.
- Existing Gift content-quality expectations remain intact unless a separately
  justified content-quality change updates them.

## Confidence Model

Scan-heading inference should be explicit and conservative. A candidate should
be accepted only when the overall candidate family is coherent.

### Candidate Signals

Positive signals include:

- the candidate begins in the first content block after page furniture;
- the text starts with a recognized structural form such as `Chapter IV`,
  `Introduction`, `Translator's Note`, `Introductory`, `Conclusions`, or
  `Notes`;
- chapter ordinals form a monotonic canonical sequence;
- the candidate is unique or rare at the leading edge of source units;
- tokens overlap a printed-outline entry;
- the printed-outline folio agrees with a stable book-level folio mapping;
- neighboring candidates occur in increasing source order;
- the candidate is outside a detected notes or publication-matter zone.

Negative signals include:

- the same normalized phrase recurs as page furniture;
- the candidate is only a page number, Roman folio, or short all-caps phrase;
- the candidate occurs after substantial prose in the source unit;
- ordinals repeat, regress, or skip implausibly;
- the printed-outline folio conflicts with the inferred folio map;
- the candidate appears in notes, bibliography, contents, cover, or rejected
  OCR matter;
- accepting it would create a very short group without an intentional label;
- no other candidate forms a coherent family.

Do not begin with a numeric score whose thresholds have no test evidence. Model
required and disqualifying conditions directly. Add a score only if corpus
examples demonstrate that ordered rules cannot express the distinctions.

## Implementation Sequence

### Phase 1: Freeze the Oracle and Add Diagnostics

Start with tests and inspection output before changing parser behavior.

1. Extend `scripts/inspect_epub_quality.mjs` or add
   `scripts/inspect_epub_structure.mjs`.
2. Report declared TOC state as `absent`, `present-empty`, `present-invalid`, or
   `present-valid` for both nav and NCX sources.
3. Report source-unit titles, first cleaned block, folio candidates, heading
   candidates, evidence provenance, rejection reasons, authored groups, final
   sections, word counts, and source paths.
4. Add a package script such as `inspect:epub-structure` so agents and humans
   use the same command.
5. Capture the current Gift output and the desired boundary table in the test
   description. Do not add a broad snapshot of all OCR text.

Deliverable: diagnostics expose why the current parser falls back to generated
sections, without changing parser output.

### Phase 2: Extract Pure Structure-Evidence Types

Create a small module such as `src/core/ingest/structureEvidence.ts`. Keep ZIP
I/O and section normalization outside it.

Suggested types:

```ts
type DeclaredTocState = 'absent' | 'present-empty' | 'present-invalid' | 'present-valid';

type StructureEvidenceKind =
    | 'epub-nav'
    | 'ncx'
    | 'dom-heading'
    | 'scan-heading'
    | 'printed-outline'
    | 'folio-map'
    | 'source-spine';

interface StructureCandidate {
    sourceOrdinal: number;
    path: string;
    title: string;
    kind: StructureEvidenceKind;
    blockIndex?: number;
    printedPage?: number;
    ordinal?: number;
    reasons: string[];
}
```

Do not expose Gift-specific page values from production APIs.

Deliverable: unit-tested pure evidence representations and declared-TOC state
classification.

### Phase 3: Detect Leading Scan Headings

Run scan-heading detection only when the source is page-like and stronger
structure is absent, singular, or degraded.

1. Preserve block boundaries while extracting cleaned text.
2. Analyze the first meaningful block after archive-page labels and recurring
   furniture have been removed.
3. Recognize structural forms with normalization for OCR case and spacing, but
   preserve the best available display label.
4. Reuse canonical Arabic, Roman, and written ordinal parsing from the current
   heading fallback rather than creating a second incompatible parser.
5. Select candidates as a family. An isolated `Chapter I` in prose must not be
   promoted.
6. Store a stable source block position so slicing does not depend on a text
   search that could match repeated words later in the page.

The boundary representation may need `startBlockIndex` and `endBlockIndex` in
`ChapterSlice`, analogous to the existing heading indexes. Keep this change
small and deterministic.

Deliverable: synthetic page-spine fixtures recover coherent plain-paragraph
headings and abstain on ambiguous examples.

### Phase 4: Parse Printed Outline and Folio Evidence

Treat printed contents recovery as corroboration, not navigation.

1. Detect likely printed-contents source units using existing classification
   evidence before they are removed from reading content.
2. Parse conservative outline records consisting of a normalized label and an
   optional trailing printed page.
3. Tolerate flattened OCR line structure, punctuation noise, split labels, and
   Roman chapter ordinals.
4. Infer a folio mapping only from at least three mutually consistent source
   observations. For the Gift fixture, this should discover an offset of 22;
   production code must not assume that value.
5. Match outline records to scan-heading candidates by normalized token overlap,
   ordinal compatibility, source order, and folio agreement.
6. Reject the folio map when observations disagree beyond a named tolerance.

The first implementation should recover top-level groups only. Lower-level
numbered subsections can remain diagnostic evidence until a separate corpus
justifies exposing them as reading navigation.

Deliverable: pure tests recover useful outline evidence from a Gift-derived
sample and prove that malformed outline text cannot create boundaries alone.

### Phase 5: Reconcile Evidence and Build Authored Groups

Integrate the evidence hierarchy into `buildEpubStructurePlan`.

1. Keep validated EPUB nav and NCX behavior unchanged.
2. Keep coherent semantic heading behavior unchanged.
3. Invoke scan recovery only when stronger sources provide no useful outline.
4. Accept only a coherent, monotonic recovered family.
5. Include meaningful unnumbered frontmatter boundaries when independently
   corroborated.
6. Attach short pre-boundary material deliberately. In the Gift fixture, attach
   the page-22 epigraph forward to `Introductory`.
7. Stop the body structure at the Notes boundary even when references are
   suppressed and the notes text is removed later.
8. Pass authored groups to reading-section normalization.

If scan recovery fails validation, record the reasons in diagnostics and use
the current generated fallback. Do not silently accept a partial family.

Deliverable: the Gift plan becomes `hybrid`, preserves authored parent titles,
and retains generated child sections where needed for reading ergonomics.

### Phase 6: Strengthen the Full Gift Integration Test

Replace the weak title/count oracle in
`src/core/ingest/structure.corpus.integration.test.ts` with structural
assertions.

Required assertions:

- nav and NCX are both recognized as `present-empty`;
- recovered authored groups match the acceptance contract in order;
- authored-group start paths are pages 13, 19, 23, 28, 39, 68, and 85;
- the epigraph page attaches to `Introductory`;
- no final section crosses a recovered boundary;
- final titles are meaningful authored titles or deterministic child titles;
- every generated child has the expected `authoredGroupTitle`;
- `structureMode` is `hybrid`;
- printed contents and notes are excluded in suppress mode;
- accepted/rejected/skipped accounting remains exact;
- boundary sentinel text proves no duplication or overlap;
- word estimates equal resolved word counts;
- parsing the same archive twice produces identical sections and metadata.

Add a second Gift test with `referenceHandling: 'keep'` for the Notes group.
Keep the complete EPUB opt-in through `RUN_EPUB_CORPUS=1`.

Deliverable: the real fixture fails for the current behavior and passes only
after meaningful structure recovery works.

### Phase 7: Protect the General Corpus and Pipeline

Run the repository and Gutenberg corpus before adjusting thresholds.

1. Valid publisher navigation must keep its title, count, slices, and
   `publisher-toc` provenance.
2. Broken or reversed fragments must retain current validation and fallback
   behavior.
3. Semantic heading fixtures must remain `document-heading`, not
   `scan-heading`.
4. Page-like books with no coherent evidence must remain generated.
5. Short-story collections with valid TOCs must preserve short intentional
   chapters.
6. Pipeline tests must verify that `authoredGroupTitle`, ownership,
   `reformationReason`, evidence, and structure mode survive reader preparation
   and chapter placeholder creation.
7. If runtime persistence gains a new evidence enum value, update TypeScript
   models, RxDB schemas, schema versions, and every required migration strategy
   together.

Do not weaken a failing corpus assertion merely to accept a new heuristic.
Record the failure, identify which evidence rule misclassified the book, and add
a focused negative fixture before changing the rule.

Deliverable: scan recovery improves the Gift fixture without changing
well-structured EPUB behavior.

## Required Unit-Test Matrix

### Declared Navigation

- Empty nav `<ol>` is `present-empty`.
- Empty NCX `<navMap>` is `present-empty`.
- Missing nav and NCX are `absent`.
- Links with unresolved targets make the source `present-invalid`.
- At least two validated meaningful targets make the source `present-valid`.
- Valid nav wins over conflicting NCX or scan candidates.
- Valid NCX wins when nav is absent or empty.

### Scan-Heading Candidates

- Plain-paragraph `Chapter I` through `Chapter IV` form a monotonic family.
- Mixed-case OCR such as `Chapter iV` normalizes to ordinal 4.
- A heading may contain its descriptive title in the same block.
- A one-off `Chapter I` does not establish a family.
- A phrase occurring after substantial prose is not a leading boundary.
- Repeated `CONCLUSIONS 69`, `CONCLUSIONS 71`, and similar running headers are
  classified as furniture, not boundaries.
- `CH. II NOTES` in a notes zone is not a body chapter.
- An ordinal sequence that repeats, regresses, or conflicts with source order
  is rejected.
- Generic all-caps headings without structural evidence are ignored.
- Legitimate non-English text and Unicode punctuation remain intact.

### Printed Outline

- Gift-derived contents text yields top-level labels and folio references.
- OCR noise around `CHAPTER .1` still yields a plausible Chapter I outline
  record only when neighboring records support the sequence.
- Lower-level numbered subsections do not become top-level boundaries.
- A printed outline without body candidates creates no boundaries.
- A body candidate absent from the outline can still be accepted only through a
  coherent heading family and folio evidence.
- Conflicting outline order causes abstention.

### Folio Mapping

- Three consistent observations establish an offset.
- Two observations are insufficient.
- A single outlier does not defeat a strongly supported mapping when tolerance
  is explicit and tested.
- Multiple incompatible offsets reject the mapping.
- Roman frontmatter folios do not contaminate the Arabic body-page mapping.
- Filename numbers alone cannot establish a folio map.

### Grouping and Slicing

- Material before the first recovered body heading is handled explicitly.
- A short epigraph immediately before a boundary can attach forward.
- No generated child section crosses an authored boundary.
- Oversized recovered groups split near existing word thresholds.
- Every child retains its authored parent title.
- Source paths and word totals are preserved exactly once.
- Repeated runs are deterministic.

### Negative and Safety Cases

- Ordinary semantic EPUBs never invoke scan recovery after valid nav succeeds.
- A page-per-spine novel with no headings remains generated.
- A book whose body repeatedly starts with the book title does not create a
  chapter per page.
- Notes and bibliography zones cannot extend body chapter families.
- Rejected OCR pages cannot supply structure evidence.
- Publication contents text cannot leak into final reading text.

## Test Placement

- Put pure candidate, outline, folio, and reconciliation tests in
  `src/core/ingest/structureEvidence.test.ts`.
- Keep ZIP construction, fragment slicing, and planner integration tests in
  `src/core/ingest/structure.test.ts`.
- Keep complete Gift and repository EPUB tests in
  `src/core/ingest/structure.corpus.integration.test.ts`.
- Add pipeline metadata propagation tests next to the existing format and
  pipeline tests.
- Prefer small synthetic ZIPs for ordinary test runs. Do not make every unit
  test load the 2.7 MB Gift archive.

Avoid broad snapshots. Assert typed evidence, ordered boundaries, source paths,
titles, and short sentinel strings so failures identify the broken rule.

## Validation Gates

Run each gate before moving to the next phase.

### Focused Evidence Tests

```bash
npx vitest run src/core/ingest/structureEvidence.test.ts
```

### Planner Tests

```bash
npx vitest run src/core/ingest/structure.test.ts
```

### Gift Acceptance Tests

```bash
RUN_EPUB_CORPUS=1 npx vitest run \
  src/core/ingest/structure.corpus.integration.test.ts \
  -t 'gift'
```

### Regular Non-Interactive Suite

```bash
npm test -- --run
```

### Repository EPUB Corpus

```bash
npm run test:epub-corpus
```

### Final Static Validation

```bash
npm run lint
npm run build
```

Run the downloaded Gutenberg corpus when available. Record corpus diagnostics
before and after the change so title, count, provenance, and word-total changes
are reviewable.

## Agent Coordination Rules

- Each implementation agent should start from the failing test for its assignment.
- Land evidence extraction before planner integration.
- Do not let two agents edit `structure.ts` concurrently.
- The diagnostics agent and pure-evidence agent may work in parallel if their
  public type contract is agreed first.
- The Gift integration-test agent should commit the failing acceptance test
  separately from the parser implementation when practical.
- Every heuristic change requires at least one positive and one negative test.
- Threshold changes require corpus evidence, not only a passing Gift test.
- Preserve unrelated worktree changes and avoid formatter churn in large files.

Recommended execution order:

```text
Phase 1 diagnostics
    |
Phase 2 evidence types
    |
Phase 3 scan candidates ---- Phase 4 printed outline and folio evidence
    |                         |
    +-----------+-------------+
                |
Phase 5 reconciliation and planner integration
                |
Phase 6 Gift acceptance suite
                |
Phase 7 corpus and pipeline protection
```

## Stop Conditions

Stop and retain generated fallback for a book when:

- no coherent top-level candidate family exists;
- candidate order conflicts with source order;
- the only evidence is an OCR contents page;
- candidate boundaries come primarily from recurring furniture;
- body and notes zones cannot be separated confidently;
- applying the plan would duplicate, omit, or reorder accepted source units;
- a valid publisher outline would be displaced by lower-confidence evidence.

The parser should expose the abstention reason in diagnostics. Abstention is an
expected result, not a hidden error.

## Definition of Done

- The strengthened Gift tests fail against the old anonymous-section behavior.
- The Gift body recovers the seven authored groups in the acceptance contract.
- Generated child sections stay within those groups and retain parent titles.
- The epigraph, printed contents, body, and notes zones receive the intended
  treatment in every reference mode.
- Accepted source text is neither lost, duplicated, nor reordered.
- Valid nav, NCX, and semantic-heading fixtures preserve existing behavior.
- Ambiguous scan fixtures demonstrably abstain.
- Structure evidence and abstention reasons appear in the inspection command.
- Metadata survives the EPUB reader and ingest pipeline.
- Focused tests, regular tests, lint, build, repository corpus, and available
  Gutenberg corpus checks pass in non-interactive mode.