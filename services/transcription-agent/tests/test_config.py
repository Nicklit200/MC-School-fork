import pytest

from agent.config import AgentConfig, ConfigurationError

BASE = {
    "LIVEKIT_URL": "wss://x.livekit.cloud",
    "LIVEKIT_API_KEY": "key",
    "LIVEKIT_API_SECRET": "secret",
    "LIVEKIT_AGENT_NAME": "mc-transcriber",
    "SONIOX_API_KEY": "soniox",
    "MCSCHOOL_API_BASE_URL": "http://backend:8080/api/v1",
    "TRANSCRIPTION_INTERNAL_TOKEN": "internal",
}


def test_reads_a_complete_environment():
    config = AgentConfig.from_env(dict(BASE))

    assert config.agent_name == "mc-transcriber"
    assert config.default_languages == ["ru", "de"]
    assert config.health_port == 8090


@pytest.mark.parametrize("missing", sorted(BASE))
def test_fails_fast_naming_the_missing_variable(missing):
    env = dict(BASE)
    del env[missing]

    with pytest.raises(ConfigurationError) as error:
        AgentConfig.from_env(env)

    assert missing in str(error.value)


def test_blank_is_treated_as_missing():
    env = dict(BASE, SONIOX_API_KEY="   ")

    with pytest.raises(ConfigurationError):
        AgentConfig.from_env(env)


def test_language_hints_are_configurable():
    config = AgentConfig.from_env(dict(BASE, TRANSCRIPTION_LANGUAGES="de, en ,"))

    assert config.default_languages == ["de", "en"]


def test_falls_back_to_product_languages_when_the_list_is_empty():
    config = AgentConfig.from_env(dict(BASE, TRANSCRIPTION_LANGUAGES=" , "))

    assert config.default_languages == ["ru", "de"]
