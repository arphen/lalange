# PDF Parsing And On-Device OCR Plan

## Goal

Make text-layer, scanned, image-only, and mixed PDFs readable in XYZ without
sending the PDF, rendered pages, extracted text, or OCR output off device.
Keep the existing PDF ingest plugin and `pdfjs-dist` security posture, but turn
each PDF page into an ordered, auditable source unit that can be resolved from
either its embedded text layer or local OCR.

The target PDF has not been added to this workspace. Before changing quality
thresholds, place a local copy under ignored `books/` and run the inspector
described below. Production code must not contain its filename, page numbers,
or phrases.

## Non-Negotiable Requirements

1. OCR runs in the browser with a local Web Worker and WebAssembly. There is no
   upload or cloud OCR fallback.
2. OCR runtime and language assets are served from XYZ's own origin. Do not use
   the default jsDelivr, unpkg, Google, or other CDN paths.
3. A text-layer page uses its embedded text when that text is usable. OCR is a
   fallback for absent, sparse, or corrupt text, not a mandatory second pass.
4. Mixed PDFs may choose embedded text on one page and OCR on the next while
   preserving page order exactly.
5. Never concatenate embedded text and whole-page OCR output. Score both
   candidates and select one, otherwise duplicated paragraphs will reach RSVP.
6. All PDF pages are accounted for exactly once as `embedded`, `ocr`, `blank`,
   or `failed`.
7. OCR is cancellable, bounded in memory, sequential by default, observable,
   and resumable before declaring large scanned PDFs fully supported.
8. OCR output goes through the same content-quality and final-cleaning path as
   EPUB source units. Do not add a PDF-only symbol blacklist.
9. Existing text-layer PDF, EPUB, Markdown, and TXT behavior must remain
   covered by regression tests.

## Current Repository Audit

The repository already has useful foundations:

- `src/core/ingest/readers/pdfjsAdapter.ts` lazily imports pinned
  `pdfjs-dist@5.4.624`, disables XFA and eval, extracts metadata, and walks pages.
- `src/core/ingest/readers/pdfReader.ts` recognizes PDF MIME, extension, and
  signatures, enforces 75 MB and 2,000-page limits, and exposes PDF through the
  plugin registry.
- `src/core/ingest/readers/index.ts` injects the PDF parser, which is the right
  test seam for adding rendering and OCR dependencies.
- `src/core/ingest/pipeline.ts` persists the original bytes and rehydrates the
  correct reader in background processing.
- `src/core/ingest/contentQuality.ts` is being developed to make per-source-unit
  quality decisions and can accept `pdf:page:<number>` units without knowing
  about ZIP or PDF parsing.
- `pwa.config.ts` already includes `.mjs` workers in precaching.

The current PDF path is not sufficient for scanned books:

- `ParsedPdfPage` retains only a string. Text-item coordinates, font data,
  direction, and page dimensions are discarded.
- `appendTextItem` trusts PDF content-stream order and inserts spaces using
  punctuation rules. Multi-column, positioned, and irregular PDFs can read in
  the wrong order.
- Empty pages are filtered and a fully scanned PDF is rejected with
  `OCR ... not supported yet`.
- Every PDF becomes one neutral `Document` chapter. PDF outlines and heading
  evidence are ignored.
- `prepareInitial` and `loadChapters` parse independently. Adding OCR directly
  to both would OCR the same document twice.
- `loadChapters` has no progress or `AbortSignal`, and returns only after every
  page is resolved. The current stop flag cannot interrupt PDF rendering or a
  Tesseract recognition call.
- The current service worker has no runtime cache policy for large OCR assets,
  and its 2 MB precache ceiling is below the English language pack size.

## Library Choice

Use Tesseract.js as the OCR engine. It is a mature browser OCR implementation,
runs in a Web Worker over WebAssembly, provides word/line geometry and
confidence, and supports explicit local worker/core/language paths.

Pin exact versions during the first implementation:

```sh
npm install --save-exact tesseract.js@7.0.0 tesseract.js-core@7.0.0 \
  @tesseract.js-data/eng@1.0.0
```

Version check on 2026-08-05: `tesseract.js` is `7.0.0`; the English data package
is approximately 13.9 MB unpacked. Re-check the APIs and package asset paths
when implementing, but do not use floating versions.

Start with the fast English trained data for acceptable browser throughput.
Keep the language identifier in the API from day one so `fra`, `deu`, and other
packs can be added without rewriting the adapter. Do not auto-download every
language. The selected pack must be explicit and its availability visible.

Do not use a transformer OCR model for the first implementation. Tesseract is
smaller, more predictable for book pages, provides layout geometry, and does
not compete with the app's existing WebLLM/TTS GPU and memory workloads.

## Target Architecture

```text
Local PDF bytes
  -> PDF.js document session
  -> metadata, outline, page count, labels
  -> one page at a time
       -> embedded text runs + geometry
       -> text-layer usability score
       -> if usable: reconstruct reading order
       -> otherwise: render bounded bitmap
           -> local Tesseract worker
           -> OCR words/lines + confidence + geometry
           -> optional one-time low-confidence retry
       -> select exactly one page text candidate
       -> RawContentUnit(path = pdf:page:N)
       -> content-quality cleanup
       -> page checkpoint + diagnostics
  -> validated outline ranges or one Document fallback
  -> concatenate accepted pages inside each reading section
  -> generic cleaning, RSVP tokenization, persistence
```

Keep these ownership boundaries:

- PDF.js owns PDF decoding, page geometry, text runs, labels, outline
  destinations, and raster rendering.
- The OCR adapter owns Tesseract lifecycle and conversion of OCR output to a
  library-independent result.
- A pure page resolver owns candidate scoring and `embedded | ocr` selection.
- `contentQuality.ts` owns controls, page furniture, OCR debris, references,
  notes policy, and destructive-decision diagnostics.
- The reader owns page-to-chapter grouping.
- The pipeline owns cancellation, checkpoints, persistence, and user progress.

## Proposed Types

Split the current parser result into document metadata, page inputs, and page
outcomes. Keep Tesseract-specific types out of reader contracts.

```ts
export interface PdfTextRun {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontName?: string;
    direction: 'ltr' | 'rtl' | 'ttb';
    hasEol: boolean;
}

export interface PdfPageDescriptor {
    pageNumber: number;
    label?: string;
    width: number;
    height: number;
    rotation: number;
    textRuns: PdfTextRun[];
}

export interface OcrWord {
    text: string;
    confidence: number;
    boundingBox: { x0: number; y0: number; x1: number; y1: number };
    lineId: string;
    blockId: string;
}

export interface OcrPageResult {
    text: string;
    words: OcrWord[];
    meanConfidence: number;
    language: string;
    durationMs: number;
}

export type PdfPageSource = 'embedded' | 'ocr' | 'blank' | 'failed';

export interface ResolvedPdfPage {
    pageNumber: number;
    label?: string;
    source: PdfPageSource;
    text: string;
    lines: string[];
    confidence?: number;
    textLayerScore: number;
    outputScore: number;
    attempts: number;
    issues: string[];
    reason: string;
}
```

Add a session interface so one PDF document and one OCR worker remain open
while pages are processed and are always released in `finally`:

```ts
export interface PdfDocumentSession {
    inspect(): Promise<PdfDocumentPlan>;
    getPageDescriptor(pageNumber: number): Promise<PdfPageDescriptor>;
    renderPage(pageNumber: number, options: PdfRenderOptions): Promise<ImageData>;
    close(): Promise<void>;
}

export interface PdfOcrEngine {
    recognize(image: ImageData, options: OcrOptions): Promise<OcrPageResult>;
    cancel(): Promise<void>;
    close(): Promise<void>;
}
```

Extend reader background loading with context rather than importing stores in
the adapters:

```ts
export interface ReaderLoadContext {
    signal?: AbortSignal;
    onProgress?: (progress: ReaderLoadProgress) => void;
}

loadChapters(rawData: Uint8Array, context?: ReaderLoadContext):
    Promise<ReaderResolvedChapter[]>;
```

The first OCR phase may still return an array, but the final implementation
must add a per-source callback or async iterator so page checkpoints can be
saved before the whole document finishes.

## Page Decision Rules

### 1. Embedded Text Triage

Score a page's text layer using Unicode-aware signals:

- number of letters, numbers, words, and continuous lines;
- ratio of letters/numbers to non-whitespace characters;
- replacement/control character count;
- repeated-glyph and duplicated-text-run ratio;
- one-glyph fragmentation and implausible punctuation runs;
- spatial distribution of runs across the page;
- whether words form coherent lines after geometry reconstruction.

Use named, tested thresholds. A page with enough coherent embedded prose skips
rendering and OCR. A page with only a footer, folio, watermark, or a few broken
glyphs must still be OCR eligible. Do not reject or OCR solely because a page
contains non-ASCII text.

### 2. Bounded Rendering

Render only one page at a time. Start near 250-300 DPI for typical book pages,
but cap the final bitmap by both longest edge and total pixels. Proposed initial
guards, to be tuned against the target fixture:

```ts
MAX_OCR_LONG_EDGE = 3_500;
MAX_OCR_PIXELS = 16_000_000;
OCR_CONCURRENCY = 1;
MAX_OCR_ATTEMPTS_PER_PAGE = 2;
```

Respect PDF page rotation through the PDF.js viewport. Release the canvas by
zeroing its dimensions after recognition. Prefer `OffscreenCanvas` when
available, with a normal canvas fallback for Safari. Never retain all rendered
pages or bitmaps in memory.

The default pass should preserve grayscale detail. Retry once only when the OCR
score is below a named threshold and the page has plausible ink/content. The
retry may use contrast/threshold preprocessing or another page-segmentation
mode. Record both attempts and keep the higher-scoring output. Do not build an
unbounded preprocessing search.

### 3. Candidate Selection

If embedded text triggered OCR, score the reconstructed embedded candidate and
OCR candidate with the same high-level output signals. Select exactly one.

- Prefer embedded text on a near tie because it preserves exact characters.
- Prefer OCR when embedded text is sparse/corrupt and OCR produces coherent
  lines with adequate confidence.
- Classify a genuinely empty decorative page as `blank` without failing the
  document.
- Classify a non-empty page with no recoverable candidate as `failed`, retain a
  bounded diagnostic, and continue unless all meaningful pages fail.
- Never merge whole-page candidates and never infer missing prose.

### 4. Reading Order

Do not trust PDF content-stream order or raw OCR token order.

For embedded text, cluster runs into lines using baseline and font-height
tolerances, then detect columns using horizontal overlap and persistent gaps.
For OCR, use block/line boxes from Tesseract and normalize them into the same
layout representation. Sort blocks top-to-bottom and columns in document
direction. Preserve paragraph and line boundaries until hard-wrap cleanup.

Cover these layouts explicitly:

- single-column prose;
- two-column pages;
- indented paragraphs and centered headings;
- page numbers and alternating running heads;
- rotated pages;
- right-to-left metadata in the type model, even if full RTL tuning is later.

Unknown layout should degrade to a stable top-to-bottom order and emit a
diagnostic rather than silently interleave columns.

## Document Structure

Call `getOutline()` during the cheap inspection pass. Resolve named and explicit
destinations to page indexes, discard invalid destinations, and require
monotonic non-overlapping ranges. Use a valid PDF outline as `source: 'toc'`.

For PDFs without a valid outline, keep one top-level `Document` chapter during
the first OCR implementation. This preserves the current placeholder contract
and gets scanned PDFs readable without inventing chapter boundaries.

After OCR is reliable, detect coherent heading families from font size and
weight for embedded pages, or bounding-box height, confidence, casing, and
surrounding whitespace for OCR pages. Heading fallback may create reader
subsections, but only after at least three coherent peer headings. Do not let
one large title or an OCR false positive fragment a book.

`prepareInitial` must never run OCR. It may inspect metadata, outline, page
count, labels, and a small text-layer sample. `loadChapters` performs OCR once
in background. The top-level chapter plan from both paths must remain
deterministic. If dynamic top-level restructuring is later required, add an
explicit pipeline reconciliation step instead of relying on array indexes to
coincidentally match.

## On-Device Asset And Offline Design

Tesseract's default asset URLs are forbidden. Resolve and pass explicit local
URLs for all three classes:

- worker script;
- SIMD/non-SIMD core JavaScript and WASM;
- selected `.traineddata.gz` language pack.

Add a build-time asset sync script or Vite URL imports whose output paths are
tested in the production build. A sync script is preferable if package export
maps make `?url` imports brittle. Copy only selected language assets; do not
copy every model in the npm package.

Use a dedicated `/ocr-assets/` path and immutable hashed filenames where
possible. Add a service-worker `CacheFirst` route for same-origin OCR assets.
Do not raise the global 2 MB precache cap merely to hide the English model in
the install event.

Language-pack behavior:

1. The app checks local availability before starting pages that require OCR.
2. Online first use downloads from XYZ's own origin with byte progress and
   stores the pack for later sessions.
3. Offline first use fails with a specific language-pack message, not a generic
   PDF error.
4. After a successful download, an offline Playwright test must OCR the fixture
   without a network request.
5. Settings allow removal/re-download of OCR assets and show storage size.

Avoid duplicate long-term model copies in Cache Storage and IndexedDB. Decide
which layer owns trained-data persistence after verifying Tesseract.js 7 cache
behavior. Document that choice and add a storage regression test.

Privacy invariants:

- No `fetch`, XHR, beacon, WebSocket, or form request may contain PDF bytes,
  page images, extracted text, or OCR text.
- OCR network requests are GETs for same-origin static runtime/model assets.
- Logs and diagnostics contain counts and bounded local samples only; never log
  a whole page.
- No remote OCR fallback is offered on failure.

## Cancellation, Progress, And Resume

Replace the boolean-only stop path with an `AbortController` per active ingest
job. `stopProcessing(bookId)` must abort PDF.js page rendering, terminate the
Tesseract worker if recognition cannot be interrupted directly, and leave
completed page checkpoints intact.

Progress should combine document and current-page state:

```text
Preparing local OCR (English)...
OCR page 12 of 240 (63%)
Cleaning page 12 of 240...
Building reading sections...
```

Do not create one worker per page. Create one worker per active PDF job, load
the selected language once, process sequentially, and terminate it on success,
error, or abort.

For resumability, add a local ingest-unit checkpoint collection or an
equivalent repository-consistent store keyed by:

```text
bookId + readerId + extractionVersion + sourceUnitId + settingsFingerprint
```

The fingerprint must include PDF parser version, OCR engine version, language,
render scale/preprocessing version, reference mode, and content-quality
version. Resume only matching checkpoints. Delete or compact checkpoints after
chapter content is persisted successfully.

If adding an RxDB collection or fields to an existing schema, follow the
repository migration rule: bump schema versions and provide every migration
strategy. A new version-0 local-only collection does not justify changing
unrelated schemas.

## Diagnostics And Inspector

Add a read-only command that uses production scoring, layout, selection, and
cleanup functions:

```sh
npm run inspect:pdf -- books/target.pdf --lang eng
npm run inspect:pdf -- books/target.pdf --lang eng --pages 1-10
```

It should print one JSON record per page followed by aggregate counts:

```json
{
  "page": 12,
  "label": "8",
  "source": "ocr",
  "textLayerScore": 0.04,
  "ocrConfidence": 88.3,
  "outputScore": 0.82,
  "attempts": 1,
  "characters": 1842,
  "issues": ["sparse-text-layer"],
  "durationMs": 1460,
  "beforeSample": "...",
  "afterSample": "..."
}
```

Keep browser and Node I/O adapters separate if Node requires a canvas package,
but share production pure functions. The inspector must not reimplement
threshold regexes. Default samples must be short and local-only.

## Implementation Sequence For Luna

### Phase 0: Characterize The Target And Freeze Regressions

1. Copy the target PDF into ignored `books/`; do not commit private or
   copyrighted source material.
2. Record page count, dimensions, rotation, metadata, outline presence, text
   item counts, and sample extraction for first/middle/last pages.
3. Add a small redistributable synthetic text PDF and a synthetic one-page
   image-only PDF under `test-fixtures/pdf/`.
4. Add mixed, two-column, rotated, and blank-page fixtures. Generate them from
   scripts where practical so provenance is clear.
5. Preserve current passing text PDF behavior in
   `pdfjsAdapter.test.ts`, `pdfReader.test.ts`, and
   `pipeline.formats.test.ts`.

Run before production edits:

```sh
npx vitest run src/core/ingest/readers/pdfjsAdapter.test.ts \
  src/core/ingest/readers/pdfReader.test.ts \
  src/core/ingest/pipeline.formats.test.ts
```

### Phase 1: OCR The First Scanned Page Locally

1. Install and pin Tesseract runtime, core, and English data dependencies.
2. Add `src/core/ingest/readers/pdfOcrAdapter.ts` with injected local asset
   URLs, one worker lifecycle, recognition, cancellation, and cleanup.
3. Add `pdfOcrAdapter.test.ts` with a mocked Tesseract worker for lifecycle,
   progress, error, and abort tests.
4. Retain empty `ParsedPdfPage` entries instead of filtering them in
   `pdfReader.ts`.
5. Add page rendering to the PDF.js adapter with pixel guards and guaranteed
   canvas release.
6. Resolve an empty-text page through OCR and return it as the existing single
   `Document` chapter. Do not add structure inference yet.
7. Replace the current image-only rejection test with a successful injected
   OCR result, while retaining an all-pages-failed error test.
8. Add one opt-in real-WASM test against the synthetic image-only fixture.

After the first production edit, immediately run the narrow adapter/reader
test that can falsify that edit. Do not continue to Phase 2 until a real local
OCR invocation extracts a known anchor from the synthetic scan.

### Phase 2: Page Triage And Mixed PDFs

1. Replace flattened PDF strings with text runs and geometry.
2. Add pure `pdfPageQuality.ts` functions for text-layer scoring, OCR-output
   scoring, and candidate selection.
3. Add boundary tests around every threshold and Unicode counterexamples.
4. OCR only unusable text-layer pages.
5. Test a mixed PDF where pages resolve as `embedded`, `ocr`, and `blank` in
   exact order.
6. Assert that no page contains both embedded and OCR copies of the same prose.
7. Convert each selected page to `RawContentUnit` and run the shared
   content-quality path before concatenation.
8. Add complete page accounting and bounded diagnostics.

### Phase 3: Reading Order And Furniture

1. Add `pdfLayout.ts` with pure run/word clustering and block ordering.
2. Cover single-column, two-column, centered heading, rotated, and RTL-direction
   inputs without invoking PDF.js or Tesseract in unit tests.
3. Preserve raw line and paragraph boundaries into `contentQuality.ts`.
4. Analyze all accepted pages as one document to remove only recurring
   edge furniture.
5. Verify changing folios and alternating running heads disappear while the
   same phrase in body text survives.
6. Apply conservative line-end dehyphenation/hard-wrap repair only after page
   reading order is stable.

### Phase 4: Outline And Reading Sections

1. Extract and validate PDF outline destinations.
2. Group pages into monotonic outline ranges and expose outline titles as
   authored chapters.
3. Keep one `Document` chapter when no valid outline exists.
4. Add coherent heading fallback as subsections only after OCR quality is
   stable.
5. Ensure `prepareInitial` and `loadChapters` produce the same top-level plan
   without running OCR twice.
6. Assert section estimates equal final canonical cleaned word counts.

### Phase 5: Cancellation, Checkpoints, And Long Documents

1. Thread `ReaderLoadContext` and `AbortSignal` through registry, reader,
   PDF.js, OCR, and pipeline boundaries.
2. Replace active-job booleans with abort controllers while preserving current
   scheduler cancellation.
3. Save one deterministic checkpoint after each selected and cleaned page.
4. Resume matching checkpoints after stop, reload, or a worker crash.
5. Process pages sequentially and release all page resources in `finally`.
6. Add a test that aborts during page 2, proves page 1 remains complete, and
   resumes at page 2 without recognizing page 1 again.

### Phase 6: Offline Assets And Product States

1. Self-host worker, core, WASM, and English trained data under
   `/ocr-assets/` with no CDN fallback.
2. Add same-origin runtime caching and an explicit language-pack readiness API.
3. Surface download, OCR, stop, missing-pack, storage-full, and page-failure
   states through existing archive progress/error UI.
4. Add settings for OCR language and model removal; default to English only.
5. Run an offline Playwright journey after warming OCR assets.
6. Intercept all requests and assert no document-derived POST body or remote
   OCR endpoint exists.

### Phase 7: Inspector, Guardrails, And Target Acceptance

1. Add `scripts/inspect_pdf_quality.mjs` and `inspect:pdf`.
2. Run it on the target PDF and inspect every failed/degraded page before
   changing a threshold.
3. Add final guards for forbidden controls, duplicate candidate text, page
   accounting, non-empty meaningful output, and idempotent cleanup.
4. Exercise the target on desktop Chromium and mobile WebKit-sized viewports.
5. Record median and worst-page OCR time and peak memory on representative
   hardware. Tune rendering limits only from measured evidence.

## Test Plan

### Fast Unit Tests

- Recognize local PDF signatures and preserve existing text-PDF metadata.
- Preserve text-run coordinates, directions, page labels, and rotation.
- Score coherent embedded prose above the OCR trigger threshold.
- Score empty, footer-only, duplicated, control-heavy, and glyph-fragmented
  text layers below the threshold.
- Preserve Greek, accents, mathematical symbols, `©`, `®`, `£`, and `§`.
- Choose embedded text on a near tie and OCR on a clear quality win.
- Never concatenate candidate outputs.
- Reconstruct deterministic one- and two-column reading order.
- Enforce render pixel caps.
- Create one OCR worker per job, not per page.
- Terminate PDF and OCR workers on success, failure, and abort.
- Account for every page exactly once.
- Produce identical selected and cleaned text on a second cleanup pass.

### Real OCR Integration Tests

Keep slow real-WASM tests opt-in and non-interactive:

- OCR a generated English scan and retain two known prose anchors.
- Parse a mixed text/scan PDF and select the correct source per page.
- Handle a rotated scan.
- Treat a blank page as blank, not a fatal OCR failure.
- Stop after one page and resume without repeating it.
- Fail clearly when every nonblank page is unrecoverable.

Do not assert exact OCR punctuation or confidence. Pin versions, normalize
whitespace, assert durable anchors and broad confidence/quality ranges, and
keep unit tests mocked for deterministic edge behavior.

### Offline And Privacy Tests

- Build output contains local worker, core, WASM, and selected language assets.
- No OCR asset URL points to another origin.
- First model use reports byte progress.
- Warmed assets support OCR with Playwright context offline.
- Missing assets while offline produce an actionable error.
- Cancellation terminates active workers.
- Network interception finds no PDF bytes, canvas image, extracted text, or OCR
  output in outbound requests.

### Regression Commands

```sh
npx vitest run src/core/ingest/readers/pdfjsAdapter.test.ts \
  src/core/ingest/readers/pdfOcrAdapter.test.ts \
  src/core/ingest/readers/pdfPageQuality.test.ts \
  src/core/ingest/readers/pdfLayout.test.ts \
  src/core/ingest/readers/pdfReader.test.ts \
  src/core/ingest/pipeline.formats.test.ts

RUN_PDF_OCR_CORPUS=1 npx vitest run \
  src/core/ingest/readers/pdfOcr.integration.test.ts

npx vitest run src/core/ingest/contentQuality.test.ts \
  src/core/ingest/cleaning.test.ts

npm run test:epub-corpus
npm run lint
npm run build
npx playwright test e2e/pdf-ocr.spec.ts --project=chromium
```

All test commands must use `vitest run` or another non-interactive mode.

## Target PDF Acceptance Criteria

Fill in measured page anchors during Phase 0; do not encode the private file in
committed tests.

1. The PDF imports without a server-side service or remote OCR request.
2. Every page is accounted for exactly once and accepted pages remain in
   monotonically increasing page order.
3. Text-layer pages skip OCR unless their quality score is below the tested
   threshold.
4. Scanned pages are rendered and recognized locally with the selected
   language pack.
5. Mixed pages do not duplicate embedded and OCR text.
6. Known opening, middle, and closing prose anchors survive into reader tokens.
7. Two-column or positioned text does not interleave incoherently.
8. Repeated headers, footers, and folios do not begin reading sections.
9. Blank pages, illustrations, and one failed page do not erase neighboring
   prose or fail the entire book.
10. Stop interrupts active OCR promptly; resume does not repeat completed
    pages.
11. A warmed installation can repeat the import offline.
12. No forbidden controls, PDF warning strings, or page-candidate duplicates
    reach RSVP content.

## Definition Of Done

- A scanned/image-only PDF is readable through on-device OCR rather than
  rejected.
- Text, scanned, and mixed PDFs share one deterministic page-resolution model.
- All runtime/model assets are same-origin, cacheable, removable, and usable
  offline after installation.
- PDF and rendered page data never leave the device.
- OCR has progress, cancellation, page checkpoints, resume, and bounded memory.
- Page ordering and destructive cleanup are explainable through the inspector.
- The target PDF meets its acceptance criteria without fixture-specific
  production rules.
- Focused PDF tests, content-quality tests, EPUB corpus tests, lint, build, and
  offline Playwright coverage pass.

## Luna Execution Brief

Implement one phase at a time and keep the first vertical slice narrow: one
synthetic scanned page must become readable with a local Tesseract worker before
adding layout inference or chapter heuristics. After every production edit,
run the cheapest focused non-interactive test immediately. Keep OCR behind
injected interfaces so most tests do not start WASM.

Never use Tesseract's default CDN paths, never upload a page, never OCR every
good text-layer page, never concatenate embedded and OCR copies, and never hold
multiple full-page bitmaps by default. Stop and inspect page diagnostics when a
threshold rejects continuous prose or when OCR unexpectedly wins over a clean
text layer.