# Dual-provider online lessons integration (work in progress)

## Goal
Keep the existing Google Meet path fully functional and add a separate Mindcrafti Online classroom option per scheduled lesson, for both teacher and student.

## Source and safety
- Production source: `integration/railway-and-ux` (frontend and backend).
- Existing staging source: `test/online-classes-staging` (frontend and backend).
- Online classroom implementation: `feature/online-classes`, and newer upstream `Farhad054/MC-School:main` (13 Oct 2026).
- Never replace production branch with staging wholesale; branches diverged.
- Never run Flyway migrations against production until reviewed, backed up, and tested separately.
- Production Railway source remains unchanged until successful staging acceptance test.

## Scope
1. Port the liveclasses backend module, DTOs, providers, configuration, tests and DB migrations, reconciling migrations against production HEAD.
2. Port online classroom UI, API client, routes, menu and required dependencies without reverting newer production features.
3. In scheduled lesson detail show two independent actions: `Join via Google Meet` (existing) and `Join via Mindcrafti Online` (new). Keep Meet URL unchanged.
4. Restrict access to assigned teacher and enrolled students. Validate admissions, multi-user permissions and tenant separation.
5. Default new media feature OFF until LiveKit URL/API key/API secret and other storage dependencies are configured. Do not expose secrets to frontend.
6. Test two-account and 2-4 student flows, whiteboard concurrent edits, text, PDF export, disconnect/reconnect, mobile Safari, existing Google Meet workflow.
7. Deploy to staging from a reviewed commit, capture results, then open production PR for manual approval.

## Current checkpoint 2026-10-13
- Separate branch created from the existing production code.
- Existing staging deployment SUCCESS on 2026-10-12, not confirmed to include upstream merge from 2026-10-13.
- Full feature is NOT merged, built, deployed, or validated yet.
