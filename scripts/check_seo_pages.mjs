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

if (failures.length) {
  console.error('SEO page contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SEO page contract passed.');
