"""Tests for frontend index generation."""

import json

from scraper.build_indexes import build_frontend_indexes


def _write(dir_path, name, data):
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _read(dir_path, name):
    return json.loads((dir_path / name).read_text(encoding="utf-8"))


def test_builds_card_index_guide_index_and_meta(tmp_path):
    cards = [
        {"id": "hBP01-001", "name": "星街すいせい", "type": "主推", "color": "藍",
         "imageUrl": "https://x/1.png", "bloom": None, "extra_field": "dropped"},
        {"id": "hBP01-002", "name": "兎田ぺこら", "type": "成員", "color": "綠",
         "imageUrl": "https://x/2.png", "bloom": "1st"},
        {"name": "no-id entry is skipped"},
    ]
    guides = [
        {
            "deck_id": "guide-suisei-deck",
            "url": "https://example.jp/suisei-deck/",
            "title": {"ja": "すいせいデッキ"},
            "date": "2026-05-01",
            "cards": [{"card_id": "hBP01-001", "count": 4}, {"card_id": "hBP01-002", "count": 2}],
            "strategy": [{"title": "t", "text": "x"}],
        },
    ]
    _write(tmp_path, "cards.json", cards)
    _write(tmp_path, "all_guides.json", guides)

    build_frontend_indexes(tmp_path)

    card_index = _read(tmp_path, "card_index.json")
    assert len(card_index) == 2
    assert card_index[0]["id"] == "hBP01-001"
    assert "extra_field" not in card_index[0]

    guide_index = _read(tmp_path, "guides_index.json")
    assert len(guide_index) == 1
    entry = guide_index[0]
    assert entry["deck_id"] == "guide-suisei-deck"
    assert entry["cards_count"] == 2
    assert entry["strategy_count"] == 1
    # Dominant color first: 4x blue beats 2x green.
    assert entry["colors"][0] == "藍"
    assert entry["detail_path"].startswith("data/guides/")

    detail_file = tmp_path / "guides" / entry["detail_path"].split("/")[-1]
    assert detail_file.exists()
    assert _read(tmp_path / "guides", detail_file.name)["deck_id"] == "guide-suisei-deck"

    meta = _read(tmp_path, "meta.json")
    assert len(meta["generated_at"]) == 10  # YYYY-MM-DD


def test_old_detail_files_are_replaced(tmp_path):
    _write(tmp_path, "cards.json", [])
    _write(tmp_path, "all_guides.json", [])
    stale = tmp_path / "guides" / "001-old-deadbeef.json"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text("{}", encoding="utf-8")

    build_frontend_indexes(tmp_path)

    assert not stale.exists()
    assert _read(tmp_path, "guides_index.json") == []
