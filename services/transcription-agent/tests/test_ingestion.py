"""Ingestion behaviour, exercised with no LiveKit, Soniox or network."""

from __future__ import annotations

import pytest

from agent.ingestion import (
    MAX_ATTEMPTS,
    MAX_TEXT_LENGTH,
    FinalSegment,
    TranscriptIngestionClient,
    segment_id,
)


class RecordingPoster:
    """Captures calls and returns a scripted sequence of statuses."""

    def __init__(self, statuses):
        self._statuses = list(statuses)
        self.calls = []

    async def post(self, url, *, json, headers):
        self.calls.append({"url": url, "json": json, "headers": headers})
        status = self._statuses.pop(0) if self._statuses else 200
        if isinstance(status, Exception):
            raise status
        return status


async def _no_sleep(_seconds):
    return None


def client(statuses):
    poster = RecordingPoster(statuses)
    return (
        TranscriptIngestionClient(
            "http://backend:8080/api/v1", "internal-token", poster, sleep=_no_sleep
        ),
        poster,
    )


def segment(**overrides):
    defaults = dict(
        provider_segment_id="seg-1",
        participant_identity="11111111-1111-1111-1111-111111111111|tab-1",
        speaker_label="Student",
        language="de",
        start_ms=0,
        end_ms=1500,
        text="Guten Tag",
        confidence=0.94,
    )
    defaults.update(overrides)
    return FinalSegment(**defaults)


@pytest.mark.asyncio
async def test_posts_to_the_internal_endpoint_with_the_internal_token():
    ingestion, poster = client([200])

    assert await ingestion.submit("class-1", segment()) is True

    call = poster.calls[0]
    assert call["url"].endswith("/internal/online-classes/class-1/transcript-segments")
    # The worker acts for no user: it must never present a bearer JWT.
    assert call["headers"] == {"X-Internal-Token": "internal-token"}
    assert "Authorization" not in call["headers"]


@pytest.mark.asyncio
async def test_retries_a_transient_failure_then_succeeds():
    ingestion, poster = client([503, 500, 200])

    assert await ingestion.submit("class-1", segment()) is True
    assert len(poster.calls) == 3


@pytest.mark.asyncio
async def test_retries_a_transport_error():
    ingestion, poster = client([ConnectionError("boom"), 200])

    assert await ingestion.submit("class-1", segment()) is True
    assert len(poster.calls) == 2


@pytest.mark.asyncio
async def test_a_retry_reuses_the_same_idempotency_key():
    ingestion, poster = client([500, 200])

    await ingestion.submit("class-1", segment())

    # Reusing the key is what stops a retry creating a duplicate row.
    keys = {call["json"]["providerSegmentId"] for call in poster.calls}
    assert keys == {"seg-1"}


@pytest.mark.asyncio
async def test_does_not_retry_a_permanent_rejection():
    ingestion, poster = client([400])

    assert await ingestion.submit("class-1", segment()) is False
    assert len(poster.calls) == 1


@pytest.mark.asyncio
async def test_retries_a_rate_limit_because_it_is_transient():
    ingestion, poster = client([429, 200])

    assert await ingestion.submit("class-1", segment()) is True
    assert len(poster.calls) == 2


@pytest.mark.asyncio
async def test_gives_up_after_a_bounded_number_of_attempts():
    ingestion, poster = client([500] * 10)

    assert await ingestion.submit("class-1", segment()) is False
    assert len(poster.calls) == MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_truncates_overlong_text():
    ingestion, poster = client([200])

    await ingestion.submit("class-1", segment(text="a" * (MAX_TEXT_LENGTH + 500)))

    assert len(poster.calls[0]["json"]["text"]) == MAX_TEXT_LENGTH


@pytest.mark.asyncio
async def test_normalises_an_inverted_time_range():
    ingestion, poster = client([200])

    await ingestion.submit("class-1", segment(start_ms=2000, end_ms=1000))

    payload = poster.calls[0]["json"]
    # The backend rejects end < start; clamping here keeps a bad provider
    # result from being dropped entirely.
    assert payload["startMs"] == 2000
    assert payload["endMs"] == 2000


@pytest.mark.asyncio
async def test_clamps_a_negative_start():
    ingestion, poster = client([200])

    await ingestion.submit("class-1", segment(start_ms=-50, end_ms=100))

    assert poster.calls[0]["json"]["startMs"] == 0


def test_derived_segment_id_is_stable_across_reconnects():
    first = segment_id("mcs-room", "user|tab-1", 0, 1500)
    again = segment_id("mcs-room", "user|tab-1", 0, 1500)

    # Same utterance re-emitted after a reconnect must produce the same key.
    assert first == again
    assert segment_id("mcs-room", "user|tab-1", 0, 1600) != first
    assert segment_id("mcs-room", "other|tab-1", 0, 1500) != first


def test_derived_segment_id_handles_a_missing_identity():
    assert segment_id("mcs-room", None, 0, 100).startswith("mcs-room:unknown:")
