"""Bounded, order-preserving concurrent map for the page scrapers.

The scrapers fetch many independent pages; doing them one at a time with a
fixed delay between requests dominates wall-clock. This runs a small pool of
worker threads instead — network waits release the GIL, so the I/O overlaps —
while keeping the worker count low to stay polite to the source sites.

Results come back in input order, and any item whose function raises is logged
and returned as None (fail-soft: one bad page never aborts the whole batch,
matching the scrapers' existing skip-and-continue behavior).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

T = TypeVar("T")
R = TypeVar("R")

# Conservative default: enough to overlap network latency, low enough to avoid
# hammering the (often small) source sites. Tune per caller if needed.
DEFAULT_MAX_WORKERS = 4


def concurrent_map(
    fn: Callable[[T], R],
    items: list[T],
    max_workers: int = DEFAULT_MAX_WORKERS,
) -> list[R | None]:
    """Apply ``fn`` to each item across a bounded thread pool.

    Returns a list aligned with ``items``; a slot is None when that item's call
    raised. Never raises for individual item failures.
    """
    if not items:
        return []

    workers = max(1, min(max_workers, len(items)))
    results: list[R | None] = [None] * len(items)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        # Futures stay in input order, so collecting their results in order
        # keeps the output aligned with the input regardless of finish order.
        futures = [executor.submit(fn, item) for item in items]
        for index, future in enumerate(futures):
            try:
                results[index] = future.result()
            except Exception as exc:  # fail-soft: skip + log, never abort the batch
                preview = repr(items[index])
                if len(preview) > 80:
                    preview = preview[:77] + "..."
                print(f"  [concurrent] item {index} failed ({preview}): {exc}")

    return results
