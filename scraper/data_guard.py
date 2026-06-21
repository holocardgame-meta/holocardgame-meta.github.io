"""Regression gate for scraped data.

Source-site HTML changes tend to fail soft: scrapers skip what they can't
parse, the pipeline finishes "successfully", and a quietly shrunken dataset
gets published. This guard compares freshly scraped files in data/ against
the currently published web/data/ baseline and aborts the run when any
dataset shrinks below MIN_RATIO of its previous size (or empties entirely),
so the stale-but-complete site stays live instead.

Set DATA_GUARD_BYPASS=1 to publish an intentional shrink.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

MIN_RATIO = 0.8
# Ratio checks only kick in above this baseline size; tiny datasets are too
# noisy (a 4 -> 3 change is routine, a 100 -> 75 change is an incident).
MIN_BASELINE = 10
BYPASS_ENV = "DATA_GUARD_BYPASS"


def _count_list(data: Any) -> int:
    return len(data) if isinstance(data, list) else 0


def _count_tier_decks(data: Any) -> int:
    if not isinstance(data, dict):
        return 0
    return sum(len(tier.get("decks") or []) for tier in data.get("tiers") or [])


def _count_rules(data: Any) -> dict[str, int]:
    """Count each rules.json section separately.

    Returning a per-section breakdown (rather than one combined total) lets the
    guard check each section on its own. The June-15 incident showed why the
    combined total is wrong on both ends: a volatile section churning down
    (one news article 404'ing) tripped the publish, while a meaningful section
    emptying (restricted_cards -> 0) slipped under the combined ratio.
    """
    if not isinstance(data, dict):
        return {"restricted_cards": 0, "errata": 0, "articles": 0}
    return {
        "restricted_cards": len(data.get("restricted_cards") or []),
        "errata": len(data.get("errata") or {}),
        "articles": len(data.get("articles") or []),
    }


DATASET_COUNTERS: dict[str, Callable[[Any], int | dict[str, int]]] = {
    "cards.json": _count_list,
    "decks.json": _count_list,
    "all_guides.json": _count_list,
    "decklog_decks.json": _count_list,
    "official_decks.json": _count_list,
    "tier_list.json": _count_tier_decks,
    "rules.json": _count_rules,
}


def _regression_message(
    label: str, old_count: int, new_count: int, min_ratio: float, min_baseline: int
) -> str | None:
    """Compare one count against its baseline; return a failure string or None."""
    if old_count > 0 and new_count == 0:
        return f"{label}: emptied ({old_count} -> 0)"
    if old_count >= min_baseline and new_count < old_count * min_ratio:
        return (
            f"{label}: shrank {old_count} -> {new_count} "
            f"(below {min_ratio:.0%} of baseline)"
        )
    return None


def _as_sections(count: int | dict[str, int]) -> dict[str, int]:
    """Normalize a counter result to a {section: count} mapping.

    Whole-file datasets use the empty-string section; multi-section datasets
    (rules.json) keep their named sections so each is guarded independently.
    """
    return count if isinstance(count, dict) else {"": count}


def check_data_regression(
    new_dir: Path,
    baseline_dir: Path,
    *,
    min_ratio: float = MIN_RATIO,
    min_baseline: int = MIN_BASELINE,
) -> list[str]:
    """Return a list of human-readable failures (empty when safe to publish)."""
    failures: list[str] = []
    for name, counter in DATASET_COUNTERS.items():
        old_path = baseline_dir / name
        if not old_path.exists():
            continue  # first run for this dataset — nothing to compare against
        try:
            old_sections = _as_sections(counter(json.loads(old_path.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, OSError):
            continue  # unreadable baseline can't veto fresh data

        new_path = new_dir / name
        if not new_path.exists():
            if any(c > 0 for c in old_sections.values()):
                failures.append(f"{name}: new file missing (baseline had data)")
            continue
        try:
            new_sections = _as_sections(counter(json.loads(new_path.read_text(encoding="utf-8"))))
        except (json.JSONDecodeError, OSError) as exc:
            failures.append(f"{name}: new file unreadable ({exc})")
            continue

        for section, old_count in old_sections.items():
            label = f"{name}[{section}]" if section else name
            message = _regression_message(
                label, old_count, new_sections.get(section, 0), min_ratio, min_baseline
            )
            if message:
                failures.append(message)
    return failures


def enforce(new_dir: Path, baseline_dir: Path) -> None:
    """Print a report; raise SystemExit when regressions are found (unless bypassed)."""
    failures = check_data_regression(new_dir, baseline_dir)
    if not failures:
        print("[data-guard] All datasets within expected size range.")
        return
    for failure in failures:
        print(f"[data-guard] FAIL: {failure}")
    if os.environ.get(BYPASS_ENV):
        print(f"[data-guard] Bypassed via {BYPASS_ENV}; publishing anyway.")
        return
    raise SystemExit(
        f"[data-guard] Refusing to publish shrunken data. "
        f"Set {BYPASS_ENV}=1 to override intentionally."
    )
