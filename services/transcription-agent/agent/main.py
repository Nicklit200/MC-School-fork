"""Entrypoint: registers the agent and transcribes rooms it is dispatched into.

The LiveKit and Soniox wiring lives here; everything worth unit-testing lives in
`ingestion.py`, `config.py` and `health.py`, which import neither.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from agent.config import AgentConfig
from agent.health import build_app, start_health_server
from agent.ingestion import FinalSegment, TranscriptIngestionClient, segment_id

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("transcription-agent")

_state: dict[str, Any] = {"registered": False}


class AiohttpPoster:
    """Thin adapter matching the HttpPoster protocol."""

    def __init__(self, session):
        self._session = session

    async def post(self, url, *, json, headers):
        async with self._session.post(url, json=json, headers=headers) as response:
            return response.status


def parse_dispatch_metadata(raw: str | None, fallback_languages: list[str]) -> tuple[str | None, list[str]]:
    """Reads the classId and language hints the backend sent with the dispatch.

    Malformed metadata yields no class id, which makes the job a no-op rather
    than posting segments to a guessed class.
    """
    if not raw:
        return None, fallback_languages
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("Ignoring malformed dispatch metadata")
        return None, fallback_languages
    if not isinstance(parsed, dict):
        return None, fallback_languages

    class_id = parsed.get("classId")
    languages = parsed.get("languages") or fallback_languages
    if not isinstance(languages, list) or not all(isinstance(code, str) for code in languages):
        languages = fallback_languages
    return (class_id if isinstance(class_id, str) else None), languages


async def _run() -> None:
    config = AgentConfig.from_env()

    runner = await start_health_server(build_app(lambda: dict(_state)), config.health_port)
    log.info("Transcription agent starting as %s", config.agent_name)

    # Imported here so the module can be loaded (and unit-tested) without the
    # LiveKit and Soniox packages installed.
    import aiohttp
    from livekit import agents
    from livekit.agents import AgentSession
    from livekit.plugins import soniox

    async with aiohttp.ClientSession() as session:
        ingestion = TranscriptIngestionClient(
            config.backend_base_url, config.internal_token, AiohttpPoster(session)
        )

        async def entrypoint(ctx: agents.JobContext) -> None:
            class_id, languages = parse_dispatch_metadata(
                getattr(ctx.job, "metadata", None), config.default_languages
            )
            if not class_id:
                log.warning("Dispatch carried no class id; leaving the room")
                return

            await ctx.connect()
            stt = soniox.STT(api_key=config.soniox_api_key, language_hints=languages)
            stt_session = AgentSession(stt=stt)

            @stt_session.on("user_input_transcribed")
            def _on_transcript(event) -> None:
                # Interim results stay in the room; only finals are persisted.
                if not getattr(event, "is_final", False):
                    return
                identity = getattr(event, "speaker_id", None)
                start_ms = int(getattr(event, "start_time", 0.0) * 1000)
                end_ms = int(getattr(event, "end_time", 0.0) * 1000)
                segment = FinalSegment(
                    provider_segment_id=getattr(event, "id", None)
                    or segment_id(ctx.room.name, identity, start_ms, end_ms),
                    participant_identity=identity,
                    speaker_label=getattr(event, "speaker_label", None),
                    language=getattr(event, "language", None),
                    start_ms=start_ms,
                    end_ms=end_ms,
                    text=getattr(event, "transcript", "") or "",
                )
                asyncio.create_task(ingestion.submit(class_id, segment))

            await stt_session.start(room=ctx.room)
            _state["registered"] = True

        try:
            await agents.cli.run_app(
                agents.WorkerOptions(
                    entrypoint_fnc=entrypoint,
                    agent_name=config.agent_name,
                    ws_url=config.livekit_url,
                    api_key=config.livekit_api_key,
                    api_secret=config.livekit_api_secret,
                )
            )
        finally:
            _state["registered"] = False
            await runner.cleanup()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
