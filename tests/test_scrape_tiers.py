"""Fixture-HTML parsing tests for the tier list scraper."""

import scraper.scrape_tiers as st

TIER_PAGE = """
<html><body>
<h1>【ホロカ】2026年5月環境 最強デッキランキング</h1>
<h2 class="wp-block-heading">Tier1</h2>
<h3>星街すいせい</h3>
<h4>すいせい単</h4>
<figure><img src="https://example.jp/suisei.png"></figure>
<figure class="wp-block-table"><table>
  <tr><th>火力</th><th>扱いやすさ</th><th>安定感</th><th>耐久</th><th>圧力</th></tr>
  <tr><td>5</td><td>4</td><td>4</td><td>3</td><td>5</td></tr>
</table></figure>
<figure class="wp-block-table"><table>
  <tr><th>デッキの特徴と強み</th></tr>
  <tr><td>・高火力<br>・展開が早い</td></tr>
</table></figure>
<div><a class="swell-block-button__link" href="https://www.holocardstrategy.jp/suisei-deck/">レシピ</a></div>
<h2 class="wp-block-heading">Tier2</h2>
<h3>兎田ぺこら</h3>
<h4>ぺこら単</h4>
<h2 class="wp-block-heading">まとめ</h2>
</body></html>
"""


class FakeResponse:
    def __init__(self, text):
        self.text = text
        self.status_code = 200

    def raise_for_status(self):
        pass


def test_scrape_tiers_parses_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(st.httpx, "get", lambda *a, **k: FakeResponse(TIER_PAGE))

    result = st.scrape_tiers(tmp_path)

    assert result["updated"] == "2026-05"
    assert [t["tier"] for t in result["tiers"]] == [1, 2]

    deck = result["tiers"][0]["decks"][0]
    assert deck["name"] == "すいせい単"
    assert deck["vtuber"] == "星街すいせい"
    assert deck["image"] == "https://example.jp/suisei.png"
    assert deck["ratings"] == {
        "firepower": "5", "ease": "4", "stability": "4", "endurance": "3", "pressure": "5",
    }
    assert deck["features"] == ["高火力", "展開が早い"]
    assert deck["recipe_url"] == "https://www.holocardstrategy.jp/suisei-deck/"
    assert deck["id"]  # stable slug assigned

    assert (tmp_path / "tier_list.json").exists()
