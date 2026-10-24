# Notebook camera in Mindcrafti lessons

The camera from the supplied Mindcrafti Camera Local 0.5.0 prototype now uses
LiveKit over the school's HTTPS site. It retains perspective correction,
rotation, live ink, PNG export, camera selection, supported focus controls and
detail/economy capture. The local prototype server and test certificates are
not part of the deployment.

## Pupil flow

Open **Камера тетради** from the lesson, classroom or pupil calendar. Create a
QR code on the computer/tablet, scan it with the phone, then tap **Включить
камеру** and accept the normal browser camera prompt. The phone needs internet;
it may use a different Wi-Fi network or mobile data. No phone app, development
flag, certificate installation or account sign-in is required on the phone.
Only video is captured. Keep the phone page visible; hiding it stops capture.

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
