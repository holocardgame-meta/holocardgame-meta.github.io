"""Fixture-HTML parsing tests for the official recommended deck scraper."""

import scraper.scrape_official as so

DECK_PAGE = """
<html><body>
<div class="deck-con">
  <h1>Suisei Starter Deck</h1>
  <p>A beginner-friendly blue deck.</p>
  <div class="block">
    <div class="card-box holomen">
      <img src="/images/hBP01-006_OSR.png"><p>〈Hoshimachi Suisei〉</p>
    </div>
    <div class="card-box list">
      <div class="card"><img src="/images/hBP01-026_RR.png"><span class="num">x4</span></div>
      <div class="card"><img src="/images/hBP01-027_R.png"><span class="num">x2</span></div>
    </div>
    <div class="card-box list">
      <div class="card"><img src="/images/hY01-001_C.png"><span class="num">x10</span></div>
    </div>
    <div class="glay-box point">
      <div class="attention"><div class="txt">Attack with Suisei every turn.</div></div>
    </div>
    <div class="glay-box check">
      <div class="card"><img src="/images/hBP01-026_RR.png"></div>
      <div class="detail"><p class="name">〈Hoshimachi Suisei〉</p>
        <div class="attention"><div class="txt">Your main attacker.</div></div>
      </div>
    </div>
  </div>
</div>
</body></html>
"""


class FakeResponse:
    def __init__(self, text):
        self.text = text
        self.status_code = 200

    def raise_for_status(self):
        pass


def test_scrape_deck_page_parses_fixture(monkeypatch):
    monkeypatch.setattr(so.httpx, "get", lambda *a, **k: FakeResponse(DECK_PAGE))

    deck = so._scrape_deck_page("https://en.hololive-official-cardgame.com/deck/suisei/")

    assert deck["title"] == "Suisei Starter Deck"
    assert deck["description"] == "A beginner-friendly blue deck."
    assert deck["oshi"] == "Hoshimachi Suisei"
    assert deck["oshi_card_id"] == "hBP01-006"
    assert deck["oshi_image"].startswith("https://en.hololive-official-cardgame.com/")

    assert [c["card_id"] for c in deck["main_deck"]] == ["hBP01-026", "hBP01-027"]
    assert deck["main_deck_count"] == 6
    assert [c["card_id"] for c in deck["cheer_deck"]] == ["hY01-001"]
    assert deck["cheer_deck_count"] == 10

    assert deck["strategy"][0]["text"] == "Attack with Suisei every turn."
    assert deck["key_cards"][0]["card_id"] == "hBP01-026"


def test_parse_date():
    assert so._parse_date("Feb. 27, 2026") == "2026-02-27"
    assert so._parse_date("not a date") == ""


def test_parse_card_id_and_count():
    assert so._parse_card_id_from_src("/img/hBP01-009_RR.png") == "hBP01-009"
    assert so._parse_card_id_from_src("/img/logo.png") == ""
    assert so._parse_count("x4") == 4
    assert so._parse_count("") == 1


def test_scrape_official_preserves_order_and_skips_failures(tmp_path, monkeypatch):
    """Concurrent fetching must keep input order and drop pages that fail."""
    entries = [
        {"url": "https://en.hololive-official-cardgame.com/deck/a/", "date_text": "Feb. 1, 2026"},
        {"url": "https://en.hololive-official-cardgame.com/deck/b/", "date_text": ""},
        {"url": "https://en.hololive-official-cardgame.com/deck/c/", "date_text": ""},
    ]
    monkeypatch.setattr(so, "_collect_deck_urls", lambda: entries)

    def fake_page(url):
        if "/b/" in url:
            return None  # a page that failed to parse
        return {"title": url, "main_deck": [], "cheer_deck": []}

    monkeypatch.setattr(so, "_scrape_deck_page", fake_page)

    decks = so.scrape_official(tmp_path)

    assert [d["deck_id"] for d in decks] == ["official-a", "official-c"]
    assert decks[0]["date"] == "2026-02-01"
    assert all(d["source"] == "official" for d in decks)
