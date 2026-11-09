# Mindcrafti MCH3 — seven-day homework via the canonical workbook renderer

## Contract (teacher has ONLY MCH3)
1. Find the most recently actually **taught** student/group lesson with \`find_lessons\`.
2. Read \`get_school_prompt(lessonType=homework)\`, \`get_brand_guide\`, and \`prepare_homework_context(eventId)\`. Review the last actual transcript and documented homework/card errors. A future lesson/month plan alone is not evidence a method was taught.
3. ChatGPT authors **seven distinct** structured \`lessonJson\` documents, each with one student page, one or more *teacher-only* pages and numbered \`qa.algebra\`. \`meta.durationMinutes\` equals the reference calendar lesson, \`meta.homeworkEstimatedMinutes\` is 1..10 (daily workload estimate), and visible student page title can be \`Hausaufgaben\`.
4. Each day: \`generate_homework_day_draft\` with \`day\` 1..7, SAME \`seriesKey\` and FRESH \`contextToken\` but a unique stable \`idempotencyKey\` for the day. The server checks day/rules then uses the existing durable workbook job, SVG/mathematical QA, A4 PDF engine and saves 2 unpublished PDFs. At most 6 outstanding jobs per account; queue in batches and poll \`get_lesson_workbook_job\`.
5. After all seven finish successfully, call \`review_homework_series_drafts\` with the 7 ordered \`draftIds\`, \`eventId\`, and seriesKey. This returns seven short-lived student PDF links and seven private answers links. The teacher reviews documents before approval.
6. **Only after explicit approval**: \`assign_homework_series_from_drafts\` with 7 ordered IDs, original \`eventId\`, SAME \`seriesKey\`, exact \`targetId\`/\`targetType\`, \`startDate\`, \`confirm=true\`, and stable assignment \`idempotencyKey\`. The server reads its own PDF bytes, uses the existing \`McpHomeworkSeriesService.assignDirectSeries\` and verifies saved dates/IDs. No model-provided base64, Drive, Railway or GitHub credentials.
7. Homework drafts cannot be published into lesson-workbook slots.

## Rules enforced before generation
* 7 distinct drafts, each 1..2 independent tasks and 1 physical A4 **pupil** page, estimated at most 10 minutes.
* Each task has its own 6+ full-width 8 mm handwriting rows, no hidden a/b/c mini-series; exact one numbered \`qa.algebra\` item per task (for graphs/geometry: \`visualValue\`).
* Days 1–4 first block is explanation/hint on that sheet. Days 5–7 have only German, without explanations.
* Pupil PDF footer hides group/name and date. Textual student/group names and day/date headers in the pupil page are rejected.
* Mathematical checks and PDF geometry are mandatory. The automatic teacher reference diagrams remain private.
* Rendering >1 A4 student page fails instead of splitting daily homework. Keep graph/geometry tasks sufficiently short to fit.
* Assignment is never automatic. The existing assignment service can replace an unsubmitted PDF for an individual student on an already assigned date; inform the teacher before asking for confirmation.

## Deliberate limits
* This is seven **separate durable daily jobs**, not an opaque single model-generated ZIP or a server AI call.
* The server validates structure and calculations, not necessarily the pedagogical truth of every sentence. Teacher review is required.
* A TEACHER OAuth user may only access their own students and lessons. ADMIN selects the teacher. No API-key access to this workflow.
* A source lesson must be linked to the requested student or group. To create distinct group members' homeworks, use individual source evidence and assignments.


## Queue capacity and throughput

- `WorkbookGenerationJobService` runs up to 3 jobs concurrently per backend instance. PostgreSQL `FOR UPDATE SKIP LOCKED` keeps claims safe across replicas.
- PDF renderer has 4 permits: 3 for background workbook jobs and one spare for live Kolin plain worksheets during a lesson.
- Account active-job limit is 24; school-wide active-job limit is 60. Both include `QUEUED` and `RUNNING` jobs. Enqueue limits are checked atomically under short PostgreSQL advisory locks; rendering never holds those locks.
- `mindcrafti_status` exposes aggregate `workbookQueue` telemetry only: own active count, school-wide queued/running, concurrency, and oldest queue age. No job/student identifiers are exposed.
- Defaults are configurable with `WORKBOOK_JOBS_CONCURRENCY`, `WORKBOOK_JOBS_MAX_PENDING_PER_ACTOR`, `WORKBOOK_JOBS_MAX_GLOBAL_ACTIVE`.
