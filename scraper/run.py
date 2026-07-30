"""Main entry point: run all scrapers and output JSON to data/."""

import functools
import json
import re
import shutil
from pathlib import Path

from scraper.build_indexes import build_frontend_indexes
from scraper.data_guard import enforce as enforce_data_guard
from scraper.fetch_cards import fetch_cards
from scraper.scrape_decklog import scrape_decklog
from scraper.scrape_decks import scrape_all_decks, scrape_all_guides
from scraper.scrape_hocg_logs import scrape_hocg_logs
from scraper.scrape_official import scrape_official
from scraper.scrape_rules import scrape_rules
from scraper.scrape_tiers import scrape_tiers
from scraper.scrape_x import scrape_x_posts
from scraper.translate import translate_all

# Datasets whose only upstream source is holocardstrategy.jp. That domain went
# dead (DNS NXDOMAIN) around 2026-07-06, so these three scrapers now fail soft:
# on a fetch failure we leave the staging file absent and carry the last
# published copy forward from web/data/ (see _carry_forward_frozen). That keeps
# the data guard green and the last-good tier/guide data live instead of
# crashing the whole run at step [2/10].
SOURCE_LOSS_DATASETS = ["tier_list.json", "decks.json", "all_guides.json"]


def _carry_forward_frozen(data_dir: Path, web_data_dir: Path):
    """Restore datasets whose upstream was unreachable this run.

    Runs after translation and before the data guard: any SOURCE_LOSS_DATASETS
    file missing from staging (because its scraper failed soft) is copied back
    from the published web/data/ baseline, so the guard sees no shrink and the
    frozen, already-translated data republishes unchanged.
    """
    for name in SOURCE_LOSS_DATASETS:
        staging = data_dir / name
        if staging.exists():
            continue
        baseline = web_data_dir / name
        if baseline.exists():
            shutil.copy2(baseline, staging)
            print(f"  [carry-forward] {name}: source unreachable, restored last-good copy from web/data/")
        else:
            print(f"  [carry-forward] {name}: source unreachable and no baseline to restore")


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


def _optimize_lcp_image(web_dir: Path, lcp_url: str, suffix: int = 0) -> str | None:
    """Download an LCP image, resize to 400px wide, and save as WebP."""
    import io

    import httpx
    from PIL import Image

    images_dir = web_dir / "images"
    images_dir.mkdir(exist_ok=True)
    out_path = images_dir / f"lcp-hero-{suffix}.webp"

    try:
        resp = httpx.get(lcp_url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        print(f"  Failed to download LCP image {suffix}: {e}")
        return None

    try:
        img = Image.open(io.BytesIO(resp.content))
        max_w = 380
        if img.width > max_w:
            ratio = max_w / img.width
            img = img.resize((max_w, int(img.height * ratio)), Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(out_path, "WEBP", quality=30)
        size_kb = out_path.stat().st_size / 1024
        print(f"  Optimized LCP image {suffix}: {img.width}x{img.height}, {size_kb:.1f} KiB")
        return f"images/lcp-hero-{suffix}.webp"
    except Exception as e:
        print(f"  Failed to optimize LCP image {suffix}: {e}")
        return None


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

    lcp_urls: list[str] = []
    for d in combined:
        img = d.get("deck_image") or d.get("oshi_image")
        if img:
            lcp_urls.append(img)
        if len(lcp_urls) >= 4:
            break

    local_lcps: list[str | None] = []
    for i, url in enumerate(lcp_urls):
        local_lcps.append(_optimize_lcp_image(web_dir, url, suffix=i))

    html = index_path.read_text(encoding="utf-8")
    html = re.sub(
        r'\s*<link rel="preload" as="image" href="[^"]*"[^>]*fetchpriority="high"[^>]*>',
        "",
        html,
    )
    html = re.sub(
        r'\s*<script>window\.__LCP_OPT="[^"]*";</script>',
        "",
        html,
    )
    html = re.sub(
        r'\s*<script>window\.__LCP_OPTS=\[.*?\];</script>',
        "",
        html,
    )

    marker = '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
    preload_tags = ""
    for i, url in enumerate(lcp_urls):
        preload_url = local_lcps[i] or url
        type_attr = ' type="image/webp"' if preload_url.endswith(".webp") else ""
        preload_tags += f'\n  <link rel="preload" as="image" href="{preload_url}"{type_attr} fetchpriority="high">'
        print(f"  Injected LCP preload [{i}]: {preload_url[:80]}...")

    if preload_tags:
        html = html.replace(marker, marker + preload_tags)
    else:
        print("  No LCP images found, skipping.")

    opts = [local_lcps[i] if i < len(local_lcps) and local_lcps[i] else None for i in range(len(lcp_urls))]
    if any(opts):
        opts_js = ",".join(f'"{v}"' if v else "null" for v in opts)
        opt_tag = f'\n  <script>window.__LCP_OPTS=[{opts_js}];</script>'
        html = html.replace("</head>", opt_tag + "\n</head>")
        print(f"  Injected __LCP_OPTS for frontend ({len([o for o in opts if o])} optimized)")

    index_path.write_text(html, encoding="utf-8")


def main():
    base = Path(__file__).resolve().parent.parent
    data_dir = base / "data"
    web_data_dir = base / "web" / "data"

    print("=" * 50)
    print("Holo Card Meta Scraper")
    print("=" * 50)

    print("\n[1/11] Fetching cards database...")
    fetch_cards(data_dir)

    print("\n[2/11] Scraping tier list...")
    try:
        scrape_tiers(data_dir)
    except Exception as exc:
        print(f"  [warn] tier scrape failed ({exc}); carrying forward last-good tier_list.json")
        (data_dir / "tier_list.json").unlink(missing_ok=True)

    cards_path = data_dir / "cards.json"

    print("\n[3/11] Scraping tier-linked deck recipes...")
    tier_decks: list[dict] = []
    if (data_dir / "tier_list.json").exists():
        try:
            tier_decks = scrape_all_decks(data_dir / "tier_list.json", data_dir, cards_path)
        except Exception as exc:
            print(f"  [warn] deck-recipe scrape failed ({exc}); carrying forward last-good decks.json")
            (data_dir / "decks.json").unlink(missing_ok=True)
    else:
        print("  tier_list.json absent (source unreachable); skipping deck-recipe scrape")

    print("\n[4/11] Scraping ALL deck guides from holocardstrategy...")
    existing_urls = {d["url"] for d in tier_decks if d.get("url")}
    try:
        guides = scrape_all_guides(data_dir, existing_urls, cards_path)
        if not guides:
            # Dead source: _discover_all_deck_urls swallows the connection error and
            # returns nothing, so scrape_all_guides writes an empty list. Drop it so
            # the guard doesn't flag an "emptied" dataset — carry-forward restores the
            # last-good guides after translation instead.
            print("  guide discovery returned nothing (source unreachable); dropping empty all_guides.json")
            (data_dir / "all_guides.json").unlink(missing_ok=True)
    except Exception as exc:
        print(f"  [warn] guide scrape failed ({exc}); carrying forward last-good all_guides.json")
        (data_dir / "all_guides.json").unlink(missing_ok=True)

    print("\n[5/11] Assigning tier levels to guides...")
    _assign_tier_to_guides(data_dir)

    print("\n[6/11] Discovering & scraping X posts for tournament results...")
    scrape_x_posts(base / "x_posts.json", base / "deck_codes.json", data_dir)

    print("\n[7/11] Scraping hOCG Logs shop-tournament results...")
    try:
        scrape_hocg_logs(base / "hocg_logs_state.json", base / "deck_codes.json", data_dir)
    except Exception as exc:
        print(f"  [warn] hOCG Logs scrape failed ({exc}); registry keeps existing entries")

    print("\n[8/11] Fetching Deck Log decks...")
    scrape_decklog(
        base / "deck_codes.json",
        data_dir / "cards.json",
        data_dir,
        cache_path=web_data_dir / "decklog_decks.json",
    )

    print("\n[9/11] Scraping official recommended decks...")
    scrape_official(data_dir)

    print("\n[10/11] Scraping official rule updates...")
    scrape_rules(data_dir, web_data_dir)

    print("\n[11/11] Translating scraped data (ja -> zh-TW, en, fr)...")
    translate_all(data_dir)

    print("\n[Carry-forward] Restoring datasets whose source was unreachable this run...")
    _carry_forward_frozen(data_dir, web_data_dir)

    print("\n[Guard] Comparing fresh data against published web/data/ baseline...")
    enforce_data_guard(data_dir, web_data_dir)

    print("\n[Copy] Copying data to web/data/ for frontend...")
    web_data_dir.mkdir(parents=True, exist_ok=True)
    for f in ["cards.json", "tier_list.json", "decks.json", "decklog_decks.json", "all_guides.json", "official_decks.json", "rules.json"]:
        src = data_dir / f
        if src.exists():
            shutil.copy2(src, web_data_dir / f)
            print(f"  Copied {f}")

    print("\n[Index] Building lightweight frontend indexes...")
    build_frontend_indexes(web_data_dir)

    print("\n[LCP] Injecting LCP image preload hint...")
    _inject_lcp_preload(base / "web")

    print("\n" + "=" * 50)
    print("Done! Open web/index.html to view the app.")
    print("=" * 50)


if __name__ == "__main__":
    main()
