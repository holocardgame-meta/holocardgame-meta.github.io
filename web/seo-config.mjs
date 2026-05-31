export const SITE_URL = 'https://holocardgame-meta.github.io/';
export const SUPPORTED_LANGS = ['zh-TW', 'ja', 'en', 'fr', 'es'];
export const FALLBACK_LANG = 'en';
export const DEFAULT_PAGE_LANG = 'zh-TW';

export const SEO_METADATA = {
  default: {
    htmlLang: DEFAULT_PAGE_LANG,
    title: 'HOLOCARD META | ホロカ環境・hOCG Tier List・牌組攻略',
    description: 'HOLOCARD META tracks the hololive OFFICIAL CARD GAME (hOCG / ホロカ) meta with deck tier rankings, deck recipes, WGP results, card search, and 牌組攻略.',
    url: SITE_URL,
    locale: 'zh_TW',
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    title: 'hOCG 牌組攻略、Tier 排行榜與卡片資料庫 | HOLOCARD META',
    description: '查詢 hololive OFFICIAL CARD GAME (hOCG / ホロカ) 環境資料：Tier 排行榜、牌組攻略、牌組配方、WGP 大賽結果與卡片搜尋。',
    url: `${SITE_URL}zh-TW/`,
    locale: 'zh_TW',
  },
  ja: {
    htmlLang: 'ja',
    title: 'ホロカ環境デッキランキング・デッキレシピ | HOLOCARD META',
    description: 'ホロライブカードゲーム（hOCG / ホロカ）の環境デッキランキング、デッキレシピ、WGP大会結果、カード検索をまとめたファンメイド攻略データベース。',
    url: `${SITE_URL}ja/`,
    locale: 'ja_JP',
  },
  en: {
    htmlLang: 'en',
    title: 'hOCG Tier List, Deck Guides & Card Database | HOLOCARD META',
    description: 'Track the hololive OFFICIAL CARD GAME (hOCG) meta with tier rankings, deck guides, deck recipes, WGP tournament results, and a searchable card database.',
    url: `${SITE_URL}en/`,
    locale: 'en_US',
  },
  fr: {
    htmlLang: 'fr',
    title: 'Tier list hOCG, guides de decks et cartes | HOLOCARD META',
    description: 'Suivez le meta hololive OFFICIAL CARD GAME (hOCG) avec tier list, guides de decks, recettes de decks, resultats WGP et base de cartes consultable.',
    url: `${SITE_URL}fr/`,
    locale: 'fr_FR',
  },
  es: {
    htmlLang: 'es',
    title: 'Tier list hOCG, guias de mazos y cartas | HOLOCARD META',
    description: 'Consulta el meta de hololive OFFICIAL CARD GAME (hOCG) con tier list, guias de mazos, recetas de decks, resultados WGP y base de cartas.',
    url: `${SITE_URL}es/`,
    locale: 'es_ES',
  },
};

export function getLanguageUrl(lang) {
  return SEO_METADATA[lang]?.url || SITE_URL;
}

export function getSeoMetadata(lang, hasExplicitLang = false) {
  return hasExplicitLang && SEO_METADATA[lang] ? SEO_METADATA[lang] : SEO_METADATA.default;
}

export function getAlternateLinks() {
  return [
    ...SUPPORTED_LANGS.map(lang => ({ hreflang: lang, href: getLanguageUrl(lang) })),
    { hreflang: 'x-default', href: SITE_URL },
  ];
}

export function getPathLang(pathname = '') {
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  try {
    const decoded = decodeURIComponent(firstSegment);
    return SUPPORTED_LANGS.includes(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

export function getQueryLang(search = '') {
  const lang = new URLSearchParams(search).get('lang');
  return SUPPORTED_LANGS.includes(lang) ? lang : '';
}

export function getExplicitLangFromLocation(location) {
  return getPathLang(location?.pathname || '') || getQueryLang(location?.search || '');
}
