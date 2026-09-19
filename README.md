# MC-School — Mindcraft School Flashcard App

A spaced-repetition flashcard platform for an online math school. **Teachers create
individual flashcards for each student**; students answer them as 4-option
multiple-choice questions (1 correct answer + 3 distractors drawn from their other
cards) and the system schedules mandatory reviews after 3 / 7 / 21 days (simplified
SM-2). An **admin** creates teacher accounts. See the project-description PDF (PRD)
for the full requirements.

The repository is a monorepo with a clear split:

```
MC-School/
├── backend/    Spring Boot REST API (Java 17, PostgreSQL, JWT auth)
└── frontend/   React + TypeScript web client (Vite)
```

The backend is a reusable, versioned REST API (`/api/v1`) so it can serve the web
app now and a mobile app later. The frontend is a single React app that renders a
**wide desktop layout for teachers/admins** and a **mobile-first layout for
students** (PRD platform requirements).

For onboarding, use [HOW_TO_RUN.md](HOW_TO_RUN.md). The requirement traceability,
verified implementation status, and prioritized remaining work are documented in
[PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## Online classes (LiveKit)

Teachers can run a lesson inside MC-School instead of Google Meet: audio/video,
screen share, waiting room, host controls, persistent chat, recording, live
captions and a shared whiteboard.

**Disabled by default.** With `ONLINE_CLASSES_ENABLED=false` the existing Google
Meet / Soniox flow is unchanged and no online-class endpoint is reachable.

| Document | Purpose |
|---|---|
| [docs/online-classes/QUICKSTART.md](docs/online-classes/QUICKSTART.md) | **Start here** — test it on your own laptop |
| [docs/online-classes/FOR-TESTERS.md](docs/online-classes/FOR-TESTERS.md) | **hand this to testers** — two laptops, teacher + student |
| [docs/online-classes/03-testing-instructions.md](docs/online-classes/03-testing-instructions.md) | full testing reference (verified command output) |
| [docs/online-classes/02-architecture-and-runbook.md](docs/online-classes/02-architecture-and-runbook.md) | architecture, configuration, operations |
| [docs/online-classes/01-realtime-event-protocol.md](docs/online-classes/01-realtime-event-protocol.md) | data-channel event contract |
| [docs/online-classes/00-current-state-and-plan.md](docs/online-classes/00-current-state-and-plan.md) | implementation log and decisions |

Camera and microphone require a secure context: HTTPS everywhere except
`localhost`.

## What is implemented

**Backend**

- Environment-based config, Flyway migrations, Hibernate schema validation,
  global JSON error handling, actuator health check
- Accounts & auth: roles `ADMIN` / `TEACHER` / `STUDENT`, **no self-registration**
  — admin invites teachers, teachers invite students, invitees activate via a token
  and set a password. Stateless JWT, BCrypt passwords.
- Flashcards: teacher CRUD scoped to their own students, status summary, and
  **text import** with a preview step
- Study: persisted, resumable sessions; distractor generation; wrong-answer
  re-queue within a session; **SM-2 scheduling**; scheduled vs voluntary practice;
  today's tasks; personal card list
- Settings: per-user interface language (DE / RU)
- Notification seam: `NotificationService` with a logging implementation and an
  opt-in daily review-reminder job (no email provider wired yet)
- 57 tests (unit + Testcontainers integration), all green

**Frontend**

- Login and invitation-activation screens
- Admin: create/list teachers
- Teacher (desktop): students list with active-card counts; per-student page with
  card summary, manual card creation, text import with preview, and inline
  edit/delete
- Student (mobile-first): today's tasks, study session (question + 4 options +
  progress bar + immediate feedback), result screen, personal card list, settings
- Full DE / RU internationalization driven by the user's saved language

**Email:** invitation and review-reminder emails are implemented (DE/RU) and sent
via SMTP when `MAIL_ENABLED=true`; otherwise they are logged and the invitation
token is shown in the UI for convenient local testing. See [DEPLOY.md](DEPLOY.md)
to run the whole stack on an always-on server.

**Not yet implemented:** password reset, pagination, OpenAPI docs, automated
frontend tests, pre/post-test (PRD v1.5).

---

## Prerequisites

- **Java 17+** (backend targets 17; Java 21 works) — the Maven wrapper `./mvnw` is included
- **Node 20+** and npm (frontend)
- **Docker** — for local PostgreSQL and for the backend's Testcontainers integration tests

---

## Running the backend

```bash
cd backend

# 1. Start PostgreSQL (published on host port 5434)
docker compose up -d

# 2. Start the API. Set the admin variables once so the first admin is created.
ADMIN_EMAIL=admin@mcschool.local ADMIN_PASSWORD='ChangeMe123!' ./mvnw spring-boot:run
```

Verify it is up:

```bash
curl http://localhost:8080/actuator/health   # {"status":"UP",...}
```

If host port 5434 is taken, publish another port and pass `DB_PORT` to the app, e.g.
`DB_PORT=5435 ADMIN_EMAIL=… ADMIN_PASSWORD=… ./mvnw spring-boot:run`.

### Backend configuration (environment variables)

All have local-dev defaults matching `backend/compose.yaml` (see `backend/.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `localhost` / `5434` / `mydb` | PostgreSQL connection |
| `DB_USERNAME` / `DB_PASSWORD` | `myuser` / `mypassword` | DB credentials (local-dev only) |
| `JWT_SECRET` | dev-only default | HS256 key, min 32 chars — **must be set in production** |
| `JWT_EXPIRATION_MINUTES` | `1440` | Access-token lifetime |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Browser origins allowed to call the API |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | empty | Creates the first admin at startup when set |
| `REVIEW_REMINDERS_ENABLED` | `false` | Enable the daily review-reminder job (logs only for now) |

---

## Running the frontend

```bash
cd frontend
npm install
cp .env.example .env.local          # VITE_API_BASE_URL defaults to http://localhost:8080/api/v1
npm run dev                          # http://localhost:5173
```

The dev server runs on port 5173, which the backend's default CORS config already
allows. `npm run build` produces a production bundle in `frontend/dist/`.

---

## End-to-end quickstart

With both servers running and an admin bootstrapped (see above):

1. Open http://localhost:5173 and **log in as the admin**. Create a teacher — the UI
   shows an invitation link.
2. Open the invitation link (or paste the token on the activation screen), set a
   password → you are logged in as the **teacher**.
3. As the teacher, create a student (invitation link shown), then add at least
   4 cards for that student (manually or via text import).
4. Open the student's invitation link, set a password → logged in as the **student**.
5. On the student's home, start today's session or **practice now**: answer the
   4-option questions; wrong cards come back later in the same session; the result
   screen shows your first-try score and the next review date.

---

## API reference (`/api/v1`)

Every error response has the same shape:

```json
{ "timestamp": "…", "status": 400, "errorCode": "VALIDATION_FAILED",
  "message": "…", "path": "…", "fieldErrors": [{ "field": "email", "message": "…" }] }
```

**Public**

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Log in (email + password) |
| POST | `/auth/activate` | Accept an invitation: set password, get a token |
| GET | `/actuator/health` | Health check |

**Authenticated** (send `Authorization: Bearer <token>`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/auth/me` | any | Current account |
| PUT | `/users/me/settings` | any | Change interface language |
| POST / GET | `/teachers` | ADMIN | Create / list teachers |
| POST / GET | `/students` | TEACHER | Create / list own students |
| POST / GET | `/students/{id}/cards` | TEACHER | Create / list a student's cards |
| GET | `/students/{id}/cards/summary` | TEACHER | Card status counts |
| POST | `/cards/import/preview` | TEACHER | Parse import text (no save) |
| POST | `/students/{id}/cards/import` | TEACHER | Save previewed cards |
| PUT / DELETE | `/cards/{id}` | TEACHER | Edit / delete an owned card |
| GET | `/study/today` | STUDENT | Today's tasks |
| GET | `/study/cards` | STUDENT | Own cards with progress |
| POST | `/study/sessions` | STUDENT | Start a session (`SCHEDULED` or `PRACTICE`) |
| GET | `/study/sessions/{id}` | STUDENT | Session state (resume) |
| GET | `/study/sessions/{id}/current-question` | STUDENT | Current question + options |
| POST | `/study/sessions/{id}/answer` | STUDENT | Submit an answer |
| GET | `/study/sessions/{id}/result` | STUDENT | Result after completion |

Common failures: `401 UNAUTHORIZED` / `INVALID_CREDENTIALS`, `403 ACCESS_DENIED`,
`404 NOT_FOUND`, `409 CONFLICT` / `NOT_ENOUGH_CARDS` / `NO_CARDS_DUE` /
`SESSION_IN_PROGRESS`, `400 VALIDATION_FAILED` / `INVALID_INVITATION`.

### Spaced repetition (SM-2)

After a card is answered correctly in a **scheduled** session its repetition number
advances and its next review is booked: repetition 1 → +3 days, 2 → +7 days,
3 → +21 days. A card is **learned after 3 successful repetitions** and drops out of
mandatory sessions. Mistakes never reset the interval — the card just returns within
the same session. Practice sessions never change the schedule. All of this lives in
`backend/.../study/Sm2Scheduler.java` and is unit-tested, so the rule is easy to adjust.

---

## Testing

```bash
# Backend (Docker required for the integration tests)
cd backend
./mvnw test                                          # everything (57 tests)
./mvnw test -Dtest='*ServiceTest,*SchedulerTest,*ParserTest,*GeneratorTest'   # unit only, no Docker
./mvnw test -Dtest='*IntegrationTest'                # Testcontainers PostgreSQL

# Frontend
cd frontend
npm run build        # type-checks and builds
```

Integration tests spin up a disposable PostgreSQL 16 container via Testcontainers and
run the real Flyway migrations, so they never touch your local database.

---

## Recommended next steps

1. Email integration (SendGrid/Mailgun) for invitation and review-day emails; then
   stop surfacing invitation tokens in the UI
2. Pagination on card/student lists as data grows
3. OpenAPI/Swagger documentation (springdoc)
4. Password reset and Google sign-in (PRD v2.0)
5. Pre/post-test progress measurement (PRD v1.5)
6. Topic folders for cards (PRD v2.0)
