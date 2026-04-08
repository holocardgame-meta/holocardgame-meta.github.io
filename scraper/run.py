"""Main entry point: run all scrapers and output JSON to data/."""

import functools
import json
import re
import shutil
from pathlib import Path

from scraper.fetch_cards import fetch_cards
from scraper.scrape_tiers import scrape_tiers
from scraper.scrape_decks import scrape_all_decks, scrape_all_guides
from scraper.scrape_decklog import scrape_decklog
from scraper.scrape_official import scrape_official
from scraper.scrape_rules import scrape_rules
from scraper.scrape_x import scrape_x_posts
from scraper.translate import translate_all


def _assign_tier_to_guides(data_dir: Path):
    """Cross-reference guide titles against tier list to assign tier levels."""
    tier_path = data_dir / "tier_list.json"
    guides_path = data_dir / "all_guides.json"
    if not tier_path.exists() or not guides_path.exists():
        return

    tiers = json.loads(tier_path.read_text(encoding="utf-8"))
    guides = json.loads(guides_path.read_text(encoding="utf-8"))

    lookup: list[tuple[str, int]] = []
    for tier in tiers.get("tiers", []):
        tier_num = tier["tier"]
        for d in tier.get("decks", []):
            if d.get("vtuber"):
                lookup.append((d["vtuber"], tier_num))
            name = d.get("name", "")
            if name:
                core = name.replace("単", "").replace("推し", "").strip()
                if core:
                    lookup.append((core, tier_num))

    lookup.sort(key=lambda x: len(x[0]), reverse=True)

    assigned = 0
    for g in guides:
        if g.get("tier"):
            continue
        title = g.get("title", "")
        if isinstance(title, dict):
            title = title.get("ja", "")
        for keyword, tier_num in lookup:
            if keyword in title:
                g["tier"] = tier_num
                assigned += 1
                break

    guides_path.write_text(json.dumps(guides, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Assigned tier to {assigned}/{len(guides)} guides")


def _inject_lcp_preload(web_dir: Path):
    """Inject a <link rel=preload> for the LCP image into index.html.

    Replicates the guides-view.js combined-list + sort logic so the preload
    tag always points to the first visible guide-card thumbnail.
    """
    index_path = web_dir / "index.html"
    data_dir = web_dir / "data"
    if not index_path.exists():
        return

    def _load(name):
        p = data_dir / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    guides = _load("all_guides.json")
    decks = _load("decks.json")
    officials = _load("official_decks.json")

    combined = []
    for d in officials:
        combined.append({**d, "_src": "official"})
    for d in decks:
        combined.append({**d, "_src": "tier"})
    tier_urls = {d.get("url") for d in decks if d.get("url")}
    for g in guides:
        if g.get("url") not in tier_urls:
            combined.append({**g, "_src": "guide"})

    def _cmp(a, b):
        da, db = a.get("date", "") or "", b.get("date", "") or ""
        if db > da:
            return 1
        if da > db:
            return -1
        return (a.get("tier") or 99) - (b.get("tier") or 99)

    combined.sort(key=functools.cmp_to_key(_cmp))

    lcp_url = None
    for d in combined:
        img = d.get("deck_image") or d.get("oshi_image")
        if img:
            lcp_url = img
            break

    html = index_path.read_text(encoding="utf-8")
    html = re.sub(
        r'\s*<link rel="preload" as="image" href="[^"]*" fetchpriority="high">',
        "",
        html,
    )

    if lcp_url:
        tag = f'\n  <link rel="preload" as="image" href="{lcp_url}" fetchpriority="high">'
        marker = '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
        html = html.replace(marker, marker + tag)
        print(f"  Injected LCP preload: {lcp_url[:80]}...")
    else:
        print("  No LCP image found, skipping.")

    index_path.write_text(html, encoding="utf-8")


def main():
    base = Path(__file__).resolve().parent.parent
    data_dir = base / "data"
    web_data_dir = base / "web" / "data"

    print("=" * 50)
    print("Holo Card Meta Scraper")
    print("=" * 50)

    print("\n[1/10] Fetching cards database...")
    fetch_cards(data_dir)

    print("\n[2/10] Scraping tier list...")
    scrape_tiers(data_dir)

    cards_path = data_dir / "cards.json"

    print("\n[3/10] Scraping tier-linked deck recipes...")
    tier_decks = scrape_all_decks(data_dir / "tier_list.json", data_dir, cards_path)

    print("\n[4/10] Scraping ALL deck guides from holocardstrategy...")
    existing_urls = {d["url"] for d in tier_decks if d.get("url")}
    scrape_all_guides(data_dir, existing_urls, cards_path)

    print("\n[5/10] Assigning tier levels to guides...")
    _assign_tier_to_guides(data_dir)

    print("\n[6/10] Discovering & scraping X posts for tournament results...")
    scrape_x_posts(base / "x_posts.json", base / "deck_codes.json", data_dir)

    print("\n[7/10] Fetching Deck Log decks...")
    scrape_decklog(base / "deck_codes.json", data_dir / "cards.json", data_dir)

    print("\n[8/10] Scraping official recommended decks...")
    scrape_official(data_dir)

    print("\n[9/10] Scraping official rule updates...")
    scrape_rules(data_dir)

    print("\n[10/10] Translating scraped data (ja -> zh-TW, en, fr)...")
    translate_all(data_dir)

    print("\n[Copy] Copying data to web/data/ for frontend...")
    web_data_dir.mkdir(parents=True, exist_ok=True)
    for f in ["cards.json", "tier_list.json", "decks.json", "decklog_decks.json", "all_guides.json", "official_decks.json", "rules.json"]:
        src = data_dir / f
        if src.exists():
            shutil.copy2(src, web_data_dir / f)
            print(f"  Copied {f}")

    print("\n[LCP] Injecting LCP image preload hint...")
    _inject_lcp_preload(base / "web")

    print("\n" + "=" * 50)
    print("Done! Open web/index.html to view the app.")
    print("=" * 50)


if __name__ == "__main__":
    main()
