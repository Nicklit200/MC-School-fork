"""Health endpoint.

Deliberately separate from the agent's LiveKit connection: an orchestrator must
be able to tell "the process is up" from "the provider is reachable", and a
transcription outage must never look like a dead container that gets restarted
in a loop.
"""

from __future__ import annotations

import logging
from aiohttp import web

log = logging.getLogger(__name__)


def build_app(readiness) -> web.Application:
    """`readiness` returns a dict describing optional dependencies."""

    async def healthz(_request: web.Request) -> web.Response:
        # Liveness: the process is running. Never reports a provider outage as
        # unhealthy, so an STT failure cannot trigger a restart loop.
        return web.json_response({"status": "ok"})

    async def readyz(_request: web.Request) -> web.Response:
        state = readiness()
        code = 200 if state.get("registered") else 503
        return web.json_response(state, status=code)

    app = web.Application()
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/readyz", readyz)
    return app


async def start_health_server(app: web.Application, port: int) -> web.AppRunner:
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    log.info("Health server listening on %s", port)
    return runner
