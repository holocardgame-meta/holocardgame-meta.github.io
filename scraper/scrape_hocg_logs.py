"""Scrape shop-tournament results from hOCG Logs (hocg-logs.holotune.jp).

hOCG Logs is a fan-run database aggregating nationwide shop / official
tournament standings. Its deck pages are keyed by Deck Log code, so every
result row can feed deck_codes.json directly and scrape_decklog fetches the
actual card lists exactly as it does for manually curated codes.

Politeness: HTML pages only (robots.txt allows them; /api/ and /mcp are
disallowed and never touched), 1s delay between requests, and each
tournament page is fetched exactly once — hocg_logs_state.json (repo root)
records scraped tournament ids and CI commits it back. A failed fetch is not
recorded, so it retries on the next run. The site is credited on the About
page (see web/i18n.js `about.sources`).
"""

import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from scraper.scrape_x import _merge_into_deck_codes, _safe_get

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://hocg-logs.holotune.jp"
LIST_URL = f"{BASE_URL}/tournaments"
REQUEST_DELAY = 1.0

# Backfill floor approved 2026-07-31: July Selection Cups plus the Extremer
# Cup area-qualifier window (2026-06-27..08-09). Tournaments dated earlier
# are never scraped.
BACKFILL_START = "2026-06-27"
# Steady state: keep re-walking list pages this many days back so results
# that hOCG Logs publishes late are still picked up.
RECENT_WINDOW_DAYS = 28
MAX_PAGES = 20

_DECK_HREF_RE = re.compile(r"^/decks/([A-Za-z0-9]+)$")
_TOURNAMENT_HREF_RE = re.compile(r"^/tournaments/(\d+)$")


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def _parse_list_page(html: str) -> list[dict]:
    """Parse /tournaments rows: id, ISO date, name, organizer, venue, participants."""
    soup = BeautifulSoup(html, "lxml")
    rows = []
    for tr in soup.select("tbody tr"):
        link = None
        for a in tr.select("a[href]"):
            m = _TOURNAMENT_HREF_RE.match(a["href"])
            if m:
                link = (m.group(1), a.get_text(strip=True))
                break
        time_el = tr.find("time")
        if not link or not time_el:
            continue
        raw_date = (time_el.get("datetime") or time_el.get_text(strip=True))[:10]
        tds = tr.find_all("td")
        organizer = tds[2].get_text(strip=True) if len(tds) >= 5 else ""
        venue = tds[3].get_text(strip=True) if len(tds) >= 6 else ""
        participants_text = tds[-2].get_text(strip=True) if len(tds) >= 5 else ""
        rows.append({
            "id": link[0],
            "name": link[1],
            "date": raw_date.replace("/", "-"),
            "organizer": organizer,
            "venue": venue,
            "participants": int(participants_text) if participants_text.isdigit() else 0,
        })
    return rows


def _parse_detail_page(html: str) -> list[dict]:
    """Parse a /tournaments/<id> standings table into placement entries."""
    soup = BeautifulSoup(html, "lxml")
    entries = []
    for tr in soup.select("tr"):
        deck_a = None
        for a in tr.select("a[href]"):
            m = _DECK_HREF_RE.match(a["href"])
            if m:
                deck_a = (m.group(1), a.get_text(strip=True))
                break
        if not deck_a:
            continue
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue
        rank_m = re.match(r"(\d+)", tds[0].get_text(strip=True))
        entries.append({
            "rank": int(rank_m.group(1)) if rank_m else 0,
            "player": tds[1].get_text(strip=True),
            "oshi": tds[2].get_text(strip=True),
            "code": deck_a[0],
            "title": deck_a[1],
        })
    return entries


def _format_event(name: str, organizer: str, iso_date: str) -> str:
    """Compose the registry event string for one tournament.

    The "ショップ大会 YYYY-MM - " prefix folds a month's shop events into one
    collapsible parent in the tournament view (it groups on the prefix before
    the first " - "). Many shops reuse identical generic event names, which
    would pool their standings into one sub-section — append the organizer
    when the name doesn't already contain it so every tournament stays a
    distinct sub-section.
    """
    suffix = f" / {organizer}" if organizer and organizer not in name else ""
    return f"ショップ大会 {iso_date[:7]} - {name}{suffix}"


def _build_deck_entries(row: dict, standings: list[dict]) -> list[dict]:
    """Build deck_codes.json-compatible entries for one tournament."""
    entries = []
    event = _format_event(row["name"], row.get("organizer", ""), row["date"])
    for s in standings:
        placement = _ordinal(s["rank"]) if s["rank"] else ""
        if s["player"]:
            placement = f"{placement} ({s['player']})" if placement else f"({s['player']})"
        entries.append({
            "code": s["code"],
            "title": s["title"],
            "oshi": s["oshi"],
            "source": row["name"],
            "event": event,
            "event_date": row["date"],
            "placement": placement,
            "organizer": row.get("organizer", ""),
            "venue": row["venue"],
            "hocg_logs_url": f"{BASE_URL}/tournaments/{row['id']}",
        })
    return entries


def scrape_hocg_logs(
    state_path: Path,
    deck_codes_path: Path,
    output_dir: Path,
    today: date | None = None,
) -> list[dict]:
    """Scrape new tournaments from hOCG Logs into the deck_codes.json registry."""
    today = today or date.today()
    recent_floor = (today - timedelta(days=RECENT_WINDOW_DAYS)).isoformat()

    state: dict = {"scraped_tournament_ids": []}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    scraped_ids = set(state.get("scraped_tournament_ids", []))

    existing_codes = set()
    if deck_codes_path.exists():
        registry = json.loads(deck_codes_path.read_text(encoding="utf-8"))
        existing_codes = {e["code"].upper() for e in registry if e.get("code")}

    new_entries: list[dict] = []
    newly_scraped: list[str] = []
    client = httpx.Client()
    try:
        for page in range(1, MAX_PAGES + 1):
            html = _safe_get(client, f"{LIST_URL}?page={page}")
            if not html:
                break
            rows = _parse_list_page(html)
            if not rows:
                break

            fresh = [
                r for r in rows
                if r["id"] not in scraped_ids and r["date"] >= BACKFILL_START
            ]
            for row in fresh:
                time.sleep(REQUEST_DELAY)
                detail_html = _safe_get(client, f"{BASE_URL}/tournaments/{row['id']}")
                if not detail_html:
                    continue
                standings = _parse_detail_page(detail_html)
                if not standings:
                    # Results not published yet — leave unscraped and retry.
                    print(f"  [{row['date']}] {row['name']}: no standings yet, will retry")
                    continue

                scraped_ids.add(row["id"])
                newly_scraped.append(row["id"])
                fresh_codes = 0
                for entry in _build_deck_entries(row, standings):
                    if entry["code"].upper() in existing_codes:
                        continue
                    existing_codes.add(entry["code"].upper())
                    new_entries.append(entry)
                    fresh_codes += 1
                print(
                    f"  [{row['date']}] {row['name']}: "
                    f"{len(standings)} standings, {fresh_codes} new deck code(s)"
                )

            oldest = min(r["date"] for r in rows)
            if oldest < BACKFILL_START:
                break
            if not fresh and oldest < recent_floor:
                break
            time.sleep(REQUEST_DELAY)
    finally:
        client.close()

    if newly_scraped:
        state["scraped_tournament_ids"] = sorted(scraped_ids)
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  Recorded {len(newly_scraped)} tournament(s) in {state_path.name}")

    merged = _merge_into_deck_codes(deck_codes_path, new_entries)
    if merged:
        print(f"  Appended {merged} new deck entries to {deck_codes_path.name}")

    out_path = output_dir / "hocg_logs_decks.json"
    out_path.write_text(
        json.dumps(new_entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  Saved {len(new_entries)} new entries from hOCG Logs to {out_path}")
    return new_entries


if __name__ == "__main__":
    base = Path(__file__).resolve().parent.parent
    scrape_hocg_logs(
        base / "hocg_logs_state.json",
        base / "deck_codes.json",
        base / "data",
    )
