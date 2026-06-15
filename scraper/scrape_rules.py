"""Scrape official rule articles from hololive-official-cardgame.com/cat_news/rule/."""

import json
import re
import time
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

BASE_URL = "https://hololive-official-cardgame.com"
RULE_LIST_URL = f"{BASE_URL}/cat_news/rule/"
DECK_RULES_SLUG = "rule01"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; HoloCardMeta/1.0)"}
REQUEST_DELAY = 1.5

CARD_ID_RE = re.compile(r"h[A-Z]{1,4}\d{2}-\d{3}")

# The source site retired its static restricted-card page (rule01, now 404) in
# favour of dated news posts that announce *changes* in prose. Each operative
# card is tagged 制限カード：「ID」 (newly restricted) or 制限解除カード：「ID」
# (restriction lifted); all other card IDs in the body are contextual mentions.
# 制限カード：「…」 cannot match inside 制限解除カード：「…」 (解除 breaks the run),
# so the two patterns never overlap.
RESTRICT_ADD_RE = re.compile(r"制限カード[：:\s]*「([^」]*)」")
RESTRICT_REMOVE_RE = re.compile(r"制限解除カード[：:\s]*「([^」]*)」")


def _fetch(url: str) -> str | None:
    try:
        resp = httpx.get(url, timeout=30, follow_redirects=True, headers=HEADERS)
        if resp.status_code == 200:
            return resp.text
    except httpx.HTTPError as e:
        print(f"  [WARN] Failed to fetch {url}: {e}")
    return None


def _collect_rule_urls() -> list[dict]:
    """Crawl the rule listing page and extract article links with dates."""
    html = _fetch(RULE_LIST_URL)
    if not html:
        return []

    soup = BeautifulSoup(html, "lxml")
    results = []

    for a_tag in soup.select("a[href]"):
        href = a_tag["href"]
        if "/news/post/" not in href:
            continue
        text = a_tag.get_text(" ", strip=True)
        if "Rule" not in text:
            continue

        if not href.startswith("http"):
            href = BASE_URL + href

        date_m = re.search(r"(\d{4})\.(\d{2})\.(\d{2})", text)
        date_str = f"{date_m.group(1)}-{date_m.group(2)}-{date_m.group(3)}" if date_m else ""

        slug = href.rstrip("/").split("/")[-1]
        results.append({"url": href, "date": date_str, "slug": slug})

    seen = set()
    unique = []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)
    return unique


def _classify_article(title: str, slug: str) -> str:
    """Determine article type from title text."""
    if slug == DECK_RULES_SLUG:
        return "deck_rules"
    if "裁定変更" in title:
        return "errata"
    if "制限カード解除" in title and "追加" not in title:
        return "unrestricted"
    if "制限カード" in title:
        return "restricted"
    return "rule_update"


def _parse_restriction_deltas(body_text: str) -> tuple[list[str], list[str]]:
    """Return (added, removed) restricted-card IDs marked in a restriction post.

    Only cards tagged with the 制限カード：「…」 / 制限解除カード：「…」 markers are
    returned; contextual card mentions elsewhere in the prose are ignored.
    """
    removed: list[str] = []
    for m in RESTRICT_REMOVE_RE.finditer(body_text):
        removed.extend(CARD_ID_RE.findall(m.group(1)))
    added: list[str] = []
    for m in RESTRICT_ADD_RE.finditer(body_text):
        added.extend(CARD_ID_RE.findall(m.group(1)))
    return list(dict.fromkeys(added)), list(dict.fromkeys(removed))


def _resolve_restricted_cards(
    seed: list[str],
    seed_date: str,
    restriction_posts: list[tuple[str, list[str], list[str]]],
) -> list[str]:
    """Carry the last published restricted list forward, applying new deltas.

    ``seed`` / ``seed_date`` come from the previously published rules.json. Only
    posts dated *after* seed_date are applied: older changes are already baked
    into the seed, and replaying them is unsafe because the source reuses post
    slugs and no longer serves its superseded posts. Add/remove are idempotent
    set operations, so a delta that is re-seen on a later run is a no-op.
    """
    current = list(dict.fromkeys(seed))
    for date, added, removed in sorted(restriction_posts, key=lambda p: p[0]):
        if date <= seed_date:
            continue
        rm = set(removed)
        current = [c for c in current if c not in rm]
        for cid in added:
            if cid not in current:
                current.append(cid)
        print(f"    Applied restriction delta [{date}]: +{added or '[]'} -{removed or '[]'}")
    return current


def _scrape_article(url: str) -> dict | None:
    """Scrape a single rule article page."""
    html = _fetch(url)
    if not html:
        return None

    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""

    body_el = (
        soup.select_one(".article-inner")
        or soup.select_one(".post-content")
        or soup.select_one(".news-detail")
        or soup.select_one("article")
        or soup.find("body")
    )
    body_text = body_el.get_text(" ", strip=True) if body_el else ""

    card_ids = list(dict.fromkeys(CARD_ID_RE.findall(body_text)))

    return {"title": title, "body_text": body_text, "card_ids": card_ids, "soup": soup}


def _build_errata_map(articles: list[dict]) -> dict:
    """Build a mapping of card_id -> errata info from errata-type articles."""
    errata = {}
    for art in articles:
        if art["type"] != "errata":
            continue
        for cid in art.get("card_ids", []):
            if cid not in errata:
                errata[cid] = {
                    "date": art["date"],
                    "url": art["url"],
                    "title": art["title"],
                }
    return errata


def _load_restricted_seed(baseline_dir: Path | None) -> tuple[list[str], str]:
    """Read the previously published restricted list and its snapshot date."""
    if baseline_dir is None:
        return [], ""
    baseline_path = baseline_dir / "rules.json"
    if not baseline_path.exists():
        return [], ""
    try:
        prev = json.loads(baseline_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return [], ""
    return list(prev.get("restricted_cards") or []), prev.get("scraped_at") or ""


def scrape_rules(output_dir: Path, baseline_dir: Path | None = None) -> dict:
    """Scrape all official rule articles and output rules.json.

    ``baseline_dir`` (the published web/data/) seeds the restricted-card list:
    the source no longer hosts a canonical current-list page, so the prior list
    is carried forward and newly-announced add/remove deltas are applied.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    seed, seed_date = _load_restricted_seed(baseline_dir)

    print("  Collecting rule article URLs...")
    entries = _collect_rule_urls()
    print(f"  Found {len(entries)} rule articles")

    articles = []
    restriction_posts: list[tuple[str, list[str], list[str]]] = []

    for i, entry in enumerate(entries):
        print(f"  [{i+1}/{len(entries)}] {entry['url']}")
        result = _scrape_article(entry["url"])
        if not result:
            continue

        art_type = _classify_article(result["title"], entry["slug"])

        added, removed = _parse_restriction_deltas(result["body_text"])
        if added or removed:
            restriction_posts.append((entry["date"], added, removed))

        article = {
            "url": entry["url"],
            "date": entry["date"],
            "slug": entry["slug"],
            "title": result["title"],
            "type": art_type,
            "card_ids": result["card_ids"],
        }
        articles.append(article)
        time.sleep(REQUEST_DELAY)

    restricted_cards = _resolve_restricted_cards(seed, seed_date, restriction_posts)
    print(f"    Current restricted cards: {restricted_cards}")

    errata_map = _build_errata_map(articles)

    rules_data = {
        "scraped_at": datetime.now().strftime("%Y-%m-%d"),
        "restricted_cards": restricted_cards,
        "errata": errata_map,
        "articles": articles,
    }

    out_path = output_dir / "rules.json"
    out_path.write_text(json.dumps(rules_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Saved rules to {out_path}")
    print(f"  Restricted: {len(restricted_cards)} cards | Errata: {len(errata_map)} cards | Articles: {len(articles)}")
    return rules_data


if __name__ == "__main__":
    scrape_rules(Path("data"))
