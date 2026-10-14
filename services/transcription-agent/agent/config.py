"""Configuration, validated at startup.

Fails fast with a clear message naming the missing variable — this is an
operator-facing service, not a user-facing one, so naming the variable is
helpful rather than a configuration oracle.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class ConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class AgentConfig:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    agent_name: str
    soniox_api_key: str
    backend_base_url: str
    internal_token: str
    default_languages: list[str] = field(default_factory=lambda: ["ru", "de"])
    health_port: int = 8090

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> "AgentConfig":
        source = os.environ if env is None else env

        def required(name: str) -> str:
            value = source.get(name, "").strip()
            if not value:
                raise ConfigurationError(f"{name} is required")
            return value

        languages = [
            code.strip()
            for code in source.get("TRANSCRIPTION_LANGUAGES", "ru,de").split(",")
            if code.strip()
        ]

        return AgentConfig(
            livekit_url=required("LIVEKIT_URL"),
            livekit_api_key=required("LIVEKIT_API_KEY"),
            livekit_api_secret=required("LIVEKIT_API_SECRET"),
            agent_name=required("LIVEKIT_AGENT_NAME"),
            soniox_api_key=required("SONIOX_API_KEY"),
            backend_base_url=required("MCSCHOOL_API_BASE_URL"),
            internal_token=required("TRANSCRIPTION_INTERNAL_TOKEN"),
            default_languages=languages or ["ru", "de"],
            health_port=int(source.get("HEALTH_PORT", "8090")),
        )
