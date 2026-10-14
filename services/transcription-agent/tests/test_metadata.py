from agent.main import parse_dispatch_metadata

FALLBACK = ["ru", "de"]


def test_reads_the_class_id_and_languages():
    class_id, languages = parse_dispatch_metadata(
        '{"classId":"abc","languages":["de"]}', FALLBACK
    )

    assert class_id == "abc"
    assert languages == ["de"]


def test_malformed_metadata_yields_no_class_id():
    # Without a class id the job is a no-op: better than posting segments to a
    # guessed class.
    assert parse_dispatch_metadata("{not json", FALLBACK) == (None, FALLBACK)
    assert parse_dispatch_metadata("[]", FALLBACK) == (None, FALLBACK)
    assert parse_dispatch_metadata(None, FALLBACK) == (None, FALLBACK)
    assert parse_dispatch_metadata("", FALLBACK) == (None, FALLBACK)


def test_falls_back_when_languages_are_missing_or_malformed():
    assert parse_dispatch_metadata('{"classId":"abc"}', FALLBACK)[1] == FALLBACK
    assert parse_dispatch_metadata('{"classId":"abc","languages":"de"}', FALLBACK)[1] == FALLBACK
    assert parse_dispatch_metadata('{"classId":"abc","languages":[1,2]}', FALLBACK)[1] == FALLBACK


def test_a_non_string_class_id_is_rejected():
    assert parse_dispatch_metadata('{"classId":123}', FALLBACK)[0] is None
