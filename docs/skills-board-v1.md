# Skills board v1

Route: `/skills`. The board is an authenticated section of the existing school app, not a separate hosted product. The same-origin iframe isolates its dependency-free canvas styles from existing homework and lesson screens.

## Scope

One editable grade-six catalog: 10 topics and 61 skills derived from the provided Mathe.Logo 6 Wirtschaftsschule Bayern contents, with original learning-outcome descriptions and sample tasks. This is explicitly a draft, not a universal German curriculum; Werkrealschule requirements still need review. Colors classify topics, never pupil mastery. No student assessments are seeded.

Create, rename, move, archive/restore cards; parent relationships and prerequisite arrows; cycle and duplicate-parent validation; pan/zoom/fit/fullscreen; search; local undo and unsaved-draft recovery; JSON export. Save explicitly persists to PostgreSQL. Existing IDs cannot be removed by replacement writes, only archived.

## API and security

`GET /api/v1/skill-boards/grade-6`: ADMIN or TEACHER.
`PUT /api/v1/skill-boards/grade-6`: ADMIN only, body `{expectedRevision, data}`.
The update atomically compares the revision and returns 409 rather than overwrite concurrent edits. Every successful save adds a full revision snapshot and caller ID. Auth uses the existing JWT configuration, not public integration routes. Tokens are sent to the board only by its same-origin authenticated parent, never in URLs or exports.

The JSON data has schemaVersion, title, grade, source, nodes and edges. A node has a stable ID, kind, Russian title, German term, learning outcome, example, source, color, coordinates, archived flag. An edge has ID, source, target and `contains` or `prerequisite` kind. These are validated as separate directed acyclic graphs.

MCP skill tools and per-pupil mastery are intentionally not part of this first release. A REST API alone does not make these tools available in ChatGPT; that integration requires a separately authenticated MCP action.

## Verification

Node graph tests; Spring method-security tests; Java validation tests; isolated PostgreSQL migration, persistence, audit and stale-write tests; Playwright edit/drag/link/archive/undo/reload/read-only/conflict tests; complete frontend production build. No production pupil data or secrets are used by the tests.
