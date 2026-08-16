# Reader Performance Baseline

This is the deterministic baseline for the production-shaped Reader fixture in
`src/components/Reader/readerBenchmark.ts`. It exercises the live frame planner,
weighted timing functions, structured context projection, and session commands
without depending on browser trace artifacts.

| Scenario | Fixture input | Contract |
| --- | --- | --- |
| RSVP playback | 20 words, 600 WPM, 2 seconds | 20 frames, one initial rebuild per river, cursor reaches 20 |
| Summary transition | 3-word summary | Summary mode pauses playback and restores the saved text cursor |
| Chapter transition | `chapter-2`, destination index 2 | Transition mode blocks playback until completion |
| Manual seek | Destination index 5 | Seek clamps through the session boundary and pauses playback |
| TTS handoff | RSVP -> TTS -> RSVP | TTS owns the transport while active; RSVP can reclaim it afterward |

The fixture is a behavioral budget, not a substitute for browser profiling. The
URL-gated `readerPerf` counters remain available for desktop and mobile traces;
those traces should be compared against this table when timing or DOM work is
changed.