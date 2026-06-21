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


def test_rules_sections_guarded_independently(tmp_path):
    """Each rules.json section is checked on its own: emptied sections are
    flagged, but a volatile section churning down is not."""
    old, new = tmp_path / "old", tmp_path / "new"
    full = {
        "restricted_cards": ["a", "b", "c", "d"],
        "errata": {"x": {}, "y": {}, "z": {}},
        "articles": _cards(5),
    }
    # restricted_cards + errata empty out (real regression); articles churn down (benign)
    shrunk = {"restricted_cards": [], "errata": {}, "articles": _cards(2)}
    _write(old, "rules.json", full)
    _write(new, "rules.json", shrunk)
    failures = check_data_regression(new, old)
    assert any("restricted_cards" in f for f in failures)
    assert any("errata" in f for f in failures)
    assert not any("articles" in f for f in failures)


def test_rules_article_churn_does_not_trip_guard(tmp_path):
    """News posts 404'ing (articles list shrinking) must not block the publish.
    This is the June-15 fragility: a dropped article shouldn't veto everything."""
    old, new = tmp_path / "old", tmp_path / "new"
    base = {"restricted_cards": ["a", "b"], "errata": {"x": {}, "y": {}, "z": {}}, "articles": _cards(6)}
    churned = {"restricted_cards": ["a", "b"], "errata": {"x": {}, "y": {}, "z": {}}, "articles": _cards(3)}
    _write(old, "rules.json", base)
    _write(new, "rules.json", churned)
    assert check_data_regression(new, old) == []


def test_rules_restricted_section_emptied_fails(tmp_path):
    """restricted_cards dropping to 0 (the rule01-removal bug) must be caught
    precisely, even though it's a small section."""
    old, new = tmp_path / "old", tmp_path / "new"
    base = {"restricted_cards": ["a", "b"], "errata": {"x": {}, "y": {}, "z": {}}, "articles": _cards(6)}
    zeroed = {"restricted_cards": [], "errata": {"x": {}, "y": {}, "z": {}}, "articles": _cards(6)}
    _write(old, "rules.json", base)
    _write(new, "rules.json", zeroed)
    failures = check_data_regression(new, old)
    assert len(failures) == 1
    assert "restricted_cards" in failures[0]


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
