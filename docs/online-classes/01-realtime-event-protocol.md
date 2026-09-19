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

### `mc.class.pointer.v1` (P7)

```jsonc
{ "v": 1, "type": "pointer", "classId": "<uuid>", "id": "<uuid>",
  "at": 1789744374000, "targetId": "<track-or-board>", "x": 0.42, "y": 0.77 }
```

Ephemeral laser pointer. Never persisted; fades client-side.

## Reconnect and late join

1. Fetch durable state over REST (participants, chat page, annotation replay
   from a known revision).
2. Apply buffered realtime events, discarding any whose `id` — or
   `clientMessageId` / `operationId` — is already present.
3. Resume live handling.

This ordering is what makes a reconnect idempotent: the channel may redeliver,
and the merge step absorbs it.
