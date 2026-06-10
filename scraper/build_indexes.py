"""Build lightweight frontend indexes from the full scraper JSON files."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COLOR_ALIAS = {
    "白": "白",
    "綠": "綠",
    "緑": "綠",
    "紅": "紅",
    "赤": "紅",
    "藍": "藍",
    "青": "藍",
    "紫": "紫",
    "黃": "黃",
    "黄": "黃",
}


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def _norm_color(value: str | None) -> str:
    return COLOR_ALIAS.get(str(value or "").strip(), "")


def _colors_from_value(value: str | None) -> list[str]:
    colors: list[str] = []
    for part in str(value or "").split("/"):
        color = _norm_color(part)
        if color and color not in colors:
            colors.append(color)
    return colors


def _deck_colors(deck: dict[str, Any], cards_by_id: dict[str, dict[str, Any]]) -> list[str]:
    counts: dict[str, int] = {}
    for card in deck.get("cards") or []:
        card_id = card.get("card_id")
        db_card = cards_by_id.get(card_id) if card_id else None
        colors = _colors_from_value((db_card or {}).get("color") or card.get("color"))
        for color in colors:
            counts[color] = counts.get(color, 0) + int(card.get("count") or 1)
    return sorted(counts, key=lambda color: counts[color], reverse=True)


def _detail_filename(index: int, guide: dict[str, Any]) -> str:
    source = guide.get("deck_id") or guide.get("url") or f"guide-{index}"
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", str(source)).strip("-").lower()[:48]
    digest = hashlib.sha1(str(source).encode("utf-8")).hexdigest()[:8]
    return f"{index:03d}-{slug or 'guide'}-{digest}.json"


def build_frontend_indexes(data_dir: Path | str) -> None:
    data_path = Path(data_dir)
    cards = _load_json(data_path / "cards.json", [])
    guides = _load_json(data_path / "all_guides.json", [])
    cards_by_id = {card.get("id"): card for card in cards if card.get("id")}

    card_index = [
        {
            "id": card.get("id"),
            "name": card.get("name"),
            "type": card.get("type"),
            "color": card.get("color"),
            "imageUrl": card.get("imageUrl"),
            "bloom": card.get("bloom"),
        }
        for card in cards
        if card.get("id")
    ]
    _write_json(data_path / "card_index.json", card_index)

    detail_dir = data_path / "guides"
    detail_dir.mkdir(parents=True, exist_ok=True)
    for old_file in detail_dir.glob("*.json"):
        old_file.unlink()

    guide_index: list[dict[str, Any]] = []
    for idx, guide in enumerate(guides, start=1):
        filename = _detail_filename(idx, guide)
        _write_json(detail_dir / filename, guide)
        guide_index.append(
            {
                "url": guide.get("url"),
                "title": guide.get("title"),
                "deck_image": guide.get("deck_image"),
                "oshi_image": guide.get("oshi_image"),
                "description": guide.get("description"),
                "deck_id": guide.get("deck_id"),
                "date": guide.get("date"),
                "tier": guide.get("tier"),
                "source": guide.get("source"),
                "colors": _deck_colors(guide, cards_by_id),
                "cards_count": len(guide.get("cards") or []),
                "strategy_count": len(guide.get("strategy") or []),
                "detail_path": f"data/guides/{filename}",
            }
        )
    _write_json(data_path / "guides_index.json", guide_index)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _write_json(data_path / "meta.json", {"generated_at": generated_at})

    print(f"  Built card_index.json ({len(card_index)} cards)")
    print(f"  Built guides_index.json + {len(guide_index)} guide detail files")
    print(f"  Built meta.json (generated_at={generated_at})")


def main() -> None:
    if len(sys.argv) > 1:
        data_dir = Path(sys.argv[1])
    else:
        data_dir = Path(__file__).resolve().parent.parent / "web" / "data"
    build_frontend_indexes(data_dir)


if __name__ == "__main__":
    main()
