# Device Exchange

Device Exchange is the local-first framework for moving books and state between
nearby browsers. It supports personal device handoff, giving books to another
person, and reconciling independently changed libraries without a signaling or
data service.

## Product Modes

### Give

One-way content transfer. The default from a book card.

- Includes the selected book, chapters, cover, images, and original EPUB.
- Excludes reading position, listening position, notes, and preferences by
  default.
- Supports one or many selected books.
- Never modifies the sender after the transfer is acknowledged.

### Handoff

One-way continuity transfer. The default from the reader.

- Includes the current book if the receiving device does not already have it.
- Includes current chapter, live word position, listening position, voice, and
  speed.
- Can include highlights and notes.
- Marks whether the user intends to continue reading or listening.
- The receiving browser still requires a user gesture before audible playback.

### Reconcile

Bidirectional exchange between devices. The default for Sync Back and whole
library exchange.

- Both devices exchange manifests before sending required content.
- Missing books can flow in either direction.
- Divergent state is reviewed before either local database changes.
- Deletions are not propagated in protocol version 1.

## Physical Connection

The connection uses an ephemeral WebRTC data channel. It gathers local host
candidates and, through the default Cloudflare STUN server, public
server-reflexive candidates. There is no signaling server; the offer and answer
still move directly between devices through the QR or copy/paste flow.

1. The initiator creates an offer and displays an invitation QR.
2. The receiving browser scans the QR and opens the static `/exchange` route.
3. The receiver creates an answer and displays an answer QR.
4. The initiator scans the answer QR.
5. Both devices show the same short pairing code and open a direct data channel.
6. The transfer is staged, reviewed, applied, and acknowledged.

This allows a direct connection across many home and mobile networks. Symmetric
NATs, carrier-grade NATs, and restrictive firewalls may require a TURN relay.
Deployments can append one or more TURN servers through the
`VITE_WEBRTC_ICE_SERVERS` build variable. TURN relays encrypted WebRTC packets;
it cannot read book or state contents. The static application host is never
used as a signaling or content service.

```bash
VITE_WEBRTC_ICE_SERVERS='[{"urls":"turns:relay.example.com:5349","username":"app-user","credential":"app-password"}]' npm run build
```

`VITE_` values are included in the public JavaScript bundle. Use credentials
that are restricted and quota-limited for this application, never TURN service
administration credentials.

## Exchange Manifest

Every session has a versioned manifest:

- protocol version and exchange ID
- intent: `give`, `handoff`, or `reconcile`
- source device ID and user-editable device name
- creation and expiry timestamps
- selected book IDs and visible title/author summaries
- requested data classes
- per-entity fingerprints and byte estimates
- handoff continuation intent when present

Payload classes are independently selectable:

- `content`: book metadata, chapters, images, and original EPUB
- `analysis`: densities, token analysis, subchapters, and generated summaries
- `progress`: chapter, word, reading timestamp, and listening position
- `highlights`: highlights and notes
- `listening`: voice and speed

Global application preferences are deliberately outside version 1. They are not
book-scoped and require their own review model.

## Identity And History

Each browser installation gets a random device ID and a user-editable name. The
ID identifies an actor, not a person or account.

An exchange ledger stores the fingerprints observed during successful exchanges.
On a later reconciliation, that shared ancestor distinguishes one-sided changes
from concurrent changes:

- local equals base, remote changed: incoming update
- remote equals base, local changed: keep local update
- both changed from base: conflict
- no shared base and values differ: conflict

The ledger contains fingerprints and timestamps, not book contents.

## Conflict Rules

### Book Content

Book content is treated as immutable for a given fingerprint.

- Same fingerprint: deduplicate.
- Missing locally: import.
- Same ID with different fingerprint: choose **Keep mine**, **Take theirs**, or
  **Keep both**. Keep both remaps the incoming book and all child IDs.
- Different IDs with the same original EPUB fingerprint: offer deduplication.

### Reading And Listening Position

Position is not merged by taking the greatest word index. Rereading, changing
chapters, and two active devices make "furthest" unsafe.

When positions differ, show each device's:

- chapter and nearby text
- book percentage
- last active time
- reading or listening mode
- source device name

Choices are **Continue here**, **Continue there**, or **Keep both as bookmarks**.
Handoff defaults to the incoming live position; reconciliation requires review
for concurrent changes.

### Highlights And Notes

- Different highlight IDs are unioned.
- Identical IDs and content are deduplicated.
- Identical IDs with changed ranges, text, or notes are shown as a conflict.
- Resolution can keep either version or duplicate both with a new ID.

### Settings

Book-scoped listening settings can take the local or incoming value. Device
performance settings such as model quantization and backend stay local.

## Interface Placement

### Reader

A Share icon sits in the primary reader toolbar beside Audio. It opens with:

- **Continue on another device** selected
- current book selected and locked
- live position and listening state enabled
- optional highlights
- a single `Show transfer code` command

### Archive

The archive action rail gains **Exchange**. It enters a selection mode where
cards act as stable checkboxes and a bottom command bar offers:

- Give selected books
- Sync selected books
- Sync entire archive

The Share icon on an individual card opens Give with that book preselected and
progress disabled.

### Global Access

The existing Phone QR utility becomes Exchange. It always opens the same sheet,
but context chooses the default mode and selection. Route-only LAN access remains
available under a development utility, not as the primary sharing concept.

### Incoming And First Use

The `/exchange` route bypasses onboarding and model setup. A first-time visitor
can receive a book before configuring the rest of the application.

The flow is:

1. identify the sending device and proposed contents
2. show the answer QR
3. receive into temporary staging
4. show size, books, included state, and conflicts
5. accept or selectively apply
6. open the imported book, continue at the handoff position, or go to Archive

No received data is committed before review.

## Delivery Plan

### Phase 1: State Foundation

- versioned bundle types and deterministic fingerprints
- snapshot builder and staged importer
- device identity and exchange ledger
- explicit conflict planner and resolutions
- live TTS position persistence

### Phase 2: Physical Transport

- compressed offer and answer QR codec
- camera scanner and copy/paste fallback
- direct WebRTC data channel with STUN discovery and optional TURN relay
- chunking, backpressure, checksums, cancellation, and acknowledgements

### Phase 3: Product Surfaces

- shared Exchange sheet
- reader handoff launcher
- archive selection and book gifting
- standalone incoming review and first-use flow

### Phase 4: Reconciliation

- bidirectional manifests and delta requests
- shared-ancestor conflict detection
- conflict review UI and exchange receipts
- sync-back shortcuts for recently paired devices

### Phase 5: Hardening

- interruption and retry testing
- large illustrated EPUB transfer testing
- iOS Safari and Android browser testing
- hostile/corrupt payload limits
- encrypted package fallback for networks that block peer connections
