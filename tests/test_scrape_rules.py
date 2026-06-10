"""Parsing tests for the rules / errata scraper."""

from bs4 import BeautifulSoup

from scraper.scrape_rules import _build_errata_map, _classify_article, _parse_restricted_cards

RULE_PAGE = """
<html><body><article>
<h1>デッキ構築ルール</h1>
<p>制限カード（2026年6月1日より適用）</p>
<table><tr><td>hBP02-076</td><td>hSD01-016</td></tr></table>
<p>2026年5月31日まで適用</p>
<p>過去の制限: hBP01-104 hBP01-105</p>
</article></body></html>
"""


def test_classify_article():
    assert _classify_article("カード裁定変更のお知らせ", "post123") == "errata"
    assert _classify_article("制限カード追加のお知らせ", "post124") == "restricted"
    assert _classify_article("制限カード解除のお知らせ", "post125") == "unrestricted"
    assert _classify_article("ルール更新", "post126") == "rule_update"
    assert _classify_article("anything", "rule01") == "deck_rules"


def test_parse_restricted_cards_takes_current_block_only():
    soup = BeautifulSoup(RULE_PAGE, "lxml")
    ids = _parse_restricted_cards(soup)
    assert ids == ["hBP02-076", "hSD01-016"]


def test_build_errata_map_keeps_first_entry_per_card():
    articles = [
        {"type": "errata", "date": "2026-05-01", "url": "u1", "title": "t1", "card_ids": ["hBP01-001"]},
        {"type": "errata", "date": "2026-04-01", "url": "u2", "title": "t2", "card_ids": ["hBP01-001", "hBP01-002"]},
        {"type": "rule_update", "date": "2026-03-01", "url": "u3", "title": "t3", "card_ids": ["hBP01-003"]},
    ]
    errata = _build_errata_map(articles)
    assert errata["hBP01-001"]["url"] == "u1"
    assert errata["hBP01-002"]["url"] == "u2"
    assert "hBP01-003" not in errata
