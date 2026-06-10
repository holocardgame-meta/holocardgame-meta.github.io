import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEO_METADATA,
  SITE_URL,
  SUPPORTED_LANGS,
  getAlternateLinks,
  getLanguageUrl,
} from '../web/seo-config.mjs';
import { NAME_ALIASES } from '../web/utils/aliases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'web');
const dataDir = path.join(webDir, 'data');
const rootIndexPath = path.join(webDir, 'index.html');
const rootHtml = fs.readFileSync(rootIndexPath, 'utf8');

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function alternateLinkTags() {
  return getAlternateLinks()
    .map(link => `  <link rel="alternate" hreflang="${link.hreflang}" href="${link.href}">`)
    .join('\n');
}

function localeAlternateTags(currentLocale) {
  return SUPPORTED_LANGS
    .map(lang => SEO_METADATA[lang].locale)
    .filter(locale => locale !== currentLocale)
    .map(locale => `  <meta property="og:locale:alternate" content="${locale}">`)
    .join('\n');
}

function replaceMetaContent(html, selector, content) {
  const escaped = escapeAttr(content);
  return html.replace(
    new RegExp(`(<meta\\b(?=[^>]*${selector})[^>]*\\bcontent=)["'][^"']*["']([^>]*>)`, 'i'),
    `$1"${escaped}"$2`,
  );
}

function replaceLinkHref(html, rel, href) {
  const escaped = escapeAttr(href);
  return html.replace(
    new RegExp(`(<link\\b(?=[^>]*\\brel=["']${rel}["'])[^>]*\\bhref=)["'][^"']*["']([^>]*>)`, 'i'),
    `$1"${escaped}"$2`,
  );
}

function applyMetadata(html, metadata, url) {
  let out = html;
  out = out.replace(/<html lang="[^"]*">/i, `<html lang="${metadata.htmlLang}">`);
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${metadata.title}</title>`);
  out = replaceMetaContent(out, 'name=["\']description["\']', metadata.description);
  out = replaceMetaContent(out, 'property=["\']og:title["\']', metadata.title);
  out = replaceMetaContent(out, 'property=["\']og:description["\']', metadata.description);
  out = replaceMetaContent(out, 'property=["\']og:url["\']', url);
  out = replaceMetaContent(out, 'property=["\']og:locale["\']', metadata.locale);
  out = replaceMetaContent(out, 'name=["\']twitter:title["\']', metadata.title);
  out = replaceMetaContent(out, 'name=["\']twitter:description["\']', metadata.description);
  out = replaceLinkHref(out, 'canonical', url);
  out = out.replace(
    /(?:\r?\n[ \t]*<link rel="alternate" hreflang="[^"]+" href="[^"]+">)+/i,
    `\n${alternateLinkTags()}`,
  );
  out = out.replace(
    /(?:\r?\n[ \t]*<meta property="og:locale:alternate" content="[^"]+">)+/i,
    `\n${localeAlternateTags(metadata.locale)}`,
  );
  return out;
}

function buildLanguagePage(lang) {
  const metadata = SEO_METADATA[lang];
  const url = getLanguageUrl(lang);
  let html = applyMetadata(rootHtml, metadata, url);
  if (!html.includes('<base href="../">')) {
    html = html.replace(
      /(<meta name="viewport"[^>]*>)/i,
      `$1\n  <base href="../">`,
    );
  }
  return html;
}

// ── Per-entity static pages (/deck/<slug>/) ────────────────────────────────
// Indexable summary pages for deck guides, tier decks, and official decks:
// title, excerpt, card list (facts only — no full strategy text), and a CTA
// into the SPA hash route. Built fresh on every run and not committed
// (web/deck/ is gitignored); CI regenerates before each Pages upload.

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Serialized JSON-LD goes inside a <script> tag — escape "<" so scraped
// titles/card names can never terminate the tag.
function jsonLdScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function localizedText(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value['zh-TW'] ?? value.ja ?? value.en ?? Object.values(value)[0] ?? '';
}

function entityHash(deckId) {
  return crypto.createHash('sha1').update(String(deckId)).digest('hex').slice(0, 8);
}

function slugifyAscii(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// Scan JP text for known talent names and return their iconic romaji tokens.
function talentTokens(text) {
  const found = [];
  for (const [jp, alias] of Object.entries(NAME_ALIASES)) {
    if (text.includes(jp)) {
      const words = alias.split(' ');
      const token = words[1] || words[0];
      if (token && !found.includes(token)) found.push(token);
      if (found.length >= 2) break;
    }
  }
  return found;
}

// Human-readable slug: english title -> talent romaji -> hash fallback.
// Collisions are resolved order-independently: every member of a colliding
// group gets its deck_id hash appended, so reordering source data can never
// swap two URLs between entities.
// Stripped wherever they appear (titles bury these mid-string too).
const SLUG_BOILERPLATE = [
  'deck-recipe-and-how-to-play',
  'deck-recipe-how-to-play',
  'recipe-and-how-to-play',
  'deck-build-and-strategy',
  'and-how-to-play',
  'how-to-play',
  'deck-recipe',
];

function readableSlug(e) {
  const jaText = [localizedText(e.title, 'ja'), e.oshi || ''].join(' ');
  const talents = talentTokens(jaText);
  const talentForm = talents.length
    ? `${talents.join('-')}-${e.kind === 'official' ? 'official-deck' : 'deck'}`
    : '';

  const enTitle = localizedText(e.title, 'en');
  let slug = slugifyAscii(enTitle)
    .replace(/^hocg-/, '')
    .replace(/-hocg-/g, '-');
  for (const phrase of SLUG_BOILERPLATE) {
    const trimmed = slug.split(phrase).join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').replace(/^for-/, '');
    if (trimmed.replace(/-/g, '').length >= 8) slug = trimmed;
  }
  if (slug.length > 45) {
    // Mis-scraped titles (strategy text leaking into the title field) — use
    // the talent form when one is identifiable, else hard-cap on a word boundary.
    if (talentForm) return talentForm;
    slug = slug.slice(0, 45);
    const cut = slug.lastIndexOf('-');
    if (cut > 20) slug = slug.slice(0, cut);
    slug = slug.replace(/-+$/, '');
  }
  if (slug.replace(/-/g, '').length >= 8) return slug;
  if (talentForm) return talentForm;
  return `deck-${entityHash(e.deckId)}`;
}

// Slug registry: once a deck_id is assigned a slug it keeps it forever, even
// if the source title is edited/re-translated or a later deck collides with
// its base form. Lives in web/data/ so the CI data commit persists it.
const registryPath = path.join(dataDir, 'slug_registry.json');

function assignSlugs(entities) {
  const registry = loadJson(registryPath, {});
  const taken = new Set(Object.values(registry));
  const slugs = new Map();
  const newcomers = [];

  for (const e of entities) {
    if (registry[e.deckId]) {
      slugs.set(e.deckId, registry[e.deckId]);
    } else {
      newcomers.push(e);
    }
  }

  // Group same-run newcomers by base slug so a batch collision is resolved
  // order-independently (all members get their hash); registered slugs are
  // never disturbed — a clashing newcomer is the one that gets suffixed.
  const groups = new Map();
  for (const e of newcomers) {
    const base = readableSlug(e);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(e);
  }
  for (const [base, members] of groups) {
    for (const e of members) {
      let slug = members.length === 1 && !taken.has(base) ? base : `${base}-${entityHash(e.deckId)}`;
      while (taken.has(slug)) slug = `${slug}-${entityHash(slug + e.deckId)}`;
      taken.add(slug);
      slugs.set(e.deckId, slug);
      registry[e.deckId] = slug;
    }
  }

  if (newcomers.length) {
    const sorted = Object.fromEntries(Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(registryPath, JSON.stringify(sorted, null, 2) + '\n');
  }
  return slugs;
}

function collectEntities() {
  const guidesIndex = loadJson(path.join(dataDir, 'guides_index.json'), []);
  const tierDecks = loadJson(path.join(dataDir, 'decks.json'), []);
  const officialDecks = loadJson(path.join(dataDir, 'official_decks.json'), []);
  const cardIndex = loadJson(path.join(dataDir, 'card_index.json'), []);
  const cardNames = new Map(cardIndex.map(c => [c.id, c.name]));

  const entities = [];
  const seen = new Set();
  const push = (e) => {
    if (e.deckId && !seen.has(e.deckId)) {
      seen.add(e.deckId);
      entities.push(e);
    }
  };

  for (const d of officialDecks) {
    push({
      deckId: d.deck_id,
      kind: 'official',
      title: d.title,
      description: d.description,
      date: d.date || '',
      oshi: d.oshi || '',
      image: d.oshi_image || '',
      sourceUrl: d.url || '',
      sourceName: 'hololive OFFICIAL CARD GAME',
      cards: (d.main_deck || []).map(c => ({
        name: cardNames.get(c.card_id) || c.card_id,
        card_id: c.card_id,
        count: c.count,
      })),
    });
  }
  for (const d of tierDecks) {
    push({
      deckId: d.deck_id,
      kind: 'tier',
      title: d.title,
      description: d.description,
      date: d.date || '',
      tier: d.tier,
      image: d.deck_image || '',
      sourceUrl: d.url || '',
      sourceName: 'ホロカ攻略ギルド',
      cards: (d.cards || []).map(c => ({ name: c.name, card_id: c.card_id })),
    });
  }
  for (const g of guidesIndex) {
    const detail = g.detail_path ? loadJson(path.join(webDir, g.detail_path), null) : null;
    push({
      deckId: g.deck_id,
      kind: 'guide',
      title: g.title,
      description: g.description,
      date: g.date || '',
      tier: g.tier,
      image: g.deck_image || g.oshi_image || '',
      sourceUrl: g.url || '',
      sourceName: 'ホロカ攻略ギルド',
      cards: ((detail && detail.cards) || []).map(c => ({ name: c.name, card_id: c.card_id })),
    });
  }
  return entities;
}

function entityHeadline(e) {
  return localizedText(e.title, 'zh-TW') || localizedText(e.title, 'ja')
    || localizedText(e.title, 'en') || e.deckId;
}

function entityBadge(e) {
  return e.tier ? `Tier ${e.tier}` : e.kind === 'official' ? 'OFFICIAL' : 'GUIDE';
}

// Deterministic "related decks" per entity: shared talent (romaji token)
// outweighs same tier, which outweighs same kind; ties broken by date desc
// then deckId so a re-run with identical data renders identical pages.
function computeRelated(entities, slugs) {
  const tokens = new Map(entities.map(e => [
    e.deckId,
    new Set(talentTokens([localizedText(e.title, 'ja'), e.oshi || ''].join(' '))),
  ]));
  const related = new Map();
  for (const e of entities) {
    const mine = tokens.get(e.deckId);
    const scored = [];
    for (const o of entities) {
      if (o.deckId === e.deckId) continue;
      let score = 0;
      for (const tk of tokens.get(o.deckId)) if (mine.has(tk)) score += 100;
      if (e.tier && o.tier && String(e.tier) === String(o.tier)) score += 10;
      if (o.kind === e.kind) score += 1;
      if (score > 0) scored.push({ o, score });
    }
    scored.sort((a, b) =>
      b.score - a.score
      || String(b.o.date || '').localeCompare(String(a.o.date || ''))
      || String(a.o.deckId).localeCompare(String(b.o.deckId)));
    related.set(e.deckId, scored.slice(0, 6).map(({ o }) => ({
      slug: slugs.get(o.deckId),
      headline: entityHeadline(o),
      badge: entityBadge(o),
    })));
  }
  return related;
}

function buildEntityPage(e, slug, related = []) {
  const url = `${SITE_URL}deck/${slug}/`;
  const zhTitle = localizedText(e.title, 'zh-TW');
  const jaTitle = localizedText(e.title, 'ja');
  const enTitle = localizedText(e.title, 'en');
  const zhDesc = localizedText(e.description, 'zh-TW');
  const enDesc = localizedText(e.description, 'en');
  const jaDesc = localizedText(e.description, 'ja');
  const headline = entityHeadline(e);
  const kindLabel = e.kind === 'official'
    ? 'hOCG 官方推薦牌組'
    : e.tier ? `hOCG Tier ${e.tier} 牌組攻略` : 'hOCG 牌組攻略';
  const pageTitle = `${headline}｜${kindLabel} | HOLOCARD META`;
  const metaDesc = (zhDesc || enDesc || jaDesc || `hOCG deck recipe: ${headline}`).replace(/\s+/g, ' ').slice(0, 155);
  const ogImage = /^https?:\/\//.test(e.image || '') ? e.image : `${SITE_URL}og-image.png`;
  const hashRoute = `/#deck/${encodeURIComponent(e.deckId)}`;
  const badge = entityBadge(e);
  const cards = (e.cards || []).filter(c => c && c.name).slice(0, 60);

  const metaBits = [
    `<span class="badge">${escapeHtml(badge)}</span>`,
    e.oshi ? `<span>${escapeHtml(e.oshi)}</span>` : '',
    e.date ? `<time datetime="${escapeHtml(String(e.date).slice(0, 10))}">${escapeHtml(String(e.date).slice(0, 10))}</time>` : '',
  ].filter(Boolean).join('\n        ');

  const descBlocks = [
    zhDesc && `<p lang="zh-TW">${escapeHtml(zhDesc)}</p>`,
    enDesc && enDesc !== zhDesc && `<p lang="en">${escapeHtml(enDesc)}</p>`,
    jaDesc && jaDesc !== zhDesc && jaDesc !== enDesc && `<p lang="ja">${escapeHtml(jaDesc)}</p>`,
  ].filter(Boolean).join('\n      ');

  const cardsHtml = cards.length ? `
    <section>
      <h2>採用卡片 / Cards <span class="count">${cards.length}</span></h2>
      <ul class="cards">
${cards.map(c => `        <li>${c.count ? `<strong>${escapeHtml(c.count)}×</strong> ` : ''}${escapeHtml(c.name)}${c.card_id ? ` <code>${escapeHtml(c.card_id)}</code>` : ''}</li>`).join('\n')}
      </ul>
    </section>` : '';

  const relatedHtml = related.length ? `
    <section>
      <h2>相關牌組 / Related Decks</h2>
      <ul class="related">
${related.map(r => `        <li><a href="/deck/${r.slug}/">${escapeHtml(r.headline)}</a> <span class="rel-badge">${escapeHtml(r.badge)}</span></li>`).join('\n')}
      </ul>
    </section>` : '';

  const jsonLd = jsonLdScript([
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline,
      description: metaDesc,
      image: ogImage,
      ...(e.date ? { datePublished: String(e.date).slice(0, 10) } : {}),
      inLanguage: 'zh-TW',
      mainEntityOfPage: url,
      ...(e.sourceName ? { author: { '@type': 'Organization', name: e.sourceName } } : {}),
      publisher: { '@type': 'Organization', name: 'HOLOCARD META' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'HOLOCARD META', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: '牌組一覽 / Decks', item: `${SITE_URL}deck/` },
        { '@type': 'ListItem', position: 3, name: headline, item: url },
      ],
    },
    ...(cards.length ? [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${headline} — 採用卡片 / Card List`,
      numberOfItems: cards.length,
      itemListElement: cards.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.count ? `${c.name} ×${c.count}` : c.name,
      })),
    }] : []),
  ]);

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <link rel="canonical" href="${escapeHtml(url)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root { --bg-0: #0a0e1f; --bg-2: #161d3e; --border: #3a3258; --text-1: #f0e6d2; --text-2: #b5a98b; --accent: #f4c842; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg-0); color: var(--text-1); font-family: 'Noto Sans TC', 'Noto Sans JP', system-ui, sans-serif; line-height: 1.7; padding: 2rem 1.25rem 4rem; }
    main { max-width: 720px; margin: 0 auto; }
    .home { color: var(--text-2); font-size: .85rem; }
    .home a { color: var(--text-2); text-decoration: none; }
    .home a:hover { color: var(--text-1); }
    h1 { font-size: 1.45rem; margin: 1rem 0 .35rem; }
    .sub { color: var(--text-2); margin-bottom: .8rem; }
    .meta { display: flex; gap: .7rem; align-items: center; color: var(--text-2); font-size: .85rem; margin-bottom: 1.4rem; }
    .badge { background: var(--accent); color: #1a0e02; font-weight: 700; font-size: .72rem; padding: .15rem .5rem; border-radius: 4px; letter-spacing: .04em; }
    section, .desc { border: 1px solid var(--border); background: var(--bg-2); border-radius: 10px; padding: 1.1rem 1.4rem; margin-bottom: 1.1rem; }
    .desc p { color: var(--text-2); font-size: .92rem; margin-bottom: .5rem; }
    h2 { font-size: 1rem; color: var(--accent); margin-bottom: .7rem; }
    h2 .count { color: var(--text-2); font-weight: 400; font-size: .85rem; }
    .cards { list-style: none; columns: 2; column-gap: 2rem; }
    .cards li { font-size: .88rem; color: var(--text-2); padding: .18rem 0; break-inside: avoid; }
    .cards strong { color: var(--text-1); }
    .related { list-style: none; }
    .related li { font-size: .9rem; padding: .22rem 0; }
    .related a { color: var(--text-1); text-decoration: none; }
    .related a:hover { color: var(--accent); }
    .rel-badge { color: var(--text-2); font-size: .72rem; border: 1px solid var(--border); border-radius: 4px; padding: .05rem .35rem; margin-left: .3rem; }
    code { font-size: .78rem; color: var(--accent); opacity: .8; }
    .cta { display: inline-block; background: var(--accent); color: #1a0e02; font-weight: 700; text-decoration: none; padding: .65rem 1.4rem; border-radius: 8px; margin: .4rem 0 1rem; }
    .source, footer { color: var(--text-2); font-size: .8rem; }
    .source a, footer a { color: var(--accent); }
    footer { margin-top: 2rem; }
    @media (max-width: 540px) { .cards { columns: 1; } }
  </style>
</head>
<body>
  <main>
    <nav class="home" aria-label="Breadcrumb"><a href="/">HOLOCARD META</a> <span aria-hidden="true">›</span> <a href="/deck/">牌組一覽 / Decks</a></nav>
    <h1>${escapeHtml(headline)}</h1>
    ${jaTitle && jaTitle !== headline ? `<div class="sub" lang="ja">${escapeHtml(jaTitle)}</div>` : ''}
    <div class="meta">
        ${metaBits}
    </div>
    ${descBlocks ? `<div class="desc">
      ${descBlocks}
    </div>` : ''}
    ${cardsHtml}
    ${relatedHtml}
    <a class="cta" href="${escapeHtml(hashRoute)}">在 HOLOCARD META 開啟完整內容 / Open in app →</a>
    ${e.sourceUrl ? `<p class="source">出典 / Source: <a href="${escapeHtml(e.sourceUrl)}" rel="noopener nofollow" target="_blank">${escapeHtml(e.sourceName || e.sourceUrl)}</a></p>` : ''}
    <footer>Fan-made. Card data © 2016 COVER Corp. / hololive OFFICIAL CARD GAME · <a href="/privacy.html">Privacy</a></footer>
  </main>
</body>
</html>
`;
}

// ── /deck/ index page ──────────────────────────────────────────────────────
// Crawlable directory of every entity page so none of them is an orphan:
// root footer links here, this page links to all 144+, each entity page
// links back. Grouped by kind; deterministic ordering (tier asc, date desc).

function buildDeckIndexPage(entities, slugs) {
  const url = `${SITE_URL}deck/`;
  const pageTitle = `hOCG 牌組一覽（${entities.length} 副）｜Tier 牌組・攻略・官方推薦 | HOLOCARD META`;
  const metaDesc = `hololive OFFICIAL CARD GAME (hOCG / ホロカ) 全部 ${entities.length} 副牌組一覽：環境 Tier 牌組、牌組攻略與官方推薦牌組，附完整卡表。`;

  const byDateDesc = (a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.deckId).localeCompare(String(b.deckId));
  const groups = [
    {
      heading: '環境 Tier 牌組 / Tier Decks',
      items: entities.filter(e => e.kind === 'tier')
        .sort((a, b) => String(a.tier || '9').localeCompare(String(b.tier || '9')) || byDateDesc(a, b)),
    },
    { heading: '牌組攻略 / Deck Guides', items: entities.filter(e => e.kind === 'guide').sort(byDateDesc) },
    { heading: '官方推薦牌組 / Official Decks', items: entities.filter(e => e.kind === 'official').sort(byDateDesc) },
  ].filter(g => g.items.length);

  const sectionsHtml = groups.map(g => `
    <section>
      <h2>${escapeHtml(g.heading)} <span class="count">${g.items.length}</span></h2>
      <ul class="related">
${g.items.map(e => {
    const date = String(e.date || '').slice(0, 10);
    return `        <li><a href="/deck/${slugs.get(e.deckId)}/">${escapeHtml(entityHeadline(e))}</a> <span class="rel-badge">${escapeHtml(entityBadge(e))}</span>${date ? ` <time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>` : ''}</li>`;
  }).join('\n')}
      </ul>
    </section>`).join('\n');

  const jsonLd = jsonLdScript([
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'hOCG 牌組一覽 / All Deck Recipes',
      description: metaDesc,
      url,
      inLanguage: 'zh-TW',
      isPartOf: { '@type': 'WebSite', name: 'HOLOCARD META', url: SITE_URL },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'HOLOCARD META', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: '牌組一覽 / Decks', item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'hOCG 牌組一覽 / All Deck Recipes',
      numberOfItems: entities.length,
      itemListElement: groups.flatMap(g => g.items).map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: entityHeadline(e),
        url: `${SITE_URL}deck/${slugs.get(e.deckId)}/`,
      })),
    },
  ]);

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <link rel="canonical" href="${escapeHtml(url)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${SITE_URL}og-image.png">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root { --bg-0: #0a0e1f; --bg-2: #161d3e; --border: #3a3258; --text-1: #f0e6d2; --text-2: #b5a98b; --accent: #f4c842; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg-0); color: var(--text-1); font-family: 'Noto Sans TC', 'Noto Sans JP', system-ui, sans-serif; line-height: 1.7; padding: 2rem 1.25rem 4rem; }
    main { max-width: 880px; margin: 0 auto; }
    .home { color: var(--text-2); font-size: .85rem; }
    .home a { color: var(--text-2); text-decoration: none; }
    .home a:hover { color: var(--text-1); }
    h1 { font-size: 1.45rem; margin: 1rem 0 .35rem; }
    .sub { color: var(--text-2); margin-bottom: 1.4rem; }
    section { border: 1px solid var(--border); background: var(--bg-2); border-radius: 10px; padding: 1.1rem 1.4rem; margin-bottom: 1.1rem; }
    h2 { font-size: 1rem; color: var(--accent); margin-bottom: .7rem; }
    h2 .count { color: var(--text-2); font-weight: 400; font-size: .85rem; }
    .related { list-style: none; }
    .related li { font-size: .9rem; padding: .22rem 0; }
    .related a { color: var(--text-1); text-decoration: none; }
    .related a:hover { color: var(--accent); }
    .rel-badge { color: var(--text-2); font-size: .72rem; border: 1px solid var(--border); border-radius: 4px; padding: .05rem .35rem; margin-left: .3rem; }
    time { color: var(--text-2); font-size: .78rem; margin-left: .3rem; }
    footer { color: var(--text-2); font-size: .8rem; margin-top: 2rem; }
    footer a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <nav class="home" aria-label="Breadcrumb"><a href="/">HOLOCARD META</a> <span aria-hidden="true">›</span> 牌組一覽 / Decks</nav>
    <h1>hOCG 牌組一覽 / All Deck Recipes</h1>
    <p class="sub">hololive OFFICIAL CARD GAME 環境 Tier 牌組、攻略與官方推薦牌組（${entities.length}）。</p>
${sectionsHtml}
    <a class="home" href="/">&larr; 回 HOLOCARD META / Back to app</a>
    <footer>Fan-made. Card data © 2016 COVER Corp. / hololive OFFICIAL CARD GAME · <a href="/privacy.html">Privacy</a></footer>
  </main>
</body>
</html>
`;
}

function buildSitemap(entityUrls, lastmodDefault) {
  const urls = [
    { loc: SITE_URL, priority: '1.0', lastmod: lastmodDefault },
    ...SUPPORTED_LANGS.map(lang => ({
      loc: getLanguageUrl(lang),
      priority: lang === 'zh-TW' ? '0.9' : '0.8',
      lastmod: lastmodDefault,
    })),
  ];
  const alternates = getAlternateLinks()
    .map(link => `    <xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${link.href}"/>`)
    .join('\n');

  const coreEntries = urls.map(url => `  <url>
    <loc>${url.loc}</loc>
${url.lastmod ? `    <lastmod>${url.lastmod}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>
    <priority>${url.priority}</priority>
${alternates}
  </url>`).join('\n');

  // /deck/ index has no language variants — no hreflang block.
  const deckIndexEntry = `  <url>
    <loc>${SITE_URL}deck/</loc>
${lastmodDefault ? `    <lastmod>${lastmodDefault}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;

  const entityEntries = entityUrls.map(e => `  <url>
    <loc>${e.loc}</loc>
${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${coreEntries}
${deckIndexEntry}
${entityEntries}
</urlset>
`;
}

for (const lang of SUPPORTED_LANGS) {
  const dir = path.join(webDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildLanguagePage(lang));
}

const meta = loadJson(path.join(dataDir, 'meta.json'), {});
const lastmodDefault = /^\d{4}-\d{2}-\d{2}/.test(meta.generated_at || '') ? meta.generated_at.slice(0, 10) : '';

const deckOutDir = path.join(webDir, 'deck');
fs.rmSync(deckOutDir, { recursive: true, force: true });
const entities = collectEntities();
const slugs = assignSlugs(entities);
if (new Set(slugs.values()).size !== entities.length) {
  throw new Error('entity slug collision after dedup — investigate readableSlug()');
}
const relatedByDeckId = computeRelated(entities, slugs);
const entityUrls = [];
for (const e of entities) {
  const slug = slugs.get(e.deckId);
  const dir = path.join(deckOutDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildEntityPage(e, slug, relatedByDeckId.get(e.deckId)));
  const date = String(e.date || '').slice(0, 10);
  entityUrls.push({
    loc: `${SITE_URL}deck/${slug}/`,
    lastmod: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : lastmodDefault,
  });
}
fs.writeFileSync(path.join(deckOutDir, 'index.html'), buildDeckIndexPage(entities, slugs));

fs.writeFileSync(path.join(webDir, 'sitemap.xml'), buildSitemap(entityUrls, lastmodDefault));

console.log(`Generated ${SUPPORTED_LANGS.length} language entry pages, ${entities.length} deck pages, deck index, and sitemap.`);
