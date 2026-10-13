# Quickstart — test this on your laptop

Two tracks. Track A needs nothing. Track B needs a free LiveKit account.

---

# Track A — no accounts needed (~10 minutes)

Proves the app builds, all tests pass, and **nothing existing broke**. It does
*not* show video — that's Track B.

## A1. Run the tests

Three commands, three terminals or one after another.

```bash
cd backend && ./mvnw clean test
```
Expect: `Tests run: 302, Failures: 0, Errors: 0` and `BUILD SUCCESS`
*(Docker must be running — the tests start their own PostgreSQL.)*

```bash
cd frontend && npm ci && npm test
```
Expect: `Tests  122 passed (122)`

```bash
cd frontend && npm run build
```
Expect: `✓ built in ~1.5s`

**If these three pass, the feature is internally consistent and the existing app
is unbroken.**

## A2. Start the app

**Terminal 1 — database**
```bash
cd backend && docker compose up -d
```
> If you see `Bind for 0.0.0.0:5434 failed`, something else already uses that
> port (on your machine, `healthu-ui-chrome-postgres-1` does). Use this instead:
> ```bash
> docker run -d --name mcschool-pg -e POSTGRES_USER=myuser \
>   -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb -p 5439:5432 postgres:16-alpine
> ```
> and add `DB_PORT=5439` to the backend command below.

**Terminal 2 — backend**
```bash
cd backend
ADMIN_EMAIL=admin@mcschool.local ADMIN_PASSWORD='ChangeMe123!' \
ONLINE_CLASSES_ENABLED=true ./mvnw spring-boot:run
```
Wait for `Started FlashcardApplication`.

**Terminal 3 — frontend**
```bash
cd frontend && npm run dev
```

> **If the backend fails with `Unable to find a single main class`**, stale
> duplicate `.class` files are in `backend/target`. Run `cd backend && ./mvnw clean`.
> See "A note on duplicated files" at the end.

## A3. Create test users and a class

```bash
./scripts/seed-local.sh
```

Prints:
```
TEACHER   maria@mcschool.local / TeacherPass123!
STUDENT   sam@mcschool.local   / StudentPass123!
ADMIN     admin@mcschool.local / ChangeMe123!
```

## A4. Click through it

Open http://localhost:5173

1. **Log in as the teacher.** Everything that worked before still works —
   students, groups, homework, lessons.
2. **Open a lesson** (`/teacher/lessons`). You should see **Start online class**
   as the main action, with *Open Google Meet fallback* beside it.
3. **Click Start online class.** Without LiveKit credentials it shows a clear
   "not configured" message. **That is the correct result** — it's the fail-safe
   working, not a bug.
4. **Log in as the student** and visit http://localhost:5173/online-classes —
   an empty list, no error.

If all of that holds, Track A is a pass.

---

# Track B — real video (~5 min setup, then real testing)

## B1. Get free LiveKit credentials

1. Go to **https://cloud.livekit.io** and sign up (free tier is enough).
2. Create a project.
3. From **Settings → Keys**, copy three values:
   - Project URL — looks like `wss://something.livekit.cloud`
   - API Key
   - API Secret

## B2. Restart the backend with them

Stop Terminal 2 (Ctrl-C) and start it again:

```bash
cd backend
ADMIN_EMAIL=admin@mcschool.local ADMIN_PASSWORD='ChangeMe123!' \
ONLINE_CLASSES_ENABLED=true \
LIVEKIT_URL='wss://YOUR-PROJECT.livekit.cloud' \
LIVEKIT_API_KEY='YOUR_KEY' \
LIVEKIT_API_SECRET='YOUR_SECRET' \
./mvnw spring-boot:run
```

Confirm in the log:
```
Online classes: LiveKit media provider active
```
If it still says *unconfigured*, one of the three values is missing.

## B3. One laptop, two windows

The seed script already created a class for you (no Google Calendar needed),
because the backend was started with `ONLINE_CLASS_ALLOW_TEST_CLASSES=true`.
Add that variable to the Terminal 2 command:

```bash
ONLINE_CLASS_ALLOW_TEST_CLASSES=true
```

The script prints the class link. Use that, or go through a real Calendar lesson
if Calendar is connected.

1. **Normal window:** teacher → open the class link → allow camera
   and mic → you should see yourself.
2. **Incognito window:** student → `/online-classes` → click the class → allow
   camera/mic → **"waiting for the teacher"**.
3. Back in the teacher window: the student appears in the waiting room → click
   **Admit**.
4. You should now have **two-way audio and video between the two windows**.

> Use headphones or mute one side, or you'll get feedback howl.

---

# Track C — two laptops (for your testers)

Same as Track B, but the student is on a different machine. One extra
requirement:

**The student's laptop must reach your backend over HTTPS, or use localhost.**
Browsers refuse camera/microphone access on a plain `http://192.168.x.x` address.

Easiest option — a tunnel from the laptop running the app:

```bash
ngrok http 5173
```

Give the tester the `https://....ngrok-free.app` URL. Camera and mic will then
be offered normally.

## What the testers should check

Give them this list:

| # | Do this | Should happen |
|---|---|---|
| 1 | Student joins while teacher waits | student sees "waiting for the teacher" |
| 2 | Student reloads the page | still waiting — state survives reload |
| 3 | Teacher admits | both see and hear each other |
| 4 | Both switch camera/mic in settings | video/audio keeps working |
| 5 | Teacher shares screen | student sees the screen, teacher's camera moves to a filmstrip |
| 6 | Both send chat messages | arrive instantly |
| 7 | **Both reload the page** | chat history is still there, not duplicated |
| 8 | Student turns Wi-Fi off ~10s, back on | shows "reconnecting", then recovers by itself |
| 9 | Teacher mutes the student | student's mic goes off, student can see they're muted |
| 10 | Teacher clicks "ask to unmute" | student gets a **request** — is NOT force-unmuted |
| 11 | Teacher opens the whiteboard, both draw | both see both sets of strokes |
| 12 | Each clicks Undo | removes only **their own** last stroke |
| 13 | Teacher clicks "Clear all" | clears for everyone (asks to confirm first) |
| 14 | Student joins late, opens whiteboard | existing drawing appears |
| 15 | Teacher removes the student | student is disconnected, cannot rejoin |
| 16 | Teacher ends class for everyone | both leave; **camera lights go off** |
| 17 | Teacher reopens the lesson page | attendance shows roughly the right minutes |

Anything that fails: note the step number, what happened, and the browser.

---

# Not testable without more setup

| Feature | Also needs |
|---|---|
| **Recording** | S3 / Cloudflare R2 / MinIO bucket, plus a public webhook URL (`ngrok`) so LiveKit can call back |
| **Live captions / transcript** | a Soniox API key and the `services/transcription-agent` container |

Both are off by default and neither affects the class if absent.

---

# Cleanup

```bash
cd backend && docker compose down          # keeps data
cd backend && docker compose down -v       # DESTRUCTIVE: deletes the database
docker rm -f mcschool-pg                   # only if you created it in A2
```

---

# A note on duplicated files

Files whose names end in ` 2` or ` 3` — conflict copies — appear in this working
tree from time to time. Java refuses to compile when two files declare the same
class, and Spring Boot refuses to start when it finds several main classes, so
they break the build.

Observed three times during development: 156 in `backend/src` and
`frontend/src`, later 456 in `backend/target`, later 9 in `frontend/dist`.

**The cause was not identified.** Both OneDrive and iCloud daemons run on this
machine and the naming matches macOS conflict copies, but the duplication could
not be reproduced on demand — writing a file and waiting produced no copy. Treat
it as intermittent.

**When a build fails** with `duplicate class` or
`Unable to find a single main class`:

```bash
./scripts/check-duplicates.sh          # report
./scripts/check-duplicates.sh --fix    # clean
```

Build output is deleted; anything under `src/` is **moved to a quarantine
folder, never deleted**. `.gitignore` also blocks these from ever being
committed.

If it keeps happening, move the project out of `~/Desktop` (or exclude that
folder from whatever syncs it).

The original 156 files were moved to `../quarantined-duplicates-2026-09-18/`
with a manifest — they were byte-identical copies, so nothing was lost.
