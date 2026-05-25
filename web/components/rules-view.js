import { t, localized } from '../i18n.js';

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
          <span data-i18n="rules_restricted_heading">制限カード</span>
          <span class="rules-section-count">${restricted.length}</span>
        </h3>
        <p class="rules-section-desc" data-i18n="rules_restricted_desc">每副牌組中此卡僅限放入 1 張。</p>
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
          <span data-i18n="rules_errata_heading">裁定變更</span>
          <span class="rules-section-count">${errataKeys.length}</span>
        </h3>
        <p class="rules-section-desc" data-i18n="rules_errata_desc">官方公告調整了下列卡片的判定。</p>
        <div class="rules-card-grid">
          ${errataKeys.map(id => renderErrataCard(id, cardsMap, errata[id])).join('')}
        </div>
      </section>` : '';

  const articlesHtml = articles.length
    ? `
      <section class="rules-section">
        <h3 class="rules-section-title">
          <span class="rules-section-tag articles-tag">NEWS</span>
          <span data-i18n="rules_articles_heading">官方規則更新</span>
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
        ${rulesData.scraped_at ? `${t('updated')}: <span>${rulesData.scraped_at}</span>` : ''}
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
    ? `<img class="rules-card-img" src="${card.imageUrl}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
    : `<div class="rules-card-img rules-card-img-placeholder">🃏</div>`;
  const errataNote = errataEntry
    ? `<div class="rules-card-note errata-note">${t('rule_errata_desc')}</div>`
    : '';

  return `
    <div class="rules-card clickable-card" data-card-id="${id}">
      <div class="rules-card-img-wrap">
        ${img}
        <span class="rules-card-badge restricted-badge">${t('rule_restricted')}</span>
        ${errataEntry ? `<span class="rules-card-badge errata-badge">${t('rule_errata')}</span>` : ''}
      </div>
      <div class="rules-card-info">
        <div class="rules-card-name" title="${name}">${name}</div>
        <div class="rules-card-id">${id}</div>
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
    ? `<img class="rules-card-img" src="${card.imageUrl}" alt="${name}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
    : `<div class="rules-card-img rules-card-img-placeholder">🃏</div>`;
  const title = entry?.title ? localized(entry.title, '') : '';

  return `
    <div class="rules-card clickable-card" data-card-id="${id}">
      <div class="rules-card-img-wrap">
        ${img}
        <span class="rules-card-badge errata-badge">${t('rule_errata')}</span>
      </div>
      <div class="rules-card-info">
        <div class="rules-card-name" title="${name}">${name}</div>
        <div class="rules-card-id">${id}</div>
        ${entry?.date ? `<div class="rules-card-date">${entry.date}</div>` : ''}
        ${title ? `<div class="rules-card-link-title">${title}</div>` : ''}
      </div>
    </div>
  `;
}

function renderArticle(article) {
  const title = article.title ? localized(article.title, '') : '';
  const dateStr = article.date || '';
  const type = article.type || '';
  const typeLabel = type === 'errata' ? t('rule_errata') : type === 'rule_update' ? t('rules_article_rule_update') : type;
  const cardChips = (article.card_ids || []).slice(0, 8).map(cid =>
    `<span class="rules-article-chip">${cid}</span>`
  ).join('');

  return `
    <li class="rules-article-item">
      <div class="rules-article-meta">
        <span class="rules-article-date">${dateStr}</span>
        ${typeLabel ? `<span class="rules-article-type rules-article-type-${type}">${typeLabel}</span>` : ''}
      </div>
      <div class="rules-article-body">
        <a class="rules-article-link" href="${article.url}" target="_blank" rel="noopener">${title}</a>
        ${cardChips ? `<div class="rules-article-chips">${cardChips}</div>` : ''}
      </div>
    </li>
  `;
}
