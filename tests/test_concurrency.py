"""Tests for the bounded concurrent-map helper used by the page scrapers."""

from scraper.concurrency import concurrent_map


def test_preserves_input_order():
    items = list(range(25))
    result = concurrent_map(lambda x: x * x, items, max_workers=4)
    assert result == [x * x for x in items]


def test_failsoft_returns_none_for_raising_items():
    def fn(x):
        if x == 3:
            raise ValueError("boom")
        return x * 10

    result = concurrent_map(fn, [1, 2, 3, 4], max_workers=2)
    assert result == [10, 20, None, 40]


def test_empty_items_returns_empty():
    assert concurrent_map(lambda x: x, [], max_workers=4) == []


def test_single_worker_still_works():
    assert concurrent_map(lambda x: x + 1, [1, 2, 3], max_workers=1) == [2, 3, 4]
