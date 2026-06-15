"""Parsing tests for the rules / errata scraper."""

from scraper.scrape_rules import (
    _build_errata_map,
    _classify_article,
    _parse_restriction_deltas,
    _resolve_restricted_cards,
)

# Real-world shape of the post-rule01 format: restriction changes are announced
# in prose, with the operative cards tagged 制限カード：「ID」 (newly restricted)
# and 制限解除カード：「ID」 (restriction lifted). Every other card ID in the body
# (deck pieces, search targets) is a contextual mention and must be ignored.
DELTA_POST = """
制限カード追加・解除のお知らせ[2026/6/19(金)施行]
制限カードとは？ デッキに1枚だけ入れることができるカードです。
本デッキは「hBP07-045〈ハコス・ベールズ〉」のアーツと「hBP07-101〈ASMRマイク〉」を主軸とし、
「hBP06-085〈フェイバリットパソコン〉」でサーチします。
制限カード：「hBP07-101〈ASMRマイク〉」
制限解除カードについて
制限解除カード：「hBP02-094〈Tatang〉」
"""


def test_classify_article():
    assert _classify_article("カード裁定変更のお知らせ", "post123") == "errata"
    assert _classify_article("制限カード追加のお知らせ", "post124") == "restricted"
    assert _classify_article("制限カード解除のお知らせ", "post125") == "unrestricted"
    assert _classify_article("ルール更新", "post126") == "rule_update"
    assert _classify_article("anything", "rule01") == "deck_rules"


def test_parse_restriction_deltas_only_marked_cards():
    added, removed = _parse_restriction_deltas(DELTA_POST)
    # hBP07-045 / hBP06-085 are contextual mentions, not restrictions.
    assert added == ["hBP07-101"]
    assert removed == ["hBP02-094"]


def test_parse_restriction_deltas_handles_multiple_and_no_markers():
    body = "制限カード：「hBP01-001」 ほか 制限カード：「hBP01-002」"
    assert _parse_restriction_deltas(body) == (["hBP01-001", "hBP01-002"], [])
    assert _parse_restriction_deltas("ルール更新のお知らせ。該当カードなし。") == ([], [])


def test_resolve_applies_deltas_newer_than_seed():
    seed = ["hBP01-030", "hBP02-094"]
    posts = [("2026-06-12", ["hBP07-101"], ["hBP02-094"])]
    assert _resolve_restricted_cards(seed, "2026-06-10", posts) == ["hBP01-030", "hBP07-101"]


def test_resolve_skips_posts_not_newer_than_seed():
    # Same post, but the seed snapshot already reflects it (seed date >= post date).
    seed = ["hBP01-030", "hBP07-101"]
    posts = [("2026-06-12", ["hBP07-101"], ["hBP02-094"])]
    assert _resolve_restricted_cards(seed, "2026-06-15", posts) == ["hBP01-030", "hBP07-101"]


def test_resolve_is_idempotent_and_order_stable():
    # Re-applying a delta whose effect is already present must not duplicate.
    seed = ["hBP01-030", "hBP07-101"]
    posts = [("2026-06-20", ["hBP07-101"], ["hBP02-094"])]
    assert _resolve_restricted_cards(seed, "2026-06-15", posts) == ["hBP01-030", "hBP07-101"]


def test_resolve_applies_multiple_posts_in_date_order():
    seed = ["hBP01-030"]
    posts = [
        ("2026-07-01", ["hBP09-001"], []),
        ("2026-06-12", ["hBP07-101"], ["hBP02-094"]),
    ]
    assert _resolve_restricted_cards(seed, "2026-06-10", posts) == [
        "hBP01-030",
        "hBP07-101",
        "hBP09-001",
    ]


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
