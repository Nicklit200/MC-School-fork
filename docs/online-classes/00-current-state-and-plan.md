# Online Classes — Current-State Report & Implementation Plan

Status: **Build repaired; backend verification still blocked.** Written
2026-09-18.

## 0. Resolution log (2026-09-18)

| Blocker | Status |
|---|---|
| 156 duplicate " 2" source files | **FIXED** — all 156 verified byte-identical to their originals (`cmp -s`, 0 differing, 0 orphans), then **moved** (not deleted) to `../quarantined-duplicates-2026-09-18/` preserving relative paths, with `MANIFEST.txt`. Fully reversible. |
| 12 empty `* 2` directories | **FIXED** — removed (contained zero files; verified before removal). |
| `node_modules/@types/* 2` breaking `tsc` | **FIXED** — `rm -rf node_modules && npm ci` from the existing lockfile. 0 residual. |
| `TS6310` typecheck failure | **FIXED** — `--noEmit` is invalid with composite project references; `typecheck` script changed to `tsc -b`. |
| Maven/backend verification | **FIXED** — plugin disabled by owner. Maven 3.9.16 / JDK 21. `./mvnw -o clean compile` → **exit 0**, confirming the quarantine resolved the duplicate-class errors. |

## 0a. Backend test baseline — `main` is RED before this feature

`./mvnw -o clean test` on a pristine backend tree (only `frontend/package.json`
modified) gives **103 run, 31 failures, 1 error**. These are **pre-existing on
`main`** and are not caused by this feature or by the quarantine.

| Test class | Result | Root cause |
|---|---|---|
| `CardAndStudyFlowIntegrationTest` | 23/23 fail | cascade from one `setUp` → `createActivatedTeacher` returns 400 |
| `AccountAndAuthFlowIntegrationTest` | 5 fail | activation flow |
| `StudentServiceTest` | 2 fail | Mockito drift — `StudentService.createStudent` now resolves the teacher first, throwing `ResourceNotFoundException` before the duplicate-email `ConflictException` the test expects |
| `AuthServiceTest` | 1 error | `AuthService:82` guard — students may not activate without a provisioned username |
| `CardImportParserTest` | 1 fail | import validation drift |

`AuthService:82` is deliberate product behaviour added by the merged work; the
tests predate it. There is **no CI workflow running these tests**
(`.github/workflows/` contains no test job), which is how `main` went red
unnoticed.

### RESOLVED — suite is now green (103 run, 0 failures, 0 errors)

Owner approved repairing them. Every one was triaged as *test drift vs. genuine
regression* before being touched. **All five were drift: no product code was
modified.**

| Failure | Finding | Fix |
|---|---|---|
| `CardImportParserTest` (1) | Parser still rejects correctly; only the warning wording changed when the card time-limit feature (V41) landed | Assert on the stable substring `expected 4 answers` |
| `StudentServiceTest.createStudentRejectsDuplicateEmail` | `createStudent` moved from `existsByEmail` to `findByEmail` + `restoreDeletedStudent`. **Audited for hijack risk:** `restoreDeletedStudent` throws `ConflictException` unless the account is archived *and* owned by the same teacher — cross-teacher takeover is not possible | Stub `findByEmail` with a live account; still expects `ConflictException` |
| `StudentServiceTest.listStudents…` | `listStudents` now calls `findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(id, STUDENT)` — a real improvement that excludes parents | Stub the role-filtered method |
| `AuthServiceTest` (1) | `AuthService:82` requires a username. `assignUsername` is called **only** from `StudentService.ensureUsername`, which runs at the end of `createStudent`, so real students always have one; the guard is a handled migration path for legacy rows. The test built a fixture production never produces | Fixture calls `assignUsername` |
| `AccountAndAuthFlowIntegrationTest` (5) + `CardAndStudyFlowIntegrationTest` (23) | `AuthService` now rejects activation without an e-mail for non-student roles. Test helpers posted none, so every teacher activation 400'd and cascaded | Added an `activate(token, password, email)` overload; student path untouched |
| `CardAndStudy…oneHomeworkWithSixCardsAppearsAsSingleFolder` | The only non-cascade case. Asserted one-homework-per-date. **`git log -S` proved this deliberate:** `ec47e03 "Fix homework folder grouping"` added the test, then `30a4cef "Create separate homework entries for the same day"` reversed the rule, touching `HomeworkService.java` alone and leaving the test stale | Dropped the dead dedup assertion; the folder-rendering intent is preserved |

Root cause of the whole class of breakage: **`.github/workflows/` has no test
job**, so `main` went red unnoticed. Recommend adding one — tracked for P9.

## 0p. P9 — accessibility and responsive (frontend 122)

### A real bug the pass caught

`className="visually-hidden"` was used in `ChatPanel` and `CaptionsPanel`, but
**the class was never defined anywhere**. The chat input's label and the
captions heading were rendering as visible text in the middle of the UI. Both
components looked correct in review and their tests passed, because the tests
asserted the accessible name — which was present either way.

`src/online-classes.css` now defines it with the clip technique, deliberately
**not** `display:none`/`visibility:hidden`, which would remove the element from
the accessibility tree and defeat the label entirely. A test asserts that.

### Also added

- `:focus-visible` rings across the class UI — it is dense and icon-driven, so a
  lost focus ring makes it unusable by keyboard.
- `prefers-reduced-motion` handling.
- Responsive layout with a **landscape-tablet** breakpoint (`max-height` +
  `orientation: landscape`), not only portrait widths — the case a width-only
  breakpoint set silently misses.
- 44px minimum touch targets on small screens; sticky controls on phones.
- Recording signalled by dot **plus text**, never colour alone: it is a consent
  signal, so a colour-blind participant must still perceive it.
- `overflow-wrap: anywhere` on chat bodies so an unbroken string cannot force
  sideways scrolling.

12 accessibility tests, including six that assert the stylesheet properties
directly so a future edit cannot quietly remove them.

`@types/node` was added as a dev dependency: the production `tsc -b` also
type-checks test files, and the stylesheet assertions read from disk. Keeping
tests inside the type-check was preferred over excluding them.
Production audit unchanged at the pre-existing 2 moderate.

## 0o. P9 — observability (backend 302, frontend 110, agent 27)

`OnlineClassMetrics` — Micrometer counters for lifecycle transitions,
participant join/leave, provider failures, recording/transcription state,
webhook outcomes (accepted / rejected / duplicate), rate-limit rejections and
storage failures.

**Tags are low-cardinality and structural only.** No class id, user id, token,
media URL, chat body or transcript text reaches a metric — a metrics backend is
the wrong place for any of them, and per-user series would explode the series
count. A test asserts tags are role-shaped rather than identifier-shaped.

### Health that cannot take down the flashcard app

`OnlineClassIntegrationsHealth` reports integration state but **never returns
DOWN**. That is deliberate and is the single most load-bearing decision here: if
LiveKit, S3 or the STT provider could fail the health check, an outage in an
*optional* feature would let an orchestrator kill or drain the **entire**
application — flashcards, homework, parent access included, none of which depend
on it.

Status therefore lives in the details, not the verdict. A test asserts health
stays `UP` with every integration down.

`/actuator/health` is `permitAll` in this application, so the details are
booleans only — no URL, key fragment or bucket name — and a test asserts that,
because an unauthenticated endpoint must not become a configuration oracle.

## 0n. P9 in progress — retention and the access-control audit (backend 295)

### Retention and deletion

`ClassRetentionService` + a nightly `ClassRetentionScheduler`. The property that
matters: **a row is marked deleted only after the object store confirms
removal.** A storage outage therefore leaves the recording eligible for the next
sweep rather than orphaning a file the database believes is gone — tested by
failing the delete, asserting the row is untouched, then recovering storage and
asserting the retry succeeds.

Explicit deletion returns `false` when storage failed, so a caller is never told
deletion succeeded while an external object may still exist. Clearing a
transcript keeps the class row: attendance is an educational record with a
longer life. 11 tests.

### Access-control audit (OWASP A01)

Ran the repo's `testing-for-broken-access-control` skill. It assumes a live
Burp target, so its *matrix method* was applied statically to all **44** new
endpoints, checking two independent gates each.

**Result: no broken access control found.** Every endpoint has a role gate, and
every caller-facing service method performs an object-level check — 10 do it
indirectly (via `requireHostForMutation`, `decide`, or by delegating to
`segments`), each verified by reading the delegate rather than assuming.

*Two of my own enumeration passes were wrong before they were right:* the first
regex broke on the nested `)` in `@PreAuthorize("hasRole('TEACHER')")` and
silently listed only 17 of 44 endpoints. An incomplete audit reported as
complete would have been worse than none, so it was redone.

**`LiveClassAuthorizationArchitectureTest`** now enforces the invariant
permanently: endpoint #45 cannot ship without both gates. The two JWT-exempt
controllers are explicitly listed with the stronger verification each uses, and
a third test asserts those verifications are still present.

## 0m. P8 complete — lesson integration (backend 281, frontend 110, agent 27)

`GET /online-classes/by-event/{eventId}` — a **read-only, non-creating** lookup.
`materializeFromCalendar` creates; merely opening a lesson page must never bring
a class into existence as a side effect, so the artifacts panel uses this
instead. One test asserts the component cannot even reach materialize.

`LessonClassArtifacts` on `LessonDetailPage` shows attendance (in minutes),
recordings with short-lived signed links, and TXT/VTT transcript exports.

Three behaviours the tests pin down:

- **Renders nothing when no class was ever held** — a teacher who has not used
  online classes sees no change to the page at all.
- **Renders nothing when the feature is disabled**, rather than an error.
- Artifacts are fetched with `Promise.allSettled`, so an unconfigured
  integration degrades alone: attendance still shows when object storage is
  missing and recordings fail.

The Google Meet action remains as a clearly secondary fallback alongside
**Start online class**, so rollout can proceed with both available.

## 0l. P7 complete — whiteboard UI (backend 281, frontend 103, agent 27)

`konva@10.5.0` + `react-konva@18.2.16` installed on the pin verified in P0.
**No new production vulnerabilities** (still the pre-existing 2 moderate).

### Undo modelled properly rather than contorted

The operation enum had no way to express undo, and bending `ERASE` or `UPDATE`
to mean it would have been wrong. Added migration **V48** extending the CHECK
constraint with `UNDO`/`REDO`, which carry `{"targetOperationId": …}` and no
geometry.

Undo as a *new operation* rather than a row deletion keeps the stream
append-only: a late joiner replaying from revision 0 sees the undo in the same
order everyone else did, and nothing rewrites history.

### Logic separated from canvas

`annotations.ts` and `useAnnotationBoard.ts` contain the geometry, folding and
permission rules and import neither React-Konva nor a canvas — so 28 of the new
tests run headless. `WhiteboardCanvas.tsx` is deliberately thin.

Behaviours the tests pin down:

- **Letterboxing.** A 16:9 share inside a 4:3 panel must not put strokes in the
  bars — otherwise the drawer and everyone else see them in different places.
  Round-trip pixel → normalized → pixel is asserted through a letterboxed
  surface.
- **Folding is order-independent**, which is what makes a replay agree with the
  live view.
- **An undo may only hide the actor's own work**, even when the payload names
  someone else's operation — enforced in the fold, not only server-side.
- `CLEAR_LAYER` touches only the actor's layer; `CLEAR_ALL` is host-only and a
  student calling it is a no-op client-side *and* a 404 server-side.
- A rejected optimistic stroke is **removed**, so a client never shows something
  nobody else has.
- Malformed payloads are skipped rather than breaking the board.

Freehand input is thinned before submission (endpoints preserved), keeping
strokes under the server's point cap without visibly changing the line.

### Bundle discipline held

Konva is ~300 kB, and most classes never open the board, so `WhiteboardPanel`
got its **own lazy boundary inside the already-lazy class route**:

| Chunk | Size |
|---|---|
| main | 471 kB (unchanged) |
| class route | 701 kB (unchanged) |
| whiteboard | **302 kB, loaded only when opened** |

The same component serves the screen-share overlay — only `targetType` differs,
which is also what keeps a later notebook-camera surface a parameter rather
than a rewrite.

## 0k. P7 backend complete — annotations (backend 281, frontend 75, agent 27)

**`AnnotationPayloadValidator`** — operations arrive from other participants'
browsers, so everything is checked before persistence: shape kind, coordinate
range, point count, text length, stroke width, colour and total size.
17 tests, mostly adversarial:

- coordinates outside the normalized 0..1 surface are **malformed**, not merely
  off-screen;
- `"NaN"` / `"1e999"` sent as *strings* must not be coerced into numbers;
- colour accepts only a plain hex triple — `url(javascript:…)` and bare CSS
  keywords are rejected, since arbitrary CSS can carry a payload;
- stroke width is bounded so one stroke cannot cover the whole surface;
- point count and text length are capped so one operation cannot become an
  unbounded row.

Whiteboard *text* containing markup is deliberately **accepted** and stored
verbatim — a teacher writing HTML in a lesson is legitimate content — and
escaped at render time, the same rule as chat.

**`OnlineClassAnnotationService`** — documents per (surface, page), monotonic
sequence allocation, replay-from-revision for late join and reconnect,
idempotency on client `operationId`, and teacher-only snapshot save to object
storage.

Two authorization properties worth naming:

- **`AnnotationOperationRequest` has no layer-owner field at all.** The layer is
  always the actor's own, so a client cannot draw into — or clear — someone
  else's layer by naming them.
- A document id is scoped to its class: presenting a valid id against a
  *different* class resolves to not-found (tested).

`CLEAR_ALL` is host-only; a student may clear only their own layer.

`OnlineClassAnnotationIntegrationTest` — 19 tests.

Still open in P7: the Konva canvas UI, tool palette, undo/redo, laser pointer
and the screen-share overlay.

## 0j. P6 complete — transcription (backend 245, frontend 69, agent 27)

**Backend.** `LiveKitAgentTranscriptionProvider` uses the SDK's
`AgentDispatchServiceClient`: the agent registers under a name and **idles**
until explicitly dispatched, which is what makes "the worker joins only when
transcription is started" actually true rather than aspirational.
`OnlineClassTranscriptService` handles teacher start/stop, idempotent worker
ingestion, and TXT/JSON/VTT export. The speaker is resolved from the
participant identity, **not** from worker-supplied input.

`InternalWorkerAuth` compares the shared secret with
`MessageDigest.isEqual` — constant-time, so a timing side channel cannot
recover it byte by byte. `SecurityConfig` gained one narrow rule for
`POST …/transcript-segments`, and a test asserts the internal token does **not**
unlock user endpoints.

**The isolated service** (`services/transcription-agent`): own pinned
requirements, Dockerfile (unprivileged user), health check, README, 27 tests.
`SONIOX_API_KEY` exists only here. Testable logic lives in `ingestion.py`,
`config.py` and `health.py`, which import neither LiveKit nor Soniox — so the
suite runs with no network and no provider account.

Health is split deliberately: `/healthz` is liveness only, so a Soniox outage
never looks like a dead container and triggers a restart loop; `/readyz`
reports registration.

### Two bugs found by testing state rather than exceptions

1. **Rollback erased the failure state.** `start()` marked transcription
   `FAILED` and then threw `ConflictException` — which rolled the transaction
   back, discarding the very state the UI needed. Fixed with
   `noRollbackFor = ConflictException.class`.
2. **The same latent bug was in `OnlineClassRecordingService.start()`**, where my
   earlier test only asserted that an exception was thrown. It would have
   shipped. Fixed identically, and that test now asserts the persisted
   `FAILED` row and class state.

### Version verification, again

Every Python version I first pinned was wrong — `livekit-agents` 1.2.19 vs. the
actual **1.8.2**. Checked against PyPI before pinning; all Apache-2.0/MIT and
recorded in `THIRD_PARTY_NOTICES.md`.

## 0i. P5 UI + nginx headers unblocked (backend 230, frontend 69)

`RecordingControls` — status announced (not just coloured) and visible to
**everyone**, not only whoever started it; a participant joining an
already-recording class must acknowledge the notice before continuing.
`STOPPING` renders as "processing" rather than claiming the recording is ready,
and a 409 renders "not configured" instead of failing silently. 8 tests.

### nginx headers — the change that was blocking the whole feature

The shipped config set `microphone=(), camera=()` and `connect-src 'self'`,
which made the feature impossible in production regardless of the code. Audited
with the repo's `performing-security-headers-audit` skill.

Rather than widen the CSP permanently, `nginx.conf` became
`nginx.conf.template`, rendered at container start by the nginx image's own
envsubst entrypoint:

- `NGINX_ENVSUBST_FILTER=LIVEKIT_` so **only** `LIVEKIT_*` is substituted —
  nginx's own `$uri`, `$scheme`, `$remote_addr`,
  `$proxy_add_x_forwarded_for` are left intact.
- `LIVEKIT_CSP_ORIGINS` defaults to **empty**, so with online classes disabled
  the policy is byte-for-byte as strict as before this feature.

| Header | Before | After |
|---|---|---|
| `Permissions-Policy` | `camera=(), microphone=()` | `camera=(self), microphone=(self), display-capture=(self)`, everything else explicitly denied — and now also denies `payment`, `usb`, `serial`, `bluetooth`, `midi`, sensors |
| CSP `connect-src` | `'self'` | `'self' ${LIVEKIT_CSP_ORIGINS}` |
| CSP | — | adds `media-src 'self' blob:` and `worker-src 'self' blob:` (LiveKit attaches media via object URLs and runs audio processing in blob workers) |
| `frame-ancestors`, `nosniff`, HSTS, `frame-src blob:` | present | **unchanged** — PDF homework still works |

Verified, not assumed — run against the real `nginx:1.29-alpine` entrypoint:
`nginx -t` passes on the rendered file; `connect-src` and `Permissions-Policy`
render as intended; `try_files $uri` survives substitution.

*(My first attempt to test this was wrong: overriding the command with `sh -c`
skips the image's template scripts, because the entrypoint only runs them when
the command starts with `nginx`. The passing result was from the stock config,
not mine. Re-tested correctly.)*

`Dockerfile`, `docker-compose.prod.yml` and `.env.prod.example` updated.
**HTTPS is mandatory outside localhost** — `getUserMedia` is not offered in an
insecure context — and that is now stated in the template itself.

## 0h. P5 backend complete — recording (backend 230, frontend 69)

Dependency added: `software.amazon.awssdk:s3` **2.55.1** (verified against
`maven-metadata.xml`), Apache-2.0.

- **`S3ClassArtifactStorage`** — path-style addressing plus a custom endpoint, so
  the same adapter serves AWS S3, Cloudflare R2 and MinIO. Object keys are
  class-scoped with a random component, containing no name or e-mail. Signed
  URLs are short-lived (10 min default) and treated as credentials: the failure
  path logs **no** exception body, because that can echo the signed URL.
- **`LiveKitRecordingProvider`** — room-composite Egress writing MP4 **straight
  to object storage**; recordings never pass through this application's heap.
- **`OnlineClassRecordingService`** — teacher-only start/stop, idempotent start,
  consent acknowledgment. Starting yields `STARTING` and stopping yields
  `PROCESSING`: **only a verified webhook may declare a recording READY.** A
  provider failure marks `FAILED` rather than leaving the class stuck
  "starting".

### Webhook — the security-critical piece

`WebhookReceiver` validates the Authorization JWT against the API key/secret and
compares a **SHA-256 of the raw body** to the `sha256` claim. The controller
therefore takes the body as a raw `String` and verifies **before** parsing or
touching state, and returns 401 without echoing a reason (which would let an
attacker distinguish a bad signature from a bad body).

`SecurityConfig` gained exactly one rule — `POST` on the single exact path, with
a comment explaining it is JWT-exempt but never unverified. It is deliberately
**not** a `/**` prefix.

Tests sign payloads with the same HMAC scheme the provider uses, so verification
is exercised for real with no LiveKit account:

| Test | Asserts |
|---|---|
| valid signature accepted | reachable without a user token |
| missing header / wrong secret | rejected |
| **tampered body with a valid header** | rejected — the hash covers the raw body |
| duplicate completion webhook | result unchanged, still one row |
| **late `egress_started` after completion** | cannot move a finished recording backwards |
| unknown egress id | ignored, no state invented |
| `GET` on the webhook path, and sibling class endpoints | still 401 — the permit rule is not a broad prefix |

`OnlineClassRecordingIntegrationTest` (17) + `LiveKitWebhookEndpointIntegrationTest` (5).

Webhooks also reconcile attendance: presence events are matched by the user id
embedded in the participant identity, so a client cannot attribute presence to
someone else, and `markLeft` ignores an unmatched leave so duplicate or
out-of-order events cannot inflate attendance.

Still open in P5: the recording consent/status UI and post-class playback list.

## 0g. P4 complete — persistent chat (backend 208, frontend 61)

**Backend** `OnlineClassChatService`:

- **Idempotency before rate limiting.** `clientMessageId` is checked first, so a
  client retrying after a timeout resolves to the original message instead of
  being throttled for its own earlier attempt. Covered by
  `aRetryIsNotPunishedByTheRateLimit`.
- **Rate limit counted in the database** (10 messages / 10 s per sender per
  class), so it holds across application instances rather than per-process.
- **Cursor pagination** — newest page first, oldest-first *within* a page so the
  client can append directly; one extra row is fetched to detect `hasMore`.
- **Documented edit/delete rule:** the author may edit or delete their own
  message, the host may delete anyone's, and system messages are server-authored
  and deletable by no client. Acting on someone else's message returns
  **not-found**, so a participant cannot probe for another's message by id.
- **Sanitization stores plain text**: control characters stripped, newline runs
  collapsed. It deliberately does **not** HTML-escape — escaping at storage and
  again at render would corrupt legitimate `&` and `<`. The test asserts markup
  is stored verbatim *and* that the client renders it inert.

`OnlineClassChatIntegrationTest` — 19 tests.

**Frontend** `useClassChat` + `ChatPanel`:

- `clientMessageId` is the join key between the optimistic bubble, the realtime
  copy and the persisted row, so one logical message arriving by three paths
  renders **once**. Tested both by id and by client key alone (the reconnect
  case, where the server id differs).
- A failed send stays retryable and **reuses the original key**, which is what
  prevents a duplicate server-side after an ambiguous failure.
- Rate limiting surfaces without losing the draft.
- Autoscroll only when already near the bottom, so reading history is not
  interrupted by an arrival.
- No `dangerouslySetInnerHTML` anywhere; the XSS test asserts an
  `<img onerror>` body renders as text and creates no element.

Frontend tests now 61. Bundle: main **466 kB**, LiveKit chunk 694 kB.

### Fixed while writing the tests

The control-character test contained literal `\x00`/`\x07` **bytes** in the Java
source — it passed, but for an invisible reason. Replaced with explicit octal
escapes (`\000`, `\007`) so the intent is readable and the file survives
encoding round-trips.

## 0f. P3 complete — classroom controls UI (backend 189, frontend 44)

**Realtime event protocol written first**, as
`docs/online-classes/01-realtime-event-protocol.md`, because P4 chat and P7
annotations both depend on it. Six versioned topics with an explicit
reliable/lossy split, an 8 KB packet cap, and the rule that makes the whole
thing safe: **a role stated inside a packet grants nothing** — authority is
resolved server-side from the participant identity.

`events.ts` implements it as strict parsers that treat every packet as
untrusted input from another person's browser. `events.test.ts` (10 tests)
covers the cases that matter: a packet addressed to a **different class** is
dropped (being in a room is not a licence to inject into another class's
state), malformed JSON never throws, oversized packets are dropped whole,
an unknown reaction is rejected rather than rendered (the test uses an
`<img onerror>` string, so arbitrary text can never reach the render path),
unknown versions and types are ignored, and pointer coordinates outside the
normalized 0..1 surface are treated as malformed.

UI delivered:

- `WaitingRoomPanel` — host-only, polled rather than channel-driven because
  admission is durable state that must survive a reload. Decided requests are
  dropped locally so a second click cannot re-decide them, and a failed poll
  keeps the current list rather than blanking it mid-decision.
- `ParticipantListPanel` — roster for everyone (names, roles, mic/hand/
  connection state); moderation controls render only for the host, with the
  server enforcing it independently. Removed participants are filtered out.
- Both wired into the room as a sidebar; 20 new RU/DE keys.

Frontend tests now 44. The roster tests assert the security-relevant shape
directly: students see **no** moderation buttons, and the host is never offered
mute/remove against themselves.

Bundle after all of P3: main **464 kB**, LiveKit still isolated in its lazy
690 kB chunk.

## 0e. P3 backend complete — classroom controls (backend 189, frontend 25)

- **`OnlineClassAdmissionService`** — knock / list / approve / reject /
  approve-all. Knocking is idempotent (a refresh keeps the same pending
  request, backed by the partial unique index), auto-approves when the waiting
  room is off, and a decided request **cannot be flipped** by a late duplicate
  click. A removed student cannot knock again.
- **`OnlineClassHostControlService`** — mute, mute-all-students, remove,
  per-participant permissions, class-level student screen share, waiting-room
  toggle, attendance, roster, and unmute **request**. Every control runs from
  the backend with server credentials; browser tokens never carry moderation
  rights.
- 17 new REST endpoints on `OnlineClassController`. Attendance is teacher-only
  (it exposes per-student timings); the roster is visible to students and
  carries no e-mail addresses.

**Bug found and fixed while writing this phase.** Host controls initially
addressed participants as `ParticipantIdentity.of(userId, null)` — which
*invents a random device suffix*, so every mute and removal would have targeted
an identity that matches nobody, failing silently against a real provider.
Identities are now resolved from the room via
`listParticipantIdentities` and filtered by embedded user id. This also fixed a
second latent issue for free: a user connected from two tabs is now muted or
removed on **both**. Both behaviours are covered by tests
(`mutingResolvesTheLiveIdentityRatherThanGuessingIt`,
`removingDisconnectsEveryTabOfThatUser`).

Resilience choices: mute-all skips an offline participant instead of aborting
the sweep; a failed provider disconnect still leaves the durable `REMOVED`
state, which is what actually blocks a new token.

`OnlineClassAdmissionIntegrationTest` — 20 tests.

### P2 gap closed: teacher entry point

`StartOnlineClassButton` materializes the class, starts it and opens the room,
added to `LessonDetailPage` as **one element** rather than a block of inline
logic. Google Meet is demoted to a clearly secondary fallback using the
`onlineClass.meetFallback` string. When the feature is disabled or
misconfigured the button renders a precise unavailable state instead of a
generic error, and never reveals which setting is missing.

Verified that importing it into `LessonDetailPage` does **not** pull LiveKit
out of the lazy chunk: main bundle stayed at 461 kB.

## 0d. P2 in progress — LiveKit provider landed (suite: 150 green)

**Version verification corrected a wrong answer.** The Maven Central *search*
API reported `io.livekit:livekit-server:0.10.0`; the authoritative
`maven-metadata.xml` says **0.16.0**. Pinned 0.16.0.

API surface confirmed by reading the SDK source at `main` rather than trusting
docs (the docs URL 404'd):

- `AccessToken(apiKey, secret)`; `ttl` is in **milliseconds**; `addGrants(vararg VideoGrant)`; `toJwt()`.
- Grants available include `RoomJoin`, `RoomName`, `CanPublish`, `CanSubscribe`,
  `CanPublishData`, **`CanPublishSources(List<String>)`** — the last is what
  enforces per-source rights, so a student can be denied `screen_share` at the
  token level rather than only in the UI.
- `RoomServiceClient.createClient(host, apiKey, secret)` returning Retrofit
  `Call`s; `removeParticipant(room, identity, revokeTokenTs)` — the third
  argument is what stops a removed participant reusing a held token.
- `WebhookReceiver(apiKey, secret).receive(body, authHeader)` verifies a SHA-256
  of the **raw** body against the JWT claim — required for P5.
- The emitted JWT carries `iss/exp/sub/name/video` and **no `nbf`/`iat`**,
  established by decoding a real token.

Delivered:

- `provider/livekit/LiveKitMediaProvider` — token minting, room ensure/close,
  server-side audio mute (resolves the track sid first), participant removal
  with token revocation, permission updates, and reliable control packets.
  URL scheme conversion (`wss://` for browsers, `https://` for the admin API)
  is handled locally.
- `provider/UnconfiguredMediaProvider` + `LiveClassProviderConfiguration` —
  fails safe. A missing credential yields a precise unavailable state and never
  logs *which* value is absent (that would be a configuration oracle).
- **Design change:** recording moved out of `LiveClassMediaProvider` into its
  own `ClassRecordingProvider` port. Recording is independently configured and
  independently failing, and this avoids shipping unimplemented methods on the
  media port as placeholders.

`LiveKitMediaProviderTest` (7 tests) runs with a throw-away key — signing is
local, so no credentials and no network are needed. It asserts the token is
scoped to one room and identity, that the API secret never appears in anything
browser-bound, that TTL stays under 15 minutes, that `screen_share` is absent
for a student denied it, and — directly against acceptance criterion 14 — that
**`roomAdmin`, `roomRecord`, `roomCreate` and `roomList` are never granted**.

Attribution recorded in `THIRD_PARTY_NOTICES.md`.

### P2 backend complete (suite: 169 green)

- **`OnlineClassService`** — materialize/open-lobby/start/end/cancel/connect/
  leave. Ownership on materialization is proved by the lesson appearing in the
  calling teacher's own calendar listing, so a guessed `eventId` gets nothing.
  Ending credits attendance for anyone still connected, and a provider outage
  during `closeRoom` is caught so the class still ends in our own records.
- **`ParticipantIdentity`** — `<userUuid>|<deviceSuffix>`. The user id is
  embedded for webhook attribution; the suffix keeps two tabs distinct instead
  of evicting one another; the suffix is sanitized and length-capped, and the
  identity carries no name or e-mail.
- **`OnlineClassController`** — `/api/v1/online-classes/**`. `@PreAuthorize`
  only narrows by role; ownership always goes through
  `OnlineClassAccessService`, because a role never proves class membership.
  `SecurityConfig` needed no change — `anyRequest().authenticated()` already
  covers these routes.
- **DTOs** — `OnlineClassResponse` deliberately carries no provider URL, token
  or credential; connecting is a separate, separately authorized call.
- A `Clock` bean was added (`@ConditionalOnMissingBean`) so join-window rules
  are testable rather than wall-clock dependent.

`OnlineClassServiceIntegrationTest` (19 tests, fixed clock, stubbed provider,
real PostgreSQL) covers: materialization idempotency and lesson snapshotting,
cross-teacher denial, lifecycle idempotency with exactly one host participant
row, attendance credited on end, students blocked from lifecycle operations,
waiting/removed/unrelated students denied tokens, join-window enforcement
(including "no token for a historical lesson"), teacher override before the
window, student discovery scoping, and two-tab identities mapping to one
participant row with no personal data in the identity.

**Caught by the optimistic-lock column:** a test wrote through an `OnlineClass`
instance that `start()` had already versioned in its own transaction. That is
the `@Version` guard doing its job — the fix was to re-read, and it is a real
constraint on callers worth knowing before the controllers get concurrent use.

### P2 front end complete (25 frontend tests, backend 169 — all green)

**Test stack:** Vitest **3.2.7** + React Testing Library + jsdom, in
`vitest.config.ts` kept separate from `vite.config.ts` so the production build
config is untouched. Scripts: `test`, `test:watch`, `test:coverage`.

*Security note on the version choice:* Vitest 2.1.9 pulled a **critical**
advisory (arbitrary file read/execute when the Vitest UI server listens,
`<3.2.6`). Upgrading to 3.2.7 clears it. A moderate `@vitest/mocker` path-traversal
advisory remains (fixed only in `>=4.1.11`, which needs Vite 6/7 — out of scope
here); it is dev-only. The two remaining `high` advisories (`browserslist`,
`vite`) are **pre-existing** via Vite 5, not introduced by this work.
**Production dependencies stayed at the pre-existing 2 moderate — the LiveKit
additions introduced no new production vulnerability.**

Delivered:

- `api/onlineClasses.ts` — a **separate module**, not another line in
  `client.ts`. The only change to `client.ts` was exporting its existing
  `request` helper so auth/token handling is reused rather than duplicated.
- `useClassSession` — token acquisition modelled as a phase machine, separate
  from LiveKit's own connection state so it is testable without a media stack.
  Guards a duplicate in-flight request, holds the token **in memory only**, and
  maps a 404 to `denied` **without** surfacing the server's wording, so the UI
  cannot leak whether a class exists.
- `PrejoinPanel` — preview, device enumeration (after permission, when labels
  exist), and distinct `denied` / `noDevices` / `unsupported` states with a
  retry. Stops every local track on unmount so the camera light goes out.
- `OnlineClassRoom` — `LiveKitRoom` shell with automatic grid ↔ screen-share
  focus plus filmstrip, `RoomAudioRenderer`, `ControlBar`, adaptive stream and
  dynacast on, a live-announced connection status, recording/transcription
  banners, and a confirmed host-only "end for everyone".
- Pages + routes at `/online-classes` and `/online-classes/:classId`.
  `ProtectedRoute` was extended minimally to accept a role **list** so teachers
  and students can share a route while the backend still decides access.
- 32 RU + 32 DE keys. DE is typed `Record<keyof typeof ru, string>`, so missing
  coverage is a **compile** error; the tests add what types cannot check —
  no blank values and no Cyrillic left in the German set.

**Bundle regression caught and fixed.** Adding LiveKit took the single bundle
from 455 kB to **1.17 MB**, which every flashcard page — including student
mobile — would have paid for. The online-class routes are now `React.lazy`
code-split: main bundle back to **460 kB**, with LiveKit isolated in a 686 kB
chunk fetched only when a class is opened.

Frontend tests (25): translation coverage (4), route protection incl. parents
redirected away and shared teacher/student routes (6), prejoin device/permission
states incl. camera release on unmount (6), session phases incl. duplicate-request
suppression and the 404-is-denied rule (9).

Still open in P2: teacher entry point on the lesson detail page (currently the
class is reachable via `/online-classes`), and speaker test/background blur in
prejoin.

## 0c. P1 COMPLETE — foundation landed and verified

**Suite: 143 run, 0 failures, 0 errors** (was 103 before P1; +40 new tests).
Frontend `npm run build` and `npm run typecheck` both still pass.

Delivered in `com.mcschool.flashcard.liveclasses`:

- **9 enums** — `OnlineClassStatus`, `ClassRole`, `AdmissionState`,
  `JoinRequestState`, `ClassMessageType`, `ClassFeatureState`,
  `RecordingStatus`, `AnnotationTargetType` (incl. `NOTEBOOK_CAMERA`),
  `AnnotationOperationType`.
- **8 entities** matching existing Lombok/static-factory conventions. Business
  rules live in the entities: exactly-one-target, idempotent lifecycle
  transitions, attendance accumulation, soft-delete, provider-state guards.
- **8 repositories**, including a JPQL query that resolves student visibility
  through `StudentGroupMember` so a client cannot widen its own scope.
- **3 provider ports** (`provider/`): `LiveClassMediaProvider`,
  `ClassArtifactStorage`, `ClassTranscriptionProvider`, plus `MediaGrant`,
  `ParticipantConnection`, `MediaProviderException`. `MediaGrant` deliberately
  has **no room-admin/room-record flag** — those are never granted to a browser.
- **`OnlineClassProperties`** — fails safe (`enabled=false` keeps the existing
  Meet/Soniox flow), with `isMediaConfigured()`/`isRecordingAvailable()`/
  `isTranscriptionAvailable()` driving precise unavailable states.
- **`OnlineClassAccessService`** — the single authorization choke point.
  Denials surface as not-found so an outsider cannot distinguish
  forbidden from non-existent.

Tests added (40):

| Suite | Count | Covers |
|---|---|---|
| `OnlineClassTest` | 10 | lifecycle idempotency, illegal transitions, opaque room name asserted to leak no event id or e-mail |
| `OnlineClassParticipantTest` | 9 | attendance across reconnects; duplicate/out-of-order leave cannot inflate it; removed participant cannot be silently re-admitted |
| `OnlineClassAccessServiceIntegrationTest` | 10 | host, bound student, group member, other teacher, other student, parent, archived teacher/student, and forbidden-vs-missing indistinguishability |
| `OnlineClassPersistenceIntegrationTest` | 11 | V44–V47 constraints against real PostgreSQL: duplicate materialization blocked, recurring occurrences allowed, participant/message/transcript idempotency, annotation uniqueness, `NOTEBOOK_CAMERA` round-trip |

**Defect caught by testing along the way:** `OnlineClassMessage.softDelete`
clears the body, which violated V45's `body_not_blank` CHECK. V45 had only ever
run in throwaway Testcontainers (never deployed), so the constraint was
corrected in place to
`CHECK (deleted_at IS NOT NULL OR length(btrim(body)) > 0)` and is now covered
by `aSoftDeletedMessageMayHaveAnEmptyBody`.

No LiveKit dependency was added in P1 — the ports are provider-agnostic, so the
tree stays buildable and the SDK arrives in P2 behind
`LiveClassMediaProvider`.

## 0b. Migrations landed and verified

`V44`–`V47` created (`V43` was the highest existing):

| Migration | Tables |
|---|---|
| `V44__create_online_classes.sql` | `online_classes`, `online_class_participants`, `online_class_join_requests` |
| `V45__create_online_class_messages.sql` | `online_class_messages` |
| `V46__create_online_class_recordings_and_transcripts.sql` | `online_class_recordings`, `online_class_transcript_segments` |
| `V47__create_online_class_annotations.sql` | `online_class_annotation_documents`, `online_class_annotation_events` |

Verified: re-running the suite after adding them gives **103 run, 31 failures,
1 error — byte-identical to baseline**, with zero Flyway errors. The migrations
therefore apply cleanly to real PostgreSQL (Testcontainers boots the schema)
and change no existing behaviour.

Design points carried into the schema: exactly-one-target CHECK mirroring
`V27`; opaque unique `room_name`; unique occurrence index preventing duplicate
materialization; one participant row per (class,user) so attendance accumulates
across reconnects; partial unique index giving one active join request;
`client_message_id` and `provider_segment_id` as idempotency keys;
`NOTEBOOK_CAMERA` already in the annotation target enum.

Verified green after the repair:
- `npm run build` → `✓ built in 671ms`, 103 modules, `dist/` emitted.
- `npm run typecheck` → exit 0, no errors.

## 1. Current-state report

### Repository layout
The git repository root is `MC-School/`, not the enclosing `mc-school/` folder.
Branch `main`, HEAD `07519a7` ("Merge pull request #3 from
Nicklit200/integration/railway-and-ux"). The merged lesson / parent-chat /
Railway work is present, so this is the correct base per the execution contract.

- `backend/` — Maven (`mvnw`), Spring Boot, Java (local JDK is 21).
  Packages under `com.mcschool.flashcard`: `auth, cards, common, config, drive,
  groups, homeworks, lessons, notifications, parents, reviewhistory, students,
  study, teachers, trialleads, users`.
- `frontend/` — React 18.3 + React Router 6.26 + Vite 5.4 + TS 5.6.
  Runtime deps are only `react`, `react-dom`, `react-router-dom`. **No test
  stack, no lint script.** Scripts: `dev`, `build` (`tsc -b && vite build`),
  `preview`, `typecheck`.
- Flyway migrations: highest applied version is **V43**
  (`V43__add_parent_teacher_chat.sql`). New work therefore starts at **V44**.
- No LiveKit / WebRTC dependency exists anywhere yet, as stated in the brief.

### Integration points confirmed by reading the code
- `frontend/src/api/client.ts` is only 79 lines and `App.tsx` only 83 — both are
  small and clean. A separate `api/onlineClasses.ts` module and a lazy-loaded
  route group will keep them that way.
- `frontend/src/i18n/translations.ts` (331 lines) carries the DE/RU pattern that
  new keys must follow.
- `frontend/nginx.conf` blocks the feature exactly as the brief predicted:
  - line 22: `Permissions-Policy "geolocation=(), microphone=(), camera=()"`
  - line 28: CSP with `connect-src 'self'` and `frame-ancestors 'none'`
  Both must change (camera/mic/display-capture for `self`; LiveKit wss origin in
  `connect-src`) while keeping `frame-ancestors`, `nosniff`, HSTS and the
  existing `blob:` allowances that the PDF homework feature depends on.

## 2. Blockers — build is broken before any of my changes

The working tree contains **156 untracked duplicate files whose names contain
" 2"**. Per the execution contract I have not deleted, renamed, staged or
modified any of them. They are byte-identical copies of their siblings
(verified with `diff -q`). They break all three build surfaces:

| # | Surface | Cause | Count |
|---|---------|-------|-------|
| 1 | `javac` | Two files in the same package each declaring the same `public` type, e.g. `StudentGroup 2.java` declares `public class StudentGroup` → `duplicate class` | 101 files under `backend/src/main/java` (+3 under `src/test`) |
| 2 | Flyway | Two migrations share a version, e.g. `V43__add_parent_teacher_chat.sql` and `V43__add_parent_teacher_chat 2.sql` → startup fails with "Found more than one migration with version 43" | 27 duplicated versions (V12–V43) |
| 3 | `tsc -b` | `node_modules/@types` contains `react 2`, `react-dom 2`, `babel__core 2`, … which TypeScript auto-loads as implicit type libraries → `TS2688: Cannot find type definition file for 'react 2'` | 8 `@types` dirs (+46 dup files under `frontend/src`) |

Verified frontend failure (`npx tsc -b --noEmit`), 9 errors, all of them caused
by the duplication except one pre-existing config error:

```
error TS2688: Cannot find type definition file for 'react 2'.
...
tsconfig.json(20,18): error TS6310: Referenced project
  '.../tsconfig.node.json' may not disable emit.
```

`TS6310` is a genuine pre-existing tsconfig defect independent of the
duplicates and must be fixed as part of adding the Vitest stack.

### Second blocker: backend build tooling is unavailable in this session
A `context-mode` PreToolUse hook intercepts every Maven invocation and redirects
it to a sandbox MCP server, but that server failed to connect
(`plugin:context-mode:context-mode (CONNECT_TIMEOUT)`). Result: **I cannot
compile the backend, run the Spring test suite, or run Testcontainers at all.**
`npm`/`npx` are not intercepted, so the frontend is verifiable.

This matters because acceptance criterion 15 requires the backend full test
suite to pass, and the testing section requires Testcontainers integration
tests. Writing 9 phases of backend code that can never be compiled or executed
would produce exactly the unverified scaffolding the brief forbids.

### What I need from the owner
1. Move the 156 " 2" files out of the source tree (they are byte-identical
   copies, so nothing is lost), or confirm explicitly that I may relocate them
   to a quarantine folder outside `src/`. I will not touch them otherwise.
   `node_modules/@types/* 2` can instead be cleared by a clean `npm ci`.
2. Either disable the `context-mode` hook for this session or restore that MCP
   server, so Maven can run.

## 3. Implementation plan (once unblocked)

Ordered per the brief; the tree stays buildable after each phase.

**P0 — Version verification. (DONE 2026-09-18, frontend half)**
Queried the npm registry directly (`npm view`) — WebFetch is blocked in this
session by the same dead plugin that blocks Maven.

| Package | Latest | Licence | Verdict |
|---|---|---|---|
| `livekit-client` | 2.22.3 | Apache-2.0 | pin `2.22.3` |
| `@livekit/components-react` | 2.9.24 | Apache-2.0 | pin `2.9.24`; peers `react >=18`, `livekit-client ^2.20.1` → both satisfied |
| `@livekit/components-styles` | 1.2.0 | Apache-2.0 | pin `1.2.0` |
| `konva` | 10.5.0 | MIT | pin `10.5.0` |
| `react-konva` | 19.3.0 | MIT | **DO NOT USE 19.x** |

**Finding:** `react-konva@19.3.0` declares peers `react ^19.3.0` /
`react-dom ^19.3.0`. This project is React **18.3.1**, so the current major is
incompatible and would force a React 19 upgrade — far outside this feature's
scope. Pin **`react-konva@18.2.16`** instead (peers `react >=18.0.0`,
`konva ^8 || ^9 || ^10` — compatible with `konva@10.5.0`).

All five are Apache-2.0 / MIT, i.e. commercial-use compatible. Record in
`THIRD_PARTY_NOTICES.md` at P1.

Still to verify when Maven is unblocked: the LiveKit Kotlin/Java server SDK
Maven coordinates and its token/room/Egress/webhook API surface.

Pre-existing `npm audit`: 2 moderate advisories in the **dev** tree (transitive,
present before this work). Not introduced here; to be addressed at P9.

**P1 — Foundation.** Migrations `V44`…`V50` for `online_classes`,
`online_class_participants`, `online_class_join_requests`,
`online_class_messages`, `online_class_recordings`,
`online_class_transcript_segments`, `online_class_annotation_documents` /
`_events`. New package `com.mcschool.flashcard.liveclasses`. Ports:
`LiveClassMediaProvider`, `ClassArtifactStorage`, `ClassTranscriptionProvider`,
each with a deterministic in-memory fake for tests. Config binding +
validation + `ONLINE_CLASSES_ENABLED` flag. `OnlineClassAccessService` is the
single authorization choke point (ownership/binding derived from DB only).

**P2 — Core room.** LiveKit token minting (short TTL, opaque room name from
class UUID, identity = userUUID + device suffix), materialize/open-lobby/start/
end/cancel lifecycle with idempotent transitions, `/connection` endpoint,
teacher+student discovery routes, prejoin, `LiveKitRoom` shell, grid/focus
layouts, device controls, reconnect handling.

**P3 — Classroom controls.** Waiting room, participants, attendance
accumulation across reconnects, mute/remove/permission controls via the
provider port, reactions, raise hand, connection quality.

**P4 — Persistent chat.** Backend history + client-UUID idempotency + cursor
pagination + rate limiting; realtime delivery merged and de-duplicated on
reconnect.

**P5 — Recording.** Egress start/stop, signature-verified webhook endpoint,
S3-compatible storage adapter, consent UI + acknowledgment, authorized
playback.

**P6 — Transcription.** Isolated `services/transcription-agent` with its own
lockfile, Dockerfile, health check; internal-token-authenticated idempotent
ingestion; live captions; TXT/JSON/VTT export; failure isolated from media.

**P7 — Whiteboard/annotations.** Normalized-coordinate operations, layers,
undo/redo, laser pointer, screen-share overlay, snapshots/revisions,
throttled transport and batched persistence, payload validation. Target enum
includes `NOTEBOOK_CAMERA` from day one.

**P8 — Lesson integration.** Post-class artifacts + attendance on
`LessonDetailPage`; Google Meet / Soniox retained as feature-flagged fallback.

**P9 — Hardening.** Vitest + RTL (and the `TS6310` fix), Testcontainers suites,
nginx header changes, retention jobs, accessibility, DE/RU coverage,
observability, docs (`README`, `HOW_TO_RUN`, `DEPLOY`, `.env.prod.example`,
runbook).

### Notebook-camera extension point (designed now, unimplemented)
`online_class_annotation_*.target_type` and the participant/track metadata
schema both reserve `NOTEBOOK_CAMERA`, so a later phone-published track is an
additional track source + target value, not a class-model redesign.
