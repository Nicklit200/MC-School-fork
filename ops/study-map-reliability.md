# Personal Study Map: flashcard reliability

## Release rule

Do not publish untested JavaScript directly. Run the flashcards CI workflow and build `personal-study-map/Dockerfile`. The production Dockerfile runs JavaScript syntax checks plus module-startup, scheduling and ID-integrity tests before copying files into the nginx image. A failure prevents that image from being built; the previous running deployment is not replaced. Chromium/WebKit scenarios run separately in CI. The Railway source's optional wait-for-CI switch is independent of the mandatory Docker checks.

The 2026-10-20 checkup tested the source in an isolated branch. The one-time self-modifying workflow was removed after testing; the permanent workflow is read-only and never pushes code.

## Persistence invariants

- The secret owner token identifies one private quiz history. Two devices must be paired to the same token once. Do not combine unrelated owner hashes or publish bearer tokens.
- Local storage is a durable outbox/cache on that device, not proof that the server accepted a save. Pending answers survive a reload and retry after connectivity returns.
- Synchronization reads and merges the server before writing, serializes requests, and clears a pending revision only after successful POST plus a field-level GET readback. A newer revision created while the request was in flight remains pending.
- Read-only refresh must not trigger an upload feedback loop. An empty or older device must not replace newer per-card states.
- Each card keeps its original ID. Renaming/editing text must not generate a replacement ID for the same card.
- Review dates use Europe/Berlin calendar days. Correct scheduled first attempts advance by 2, 3, 7, 14, 30 days; mistakes return the next day. Free practice must not change the schedule.

## Database protections installed on 2026-10-20

Migrations are recorded in `personal_quiz_integrity_migrations` as `quiz-integrity-20261020-v1` and `quiz-server-schedule-v2-20261020`.

A Bun SQL JSON-binding mismatch had allowed a JSONB string (and subsequently arrays of encoded snapshots) where a JSONB object was required. `personal_quiz_decode_object` and BEFORE-write validation canonicalize the stored shape; table CHECK constraints require object snapshots and progress. `personal_quiz_schedule_v2` upgrades legacy review dates from the original answer timestamp without fabricating new answers. Already-versioned schedules are unchanged.

Original records were transactionally copied into `personal_quiz_snapshot_backups` and `personal_quiz_session_backups` before the shape repair. AFTER-write triggers keep previous revisions and append per-card changes to `personal_quiz_card_events`, including card ID, current/previous state and server recording time. These revision backups are in the SAME database; they are not an independent disaster-recovery backup.

Do not remove these triggers or constraints when changing the API. For Bun SQL, bind an object as JSONB or explicitly use a text-to-JSONB cast for a serialized string; do not double-encode JSON.

## Regression coverage

`tests/review-schedule.test.mjs`: interval progression, error reset, free practice and a 106-card next-day distribution.

`tests/integrity.test.mjs`: syntax, Berlin midnight, DST, year rollover, first-attempt scoring and globally unique source IDs.

`tests/module-boot.test.mjs`: actual module initialization and open/close handlers in an isolated no-network DOM harness, including a zero-due home screen and absence of an upload loop.

`tests/browser-checkup.py`: actual Chromium and WebKit, desktop and mobile viewport, next-day queue, fresh paired device, offline/reload/reconnect, stale tab, free practice and deliberate incorrect server readback. Uses synthetic cards and a mock API only. A deliberately interrupted WebKit request during the simulated outage is classified separately from application exceptions.

A separate production-API test used an isolated random owner to verify exact PostgreSQL readback, stale/empty writes, malformed legacy session tolerance, object constraints and audit events. Its synthetic records were removed afterward. No real user's answers were replaced with test data.

## Operational check

Verify both deployment success and the actual served module version. Inspect authenticated quiz history: HTTP 200 alone is insufficient. Count real progress entries, examine last-answer timestamps and check actual due dates. The presence of an older recovered session does not prove that today's unsent browser answers have arrived. Those require the original device to open the updated site and complete automatic synchronization. Never clear that device's storage to troubleshoot missing history.
