// Canonical card-color constants shared by app.js and all view components.
// Keys are the zh-TW color names used across scraped data; JP variants map in via COLOR_ALIAS.

export const COLOR_ALIAS = {
  '白': '白', '綠': '綠', '緑': '綠', '紅': '紅', '赤': '紅',
  '藍': '藍', '青': '藍', '紫': '紫', '黃': '黃', '黄': '黃',
};

export const COLOR_HEX = {
  '白': '#e8e8e8', '綠': '#4caf50', '紅': '#f44336',
  '藍': '#2196f3', '紫': '#9c27b0', '黃': '#ffeb3b',
};

export function normalizeColor(c) {
  return COLOR_ALIAS[String(c || '').trim()] || '';
}

export function colorsFromValue(v) {
  return String(v || '').split('/').map(normalizeColor).filter(Boolean);
}

export function glyphFrom(text) {
  if (!text) return '?';
  const m = String(text).match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/);
  if (m) return m[0];
  const a = String(text).match(/[A-Za-z]/);
  return a ? a[0].toUpperCase() : '★';
}
