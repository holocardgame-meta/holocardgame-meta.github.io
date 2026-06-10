import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'web');
const siteUrl = 'https://holocardgame-meta.github.io/';
const languages = ['zh-TW', 'ja', 'en', 'fr', 'es'];
const primaryLanguages = ['zh-TW', 'ja', 'en'];

const expectedTitles = {
  'zh-TW': 'hOCG 牌組攻略、Tier 排行榜與卡片資料庫 | HOLOCARD META',
  ja: 'ホロカ環境デッキランキング・デッキレシピ | HOLOCARD META',
  en: 'hOCG Tier List, Deck Guides & Card Database | HOLOCARD META',
};

const failures = [];

function readFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function getAttr(tag, attrName) {
  const attr = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

function getTag(html, selectorAttr, selectorValue) {
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  return tags.find(tag => getAttr(tag, selectorAttr) === selectorValue) || '';
}

function getTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '';
}

function languageUrl(lang) {
  return `${siteUrl}${lang}/`;
}

function assertIncludes(label, haystack, needle) {
  if (!haystack.includes(needle)) failures.push(`${label} is missing ${needle}`);
}

const rootHtml = readFile('web/index.html');
const sitemap = readFile('web/sitemap.xml');

if (/<meta\b[^>]*\bname=["']keywords["']/i.test(rootHtml)) {
  failures.push('Root HTML should not include meta keywords.');
}

if (rootHtml.includes('@type": "FAQPage"') || rootHtml.includes('"@type": "FAQPage"')) {
  failures.push('Root JSON-LD should not include FAQPage markup unless visible FAQ content is rendered.');
}

const canonical = getTag(rootHtml, 'rel', 'canonical');
if (getAttr(canonical, 'href') !== siteUrl) {
  failures.push(`Root canonical should be ${siteUrl}`);
}

for (const lang of languages) {
  assertIncludes('Root hreflang alternates', rootHtml, `hreflang="${lang}" href="${languageUrl(lang)}"`);
  assertIncludes('Sitemap language locs', sitemap, `<loc>${languageUrl(lang)}</loc>`);
  if (sitemap.includes(`?lang=${lang}`)) {
    failures.push(`Sitemap should not include legacy query language URL ?lang=${lang}.`);
  }
}

assertIncludes('Root hreflang alternates', rootHtml, `hreflang="x-default" href="${siteUrl}"`);
assertIncludes('Sitemap x-default alternates', sitemap, `hreflang="x-default" href="${siteUrl}"`);

for (const lang of primaryLanguages) {
  const pagePath = path.join(webDir, lang, 'index.html');
  if (!fs.existsSync(pagePath)) {
    failures.push(`Missing generated language page: web/${lang}/index.html`);
    continue;
  }
  const html = fs.readFileSync(pagePath, 'utf8');
  if (!html.includes('<base href="../">')) {
    failures.push(`web/${lang}/index.html should include <base href="../">.`);
  }
  if (!html.includes(`<html lang="${lang}">`)) {
    failures.push(`web/${lang}/index.html should set html lang="${lang}".`);
  }
  const pageCanonical = getTag(html, 'rel', 'canonical');
  if (getAttr(pageCanonical, 'href') !== languageUrl(lang)) {
    failures.push(`web/${lang}/index.html canonical should be ${languageUrl(lang)}.`);
  }
  if (getTitle(html) !== expectedTitles[lang]) {
    failures.push(`web/${lang}/index.html title should be "${expectedTitles[lang]}".`);
  }
}

if (!readFile('web/i18n.js').includes('getExplicitLangFromLocation')) {
  failures.push('Runtime i18n should detect language from /{lang}/ paths, not only ?lang=');
}

// Deck index page: keeps the 144+ entity pages from being orphans.
assertIncludes('Sitemap deck index', sitemap, `<loc>${siteUrl}deck/</loc>`);
assertIncludes('Root footer deck-index link', rootHtml, 'href="deck/"');

const deckIndexPath = path.join(webDir, 'deck', 'index.html');
if (!fs.existsSync(deckIndexPath)) {
  failures.push('Missing generated web/deck/index.html — run scripts/build_seo_pages.mjs first.');
} else {
  const deckIndexHtml = fs.readFileSync(deckIndexPath, 'utf8');
  const deckCanonical = getTag(deckIndexHtml, 'rel', 'canonical');
  if (getAttr(deckCanonical, 'href') !== `${siteUrl}deck/`) {
    failures.push(`web/deck/index.html canonical should be ${siteUrl}deck/.`);
  }
  if (!deckIndexHtml.includes('href="/deck/')) {
    failures.push('web/deck/index.html should link to entity pages.');
  }
}

const notFoundPath = path.join(webDir, '404.html');
if (!fs.existsSync(notFoundPath)) {
  failures.push('Missing web/404.html.');
} else if (!fs.readFileSync(notFoundPath, 'utf8').includes('noindex')) {
  failures.push('web/404.html should carry a noindex robots meta.');
}

if (failures.length) {
  console.error('SEO page contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SEO page contract passed.');
