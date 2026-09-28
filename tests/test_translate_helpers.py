"""Tests for pure helpers in the translation pipeline."""

import json
from pathlib import Path

from scraper import translate
from scraper.translate import (
    _align_by_id,
    _cache_key,
    _make_multilang_from_maps,
    _make_multilang_list_from_maps,
)

# hSD14-005 / hSD14-007 shared effect, and the misaligned translation (really
# hSD17-009's "+20" effect) that was cached for it.
HSD14_SRC = "選擇自己的中心成員。這個回合中，該成員的藝能傷害+10。"
HSD14_BAD_JA = "このターン中、このメンバーのカードのダメージ+20。"
HSD14_GOOD_JA = "自分のセンターホロメンを選ぶ。このターンの間、選んだホロメンのアーツ+10。"


def _client_returning(payload: str, captured: dict | None = None):
    """A fake genai client whose generate_content returns `payload` as text."""

    class _Models:
        def generate_content(self, **kwargs):
            if captured is not None:
                captured.update(kwargs)

            class _R:
                text = payload

            return _R()

    class _Client:
        models = _Models()

    return _Client()


def test_align_by_id_orders_results_by_id():
    results = [{"id": 2, "text": "B"}, {"id": 1, "text": "A"}]
    assert _align_by_id(results, 2) == ["A", "B"]


def test_align_by_id_rejects_split_item_that_keeps_the_count():
    """The failure that shifted card translations: one item split across two
    entries and another dropped — the count still matches, the ids don't."""
    results = [{"id": 1, "text": "A"}, {"id": 2, "text": "B first half"}, {"id": 2, "text": "B second half"}]
    assert _align_by_id(results, 3) is None


def test_align_by_id_rejects_untagged_or_malformed_results():
    assert _align_by_id(["A", "B"], 2) is None  # bare strings prove only the count
    assert _align_by_id([{"id": 1, "text": "A"}], 2) is None
    assert _align_by_id([{"id": 1, "text": "A"}, {"id": 3, "text": "C"}], 2) is None
    assert _align_by_id([{"id": "1", "text": "A"}], 1) is None
    assert _align_by_id([{"id": 1}], 1) is None
    assert _align_by_id({"id": 1, "text": "A"}, 1) is None


def test_translate_batch_requests_id_tagged_schema_and_reorders(monkeypatch):
    captured: dict = {}
    payload = '[{"id": 2, "text": "B"}, {"id": 1, "text": "[1] A"}]'
    monkeypatch.setattr(translate, "_get_client", lambda: _client_returning(payload, captured))

    assert translate._translate_batch_gemini(["甲", "乙"], "ja", "en") == ["A", "B"]
    assert captured["config"].response_schema is translate._BATCH_RESPONSE_SCHEMA


def test_translate_batch_splits_when_ids_do_not_line_up(monkeypatch):
    """A response whose ids don't cover every item is never accepted, even when
    its length matches; the batch is split and retried instead."""
    calls: list[str] = []

    class _Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs["contents"])

            class _R:
                # Two items asked for → a duplicated id; one item → a clean answer.
                text = (
                    '[{"id": 1, "text": "X"}, {"id": 1, "text": "Y"}]'
                    if kwargs["contents"].count("\n[") == 2
                    else '[{"id": 1, "text": "OK"}]'
                )

            return _R()

    class _Client:
        models = _Models()

    monkeypatch.setattr(translate, "_get_client", lambda: _Client())
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "_deadline", None)

    assert translate._translate_batch_gemini(["甲", "乙"], "ja", "en") == ["OK", "OK"]
    assert len(calls) == 3 + 2  # three mismatched tries, then one per half


def test_strip_batch_marker():
    assert translate._strip_batch_marker("可以將…返回手牌。", "[75] Return 1 card.") == "Return 1 card."
    assert translate._strip_batch_marker("可以將…返回手牌。", "Return 1 card.") == "Return 1 card."
    # A source that itself starts with a marker keeps it.
    assert translate._strip_batch_marker("[1] 甲", "[1] A") == "[1] A"


def test_numbers_mismatch_flags_card_effect_with_changed_numbers():
    assert translate._numbers_mismatch("zh-TW", HSD14_SRC, HSD14_BAD_JA) is True
    assert translate._numbers_mismatch("zh-TW", HSD14_SRC, HSD14_GOOD_JA) is False
    assert translate._numbers_mismatch(
        "zh-TW", "給予對手的中心成員30點特殊傷害。", "Deal 20 Special Damage to the opponent's Center Member."
    ) is True


def test_numbers_mismatch_ignores_card_ids_small_counts_and_fullwidth():
    src = "從自己的牌組展示1張hBP07-003並加入手牌。HP+20。"
    assert translate._numbers_mismatch("zh-TW", src, "Reveal a hBP07-003 from your Deck. HP+20.") is False
    assert translate._numbers_mismatch("zh-TW", src, "デッキからBP07-003を公開する。HP＋２０。") is False


def test_numbers_mismatch_only_checks_card_effect_source():
    """Free-text datasets (ja/en sources) paraphrase numbers; never checked."""
    assert translate._numbers_mismatch("ja", "・80点から3枚", "Up to 3 cards") is False
    assert translate._numbers_mismatch("en", "Deal 30 damage", "20ダメージ") is False


def test_is_poisoned_entry_evicts_misaligned_card_effect():
    assert translate._is_poisoned_entry(_cache_key("zh-TW", "ja", HSD14_SRC), HSD14_BAD_JA) is True
    assert translate._is_poisoned_entry(_cache_key("zh-TW", "ja", HSD14_SRC), HSD14_GOOD_JA) is False


def test_load_cache_strips_markers_before_evicting(tmp_path, monkeypatch):
    """An echoed "[43] " marker is stripped, not mistaken for a changed number;
    a misaligned card effect is evicted so the run retranslates it."""
    monkeypatch.setattr(translate, "_cache", {})
    monkeypatch.setattr(translate, "_cache_path", None)
    monkeypatch.setattr(translate, "_cache_dirty", False)

    marked_src = "給予對手的聯動成員40點特殊傷害。"
    cache = {
        _cache_key("zh-TW", "en", marked_src): "[43] Deal 40 Special Damage to the opponent's Collab Member.",
        _cache_key("zh-TW", "ja", HSD14_SRC): HSD14_BAD_JA,
    }
    (tmp_path / "translation_cache.json").write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    translate._load_cache(tmp_path)

    assert translate._cache[_cache_key("zh-TW", "en", marked_src)] == (
        "Deal 40 Special Damage to the opponent's Collab Member."
    )
    assert _cache_key("zh-TW", "ja", HSD14_SRC) not in translate._cache
    assert translate._cache_dirty is True


def test_unique_map_escalates_card_effect_with_changed_numbers(monkeypatch):
    """A card effect whose numbers changed is not cached; the stronger model's
    faithful translation is."""

    def fake_batch(batch, s, t, _no_split=False, model=None):
        return [HSD14_GOOD_JA if model == translate.STRONG_MODEL else HSD14_BAD_JA for _ in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map([HSD14_SRC], "zh-TW", "ja")

    assert mapping[HSD14_SRC] == HSD14_GOOD_JA
    assert translate._cache.get(translate._verified_key("zh-TW", "ja", HSD14_SRC)) == HSD14_GOOD_JA


def _recording_batch(calls: list, result=lambda x: f"{x}-new"):
    def fake_batch(batch, s, t, _no_split=False, model=None):
        calls.append(list(batch))
        return [result(x) for x in batch]

    return fake_batch


def test_refresh_retranslates_pre_id_tag_card_entry_and_rekeys_it(monkeypatch):
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()
    translate._cache[_cache_key("zh-TW", "ja", "甲")] = "old"

    mapping = translate._translate_unique_map(["甲"], "zh-TW", "ja")

    assert mapping == {"甲": "甲-new"}
    assert translate._cache[translate._verified_key("zh-TW", "ja", "甲")] == "甲-new"
    assert _cache_key("zh-TW", "ja", "甲") not in translate._cache


def test_refresh_keeps_old_translation_when_retranslation_fails(monkeypatch):
    """A refresh that fails on every model must not fall back to source text:
    the old translation stays shown and cached for the next run's retry."""
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls, lambda x: None))
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()
    translate._cache[_cache_key("zh-TW", "en", "甲")] = "old"

    mapping = translate._translate_unique_map(["甲"], "zh-TW", "en")

    assert mapping == {"甲": "old"}
    assert translate._cache[_cache_key("zh-TW", "en", "甲")] == "old"
    assert translate._verified_key("zh-TW", "en", "甲") not in translate._cache


def test_refresh_is_capped_and_new_strings_go_first(monkeypatch):
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "MAX_REFRESH_ITEMS", 1)
    translate._cache.clear()
    translate._cache[_cache_key("zh-TW", "ja", "甲")] = "old-甲"
    translate._cache[_cache_key("zh-TW", "ja", "乙")] = "old-乙"

    mapping = translate._translate_unique_map(["甲", "乙", "丙"], "zh-TW", "ja")

    assert calls == [["丙", "甲"]]  # the new string, then one refresh
    assert mapping == {"甲": "甲-new", "乙": "old-乙", "丙": "丙-new"}
    assert translate._cache[translate._verified_key("zh-TW", "ja", "丙")] == "丙-new"


def test_refresh_waits_when_budget_is_low(monkeypatch):
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    monkeypatch.setattr(translate, "_deadline", translate.time.monotonic() + 60)
    translate._cache.clear()
    translate._cache[_cache_key("zh-TW", "ja", "甲")] = "old"

    assert translate._translate_unique_map(["甲"], "zh-TW", "ja") == {"甲": "old"}
    assert calls == []


def test_refresh_redoes_entries_under_an_older_verified_prefix(monkeypatch):
    """Bumping VERIFIED_KEY_PREFIX (a prompt change) makes every older entry
    stale; the retranslation retires all of them."""
    assert translate.VERIFIED_KEY_PREFIX not in translate.STALE_KEY_PREFIXES
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()
    translate._cache["gemini-v2|zh-TW|en|甲"] = "v2 text"
    translate._cache[_cache_key("zh-TW", "en", "甲")] = "legacy text"

    mapping = translate._translate_unique_map(["甲"], "zh-TW", "en")

    assert mapping == {"甲": "甲-new"}
    assert calls == [["甲"]]
    assert translate._cache == {translate._verified_key("zh-TW", "en", "甲"): "甲-new"}


def test_stale_entry_shown_is_the_newest_older_one(monkeypatch):
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    monkeypatch.setattr(translate, "_deadline", translate.time.monotonic() + 60)  # no refresh
    translate._cache.clear()
    translate._cache["gemini-v2|zh-TW|ja|甲"] = "v2 text"
    translate._cache[_cache_key("zh-TW", "ja", "甲")] = "legacy text"

    assert translate._translate_unique_map(["甲"], "zh-TW", "ja") == {"甲": "v2 text"}
    assert calls == []


def test_refresh_skips_verified_entries_and_other_pairs(monkeypatch):
    calls: list = []
    monkeypatch.setattr(translate, "_translate_batch_gemini", _recording_batch(calls))
    translate._cache.clear()
    translate._cache[translate._verified_key("zh-TW", "ja", "甲")] = "verified"
    translate._cache[_cache_key("zh-TW", "ja", "甲")] = "old"  # superseded
    translate._cache[_cache_key("zh-TW", "fr", "甲")] = "ancien"
    translate._cache[_cache_key("ja", "en", "こんにちは")] = "Hello"

    assert translate._translate_unique_map(["甲"], "zh-TW", "ja") == {"甲": "verified"}
    assert translate._translate_unique_map(["甲"], "zh-TW", "fr") == {"甲": "ancien"}
    assert translate._translate_unique_map(["こんにちは"], "ja", "en") == {"こんにちは": "Hello"}
    assert calls == []


REPO_ROOT = Path(__file__).resolve().parents[1]
# Non-language keys allowed in an override entry.
OVERRIDE_NOTE_KEYS = {"cards"}


def test_load_overrides_flattens_file_and_ignores_notes(tmp_path, monkeypatch):
    monkeypatch.setattr(translate, "_overrides", {})
    overrides = {
        "zh-TW": {
            HSD14_SRC: {"cards": ["hSD14-005"], "ja": HSD14_GOOD_JA, "en": "", "jp": "typo", "zh-TW": "same"},
        },
        "xx": {"甲": {"en": "A"}},
    }
    (tmp_path / "translation_overrides.json").write_text(json.dumps(overrides, ensure_ascii=False), encoding="utf-8")

    translate._load_overrides(tmp_path)

    assert translate._overrides == {_cache_key("zh-TW", "ja", HSD14_SRC): HSD14_GOOD_JA}


def test_load_overrides_without_file(tmp_path, monkeypatch):
    monkeypatch.setattr(translate, "_overrides", {"stale": "x"})
    translate._load_overrides(tmp_path)
    assert translate._overrides == {}


def test_unique_map_prefers_override_over_cache_and_api(monkeypatch):
    """An override wins over a cached translation, costs no API call and is
    never written to the cache."""
    calls: list[list[str]] = []

    def fake_batch(batch, s, t, _no_split=False, model=None):
        calls.append(list(batch))
        return [f"{x}-ja" for x in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "_overrides", {_cache_key("zh-TW", "ja", HSD14_SRC): HSD14_GOOD_JA})
    translate._cache.clear()
    translate._cache[_cache_key("zh-TW", "ja", HSD14_SRC)] = "machine translation"

    mapping = translate._translate_unique_map([HSD14_SRC, "乙"], "zh-TW", "ja")

    assert mapping == {HSD14_SRC: HSD14_GOOD_JA, "乙": "乙-ja"}
    assert calls == [["乙"]]
    assert translate._cache[_cache_key("zh-TW", "ja", HSD14_SRC)] == "machine translation"


def test_translation_overrides_file_is_valid(monkeypatch):
    """The committed overrides must all apply: a typo in the source text or a
    wrong language code would otherwise be ignored without a trace. zh-TW keys
    must be current card effect text, and the "cards" note must be true."""
    data = json.loads((REPO_ROOT / translate.OVERRIDES_FILENAME).read_text(encoding="utf-8"))
    cards = json.loads((REPO_ROOT / "web" / "data" / "cards.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(translate, "_known_tags", [])
    translate._load_known_tags(REPO_ROOT / "web" / "data")

    owners: dict[str, set[str]] = {}

    def collect(card_id, obj):
        if isinstance(obj, dict):
            if isinstance(obj.get("zh-TW"), str):
                owners.setdefault(obj["zh-TW"], set()).add(card_id)
            for v in obj.values():
                collect(card_id, v)
        elif isinstance(obj, list):
            for v in obj:
                collect(card_id, v)

    for card in cards:
        collect(card.get("id"), card)

    for source, entries in data.items():
        assert source in translate.LANG_NAMES, source
        for text, targets in entries.items():
            langs = set(targets) - OVERRIDE_NOTE_KEYS
            assert langs, text
            assert langs <= set(translate.LANG_NAMES) - {source}, (text, langs)
            for lang in langs:
                value = targets[lang]
                assert isinstance(value, str) and value.strip(), (text, lang)
                assert not translate._numbers_mismatch(source, text, value), (text, lang)
                assert not translate._looks_untranslated(value, lang), (text, lang)
            if source == "zh-TW":
                assert text in owners, f"not a current card effect: {text}"
                assert set(targets.get("cards", [])) <= owners[text], (text, targets.get("cards"))


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


def test_looks_untranslated_ignores_no_inside_kana_names():
    """の inside a kana name (ときのそら = Tokino Sora) is not grammar — a correct
    Chinese translation keeping the name must not be rejected. Grammatical の
    (after a noun/kanji) still counts."""
    assert translate._looks_untranslated("將ときのそら培養為副攻手。", "zh-TW") is False
    assert translate._looks_untranslated("ジジ一人の効果を使用。", "zh-TW") is True


def test_looks_untranslated_ignores_known_card_tags(monkeypatch):
    """A card tag kept verbatim (#ラミィのお酒, whose の is not grammar) must not
    read as leftover Japanese — it kept every es translation of the Lamy cards
    from being cached. Japanese around the tag is still caught."""
    monkeypatch.setattr(translate, "_known_tags", ["#ラミィのお酒", "#きのこ"])
    es = "Muestra 1 carta de Soporte con #ラミィのお酒 de tu Mazo y agrégala a tu mano."
    assert translate._looks_untranslated(es, "es") is False
    assert translate._looks_untranslated("展示1張標示#ラミィのお酒的支援卡。", "zh-TW") is False
    assert translate._looks_untranslated("#きのこを持つイベントを公開する。", "en") is True


def test_looks_untranslated_without_known_tags_still_flags_tag_no(monkeypatch):
    monkeypatch.setattr(translate, "_known_tags", [])
    es = "Muestra 1 carta de Soporte con #ラミィのお酒 de tu Mazo."
    assert translate._looks_untranslated(es, "es") is True


def test_load_known_tags_reads_card_tag_field(tmp_path, monkeypatch):
    monkeypatch.setattr(translate, "_known_tags", [])
    cards = [
        {"id": "a", "tag": "#JP / #1期生 / #ゲーマーズ"},
        {"id": "b", "tag": "#ラミィのお酒"},
        {"id": "c", "tag": None},
        {"id": "d"},
    ]
    (tmp_path / "cards.json").write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")

    translate._load_known_tags(tmp_path)

    assert set(translate._known_tags) == {"#JP", "#1期生", "#ゲーマーズ", "#ラミィのお酒"}
    assert len(translate._known_tags[0]) >= len(translate._known_tags[-1])  # longest first


def test_load_known_tags_without_cards_file(tmp_path, monkeypatch):
    monkeypatch.setattr(translate, "_known_tags", ["#stale"])
    translate._load_known_tags(tmp_path)
    assert translate._known_tags == []


def test_looks_untranslated_ignores_names_in_latin_quotes():
    """en/fr/es keep names in Latin quotes, where 「」 stripping doesn't reach;
    the の in 石の斧 or より in 博衣こより is not grammar."""
    assert translate._looks_untranslated('Reveal 1 "石の斧" from your Deck.', "en") is False
    assert translate._looks_untranslated("All your “博衣こより” get Arts +30.", "en") is False
    assert translate._looks_untranslated("Révélez 1 « 石の斧 » de votre Deck.", "fr") is False
    # Japanese prose outside the quotes is still caught.
    assert translate._looks_untranslated('"石の斧"を手札に加える。', "en") is True
    # Chinese output: a quoted space-free run can be a whole untranslated clause.
    assert translate._looks_untranslated('使用"相手のホロメンをアーカイブする"效果。', "zh-TW") is True


def test_looks_untranslated_flags_garbled_exotic_scripts():
    """A hallucinated name in an exotic script (Gujarati/Hebrew/Arabic/Thai)
    never occurs in valid output — treat it as garbled so it's rejected+retried."""
    assert translate._looks_untranslated("前期請使用「風真 આઈરા哈」佈局。", "zh-TW") is True
    assert translate._looks_untranslated("前期請使用「風真いろは」佈局。", "zh-TW") is False


def test_is_poisoned_entry_evicts_garbled_names():
    src = "Set up [風真いろは] early."
    garbled = "前期請使用〈風真 આઈરા哈〉佈局。"
    assert translate._is_poisoned_entry(translate._cache_key("en", "zh-TW", src), garbled) is True


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
    captured: dict = {}
    monkeypatch.setattr(
        translate, "_get_client", lambda: _client_returning('[{"id": 1, "text": "X"}]', captured)
    )
    assert translate._translate_batch_gemini(["甲"], "ja", "en", model="gemini-2.5-flash") == ["X"]
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


def test_unique_map_escalates_to_strongest_model_when_flash_fails(monkeypatch):
    """Items even the strong model echoes back are retried on the strongest
    model before being left for next run."""
    bad = "・相手のホロメンをアーカイブするように動かす。"
    good = "・讓對手的成員進入存檔區。"

    def fake_batch(batch, s, t, _no_split=False, model=None):
        # Only the top-tier model manages to translate it.
        return [good if model == translate.STRONGEST_MODEL else bad for _ in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["甲"], "ja", "zh-TW")

    assert mapping["甲"] == good
    assert translate._cache.get(_cache_key("ja", "zh-TW", "甲")) == good


def test_unique_map_stops_calling_api_when_budget_exhausted(monkeypatch):
    """Once the time budget is gone, remaining strings fall back to source text
    (uncached) without any further API call, so the run finishes instead of
    being killed by the job timeout."""
    calls: list[list[str]] = []

    def fake_batch(batch, s, t, _no_split=False, model=None):
        calls.append(list(batch))
        return [f"{x}-en" for x in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "_deadline", translate.time.monotonic() - 1)
    translate._cache.clear()

    mapping = translate._translate_unique_map(["甲", "乙"], "ja", "en")

    assert calls == []
    assert mapping == {"甲": "甲", "乙": "乙"}
    assert _cache_key("ja", "en", "甲") not in translate._cache


def test_unique_map_persists_cache_after_every_batch(monkeypatch):
    """Progress is written to disk per batch, not only per dataset, so a run
    killed mid-file keeps the translations it already paid for."""
    saves: list[bool] = []

    monkeypatch.setattr(translate, "_save_cache", lambda quiet=False: saves.append(quiet))
    monkeypatch.setattr(
        translate,
        "_translate_batch_gemini",
        lambda batch, s, t, _no_split=False, model=None: [f"{x}-en" for x in batch],
    )
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "BATCH_SIZE", 1)
    translate._cache.clear()

    translate._translate_unique_map(["甲", "乙", "丙"], "ja", "en")

    assert saves == [True, True, True]


def test_unique_map_caps_items_sent_to_strongest_model(monkeypatch):
    """Only MAX_STRONGEST_ITEMS reach the slow, rate-limited top tier per pair
    per run; the rest stay uncached for the next run."""
    bad = "・相手のホロメンをアーカイブするように動かす。"
    good = "・讓對手的成員進入存檔區。"
    strongest_batches: list[list[str]] = []

    def fake_batch(batch, s, t, _no_split=False, model=None):
        if model == translate.STRONGEST_MODEL:
            strongest_batches.append(list(batch))
            return [good for _ in batch]
        return [bad for _ in batch]

    monkeypatch.setattr(translate, "_translate_batch_gemini", fake_batch)
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "MAX_STRONGEST_ITEMS", 2)
    translate._cache.clear()

    items = ["甲", "乙", "丙", "丁", "戊"]
    mapping = translate._translate_unique_map(items, "ja", "zh-TW")

    assert sum(len(b) for b in strongest_batches) == 2
    assert sum(1 for x in items if mapping[x] == good) == 2
    for x in items:
        if mapping[x] == good:
            assert translate._cache.get(_cache_key("ja", "zh-TW", x)) == good
        else:
            assert mapping[x] == x
            assert _cache_key("ja", "zh-TW", x) not in translate._cache


def test_translate_batch_gives_up_immediately_when_over_budget(monkeypatch):
    """With the budget exhausted the batch call makes no request and never
    sleeps, so the retry/split ladder cannot stall a run past the job timeout."""
    class _Client:
        class models:
            @staticmethod
            def generate_content(**kwargs):
                raise AssertionError("no API call expected once the budget is gone")

    def _no_sleep(*_):
        raise AssertionError("no sleep expected once the budget is gone")

    monkeypatch.setattr(translate, "_get_client", lambda: _Client())
    monkeypatch.setattr(translate.time, "sleep", _no_sleep)
    monkeypatch.setattr(translate, "_deadline", translate.time.monotonic() - 1)

    assert translate._translate_batch_gemini(["甲", "乙"], "ja", "en") == [None, None]


def test_translate_batch_splits_immediately_on_request_timeout(monkeypatch):
    """A 504 / DEADLINE_EXCEEDED is not retried at the same size (each retry
    cost ~2 min in CI); the batch is split and each half is tried once."""
    sizes: list[int] = []

    class _Client:
        class models:
            @staticmethod
            def generate_content(**kwargs):
                sizes.append(kwargs["contents"].count("\n["))
                raise RuntimeError("504 DEADLINE_EXCEEDED. The request timed out")

    monkeypatch.setattr(translate, "_get_client", lambda: _Client())
    monkeypatch.setattr(translate.time, "sleep", lambda *_: None)
    monkeypatch.setattr(translate, "_deadline", None)

    assert translate._translate_batch_gemini(["甲", "乙"], "ja", "en") == [None, None]
    assert sizes == [2, 1, 1]
