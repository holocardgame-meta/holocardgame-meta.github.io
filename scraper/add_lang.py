"""Add a new target language to existing already-translated JSON data.

Use case: data files in web/data/ already have multilang dicts like
{"ja": "...", "zh-TW": "...", "en": "...", "fr": "..."}. After adding a new
language to scraper/translate.py (e.g. 'es'), this script walks every
multilang dict in the JSON, extracts the source string (prefers ja, falls
back to zh-TW), translates to the missing target language, and writes it
back in place.

Avoids re-scraping/re-translating everything. Uses the same Gemini client +
translation_cache.json as scraper/translate.py.

Usage:
    uv run python -m scraper.add_lang es
"""

import argparse
import json
import sys
from pathlib import Path

from scraper.translate import (
    _load_cache,
    _save_cache,
    _translate_unique_map,
)


# Keys that indicate a multilang dict (not a structural dict). If a node has
# any of these keys, treat it as multilang.
LANG_KEYS = {"ja", "zh-TW", "en", "fr", "es"}


def _is_multilang_dict(node) -> bool:
    if not isinstance(node, dict):
        return False
    return any(k in node for k in LANG_KEYS)


def _pick_source(node, new_lang: str):
    """Return (source_lang, source_value) to translate from, or (None, None)
    if the node already has new_lang or no usable source."""
    if new_lang in node:
        return None, None
    for src in ("ja", "zh-TW", "en"):
        if src in node:
            val = node[src]
            if isinstance(val, str) and val.strip():
                return src, val
            if isinstance(val, list) and val:
                return src, val
    return None, None


def _collect(node, new_lang: str, by_source: dict):
    """Walk node recursively; for every multilang dict missing new_lang,
    collect its source string(s) under by_source[source_lang]."""
    if _is_multilang_dict(node):
        src, val = _pick_source(node, new_lang)
        if src is not None:
            bucket = by_source.setdefault(src, set())
            if isinstance(val, str):
                bucket.add(val)
            elif isinstance(val, list):
                for s in val:
                    if isinstance(s, str) and s.strip():
                        bucket.add(s)
        # Still recurse into VALUES of a multilang dict in case nested structures
        # exist (unlikely but safe).
        for v in node.values():
            _collect(v, new_lang, by_source)
        return
    if isinstance(node, dict):
        for v in node.values():
            _collect(v, new_lang, by_source)
    elif isinstance(node, list):
        for v in node:
            _collect(v, new_lang, by_source)


def _apply(node, new_lang: str, maps: dict):
    """Walk node recursively; for every multilang dict missing new_lang, fill
    it in using the translated maps[source_lang]."""
    if _is_multilang_dict(node):
        src, val = _pick_source(node, new_lang)
        if src is not None:
            m = maps.get(src, {})
            if isinstance(val, str):
                node[new_lang] = m.get(val, val)
            elif isinstance(val, list):
                node[new_lang] = [m.get(s, s) if isinstance(s, str) else s for s in val]
        for v in node.values():
            _apply(v, new_lang, maps)
        return
    if isinstance(node, dict):
        for v in node.values():
            _apply(v, new_lang, maps)
    elif isinstance(node, list):
        for v in node:
            _apply(v, new_lang, maps)


def add_lang_to_file(path: Path, new_lang: str) -> tuple[int, int]:
    """Returns (collected_count, written_count)."""
    if not path.exists():
        print(f"[add-lang] {path.name}: not found, skipping")
        return 0, 0

    data = json.loads(path.read_text(encoding="utf-8"))
    by_source: dict[str, set] = {}
    _collect(data, new_lang, by_source)
    total = sum(len(v) for v in by_source.values())
    if total == 0:
        print(f"[add-lang] {path.name}: no strings need {new_lang}")
        return 0, 0

    print(f"[add-lang] {path.name}: collected {total} unique strings "
          f"({', '.join(f'{k}={len(v)}' for k, v in by_source.items())})")

    maps: dict[str, dict[str, str]] = {}
    for source_lang, strs in by_source.items():
        if not strs:
            continue
        maps[source_lang] = _translate_unique_map(sorted(strs), source_lang, new_lang)

    _apply(data, new_lang, maps)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[add-lang] {path.name}: wrote {new_lang} for {total} strings")
    return total, total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("lang", help="Target language code (e.g. es)")
    parser.add_argument(
        "--dir",
        default=None,
        help="Data directory (defaults to web/data/)",
    )
    args = parser.parse_args()

    base = Path(__file__).resolve().parent.parent
    data_dir = Path(args.dir) if args.dir else base / "web" / "data"

    if not data_dir.exists():
        print(f"[add-lang] data dir not found: {data_dir}", file=sys.stderr)
        sys.exit(1)

    _load_cache(base)

    files = [
        "cards.json",
        "tier_list.json",
        "decks.json",
        "all_guides.json",
        "official_decks.json",
        "decklog_decks.json",
        "rules.json",
    ]

    total = 0
    for name in files:
        n, _ = add_lang_to_file(data_dir / name, args.lang)
        total += n
        _save_cache()

    print(f"\n[add-lang] Done. Translated {total} strings to {args.lang}.")


if __name__ == "__main__":
    main()
