# Online classes — architecture and runbook

## What it is

A **durable execution of an existing Google Calendar lesson**, not a second
scheduling system. When a teacher first starts a lesson online, an
`online_classes` row snapshots the occurrence (teacher, event id, binding key,
title, times, bound student or group) and owns the realtime room and every
artifact produced.

## Shape

```
Browser ──HTTPS──> Spring backend ──server credentials──> LiveKit (rooms, Egress, agents)
   │                     │                                        │
   │                     ├──> PostgreSQL (state, chat, attendance, transcript)
   │                     └──> S3-compatible storage (recordings, snapshots)
   │
   └──wss──> LiveKit media  ◄── transcription agent (separate service, own STT key)
```

The browser receives only the public `wss://` URL, a short-lived token scoped to
one room and one identity, and non-secret room configuration. **No provider
secret ever reaches a browser, a response body, or a log line.**

## Key decisions

| Decision | Why |
|---|---|
| Ports (`LiveClassMediaProvider`, `ClassRecordingProvider`, `ClassArtifactStorage`, `ClassTranscriptionProvider`) | LiveKit types never reach controllers or services; CI runs with deterministic fakes and no accounts |
| Recording split from the media port | independently configured and independently failing; avoids shipping unimplemented methods as placeholders |
| Opaque room name from the class UUID | no name, e-mail or calendar id in a provider-visible identifier |
| Identity `<userUuid>\|<device>` | webhooks attribute to a user; two tabs stay distinct instead of evicting each other |
| Token grants carry **no** `roomAdmin`/`roomRecord` | moderation and recording run server-side; a stolen browser token cannot do either |
| `CanPublishSources` per source | a student denied screen share is denied at the **token** level, not just in the UI |
| Webhook verified against the **raw body** | `WebhookReceiver` compares a SHA-256 of the exact bytes; the controller verifies before parsing |
| Undo as an append-only operation (V48) | a late joiner replaying from revision 0 sees the same history as everyone else |
| Normalized 0..1 coordinates + letterboxing | two viewers on different screens see strokes in the same place on the content |
| Health never reports DOWN | an optional-integration outage must not let an orchestrator kill the flashcard app |

## Database

Migrations **V44–V48**. `V43` was the previous highest.

| Table | Holds |
|---|---|
| `online_classes` | the durable class; unique occurrence index prevents duplicate materialization |
| `online_class_participants` | one row per (class, user); attendance accumulates across reconnects |
| `online_class_join_requests` | waiting room; partial unique index gives one active request |
| `online_class_messages` | chat; `client_message_id` is the idempotency key |
| `online_class_recordings` | metadata only — bytes live in object storage |
| `online_class_transcript_segments` | final segments; `provider_segment_id` is the idempotency key |
| `online_class_annotation_documents` / `_events` | surfaces and their ordered operation stream |

`NOTEBOOK_CAMERA` is already in the annotation target enum (unused).

## Configuration

See `.env.prod.example`. Failure modes are deliberate:

| State | Behaviour |
|---|---|
| `ONLINE_CLASSES_ENABLED=false` | endpoints return 404; Meet/Soniox flow untouched |
| Enabled, LiveKit missing | app starts; teacher sees a precise "not configured" state; logs never say *which* value is missing |
| Recording/transcription unconfigured | those buttons report unavailable; class unaffected |

## Operations

### Health

`/actuator/health` is **always UP** while the core app is healthy. Integration
state is in the details (booleans only — the endpoint is unauthenticated, so it
must not become a configuration oracle). Enable `show-details` deliberately.

### Metrics

`mcschool.onlineclass.*` — lifecycle, participants, provider failures,
recording/transcription state, webhook outcomes, rate limits, storage failures.
Tags are structural only; no ids, tokens or message bodies.

**Worth alerting on:** a rising `webhook{outcome=rejected}` rate (misconfigured
secret or a forgery attempt) and any sustained `storage.failure`.

### Retention

Nightly at `app.online-classes.retention.cron` (03:30 Europe/Berlin).
Recordings are deleted after `CLASS_RECORDING_RETENTION_DAYS` (90), transcripts
after `CLASS_TRANSCRIPT_RETENTION_DAYS` (365).

**A row is marked deleted only after object storage confirms.** A failed delete
leaves it eligible for the next sweep rather than orphaning a file — check
`storage.failure` if rows linger.

### Runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Teacher sees "not configured" | missing `LIVEKIT_*` | check startup log line `Online classes: media provider unconfigured` |
| Nobody can join, app otherwise fine | provider outage | health stays UP by design; check LiveKit status and `provider.failure` |
| Recording stuck `PROCESSING` | webhook not reaching us | verify `LIVEKIT_WEBHOOK_PUBLIC_URL` is publicly reachable; only a verified webhook can complete it |
| `webhook{outcome=rejected}` rising | secret mismatch after rotation | rotate both sides; the receiver is constructed per call, so no restart is needed |
| Captions stop, class continues | agent or Soniox down | expected isolation; restart `services/transcription-agent` |
| Camera never prompts | insecure context | HTTPS is mandatory outside `localhost` |

## Security and privacy

- Recording and transcription require explicit teacher action; every participant
  sees the notice and a late joiner acknowledges it.
- Recordings and transcripts default to **teacher-only**. Students do not
  receive them in this release.
- Parents do not join classes in this release.
- Signed URLs are short-lived (10 min) and are treated as credentials: never
  logged, never persisted.
- Chat, transcript and annotation text are stored as plain text and escaped at
  render time; whiteboard text is drawn as canvas glyphs, never DOM.
- Two JWT-exempt endpoints exist, each with stronger verification: the LiveKit
  webhook (HMAC over the raw body) and transcript ingestion (internal token,
  constant-time compared). `LiveClassAuthorizationArchitectureTest` fails the
  build if a new endpoint omits its gates.

**This is not end-to-end encrypted.** Server-side recording and transcription
require the media to be decryptable by the infrastructure. Do not describe it
as E2EE.

## Rollout and rollback

**Rollout**

1. Deploy with `ONLINE_CLASSES_ENABLED=false` — no behaviour change.
2. Set `LIVEKIT_*` and `LIVEKIT_CSP_ORIGINS`, redeploy the frontend so nginx
   renders the CSP with the signalling origin.
3. Enable for a pilot teacher; Google Meet remains as the secondary action.
4. Enable recording, then transcription, separately — each is its own toggle.

**Rollback**

Set `ONLINE_CLASSES_ENABLED=false` and redeploy. Endpoints return 404, the Meet
flow resumes, and existing data is retained. No migration is reversed; V44–V48
are additive and inert while the feature is off.

## Extension point: notebook camera

A later phone-published notebook track needs **no model change**:

1. Publish the track with source metadata marking it `notebook_camera`.
2. Open an annotation document with `targetType = NOTEBOOK_CAMERA` — already in
   the enum, the DB CHECK, and the TypeScript union, and covered by a test that
   round-trips it.
3. Render it with the existing `WhiteboardPanel`, passing that `targetType` and
   the track's aspect ratio. Normalized coordinates and letterboxing already
   handle an arbitrary source shape.

Perspective correction would be a new client-side transform on the same
normalized geometry; nothing in the persistence or authorization model changes.
