"""Tests for pure helpers in the translation pipeline."""

from scraper.translate import (
    _cache_key,
    _make_multilang_from_maps,
    _make_multilang_list_from_maps,
    _unwrap_result,
)


def test_unwrap_result_passes_strings_through():
    assert _unwrap_result("hello", "en") == "hello"


def test_unwrap_result_extracts_known_dict_keys():
    assert _unwrap_result({"text": "hi"}, "en") == "hi"
    assert _unwrap_result({"en": "hi"}, "en") == "hi"
    assert _unwrap_result({"translation": "hi"}, "en") == "hi"


def test_unwrap_result_falls_back_to_last_string_value():
    assert _unwrap_result({"foo": 1, "bar": "baz"}, "en") == "baz"


def test_cache_key_is_stable_and_distinct():
    a = _cache_key("ja", "en", "こんにちは")
    b = _cache_key("ja", "zh-TW", "こんにちは")
    assert a != b
    assert a == _cache_key("ja", "en", "こんにちは")


def test_make_multilang_from_maps():
    maps = {"en": {"原文": "translated"}, "fr": {}}
    out = _make_multilang_from_maps("原文", "ja", maps)
    assert out == {"ja": "原文", "en": "translated", "fr": "原文"}


def test_make_multilang_list_from_maps():
    maps = {"en": {"甲": "A"}}
    out = _make_multilang_list_from_maps(["甲", "乙"], "ja", maps)
    assert out["ja"] == ["甲", "乙"]
    assert out["en"] == ["A", "乙"]
