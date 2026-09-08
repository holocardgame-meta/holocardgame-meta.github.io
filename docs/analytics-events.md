# GA4 analytics events

Source of truth for what HOLOCARD META sends to Google Analytics 4. Every
event goes through `trackGaEvent()` in `web/app.js`; the gtag bootstrap and
consent defaults live in `web/index.html`. `scripts/check_key_ga_events.mjs`
(pre-commit + CI) fails when `web/app.js` emits an event that is not listed
here, so update this file together with the code.

## Consent behaviour

GA4 runs in *advanced consent mode*: gtag.js loads lazily on the first
interaction (or after 8 s), and `analytics_storage` stays denied until the
visitor accepts the banner. While denied, GA receives cookieless pings only,
so every event below — including `consent_prompt` and `consent_update` — is
sent in both states. The stored choice lives in `localStorage('holo-consent')`.

## Common parameters (added to every event)

| Parameter | Values | Meaning |
|---|---|---|
| `view_name` | `guides` / `tournament` / `cards` / `rules` | SPA view active when the event fired |
| `site_language` | `zh-TW` / `en` / `ja` / `fr` / `es` | UI language at the time of the event (named `site_language` so it is not confused with the browser Language dimension GA collects on its own) |

## Shared vocabulary

| Parameter | Values | Meaning |
|---|---|---|
| `content_type` | `card` / `deck` / `guide` / `tournament_deck` / `view` | What kind of thing the event is about |
| `content_id` | card id, `deck_id`, Deck Log code, or a view name (when `content_type=view`) | Which one |
| `content_source` | `official` / `tier` / `guide` / `decklog` | Dataset the deck came from: official recommended decks, tier-list decks, deck guides, tournament decks |
| `ui_location` | `guide_list` / `tournament_list` / `card_gallery` / `inline_card` / `sidebar` / `active_filter_bar` | Which control the visitor used |
| `event_role` | `key_event_candidate` | Marks the events meant to be registered as Key events in GA4 Admin (★ below) |

Naming style: `noun_verb` for custom events (`deck_open`, `filter_change`,
`outbound_click`); GA4 recommended names (`page_view`, `select_content`,
`search`, `share`) are used as-is.

## Events

| Event | Parameters | Fires when |
|---|---|---|
| `page_view` | `page_title`, `page_location`, `view_name` | Once at load and on every SPA view change. gtag is configured with `send_page_view: false`, so these are the only page views. |
| `select_content` | `content_type`, `content_id`, `content_source` (decks only), `ui_location` | A list card is clicked. The matching `*_open` event follows through the route. |
| `card_open` | `content_type=card`, `content_id` | The card modal opens (click or direct link). |
| `deck_open` ★ | `event_role`, `content_type` (`deck` / `tournament_deck`), `content_id`, `content_source` | The deck modal opens (click or direct link). |
| `guide_open` ★ | `event_role`, `content_type=guide`, `content_id`, `content_source=guide` | The deck-guide modal opens (click or direct link). |
| `share` | `method` (`web_share` / `clipboard`), `content_type`, `content_id`, `content_source` (decks only) | The share button; the content is the open card, else the open deck/guide, else the current view. |
| `search` | `search_term` | Topbar search, debounced, 2+ characters. Partial terms are recorded while typing. |
| `filter_change` | `filter_type` (`color` / `tier` / `type`), `filter_value`, `filter_state` (`add` / `remove`), `ui_location` (`sidebar` / `active_filter_bar`) | A filter chip is toggled or an active-filter pill removed. |
| `filter_clear` | `filter_type` (`color` / `tier` / `type` / `all`), `ui_location` (`sidebar` / `active_filter_bar`) | A clear button. `all` + `ui_location` tells which clear-all button. |
| `language_change` | `previous_language` (the common `site_language` carries the new one) | The language switcher picks a different language. |
| `outbound_click` | `link_domain`, `link_url` | Any click on a link to another origin. |
| `decklog_click` ★ | `event_role`, `content_id`, `link_domain`, `link_url` | The Deck Log button on a tournament deck (`data-ga-link="decklog"`). |
| `source_guide_click` ★ | `event_role`, `content_id`, `link_domain`, `link_url` | The source link in a deck / guide modal (`data-ga-link="source_guide"`). |
| `consent_prompt` | `prompt_action=show`, `prompt_trigger` (`auto` / `settings`) | The consent banner is shown: automatically on a visit with no stored choice, or reopened from the sidebar "Cookie settings". |
| `consent_update` | `consent_state` (`granted` / `denied`) | A banner decision. |
| `pwa_install_prompt` | `platform` (`ios_safari` / `ios_chrome` / `android_chrome`), `prompt_action` | Install-prompt funnel, see below. |
| `pwa_install_accept` ★ | `event_role`, `platform`, `install_method` (`manual_instructions` / `browser_prompt`) | iOS: "Got it" tapped on the manual instructions (best available proxy — iOS cannot report real installs). Android: the native prompt was accepted. |
| `pwa_installed` ★ | `event_role`, `platform=android_chrome` | The browser's `appinstalled` event. |

`prompt_action` values for `pwa_install_prompt`:

| Value | Platform | Meaning |
|---|---|---|
| `show` | all | Our prompt was displayed |
| `later` | all | "Later" button |
| `acknowledged` | iOS | "Got it" button (also fires `pwa_install_accept`) |
| `install_click` | Android | "Install" button |
| `unavailable` | Android | "Install" clicked but the browser offered no install prompt |
| `browser_prompt_accepted` | Android | The native install prompt outcome (also fires `pwa_install_accept`) |
| `browser_prompt_dismissed` | Android | The native install prompt outcome |

## One action, several events (by design)

- A list-card click sends `select_content` (where it was clicked) and then
  `card_open` / `deck_open` / `guide_open` (what opened). The `*_open` events
  also fire for direct links, so count opens with them and use
  `select_content` for "which list drives the clicks".
- A key outbound link sends `outbound_click` (every external link) plus
  `decklog_click` or `source_guide_click`.
- An Android install sends `pwa_install_prompt{install_click}` →
  `pwa_install_accept` + `pwa_install_prompt{browser_prompt_accepted}` →
  `pwa_installed`. Use `pwa_install_prompt` for the funnel and the ★ events
  for counting.

## GA4 Admin checklist

- **Key events:** `deck_open`, `guide_open`, `decklog_click`,
  `source_guide_click`, `pwa_install_accept`, `pwa_installed`
  (`card_open` optionally).
- **Custom dimensions (event scope)** — custom parameters only show up in
  reports and Explorations once registered (limit 50 per property):
  `view_name`, `site_language`, `content_source`, `ui_location`,
  `filter_type`, `filter_value`, `filter_state`, `prompt_action`,
  `prompt_trigger`, `consent_state`, `platform`, `install_method`,
  `previous_language` (registered 2026-09-08), plus `event_role` if you want
  to filter on it. `content_type`, `content_id`, `search_term`, `method`,
  `link_domain`, `link_url` and `page_title` are built-in dimensions and
  need no registration.
- **Enhanced measurement → Outbound clicks** should be *off* for this
  property; otherwise GA's automatic `click` event double-counts
  `outbound_click`.

## Changelog

### 2026-09-08 — vocabulary cleanup

Renamed (old → new):

| Old | New |
|---|---|
| `item_id` (all events) | `content_id` |
| `select_content.source` | `ui_location` |
| `select_content.content_type = deck_guide` | `deck` or `guide` |
| `click_outbound` | `outbound_click` |
| `filter_clear.filter_type = all_active_bar` | `all` + `ui_location = active_filter_bar` |
| `pwa_install_prompt.prompt_action = dismiss` (iOS) | `acknowledged` |
| `pwa_install_prompt.prompt_action = accepted` / `dismissed` (Android) | `browser_prompt_accepted` / `browser_prompt_dismissed` |
| `share.content_id` (was the URL hash) | `content_type` + `content_id` (+ `content_source`) |
| common `language` | `site_language` |

Removed: `app_name` (constant), `page_path` (GA4 derives it from
`page_location`), `search.search_context` (same as `view_name`),
`language_change.selected_language` (same as the common `language`),
`pwa_install_prompt{installed}` (duplicate of `pwa_installed`).

Added: `card_open`, `consent_prompt`, `consent_update{denied}`,
`ui_location` on `filter_change` / `filter_clear`, `content_source` and
`ui_location` on tournament-deck `select_content`.

Custom dimensions and reports built on the old names keep their history but
stop receiving data once this is deployed; register the new names and
rebuild those reports.
