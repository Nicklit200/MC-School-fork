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
