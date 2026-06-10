"""Detect and re-translate suspicious entries for a target language.

Use case: after running scraper/add_lang.py, Gemini batch-size mismatches
may have caused some translations to either (a) literally copy the source
text (untranslated padding) or (b) get shifted by one within the batch
(card[N] receiving card[N+1]'s translation). This script handles case (a)
directly and tries to recover from (b) by re-translating affected batches.

Detection heuristic: a multilang dict's `target_lang` value is suspect if:
  - It literally equals the `source_lang` value (verbatim untranslated)
  - AND the source contains substantial CJK characters (>= 8 chars)
  - AND it's a string longer than 20 chars (skip short tokens like 'AZKi')

For each suspect:
  - Delete its cache entry `gemini|<source>|<target>|<text>`
  - Re-collect for translation
  - Run translation via _translate_unique_map (uses fixed batch logic)
  - Write back to JSON

Usage:
    uv run python -m scraper.repair_lang es
"""

import argparse
import json
import re
import sys
from pathlib import Path

from scraper import translate as _t
from scraper.translate import (
    _cache_key,
    _load_cache,
    _save_cache,
    _translate_unique_map,
)

LANG_KEYS = {"ja", "zh-TW", "en", "fr", "es"}
SOURCE_PRIORITY = ("ja", "zh-TW", "en")
CJK_RE = re.compile(r"[぀-ヿ㐀-鿿ｦ-ﾟ]")


def _has_cjk(s: str) -> bool:
    return len(CJK_RE.findall(s)) >= 8


def _is_multilang(node) -> bool:
    return isinstance(node, dict) and any(k in node for k in LANG_KEYS)


def _is_suspect(node, target_lang: str) -> tuple[str | None, str | None]:
    """Returns (source_lang, source_text) if this multilang dict has a
    suspicious target_lang entry that needs re-translation; else (None, None)."""
    if not _is_multilang(node):
        return None, None
    tgt = node.get(target_lang)
    if not isinstance(tgt, str) or not tgt.strip():
        return None, None
    for src in SOURCE_PRIORITY:
        if src == target_lang:
            continue
        src_val = node.get(src)
        if not isinstance(src_val, str) or not src_val.strip():
            continue
        # Suspect if literal copy AND source has CJK AND non-trivial length
        if tgt == src_val and _has_cjk(src_val) and len(src_val) >= 20:
            return src, src_val
    return None, None


def _collect_suspects(node, target_lang: str, by_source: dict):
    if _is_multilang(node):
        src, src_text = _is_suspect(node, target_lang)
        if src:
            by_source.setdefault(src, set()).add(src_text)
        for v in node.values():
            _collect_suspects(v, target_lang, by_source)
        return
    if isinstance(node, dict):
        for v in node.values():
            _collect_suspects(v, target_lang, by_source)
    elif isinstance(node, list):
        for v in node:
            _collect_suspects(v, target_lang, by_source)


def _apply_repair(node, target_lang: str, maps: dict):
    if _is_multilang(node):
        src, src_text = _is_suspect(node, target_lang)
        if src:
            new = maps.get(src, {}).get(src_text)
            if new and new != src_text:
                node[target_lang] = new
        for v in node.values():
            _apply_repair(v, target_lang, maps)
        return
    if isinstance(node, dict):
        for v in node.values():
            _apply_repair(v, target_lang, maps)
    elif isinstance(node, list):
        for v in node:
            _apply_repair(v, target_lang, maps)


def repair_file(path: Path, target_lang: str) -> int:
    """Returns count of strings re-translated."""
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    by_source: dict[str, set] = {}
    _collect_suspects(data, target_lang, by_source)
    total = sum(len(v) for v in by_source.values())
    if total == 0:
        print(f"[repair] {path.name}: no suspect entries")
        return 0

    print(f"[repair] {path.name}: {total} suspect strings "
          f"({', '.join(f'{k}={len(v)}' for k, v in by_source.items())})")

    # Invalidate cache for these so we hit Gemini fresh
    invalidated = 0
    for src, strs in by_source.items():
        for s in strs:
            key = _cache_key(src, target_lang, s)
            if _t._cache.pop(key, None) is not None:
                invalidated += 1
    if invalidated:
        _t._cache_dirty = True
        print(f"  invalidated {invalidated} cache entries")

    # Re-translate
    maps: dict[str, dict[str, str]] = {}
    for src, strs in by_source.items():
        maps[src] = _translate_unique_map(sorted(strs), src, target_lang)

    _apply_repair(data, target_lang, maps)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[repair] {path.name}: re-translated {total} strings")
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("lang", help="Target language code (e.g. es)")
    parser.add_argument("--dir", default=None, help="Data dir (defaults to web/data/)")
    args = parser.parse_args()

    base = Path(__file__).resolve().parent.parent
    data_dir = Path(args.dir) if args.dir else base / "web" / "data"

    if not data_dir.exists():
        print(f"[repair] data dir not found: {data_dir}", file=sys.stderr)
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
        n = repair_file(data_dir / name, args.lang)
        total += n
        _save_cache()

    print(f"\n[repair] Done. Re-translated {total} strings.")


if __name__ == "__main__":
    main()
