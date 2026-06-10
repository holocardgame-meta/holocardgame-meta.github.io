"""Fixture-HTML parsing tests for deck guide scraping helpers."""

from bs4 import BeautifulSoup

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
