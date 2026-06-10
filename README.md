# HOLOCARD META

Fan-made meta database for the hololive OFFICIAL CARD GAME (hOCG / ホロカ):
auto-updated tier list, 100+ deck guides, WGP tournament results, and a
searchable card gallery in five languages (zh-TW / ja / en / fr / es).

**Live site:** https://holocardgame-meta.github.io/

## Architecture

```
weekly cron / manual dispatch
        │
        ▼
scraper/ (Python)
  fetch_cards → scrape_tiers → scrape_decks + scrape_all_guides → scrape_x
  → scrape_decklog → scrape_official → scrape_rules → translate (Gemini)
  → data guard → copy to web/data/ → build_indexes (+ meta.json)
        │
        ▼
web/data/*.json  (committed weekly by CI)
        │
        ├── web/ — no-build vanilla-JS SPA (hash router, i18n, PWA + SW)
        └── scripts/build_seo_pages.mjs — language entry pages,
            /deck/<slug>/ entity pages, sitemap.xml
        │
        ▼
GitHub Pages
```

Key properties:

- **No backend, no build step.** The frontend is plain ES modules; data is
  static JSON fetched lazily per view.
- **Single source of truth for card colors** lives in `web/utils/colors.js`;
  romaji search aliases for talent names in `web/utils/aliases.js`.
- **Translations** (ja→zh-TW/en/fr/es, zh→…, en→…) run through Gemini with an
  hOCG terminology glossary. Results are cached in `translation_cache.json`,
  persisted via GitHub Actions cache (not git) and seeded from git history on
  a cold cache.
- **Data guard** (`scraper/data_guard.py`) refuses to publish any dataset that
  shrinks below 80% of the published baseline — a source-site redesign fails
  the run instead of silently shipping a gutted site.

## URL structure

| URL | What it is |
|---|---|
| `/#guides` `/#tournament` `/#cards` `/#rules` | SPA views (hash-routed) |
| `/#deck/<id>` `/#tdeck/<code>` `/#card/<id>` | Shareable deep links to modals; nested `/#deck/<id>/card/<id>` works |
| `/deck/<slug>/` | Static, indexable per-deck summary pages (~144), generated at build time |
| `/zh-TW/` `/ja/` `/en/` `/fr/` `/es/` | Language entry pages (full SPA copies with localized meta) |
| `/privacy.html` | Privacy policy (5 languages) |

Entity slugs are human-readable (derived from English titles, falling back to
talent romaji) and **permanently frozen** in `web/data/slug_registry.json` on
first assignment — source-title edits or later name collisions can never move
a published URL. To intentionally rename a page, edit its registry entry.

## CI/CD

`deploy.yml` has three paths:

| Trigger | Behavior |
|---|---|
| Push to `master` | Frontend checks → build SEO/entity pages from committed data → deploy |
| Weekly cron (Mon 06:00 UTC) or manual dispatch | Restore translation cache → scrape + translate → **data guard** → rebuild SEO pages with fresh data → commit `web/data/` + `sitemap.xml` → deploy |
| Any job failure | `alert-on-failure` opens or updates a `pipeline-failure` issue |

`ci.yml` runs ruff + pytest + frontend checks on every push/PR;
`guard-google-tags.yml` protects the GA / site-verification tags.

## Local development

```bash
uv sync                              # install dependencies
$env:GEMINI_API_KEY="your-key"       # PowerShell (Linux/Mac: export GEMINI_API_KEY=...)

uv run python -m scraper.run         # full scrape + translate + guard + indexes
uv run python -m http.server 8080 --directory web   # serve frontend

uv run pytest                        # 35 tests (parser fixtures, data guard, indexes)
uv run ruff check scraper scripts tests

node scripts/build_seo_pages.mjs     # regenerate language/entity pages + sitemap
node scripts/check_seo_pages.mjs     # …and the other check_*.mjs guards
uv run python scripts/build_og_image.py   # re-render og-image.png (needs local Chrome)
```

Pre-commit hooks (`.githooks/`, enabled via `core.hooksPath`) rebuild the SEO
pages and run all four frontend check scripts on every commit.

## Operations runbook

- **Data guard tripped intentionally?** (e.g. a real content purge upstream)
  → re-run with `DATA_GUARD_BYPASS=1`.
- **Pipeline failing?** Check the auto-filed `pipeline-failure` issue for the
  run link; the stale-but-complete site stays live until a run succeeds.
- **Cold translation cache?** The deploy workflow self-seeds from the last
  committed copy in git history; nothing to do.
- **Changed any precached asset?** Bump `CACHE_NAME` in `web/sw.js`.
- **Analytics/consent:** GA4 runs in *advanced consent mode* — gtag.js always
  loads lazily, but only cookieless anonymous pings are sent until the visitor
  accepts the banner. Choice is stored in `localStorage('holo-consent')`.

## Data sources

- Card data: [hololive-cardgame/cards](https://github.com/hololive-cardgame/cards) (1,700+ cards)
- Tier list & deck guides: [ホロカ攻略ギルド](https://www.holocardstrategy.jp/)
- Tournament decks: Bushiroad Deck Log (via @hololive_OCG result posts)
- Official recommended decks & rules: [hololive OFFICIAL CARD GAME](https://hololive-official-cardgame.com/)

## Disclaimer

Fan-made project, not affiliated with COVER Corp. or Bushiroad.
All card data and images © 2016 COVER Corp. / hololive OFFICIAL CARD GAME.
