"""Tests for translate_official's per-source-language handling (EN vs JP decks)."""

import json

from scraper import translate


def _fake_unique_map(texts, source, target):
    """Deterministic, target-tagged translations so assertions are exact."""
    return {t: f"{t}[{target}]" for t in texts}


def test_translate_official_handles_en_and_jp_sources(tmp_path, monkeypatch):
    monkeypatch.setattr(translate, "_translate_unique_map", _fake_unique_map)
    translate._cache.clear()

    decks = [
        {
            "deck_id": "official-hbp06_001", "source_lang": "en",
            "title": "Recommended Deck: Niko", "oshi": "Koganei Niko",
            "description": "An English deck.",
            "strategy": [{"text": "Attack."}],
            "key_cards": [{"name": "Koganei Niko", "text": "Key."}],
        },
        {
            "deck_id": "official-hbp08_003", "source_lang": "ja",
            "title": "おすすめデッキ紹介「FUWAMOCO」", "oshi": "FUWAMOCO",
            "description": "日本語の説明。",
            "strategy": [{"text": "攻める。"}],
            "key_cards": [{"name": "思い出のドーナツショップ", "text": "鍵。"}],
        },
    ]
    (tmp_path / "official_decks.json").write_text(
        json.dumps(decks, ensure_ascii=False), encoding="utf-8"
    )

    translate.translate_official(tmp_path)
    out = json.loads((tmp_path / "official_decks.json").read_text(encoding="utf-8"))
    en, jp = out[0], out[1]

    # EN deck: names stay English; description is an en-source multilang dict.
    assert en["title"] == "Recommended Deck: Niko"
    assert en["oshi"] == "Koganei Niko"
    assert en["description"]["en"] == "An English deck."
    assert en["description"]["zh-TW"] == "An English deck.[zh-TW]"

    # JP deck: title/oshi rendered to a plain English string (Decision B).
    assert jp["title"] == "おすすめデッキ紹介「FUWAMOCO」[en]"
    assert jp["oshi"] == "FUWAMOCO[en]"
    # JP deck: text fields are ja-source multilang dicts.
    assert jp["description"]["ja"] == "日本語の説明。"
    assert jp["description"]["en"] == "日本語の説明。[en]"
    assert jp["description"]["zh-TW"] == "日本語の説明。[zh-TW]"
    assert jp["strategy"][0]["text"]["ja"] == "攻める。"
    assert jp["key_cards"][0]["text"]["zh-TW"] == "鍵。[zh-TW]"
    # JP key-card *names* render to a plain English string (like title/oshi)...
    assert jp["key_cards"][0]["name"] == "思い出のドーナツショップ[en]"
    # ...while EN decks keep their already-English key-card names untouched.
    assert en["key_cards"][0]["name"] == "Koganei Niko"
