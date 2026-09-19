# Claude Code prompt: implement the MC-School online-class system

Copy everything below the divider into Claude Code while it is opened at the `MC-School` repository root.

---

You are the senior engineer responsible for implementing a production-quality online-class system in the existing MC-School repository. Work directly in this repository and finish the feature end to end. Do not produce a toy video-call demo and do not replace the existing application architecture.

## Mission

Add first-class teacher/student online classes to MC-School. A teacher must be able to start an existing scheduled lesson inside MC-School and authorized students must be able to join it. The class must support reliable audio/video, screen sharing, persistent chat, host controls, waiting-room behavior, reactions and raise-hand, recording, live captions/transcription, shared annotations, attendance, reconnect behavior, and post-class access to permitted artifacts.

Use LiveKit for realtime media and data transport. Do not implement WebRTC signaling, an SFU, TURN, congestion control, or recording infrastructure from scratch.

This task is only for the online-class foundation. Do not implement notebook detection or perspective correction yet. Design participant/track metadata and UI extension points so a later phone-based `notebook_camera` track can be added without redesigning the class model.

## Execution contract

1. Inspect the current repository and current Git status before editing. Treat this prompt's repository description as guidance, not a substitute for reading the code.
2. Preserve all unrelated user changes. The working tree may contain untracked duplicate files whose names contain ` 2` (for example `Foo 2.java`). Do not delete, rename, stage, or modify those files. Report if they prevent compilation and ask the owner to move them out of the source tree; never clean them automatically.
3. Work from the current merged `main`. Do not resurrect the old pre-merge PR branch and do not overwrite the merged lesson, PDF-homework, parent, push, Google Drive, MCP, time-limit, or screenshot-deterrence features.
4. Before changing dependencies, verify the current stable official LiveKit client, React component, and Kotlin/Java server SDK versions and their APIs. Use primary LiveKit documentation. Pin compatible versions in lockfiles/build files.
5. Start with a short implementation plan and a current-state report, then implement. Do not stop after scaffolding. Continue through migrations, backend, frontend, deployment configuration, tests, and documentation.
6. Make small cohesive changes. Do not rewrite large existing files merely for style. Extract new components and services rather than making `GroupLessonsPage.tsx`, `LessonDetailPage.tsx`, `App.tsx`, or `client.ts` substantially harder to maintain.
7. Do not commit or push unless explicitly asked. Never place credentials in source control.
8. If LiveKit, object-storage, or Soniox credentials are unavailable, still complete the code behind feature flags, provide deterministic local/test fakes, and document the exact environment variables. Do not claim a real integration was manually verified without credentials.
9. You may search for and reuse suitable public GitHub repositories, official starter applications, examples, components, and libraries when doing so makes delivery faster or safer. Prefer official LiveKit repositories and maintained, focused libraries over copying an entire unrelated conferencing product. Before adopting code, verify its license permits this project's intended use, record the repository URL and exact commit/tag used, review its security and maintenance status, and adapt it to this repository's React/Spring/JWT architecture. Preserve required copyright/license notices. Do not copy code with an incompatible, unclear, source-available-only, or noncommercial license. Do not import secrets, generated artifacts, abandoned dependencies, or a second application architecture merely to save time.

## Open-source reuse strategy

Actively evaluate existing implementations before building common conferencing UI from scratch. Good candidates include official LiveKit React components, LiveKit's open-source Meet example, official Egress templates, official webhook/token examples, Konva examples, and small permissively licensed collaboration utilities. You may also use another maintained GitHub repository if it solves a bounded requirement such as prejoin device checks, layout controls, captions, whiteboard tools, or S3-compatible storage.

For every reused repository or meaningful copied/adapted implementation:

- confirm the license and commercial-use compatibility;
- prefer a package dependency when its public API is stable instead of vendoring source;
- pin the version, tag, or commit rather than depending on an unreviewed moving branch;
- run a dependency/security audit and inspect transitive dependencies;
- copy only the bounded pieces required and rewrite integration boundaries for MC-School authorization, persistence, localization, and styling;
- add attribution and notices where the license requires them;
- add tests around the adapted behavior;
- list the source URL, license, reused scope, and modifications in `THIRD_PARTY_NOTICES.md` or the repository's existing equivalent;
- explain in the final handoff why reuse was selected and what remains maintained locally.

Do not use repository reuse as justification for skipping access control, persistence, tests, accessibility, localization, privacy controls, or integration with the existing lesson model.

## Repository state you must integrate with

The application is a monorepo:

- `frontend`: React 18, TypeScript, React Router, Vite.
- `backend`: Java 17, Spring Boot, stateless JWT security, JPA, Flyway, PostgreSQL.
- Production currently uses PostgreSQL + Spring backend + nginx-served frontend.
- Roles include `ADMIN`, `TEACHER`, `STUDENT`, and `PARENT`.
- There are currently no LiveKit/WebRTC dependencies and no in-app media rooms.
- There are no frontend automated tests yet; add a frontend test stack as part of this work.

The merged lesson implementation already provides:

- Teacher lesson routes at `/teacher/lessons` and `/teacher/lessons/:eventId`.
- Admin lesson views.
- Google Calendar events represented by `GroupLessonResponse` with `eventId`, `bindingKey`, teacher/student/group association, title, start/end time, `meetUrl`, and `calendarUrl`.
- `google_calendar_lesson_bindings`, which bind a recurring/calendar lesson to either a student or group.
- `LessonPreparation`, keyed by `(teacher_id, event_id)`, with notes, difficulties, lesson plan, workbook PDF, and answers PDF.
- Google Meet opening and Soniox reminder/upload workflows.
- PDF homework that students can draw on with pointer/stylus input and submit.
- DE/RU localization patterns.

Important files to study before designing:

- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/api/types.ts`
- `frontend/src/auth/AuthContext.tsx`
- `frontend/src/auth/ProtectedRoute.tsx`
- `frontend/src/i18n/translations.ts`
- `frontend/src/pages/teacher/GroupLessonsPage.tsx`
- `frontend/src/pages/teacher/LessonDetailPage.tsx`
- `frontend/src/lesson-start-flow.ts`
- `frontend/src/pages/student/PdfHomeworkPage.tsx`
- `frontend/nginx.conf`
- `backend/src/main/java/com/mcschool/flashcard/config/SecurityConfig.java`
- `backend/src/main/java/com/mcschool/flashcard/lessons/GoogleCalendarLessonService.java`
- `backend/src/main/java/com/mcschool/flashcard/lessons/GroupLessonController.java`
- `backend/src/main/java/com/mcschool/flashcard/lessons/LessonPreparation.java`
- `backend/src/main/java/com/mcschool/flashcard/lessons/LessonPreparationService.java`
- `backend/src/main/resources/application.properties`
- `backend/src/main/resources/db/migration/`
- `.env.prod.example`
- `docker-compose.prod.yml`
- `DEPLOY.md`

Do not treat the existing flashcard `StudySession` as a live class. It is a different domain concept.

## Required architecture

### Realtime provider

Use LiveKit Cloud as the default production recommendation and keep the integration compatible with a self-hosted LiveKit server. The current Railway-style application deployment is not an appropriate place to casually embed a production SFU: WebRTC requires UDP/public-IP/TURN planning, and self-hosted Egress is a separate service.

Use:

- `livekit-client`
- `@livekit/components-react`
- `@livekit/components-styles`
- The official LiveKit Kotlin/Java server SDK when it supports the required token, room, participant, Egress, and webhook operations. Verify the current Maven coordinates and API. If a missing server operation requires a direct authenticated LiveKit API call, isolate that call behind the provider interface and test it.
- `react-konva` and `konva` for whiteboard/annotation rendering unless repository inspection reveals a better already-installed equivalent.

Create a backend abstraction such as `LiveClassMediaProvider`, with a LiveKit implementation. Application services must not scatter LiveKit-specific token signing or API calls across controllers.

The browser must receive only:

- the public `wss://` LiveKit URL;
- a short-lived participant token scoped to one room and one identity;
- non-secret room configuration.

Never expose `LIVEKIT_API_SECRET`, object-storage credentials, Soniox credentials, or an unrestricted room-admin token to the frontend.

### Domain relationship to existing lessons

Do not create a second scheduling system. A live class is a durable execution of an existing MC-School/Google Calendar lesson.

When a teacher first selects **Start online class** for an existing `GroupLessonResponse`, materialize an `OnlineClass` record that snapshots:

- teacher;
- external calendar `eventId` and `bindingKey`;
- title and scheduled start/end time;
- bound student or group;
- opaque LiveKit room name derived from the new class UUID, not raw names/emails/event IDs.

Link post-class recordings, transcript, chat, attendance, annotations, and lesson notes to this class. Continue linking preparation/workbook data through the existing teacher + event ID relationship.

Keep the existing Google Meet URL as a feature-flagged fallback during rollout. When online classes are enabled, the primary lesson action should open the internal prejoin/class experience; a clearly secondary **Open Google Meet fallback** action may remain.

### Backend package and migrations

Create a focused backend package such as `com.mcschool.flashcard.liveclasses`. Use Flyway migrations after the highest existing tracked migration number; never edit or renumber an applied migration.

Model at least:

1. `online_classes`
   - UUID primary key
   - teacher FK
   - external event ID and binding key
   - optional student FK or group FK, with an exactly-one-target constraint
   - title and scheduled timestamps snapshot
   - opaque unique room name
   - status: `SCHEDULED`, `LOBBY_OPEN`, `LIVE`, `ENDED`, `CANCELLED`
   - waiting-room enabled flag
   - student screen-share enabled flag
   - recording/transcription state
   - actual start/end timestamps
   - created/updated timestamps and optimistic-lock version
   - unique constraint preventing duplicate materialization for the same teacher/event occurrence

2. `online_class_participants`
   - class/user identity and application role
   - first joined, last joined, last left, total connected seconds
   - camera/microphone/screen-share permission state
   - admission state
   - recording/transcription acknowledgment timestamps
   - reconnect-safe uniqueness and versioning

3. `online_class_join_requests`
   - waiting-room state, request/update timestamps, decision actor
   - idempotent one-active-request behavior

4. `online_class_messages`
   - server-generated UUID and client-generated idempotency UUID
   - sender, body, created/edited/deleted timestamps
   - maximum length, sanitized plain text, chronological index

5. `online_class_recordings`
   - provider Egress ID, status, start/end timestamps
   - storage object key, MIME type, byte size, duration, failure reason
   - never store recording bytes in PostgreSQL

6. `online_class_transcript_segments`
   - stable provider segment ID/idempotency key
   - participant identity/user link when known
   - speaker label, language, start/end milliseconds, final/interim state, text, confidence if available
   - persist final segments; interim captions may remain ephemeral

7. `online_class_annotation_documents` and/or `online_class_annotation_events`
   - target type (`WHITEBOARD`, `SCREEN_SHARE`, later `NOTEBOOK_CAMERA`)
   - target/track identifier and normalized coordinate space
   - ordered revision/sequence
   - actor and layer owner
   - validated operation JSON or normalized shape representation
   - saved snapshot/object key where applicable

Use object storage for recordings and large exported artifacts. Do not add more large `BYTEA` storage for recordings. Implement an S3-compatible storage adapter so AWS S3, Cloudflare R2, or MinIO can be used. Generate short-lived authorized download URLs or stream through an authorization-checked backend endpoint.

### Authorization rules

Enforce authorization on the server for every class and artifact operation:

- The owning teacher is host and room moderator.
- A directly bound student may access only their class.
- For a group class, only active group members may access it.
- Admins may inspect class metadata for support, but must not silently join, view recordings, or read transcripts unless an explicit policy and audit event permits it.
- Parents do not join classes in this release.
- Archived users cannot join.
- Class membership must be derived from database ownership/binding, never from a client-supplied role or room name.
- Join tokens should have a short initial TTL (approximately 10 minutes) and a unique participant identity containing the application user UUID and device/session suffix.
- Teacher grants may publish camera, microphone, screen share, and data. Student screen-share grants follow the class setting. Do not give ordinary clients room-admin or room-record grants.
- A removed participant must not receive a new token. Account for the difference between LiveKit Cloud token revocation and self-hosted short-TTL behavior.

### API design

Follow existing `/api/v1` conventions, DTO records, error handling, and `@PreAuthorize` patterns. Use a dedicated API client module on the frontend instead of adding another huge single-line block to `client.ts`.

Implement equivalent endpoints (adjust names only when repository conventions require it):

#### Discovery and lifecycle

- `POST /api/v1/online-classes/calendar/{eventId}` — teacher creates or gets the durable class after validating the current calendar lesson and ownership.
- `GET /api/v1/online-classes/upcoming` — role-filtered upcoming/live classes for teacher or student.
- `GET /api/v1/online-classes/{classId}` — authorized class detail and current state.
- `POST /api/v1/online-classes/{classId}/open-lobby`
- `POST /api/v1/online-classes/{classId}/start`
- `POST /api/v1/online-classes/{classId}/end`
- `POST /api/v1/online-classes/{classId}/cancel`

All lifecycle operations must be idempotent and transactionally validate legal state transitions.

#### Admission and connection

- `POST /api/v1/online-classes/{classId}/join-requests`
- `GET /api/v1/online-classes/{classId}/join-requests` — teacher only
- `POST /api/v1/online-classes/{classId}/join-requests/{requestId}/approve`
- `POST /api/v1/online-classes/{classId}/join-requests/{requestId}/reject`
- `POST /api/v1/online-classes/{classId}/connection` — return server URL + short-lived scoped token only after authorization/admission and valid time/state checks.
- `POST /api/v1/online-classes/{classId}/leave`

The scheduled join window must be configurable, for example 15 minutes before through a limited period after the scheduled end. Teachers may open/start earlier. Reject arbitrary historical token minting.

#### Host controls

- mute a participant's published audio track;
- remove participant;
- disable/enable a participant's publishing permissions;
- enable/disable student screen sharing;
- mute all students;
- send an unmute request rather than pretending browsers can be force-unmuted;
- end class for everyone.

All controls must call the provider from the backend and update durable/audited state where appropriate.

#### Chat and artifacts

- paginated class message history;
- idempotent message creation/edit/delete where permitted;
- transcript retrieval/export (`TXT` and structured `JSON`; add `VTT` if timestamps support it);
- recording list and authorized playback/download;
- annotation snapshot/history and save/export endpoints;
- attendance summary for the teacher.

#### Provider callbacks

- Add a narrowly scoped LiveKit webhook endpoint.
- Verify every webhook signature against the raw request body using the official SDK/mechanism before parsing or mutating state.
- Handle duplicate/out-of-order events idempotently.
- Reconcile participant join/leave, room finished, track events, and Egress completion/failure.
- Do not broadly permit unverified webhook-like endpoints in `SecurityConfig`.

### Realtime event protocol

Use versioned, documented topics/payloads. Suggested topics:

- `mc.class.chat.v1`
- `mc.class.reaction.v1`
- `mc.class.hand.v1`
- `mc.class.pointer.v1`
- `mc.class.annotation.v1`
- `mc.class.control.v1`

Define TypeScript schemas/types and backend DTO validation where the server persists an event. Include `classId`, event UUID, actor identity, timestamp, version, and payload. Reject oversized or malformed payloads. Never trust a role stated inside a data packet.

Use reliable delivery for chat, hand state, durable annotations, and control notifications. Use lossy/throttled delivery for laser pointers, cursors, and transient reactions. On reconnect or late join, fetch durable state from the backend and de-duplicate realtime events by UUID/sequence.

LiveKit's prefab Chat is non-persistent. It may be used as a UI starting point, but it is insufficient by itself. Persist messages through the MC-School backend, load history on join, and merge/de-duplicate realtime delivery.

## Required user experience

### Teacher flow

1. Teacher opens an existing lesson detail page.
2. Primary action is **Start online class** when the feature is enabled.
3. A prejoin screen previews camera/microphone and offers device selection, speaker test, display name, camera background choice if supported without destabilizing the release, and a clear permission/error state.
4. Starting the class materializes/starts the durable class and opens the room.
5. Teacher sees waiting participants and can admit/reject individually or admit all.
6. During class, teacher can:
   - toggle mic/camera;
   - select devices;
   - share screen with optional tab/system audio where supported;
   - switch grid and speaker/focus layouts;
   - pin participants or screen share;
   - open participant list and chat;
   - mute/remove participants and control student screen-share permission;
   - mute all students;
   - see connection-quality indicators;
   - raise/lower hands and reactions;
   - start/stop recording and transcription with explicit status indicators;
   - open the whiteboard and annotation toolbar;
   - end the class for everyone.
7. After class, teacher sees attendance, saved chat, transcript status/content, recording processing/playback state, and saved annotation artifacts from the existing lesson detail page.

### Student flow

1. Add an upcoming/current classes entry point to the student UI.
2. Student can see only classes assigned directly to them or to one of their active groups.
3. Student performs prejoin device checks and requests entry.
4. Waiting-room and rejection states survive refresh.
5. In class, student gets camera/mic, chat, reactions, raise hand, captions, layout controls, and teacher-governed screen sharing/annotation permissions.
6. Student cannot access teacher moderation controls or another student's private data.
7. After class, student can access only artifacts permitted by policy. Recording/transcript visibility should default to teacher-controlled rather than automatically public.

### Smoothness and resilience

- Enable adaptive streaming and dynacast where supported.
- Use sensible simulcast/video defaults; prioritize stable 720p classroom video over unnecessary maximum resolution.
- Show `connecting`, `connected`, `reconnecting`, `disconnected`, and failed states.
- Preserve UI state and recover chat/annotation state after reconnect.
- Handle denied permissions, missing devices, device unplugging, autoplay restrictions, network changes, duplicate tabs, and teacher ending the room.
- Stop local media tracks on unmount/leave.
- Prevent duplicate connection requests and duplicate room creation.
- Make the main class UI responsive for teacher desktop and student tablet/mobile, including landscape tablets.
- Provide keyboard navigation, visible focus, labels/tooltips, sufficient contrast, reduced-motion behavior, and screen-reader announcements for important state changes.
- Add all new user-facing text in both Russian and German through the existing translation system. Do not hardcode one language throughout components.

### Conference layouts and controls

Use LiveKit React components as reliable building blocks, not as an excuse to ship an unstyled demo. Build an MC-School-specific room shell using components/hooks such as `LiveKitRoom`, participant/grid/focus layouts, `RoomAudioRenderer`, device controls, screen-share controls, and connection state hooks.

At minimum implement:

- grid view;
- active-speaker/focus view;
- screen-share focus with participant filmstrip;
- full screen;
- picture-in-picture where the browser supports it without fragile hacks;
- participant names, role badges, mic/camera/hand/connection state;
- unread chat indicator;
- prejoin device selection and in-call settings;
- a clear red **Leave** button and teacher-only **End class for everyone** confirmation.

Do not claim remote unmute: browsers require local consent. Implement an unmute request notification.

## Chat

- Plain-text messages, timestamps, sender identity, delivery pending/error UI.
- Reasonable maximum length and server-side rate limiting.
- Persistent history with cursor pagination.
- Idempotent retries via client message UUID.
- Teacher can delete inappropriate messages; users may edit/delete their own messages according to a documented rule.
- Sanitize rendered content; do not use unsanitized HTML.
- System messages for joins/leaves/recording state should be visually distinct and should not be forged by clients.
- File transfer, direct messages, and link previews are deferred unless they can be implemented safely without delaying the core release.

## Recording

Use LiveKit Egress rather than browser `MediaRecorder` as the authoritative class recording.

- Teacher-only explicit start/stop.
- Prominent red recording status for every participant.
- When joining an already-recording room, show the recording notice before enabling media and store acknowledgment.
- Persist request/start/processing/ready/failed states.
- Use LiveKit webhooks as the authoritative completion result.
- Output MP4 to S3-compatible object storage with a class-scoped object key.
- Start with a standard room-composite grid/speaker recording. If annotations must appear in the video, implement and test a custom Egress template; otherwise save annotations as separate class artifacts and state that behavior clearly in UI/documentation.
- Provide authorized playback/download and configurable retention/deletion.
- Do not store large recordings in PostgreSQL or proxy entire recordings through heap-buffered Java code.

## Transcription and captions

Replace the manual-only Soniox desktop workflow for internal online classes while retaining it as a Google Meet fallback.

Implement a server-side transcription worker/agent that joins only when transcription is started. Use LiveKit Agents with the official Soniox STT plugin, or another provider only if repository credentials/configuration demonstrate that it is the intended provider. Keep provider code behind a `ClassTranscriptionProvider` boundary.

Requirements:

- no STT API key in the browser;
- realtime interim captions in the room;
- final segments persisted to the backend idempotently;
- speaker identity/label and timestamps;
- RU and DE support, language hints, and a documented auto-detection policy;
- teacher-only start/stop;
- visible transcription/caption status and participant notice;
- reconnect/retry without duplicating final segments;
- post-class TXT/JSON export and VTT when timing data is adequate;
- provider failure must not terminate the class;
- recording and transcription are separate toggles and states.

Add the worker as a clearly isolated service, for example `services/transcription-agent`, with its own locked dependencies, health check, Dockerfile, tests, and deployment documentation. Authenticate worker-to-backend transcript ingestion with a narrow internal credential and idempotency, not an end-user JWT and not a public unverified endpoint.

## Shared whiteboard and annotations

Implement a shared canvas suitable for tutoring:

- pen/freehand;
- highlighter;
- line/underline;
- arrow;
- rectangle and ellipse;
- text notes;
- eraser/select;
- color and stroke width;
- undo/redo scoped safely to the actor's operations;
- clear own layer and teacher-only clear-all with confirmation;
- teacher/student layers that can be hidden;
- ephemeral laser pointer;
- whiteboard pages and a blank/grid background;
- annotation overlay over an active screen share using normalized coordinates.

Represent coordinates normalized to the target surface, not CSS pixels. Include target identity, source dimensions/aspect ratio, page/revision, actor layer, and operation ID. A screen-share overlay annotates the shared view; it does not alter the sharer's operating system or source application.

Durable annotations must survive reconnect and late join. Use optimistic local rendering, reliable realtime operations, and backend snapshots/revisions. Throttle pointer/freehand transport and batch persistence so drawing remains smooth without flooding PostgreSQL. Validate operation count, point count, dimensions, text size, and payload size.

Allow the teacher to save a whiteboard/annotation snapshot as a lesson artifact after class. Keep the target enum/extensibility needed for the later smart notebook camera.

## Privacy and security

This system handles minors, video, audio, messages, and educational records. Implement privacy controls as product behavior, not merely documentation.

- Explicit recording and transcription notices/acknowledgments.
- Configurable retention for recordings, transcripts, chat, attendance, and annotations.
- Teacher-controlled artifact sharing.
- Authorization tests for cross-teacher and cross-student access.
- Audit teacher start/end, recording/transcription changes, admission, removal, and artifact deletion.
- Do not log tokens, media URLs containing credentials, chat bodies, transcript bodies, or storage secrets.
- Validate webhook signatures and internal-worker authentication.
- Rate-limit token minting, join requests, messages, and annotation payloads.
- Use opaque room/object names without PII.
- Prevent stored/reflected XSS in names, chat, transcript, and annotation text.
- Signed URLs must be short-lived.
- Define deletion behavior for a class and its external objects; make external deletion retryable and observable.
- Do not market the implementation as end-to-end encrypted while server-side recording/transcription is enabled. Document this limitation accurately.

## Headers, nginx, and browser permissions

The current frontend nginx configuration blocks the required capabilities with:

- `Permissions-Policy: ... microphone=(), camera=()`
- a CSP `connect-src` limited to `'self'`.

Update the production headers deliberately:

- permit camera and microphone for `self`;
- permit display capture/screen sharing for `self` using valid current header syntax;
- allow only the configured LiveKit HTTPS/WSS origin in `connect-src` where practical;
- retain restrictive defaults for unrelated capabilities;
- preserve `frame-ancestors 'none'`, `nosniff`, HSTS, and the existing PDF blob requirements.

Avoid a permanently overbroad CSP if nginx template/env substitution can safely inject the LiveKit origin. Document the final behavior and verify it in the deployed architecture.

Camera/microphone access requires HTTPS outside localhost. Update deployment documentation accordingly.

## Configuration and rollout

Add documented, validated configuration along these lines, adjusting names to repository conventions:

- `ONLINE_CLASSES_ENABLED`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_WEBHOOK_PUBLIC_URL`
- `LIVEKIT_RECORDING_ENABLED`
- `ONLINE_CLASS_TRANSCRIPTION_ENABLED`
- `SONIOX_API_KEY` only in the transcription service
- `CLASS_ARTIFACT_STORAGE_ENDPOINT`
- `CLASS_ARTIFACT_STORAGE_REGION`
- `CLASS_ARTIFACT_STORAGE_BUCKET`
- `CLASS_ARTIFACT_STORAGE_ACCESS_KEY`
- `CLASS_ARTIFACT_STORAGE_SECRET_KEY`
- `CLASS_ARTIFACT_STORAGE_PATH_STYLE`
- `CLASS_RECORDING_RETENTION_DAYS`
- `CLASS_TRANSCRIPT_RETENTION_DAYS`
- `TRANSCRIPTION_INTERNAL_TOKEN`

Fail safely:

- With `ONLINE_CLASSES_ENABLED=false`, the current Google Meet/Soniox flow continues to work.
- With online classes enabled but misconfigured, show a precise teacher-facing unavailable state; do not expose secrets or silently redirect.
- Recording/transcription buttons are hidden or disabled with an explanation when those subfeatures are not configured.

Use LiveKit Cloud in production documentation unless the operator deliberately chooses self-hosting. If documenting self-hosting, include the actual UDP/TCP/TURN, trusted TLS certificate, Redis, public-IP, host-networking, and separate Egress requirements. Do not imply that adding one container to the current Railway compose file is production-ready.

## Testing requirements

### Backend

Add unit and Testcontainers integration tests covering:

- materialization from a teacher-owned calendar lesson;
- direct-student and group-member authorization;
- denial for another teacher/student/parent/archived user;
- legal and illegal class state transitions;
- waiting-room request/admit/reject idempotency;
- join-window enforcement;
- token grant contents and short TTL without exposing secrets;
- host controls through a fake media provider;
- persistent chat idempotency, order, sanitization, pagination, and authorization;
- webhook signature validation, duplicate handling, and Egress state transitions;
- transcript segment idempotency/order;
- recording/transcript/artifact access control;
- attendance accumulation across reconnects;
- annotation revision/conflict/payload limits;
- retention/deletion jobs.

Do not require a real LiveKit, S3, or Soniox account in CI. Use ports/adapters and deterministic fakes; reserve credentialed integration tests for an explicitly enabled profile.

### Frontend

Introduce Vitest + React Testing Library with minimal configuration appropriate to Vite. Test:

- route/role protection;
- teacher and student prejoin states;
- waiting-room transitions;
- connection/reconnection/ended states using a media-session adapter or mocks;
- host-only controls;
- chat history + live de-duplication;
- recording/transcription banners;
- whiteboard operation handling and layer permissions;
- DE/RU translation coverage for new keys;
- permission-denied and unsupported-browser messages.

Keep most application logic testable without a real browser media stack. Add a small Playwright or equivalent two-context smoke suite if practical, using fake media devices, but do not make the normal unit suite depend on external services.

### Manual verification matrix

Document and perform what the environment permits:

- teacher Chrome desktop + student Chrome desktop;
- teacher Chrome/Firefox + student Safari iPad/iPhone;
- Android Chrome student;
- camera/mic permission denied then retried;
- screen share with/without audio;
- network interruption and reconnect;
- late join while recording/transcription is active;
- teacher removes student and ends class;
- two tabs for one identity;
- annotation at different aspect ratios;
- recording webhook success/failure;
- transcript provider failure without class failure.

## Observability

Add structured, privacy-safe logging and metrics for:

- class lifecycle transitions;
- participant counts and reconnects;
- token/room provider failures without logging tokens;
- recording/transcription state and latency;
- webhook validation failures and duplicate events;
- annotation/message rate-limit rejection;
- storage upload/deletion failures.

Expose health/readiness information that distinguishes the core application from optional LiveKit, storage, recording, and transcription integrations. Optional provider outages must not cause the entire existing flashcard application to be killed by health checks.

## Implementation phases

Implement in this order, keeping the application buildable after each phase:

1. **Foundation** — migrations, entities, repositories, provider interfaces, configuration validation, feature flags, authorization service, API DTOs.
2. **Core room** — LiveKit token/room integration, materialize/start/join/end lifecycle, teacher and student discovery/routes, prejoin, AV, layouts, device controls, reconnect, screen sharing.
3. **Classroom controls** — waiting room, participants, attendance, mute/remove/permissions, reactions, raise hand, connection quality.
4. **Persistent chat** — backend history/idempotency plus realtime delivery and reconnect recovery.
5. **Recording** — Egress start/stop, webhooks, S3-compatible storage metadata, consent UI, playback/download.
6. **Transcription** — isolated Soniox/LiveKit agent, live captions, final-segment persistence, exports, fallback behavior.
7. **Whiteboard/annotations** — tools, normalized operations, realtime sync, persistence/snapshots, screen-share overlay.
8. **Lesson integration** — post-class artifacts and attendance on existing lesson detail; Google Meet/Soniox fallback flags.
9. **Hardening** — tests, limits, retention, accessibility, responsive/device QA, observability, documentation.

If the work must be split across pull requests, preserve this order and do not present phases 1–2 alone as the finished feature.

## Acceptance criteria

The feature is complete only when all of the following are true:

1. A teacher starts an existing assigned calendar lesson inside MC-School without opening Google Meet.
2. Only its assigned student/group members can request/join; another authenticated user receives 403/404 without information leakage.
3. Two real browsers can exchange stable audio/video and recover from a temporary network interruption.
4. Camera, microphone, speaker/device selection, grid/focus layouts, and screen sharing work with clear unsupported/denied states.
5. Waiting room and teacher admission/removal/end-for-all work and survive refresh where appropriate.
6. Chat is realtime, persisted, paginated, reloadable, idempotent, and authorized.
7. Raise hand, reactions, participant state, and connection quality are visible.
8. Teacher can start/stop recording; everyone sees recording state; a completed recording becomes an authorized post-class artifact via verified webhook state.
9. Teacher can start/stop transcription; participants see captions; final timestamped segments persist and export; STT failure does not interrupt media.
10. Teacher and permitted students can annotate a shared whiteboard and screen-share overlay smoothly; late join/reconnect restores durable state; teacher can save an artifact.
11. Attendance correctly represents multiple joins/reconnects.
12. Existing lesson preparation, Google Meet fallback, Soniox fallback, homework, flashcard, parent, push, and MCP functionality still builds and passes tests.
13. New functionality is usable in RU and DE and meets baseline responsive/accessibility requirements.
14. No provider secret reaches a browser bundle, response, log, or committed file.
15. The frontend production build, backend full test suite, new frontend tests, and applicable E2E tests pass.
16. `README.md`, `HOW_TO_RUN.md`, `DEPLOY.md`, `.env` examples, and an online-class architecture/runbook document are updated.

## Final handoff format

When implementation and verification are complete, report:

- the delivered feature set;
- architectural decisions and why;
- migrations and new services;
- configuration/credentials still required for a real environment;
- automated tests run with exact results;
- manual tests actually performed versus still required;
- security/privacy controls;
- known limitations and explicitly deferred Zoom features;
- rollout and rollback steps;
- the exact extension point intended for the subsequent smart notebook-camera feature.

End the handoff with a section titled **Testing instructions**. It must be a clear, ordered, copy-pasteable guide for another developer who has not worked on the feature. Include:

1. Prerequisites and required tool versions.
2. Exact environment-file setup, separating mandatory values from optional recording/transcription values and using placeholders rather than real secrets.
3. Exact commands to start PostgreSQL, backend, frontend, LiveKit/local dependencies, object storage, and the transcription worker.
4. Exact unit, integration, frontend, E2E, build, type-check, lint, and dependency-audit commands, including where each command must be run.
5. Expected success indicators for every command and common failure fixes.
6. Seed/bootstrap steps and credentials needed to create a teacher, student, group, and scheduled lesson without including production credentials.
7. A two-browser manual test: teacher in a normal window and student in an incognito/second-browser window.
8. Step-by-step checks for prejoin, waiting room, audio/video, device switching, screen sharing, chat persistence, reconnect, raise hand/reactions, host moderation, recording, transcription/captions, annotations, attendance, ending the class, and post-class artifacts.
9. A mobile/tablet test covering iOS Safari and Android Chrome when devices are available.
10. Instructions for testing with deterministic fakes when LiveKit/S3/Soniox credentials are unavailable, clearly distinguishing fake verification from a real-provider test.
11. Instructions for verifying LiveKit webhooks, recording completion, signed recording access, transcript ingestion, and failure behavior without exposing secrets.
12. Cleanup commands for local test data, containers, recordings, buckets, and temporary artifacts, with destructive cleanup clearly labeled.
13. A final release checklist showing which tests are automated, which require two browsers/devices, and which require real cloud credentials.

The testing instructions must match the implementation that actually exists. Do not provide imaginary scripts, commands, ports, seed users, or test modes. Run every safe automated command you claim to have run and state any command or manual scenario that could not be executed.

Do not describe scaffolding, disabled placeholders, or unverified provider calls as finished functionality.
