# Online-class realtime event protocol (v1)

Events travel over LiveKit data channels. This document is the contract; the
TypeScript types in `frontend/src/features/online-classes/events.ts` and the
backend DTOs must match it.

## Rules that apply to every event

1. **Topics are versioned.** A breaking payload change means a new topic
   (`…​.v2`), never a redefinition of `…​.v1`. Receivers ignore unknown topics.
2. **A role stated inside a packet is never trusted.** Authority comes from the
   server: the sender's application role is resolved from the participant
   identity against `online_class_participants`, and any privileged effect is
   applied through a REST call the backend authorizes. A packet claiming
   `"role":"HOST"` grants nothing.
3. **Identity is the provider participant identity** (`<userUuid>|<device>`), so
   the user id is recoverable without trusting the payload.
4. **Every event carries** `v`, `type`, `classId`, `id` (UUID), and `at`
   (epoch ms). `id` is what makes de-duplication possible.
5. **Oversized or malformed payloads are dropped**, not partially applied. The
   cap is 8 KB per packet; annotation batches are chunked below it.
6. **Durable state is never learned from the channel alone.** On join or
   reconnect the client fetches authoritative state over REST and merges
   realtime events by `id`, discarding duplicates.

## Delivery mode

| Topic | Mode | Why |
|---|---|---|
| `mc.class.chat.v1` | reliable | messages must not be lost; also persisted |
| `mc.class.hand.v1` | reliable | hand state is sticky until lowered |
| `mc.class.control.v1` | reliable | moderation notices must arrive |
| `mc.class.annotation.v1` | reliable | durable strokes; ordered by sequence |
| `mc.class.student-view.v1` | reliable, private | pupil viewport updates to the classroom host only |
| `mc.class.pages.v1` | reliable, private | refresh a private board's durable page list |
| `mc.class.reaction.v1` | lossy | transient, expires in ~4 s |
| `mc.class.pointer.v1` | lossy | superseded ~20×/s; a dropped frame is invisible |

Lossy topics are throttled at the sender: pointer ≤ 20 Hz, reactions ≤ 2 per
second per participant. The backend additionally rate-limits anything it
persists.

## Payloads

### `mc.class.hand.v1`

```jsonc
{ "v": 1, "type": "hand", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "raised": true }
```

Sticky: a late joiner reconstructs hand state from the REST participant list,
not from the channel. Lowering another participant's hand is a moderation
action and goes through REST, not this topic.

### `mc.class.reaction.v1`

```jsonc
{ "v": 1, "type": "reaction", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "emoji": "clap" }
```

`emoji` is a fixed enum (`clap`, `thumbsUp`, `smile`, `confused`, `party`), not
free text — that keeps arbitrary strings out of the render path. Never
persisted.

### `mc.class.control.v1`

Server-authored only. Clients render these but never send them.

```jsonc
{ "v": 1, "type": "unmute-request", "classId": "<uuid>", "userId": "<uuid>",
  "version": 1 }
```

An unmute request is a **request**: browsers require local consent to publish
audio, so the recipient sees a prompt. Nothing force-unmutes a microphone.

### `mc.class.chat.v1` (P4)

```jsonc
{ "v": 1, "type": "chat", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "clientMessageId": "<uuid>", "body": "text" }
```

The backend is the source of truth. `clientMessageId` is the idempotency key:
the realtime copy and the persisted row collapse onto one message in the UI.
Bodies are plain text and are never rendered as HTML.

### `mc.class.annotation.v1` (P7)

```jsonc
{ "v": 1, "type": "annotation", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "documentId": "<uuid>", "operationId": "<uuid>",
  "sequence": 42, "op": "ADD", "payload": { /* normalized shape */ } }
```

Coordinates are normalized to the target surface (0..1), never CSS pixels.
`operationId` de-duplicates the realtime copy against the persisted row;
`sequence` gives late joiners a deterministic replay order.

### `mc.class.pages.v1`

```jsonc
{ "v": 1, "type": "pages", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "targetType": "WHITEBOARD",
  "targetId": "personal-workbook-<pupil-uuid>" }
```

Send after the annotation document has been opened successfully, including a
blank page with no strokes. Resolve explicit recipient devices for the owning
pupil and classroom host; an empty recipient list never becomes a broadcast.
The receiver accepts hints only from that owner or the roster's host for the
exact class, target type and target id. It rereads the authorized REST document
list; the packet contains no page count, page selection, zoom or ink. Discovery
increases the known page count without changing the viewer's navigation.
Private boards also refresh while visible every two seconds and on returning
to the tab, so dropped hints and late entry recover from persisted empty pages.

### `mc.class.pointer.v1` (P7)

```jsonc
{ "v": 1, "type": "pointer", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "targetId": "<track-or-board>", "x": 0.42, "y": 0.77 }
```

Ephemeral laser pointer. Never persisted; fades client-side.

### `mc.class.view.v1` (stage 4)

```jsonc
{ "v": 1, "type": "view", "classId": "<uuid>", "id": "<uuid>", "at": 1789744374000,
  "boardId": "board-1", "page": 2, "pageCount": 5,
  "zoom": 2, "panX": -0.5, "panY": -0.25, "follow": true }
```

Teacher's view of the **shared** board only; personal boards never emit it.
`page` is zero-based. Pan is a fraction of the board size (0 = no offset,
negative = scrolled), so different screen sizes land on the same region.
Students accept it only from the participant whose identity carries the HOST
user id, and while `follow` is true their own navigation is locked. The packet
is client-published and therefore advisory: it can only move a view, it never
carries content.

**Stage 4 treats the `annotation` packet as a hint only.** Any participant can
publish on the data channel, so its contents are never applied: a receiver
replays from its last known sequence over REST and shows what the server
returns. The sender no longer includes `payload` (the field is not parsed), and a forged packet (e.g. a fake
`CLEAR_ALL`) can at most trigger a harmless re-fetch. Bursts collapse into one
replay per 150 ms.

### `mc.class.student-view.v1`

```jsonc
{ "v": 1, "type": "student-view", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "boardId": "personal-<pupil-uuid>",
  "targetType": "WHITEBOARD", "sessionId": "source-session-1", "revision": 12,
  "page": 2, "pageCount": 5, "layout": "continuous",
  "viewport": { "width": 1200, "height": 800 },
  "region": { "x": 0.15, "y": 0.3, "width": 0.75, "height": 0.5 },
  "pageGap": 0.03 }
```

The visible pupil board publishes its clear viewport in CSS pixels and the
visible rectangle relative to the selected page. `page` is zero-based; `region`
may extend outside 0..1 to preserve margins and neighbouring pages. Optional
`pageGap` is the continuous inter-page gap divided by that page's rendered
width. `layout` is `paged` or `continuous`; `targetType` is `WHITEBOARD` or
`NOTEBOOK_CAMERA`, so paper and camera views cannot mix. The teacher fits a
frame with the source viewport's aspect ratio and reproduces the same crop.

Only the personal board owner sends these packets, targeted to the roster's
host user devices. An absent recipient never falls back to broadcast. The
host checks the actual LiveKit sender identity against the board owner, plus
class, board and target type. Other pupils do not receive or apply this data.
**Following is an optional local teacher setting:** cached packets do not move
the teacher's view until enabled, and the switch never controls the pupil or
changes stored annotations. This is separate from shared-board
`mc.class.view.v1` follow-the-teacher.

Changes use an 80 ms trailing throttle, with a 2 s heartbeat for late joiners
and reconnects. Identical heartbeats refresh liveness without rebuilding the
view. After 6 s without a fresh accepted packet, the last view remains visible
and is marked stale; a new packet resumes following. A source remount gets a
new `sessionId`; increasing `revision` values reject duplicates and old updates.
Retired sessions and earlier source timestamps prevent delayed packets from
returning to a previous view. Timestamps are compared only within one sender
device, not against the teacher's clock. View telemetry is never persisted.

Validation requires finite values: viewport dimensions 1..32768, region
coordinates -100..100, region dimensions 0.05..100, and optional `pageGap`
0..10. `pageCount` is an integer 1..10000 and `page` is an integer smaller than
it. Session IDs contain 1..128 letters, digits, `_` or `-`; revisions are
nonnegative safe integers. Invalid packets are dropped under the common 8 KB
limit. The region size floor prevents pathological magnification while leaving
margin beyond the local board's 5× zoom limit.

### `mc.class.notebook-stroke.v1`

Notebook-camera ink uses the same validated `stroke` packets as the ordinary
board's `mc.class.stroke.v1`, on a separate topic. A camera and a white paper
board may have the same `personal-<owner>` target ID; their previews must never
mix, including when a peer still runs an older client.

Packets carry raw, normalized camera coordinates. The receiver projects the
preview together with the video and durable ink using the committed notebook
geometry. The first point is sent immediately, interim points are throttled,
and pen-up sends the complete final preview reliably. Its stroke ID is also
the durable annotation operation ID, so the preview remains until the matching
saved shape is rendered.

Only the personal owner and the roster's host send and receive these previews.
Sends resolve those users' connected classroom device identities; missing
recipients never fall back to broadcast. Camera targets without a valid owner
are disabled. Receivers check the LiveKit sender identity, not a payload actor.

Camera save notifications use targeted `mc.class.annotation.v1` hints to the
same owner/host devices. An authorized, matching document hint immediately
triggers REST replay, including undo and erasing; its operation is never applied
directly. The private-document poll remains a fallback when realtime delivery
is unavailable. Notebook phone media/signalling is a separate connection and
does not carry classroom ink previews.

## Reconnect and late join

1. Fetch durable state over REST (participants, chat page, annotation replay
   from a known revision).
2. Apply buffered realtime events, discarding any whose `id` — or
   `clientMessageId` / `operationId` — is already present.
3. Resume live handling.

This ordering is what makes a reconnect idempotent: the channel may redeliver,
and the merge step absorbs it.
