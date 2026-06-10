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

function localizedText(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value['zh-TW'] ?? value.ja ?? value.en ?? Object.values(value)[0] ?? '';
}

function entitySlug(deckId) {
  const slug = String(deckId).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48);
  const digest = crypto.createHash('sha1').update(String(deckId)).digest('hex').slice(0, 8);
  return `${slug || 'deck'}-${digest}`;
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

function buildEntityPage(e, slug) {
  const url = `${SITE_URL}deck/${slug}/`;
  const zhTitle = localizedText(e.title, 'zh-TW');
  const jaTitle = localizedText(e.title, 'ja');
  const enTitle = localizedText(e.title, 'en');
  const zhDesc = localizedText(e.description, 'zh-TW');
  const enDesc = localizedText(e.description, 'en');
  const jaDesc = localizedText(e.description, 'ja');
  const headline = zhTitle || jaTitle || enTitle || e.deckId;
  const pageTitle = `${headline} | HOLOCARD META`;
  const metaDesc = (zhDesc || enDesc || jaDesc || `hOCG deck recipe: ${headline}`).replace(/\s+/g, ' ').slice(0, 155);
  const ogImage = /^https?:\/\//.test(e.image || '') ? e.image : `${SITE_URL}og-image.png`;
  const hashRoute = `/#deck/${encodeURIComponent(e.deckId)}`;
  const badge = e.tier ? `Tier ${e.tier}` : e.kind === 'official' ? 'OFFICIAL' : 'GUIDE';
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

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    ...(e.date ? { datePublished: String(e.date).slice(0, 10) } : {}),
    inLanguage: 'zh-TW',
    mainEntityOfPage: url,
    publisher: { '@type': 'Organization', name: 'HOLOCARD META' },
  });

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
    .home { color: var(--text-2); text-decoration: none; font-size: .85rem; }
    .home:hover { color: var(--text-1); }
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
    <a class="home" href="/">&larr; HOLOCARD META</a>
    <h1>${escapeHtml(headline)}</h1>
    ${jaTitle && jaTitle !== headline ? `<div class="sub" lang="ja">${escapeHtml(jaTitle)}</div>` : ''}
    <div class="meta">
        ${metaBits}
    </div>
    ${descBlocks ? `<div class="desc">
      ${descBlocks}
    </div>` : ''}
    ${cardsHtml}
    <a class="cta" href="${escapeHtml(hashRoute)}">在 HOLOCARD META 開啟完整內容 / Open in app →</a>
    ${e.sourceUrl ? `<p class="source">出典 / Source: <a href="${escapeHtml(e.sourceUrl)}" rel="noopener nofollow" target="_blank">${escapeHtml(e.sourceName || e.sourceUrl)}</a></p>` : ''}
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

  const entityEntries = entityUrls.map(e => `  <url>
    <loc>${e.loc}</loc>
${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${coreEntries}
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
const entityUrls = [];
for (const e of entities) {
  const slug = entitySlug(e.deckId);
  const dir = path.join(deckOutDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildEntityPage(e, slug));
  const date = String(e.date || '').slice(0, 10);
  entityUrls.push({
    loc: `${SITE_URL}deck/${slug}/`,
    lastmod: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : lastmodDefault,
  });
}

fs.writeFileSync(path.join(webDir, 'sitemap.xml'), buildSitemap(entityUrls, lastmodDefault));

console.log(`Generated ${SUPPORTED_LANGS.length} language entry pages, ${entities.length} deck pages, and sitemap.`);
