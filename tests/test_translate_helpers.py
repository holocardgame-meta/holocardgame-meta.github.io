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
    def _mock(batch, s, t, _no_split=False, model=None):
        # 甲 fails on both the default and the escalation model.
        return ["B-translated" if x == "乙" else None for x in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", _mock)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["乙", "甲"], "ja", "en")

    assert mapping == {"乙": "B-translated", "甲": "甲"}
    assert translate._cache.get(_cache_key("ja", "en", "乙")) == "B-translated"
    assert _cache_key("ja", "en", "甲") not in translate._cache


def test_looks_untranslated_flags_japanese_prose():
    """Japanese grammar in a non-ja target = under-translated (the ja->zh-TW
    shared-Han-script failure mode)."""
    ja_prose = "・コラボ時にジジ一人のアーツを、体力が減っているホロメンも対象にできるように。"
    assert translate._looks_untranslated(ja_prose, "zh-TW") is True
    assert translate._looks_untranslated("hOCGの「IRyS単」のデッキ構築や役割を解説するので", "fr") is True


def test_looks_untranslated_allows_chinese_with_kept_names():
    """A correct zh-TW translation uses Chinese grammar (的/設為/由) and keeps
    VTuber names in kana — it must NOT be flagged just for containing kana."""
    assert translate._looks_untranslated("介紹hOCG「すいせい」的牌組構成及採用卡牌的角色。", "zh-TW") is False
    assert translate._looks_untranslated("將累積4點吶喊的2ndすいせい設為中心，由1stいろは保護。", "zh-TW") is False


def test_looks_untranslated_ignores_english_and_ja_target():
    assert translate._looks_untranslated("Go for lethal in the late game.", "en") is False
    # The Japanese source column itself is never validated.
    assert translate._looks_untranslated("デッキを展開する。", "ja") is False


def test_looks_untranslated_flags_short_template_titles():
    """The common guide-title template is fully Japanese but carries only one
    grammar marker (の) — it must still be caught."""
    assert translate._looks_untranslated("【hOCG】鷹嶺ルイ(紫)のデッキレシピと回し方", "zh-TW") is True
    assert translate._looks_untranslated("【hOCG】IRyS単(tクロニー)のデッキレシピと回し方", "zh-TW") is True


def test_looks_untranslated_ignores_quoted_japanese_card_names():
    """A correct Chinese sentence that quotes a Japanese card name containing の
    (e.g. 「ふつうのパソコン」) must NOT be flagged — the の lives inside the name."""
    assert translate._looks_untranslated("如果有「ふつうのパソコン」，就檢索並進行聯動。", "zh-TW") is False
    assert translate._looks_untranslated("將「星街すいせい」加入手牌。", "zh-TW") is False


def test_is_poisoned_entry_evicts_undertranslated_target():
    """A zh-TW value that still reads as Japanese prose is poison even though it
    differs from the source (so the exact-match check alone misses it)."""
    src = "相手のホロメンをアーカイブする効果。"
    bad_zh = "・相手のホロメンをアーカイブするように動かす。"  # differs from src, still Japanese
    assert translate._is_poisoned_entry(_cache_key("ja", "zh-TW", src), bad_zh) is True
    good_zh = "讓對手的成員進入存檔區的效果。"
    assert translate._is_poisoned_entry(_cache_key("ja", "zh-TW", src), good_zh) is False


def test_unique_map_does_not_cache_undertranslated(monkeypatch):
    """A result that comes back still-Japanese is treated like a failure: shown
    as source fallback, never cached, so it retries next run."""
    bad = "・相手のホロメンをアーカイブするように動かす。"

    def _mock(batch, s, t, _no_split=False, model=None):
        # 乙 stays under-translated even on the escalation model.
        return ["翻譯良好的中文" if x == "甲" else bad for x in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", _mock)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["甲", "乙"], "ja", "zh-TW")

    assert mapping["甲"] == "翻譯良好的中文"
    assert mapping["乙"] == "乙"  # under-translated by both models → fell back to source
    assert translate._cache.get(_cache_key("ja", "zh-TW", "甲")) == "翻譯良好的中文"
    assert _cache_key("ja", "zh-TW", "乙") not in translate._cache


def test_translate_batch_passes_model_through(monkeypatch):
    """The model is selectable so callers can escalate to a stronger one."""
    captured = {}

    class _Models:
        def generate_content(self, **kwargs):
            captured["model"] = kwargs.get("model")

            class _R:
                text = '["X"]'

            return _R()

    class _Client:
        models = _Models()

    monkeypatch.setattr(translate, "_get_client", lambda: _Client())
    translate._translate_batch_gemini(["甲"], "ja", "en", model="gemini-2.5-flash")
    assert captured["model"] == "gemini-2.5-flash"


def test_unique_map_escalates_under_translations_to_strong_model(monkeypatch):
    """When the default model echoes Japanese (ja->zh-TW shared-script failure),
    the rejects are retried on the stronger model and cached if they pass."""
    bad = "・相手のホロメンをアーカイブするように動かす。"  # weak model echoes Japanese
    good = "・讓對手的成員進入存檔區的招式。"  # strong model actually translates

    def fake_batch(batch, s, t, _no_split=False, model=None):
        return [good if model == translate.STRONG_MODEL else bad for _ in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["甲"], "ja", "zh-TW")

    assert mapping["甲"] == good
    assert translate._cache.get(_cache_key("ja", "zh-TW", "甲")) == good
