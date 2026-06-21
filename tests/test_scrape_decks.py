"""Fixture-HTML parsing tests for deck guide scraping helpers."""

from bs4 import BeautifulSoup

import scraper.scrape_decks as sd
from scraper.scrape_decks import (
    _clean_card_name,
    _clean_meta_description,
    _extract_card_entries,
    _extract_strategy,
    _extract_vtuber_from_title,
)

GUIDE_PAGE = """
<html><body>
<table>
  <thead><tr><th>採用カード</th><th>解説</th></tr></thead>
  <tr>
    <td><img src="https://hololive-cardgame.github.io/cards/hBP01-026_RR.png"><strong>星街すいせい</strong></td>
    <td>メインアタッカー。</td>
  </tr>
  <tr>
    <td><img src="https://example.jp/unknown.png"><span>サポートカード</span></td>
    <td>ドロー補助。</td>
  </tr>
  <tr>
    <td><img src="https://hololive-cardgame.github.io/cards/hBP01-026_RR.png"><strong>星街すいせい</strong></td>
    <td>メインアタッカー。</td>
  </tr>
</table>
<h3 class="wp-block-heading">1ターン目の動き</h3>
<p>エールを付けて準備する。</p>
<p>手札を整える。</p>
<h3 class="wp-block-heading">関係ない見出し</h3>
<p>これは無視される。</p>
<h3 class="wp-block-heading">2ターン目の動き</h3>
<p>コラボして攻撃する。</p>
</body></html>
"""


def test_extract_card_entries_dedupes_and_parses_ids():
    soup = BeautifulSoup(GUIDE_PAGE, "lxml")
    entries = _extract_card_entries(soup)
    assert len(entries) == 2  # duplicate row removed
    assert entries[0]["card_id"] == "hBP01-026"
    assert entries[0]["name"] == "星街すいせい"
    assert entries[0]["role"] == "メインアタッカー。"
    assert entries[1]["card_id"] is None


def test_extract_strategy_groups_turn_headings():
    soup = BeautifulSoup(GUIDE_PAGE, "lxml")
    strategy = _extract_strategy(soup)
    assert [s["title"] for s in strategy] == ["1ターン目の動き", "2ターン目の動き"]
    assert strategy[0]["text"] == "エールを付けて準備する。\n手札を整える。"


def test_clean_card_name_dedupes_repeated_tokens():
    assert _clean_card_name("星街すいせい 星街すいせい") == "星街すいせい"


def test_extract_vtuber_from_title():
    assert _extract_vtuber_from_title("【ホロカ】星街すいせいデッキの回し方") == "星街すいせい"
    # Known quirk: names containing a terminator char ("と") truncate early;
    # downstream _resolve_missing_ids recovers via substring matching.
    assert _extract_vtuber_from_title("【ホロカ】赤井はあと単のデッキレシピ") == "赤井はあ"
    assert _extract_vtuber_from_title("ただのタイトル") is None


def test_clean_meta_description_strips_noise():
    desc = "強力なデッキです。 ↓↓ 関連デッキはこちら"
    assert _clean_meta_description(desc) == "強力なデッキです。"


def test_scrape_all_guides_preserves_order_and_skips_cardless(tmp_path, monkeypatch):
    """Concurrent fetching must keep input order and drop card-less guides."""
    urls = [
        "https://www.holocardstrategy.jp/aaa_deck/",
        "https://www.holocardstrategy.jp/bbb_deck/",
        "https://www.holocardstrategy.jp/ccc_deck/",
    ]
    monkeypatch.setattr(sd, "_discover_all_deck_urls", lambda: urls)

    def fake_scrape(url):
        cards = [] if "bbb" in url else [{"name": "x", "card_id": "hBP01-001"}]
        return {"url": url, "title": url, "cards": cards}

    monkeypatch.setattr(sd, "scrape_deck", fake_scrape)

    guides = sd.scrape_all_guides(tmp_path, existing_urls=set(), cards_path=None)

    assert [g["deck_id"] for g in guides] == ["guide-aaa_deck", "guide-ccc_deck"]
    assert all(g["source"] == "holocardstrategy_guide" for g in guides)
