"""Tests for the publish-time data regression gate."""

import json

import pytest

from scraper.data_guard import check_data_regression, enforce


def _write(dir_path, name, data):
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _cards(n):
    return [{"id": f"hBP01-{i:03d}"} for i in range(n)]


def test_passes_when_counts_stable(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    _write(new, "cards.json", _cards(101))
    assert check_data_regression(new, old) == []


def test_fails_on_large_shrink(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    _write(new, "cards.json", _cards(70))
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "cards.json" in failures[0]


def test_small_shrink_within_ratio_passes(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    _write(new, "cards.json", _cards(85))
    assert check_data_regression(new, old) == []


def test_tiny_baseline_skips_ratio_check(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "decks.json", _cards(4))
    _write(new, "decks.json", _cards(3))
    assert check_data_regression(new, old) == []


def test_emptied_dataset_fails_even_when_tiny(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "decks.json", _cards(4))
    _write(new, "decks.json", [])
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "emptied" in failures[0]


def test_missing_new_file_fails(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    new.mkdir()
    _write(old, "all_guides.json", _cards(50))
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "missing" in failures[0]


def test_first_run_without_baseline_passes(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    old.mkdir()
    _write(new, "cards.json", _cards(100))
    assert check_data_regression(new, old) == []


def test_unreadable_new_file_fails(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    new.mkdir()
    (new / "cards.json").write_text("{not json", encoding="utf-8")
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "unreadable" in failures[0]


def test_tier_list_counts_decks_across_tiers(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    full = {"tiers": [{"tier": 1, "decks": _cards(8)}, {"tier": 2, "decks": _cards(8)}]}
    shrunk = {"tiers": [{"tier": 1, "decks": _cards(8)}]}
    _write(old, "tier_list.json", full)
    _write(new, "tier_list.json", shrunk)
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "tier_list.json" in failures[0]


def test_rules_counter_combines_sections(tmp_path):
    old, new = tmp_path / "old", tmp_path / "new"
    full = {
        "restricted_cards": ["a", "b", "c", "d"],
        "errata": {"x": {}, "y": {}, "z": {}},
        "articles": _cards(5),
    }
    _write(old, "rules.json", full)
    _write(new, "rules.json", {"restricted_cards": [], "errata": {}, "articles": _cards(2)})
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "rules.json" in failures[0]


def test_enforce_raises_systemexit(tmp_path, monkeypatch):
    monkeypatch.delenv("DATA_GUARD_BYPASS", raising=False)
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    _write(new, "cards.json", _cards(10))
    with pytest.raises(SystemExit):
        enforce(new, old)


def test_enforce_bypass_env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_GUARD_BYPASS", "1")
    old, new = tmp_path / "old", tmp_path / "new"
    _write(old, "cards.json", _cards(100))
    _write(new, "cards.json", _cards(10))
    enforce(new, old)  # must not raise
