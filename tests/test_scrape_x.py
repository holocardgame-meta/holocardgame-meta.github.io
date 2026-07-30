"""Parsing tests for tournament-result tweet extraction."""

import json

from scraper import scrape_x
from scraper.scrape_x import (
    _expand_text,
    _merge_into_deck_codes,
    _parse_decklog_codes,
    _parse_tournament_info,
)

TRIO_TWEET = {
    "text": (
        "【WGP25-26 福岡 トリオバトル】\n"
        "🏆【チームすいせい】🏆\n"
        "Aブロック 優勝\n"
        "先鋒：【たろう】選手\n"
        "推しホロメン：星街すいせい\n"
        "https://t.co/aaa\n"
        "中堅：【じろう】選手\n"
        "推しホロメン：兎田ぺこら\n"
        "https://t.co/bbb\n"
    ),
    "entities": {
        "urls": [
            {"url": "https://t.co/aaa", "expanded_url": "https://decklog.bushiroad.com/view/ABC12"},
            {"url": "https://t.co/bbb", "expanded_url": "https://decklog.bushiroad.com/view/XYZ99"},
        ],
    },
    "created_at": "2026-05-10T03:00:00.000Z",
}


def test_expand_text_replaces_tco_urls():
    text = _expand_text(TRIO_TWEET)
    assert "https://decklog.bushiroad.com/view/ABC12" in text
    assert "t.co/aaa" not in text


def test_parse_decklog_codes():
    codes = _parse_decklog_codes(TRIO_TWEET)
    assert [c["code"] for c in codes] == ["ABC12", "XYZ99"]


def test_parse_tournament_info_extracts_event_team_and_players():
    info = _parse_tournament_info(TRIO_TWEET)
    assert info["event_raw"] == "WGP25-26 福岡 トリオバトル"
    assert info["team"] == "チームすいせい"
    assert info["block"] == "Aブロック"
    assert info["is_trio"] is True

    assert len(info["players"]) == 2
    first = info["players"][0]
    assert first["position"] == "先鋒"
    assert first["player"] == "たろう"
    assert first["oshi"] == "星街すいせい"
    assert first["code"] == "ABC12"
    assert info["players"][1]["code"] == "XYZ99"


def test_merge_into_deck_codes_appends_and_creates(tmp_path):
    path = tmp_path / "deck_codes.json"

    assert _merge_into_deck_codes(path, []) == 0
    assert not path.exists()

    assert _merge_into_deck_codes(path, [{"code": "AAA11"}]) == 1
    assert _merge_into_deck_codes(path, [{"code": "BBB22"}]) == 1
    registry = json.loads(path.read_text(encoding="utf-8"))
    assert [e["code"] for e in registry] == ["AAA11", "BBB22"]


def _run_scrape_x_posts(
    tmp_path, monkeypatch, existing_registry, scraped_ids=None, fetch_tweet=None
):
    """Run scrape_x_posts against TRIO_TWEET with all network calls stubbed."""
    x_posts_path = tmp_path / "x_posts.json"
    x_posts = {
        "account": "hololive_OCG",
        "tournament_posts": ["https://x.com/hololive_OCG/status/111"],
        "usage_rate_posts": [],
    }
    if scraped_ids is not None:
        x_posts["scraped_ids"] = scraped_ids
    x_posts_path.write_text(json.dumps(x_posts), encoding="utf-8")
    deck_codes_path = tmp_path / "deck_codes.json"
    deck_codes_path.write_text(
        json.dumps(existing_registry, ensure_ascii=False), encoding="utf-8"
    )

    monkeypatch.setattr(
        scrape_x,
        "discover_tweets",
        lambda path: json.loads(x_posts_path.read_text(encoding="utf-8")),
    )
    monkeypatch.setattr(scrape_x, "_fetch_tweet", fetch_tweet or (lambda tid: TRIO_TWEET))
    monkeypatch.setattr(scrape_x.time, "sleep", lambda s: None)

    entries = scrape_x.scrape_x_posts(x_posts_path, deck_codes_path, tmp_path)
    return (
        entries,
        json.loads(deck_codes_path.read_text(encoding="utf-8")),
        json.loads(x_posts_path.read_text(encoding="utf-8")),
    )


def test_scrape_x_posts_appends_only_new_codes(tmp_path, monkeypatch):
    entries, registry, x_after = _run_scrape_x_posts(
        tmp_path, monkeypatch, [{"code": "ABC12", "oshi": "星街すいせい"}]
    )

    assert [e["code"] for e in registry] == ["ABC12", "XYZ99"]
    appended = registry[-1]
    assert appended["oshi"] == "兎田ぺこら"
    assert appended["event"] == "WGP25-26 福岡 トリオバトル"
    assert appended["event_date"] == "2026-05-10"
    assert appended["x_url"] == "https://x.com/hololive_OCG/status/111"

    # The staging output still records every parsed entry, known or new.
    assert len(entries) == 2
    assert (tmp_path / "x_decks.json").exists()

    # The tweet is marked ingested so later runs never re-fetch it.
    assert x_after["scraped_ids"] == ["111"]


def test_scrape_x_posts_skips_case_variant_codes(tmp_path, monkeypatch):
    existing = [{"code": "ABC12"}, {"code": "xyz99"}]
    _, registry, _ = _run_scrape_x_posts(tmp_path, monkeypatch, existing)

    assert registry == existing


def test_scrape_x_posts_skips_already_scraped_ids(tmp_path, monkeypatch):
    def explode(tweet_id):
        raise AssertionError("already-scraped tweet must not be fetched")

    entries, registry, x_after = _run_scrape_x_posts(
        tmp_path,
        monkeypatch,
        [{"code": "ABC12"}],
        scraped_ids=["111"],
        fetch_tweet=explode,
    )

    assert entries == []
    assert registry == [{"code": "ABC12"}]
    assert x_after["scraped_ids"] == ["111"]


def test_scrape_x_posts_fetch_failure_is_retried_next_run(tmp_path, monkeypatch):
    entries, registry, x_after = _run_scrape_x_posts(
        tmp_path, monkeypatch, [], fetch_tweet=lambda tweet_id: None
    )

    assert entries == []
    assert registry == []
    assert "scraped_ids" not in x_after


def test_discover_tweets_records_and_skips_ignored_ids(tmp_path, monkeypatch):
    x_posts_path = tmp_path / "x_posts.json"
    x_posts_path.write_text(
        json.dumps({
            "account": "hololive_OCG",
            "tournament_posts": [],
            "usage_rate_posts": [],
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(scrape_x, "_discover_from_official", lambda client: {"999"})
    monkeypatch.setattr(scrape_x, "_discover_from_aggregators", lambda client: set())
    monkeypatch.setattr(scrape_x.time, "sleep", lambda s: None)

    fetched = []

    def fake_fetch(tweet_id):
        fetched.append(tweet_id)
        return {"text": "挨拶だけのポスト", "entities": {"urls": []}}

    monkeypatch.setattr(scrape_x, "_fetch_tweet", fake_fetch)

    result = scrape_x.discover_tweets(x_posts_path)
    assert result["ignored_ids"] == ["999"]
    assert fetched == ["999"]

    # Second run: the ignored ID counts as known and is never re-classified.
    scrape_x.discover_tweets(x_posts_path)
    assert fetched == ["999"]
