"""Parsing tests for official event-report deck extraction."""

import json

from scraper import scrape_event_reports as mod

REPORT_HTML = """
<html><body><article>
<h1>激闘の福岡！『ワールドグランプリ25-26 福岡会場』イベントレポート</h1>
<p>2026年5月10日(日)、北九州メッセにて開催した大会本戦の様子をお届けします。</p>
<h2>目次</h2>
<h4>上位入賞者＆使用デッキ</h4>
<h2>栄光の優勝デッキレシピ公開！</h2>
<h3>個人戦</h3>
<h4>Aブロック優勝</h4>
<p>たろう 選手</p>
<a href="https://decklog.bushiroad.com/view/AAA11">https://decklog.bushiroad.com/view/AAA11</a>
<h3>トリオバトル</h3>
<h4>Bブロック優勝：チーム「 チームX 」</h4>
<p>※諸事情により写真の掲載はございません。 いち 選手、に 選手、さん 選手</p>
<a href="https://decklog.bushiroad.com/view/BBB22">x</a>
<a href="https://decklog.bushiroad.com/view/CCC33">x</a>
<a href="https://decklog.bushiroad.com/view/DDD44">x</a>
<h2>次の対戦はすぐそこ！</h2>
<p>2026年6月27日(土)／サンシャインシティ</p>
<a href="https://decklog.bushiroad.com/view/ZZZ99">not a result</a>
</article></body></html>
"""

LIST_HTML = """
<a href="https://hololive-official-cardgame.com/news/post/56/">report</a>
<a href="/news/post/56/">same report again</a>
<a href="/news/post/57/">another report</a>
<a href="/products/">not a post</a>
"""


def test_event_base_matches_the_curated_wgp_names():
    assert mod._event_base("激闘の福岡！『ワールドグランプリ25-26 福岡会場』イベントレポート") == "WGP25-26 Fukuoka"
    assert mod._event_base("『ホロカフェス2026』イベントレポート") == "ホロカフェス2026"


def test_parse_report_extracts_winners_in_registry_shape():
    entries = mod.parse_report(REPORT_HTML, "https://example.test/news/post/56/")

    assert [e["code"] for e in entries] == ["AAA11", "BBB22", "CCC33", "DDD44"]
    solo, trio = entries[0], entries[1]
    assert solo["event"] == "WGP25-26 Fukuoka - 個人戦 - A Block"
    assert solo["placement"] == "1st A Block (たろう)"
    assert solo["event_date"] == "2026-05-10"
    assert trio["event"] == "WGP25-26 Fukuoka - トリオバトル - B Block"
    assert trio["placement"] == "Trio 1st B Block (チームX)"
    assert all(e["oshi"] == "" and e["report_url"].endswith("/56/") for e in entries)


def test_parse_report_ignores_links_outside_a_result_heading():
    """The ZZZ99 link sits under the next-event h2, not a winner heading."""
    assert "ZZZ99" not in [e["code"] for e in mod.parse_report(REPORT_HTML)]


def test_scrape_appends_only_codes_the_registry_lacks(tmp_path, monkeypatch):
    deck_codes_path = tmp_path / "deck_codes.json"
    deck_codes_path.write_text(json.dumps([{"code": "aaa11", "event": "curated"}]), encoding="utf-8")
    fetched = []

    def fake_get(client, url):
        fetched.append(url)
        return LIST_HTML if url == mod.EVENT_LIST_URL else REPORT_HTML

    monkeypatch.setattr(mod, "_safe_get", fake_get)
    monkeypatch.setattr(mod.time, "sleep", lambda s: None)

    mod.scrape_event_reports(deck_codes_path, tmp_path)

    registry = json.loads(deck_codes_path.read_text(encoding="utf-8"))
    # AAA11 was already curated (other case); both posts repeat the same codes.
    assert [e["code"] for e in registry] == ["aaa11", "BBB22", "CCC33", "DDD44"]
    assert registry[0] == {"code": "aaa11", "event": "curated"}
    assert fetched.count("https://hololive-official-cardgame.com/news/post/56/") == 1
    assert (tmp_path / "event_report_decks.json").exists()


def test_scrape_skips_when_the_list_is_unreachable(tmp_path, monkeypatch):
    deck_codes_path = tmp_path / "deck_codes.json"
    monkeypatch.setattr(mod, "_safe_get", lambda client, url: None)

    assert mod.scrape_event_reports(deck_codes_path, tmp_path) == []
    assert not deck_codes_path.exists()
