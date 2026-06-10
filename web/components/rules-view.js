import { t, localized } from '../i18n.js';
import { escapeHtml as _esc, safeClassToken, safeUrl } from '../utils/sanitize.js';

export function renderRulesView(container, rulesData, cardsData) {
  if (!rulesData) {
    container.innerHTML = `<div class="loading">${t('loading')}</div>`;
    return;
  }

  const cardsMap = {};
  if (cardsData) for (const c of cardsData) cardsMap[c.id] = c;

  const restricted = rulesData.restricted_cards || [];
  const errata = rulesData.errata || {};
  const articles = (rulesData.articles || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const restrictedHtml = restricted.length
    ? `
      <section class="rules-section">
        <h3 class="rules-section-title">
          <span class="rules-section-tag restricted-tag">${t('rule_restricted')}</span>
          <span>${_esc(t('rules_restricted_heading'))}</span>
          <span class="rules-section-count">${restricted.length}</span>
        </h3>
        <p class="rules-section-desc">${_esc(t('rules_restricted_desc'))}</p>
        <div class="rules-card-grid">
          ${restricted.map(id => renderRestrictedCard(id, cardsMap, errata[id])).join('')}
        </div>
      </section>` : '';

  const errataKeys = Object.keys(errata);
  const errataHtml = errataKeys.length
    ? `
      <section class="rules-section">
        <h3 class="rules-section-title">
          <span class="rules-section-tag errata-tag">${t('rule_errata')}</span>
          <span>${_esc(t('rules_errata_heading'))}</span>
          <span class="rules-section-count">${errataKeys.length}</span>
        </h3>
        <p class="rules-section-desc">${_esc(t('rules_errata_desc'))}</p>
        <div class="rules-card-grid">
          ${errataKeys.map(id => renderErrataCard(id, cardsMap, errata[id])).join('')}
        </div>
      </section>` : '';

  const articlesHtml = articles.length
    ? `
      <section class="rules-section">
        <h3 class="rules-section-title">
          <span class="rules-section-tag articles-tag">NEWS</span>
          <span>${_esc(t('rules_articles_heading'))}</span>
          <span class="rules-section-count">${articles.length}</span>
        </h3>
        <ul class="rules-article-list">
          ${articles.map(renderArticle).join('')}
        </ul>
      </section>` : '';

  container.innerHTML = `
    <div class="result-meta">
      <div class="result-meta-text">
        ${t('rules_meta', { restricted: restricted.length, errata: errataKeys.length, articles: articles.length })}
      </div>
      <div class="rules-meta-updated">
        ${rulesData.scraped_at ? `${_esc(t('updated'))}: <span>${_esc(rulesData.scraped_at)}</span>` : ''}
      </div>
    </div>
    ${restrictedHtml}
    ${errataHtml}
    ${articlesHtml}
  `;
}

function renderRestrictedCard(id, cardsMap, errataEntry) {
  const card = cardsMap[id];
  const name = card?.name || id;
  const img = card?.imageUrl
    ? `<img class="rules-card-img" src="${safeUrl(card.imageUrl)}" alt="${_esc(name)}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
    : `<div class="rules-card-img rules-card-img-placeholder">🃏</div>`;
  const errataNote = errataEntry
    ? `<div class="rules-card-note errata-note">${t('rule_errata_desc')}</div>`
    : '';

  return `
    <div class="rules-card clickable-card" data-card-id="${_esc(id)}">
      <div class="rules-card-img-wrap">
        ${img}
        <span class="rules-card-badge restricted-badge">${t('rule_restricted')}</span>
        ${errataEntry ? `<span class="rules-card-badge errata-badge">${t('rule_errata')}</span>` : ''}
      </div>
      <div class="rules-card-info">
        <div class="rules-card-name" title="${_esc(name)}">${_esc(name)}</div>
        <div class="rules-card-id">${_esc(id)}</div>
        <div class="rules-card-note restricted-note">${t('rule_restricted_desc')}</div>
        ${errataNote}
      </div>
    </div>
  `;
}

function renderErrataCard(id, cardsMap, entry) {
  const card = cardsMap[id];
  const name = card?.name || id;
  const img = card?.imageUrl
    ? `<img class="rules-card-img" src="${safeUrl(card.imageUrl)}" alt="${_esc(name)}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
    : `<div class="rules-card-img rules-card-img-placeholder">🃏</div>`;
  const title = entry?.title ? localized(entry.title, '') : '';

  return `
    <div class="rules-card clickable-card" data-card-id="${_esc(id)}">
      <div class="rules-card-img-wrap">
        ${img}
        <span class="rules-card-badge errata-badge">${t('rule_errata')}</span>
      </div>
      <div class="rules-card-info">
        <div class="rules-card-name" title="${_esc(name)}">${_esc(name)}</div>
        <div class="rules-card-id">${_esc(id)}</div>
        ${entry?.date ? `<div class="rules-card-date">${_esc(entry.date)}</div>` : ''}
        ${title ? `<div class="rules-card-link-title">${_esc(title)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderArticle(article) {
  const title = article.title ? localized(article.title, '') : '';
  const dateStr = article.date || '';
  const type = article.type || '';
  const typeLabel = type === 'errata' ? t('rule_errata') : type === 'rule_update' ? t('rules_article_rule_update') : type;
  const typeToken = safeClassToken(type, 'other');
  const cardChips = (article.card_ids || []).slice(0, 8).map(cid =>
    `<span class="rules-article-chip">${_esc(cid)}</span>`
  ).join('');

  return `
    <li class="rules-article-item">
      <div class="rules-article-meta">
        <span class="rules-article-date">${_esc(dateStr)}</span>
        ${typeLabel ? `<span class="rules-article-type rules-article-type-${typeToken}">${_esc(typeLabel)}</span>` : ''}
      </div>
      <div class="rules-article-body">
        <a class="rules-article-link" href="${safeUrl(article.url)}" target="_blank" rel="noopener">${_esc(title)}</a>
        ${cardChips ? `<div class="rules-article-chips">${cardChips}</div>` : ''}
      </div>
    </li>
  `;
}
