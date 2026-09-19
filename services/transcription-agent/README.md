# Transcription agent

A **separate service** from the MC-School backend. It joins a LiveKit room only
when a teacher starts transcription, streams audio to Soniox, and posts final
segments back to the backend.

It is deliberately isolated:

- its own dependencies and lockfile — nothing here is on the backend's classpath;
- its own container and health check;
- `SONIOX_API_KEY` lives **only here**. It never reaches the backend, and never
  reaches a browser;
- it authenticates to the backend with a narrow internal token that authorizes
  transcript ingestion and nothing else — never an end-user JWT.

## How it is triggered

The agent registers with LiveKit under `LIVEKIT_AGENT_NAME` and then idles. The
backend issues an **explicit dispatch** when a teacher starts transcription, so
no agent sits in a room that is not being transcribed. Dispatch metadata carries
the `classId` and language hints.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `LIVEKIT_URL` | yes | `wss://…` project URL |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | agent registration |
| `LIVEKIT_AGENT_NAME` | yes | must match `ONLINE_CLASS_TRANSCRIPTION_AGENT` in the backend |
| `SONIOX_API_KEY` | yes | STT provider credential — this service only |
| `MCSCHOOL_API_BASE_URL` | yes | e.g. `http://backend:8080/api/v1` |
| `TRANSCRIPTION_INTERNAL_TOKEN` | yes | must match the backend value |
| `TRANSCRIPTION_LANGUAGES` | no | default hints, e.g. `ru,de` |
| `HEALTH_PORT` | no | health endpoint port, default 8090 |

## Running

```bash
pip install -r requirements.txt
python -m agent.main
```

Health: `GET http://localhost:8090/healthz` → `{"status":"ok"}`.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

The tests cover segment batching, idempotency-key stability and the retry/backoff
behaviour **without** contacting LiveKit or Soniox.

## Failure behaviour

If Soniox or the agent dies, the class keeps running. The backend marks
transcription `FAILED` and the room is unaffected — media never depends on this
service.
