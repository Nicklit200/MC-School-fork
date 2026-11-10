# Kolyn: live context of all pupil boards (implementation plan)

Status: **not implemented**. The existing teacher-requested review must remain functional.

## Current state verified on 2026-11-10

- `useKolinBoardReview.ts` listens to authenticated LiveKit page-view reports (15-second freshness) and captures a page or entire workbook only after a teacher asks to inspect it.
- `KolinBoardReviewService.java` validates ownership and bounded page images.
- `KolinTranscriptContextService.java` reads recent completed transcript turns only when the teacher submits a Kolyn request.
- No continuous AI reading of handwriting, no always-on per-pupil board understanding, and no autonomous error alerts currently exist.

## Required production-safe pipeline

1. **Live change events:** Observe persisted annotation revision updates (not every pointer movement) for every authorized personal and shared board in an active class. Do not depend on the currently selected board or local teacher viewport. Associate each event with classId, studentId, document/page, revision and persisted timestamp.
2. **Debounced snapshots:** Generate snapshots only for changed pages, using latest persisted PDF + saved annotations. Deduplicate by (classId, studentId, page, revision) and enforce a per-lesson work budget. Capture on demand for a query even if no scheduled background job finished. Reject stale snapshots.
3. **Incremental visual extraction:** Cache a bounded, versioned summary of mathematical work per page. Distinguish observed text, derived calculations, uncertain symbols, and inaccessible strokes. Never label errors without verifying the math, and never guess who drew a stroke.
4. **Continuous context index:** Merge per-pupil page summaries with time-stamped finalized transcript turns. A transcript speaker account is not proof of speaker identity. Read only the current teacher's authorized class, with clear lastUpdated timestamps.
5. **Teacher query:** Kolyn can answer "Что сейчас делает Виталина?" using the freshest available version and clearly state stale/incomplete evidence. Capture a fresh board snapshot when the cached summary is too old. If no reliable evidence exists, say so.
6. **Proactive suggestions are opt-in:** Off / On request / Important errors. In opt-in mode, require two independently verified similar mistakes before offering a private teacher-only suggestion. Do not issue student-facing messages, annotations, PDFs or score changes without teacher confirmation.
7. **Cost, security and lifecycle:** throttle image calls, cap tokens/minute and image pages/hour, coalesce events, bound queues and retries, cancel after lesson completion, never store API keys on the client, enforce student/room ownership at the server, align data retention with school policy and parental consent.

## Acceptance tests

- Two or more pupils edit different pages simultaneously; updates remain isolated.
- Teacher sees saved corrections without manually requesting PDF upload; stale summaries are marked stale.
- No AI job runs for every pen stroke or every interim speech segment.
- Every suggested error cites student, page, observed step, corrected step and snapshot revision.
- Unknown handwriting is not shown as a confirmed mistake.
- Mid-lesson reconnect and page switch do not create duplicates.
- Whole-workbook captures respect existing image limits; queue remains bounded.
- Audit production-like behavior at four pupils over a 90-minute lesson.

## Separate UI enhancement

The safe rich text format uses ✅ correct, ❌ incorrect, 💡 teacher tip, ⚠️ uncertain. Its UI and prompt changes are prepared separately in this branch; it is **not** a substitute for live context.
