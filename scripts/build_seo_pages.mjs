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
const rootIndexPath = path.join(webDir, 'index.html');
const rootHtml = fs.readFileSync(rootIndexPath, 'utf8');

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

function buildSitemap() {
  const urls = [
    { loc: SITE_URL, priority: '1.0' },
    ...SUPPORTED_LANGS.map(lang => ({ loc: getLanguageUrl(lang), priority: lang === 'zh-TW' ? '0.9' : '0.8' })),
  ];
  const alternates = getAlternateLinks()
    .map(link => `    <xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${link.href}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(url => `  <url>
    <loc>${url.loc}</loc>
    <changefreq>monthly</changefreq>
    <priority>${url.priority}</priority>
${alternates}
  </url>`).join('\n')}
</urlset>
`;
}

for (const lang of SUPPORTED_LANGS) {
  const dir = path.join(webDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildLanguagePage(lang));
}

fs.writeFileSync(path.join(webDir, 'sitemap.xml'), buildSitemap());

console.log(`Generated ${SUPPORTED_LANGS.length} language entry pages and sitemap.`);
