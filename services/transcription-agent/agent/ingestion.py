"""Posting final transcript segments back to the MC-School backend.

Kept free of LiveKit and Soniox imports so it can be tested without either.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Protocol

log = logging.getLogger(__name__)

# The backend truncates beyond this; trimming here keeps payloads small.
MAX_TEXT_LENGTH = 5000

# Retries are bounded: transcription must never become a source of unbounded
# load on the backend, and a dropped segment is preferable to a stuck agent.
MAX_ATTEMPTS = 4
INITIAL_BACKOFF_SECONDS = 0.5


@dataclass(frozen=True)
class FinalSegment:
    """One final STT result.

    ``provider_segment_id`` is the ingestion idempotency key. It must be stable
    across a reconnect: if the provider resends a final we already delivered,
    the backend collapses it onto the existing row rather than duplicating it.
    """

    provider_segment_id: str
    participant_identity: str | None
    speaker_label: str | None
    language: str | None
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "providerSegmentId": self.provider_segment_id,
            "participantIdentity": self.participant_identity,
            "speakerLabel": self.speaker_label,
            "language": self.language,
            "startMs": max(0, int(self.start_ms)),
            "endMs": max(int(self.start_ms), int(self.end_ms)),
            "text": self.text[:MAX_TEXT_LENGTH],
            "confidence": self.confidence,
        }


class HttpPoster(Protocol):
    """Minimal seam over the HTTP client so tests need no network."""

    async def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> int:
        ...


def segment_id(room: str, participant_identity: str | None, start_ms: int, end_ms: int) -> str:
    """Builds a stable id when the provider does not supply one.

    Derived only from values that do not change on reconnect, so re-emitting the
    same utterance yields the same key and the backend de-duplicates it.
    """
    identity = participant_identity or "unknown"
    return f"{room}:{identity}:{start_ms}:{end_ms}"


class TranscriptIngestionClient:
    """Posts final segments to the backend's internal endpoint.

    Authenticates with a narrow internal token — never an end-user JWT. The
    token authorizes transcript ingestion and nothing else.
    """

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        poster: HttpPoster,
        *,
        sleep=asyncio.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_token = internal_token
        self._poster = poster
        self._sleep = sleep

    async def submit(self, class_id: str, segment: FinalSegment) -> bool:
        """Delivers one segment, retrying transient failures.

        Returns True when the backend accepted it. A permanent rejection (4xx
        other than 429) is not retried: replaying it would never succeed.
        """
        url = f"{self._base_url}/internal/online-classes/{class_id}/transcript-segments"
        headers = {"X-Internal-Token": self._internal_token}
        backoff = INITIAL_BACKOFF_SECONDS

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                status = await self._poster.post(url, json=segment.to_payload(), headers=headers)
            except Exception:  # noqa: BLE001 - any transport error is retryable
                status = None

            if status is not None and 200 <= status < 300:
                return True

            if status is not None and 400 <= status < 500 and status != 429:
                # Never log the segment text: transcripts are personal data.
                log.warning(
                    "Transcript segment rejected permanently (status=%s); not retrying", status
                )
                return False

            if attempt < MAX_ATTEMPTS:
                await self._sleep(backoff)
                backoff *= 2

        log.warning("Giving up on a transcript segment after %s attempts", MAX_ATTEMPTS)
        return False
