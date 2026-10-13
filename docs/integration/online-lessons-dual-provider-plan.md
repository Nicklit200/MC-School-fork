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

## Owner-only pilot (implemented on this integration branch)
- Access-control manager: `auth/OnlineClassPilotAuthorizationManager.java`.
- All browser-facing `/api/v1/online-classes/**` endpoints are protected in `SecurityConfig` using the server-verified JWT principal.
- Enabled only when `ONLINE_CLASSES_ENABLED=true` **and** `ONLINE_CLASSES_PILOT_OWNER_ID` is set to the owner's teacher-account UUID; defaults deny all.
- Only that teacher may host. Active, non-archived students assigned to that teacher may request access, but room membership MUST still be verified by `OnlineClassAccessService`; students must not see a launch button until rollout.
- Backend unit tests `OnlineClassPilotAuthorizationManagerTest`; CI workflow `online-class-pilot.yml` successfully executed tests on Oct 13.
- Existing Google Meet flow remains independent.
- IMPORTANT: this gate is only a prerequisite. The online-classes backend/controllers, room UI and provider setup are not yet merged into the production-derived branch. Do NOT switch the Railway source or set the feature flag yet.

## Database migration conflict (confirmed)
- Production branch already includes V44..V75.
- Online classroom staging migration set uses V48, V49, V50, V51, V52 and V54, colliding with production's existing version numbers.
- Before first staging deployment, reconcile against production schema and rebase *online-specific* migrations to V76..V81 in the correct dependency order; do not simply copy the entire staging migration directory.
- Also check new upstream Farhad Oct 13 changes before finalizing the import.
