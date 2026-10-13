# Online classes — testing instructions

For a developer who has not worked on this feature. Run everything from the
repository root (`MC-School/`) unless a step says otherwise.

**Verification status of this document:** every command in sections 1–6 and 11
was executed on macOS (Darwin 24.6.0) on 2026-09-18 and produced the output
shown. Sections 7–10 require two browsers, real devices, or provider
credentials that do **not** exist in this environment — they are marked
NOT EXECUTED and are written for you to run.

---

## 1. Prerequisites

| Tool | Required | Verified with |
|---|---|---|
| Java | 17+ | 21.0.4 |
| Maven | wrapper included — do not install | 3.9.16 via `./mvnw` |
| Node.js + npm | 20+ | npm 10.8.2 |
| Docker | Engine + Compose | Docker Desktop |
| Python | 3.11+ (transcription agent only) | 3.12.4 |

```bash
java -version && node --version && npm --version && docker compose version
```

---

## 2. Environment setup

### 2.1 Mandatory — nothing below is needed to run or test the core feature

The feature is **off by default**. With `ONLINE_CLASSES_ENABLED=false` the
existing Google Meet / Soniox lesson flow is unchanged.

No `.env` file is required for local work. The backend defaults match
`backend/compose.yaml`.

### 2.2 Optional — only for a real-provider test

Copy the template and fill in placeholders:

```bash
cp .env.prod.example .env
```

| Variable | Needed for |
|---|---|
| `ONLINE_CLASSES_ENABLED=true` | enabling the feature at all |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | audio, video, screen share |
| `LIVEKIT_CSP_ORIGINS` | the browser CSP (production nginx only) |
| `LIVEKIT_RECORDING_ENABLED=true` + `CLASS_ARTIFACT_STORAGE_*` | recording |
| `ONLINE_CLASS_TRANSCRIPTION_ENABLED=true` + `SONIOX_API_KEY` + `TRANSCRIPTION_INTERNAL_TOKEN` | captions and transcript |

> `SONIOX_API_KEY` belongs **only** to `services/transcription-agent`. The
> backend never receives it. Generate the internal token with
> `openssl rand -hex 32`. Never commit real values.

---

## 3. Start the stack

Three terminals.

### Terminal 1 — PostgreSQL

```bash
cd backend
docker compose up -d
docker compose ps
```

**Expected:** one container, state `running`, port `5434->5432`.

**If port 5434 is already allocated** (this happened during verification —
another project held it), either stop that container or run your own on a free
port and pass matching `DB_*` variables in Terminal 2:

```bash
docker run -d --name mcschool-pg \
  -e POSTGRES_USER=myuser -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb \
  -p 5439:5432 postgres:16-alpine
```

### Terminal 2 — backend

```bash
cd backend
ADMIN_EMAIL=admin@mcschool.local \
ADMIN_PASSWORD='ChangeMe123!' \
ADMIN_NAME='Local Admin' \
ONLINE_CLASSES_ENABLED=true \
./mvnw spring-boot:run
```

Add `DB_HOST=localhost DB_PORT=5439 DB_NAME=mydb DB_USER=myuser DB_PASSWORD=secret`
if you used the alternate port above.

**Expected in the log:**

```
Successfully applied 43 migrations to schema "public", now at version v48
Started FlashcardApplication in ~5 seconds
Online classes: media provider unconfigured (enabled=true)
```

Those "unconfigured" lines are **correct** without credentials — the app starts
and the flashcard features work regardless.

```bash
curl -s http://localhost:8080/actuator/health
```

**Expected:** `{"groups":["liveness","readiness"],"status":"UP"}`

### Terminal 3 — frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173.

### Terminal 4 (optional) — transcription agent

Only when testing real transcription. Requires LiveKit + Soniox credentials.

```bash
cd services/transcription-agent
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
LIVEKIT_AGENT_NAME=mc-transcriber SONIOX_API_KEY=... \
MCSCHOOL_API_BASE_URL=http://localhost:8080/api/v1 \
TRANSCRIPTION_INTERNAL_TOKEN=... \
.venv/bin/python -m agent.main
```

Health: `curl http://localhost:8090/healthz` → `{"status":"ok"}`

---

## 4. Automated test commands

| What | Where | Command | Verified result |
|---|---|---|---|
| Backend unit + integration | `backend/` | `./mvnw clean test` | **302 tests, 0 failures, BUILD SUCCESS** |
| Frontend unit | `frontend/` | `npm test` | **122 tests, 14 files passed** |
| Frontend type-check | `frontend/` | `npm run typecheck` | exit 0, no output |
| Frontend production build | `frontend/` | `npm run build` | `✓ built in ~1.5s` |
| Agent tests | `services/transcription-agent/` | `.venv/bin/python -m pytest -q` | **27 passed** |
| Production dependency audit | `frontend/` | `npm audit --omit=dev` | **2 moderate (pre-existing)** |

Backend integration tests need Docker running — they start PostgreSQL via
Testcontainers. They do **not** need LiveKit, S3 or Soniox.

### Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `Could not find a valid Docker environment` | Docker not running | start Docker Desktop |
| `Bind for 0.0.0.0:5434 failed` | port taken | see §3 alternate port |
| `duplicate class` on compile | stray `* 2.java` files in `src/` | move them out of the source tree |
| Frontend tests fail on `matchMedia` | stale `node_modules` | `rm -rf node_modules && npm ci` |

---

## 5. Seed a teacher, student and class

The admin bootstraps only when the database has no admin. These commands were
run and produced the results shown.

```bash
# 1. Admin token
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mcschool.local","password":"ChangeMe123!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 2. Invite a teacher
TINV=$(curl -s -X POST http://localhost:8080/api/v1/teachers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fullName":"Maria Teacher","email":"maria@mcschool.local"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['invitationToken'])")

# 3. Activate the teacher — e-mail is REQUIRED for non-student roles
TT=$(curl -s -X POST http://localhost:8080/api/v1/auth/activate \
  -H 'Content-Type: application/json' \
  -d "{\"invitationToken\":\"$TINV\",\"email\":\"maria@mcschool.local\",\"password\":\"TeacherPass123!\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 4. Create a student (username is auto-provisioned)
curl -s -X POST http://localhost:8080/api/v1/students \
  -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' \
  -d '{"fullName":"Sam Student","email":"sam@mcschool.local"}'
```

**Verified output of step 4:** `student created: Sam Student | username: Sam839`

Activate the student (no e-mail needed for students):

```bash
SINV=$(curl -s http://localhost:8080/api/v1/students -H "Authorization: Bearer $TT" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['invitationToken'])")
ST=$(curl -s -X POST http://localhost:8080/api/v1/auth/activate \
  -H 'Content-Type: application/json' \
  -d "{\"invitationToken\":\"$SINV\",\"password\":\"StudentPass123!\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
```

**A scheduled lesson requires Google Calendar**, which is a pre-existing
integration. Without it, `POST /online-classes/calendar/{eventId}` returns
404 `Lesson not found` — see §6.

---

## 6. Verify without any provider credentials

These were all executed and produced exactly this output.

```bash
# Feature OFF → the endpoint does not exist for anyone
curl -s http://localhost:8080/api/v1/online-classes/upcoming -H "Authorization: Bearer $TT"
```
**→ 404** `{"errorCode":"NOT_FOUND","message":"Online classes are not enabled"}`

```bash
# Feature ON but unconfigured → works, simply empty
curl -s -w " -> %{http_code}\n" http://localhost:8080/api/v1/online-classes/upcoming \
  -H "Authorization: Bearer $TT"
```
**→** `[] -> 200`

```bash
# A teacher cannot materialize a lesson they do not own
curl -s -X POST http://localhost:8080/api/v1/online-classes/calendar/not-my-event \
  -H "Authorization: Bearer $TT"
```
**→ 404** `Lesson not found` — no distinction between "not yours" and "missing".

```bash
# Role gate: an admin is neither teacher nor student here
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/v1/online-classes/upcoming \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
**→ 403**

```bash
# Webhook without a signature
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:8080/api/v1/online-classes/webhooks/livekit \
  -H 'Content-Type: application/json' -d '{"event":"room_started"}'
```
**→ 401**

```bash
# Internal transcript ingestion without the worker token
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:8080/api/v1/internal/online-classes/11111111-1111-1111-1111-111111111111/transcript-segments" \
  -H 'Content-Type: application/json' \
  -d '{"providerSegmentId":"s","startMs":0,"endMs":1,"text":"x"}'
```
**→ 401**

### Deterministic fakes vs. a real provider

The automated suites replace `LiveClassMediaProvider`,
`ClassRecordingProvider`, `ClassArtifactStorage` and
`ClassTranscriptionProvider` with test doubles. This proves **our** logic —
authorization, idempotency, state machines, webhook signature verification — but
it does **not** prove LiveKit accepts our calls. Only §8 does that.

Webhook signatures are the exception: tests sign payloads with the same HMAC
scheme LiveKit uses, so verification is exercised for real.

---

## 7. Two-browser manual test — NOT EXECUTED

Requires LiveKit credentials, which do not exist here. Nothing below has been
run; treat it as the script to follow.

1. Set `ONLINE_CLASSES_ENABLED=true` plus the three `LIVEKIT_*` variables and
   restart the backend.
2. Create a Google Calendar lesson bound to the student (existing lesson flow).
3. **Window A (normal):** log in as `maria@mcschool.local` / `TeacherPass123!`.
4. **Window B (incognito or a second browser):** log in as the student.

> Camera and microphone require a **secure context**. `http://localhost` is
> treated as secure; any other host must be HTTPS or the browser will not offer
> `getUserMedia` at all.

### Step-by-step checks

| # | Action | Expected |
|---|---|---|
| 1 | Teacher opens the lesson detail page | **Start online class** is primary; *Open Google Meet fallback* is secondary |
| 2 | Teacher clicks Start | prejoin appears: camera preview, device pickers |
| 3 | Deny camera permission, then click Retry | explicit "permission denied" message, not a silent failure |
| 4 | Teacher joins | room opens, status announces `connected` |
| 5 | Student opens `/online-classes`, clicks the class | prejoin, then **"waiting for the teacher"** |
| 6 | Student refreshes | still waiting — the state survives reload |
| 7 | Teacher admits from the waiting-room panel | student enters; two-way audio and video |
| 8 | Both switch camera/mic devices mid-call | stream continues |
| 9 | Teacher shares screen | layout switches to screen focus with a participant filmstrip |
| 10 | Send chat both ways; reload both windows | history persists and does not duplicate |
| 11 | Disable Wi-Fi ~10 s, re-enable | status shows `reconnecting`, then `connected`; chat and board recover |
| 12 | Teacher mutes the student | student's audio stops; student sees the muted state |
| 13 | Teacher clicks "ask to unmute" | student sees a **request** — nothing force-unmutes |
| 14 | Teacher removes the student | student is disconnected and cannot rejoin |
| 15 | Open the whiteboard, draw from both sides | strokes appear on both; undo removes only your own |
| 16 | Teacher clicks Clear all, confirms | board clears for everyone |
| 17 | Student joins late | existing strokes replay in order |
| 18 | Teacher ends the class for everyone | both windows leave; camera lights go out |
| 19 | Reopen the lesson page | attendance shows realistic minutes |

**Two tabs, one identity (step 20):** open the class in two tabs as the same
teacher. Both should connect; the participant list shows **one** entry. Removing
that user disconnects **both** tabs.

---

## 8. Recording, transcription and webhooks — NOT EXECUTED

Requires LiveKit + S3-compatible storage + Soniox.

1. Set `LIVEKIT_RECORDING_ENABLED=true` and the `CLASS_ARTIFACT_STORAGE_*` values.
2. Expose the backend publicly (e.g. `ngrok http 8080`) and set the LiveKit
   project's webhook URL to
   `https://<public-host>/api/v1/online-classes/webhooks/livekit`.
3. In class, teacher starts recording.
   - **Expected:** every participant sees the red recording notice; a late joiner
     must acknowledge it before continuing.
   - Status shows `STARTING`, never "ready".
4. Stop recording. Status becomes `PROCESSING`.
5. When LiveKit posts `egress_ended`, the status becomes `READY`.
   - Confirm in the log: `Recording state reconciled from provider event`.
   - **The recording is only READY via a verified webhook** — there is no path
     that marks it ready locally.
6. Open the lesson page → the recording link is a **short-lived signed URL**
   (default 10 minutes). Confirm it expires.
7. **Failure test:** point `CLASS_ARTIFACT_STORAGE_BUCKET` at a non-existent
   bucket and record. Expect status `FAILED` with a reason, and the class
   continuing normally.
8. **Transcription:** start the agent (§3, Terminal 4), teacher starts
   transcription. Captions appear live; final segments persist. Kill the agent
   mid-class — **the class must keep running** and transcription shows `FAILED`.
9. Export `GET /api/v1/online-classes/{id}/transcript.txt` and `.vtt`.

**Verifying webhook rejection without secrets:** the unsigned-request check in
§6 already proves the endpoint refuses unverified calls. Never paste a real
signing secret into a terminal you do not control.

---

## 9. Mobile and tablet — NOT EXECUTED

No devices available here.

- **iOS Safari (iPad/iPhone):** join as student. Check camera/mic prompt, the
  landscape layout (controls must stay reachable), and that audio continues when
  the screen rotates.
- **Android Chrome:** same, plus the whiteboard with a finger — the page must
  not pan while drawing (`touch-action: none`).
- Confirm touch targets are comfortably tappable (44px minimum is enforced in
  CSS).

---

## 10. Release checklist

| Check | Automated | Needs 2 browsers | Needs real credentials |
|---|---|---|---|
| Backend suite (302) | ✅ | | |
| Frontend suite (122) | ✅ | | |
| Agent suite (27) | ✅ | | |
| Type-check + build | ✅ | | |
| Authorization matrix (44 endpoints) | ✅ | | |
| Webhook signature verification | ✅ | | |
| Retention and deletion retry | ✅ | | |
| Accessibility properties | ✅ | | |
| Audio/video/screen share | | ✅ | ✅ |
| Waiting room, moderation | | ✅ | ✅ |
| Reconnect | | ✅ | ✅ |
| Recording end-to-end | | ✅ | ✅ |
| Captions end-to-end | | ✅ | ✅ |
| Mobile/tablet | | ✅ | ✅ |

---

## 11. Cleanup

Non-destructive:

```bash
# Stop the backend (Ctrl-C in its terminal), then:
cd backend && docker compose stop
```

**DESTRUCTIVE — deletes all local data:**

```bash
cd backend && docker compose down -v      # drops the database volume
rm -rf frontend/node_modules frontend/dist
rm -rf services/transcription-agent/.venv
```

**DESTRUCTIVE — deletes recordings from object storage.** Only against a test
bucket, never production:

```bash
# Retention deletes automatically after CLASS_RECORDING_RETENTION_DAYS (90).
# To force it, set the value to 0 and restart; the nightly sweep is
# app.online-classes.retention.cron (03:30 Europe/Berlin by default).
```

Docker containers started for verification during this work were removed. If you
created `mcschool-pg` from §3:

```bash
docker rm -f mcschool-pg
```
