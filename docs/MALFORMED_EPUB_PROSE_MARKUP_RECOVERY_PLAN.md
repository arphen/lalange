# Malformed EPUB Prose Markup Recovery Plan

## Goal

Recover continuous prose that an EPUB producer has accidentally serialized as
tag syntax or empty HTML attributes, without teaching the normal text cleaner to
strip isolated `word=""` fragments after parsing.

The repair must cover both observable forms of the same source corruption:

1. malformed tag syntax survives HTML parsing as visible attribute noise; and
2. valid-looking tag syntax is accepted by the parser, so the attribute names and
   their original word order disappear from extracted text.

Recovery must happen from the raw XHTML before Cheerio, the browser DOM, or an
XML parser can reinterpret, normalize, deduplicate, lowercase, or discard the
source lexemes.

## Motivating Audit

The immediate fixture is `books/giftformsfunctio00maus.epub`. It contains two
high-confidence instances of this error class, not one.

| Source | Raw corruption | HTML-mode result | XML-mode result | Required outcome |
| --- | --- | --- | --- | --- |
| `EPUB/page_63.html` | A 1,192-character run begins with `<..case-- exchange="" so="" the="" ... types=""/>` | The entire pseudo-tag is emitted as visible text, producing the reader output in the screenshot | Text stops at the stray `<` | Recover the ordered prose tokens and remove only the accidental tag/attribute syntax |
| `EPUB/page_149.html` | A 511-character run begins with `<f cf.="" also="" venia="" ... disposition=""/>` | Cheerio creates an empty `<f>` element with 56 attributes; the prose is absent from `.text()` | The prose is also unavailable as normal body text | Recover the ordered prose before parsing so it cannot be swallowed |

The repository EPUB corpus currently exposes both instances only in the gift
fixture. That makes the fixture useful for exact regression coverage, but the
production detector must not contain page names, book names, quoted phrases, or
English sentence templates.

Important consequences of the audit:

- Switching from HTML mode to XML mode is not a repair. It converts visible
  corruption into silent truncation on `page_63.html`.
- Inspecting the parsed DOM is insufficient. A parser may discard duplicate
  attribute names, normalize case, and lose the raw token sequence.
- Cleaning the final text with a regex can improve `page_63.html`, but it can
  never restore the text already swallowed on `page_149.html`.
- The corruption can occur in a source unit that otherwise contains readable
  prose. Rejecting the whole page would discard substantially more text than a
  bounded, high-confidence source repair.

## Error Class

Define this class as **prose serialized into markup syntax**: a contiguous body
text span is represented by a tag opener followed by a sequence of lexical
tokens encoded as boolean or empty-valued attributes.

The first implementation must recognize these manifestations:

1. **Invalid pseudo-tag leakage**
   - The opener is not a legal HTML/XML tag, such as `<..case--`.
   - HTML parsing may preserve the complete source fragment as text.
   - Other parsers may truncate or reject the document at the opener.

2. **Valid-looking synthetic element consumption**
   - The opener is syntactically legal, such as `<f`.
   - The parser creates an empty element and stores prose words as attributes.
   - Normal text extraction silently loses the complete span.

3. **Known-tag collision**
   - A stray `<` may make the first prose token resemble a real tag name.
   - Tag-name validity is therefore evidence, not an absolute allow or deny
     rule. A real-looking element with a long, sentence-like run of unknown
     empty attributes still needs detection.

4. **Duplicate-token loss**
   - Prose commonly repeats words such as articles and conjunctions.
   - DOM attribute maps cannot represent duplicate names faithfully.
   - Recovery must preserve every raw occurrence in source order.

The following remain outside this plan:

- general OCR spelling correction;
- reconstruction of words absent from the XHTML;
- ordinary malformed nesting with no recoverable prose lexemes;
- arbitrary tag stripping or HTML sanitization;
- legitimate code examples that intentionally show markup;
- guessing text from non-empty application attributes such as `alt`, `title`,
  `aria-label`, or `data-*`.

Those cases may be diagnosed, but this repair must not invent prose for them.

## Root Cause In The Current Pipeline

`src/core/ingest/structure.ts` decodes each ZIP entry and passes the resulting
string through Cheerio in several independent structure and content paths. The
canonical text path eventually calls `extractReadableTextFromHtml`, clones the
parsed body, and returns `.text()`.

That ordering is irreversible for this error class:

```text
raw XHTML
  -> Cheerio parse
  -> DOM normalization or text extraction
  -> content-quality analysis
```

By the time `RawContentUnit` reaches `contentQuality.ts`, `page_63.html` contains
literal `word=""` noise and `page_149.html` has lost the swallowed words. The
quality layer has no common representation from which it can repair both.

There is also no single content-document loader. Heading recovery, TOC target
validation, non-reading classification, final slice loading, and epigraph
inspection can decode and parse the same archive entry independently. A repair
applied only in `extractReadableTextFromHtml` would leave structure estimates,
titles, slice boundaries, and persisted content on different source views.

## Design Principles

1. Inspect and repair raw content-document XHTML before any DOM parser sees it.
2. Recover only lexemes already present in the source and preserve their order.
3. Treat the tag head as uncertain source text; do not silently spell-correct it.
4. Use a small lexical scanner, not one broad replacement regex.
5. Make valid tag and attribute knowledge negative evidence, not an absolute
   exemption from corruption checks.
6. Abstain when a candidate is ambiguous. Never turn application metadata into
   reading prose.
7. If ambiguous malformed markup would cause substantial silent text loss,
   reject or quarantine the source unit with an explicit reason rather than
   accepting truncated content.
8. Keep the repair deterministic, idempotent, linear in document size, and
   observable through the existing content-quality audit.
9. Use one repaired XHTML string for structure discovery, estimates, final
   loading, and persisted reader text.
10. Keep this structural repair separate from OCR spelling, hard-wrap, reference,
    and page-furniture normalization.

## Target Pipeline

```text
ZIP entry bytes
  -> decode raw content-document XHTML
  -> scan raw body markup for prose-as-attribute candidates
  -> classify candidate: repair | ambiguous | legitimate
  -> replace high-confidence candidates with escaped text nodes
  -> parse the repaired XHTML once per consumer/cache lifetime
  -> semantic cleanup and slice extraction
  -> per-unit content-quality analysis
  -> final text cleanup and RSVP tokenization
```

Container XML, OPF metadata, and NCX documents must continue through their XML
parsers unchanged. The recovery stage applies only to manifest content documents
that can contribute reader-facing XHTML/HTML.

## Proposed Module

Add `src/core/ingest/markupRecovery.ts` with no ZIP, Cheerio, browser, or store
dependency.

```ts
export type MalformedMarkupKind =
    | 'invalid-pseudo-tag'
    | 'synthetic-empty-element'
    | 'known-tag-collision'
    | 'ambiguous-markup';

export type MarkupRecoveryAction = 'repair' | 'abstain';

export interface MarkupRecoveryRecord {
    kind: MalformedMarkupKind;
    action: MarkupRecoveryAction;
    confidence: number;
    startOffset: number;
    endOffset: number;
    recoveredTokenCount: number;
    rawSample: string;
    recoveredSample: string;
    reason: string;
}

export interface MarkupRecoveryResult {
    html: string;
    records: MarkupRecoveryRecord[];
    recoveredTokenCount: number;
    recoveredCharacterCount: number;
    unresolvedCandidateCount: number;
}

export const recoverMalformedProseMarkup = (
    rawHtml: string,
): MarkupRecoveryResult => {
    // Pure, deterministic implementation.
};
```

Keep bounded diagnostic samples, but retain offsets and counts for every
candidate. Do not expose full book text in normal logs.

Extend `RawContentUnit` with the recovery records that apply to that unit, or
carry equivalent provenance alongside it. Add `malformed-prose-markup` to
`ContentIssueType`. A successful structural recovery should make the unit
`accept-degraded` and remain visible in `contentQualityAudit`; it should not be
reported as an unremarkable clean page.

## Raw Lexical Scanner

Implement a single-pass scanner over raw XHTML. It must understand enough markup
lexing to find candidate boundaries without claiming to be a replacement HTML
parser.

The scanner should track:

- text, tag, comment, CDATA, processing-instruction, and quoted-value states;
- the raw tag-head lexeme after `<`;
- each attribute occurrence in order, including duplicates;
- original spelling, punctuation, entities, and quote style;
- whether each value is absent, empty, or non-empty;
- self-closing and normal `>` boundaries;
- whether the candidate occurs inside a reader-facing body block.

Do not inspect candidate-looking text inside `script`, `style`, `noscript`, or
SVG metadata. Treat `pre` and `code` as strong legitimate-literal evidence and
abstain by default. The scanner may use a small stack of recognized raw element
names to establish these contexts, but recovery decisions must not depend on a
successfully built DOM.

Collect candidate edits first and apply them from right to left. This preserves
raw offsets in diagnostics and prevents one replacement from changing the next
candidate's location.

## Candidate Detection

Detection should combine independent signals. No single `=""` occurrence is
enough.

### Positive Evidence

- A contiguous run contains many empty-valued or boolean attributes.
- Most attribute-name lexemes contain Unicode letters or numbers and resemble
  reading tokens rather than known HTML attributes.
- The sequence contains sentence-like punctuation embedded in token names,
  such as `.`, `,`, `;`, `:`, or hyphenated forms.
- The candidate is embedded between ordinary text or closes at the end of a
  prose block.
- The element has no meaningful child content.
- The raw opener is invalid or the parsed representation would consume a large
  lexical span.
- Repeated raw attribute names show that DOM-map extraction would be lossy.

### Negative Evidence

- The attributes are known global, ARIA, event, SVG, MathML, or tag-specific
  attributes with plausible values.
- The element contains child text or nested elements consistent with authored
  markup.
- Attribute values are meaningfully non-empty.
- Names predominantly use `data-*`, `aria-*`, framework bindings, namespaces,
  or machine identifiers.
- The candidate is in `pre`, `code`, `script`, `style`, or authored literal
  markup.
- The token run is short and has no punctuation or surrounding prose evidence.

Use named, exported thresholds so boundary behavior is testable. A reasonable
starting characterization is:

- high confidence at eight or more contiguous empty attributes with at least
  75% lexical names and little recognized-attribute evidence;
- four to seven attributes only when the opener is invalid and at least two
  additional signals agree;
- no automatic repair below four attributes in the first implementation.

These are initial test boundaries, not permanent truth. Run them against the
whole local corpus and inspect every candidate before fixing the values. The
production behavior must derive from source evidence, never a fixture path.

## Repair Algorithm

For each high-confidence candidate:

1. Read tokens from the raw source, not from `element.attribs`.
2. Preserve every attribute-name occurrence in original order, including
   duplicates and case.
3. Remove only structural syntax introduced by the accidental serialization:
   `<`, `>`, `/>`, whitespace around `=`, empty quotes, and separators proven to
   be attribute syntax.
4. Preserve punctuation and entities belonging to the name lexeme.
5. Preserve the printable tag-head lexeme as uncertain content after removing
   only the opening delimiter. Do not change `case--` into a corrected phrase
   and do not infer a missing word.
6. Join recovered lexemes with one space, then escape the result as text for
   safe insertion into XHTML. Never promote recovered tokens or values into new
   markup.
7. Preserve the surrounding paragraph and block boundaries.
8. Record the raw and recovered samples, token count, offsets, confidence, and
   reason.

The exact gift output may remain imperfect OCR. The structural success criterion
is that `case-- exchange so the potlatch ...` and `cf. also venia venus venenum
... god loki curses the gold ...` survive as ordered reading text without
`=""` scaffolding. Lexical correction belongs to a later, separately evidenced
OCR feature.

For an ambiguous candidate:

- do not rewrite it;
- record an `abstain` diagnostic;
- compare parser-visible text with the raw recoverable-token estimate;
- if accepting the unit would silently lose a substantial span, reject the unit
  with a stable `unresolved malformed prose markup` reason;
- otherwise preserve the source and surface the diagnostic to the inspector.

This avoids both destructive false positives and silent page truncation.

## Central Content-Document Loader

Add a small cached loader in `structure.ts`, or a neighboring module, that owns
content-document decoding and markup recovery:

```ts
interface LoadedEpubContentDocument {
    path: string;
    rawHtml: string;
    repairedHtml: string;
    recovery: MarkupRecoveryResult;
}
```

Thread this loader through all content-document consumers:

- document and scan heading discovery;
- leading-epigraph inspection;
- TOC target validation when it opens a spine document;
- publication-matter and source-unit classification;
- structure estimates and content-quality profiling;
- `loadPlannedChapterSources` final resolution.

Do not apply it to `META-INF/container.xml`, OPF, or NCX parsing. Navigation
documents may use it only if their body text is intentionally considered reading
content; normal navigation link extraction should remain markup-driven.

The cache key should be the normalized archive path. Every consumer must receive
the same repaired string and recovery records. This removes the current risk
that planning sees repaired content while final loading reparses the raw entry.

Repair before `extractSliceHtml`. Replacing a corrupt inline candidate with a
text node leaves paragraph and heading elements intact, so fragment, heading,
and block slice boundaries remain meaningful. Add a regression proving that a
repair before a later boundary does not move the selected source slice.

## Quality Accounting And Final Guards

Extend the existing audit rather than creating a second disconnected report.

For each affected source unit, report:

- `malformed-prose-markup` issue type;
- repaired and unresolved candidate counts;
- recovered token and character counts;
- bounded before/after samples;
- candidate kind and confidence;
- `accept-degraded`, `reject`, or explicit abstention outcome.

Update `validateFinalContent` or add a neighboring structural guard with these
invariants:

1. Accepted output contains no long prose-like `token=""` run.
2. Every high-confidence raw candidate is repaired exactly once.
3. No candidate marked `repair` is absent from the canonical cleaned text.
4. No source with a substantial unresolved parser-loss candidate is accepted.
5. Recovery does not reduce ordinary visible text outside candidate offsets.
6. Running recovery twice produces byte-identical XHTML and no new records.
7. Section estimates still equal the canonical persisted word count.

Do not globally reject text containing `=""`; technical books and code examples
may contain it legitimately. The final guard must use the same candidate
classifier and source provenance as recovery.

Update `scripts/inspect_epub_quality.mjs` to aggregate repaired candidates,
recovered tokens, unresolved candidates, and affected paths. The inspector must
call production recovery code and print bounded samples; it must not duplicate
the scanner or thresholds.

## Test Plan

### Scanner Unit Tests

Create `src/core/ingest/markupRecovery.test.ts` with focused raw-XHTML cases:

- Recover the complete `page_63.html` candidate without any `=""` residue.
- Recover the complete `page_149.html` candidate that Cheerio otherwise turns
  into an empty element.
- Preserve duplicate attribute-name tokens in their original order.
- Preserve original case, Unicode letters, entities, apostrophes, periods,
  commas, and hyphenated tokens.
- Escape recovered `<`, `>`, and `&` as text rather than creating markup.
- Repair two independent candidates in one source without offset drift.
- Produce identical XHTML and zero additional repairs on a second pass.
- Leave an ordinary element with valid empty attributes unchanged.
- Leave a custom element with plausible `data-*` and ARIA attributes unchanged.
- Leave authored markup examples inside `pre` and `code` unchanged.
- Leave SVG and MathML attribute sets unchanged.
- Abstain on a short or mixed non-empty attribute sequence.
- Diagnose, but do not partially rewrite, an unterminated quoted candidate.
- Mark a known-tag collision as repairable only when the full evidence threshold
  is met.

Use reduced synthetic fixtures for most tests and include the two exact raw gift
fragments as characterization fixtures. The scanner tests should not need JSZip,
Cheerio, or the full EPUB.

### Parser Differential Tests

Add tests that demonstrate why the pre-parse stage exists:

- Before recovery, HTML mode exposes `page_63.html` attribute scaffolding.
- Before recovery, HTML mode drops the `page_149.html` attribute-name prose.
- After recovery, HTML mode and XML-compatible text extraction both contain the
  same recovered token anchors.
- Parsed DOM attribute deduplication cannot change recovery output because the
  raw scanner is authoritative.

These are regression oracles, not a production strategy that runs multiple
parsers for every page.

### Structure Integration Tests

In `src/core/ingest/structure.test.ts`, build a small synthetic EPUB containing
both corruption forms and assert:

- planning and `loadPlannedChapterSources` return the same recovered text;
- headings, fragment boundaries, and source ordering remain unchanged;
- affected units are `accept-degraded` with a markup-recovery issue;
- the swallowed-token variant contributes to `estimatedWords`;
- final output contains no high-confidence attribute scaffolding;
- unresolved substantial parser loss rejects the unit with a specific reason.

### Gift Corpus Regression

Extend `src/core/ingest/structure.corpus.integration.test.ts` to assert:

- `EPUB/page_63.html` contains the ordered anchor `exchange so the potlatch in
  north- west america` after recovery and contains no long `=""` run;
- `EPUB/page_149.html` contains anchors from both the beginning and end of its
  swallowed span, including `also venia venus venenum` and `god loki curses the
  gold`;
- the quality audit identifies both pages as recovered malformed prose markup;
- no other gift source is changed by the markup recovery stage;
- accepted, skipped, and rejected source accounting remains complete and
  non-overlapping;
- final section estimates equal resolved canonical word counts.

Extend the repository corpus loop with a diagnostic scan of every accepted
source. It should fail on unresolved high-confidence prose-as-attribute runs and
print the path and bounded sample. Do not assert that the gift fixture is the
only EPUB that can ever contain this class.

### False-Positive Corpus

Include representative legitimate XHTML snippets even if the current books do
not contain all of them:

- form controls with `disabled=""`, `checked=""`, and `required=""`;
- EPUB semantics and namespace declarations;
- ARIA and `data-*` attributes;
- SVG and MathML elements with many attributes;
- custom elements with boolean attributes;
- prose discussing literal HTML in `code` or `pre`;
- non-English and non-Latin prose tokens;
- attributes with meaningful non-empty values.

The repair must remain language-neutral. Do not require an English dictionary or
English stopword list to classify candidates.

## Implementation Sequence

### Phase 1: Characterization

1. Add the two exact malformed fragments as scanner fixtures.
2. Add failing tests for visible leakage, swallowed text, duplicate names, and
   idempotence.
3. Extend the inspector temporarily through production diagnostics so corpus
   candidates and false positives can be reviewed.
4. Record baseline section and total word counts before changing ingestion.

### Phase 2: Raw Recovery

1. Implement the lexical state machine and candidate record model.
2. Add named confidence thresholds and recognized-attribute negative evidence.
3. Implement right-to-left replacement with escaped text nodes.
4. Run scanner and parser-differential tests before integration.

### Phase 3: Canonical Integration

1. Introduce the cached content-document loader.
2. Route heading, boundary, classification, estimate, and final-load consumers
   through the same repaired XHTML.
3. Attach recovery records to `RawContentUnit` and the quality audit.
4. Run the focused structure tests immediately after the first integration
   change.

### Phase 4: Guards And Policy

1. Add `malformed-prose-markup` to quality issues.
2. Mark repaired units degraded and reject substantial unresolved parser loss.
3. Add final no-leak, no-silent-loss, accounting, and idempotence guards.
4. Update inspector aggregates and bounded diagnostics.

### Phase 5: Corpus Verification

1. Add exact gift anchors for both affected pages.
2. Run the entire repository EPUB corpus and inspect every recovery or
   abstention.
3. Tune only named thresholds, with a regression fixture for every adjustment.
4. Confirm unrelated EPUB word counts and chapter boundaries are unchanged.

## Regression Commands

Run tests non-interactively:

```sh
npx vitest run src/core/ingest/markupRecovery.test.ts
npx vitest run src/core/ingest/contentQuality.test.ts src/core/ingest/structure.test.ts
npm run test:epub-corpus
npm run lint
npm run build
```

Inspect the motivating fixture through production code:

```sh
npm run inspect:epub -- books/giftformsfunctio00maus.epub
```

## Acceptance Criteria

1. The reader never displays the `case="" exchange="" ...` scaffolding from
   `page_63.html`.
2. The prose currently swallowed by the synthetic `<f>` element on
   `page_149.html` is present in canonical chapter text and estimates.
3. Both repairs preserve raw token order, duplicates, punctuation, case, and
   Unicode without dictionary-based rewriting.
4. Every repair is visible as a bounded `malformed-prose-markup` audit record.
5. Ambiguous markup is never silently flattened into prose; substantial
   unresolved parser loss prevents acceptance.
6. Legitimate HTML, EPUB semantics, custom elements, SVG, MathML, and literal
   code fixtures remain byte-identical.
7. Structure planning and final chapter loading consume the same repaired XHTML.
8. Recovery is deterministic and idempotent.
9. Source accounting and estimate-equals-output invariants continue to pass.
10. No production rule names the gift book, a page number, or a phrase from the
    fixture.

## Definition Of Done

- A dedicated pre-parse recovery module handles both parser-visible and
  parser-swallowed manifestations of prose serialized as attributes.
- The two known gift spans are recovered, audited, and protected by integration
  tests.
- High-confidence unresolved instances cannot pass the final content guard.
- False-positive fixtures for legitimate attribute-heavy markup pass unchanged.
- The inspector makes the next occurrence diagnosable without reproducing a
  reader screenshot.
- Focused tests, the opt-in EPUB corpus, lint, and build pass.