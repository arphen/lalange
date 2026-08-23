# Continuous TTS Pacing And Honest WPM Controls

## Status

- Prepared: 2026-08-23
- Core pacing scope: implemented and validated
- Piper fallback extension: implemented and validated; Q8 precision rung remains benchmark-gated
- Primary surfaces: Reader speed dock, TTS generation loop, Web Audio player,
  TTS settings, and listening handoff
- Default user preference: `1.0x` speech with continuous playback enabled

## Outcome

TTS should prefer a steady, slightly slower voice over normal-speed speech that
repeatedly stops to wait for generation. The application should measure what
the current device can sustain, lower the delivered speech rate when needed,
and recover toward the user's selected rate when there is enough headroom.

The Reader's existing speed dock should become transport-aware:

- in RSVP mode, it continues to show and adjust RSVP WPM;
- in Listen mode, it shows delivered speech WPM and adjusts TTS speech speed;
- when the device is limiting speech speed, it says so in one short line; and
- if the user asks for more speed than the device can sustain, it offers an
  explicit choice between continuous audio and faster audio with possible
  pauses.

This is not a promise that every device can generate every voice continuously.
If generation still falls behind at the minimum supported speed, the UI must
say that audio is catching up instead of claiming that playback is continuous.

## Product Decisions

1. Keep the persisted speech-speed default at `1.0x`.
2. Add a `Continuous audio` preference and enable it by default.
3. Treat `1.0x` as the user's preferred rate, not a guarantee about the rate
   currently reaching their ears.
4. Derive a separate effective rate from measured generation throughput and
   buffered audio. Never infer it from device names or user-agent checks.
5. Prefer natural engine-level speed changes for future Kokoro sentences.
   Keep Piper's existing playback-rate behavior, with its existing pitch caveat.
6. Change effective rate only at sentence boundaries. Do not stretch or restart
   a sentence while it is being spoken.
7. Use the persistent Reader speed dock for both transports. Do not add a
   second primary speed control that competes for attention.
8. Use plain effect-reason-action copy. Do not expose terms such as RTF,
   inference, throttling, adaptive cap, or generation throughput in normal UI.
9. Keep device capacity local and transient. Sync the user's preferred speed
   and continuity preference, but never sync a limit learned on one device to
   another device.
10. If Kokoro remains unusably slow, suggest a same-language Piper voice only
    after sustained measured evidence. Never switch engines from a device name,
    user-agent check, model label, or one slow sentence.
11. Never download a fallback model or change voice without an explicit user
    action. The download size and audible voice change must be stated before
    that action.
12. Keep the selected Kokoro voice as the user's preferred voice. A Piper
    performance override is local to the current device and must not replace
    the voice sent in a listening handoff.
13. Call the option a `lighter voice` in the interface. Do not describe it to
    readers as a worse, low-quality, cheap, or degraded model.

## User Contract

### A fast device

The reader selects `1.0x`. Speech plays at `1.0x`, the dock reports the measured
speech WPM, and no performance badge or explanatory text appears.

### A device that needs a slower pace

The reader selects `1.0x`. The application determines that approximately
`0.8x` is sustainable, then moves toward `0.8x` over sentence boundaries. The
dock continues to show measured WPM and adds a small amber downward mark. Its
disclosure says:

> Set to 1.0x. Playing at 0.8x so this device can keep speaking without pauses.

The message names the visible effect, the reason, and the benefit. It does not
describe the implementation.

### A reader who finds the limited pace too slow

The reader presses the plus button. The control must not appear broken when the
effective rate cannot increase. Hover or keyboard focus says:

> Faster speech: 1.1x. This device is keeping audio continuous at 0.8x.

On touch, where hover does not exist, the tap updates the preferred rate and
opens a compact anchored choice:

> 1.1x is faster than this device can currently keep up with.

Actions:

- `Keep continuous`
- `Use 1.1x now (may pause)`

The second action disables continuity limiting for the current preference and
applies the selected speed at the next safe sentence boundary. The same choice
must remain available in the expanded TTS panel as a normal toggle, so it is
not hidden behind a one-time message.

### A device that cannot sustain the minimum rate

At the `0.5x` floor, the player preserves the current sentence, refills, and
shows:

> This device needs a moment to prepare more audio.

The buffer mark changes to the interruption state. The application must not
keep lowering the displayed rate, imply that more buffer will solve sustained
underperformance, or show a paragraph of technical advice in the Reader.

## Current Behavior And Gaps

### Reader speed dock

`src/components/Reader/Reader.tsx` currently owns one RSVP-oriented speed dock:

- `handleSlower` and `handleFaster` only call `setWpm`;
- the prominent number always renders the RSVP `wpm` setting;
- `actualWpm` is calculated only from RSVP frame timestamps while `isPlaying`;
- TTS word changes bypass those timestamps; and
- while TTS is speaking, the dock can therefore show an unrelated target and
  the label `PAUSED`.

The visual location is useful and should be retained. The ownership and labels
need to switch with Listen mode.

### TTS speed

`src/core/store/tts.ts` already persists `speed`, clamps it to `0.5..2.0`, and
defaults it to `1.0`. `src/components/Settings/SettingsPanel.tsx` exposes it as
a settings slider, but the Reader's plus and minus buttons do not adjust it.

`src/components/Reader/TTSPlayer.tsx` passes one captured speed into
`streamSpeech`. A generation batch therefore cannot react to a newly measured
safe rate until a later refill, and changing the setting does not give the
Reader an immediate, visible contract.

### Generation and playback

`src/core/tts/engine.ts` generates sentences serially. This is correct and
should remain serial. The loop does not currently report generation wall time
or compare it with the amount of audio produced.

`src/core/tts/player.ts` knows queued sentence duration and schedules all
contiguous buffers on the Web Audio clock. It can count queued sentences, but
it does not expose buffered seconds, an underrun event, a delivered-rate sample,
or playback WPM.

The existing buffer bars in `TTSPlayer` communicate inventory but not whether
generation is falling behind, why speech was slowed, or what increasing speed
will do.

## Vocabulary And State Ownership

Use these names in code and tests even if the shorter UI copy differs.

| Term                   | Meaning                                                                                                    | Owner                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| `preferredSpeed`       | The user's selected `0.5x..2.0x` rate. Existing persisted `speed` remains compatible.                      | TTS settings store         |
| `effectiveSpeed`       | The rate selected for the next generated sentence. At or below preferred speed when continuity is enabled. | Realtime pacing controller |
| `sustainableSpeed`     | A conservative estimate of what current generation and buffer trends can support.                          | Realtime pacing controller |
| `generationRtf`        | Generation wall seconds divided by produced audible seconds. Internal telemetry only.                      | Generation loop            |
| `bufferedAudioSeconds` | Remaining current audio plus contiguous queued audio, measured in audible seconds.                         | Audio player               |
| `deliveredWpm`         | Source words actually advanced per audible minute over a rolling window.                                   | Audio player telemetry     |
| `continuityMode`       | `continuous` by default, or `prefer-speed` after explicit user choice.                                     | TTS settings store         |
| `paceState`            | `measuring`, `steady`, `limited`, `recovering`, or `interrupted`.                                          | Realtime pacing controller |

The generation loop owns generation timing. The audio player owns audible time,
queue duration, word progress, and underrun detection. The pacing controller
combines those facts and publishes a low-frequency UI snapshot. React must not
recompute throughput from render timestamps.

## Pacing Algorithm

### 1. Measure produced audio against generation time

For every completed sentence, record:

```text
generationRtf = generationWallSeconds / producedAudibleSeconds
```

Use `performance.now()` around the actual engine call. Use the final validated,
trimmed audio duration. Failed generation, model download, session creation,
queueing, and UI work must not enter this measurement.

Short sentences are noisy. Aggregate at least two seconds of produced audio or
multiple adjacent sentences before treating a sample as stable. Keep the first
inference warm-up sample visible to startup safety logic, but do not let that
single outlier permanently determine steady-state speed.

### 2. Estimate a conservative sustainable rate

Use this as the initial controller relationship:

```text
candidateSpeed = currentEffectiveSpeed * targetRtf / observedRtf
```

Start experiments with `targetRtf = 0.80`. That aims to generate one second of
audio in at most 0.8 seconds, leaving headroom for sentence variation and brief
thermal slowdowns. The constant is a benchmark input, not a product truth.

Use a duration-weighted rolling estimate plus a conservative recent value, not
the fastest sentence. A practical first implementation is:

- duration-weighted EWMA over recent samples;
- the worse of the EWMA and recent 75th percentile;
- no more than five recent aggregate samples in memory; and
- reset on engine, backend, voice, model session, or visibility discontinuity.

Clamp the result to `0.5..preferredSpeed` while continuity is enabled. In
`prefer-speed` mode, effective speed equals preferred speed and the controller
reports risk without applying a cap.

### 3. Use buffer trend as the immediate safety signal

Throughput predicts sustainability; buffered seconds show whether the
prediction is currently working. Add a contiguous audible-time snapshot to
the player and start with these tuning bands:

| Buffered audio                                  | Controller response                               |
| ----------------------------------------------- | ------------------------------------------------- |
| More than 15 seconds and stable                 | Eligible for slow recovery toward preferred speed |
| 8 to 15 seconds                                 | Hold the current effective speed                  |
| 4 to 8 seconds and shrinking                    | Lower toward the sustainable estimate             |
| Less than 4 seconds and shrinking               | Lower immediately at the next sentence boundary   |
| Missing next audio when the current source ends | Record an underrun and enter `interrupted`        |

Tune these values with generated audio seconds, not sentence counts. Keep a
hard sentence and memory bound so a chapter with many tiny sentences cannot
grow the queue indefinitely.

### 4. Add hysteresis and bounded recovery

The voice must not speed up and slow down on every sentence.

- Lower quickly when the buffer is in danger.
- Otherwise limit downward changes to `0.10x` per sentence.
- Raise by at most `0.05x` after three healthy aggregate samples and a stable
  buffer above the recovery threshold.
- Ignore changes smaller than `0.05x` for UI state and synthesis.
- Leave `limited` only after sustained healthy evidence, not one fast sentence.

If critical buffer loss requires a larger downward step, take it at the next
sentence boundary and expose one state transition. Do not animate every numeric
sample.

### 5. Calibrate startup without creating the first burst

Keep `1.0x` as the default preference. Generate the first sentence and measure
it before deciding the startup target:

- if the warm sample is comfortably below the target RTF, retain current
  one-sentence startup behavior;
- if it is near or above real time, compute a provisional lower rate, prepare
  another sentence, and require a small audible-time reserve before starting;
- publish `Preparing continuous audio` during this bounded startup wait; and
- carry the provisional rate in memory across chapter continuation for the
  same model session.

Do not persist this learned device rate or include it in device handoff. A new
device must measure itself. Re-evaluate during playback because battery state,
thermal pressure, and browser scheduling can change.

### 6. Apply rate changes at sentence boundaries

For Kokoro, synthesize future sentences with `effectiveSpeed` so slower speech
retains the engine's normal pitch and prosody. For Piper, keep its current
`AudioBufferSourceNode.playbackRate` implementation and document that large
changes affect pitch.

Refactor the generation batch so it reads the controller's effective rate for
each sentence rather than capturing one rate for the entire batch. Preserve:

- authored sentence boundaries;
- serial inference;
- validation and FP32 WASM fallback;
- edge-silence trimming;
- gapless Web Audio scheduling; and
- cancellation guards.

Each queued item must retain the speed and audible duration used to produce it.
Scheduling, progress, buffer seconds, and WPM must use that item's actual
duration rather than the latest global setting.

When the user changes preferred speed, keep the current sentence and one queued
sentence as a safety bridge, cancel generation and buffers farther ahead, and
generate subsequent sentences at the new target. The audible change should
arrive within one sentence without forcing silence on a constrained device.

## Honest WPM

### What the number means

TTS WPM is measured output, not a conversion of `1.0x` into a fictional fixed
WPM. Voices, punctuation, and sentences differ. Calculate it from source-word
progress over Web Audio time:

```text
deliveredWpm = sourceWordEquivalentsAdvanced / audibleMinutesElapsed
```

Use the player's existing weighted word-progress boundaries to estimate the
current partial sentence. Maintain a rolling ten-second sample window, require
at least two seconds before publishing, and update the UI at no more than 5 Hz.

Exclude:

- model loading and generation time before audio starts;
- paused time;
- buffering silence;
- seeks and chapter jumps; and
- hidden stale samples after an AudioContext suspension.

Reset the rolling window on seek, chapter change, voice change, stop, and model
session replacement. On pause, retain the last stable WPM and label it `PAUSED`
instead of replacing it with zero. Before enough audio exists, show the speech
multiplier rather than `0 WPM`.

### Reader dock modes

| Reader state                 | Primary value                       | Secondary value           | Minus/plus action                                 |
| ---------------------------- | ----------------------------------- | ------------------------- | ------------------------------------------------- |
| RSVP open or playing         | RSVP target WPM                     | RSVP real WPM or `PAUSED` | Existing momentum WPM change                      |
| Listen mode, not sampled yet | Preferred speech multiplier         | `SPEECH` or `PREPARING`   | Change TTS speed by `0.1x`                        |
| TTS steady                   | Delivered speech WPM                | Effective multiplier      | Change TTS speed by `0.1x`                        |
| TTS limited                  | Delivered speech WPM plus down mark | `0.8x CONTINUOUS`         | Change preferred speed; explain cap when relevant |
| TTS paused                   | Last stable speech WPM              | `PAUSED - 1.0x SET`       | Change TTS speed by `0.1x`                        |
| TTS interrupted              | Last stable speech WPM              | `PREPARING AUDIO`         | Controls remain available                         |

Switch the dock to TTS semantics whenever Listen mode is open, including idle
and paused states. Switching it only while audio is actively playing would make
the same buttons change RSVP speed immediately before TTS starts.

Keep RSVP `wpm` and TTS `speed` independent. Closing Listen mode restores the
unchanged RSVP target.

## UI Grammar

The state should be legible without turning the reading view into a dashboard.

| Meaning                          | Visual treatment                               | Motion                                       | Text behavior                                                    |
| -------------------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Preferred setting                | Existing cyan/neutral control treatment        | Normal button response                       | Multiplier appears after interaction or before WPM is measurable |
| Healthy continuous audio         | Existing emerald buffer fill                   | No perpetual animation                       | No badge and no explanation by default                           |
| Device-limited pace              | Amber downward tick next to the effective rate | One 180-250 ms transition when state changes | One short line on disclosure                                     |
| Recovering toward preferred pace | Same amber tick at reduced emphasis            | Numeric rate changes only at boundaries      | No repeated toast                                                |
| Actual interruption              | Red/rose break in the buffer strip plus text   | No pulsing loop                              | `Preparing audio` or the explicit minimum-rate message           |

Color is supporting information only. The downward mark, labels, tooltip, and
buffer break must carry the same meaning for color-blind users. Use existing
Lucide icons where available instead of adding new hand-drawn SVG controls.

The buffer strip remains an operational detail in the expanded TTS panel. The
speed dock should show only the state mark and concise rate. Do not duplicate
six buffer slots beside the WPM number.

Honor `prefers-reduced-motion`. Avoid continuous glow or pulse for normal
limited playback; it wastes attention and battery while describing a stable
state.

## Copy Contract

Use these strings as the initial copy baseline and test their accessible names.

| Context                       | Copy                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Startup on constrained device | `Preparing continuous audio`                                                    |
| Limited-state disclosure      | `Set to 1.0x. Playing at 0.8x so this device can keep speaking without pauses.` |
| Plus tooltip while limited    | `Faster speech: 1.1x. This device is keeping audio continuous at 0.8x.`         |
| Faster-choice prompt          | `1.1x is faster than this device can currently keep up with.`                   |
| Keep limiter action           | `Keep continuous`                                                               |
| Override action               | `Use 1.1x now (may pause)`                                                      |
| Continuity setting            | `Continuous audio`                                                              |
| Continuity setting help       | `Slows speech when this device needs more time.`                                |
| Minimum-rate interruption     | `This device needs a moment to prepare more audio.`                             |
| Prefer-speed state            | `Preferred speed - pauses possible`                                             |

Copy rules:

- lead with what is happening;
- state the user-visible reason, not the model architecture;
- state the tradeoff at the action that changes it;
- keep normal-state explanation out of the Reader;
- do not say `AI-optimized`, `intelligent`, `performance mode`, `inference`,
  `real-time factor`, or `throttled`; and
- do not use a toast for an ongoing state that already has a stable home.

## Interaction Details

### Minus and plus

- TTS adjustments use deterministic `0.1x` steps. Do not reuse RSVP momentum;
  the narrow `0.5x..2.0x` range needs predictable taps.
- Align the settings slider to `0.1x` so both controls share one grammar.
- A slower request takes effect at the next safe sentence boundary.
- A faster request below the sustainable rate behaves normally.
- A faster request above the sustainable rate updates the preference, keeps the
  continuity cap, and opens the compact choice described above.
- Rate-limit the explanatory popover to the first blocked increase in a
  limited episode. The amber state mark can reopen it at any time.

### Desktop, keyboard, and touch

- Implement a real tooltip on hover and keyboard focus. Do not rely only on a
  `title` attribute.
- On touch, surface the same information after the relevant tap. There is no
  hover on iPhone.
- Give minus and plus explicit labels such as `Slower speech, 0.9 times` and
  `Faster speech, 1.1 times`.
- Announce entry into `limited` once through a polite live region. Do not
  announce every measured WPM or buffer update.
- Keep the choice popover inside the viewport and above the bottom safe area.
- Preserve stable button and readout dimensions so changing from three-digit
  WPM to a multiplier does not move the controls.

### Expanded TTS panel

Add a compact speed row beside the existing voice and volume controls:

- preferred speed;
- current effective speed only when different;
- `Continuous audio` toggle; and
- one-line state text.

The existing buffer strip should expose buffered audible time in its accessible
label, for example `12 seconds of audio ready`, while retaining coarse visual
slots. Do not add a technical paragraph to this panel.

The full TTS settings page can explain the Piper pitch tradeoff and local model
behavior. The Reader should only explain the immediate pace tradeoff.

## Graceful Kokoro-To-Piper Fallback

### Feasibility and current constraint

The engine router serializes a Kokoro-to-Piper switch, unloads the unused
model, and routes future sentences by voice ID. The installed Piper runtime
also exposes English voices. The app now registers the Slovenian
`sl_SI-artur-medium` voice plus same-language, same-gender English fallback
voices, so an English book can use Piper without changing language or accent.
The fallback catalog is provided through `modelRegistry`, leaving future
providers and languages free to register their own defaults and candidates.

An initial English shortlist is available from the runtime's bundled registry:

| Preferred Kokoro voice | Piper benchmark shortlist                                | Approximate download |
| ---------------------- | -------------------------------------------------------- | -------------------- |
| American, female       | `en_US-hfc_female-medium`, `en_US-amy-low`               | 63.1-63.2 MB         |
| American, male         | `en_US-hfc_male-medium`, `en_US-danny-low`               | about 63 MB          |
| British, female        | `en_GB-alba-medium`, `en_GB-southern_english_female-low` | about 63 MB          |
| British, male          | `en_GB-alan-medium`, `en_GB-alan-low`                    | 63.1-63.2 MB         |

The runtime currently registers the four `low` English candidates in this
table. Do not treat the `low` or `medium` labels as performance evidence. The
inspected files are nearly the same size, and neither file size nor quality
label proves faster inference. Benchmark candidate generation RTF, memory,
startup time, pronunciation, and long-form listening quality on the target
Safari and Chromium devices before expanding or changing the curated map.
Keep one fallback per language/accent/gender combination after that evidence
exists.

The first fallback release should support only mapped `en-US` and `en-GB`
Kokoro voices. A Slovenian voice is already using Piper and has no Kokoro
fallback path. If no same-language candidate exists, do not show the offer.

Before shipping a cross-engine switch on desktop, benchmark Kokoro Q8/WASM as
a same-voice rung. The app already uses the roughly 92 MB Q8 model on iOS, but
desktop currently always selects FP32. If Q8 materially improves sustained RTF
on an older Mac, prefer this ladder there:

1. Kokoro FP32 to Kokoro Q8, preserving the selected voice;
2. Kokoro Q8 to a mapped Piper voice only if Q8 still cannot keep up.

An iPhone is already on Q8 and can proceed directly to the Piper offer. Do not
assume Q8/WASM beats FP32/WebGPU on every desktop; use the same measured trial
and rollback rules. Keep this precision experiment separate from the Piper
implementation so a speed improvement can be attributed to the correct rung.

### Fallback eligibility

Keep engine recommendation policy outside `RealtimePacer`. Add a pure advisor,
for example `src/core/tts/fallbackAdvisor.ts`, that consumes low-frequency
pacing snapshots and underrun events. This avoids teaching the pacing
controller about model catalogs, downloads, prompts, or user consent.

Start with an offer, never an automatic switch, after either condition:

1. Kokoro has produced at least ten seconds of stable measured audio,
   continuous mode has limited effective speed to `0.6x` or below for three
   consecutive sentence samples, and the audible buffer is still shrinking;
   or
2. Kokoro has reached the `0.5x` floor and produced two true underruns within
   sixty audible seconds.

The `0.6x` threshold is an initial product boundary, not a hardware truth. Tune
it only from listening studies and traces. Do not offer fallback:

- during model loading, startup warm-up, a hidden-tab discontinuity, or a user
  pause;
- in `prefer-speed` mode, where pauses are already an explicit choice;
- after one slow or unusually long sentence;
- for an unmapped language or engine already using Piper;
- again in the same limited episode after the reader dismisses it; or
- after Piper was tried and measured no better during the same model session.

Recovery above `0.7x` with a stable buffer ends the limited episode and rearms
the advisor for a future material slowdown. These separate enter/exit
thresholds prevent prompt oscillation.

### Reader user flow

#### 1. Nonblocking recommendation

Keep audio running and place one inline recommendation in the expanded Listen
panel. Do not use a modal, toast, or speed-dock takeover.

> This voice is running very slowly on this device. A lighter local voice may
> keep up better.

If the candidate is cached:

- `Try lighter voice`
- `Keep Heart`

If it is not cached:

- `Download lighter voice - 63 MB`
- `Keep Heart`

Use the actual preferred voice name in the second action. Add one supporting
line before a download:

> The voice will change. Text and speech stay on this device.

The speed dock continues to show measured WPM and the limited/interrupted state.
It must not become an engine picker.

#### 2. Download without breaking current speech

Add a Piper predownload helper that stores the selected model without creating
a Piper inference session. This is important because the current `initTTS`
path unloads Kokoro before Piper initialization; using it for a first-time
download would create a long avoidable silence.

After consent, keep Kokoro speaking while the Piper files download and show
progress in the inline recommendation:

> Downloading lighter voice - 42%

Closing Listen may hide progress but must not silently activate the downloaded
voice. If download fails or the browser is offline, retain Kokoro and show a
retry action in the panel. Do not report a playback error for an optional
fallback download.

The installed Piper download API does not currently expose an abort signal.
Do not render a fake cancel action. A later library upgrade can add real
cancellation; until then, allow the download to finish in cache while keeping
the activation decision revocable.

Track exactly one predownload promise per voice. If no progress arrives for
thirty seconds, change the inline status to `Download is taking longer than
expected` and let the reader hide it while listening continues. Do not start a
second download while the first promise remains unsettled. A page reload is
the only hard escape from a permanently hung library request until the runtime
supports cancellation.

#### 3. Boundary-safe engine transition

Once the candidate is cached and the reader has accepted the switch:

1. stop new Kokoro generation;
2. preserve the current sentence and up to two already generated Kokoro
   sentences as an audible bridge;
3. commit the Reader cursor and identify the first sentence after that bridge;
4. unload Kokoro and initialize the cached Piper model while bridge audio
   continues;
5. generate a small contiguous Piper startup buffer from the first missing
   sentence; and
6. let the scheduler cross to Piper at a sentence boundary without replaying or
   skipping text.

The normal voice-change effect currently stops playback and clears the whole
queue. The fallback path therefore needs an explicit transition operation; it
must not implement the switch by simply calling the existing persisted
`setVoice()` action.

If Piper is not ready before bridge audio ends, show `Preparing lighter voice`
and resume from the committed boundary. Never keep stale Kokoro capacity
samples after the switch. Immediately before the first Piper sentence starts,
reset generation samples and the advisor, and add a player telemetry reset that
clears delivered WPM and buffer trend without deleting the preserved bridge
buffers. Do not reuse `clearQueue()` for that reset.

#### 4. Trial and rollback

While the override is active, the Listen panel should identify both voices:

> Amy - lighter voice
>
> Preferred voice: Heart

Keep `Return to Heart` available beside the voice row. Manually choosing any
voice exits the fallback override and follows the normal explicit voice-change
path.

Treat the first Piper run as a trial. After at least ten seconds of generated
audio and three sentence samples, compare it with the Kokoro episode that
triggered the offer. Success requires materially better continuity, such as no
new underrun and at least `0.15x` more sustainable speed. If Piper is not
better, do not switch back automatically and surprise the reader again. Show:

> This voice is not keeping up better on this device.

Actions:

- `Return to Heart`
- `Keep Amy`

If Piper also fails at `0.5x`, use the existing honest interruption state.
There is no third automatic fallback and no engine-switch loop.

### Preference and handoff ownership

Separate voice identity from the active performance override:

| State                                               | Persistence                          | Handoff |
| --------------------------------------------------- | ------------------------------------ | ------- |
| `preferredVoice`                                    | Existing local preference            | Yes     |
| `activeVoiceOverride`                               | Current listening session by default | No      |
| `fallbackStatus` and download progress              | Transient                            | No      |
| Measured Kokoro/Piper capacity                      | Transient and bounded                | No      |
| Cached Piper model files                            | Browser OPFS                         | No      |
| `fallbackPolicy` (`ask`, `prefer-lighter`, `never`) | Optional device-local setting        | No      |

For compatibility, the existing persisted `voice` can remain the preferred
voice while runtime code derives `activeVoice = activeVoiceOverride ?? voice`.
Do not write an accepted session trial through `setVoice()`, and do not place
the override in `ttsSettings` exchange payloads.

The first release should default to session-only fallback and `ask` policy. A
full TTS setting may later offer `Prefer lighter voices on this device` and
`Do not suggest lighter voices`. Both are device policies, not book metadata.
Define the session boundary as closing Listen, changing books, or reloading the
page. Any of those clears `activeVoiceOverride`; a completed Piper download may
remain cached and can be offered as ready on the next eligible session.

### Failure containment

- A failed download leaves Kokoro playback and the preferred voice unchanged.
- A failed Piper initialization clears the override and resumes Kokoro from the
  committed sentence after Kokoro reloads.
- A switch request that becomes stale because of seek, chapter change, voice
  change, or panel close must not activate later.
- The transition carries a generation ID and aborts stale sentence results just
  like normal generation replacement.
- Never hold live Kokoro and Piper inference sessions at the same time. Cached
  files may coexist; model sessions may not.
- Do not send sentence text, voice samples, RTF history, or fallback decisions
  to analytics or persistence.

### Fallback test plan

Add deterministic coverage for:

- eligibility requires sustained low Kokoro performance, not warm-up noise;
- recovery and dismissal suppress repeated offers in one episode;
- prefer-speed, Piper-active, and unmapped-language states are ineligible;
- a constrained desktop offers a benchmark-approved Q8 rung before Piper;
- an iPhone already using Q8 does not offer or download the Q8 rung again;
- candidate mapping preserves language, accent, and gender;
- an uncached candidate requires explicit download consent;
- predownload leaves Kokoro loaded and cannot activate the voice by itself;
- download failure leaves playback untouched;
- accepted switching preserves the current and bridge sentences exactly once;
- stale downloads and generations cannot switch after seek or chapter change;
- engine transition resets pacing, WPM, buffer, and underrun evidence;
- preferred voice remains persisted and handed off while the override does not;
- `Return to Heart` resumes at the committed sentence without duplication;
- Piper-not-better state offers rollback and cannot trigger a switch loop; and
- keyboard, touch, VoiceOver, offline, and reduced-motion flows expose the same
  decision and status.

Before enabling recommendations, benchmark every curated candidate on an older
Intel Mac, iPhone Safari, and CPU/WASM Chromium. Record cold cached startup,
sentence RTF distribution, peak memory, sustainable speed, and listening
quality. Piper must demonstrate a material continuity improvement on at least
the constrained target class; a smaller download alone is not acceptance.

### Fallback acceptance criteria

- No fallback bytes download before explicit consent.
- No automatic voice or language change occurs.
- The offer appears only from measured sustained Kokoro underperformance.
- Accepting a cached fallback does not replay or skip source words.
- The Reader remains usable while an optional model downloads.
- Preferred voice, speed, and continuity preference survive fallback and
  rollback unchanged.
- Device-local fallback state is absent from listening handoffs.
- The original voice can be restored from the Listen panel at all times.
- A fallback that performs no better is reported honestly and is not retried
  automatically in the same session.
- Normal healthy Kokoro playback adds no fallback UI or background work.

## Implementation Plan

### Phase 1: Add telemetry without changing playback

1. Add generation timing around the engine call in
   `src/core/tts/engine.ts` or the per-sentence generation owner.
2. Extend queued audio metadata in `src/core/tts/audio.ts` and
   `src/core/tts/player.ts` with the rate and raw/audible durations needed for
   correct scheduling.
3. Add a `getBufferSnapshot()` API that returns contiguous sentence count,
   remaining audible seconds, and whether the next expected sentence is ready.
4. Add an explicit underrun callback. Startup waiting and a user pause are not
   underruns.
5. Publish delivered WPM and buffer telemetry from the Web Audio clock at no
   more than the existing 5 Hz UI cadence.
6. Keep telemetry bounded and in memory. Do not log sentence text, persist
   runtime samples, or add a store update on every animation frame.

Phase 1 is successful when a deterministic fake generator can report RTF,
buffered seconds, actual WPM, and underruns while playback behavior remains
unchanged.

### Phase 2: Add the realtime pacing controller

Create a small pure module such as `src/core/tts/realtimePacer.ts`. It should
accept generation samples, buffer snapshots, preferred speed, and continuity
mode, then return one immutable pacing snapshot. Keep policy math out of the
React component and Web Audio scheduler.

Implement:

- duration-weighted throughput aggregation;
- target headroom;
- `0.5x..preferredSpeed` clamping;
- buffer danger response;
- hysteresis and bounded recovery;
- warm-up and reset behavior;
- minimum-rate failure state; and
- `prefer-speed` override.

Unit-test this module with a fake clock and fixed samples before connecting it
to real generation.

### Phase 3: Integrate per-sentence effective speed

1. Refactor `TTSPlayer.generateFrom` and `streamSpeech` so speed is resolved for
   every sentence instead of once per generator batch.
2. Feed completed generation samples and player buffer snapshots into the
   pacing controller.
3. Generate future Kokoro audio at effective speed and retain Piper's player
   rate semantics.
4. Store rate metadata on every queue item and schedule using item duration.
5. Add constrained startup calibration and carry the controller across
   automatic chapter continuation.
6. Handle preferred-speed changes by preserving current audio, retaining one
   safety sentence, and replacing farther lookahead.
7. Reset capacity evidence when voice, backend, model session, or browser
   visibility continuity changes.

Do not change backend selection, precision, sentence segmentation, or inference
concurrency in this phase.

### Phase 4: Make the Reader dock transport-aware

In `src/components/Reader/Reader.tsx`:

1. Rename local RSVP telemetry to `rsvpActualWpm` to prevent accidental reuse.
2. Select the bounded TTS pacing snapshot needed by the dock.
3. Derive a dock view model from `showTTSPlayer`, RSVP state, and TTS state.
4. Route minus and plus to `setWpm` in RSVP mode and `setSpeed` in Listen mode.
5. Preserve RSVP momentum and use fixed `0.1x` steps for TTS.
6. Render the correct primary value, secondary label, color, and state mark.
7. Retain the last stable TTS WPM on pause and show the multiplier before the
   first stable sample.

Keep the transport switch based on Listen mode being open, not just on the
audio player's active state.

### Phase 5: Add concise status and user choice

In `src/components/Reader/TTSPlayer.tsx` and the Reader speed dock:

1. Add the limited-state disclosure and the custom plus tooltip.
2. Add the touch/keyboard choice between continuous audio and possible pauses.
3. Add the `Continuous audio` toggle and compact speed row.
4. Change the buffer accessibility label from sentence inventory to audible
   time while preserving the visual meter.
5. Add the one-time polite announcement on entering limited mode.
6. Apply the UI grammar in `src/index.css`, including reduced motion and mobile
   safe-area behavior.

In `src/components/Settings/SettingsPanel.tsx`, align the speech slider step,
add the continuity preference, and keep the longer Piper explanation there.

### Phase 6: Persistence and handoff

Extend `src/core/store/tts.ts` carefully:

- keep legacy persisted `speed` data valid;
- default missing continuity data to `continuous`;
- persist only the user's preference, never effective speed, RTF, buffer,
  delivered WPM, pace state, or learned device capacity;
- retain the existing guarantee of zero settings writes from runtime playback
  updates; and
- send preferred speed and continuity preference in future handoff payloads,
  but require the receiving device to measure its own sustainable speed.

Do not silently replace an existing user's preferred speed with the currently
limited effective speed.

## Test Plan

### Pure controller tests

Add deterministic tests for:

- fast generation stays at preferred speed;
- sustained RTF above target lowers effective speed;
- duration weighting prevents tiny sentences from dominating;
- a shrinking low buffer lowers speed before an underrun;
- a healthy buffer recovers slowly without oscillation;
- effective speed never exceeds preferred speed in continuous mode;
- effective speed never drops below `0.5x`;
- prefer-speed mode reports risk but does not cap speed;
- warm-up does not permanently poison steady-state capacity;
- engine, voice, backend, and visibility resets clear stale evidence; and
- minimum-rate failure enters `interrupted` with no false continuity claim.

### Audio player tests

Extend `src/core/tts/player.test.ts` to cover:

- contiguous buffered seconds include current remaining audio and queued audio;
- item-specific rates produce correct durations and scheduled start times;
- an absent next sentence after current audio ends records one underrun;
- startup waiting, pause, stop, seek, and chapter end do not record underruns;
- delivered WPM uses AudioContext time and source-word progress;
- paused and buffering time are excluded;
- WPM publication remains at or below 5 Hz; and
- scheduled sources are still started exactly once.

### Store tests

Extend `src/core/store/tts.test.ts` to prove:

- old `speed` settings hydrate unchanged;
- missing continuity data defaults to continuous playback;
- one preference change creates one settings write;
- runtime pacing snapshots create zero settings writes; and
- effective device limits are not persisted.

### Component tests

Extend `src/components/Reader/TTSPlayer.test.tsx` and
`src/components/Reader/Reader.test.tsx` to prove:

- opening Listen mode switches the dock to TTS semantics before playback;
- TTS minus and plus call `setSpeed`, not `setWpm`;
- closing Listen mode restores the unchanged RSVP WPM;
- delivered speech WPM appears during TTS and is retained on pause;
- pre-sample TTS renders the multiplier instead of `0 WPM` or RSVP `PAUSED`;
- the limited mark and exact concise disclosure appear only when limited;
- the plus tooltip includes the cap reason while limited;
- touch interaction exposes both continuity and possible-pause actions;
- the possible-pause action switches mode and applies preferred speed;
- the live region announces the state once rather than every telemetry tick;
- focus mode still hides and inerts the whole speed dock; and
- no state-dependent render changes hook order.

### Integration tests

Use fake timers and a deterministic slow generator to cover:

- startup identifies a generator slower than real time before burst-and-wait
  playback begins;
- effective speed converges within two stable aggregate samples;
- ten simulated minutes produce no underrun when the generator can sustain a
  rate at or above `0.5x`;
- prefer-speed mode can underrun and reports `pauses possible` honestly;
- speed changes preserve the current sentence and take effect within one
  following sentence;
- automatic chapter continuation retains the local pacing controller; and
- Reader cursor, audio clock, handoff, and chapter transitions stay aligned.

### Browser and device checks

Capture Reader screenshots and interaction traces for:

- current desktop WebGPU hardware;
- an older Intel Mac or constrained CPU/WASM profile;
- iPhone Safari with the Q8 Kokoro path;
- compact mobile portrait and landscape;
- `1.0x` healthy, limited, paused, interrupted, and prefer-speed states;
- keyboard-only and VoiceOver operation; and
- reduced-motion mode.

Run the existing Reader journey on desktop and mobile after the focused tests.
Use non-interactive commands:

```text
npx vitest run src/core/tts/player.test.ts src/core/store/tts.test.ts src/components/Reader/TTSPlayer.test.tsx src/components/Reader/Reader.test.tsx
npm run build
npx playwright test e2e/screenshots.spec.ts --project=mobile --grep "Reader Journey Key Flows"
npx playwright test e2e/screenshots.spec.ts --project=chromium --grep "Reader Journey Key Flows"
```

## Acceptance Criteria

### Playback

- Continuous mode is on by default and preferred speed remains `1.0x`.
- No burst-and-wait cycle occurs in a ten-minute run when the device can sustain
  some supported speed at or above `0.5x`.
- A newly constrained device lowers rate before the second true underrun.
- Recovery is gradual and does not produce audible sentence-to-sentence speed
  oscillation.
- Existing sentence boundaries, validation, silence trimming, gapless
  scheduling, handoff, and chapter continuation remain correct.

### WPM and controls

- During TTS, the dock never shows RSVP WPM or RSVP `PAUSED` state.
- TTS WPM is within 5% of a controlled source-word/audio-time fixture after
  the two-second warm-up window.
- TTS minus and plus adjust speech by exactly `0.1x` per press.
- RSVP controls retain their current behavior when Listen mode is closed.
- A limited plus interaction always explains why audible speed may not change
  and offers a path to accept pauses.

### UX

- Normal continuous playback adds no badge, toast, or explanatory paragraph.
- Limited state is visible through a mark and text, not color alone.
- The full reason is available on hover, focus, and touch.
- No automatic message blocks playback.
- The Reader uses the approved concise copy and does not expose internal
  performance terminology.
- Dock dimensions remain stable at supported mobile and desktop sizes.

### Performance and persistence

- Runtime pacing telemetry causes zero TTS settings writes.
- React-facing telemetry is published at no more than 5 Hz.
- The pacing controller retains a bounded sample window.
- No sentence text or generated audio is added to telemetry persistence.
- Serial generation and the existing queue memory bound are preserved.

## Risks And Required Evidence

### Slower Kokoro speech may also cost more to generate

The controller must use measured output duration and generation time after each
rate change. Do not assume that moving from `1.0x` to `0.8x` improves RTF by
exactly 20%. If Kokoro cannot achieve headroom at the floor on a device, enter
the interruption state instead of continuing to lower a fictional rate.

### Sentence-level changes can sound uneven

Hysteresis, small recovery steps, and boundary-only changes are required. Add a
listening quality pass with short, long, punctuated, and quoted sentences at
rate transitions. Reject tuning that produces obvious tempo pumping.

### Piper rate changes alter pitch

The existing Piper implementation uses Web Audio playback rate. Keep automatic
changes conservative and validate Slovenian speech separately. Pitch-preserving
time stretching is a later, separately evaluated feature, not a reason to hand
roll DSP in this change.

### More buffer cannot fix sustained underperformance

Buffer controls startup and short variation only. The acceptance metric is
generated audio seconds per wall second over a long run. Do not declare success
because a large initial buffer delays the first pause.

### Browser visibility and AudioContext suspension distort clocks

Generation timing and audible timing have different owners. Reset rolling WPM
and capacity continuity after a suspension or long hidden interval. Never use
React render time as the audible clock.

## Non-Goals

- changing desktop model precision or default backend;
- parallel sentence inference;
- replacing sentence boundaries with arbitrary word chunks;
- hiding all pauses behind a much larger startup buffer;
- converting TTS multiplier to a fixed target WPM;
- syncing a learned cap between devices;
- adding a modal or tutorial for normal limited playback;
- implementing custom pitch-preserving DSP in the first delivery; or
- redesigning unrelated Reader pacing and focus controls.

## Delivery Order

1. Telemetry and deterministic baseline tests.
2. Pure realtime pacing controller.
3. Per-sentence generation integration and audio-time buffer snapshots.
4. Accurate TTS WPM.
5. Transport-aware Reader speed dock.
6. Limited-state disclosure, touch choice, and continuity setting.
7. Persistence and handoff compatibility.
8. Desktop, constrained Mac, and iPhone validation.
9. Tune constants only from measured traces and listening results.

Keep these slices reviewable. In particular, do not combine backend changes,
precision changes, and pacing-controller tuning in one result; that would make
continuity and speech-quality regressions difficult to attribute.

## Definition Of Done

- [ ] Preferred speech still defaults to `1.0x`.
- [ ] Continuous playback defaults on and can be explicitly overridden.
- [ ] Generation throughput and audible buffer seconds are measured correctly.
- [ ] Effective speed adapts with headroom, hysteresis, and a `0.5x` floor.
- [ ] TTS WPM is measured from audible progress and excludes silence.
- [ ] Reader minus and plus control the active transport.
- [ ] Limited state uses the approved concise effect-reason-action copy.
- [ ] Hover, focus, and touch all expose the faster-versus-continuous choice.
- [ ] Runtime telemetry is bounded, transient, and does not trigger persistence.
- [ ] Focused unit, integration, build, and Reader journey checks pass.
- [ ] A ten-minute constrained-device run has no avoidable burst-and-wait cycle.
- [ ] Minimum-rate failure is communicated honestly when continuous generation
      is not possible.
