# How to Run MC-School Locally

This guide is for project members starting the full application on a development
machine. Run all commands from the repository root unless a section says otherwise.

## What runs locally

| Service | Technology | Local address |
|---|---|---|
| Frontend | React, TypeScript, Vite | http://localhost:5173 |
| Backend API | Java 17, Spring Boot | http://localhost:8080 |
| PostgreSQL | PostgreSQL 16 in Docker | localhost:5434 |

The frontend calls the versioned backend API at
`http://localhost:8080/api/v1`.

## Prerequisites

Install:

- Git
- Java 17 or newer (`java -version`)
- Node.js 20 or newer and npm (`node --version`, `npm --version`)
- Docker Desktop, or Docker Engine with Compose (`docker compose version`)

You do not need to install Maven. The repository includes the Maven wrapper.

## First-time setup

Clone the repository and enter it:

```bash
git clone <repository-url>
cd MC-School
```

Install the frontend dependencies:

```bash
cd frontend
npm ci
cp .env.example .env.local
cd ..
```

`npm ci` is preferred because it installs the exact versions in
`frontend/package-lock.json`.

## Start the application

Use three terminal windows.

### Terminal 1: PostgreSQL

```bash
cd backend
docker compose up -d
docker compose ps
```

The database is persisted in the Docker volume `backend_flashcard-pgdata`.

### Terminal 2: backend

macOS/Linux:

```bash
cd backend
ADMIN_EMAIL=admin@mcschool.local \
ADMIN_PASSWORD='ChangeMe123!' \
ADMIN_NAME='Local Admin' \
./mvnw spring-boot:run
```

Windows PowerShell:

```powershell
cd backend
$env:ADMIN_EMAIL = "admin@mcschool.local"
$env:ADMIN_PASSWORD = "ChangeMe123!"
$env:ADMIN_NAME = "Local Admin"
.\mvnw.cmd spring-boot:run
```

The admin bootstrap runs only when the database has no admin account. On later
starts, log in with the password used the first time.

Wait until the backend reports that it started, then verify it:

```bash
curl http://localhost:8080/actuator/health
```

Expected response:

```json
{"status":"UP"}
```

### Terminal 3: frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 and log in with the bootstrap admin credentials.

## Online classes (optional)

Disabled by default. To try it locally, add to the backend command in Terminal 2:

```bash
ONLINE_CLASSES_ENABLED=true
```

Without LiveKit credentials the app still starts and the class list works — it is
simply empty, and the teacher-facing state says the feature is not configured.
The startup log shows which integrations are inactive:

```
Online classes: media provider unconfigured (enabled=true)
```

For real audio and video add `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` (LiveKit Cloud project). Camera and microphone work on
`http://localhost` because browsers treat localhost as a secure context; any
other host needs HTTPS.

Full instructions, including the two-browser test:
[docs/online-classes/03-testing-instructions.md](docs/online-classes/03-testing-instructions.md).

## Important note about environment files

Spring Boot does not automatically load `backend/.env`. For the default local
database, no database variables are needed because the application defaults match
`backend/compose.yaml`.

If you create `backend/.env`, explicitly load it before starting the backend:

```bash
cd backend
set -a
source .env
set +a
./mvnw spring-boot:run
```

Use local database values that match `compose.yaml`:

```dotenv
DB_HOST=localhost
DB_PORT=5434
DB_NAME=mydb
DB_USERNAME=myuser
DB_PASSWORD=mypassword
ADMIN_EMAIL=admin@mcschool.local
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Local Admin
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
```

Never commit `.env`, `.env.local`, passwords, JWT secrets, or invitation tokens.

## Try the complete user flow

1. Log in as the bootstrap admin.
2. Create a teacher and copy the invitation code shown by the UI.
3. Open http://localhost:5173/activate, paste the code, and set the teacher password.
4. As the teacher, create a student and copy the new invitation code.
5. Activate the student account in the same way.
6. As the teacher, add at least four cards to the student.
7. Log in as the student and start the scheduled session.

Invitation and reminder emails are implemented but off by default locally
(`MAIL_ENABLED=false`), so they are written to the backend log instead of being
sent, and the invitation code is also shown in the UI for convenient local
testing. To send real email, set `MAIL_ENABLED=true` and the `MAIL_*` SMTP
variables (see `backend/.env.example`).

## Run checks

Backend unit and integration tests require Docker:

```bash
cd backend
./mvnw test
```

Run only the fast backend unit tests:

```bash
cd backend
./mvnw test -Dtest='*ServiceTest,*SchedulerTest,*ParserTest,*GeneratorTest'
```

Build and type-check the frontend:

```bash
cd frontend
npm run build
```

Preview the production frontend bundle:

```bash
cd frontend
npm run preview
```

## Stop or reset local services

Stop PostgreSQL but keep its data:

```bash
cd backend
docker compose down
```

Delete the local database and start completely fresh:

```bash
cd backend
docker compose down -v
docker compose up -d
```

The `-v` command permanently deletes the local PostgreSQL volume. Use it only when
you intentionally want to remove all local users, cards, and session history.

## Troubleshooting

### Port 5434 is already in use

Change the host port in `backend/compose.yaml`, for example to `5435`, then start
the backend with `DB_PORT=5435`.

### Port 8080 or 5173 is already in use

Stop the conflicting process. If the frontend port changes, also add its origin to
`CORS_ALLOWED_ORIGINS` when starting the backend.

### Backend cannot connect to PostgreSQL

Check:

```bash
cd backend
docker compose ps
docker compose logs postgres
```

Confirm that any exported `DB_*` variables match `backend/compose.yaml`. A stale
shell variable overrides the application's local defaults.

### Admin login fails

Changing `ADMIN_PASSWORD` does not update an existing admin. Either use the original
password or reset the local database volume if no local data must be kept.

### Tests cannot start a PostgreSQL container

Start Docker and wait until `docker info` succeeds, then rerun `./mvnw test`.

### Browser request is blocked by CORS

The default allowed origins are `http://localhost:3000` and
`http://localhost:5173`. For another frontend origin, start the backend with:

```bash
CORS_ALLOWED_ORIGINS='http://localhost:5173,http://localhost:<other-port>' \
./mvnw spring-boot:run
```

