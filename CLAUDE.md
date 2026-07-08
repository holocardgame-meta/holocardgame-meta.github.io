# Project conventions (holo-card / HOLOCARD META)

Static hOCG meta site: Python scraper → committed JSON → vanilla-JS SPA →
GitHub Pages. No build step, no backend. See README.md for architecture.

## Commands

- Python runs through uv: `uv run python …` (bare `python` may be blocked).
- Tests: `uv run pytest` · Lint: `uv run ruff check scraper scripts tests`
- Frontend guards: `node scripts/check_*.mjs` (all four run in pre-commit and
  CI; pre-commit additionally rebuilds SEO pages first).
- Full pipeline: `uv run python -m scraper.run` (needs `GEMINI_API_KEY`).

## Invariants — break these and CI goes red

- `scripts/check_google_tags.mjs` greps `web/index.html` for **exact literal
  snippets**: `window.HOLOCARD_GA_ID = 'G-8WS4X0WWQQ'`,
  `window.gtag('config', window.HOLOCARD_GA_ID, { send_page_view: false })`,
  `https://www.googletagmanager.com/gtag/js?id=' + window.HOLOCARD_GA_ID`,
  `window.holocardLoadGoogleTag = load`. Refactor the GA snippet around them.
- `scripts/check_key_ga_events.mjs` requires the markers
  `trackGaEvent(openEventName`, `trackKeyOutboundLink(link, url)`,
  `trackGaEvent('pwa_install_accept'`, `trackGaEvent('pwa_installed'`, and the
  `data-ga-link="source_guide"` / `data-ga-link="decklog"` attributes.
- Every new UI string needs a key in **all five** languages in `web/i18n.js`
  (zh-TW, en, ja, fr, es) — there is no fallback translation pipeline for UI.
- Card color hex/aliases live only in `web/utils/colors.js`; never redefine
  per-component color maps.
- Bump `CACHE_NAME` in `web/sw.js` whenever any precached asset changes,
  and add new always-needed modules to `PRECACHE_URLS`.
- `web/data/slug_registry.json` is append-only: a deck_id's slug is permanent.
  Never re-derive or rewrite existing entries; to deliberately rename a page,
  edit that one entry by hand.
- Root `web/index.html` is the template for the five language pages —
  `scripts/build_seo_pages.mjs` copies it with swapped meta, so edit the root
  and regenerate rather than editing `web/<lang>/index.html`.

## Generated / never commit

- `web/deck/` (entity pages + the `/deck/` index — rebuilt in CI before every deploy)
- `translation_cache.json` (GitHub Actions cache; git-history seed fallback)
- `data/` (scraper staging dir; `web/data/` is the published copy)

## Pipeline behavior

- `scraper/run.py` step order matters; `scraper/data_guard.py` aborts the
  publish if any dataset shrinks below 80% of the `web/data/` baseline
  (`DATA_GUARD_BYPASS=1` to override intentionally).
- Scrapers fail soft (skip + log) except `fetch_cards`, which crashes the run.
  The three holocardstrategy.jp scrapers (`scrape_tiers`, `scrape_all_decks`,
  `scrape_all_guides`) also fail soft: on a source-loss error `run.py` leaves the
  staging file absent and `_carry_forward_frozen` restores the last-good
  `web/data/` copy before the guard — a dead source freezes those datasets
  instead of crashing or emptying them (that domain went dead 2026-07). Deploy
  failures auto-file a `pipeline-failure` issue.
- `web/data/meta.json` `generated_at` = data freshness shown in the footer;
  it comes from `build_indexes.py`, not deploy time.

## Analytics / consent

GA4 advanced consent mode: gtag.js always loads lazily; analytics_storage is
denied (cookieless pings only) until the visitor accepts the banner. Stored in
`localStorage('holo-consent')`. Privacy copy lives in `web/privacy.html` (5
languages) — keep it truthful when changing consent behavior.
