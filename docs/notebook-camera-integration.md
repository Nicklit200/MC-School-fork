# Notebook camera in Mindcrafti lessons

The camera from the supplied Mindcrafti Camera Local 0.5.0 prototype now uses
LiveKit over the school's HTTPS site. It retains perspective correction,
rotation, live ink, PNG export, camera selection, supported focus controls and
detail/economy capture. The local prototype server and test certificates are
not part of the deployment.

## Pupil flow

Inside the online classroom, the pupil clicks **Подключить тетрадь** in the top
lesson toolbar. This opens a notebook workspace in the lesson and immediately
creates a QR code. An already connected phone is resumed without replacing its
credential. Scan the QR with the phone, then tap **Включить камеру** and accept
the normal browser camera prompt. The phone needs internet;
it may use a different Wi-Fi network or mobile data. No phone app, development
flag, certificate installation or account sign-in is required on the phone.
Only video is captured. Keep the phone page visible; hiding it stops capture.

The video and the existing perspective, rotation, ink, focus and quality tools
are displayed in the lesson's notebook workspace. **Вернуться к доске**, the
board selector, or the notebook toolbar button switches back to the board.
Switching views keeps the notebook processor, QR, crop and unsaved ink mounted;
it does not replace the QR or disconnect the phone. On narrow screens the
participant rail folds away when opening the notebook, leaving the QR and
settings clear; its normal camera toggle remains available.

For the teacher, a pupil's live notebook replaces that pupil's personal board.
Use the existing pupil board picker or **Все ученики (2×2)**: pupils with live
notebooks show their camera, while the other tiles retain their normal boards.
Opening one pupil shows the live frame over the full board workspace, with the
same BoardToolbar and WhiteboardCanvas used for an ordinary pupil board: pen,
highlighter, erasers, text, shapes, selection, page navigation and zoom/pan. The
teacher view contains no prototype iframe, camera settings sidebar or separate
prototype ink toolbar. The overview remains a compact live preview. There is no
separate teacher notebook workspace. The camera list refreshes automatically
without issuing a replacement QR.

The teacher's native video subscription and camera annotation board remain in
the same DOM location across overview, individual and shared-board views. A
decoded video frame determines whether the camera or board is visible; a claimed
camera record alone does not imply live video. Turning off the phone brings back
the ordinary board, and publishing video again automatically restores the
camera. Both annotation boards keep their state while hidden. The viewer remains
subscribed while the board is shown and keeps transport errors/retry accessible.
Revocation or session expiry removes that media viewer.

The live frame is a background image in a separate Konva layer. It preserves the
phone video's natural orientation and aspect ratio; zoom/pan transform both the
frame and marks together, and partial erasing affects only the ink layer. Camera
annotations use `NOTEBOOK_CAMERA` with the same private `personal-<pupil UUID>`
target id, distinct from the pupil's `WHITEBOARD` documents. Camera drafts, view
events and remote lasers are disabled because the current realtime packet does
not distinguish annotation target types. Saved marks use the authorized REST
annotation API and visible personal surfaces poll for changes.

The camera's save-material action captures the current frame together with its
marks. **Скачать кадр PDF** downloads that current view as a single-page PDF;
the ordinary board's full-document PDF export and lesson-board archive continue
to export their own documents.

The pupil's prototype workspace retains its perspective, rotation and local ink
controls, which belong to that viewer screen. Supported camera hardware controls
affect the shared phone capture. Notebook shortcuts on the lesson card and pupil
calendar remain available.

The teacher may select an enrolled pupil and create the QR for them. A
teacher-owned camera also supports a trial lesson without a pupil account.

## Deployment

Deploy the backend and frontend from the same feature version. Apply the new
additive `V85__create_notebook_cameras.sql` migration through the usual Flyway
startup. Existing lesson and classroom migrations are unchanged.

The existing `ONLINE_CLASSES_ENABLED`, `ONLINE_CLASSES_PILOT_OWNER_ID`,
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` configuration is
reused. Pilot access remains limited to the configured teacher and their
eligible pupils. Camera buttons do not expand server authorization.

Serve the frontend using `frontend/nginx.conf.template`. Preserve the existing
exact LiveKit HTTPS/WSS origins in `LIVEKIT_CSP_ORIGINS`. The notebook processor
under `/notebook-camera/` must allow same-origin framing and JavaScript MIME
types for `.mjs`; other pages retain their frame restrictions. The protected
lesson page is `/lesson-notebook/:eventId`, distinct from the static files.
The anonymous phone QR enters through `/?mindcraftiCamera=1#...`, so public
hosts that only serve their root document can open it. The app restores the
phone route and immediately removes its secret fragment from history.

## Access and lifecycle

Every notebook has its own LiveKit room, separate from the classroom and
attendance identities. Viewers are restricted to the lesson teacher and
notebook owner. Viewer grants allow data/subscriptions but no audiovisual
publication; phone grants allow camera/data but no microphone or screen share.

QR credentials are random, hashed in PostgreSQL, single use, and valid for five
minutes. A successful claim returns a separate in-memory phone credential for
up to three hours; media tokens last at most two minutes. No school account
token is transferred to the phone. Camera responses, including errors, use
`Cache-Control: no-store`.

A replacement QR revokes the previous notebook. Teacher revocation, native
classroom end/cancel and pupil removal close its media room. A scheduled sweep
expires sessions and retries failed room closures. A phone heartbeat rechecks
authorization every minute. The browser releases tracks on Stop, page hide,
unmount, failed connection and late permission resolution.

As in the supplied prototype, ink is local to the viewer screen and is not
stored automatically. Save PNG before refreshing. Optical focus controls
remain disabled when the phone/browser does not expose that capability.

## Validation

- Frontend build/typecheck and phone, viewer, API and classroom regression tests.
- Pure Node geometry, camera quality, renderer fallback and independent
  reference-matrix QR tests: `node --test notebook-camera-tests/*.test.mjs`.
- Backend HTTP/security, grant, replay, expiry, revocation and lifecycle tests.
- `NotebookCameraPersistenceIntegrationTest` uses disposable PostgreSQL via
  Testcontainers and checks Flyway/Hibernate, concurrent single-use claims and
  the partial unique index. It skips explicitly when Docker is unavailable.
- `.github/workflows/notebook-camera.yml` runs these checks with Docker on CI.

Browser QA uses synthetic 1920x1080 notebook video to verify live rendering,
crop, rotation and ink without requesting the user's real camera. Actual iOS/
Android optical focus and cross-network streaming require device acceptance
after deployment; synthetic and mocked tests do not establish those results.
