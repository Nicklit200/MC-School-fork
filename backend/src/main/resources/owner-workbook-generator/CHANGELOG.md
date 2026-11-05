# Mindcrafti Workbook Generator — change history

## v4 — 2026-11-05 — Fast shared server renderer

- Enabled the canonical SVG/A4 renderer for signed-in teachers, scoped to their own lessons; source retrieval remains owner/admin-only.
- Structured `create_lesson_draft` requests now use the canonical vector renderer while legacy simple task JSON stays compatible.
- Added lightweight A4 layout preflight before expensive PDF rendering.
- Workbook and teacher-answer HTML are rendered in one WeasyPrint process, reducing repeated Python/font initialization.
- Cached the immutable renderer runtime for the server process and cached the official Brand Guide logo until the guide version changes.
- Draft + explicit publication semantics remain unchanged; no automatic homework or publication.

## v3 — 2026-10-19 — Clean geometry tasks

- Replaced freehand-looking math labels with an SVG coordinate renderer that uses deterministic positions and legible dark text.
- Geometry defaults: triangle A/B/C vertices, opposite sides a/b/c, angle arcs with Greek symbols alpha/beta/gamma. Numeric measurements are not shown inside a figure unless explicitly requested.
- Cube and cuboid no longer print edge dimensions by default; given dimensions belong in the structured `facts` block below the graphic.
- Introduced the `facts` block with side-by-side GEGEBEN / GESUCHT cards in official Mindcrafti A4 styling.
- Added `examples/clean-tasks-demo.json` covering triangle, parabola, cube and cuboid as a canonical reference, and regression tests asserting the labeling defaults.
- Continued to generate separate student workbook and teacher solutions PDF. No school UI changes, no teacher rollout, no auto-publishing.
- Notes: Student and teacher questions/answers in free text are still manually reviewed. PDF overflow checks and numeric-chain checking do not prove full mathematical correctness.

## v2 — 2026-10-19 — Function graphs and geometry

- Added SVG plots and basic 2D/3D figure rendering, with original official branding.
- Corrected mathematical symbol spacing and mandatory PDF page-layout checks.

## v1 — 2026-10-19 — Branded workbook template

- First reusable template from the reference workbook: `generate.mjs`, `styles.css`, school colors, vector fractions, and teacher answer key.

## Release procedure

- All source changes go to `Nicklit200/MC-School-fork` / `integration/railway-and-ux` / `backend/src/main/resources/owner-workbook-generator/`.
- Each change must be committed with a version bump, a regression test, and a PDF visual review.
- Server deployment must be checked separately; a pushed GitHub commit does not mean the connector has been updated.
- The owner-only `get_owner_workbook_generator` tool is currently read-only. Future access for other teachers and server-side generation requires a separate authenticated workflow and explicit approval.
