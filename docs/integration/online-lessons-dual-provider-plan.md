# Mindcrafti whiteboard pilot - isolated add-on to the production school

## Scope
- All lessons continue to originate from Google Calendar. No new scheduling system is introduced.
- The teacher's existing lesson detail keeps Google Meet and adds `Mindcrafti доска (тест)`.
- This is a **standalone shared board pilot**, not the complete Farhad LiveKit classroom or its stage-4 advanced whiteboard.
- Existing routes, teacher/student dashboards, school prompts, homework, Google Meet and Soniox flows remain unchanged.
- Browser drawing tools: pen, eraser, text, undo, teacher-only clear, PNG export, Print/Save as PDF.
- Strokes are appended to PostgreSQL and fetched approximately once per second.
- The board URL is `/lesson-board/:eventId`. Students assigned to the lesson can access the board via direct link once the pilot teacher opens it. The student calendar UI is intentionally unchanged for the owner-only pilot.

## Security
- `/api/v1/lesson-board/**` is protected by JWT and `OnlineClassPilotAuthorizationManager`.
- `ONLINE_CLASSES_ENABLED=false` and blank `ONLINE_CLASSES_PILOT_OWNER_ID` fail closed.
- Teacher host must match the UUID supplied by server configuration, validated from the authenticated principal.
- Student access is allowed only if active, non-archived, directly assigned to the pilot teacher, and a member of the exact event's student/group roster.
- Students cannot clear the board or undo other users' operations; teachers may undo any.
- `VITE_MINDCRAFTI_ONLINE_ENABLED` controls the teacher's link visibility only, never authorization.

## Migration and rollout
- Only migration `V76__create_lesson_board_operations.sql` is added; it creates one new append-only table and indexes without changing existing records.
- Run `LessonBoardMigrationIntegrationTest` against isolated PostgreSQL and unit tests before merge.
- Verify production's migration history still ends at V75 before deploying.
- Set both backend variables (`ONLINE_CLASSES_ENABLED=true`, `ONLINE_CLASSES_PILOT_OWNER_ID=<teacher UUID>`) and frontend `VITE_MINDCRAFTI_ONLINE_ENABLED=true` with skip-deploy, so the staged values take effect together at the checked merge deployment.
- LiveKit credentials are not required: video continues through Google Meet.
- Pilot acceptance: open the owner lesson card, start the board, open the same board URL as an assigned student, check stroke sync, text, undo, clear, PNG and PDF; confirm other teachers/parents receive 403 and existing Meet still works.
- To disable pilot access instantly, set `ONLINE_CLASSES_ENABLED=false`; to remove the UI button, set frontend flag to false and redeploy.

## Not included yet
- Farhad's LiveKit video rooms, camera sharing, advanced PDF annotation and whiteboard stage-4 tools. These need separate integration and end-to-end security review.
