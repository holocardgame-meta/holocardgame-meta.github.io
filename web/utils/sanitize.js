export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export const escapeAttr = escapeHtml;

export function sanitizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const compact = raw.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  if (
    compact.startsWith('javascript:') ||
    compact.startsWith('vbscript:') ||
    compact.startsWith('data:')
  ) {
    return '';
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (!hasScheme) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return raw;
  } catch {
    return '';
  }
  return '';
}

export function safeUrl(value) {
  return escapeAttr(sanitizeUrl(value));
}

export function safeClassToken(value, fallback = '') {
  const token = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return token || fallback;
}
