"""Incremental-cache tests for the Deck Log fetcher."""

import json

from scraper import scrape_decklog as mod

CACHED_DECK = {
    "deck_id": "decklog-AAA11",
    "deck_code": "AAA11",
    "title": "旧タイトル",
    "oshi": "星街すいせい",
    "source": "decklog",
    "event": "旧イベント",
    "event_date": "2026-01-01",
    "placement": "1st",
    "url": "https://decklog-en.bushiroad.com/ja/view/AAA11",
    "oshi_cards": [{"card_id": "hSD01-001", "count": 1}],
    "main_deck": [{"card_id": "hSD01-003", "count": 4}],
    "cheer_deck": [{"card_id": "hY01-001", "count": 20}],
    "main_deck_count": 4,
    "cheer_deck_count": 20,
}

REGISTRY = [
    {
        "code": "AAA11",
        "title": "新タイトル",
        "oshi": "",
        "event": "ショップ大会 2026-07 - どこかの店",
        "event_date": "2026-07-29",
        "placement": "2nd (だれか)",
    },
    {"code": "BBB22", "title": "", "oshi": "AZKi", "event": "新規", "event_date": "2026-07-30", "placement": "1st"},
    {"missing": True, "title": "未公開", "oshi": "", "event": "旧大会", "event_date": "2025-01-01", "placement": ""},
]

RAW_FETCHED = {
    "deck_id": "BBB22",
    "title": "フェッチ結果",
    "p_list": [],
    "list": [{"card_number": "hBP08-001", "num": 4}],
    "sub_list": [],
}


def _run(tmp_path, monkeypatch, with_cache=True):
    codes_path = tmp_path / "deck_codes.json"
    codes_path.write_text(json.dumps(REGISTRY, ensure_ascii=False), encoding="utf-8")
    cache_path = tmp_path / "prev_decklog_decks.json"
    if with_cache:
        cache_path.write_text(json.dumps([CACHED_DECK], ensure_ascii=False), encoding="utf-8")

    fetched_codes = []

    def fake_fetch(code):
        fetched_codes.append(code)
        return RAW_FETCHED

    monkeypatch.setattr(mod, "_fetch_deck", fake_fetch)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)

    results = mod.scrape_decklog(
        codes_path,
        tmp_path / "missing_cards.json",
        tmp_path,
        cache_path=cache_path if with_cache else None,
    )
    return results, fetched_codes


def test_cached_codes_are_not_refetched_and_metadata_is_refreshed(tmp_path, monkeypatch):
    results, fetched_codes = _run(tmp_path, monkeypatch)

    assert fetched_codes == ["BBB22"]
    assert len(results) == 3

    reused = results[0]
    assert reused["deck_code"] == "AAA11"
    # Metadata comes from the registry; empty registry oshi falls back to cache.
    assert reused["title"] == "新タイトル"
    assert reused["oshi"] == "星街すいせい"
    assert reused["event"] == "ショップ大会 2026-07 - どこかの店"
    assert reused["event_date"] == "2026-07-29"
    assert reused["placement"] == "2nd (だれか)"
    # The card list itself is untouched cache content.
    assert reused["main_deck"] == CACHED_DECK["main_deck"]

    fetched = results[1]
    assert fetched["deck_code"] == "BBB22"
    assert fetched["title"] == "フェッチ結果"
    assert fetched["main_deck_count"] == 4

    assert results[2]["missing"] is True


def test_without_cache_every_code_is_fetched(tmp_path, monkeypatch):
    _, fetched_codes = _run(tmp_path, monkeypatch, with_cache=False)

    assert fetched_codes == ["AAA11", "BBB22"]
