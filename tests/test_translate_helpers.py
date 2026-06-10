"""Tests for pure helpers in the translation pipeline."""

import json

from scraper import translate
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


def test_translate_batch_returns_none_sentinels_on_give_up(monkeypatch):
    """Exhausted retries must yield None per item — not source text — so callers
    can distinguish 'translation failed' from 'translation happens to equal source'."""

    class _FailingModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("boom")

    class _FailingClient:
        models = _FailingModels()

    monkeypatch.setattr(translate, "_get_client", lambda: _FailingClient())
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)

    assert translate._translate_batch_gemini(["甲", "乙"], "ja", "en") == [None, None]


def test_is_poisoned_entry_heuristics():
    long_ja = "終盤はリーサルを狙って一気に攻め込むプランです。"
    # Verbatim CJK-heavy source cached as its own "translation" = poison.
    assert translate._is_poisoned_entry(_cache_key("ja", "en", long_ja), long_ja) is True
    # Short tokens legitimately survive translation unchanged.
    assert translate._is_poisoned_entry(_cache_key("ja", "en", "AZKi"), "AZKi") is False
    # ASCII-heavy strings (URLs, IDs) are not CJK prose.
    url = "https://example.com/some/long/path?query=value"
    assert translate._is_poisoned_entry(_cache_key("ja", "en", url), url) is False
    # A real translation differs from its source.
    assert (
        translate._is_poisoned_entry(_cache_key("ja", "en", long_ja), "Go for lethal late game.")
        is False
    )


def test_load_cache_evicts_poisoned_untranslated_entries(tmp_path, monkeypatch):
    """Give-up fallbacks cached by older code (value == verbatim CJK source)
    must be evicted at load so the run retranslates them; legit identical
    short tokens and real translations stay. Runs at every load because the
    deploy workflow can reseed an old poisoned cache from git history."""
    monkeypatch.setattr(translate, "_cache", {})
    monkeypatch.setattr(translate, "_cache_path", None)
    monkeypatch.setattr(translate, "_cache_dirty", False)

    poisoned = "序盤は手札を整えて、中盤から一気に展開して攻める。"
    cache = {
        _cache_key("ja", "en", poisoned): poisoned,
        _cache_key("ja", "en", "AZKi"): "AZKi",
        _cache_key("ja", "en", "こんにちは"): "Hello",
    }
    (tmp_path / "translation_cache.json").write_text(
        json.dumps(cache, ensure_ascii=False), encoding="utf-8"
    )

    translate._load_cache(tmp_path)

    assert _cache_key("ja", "en", poisoned) not in translate._cache
    assert translate._cache[_cache_key("ja", "en", "AZKi")] == "AZKi"
    assert translate._cache[_cache_key("ja", "en", "こんにちは")] == "Hello"
    assert translate._cache_dirty is True  # eviction persists on next save


def test_unique_map_does_not_cache_failed_items(monkeypatch):
    """A failed item falls back to source text in the mapping but must NOT be
    written to the cache, so the next run retries it instead of serving the
    untranslated source forever."""
    monkeypatch.setattr(
        translate, "_translate_batch_gemini", lambda batch, s, t: ["B-translated", None]
    )
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["乙", "甲"], "ja", "en")

    assert mapping == {"乙": "B-translated", "甲": "甲"}
    assert translate._cache.get(_cache_key("ja", "en", "乙")) == "B-translated"
    assert _cache_key("ja", "en", "甲") not in translate._cache
