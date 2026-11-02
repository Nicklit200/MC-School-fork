# Mindcrafti classroom and lesson boards

## Availability

- With `ONLINE_CLASSES_ENABLED=true`, active teachers can use the classroom, whiteboard and notebook camera with their own active pupils.
- No teacher UUID or `ONLINE_CLASSES_PILOT_OWNER_ID` setting is required. The authorization bean retains its historical `OnlineClassPilotAuthorizationManager` name.
- The classroom uses the same full-screen board, document tools and personal pupil boards for every teacher. A connected notebook camera replaces that pupil's board surface.
- Teacher and pupil menus use the authenticated server response to determine classroom availability.
- The legacy standalone board remains at `/lesson-board/:eventId`; its optional lesson-card link is controlled by `VITE_MINDCRAFTI_ONLINE_ENABLED`. This flag controls visibility, never authorization.

## Student entry

- A scheduled date describes the appointment. A pupil can enter an open lesson on another day when the owning teacher is actually connected.
- `teacherPresent` comes from the owning teacher's identity in the media provider. Another pupil, a transcription agent, or issuing a teacher token alone does not open student entry.
- Calendar discovery may cache presence for up to three seconds. Waiting-room admission and connection-token issuance check it afresh. Membership, admission, removal, rejection and explicit End/Cancel checks still apply.
- Before the teacher joins, pupils see a waiting message. Native online lessons do not show a disabled Google Meet placeholder when they have no Meet URL.

## Lesson and camera isolation

- JWT identity is verified against the active, non-archived database account. Parent and administrator roles do not acquire classroom/board access by role alone.
- A pupil must have an active assigned teacher. Every board, camera and classroom request additionally checks the particular lesson/class owner and pupil membership.
- A teacher cannot read another teacher's board or camera by guessing its lesson, class or camera ID. A pupil cannot inspect another pupil's private notebook.
- Public phone endpoints require their bounded, single-use pairing token or scoped session secret; they revalidate current lesson/class access.
- Students cannot clear the legacy board or undo another user's operations. Teacher-only classroom tools keep their existing role checks.
- Private AI preparation, owner workbook generation and account administration retain their separate authorization rules.

## Configuration and validation

- `ONLINE_CLASSES_ENABLED=false` disables board/camera eligibility. LiveKit credentials are required for online video and notebook-camera sessions; secrets remain server-side.
- The existing Google Meet fallback remains available where the lesson has a Meet URL.
- This rollout changes authorization, not lesson ownership, student assignments or database schema; no migration or data backfill is needed.
- Verify two independent teachers and their pupils: each opens their own board and camera, while cross-teacher and cross-pupil requests fail. Include disabled, inactive and archived account cases.
- Run real PostgreSQL camera/board integration tests, HTTP authorization tests and frontend role/entry tests before deployment.
