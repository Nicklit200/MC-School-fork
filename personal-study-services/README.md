# Study sessions and slide checkpoints

These are the source files for the existing `personal-life-api` and `my-skills-mcp` Railway Functions. Their previous live source was captured on 2026-11-06 before adding study sessions. The frontend remains in `../personal-study-map`; no new history page is created.

Run `node personal-study-services/build.mjs` from the repository root. The script embeds the shared store into each self-contained Railway Function and writes `personal-study-services/dist/personal-life-api.tsx` and `personal-study-services/dist/my-skills-mcp.tsx`. The generated `dist/` directory is ignored by Git. Deploy those generated `.tsx` files, never the multi-file source directly. Function environment variables, OAuth settings and owner identity stay as configured in Railway. Do not put credentials in this repository. The frontend deployment still follows the existing `personal-study-map` branch and Dockerfile.

## MCP usage

1. Read `get_study_progress` for the exact semester and subject IDs. Read `get_study_resume` for the existing material IDs and checkpoints.
2. On an explicit request to save a session, call `save_study_session` with `semesterId`, `examId`, `date` (Europe/Berlin), and a unique `idempotencyKey` per session. Include only topics and slides actually confirmed in the conversation. A retry must reuse both the key and data. A reused key with changed data is rejected.
3. `lastCompletedSlide: 60` means slide 60 is finished. The derived `nextSlide` is 61. `slideFrom` is optional; without it the system does not claim that all earlier slides were studied. At `lastCompletedSlide === totalSlides`, `nextSlide` is null and the material is complete. Topics-only sessions preserve the last saved position.
4. Use `get_study_sessions` for the previous session and history. Follow `nextCursor` to read older pages. Use `get_study_resume` to continue; several materials return separate positions and require choosing a material. Never combine slide numbers across presentations.

The store is append-only and owner-scoped in PostgreSQL. Reads merge existing catalog sessions with saved events by stable session ID, so previous history remains available. Catalog `checkpoint.lastExplainedPage` is the completed slide; `checkpoint.page` alone is not evidence of completion. Historical date-only entries retain `timeKnown: false`. Backfilled sessions are ordered by study time, then recording time and stable ID; they do not override a later checkpoint. New sessions do not change skill mastery or flashcard answers.

HTTP endpoints share the same store: `GET /api/study-sessions`, `GET /api/study-resume`, `POST /api/study-sessions`. They require a valid current account session belonging to the existing primary owner, exactly as quiz v2 does. MCP access continues to require the existing owner lock and OAuth personal read/write scopes.

Run `node --test personal-study-services/tests/*.test.mjs personal-study-map/tests/*.test.mjs` from the repository root. Test fixtures never write personal study data.

## JSONB persistence verification

Study-session writes use Bun's explicit `tx.json(session)` binding. Binding an already stringified session to a PostgreSQL JSONB parameter stores a JSON string, which is not the session object expected by readers. Reads validate the payload against its relational subject/material/date/session columns. Valid older string-encoded session rows are repaired in place for the authenticated owner; IDs, dates, topics, checkpoints, ordering and idempotency keys are preserved.

`saved: true` is returned only after the transaction completes and a separate database read confirms the committed row, JSON object shape, identity and content. Malformed rows or failed readback produce errors. This code never writes skill mastery or old catalog history.

The `Study session PostgreSQL persistence` workflow runs `bun personal-study-services/tests/bun-postgres.integration.mjs` against Bun 1.4.4 and an isolated PostgreSQL 16 database named `study_sessions_test`. It exercises actual driver binding, fresh-client readback, scalar recovery, duplicate retries and rollback on malformed writes. Do not point this integration test at a personal or production database.

## Study card content API

MCP exposes `add_study_cards`, `get_study_cards`, `update_study_card`, and `delete_study_card` through the existing owner lock and personal read/write scopes. Resolve course and skill IDs with `get_study_progress`. Add accepts 1–100 cards and a required idempotency key. All fields are validated before writes. Questions are compared after NFKC normalization, whitespace collapse and case folding within the subject; duplicates (including soft-deleted cards) are counted in `skippedDuplicates`. Invalid input rejects the whole operation. Reusing a key with different content fails. `cardIds` contains only newly created IDs. Retries return the original receipt.

The catalog remains the source for bundled cards. Owner-created content uses the existing PostgreSQL `personal_quiz_snapshots.custom` array; catalog edits use `overrides`. IDs remain stable. Deletion requires `confirm:true` and writes only a tombstone in `deleted`: content, review progress, answer events and session records remain intact. The interface already merges these fields. No catalog import or parallel card store is introduced. The small operations table stores only idempotency receipts and requests.

Writes share the quiz owner's transaction lock, preserve all non-content fields and read the committed snapshot back before reporting `saved:true, verified:true`. Content revisions reject stale browser edits with HTTP 409; the browser saves the rejected draft locally under the metadata key plus `:conflict-backup`, reloads server content and asks the user to repeat the edit. Legacy snapshot replacement is blocked after content revisioning starts. Deploy the API before the MCP function; deploy the matching frontend via the existing branch.

Run the normal Node test suite, then `bun personal-study-services/tests/bun-cards.integration.mjs` with `STUDY_TEST_DATABASE_URL` pointing only to the isolated `study_sessions_test` database. The existing PostgreSQL Actions workflow runs both session and card integration tests.

The 18 Computergrafik cards from commit `2f988edd24a437722df9fa9f42d06e11cf814c34` were verified against the deployed catalog on 2026-11-09 (IDs `cg-20261109-f91-106-01` through `-18`). They are catalog-backed, not imported custom rows.
