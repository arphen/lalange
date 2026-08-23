# Design Document Inventory

## Review

Reviewed 2026-08-23 against `main` at `cfa2c76` and the current source tree. This is a maintenance index, not a replacement for the plans below. `Keep` means the document still carries implementation or architectural value; its status section is the authority for what is already true.

## Active Implementation Plans

- [`CONTENTS_NAVIGATION_REDESIGN_PLAN_V2.md`](CONTENTS_NAVIGATION_REDESIGN_PLAN_V2.md) - Keep and update. This is the active Contents model. `SidebarV2.tsx` already provides the flat outline, passages, transient search, Recaps, About, and the modal/desktop rail split. Focus, resize, accessibility, and density acceptance still need verification.
- [`INTERNAL_READING_SECTIONS_PLAN.md`](INTERNAL_READING_SECTIONS_PLAN.md) - Keep and update. PDF outline-derived chapters now exist, but the format-independent reading-section normalizer, generated grouping, and existing-book migration described here do not.
- [`EPUB_CONTENT_HARDENING_PLAN.md`](EPUB_CONTENT_HARDENING_PLAN.md) - Keep and update. Content-quality analysis, line-wrap repair, and related tests exist; the broader audit and policy contract remains useful for future ingestion work.
- [`MALFORMED_EPUB_PROSE_MARKUP_RECOVERY_PLAN.md`](MALFORMED_EPUB_PROSE_MARKUP_RECOVERY_PLAN.md) - Keep as a pending ingestion design. Raw-markup recovery is implemented in `src/core/ingest/markupRecovery.ts`, so future work should validate and extend it rather than create a second detector.
- [`PDF_ON_DEVICE_OCR_PLAN.md`](PDF_ON_DEVICE_OCR_PLAN.md) - Keep and update. PDF.js extraction, local OCR, cancellation, and progress foundations exist; full scanned-PDF acceptance and service-worker asset validation remain important.
- [`PDF_LAYOUT_AND_NOTES_PLAN.md`](PDF_LAYOUT_AND_NOTES_PLAN.md) - Keep and update. Layout reconstruction and note extraction/linking modules exist, while broader corpus validation and presentation policy remain future work.
- [`GIFT_EPUB_STRUCTURE_RECOVERY_PLAN.md`](GIFT_EPUB_STRUCTURE_RECOVERY_PLAN.md) - Keep as a fixture-specific acceptance appendix to the generic reading-sections plan. Do not use it as the general architecture document.

## Future Architecture

- [`LOCAL_AI_PROCESSING_CORE_PLAN.md`](LOCAL_AI_PROCESSING_CORE_PLAN.md) - Keep as the canonical local-AI architecture. It defines default-off selective text repair, prompt-logprob pacing compatibility, one model broker, versioned artifacts, structure-discovery plugins, lifecycle cleanup, UI warnings, and phased acceptance. The current broad AI switch, mutable global engine, randomized logprob fallback, and in-memory scheduler do not yet satisfy it.
- [`PRE_RENDERED_AUDIOBOOK_IMPLEMENTATION_PLAN.md`](PRE_RENDERED_AUDIOBOOK_IMPLEMENTATION_PLAN.md) - Keep as a future product and implementation proposal. There is currently no `src/core/audio-render/` runtime, artifact schema, OPFS audio store, or rendered playback path.
- [`CONTINUOUS_TTS_PACING_AND_WPM_PLAN.md`](CONTINUOUS_TTS_PACING_AND_WPM_PLAN.md) - Keep as the active future plan for continuity-aware TTS pacing and honest WPM controls. The current player exposes queue inventory, but not the pacing controller, buffered-audio telemetry, or delivered-WPM contract described here.
- [`RENDERING_SERVICES_ARCHITECTURE_PERFORMANCE_PLAN.md`](RENDERING_SERVICES_ARCHITECTURE_PERFORMANCE_PLAN.md) - Keep and update as the broad reader architecture follow-up. The session controller, context projector, reader benchmark, structured display projector, and operation progress primitive have landed; the full ownership refactor and measurements have not.

## Implemented Or Reference Material

- [`COMMON_NGRAM_RSVP_GROUPING_PLAN.md`](COMMON_NGRAM_RSVP_GROUPING_PLAN.md) - Keep as the behavior contract and implementation record. The setting, planner, Reader integration, and tests are present; default remains off.
- [`PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PLAN.md`](PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PLAN.md) - Keep as the original measurement record, but treat its completed low-risk fixes as historical rather than pending tasks.
- [`PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PHASE_2.md`](PERFORMANCE_PROFILING_AND_TTS_OPTIMIZATION_PHASE_2.md) - Keep as the completed validation record. Energy profiling remains explicitly open.
- [`READER_PERFORMANCE_BASELINE.md`](READER_PERFORMANCE_BASELINE.md) - Keep as the current deterministic benchmark contract.

## Superseded

- `CHAPTER_MENU_REDESIGN_PLAN.md` was removed. V2 explicitly supersedes it and is now the single Contents redesign plan.

## Other Documentation

The remaining documents are product, research, deployment, exchange, exhibition, RSVP, settings, and reference material rather than duplicate active design plans. They remain in place and were not rewritten in this pass.

## Maintenance Rules

- Update a plan's status and reality section when implementation lands; do not leave completed work described only as a future phase.
- Keep one active plan per problem area. Put fixture-specific evidence in an appendix or clearly label it as reference.
- Prefer source-file and symbol anchors over fragile line-number claims.
- Delete a plan only when a surviving document contains its useful contract or it has no remaining decision, acceptance criterion, or historical evidence worth preserving.
