"""Parsing and incremental-state tests for the hOCG Logs tournament scraper."""

import json
from datetime import date

from scraper import scrape_hocg_logs as mod
from scraper.scrape_hocg_logs import (
    _build_deck_entries,
    _format_event,
    _ordinal,
    _parse_detail_page,
    _parse_list_page,
)

LIST_HTML = """
<table class="w-full text-sm"><thead><tr><th>日付</th><th>イベント</th><th>主催者</th>
<th>場所</th><th>参加者</th><th>入賞数</th></tr></thead><tbody>
<tr><td><time dateTime="2026-07-29T08:00:00+00:00">2026/07/29</time></td>
<td><a href="/tournaments/1641427">フルコンプ仙台駅前店 ホロカセレクションカップ</a></td>
<td>フルコンプ仙台駅前店</td><td>仙台市青葉区中央2-1-27</td>
<td class="text-right">20</td><td class="text-right">8</td></tr>
<tr><td><time dateTime="2026-06-20T04:00:00+00:00">2026/06/20</time></td>
<td><a href="/tournaments/1500000">六月の古い大会</a></td>
<td>どこかの店</td><td>どこか</td>
<td class="text-right">10</td><td class="text-right">4</td></tr>
</tbody></table>
"""

DETAIL_HTML = """
<table><tbody>
<tr><td>1位</td><td><a href="/player/BWRHO">おぐ</a></td>
<td><a href="/oshi/FUWAMOCO">FUWAMOCO</a></td>
<td><a class="text-xs" href="/decks/4DEUK">セレクションフワモコ</a></td></tr>
<tr><td>2位</td><td><a href="/player/AAAAA">とんにぃ</a></td>
<td><a href="/oshi/AZKi">AZKi</a></td>
<td><a class="text-xs" href="/decks/5Q31K">セレクションあずきPart2</a></td></tr>
</tbody></table>
"""


def test_ordinal():
    assert [_ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21)] == [
        "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st",
    ]


def test_parse_list_page():
    rows = _parse_list_page(LIST_HTML)
    assert len(rows) == 2
    first = rows[0]
    assert first["id"] == "1641427"
    assert first["date"] == "2026-07-29"
    assert first["name"] == "フルコンプ仙台駅前店 ホロカセレクションカップ"
    assert first["organizer"] == "フルコンプ仙台駅前店"
    assert first["venue"] == "仙台市青葉区中央2-1-27"
    assert first["participants"] == 20
    assert rows[1]["date"] == "2026-06-20"


def test_parse_detail_page():
    entries = _parse_detail_page(DETAIL_HTML)
    assert len(entries) == 2
    assert entries[0] == {
        "rank": 1,
        "player": "おぐ",
        "oshi": "FUWAMOCO",
        "code": "4DEUK",
        "title": "セレクションフワモコ",
    }
    assert entries[1]["code"] == "5Q31K"


def test_match_official_series_labels_extremer_qualifiers():
    from scraper.scrape_hocg_logs import _match_official_series

    # Known stop: official organizer + matching date + venue hint.
    assert _match_official_series(
        "in 池袋・サンシャインシティ 展示ホールD",
        "hololive OFFICIAL CARD GAME公式",
        "豊島区東池袋…",
        "2026-06-27",
    ) == (
        "エクストリーマーカップ25-26 エリア予選 - 関東"
        " / in 池袋・サンシャインシティ 展示ホールD"
    )
    # Non-official organizer on the same date/venue → not the series.
    assert _match_official_series(
        "セレクションカップ", "カードラボ池袋店", "豊島区…", "2026-06-27"
    ) is None
    # Official organizer but a date outside the schedule → not the series.
    assert _match_official_series(
        "in 池袋・サンシャインシティ 展示ホールD",
        "hololive OFFICIAL CARD GAME公式",
        "豊島区…",
        "2026-09-01",
    ) is None


def test_format_event_appends_organizer_only_for_generic_names():
    # Generic name reused by many shops → organizer suffix keeps sub-sections distinct.
    assert _format_event(
        "【ホロカ】セレクションカップ（2026年7月）", "ホビーステーション神戸三宮店", "2026-07-26"
    ) == (
        "ショップ大会 2026-07 - 【ホロカ】セレクションカップ（2026年7月）"
        " / ホビーステーション神戸三宮店"
    )
    # Name already contains the organizer → no redundant suffix.
    assert _format_event(
        "フルコンプ仙台駅前店 ホロカセレクションカップ", "フルコンプ仙台駅前店", "2026-07-29"
    ) == "ショップ大会 2026-07 - フルコンプ仙台駅前店 ホロカセレクションカップ"
    # No organizer known → plain prefixed name.
    assert _format_event("なにかの大会", "", "2026-06-28") == "ショップ大会 2026-06 - なにかの大会"


def test_build_deck_entries_prefixes_event_for_month_grouping():
    row = _parse_list_page(LIST_HTML)[0]
    standings = _parse_detail_page(DETAIL_HTML)
    entries = _build_deck_entries(row, standings)

    assert entries[0]["event"] == (
        "ショップ大会 2026-07 - フルコンプ仙台駅前店 ホロカセレクションカップ"
    )
    assert entries[0]["source"] == "フルコンプ仙台駅前店 ホロカセレクションカップ"
    assert entries[0]["event_date"] == "2026-07-29"
    assert entries[0]["placement"] == "1st (おぐ)"
    assert entries[1]["placement"] == "2nd (とんにぃ)"
    assert entries[0]["hocg_logs_url"].endswith("/tournaments/1641427")


def _run(tmp_path, monkeypatch, *, state=None, registry=None, detail_html=DETAIL_HTML):
    state_path = tmp_path / "hocg_logs_state.json"
    if state is not None:
        state_path.write_text(json.dumps(state), encoding="utf-8")
    deck_codes_path = tmp_path / "deck_codes.json"
    deck_codes_path.write_text(json.dumps(registry or []), encoding="utf-8")

    fetched = []

    def fake_get(client, url):
        fetched.append(url)
        if "?page=1" in url:
            return LIST_HTML
        if "?page=" in url:
            return None
        if "/tournaments/" in url:
            return detail_html
        return None

    monkeypatch.setattr(mod, "_safe_get", fake_get)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)

    entries = mod.scrape_hocg_logs(
        state_path, deck_codes_path, tmp_path, today=date(2026, 7, 31)
    )
    saved_state = (
        json.loads(state_path.read_text(encoding="utf-8"))
        if state_path.exists()
        else {}
    )
    return entries, json.loads(deck_codes_path.read_text(encoding="utf-8")), saved_state, fetched


def test_scrape_appends_new_codes_and_records_state(tmp_path, monkeypatch):
    entries, registry, state, fetched = _run(tmp_path, monkeypatch)

    # The 2026-06-20 tournament predates BACKFILL_START and is never fetched.
    assert not any(u.endswith("/tournaments/1500000") for u in fetched)
    assert [e["code"] for e in registry] == ["4DEUK", "5Q31K"]
    assert state["scraped_tournament_ids"] == ["1641427"]
    assert len(entries) == 2
    assert (tmp_path / "hocg_logs_decks.json").exists()


def test_scrape_skips_already_scraped_tournaments(tmp_path, monkeypatch):
    entries, registry, _, fetched = _run(
        tmp_path, monkeypatch, state={"scraped_tournament_ids": ["1641427"]}
    )

    assert entries == []
    assert registry == []
    assert not any("/tournaments/1641427" in u for u in fetched)


def test_scrape_dedupes_codes_already_in_registry(tmp_path, monkeypatch):
    entries, registry, state, _ = _run(
        tmp_path, monkeypatch, registry=[{"code": "4deuk", "title": "既存"}]
    )

    # Case-insensitive: only the genuinely new code is appended, but the
    # tournament itself still counts as scraped.
    assert [e["code"] for e in registry] == ["4deuk", "5Q31K"]
    assert state["scraped_tournament_ids"] == ["1641427"]
    assert len(entries) == 1


def test_scrape_retries_tournament_with_no_standings(tmp_path, monkeypatch):
    entries, registry, state, _ = _run(
        tmp_path, monkeypatch, detail_html="<table><tbody></tbody></table>"
    )

    assert entries == []
    assert registry == []
    assert state == {}
