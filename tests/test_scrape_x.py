"""Parsing tests for tournament-result tweet extraction."""

from scraper.scrape_x import _expand_text, _parse_decklog_codes, _parse_tournament_info

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
