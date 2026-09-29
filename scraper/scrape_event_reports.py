"""Scrape winning Deck Log codes from official event reports.

hololive-official-cardgame.com publishes a report after each major official
event (World Grand Prix legs, festivals) whose results section lists each
winner with a direct Deck Log link:

    <h3>個人戦</h3> <h4>Aブロック優勝</h4> <p>Esika 選手</p> <a>decklog…/48Z3P</a>
    <h3>トリオバトル</h3> <h4>Aブロック優勝：チーム「 X 」</h4> <p>A 選手、B 選手、C 選手</p> <a>…</a>×3

This replaces the @hololive_OCG results tweets the X path can no longer
discover (the official posts stopped embedding them). New codes are appended
to deck_codes.json in the same shape as the hand-curated WGP entries, so the
decklog step fetches them this run; codes already in the registry are skipped.
The category page lists only a handful of posts, so each run re-reads them
(one request per post, 1s apart; robots.txt only disallows /wp-admin/).
"""

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from scraper.scrape_x import DECKLOG_RE, _merge_into_deck_codes, _safe_get

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "https://hololive-official-cardgame.com"
EVENT_LIST_URL = f"{BASE_URL}/cat_news/event/"
REQUEST_DELAY = 1.0

# Romanized venue names, matching the hand-curated WGP entries
# ("WGP25-26 Fukuoka"); unknown venues keep their Japanese name.
VENUES = {
    "福岡": "Fukuoka", "愛知": "Aichi", "東京": "Tokyo", "大阪": "Osaka",
    "宮城": "Miyagi", "北海道": "Hokkaido", "広島": "Hiroshima", "千葉": "Chiba",
    "神奈川": "Kanagawa", "新潟": "Niigata", "香川": "Kagawa", "石川": "Ishikawa",
}
PLACEMENTS = {"優勝": "1st", "準優勝": "2nd", "3位": "3rd", "ベスト4": "Top 4", "ベスト8": "Top 8"}

_DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")
_BLOCK_RE = re.compile(r"([A-Z])ブロック")
_TEAM_RE = re.compile(r"チーム「\s*(.+?)\s*」")


def _event_base(title: str) -> str:
    """『ワールドグランプリ25-26 福岡会場』 -> "WGP25-26 Fukuoka"."""
    m = re.search(r"『(.+?)』", title)
    name = (m.group(1) if m else title).strip()
    name = name.replace("ワールドグランプリ", "WGP").removesuffix("会場").strip()
    for ja, en in VENUES.items():
        if name.endswith(f" {ja}"):
            return name[: -len(ja)] + en
    return name


def _placement(heading: str) -> str:
    for ja, en in PLACEMENTS.items():
        if ja in heading:
            return en
    return heading


def parse_report(html: str, url: str = "") -> list[dict]:
    """Registry entries for every Deck Log link in a report's results section."""
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    title = h1.get_text(" ", strip=True) if h1 else ""
    base = _event_base(title)
    body = soup.find("article") or soup.body or soup
    date_m = _DATE_RE.search(body.get_text(" ", strip=True))
    event_date = f"{date_m.group(1)}-{int(date_m.group(2)):02d}-{int(date_m.group(3)):02d}" if date_m else ""

    entries: list[dict] = []
    fmt = heading = ""
    players: list[str] = []
    slot = 0
    for el in body.find_all(["h2", "h3", "h4", "p", "a"]):
        text = " ".join(el.get_text(" ", strip=True).split())
        if el.name == "h2":
            fmt = heading = ""
        elif el.name == "h3":
            fmt, heading = text, ""
        elif el.name == "h4":
            heading, players, slot = text, [], 0
        elif el.name == "p" and heading and "選手" in text:
            players = [p.strip(" 、,") for p in re.findall(r"([^、,]+?)\s*選手", text)]
            players = [p.split("。")[-1].strip() for p in players]  # drop a leading notice sentence
        elif el.name == "a" and heading:
            m = DECKLOG_RE.search(el.get("href", ""))
            if not m:
                continue
            block_m = _BLOCK_RE.search(heading)
            block = f"{block_m.group(1)} Block" if block_m else ""
            team_m = _TEAM_RE.search(heading)
            place = " ".join(filter(None, [_placement(heading), block]))
            # NFKC: reports write handles with fullwidth ＠ etc.; the curated
            # registry uses ASCII.
            player = unicodedata.normalize("NFKC", players[slot]) if slot < len(players) else ""
            slot += 1
            if team_m:
                placement = f"Trio {place} ({unicodedata.normalize('NFKC', team_m.group(1))})"
            else:
                placement = f"{place} ({player})" if player else place
            event = " - ".join(filter(None, [base, fmt, block]))
            entries.append({
                "code": m.group(1),
                "title": "",
                "oshi": "",
                "source": event,
                "event": event,
                "event_date": event_date,
                "placement": placement,
                "report_url": url,
            })
    return entries


def scrape_event_reports(deck_codes_path: Path, output_dir: Path) -> list[dict]:
    """Append winning decks from official event reports to deck_codes.json."""
    client = httpx.Client()
    entries: list[dict] = []
    try:
        listing = _safe_get(client, EVENT_LIST_URL)
        if not listing:
            print("  [warn] Official event-report list unreachable; skipping")
            return []
        soup = BeautifulSoup(listing, "lxml")
        urls = []
        for a in soup.select("a[href]"):
            href = a["href"]
            if "/news/post/" in href:
                full = href if href.startswith("http") else BASE_URL + href
                if full not in urls:
                    urls.append(full)
        for url in urls:
            time.sleep(REQUEST_DELAY)
            html = _safe_get(client, url)
            if html:
                found = parse_report(html, url)
                if found:
                    print(f"  {url}: {len(found)} deck code(s)")
                entries += found
    finally:
        client.close()

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "event_report_decks.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # _merge_into_deck_codes appends blindly: keep only codes the registry
    # (case-insensitive, as Deck Log codes are) doesn't have yet.
    known: set[str] = set()
    if deck_codes_path.exists():
        registry = json.loads(deck_codes_path.read_text(encoding="utf-8"))
        known = {e["code"].upper() for e in registry if e.get("code")}
    new_entries = []
    for entry in entries:
        if entry["code"].upper() not in known:
            known.add(entry["code"].upper())
            new_entries.append(entry)
    merged = _merge_into_deck_codes(deck_codes_path, new_entries)
    print(f"  {len(entries)} deck code(s) in official event reports, {merged} new to {deck_codes_path.name}")
    return entries
