import { t, localized } from '../i18n.js';
import { escapeHtml as _escape, safeUrl, sanitizeUrl } from '../utils/sanitize.js';
import { COLOR_HEX } from '../utils/colors.js';
import { aliasTextFor } from '../utils/aliases.js';

const PAGE_SIZE = 60;
let currentPage = 0;
let filteredCards = [];

let _rulesData = null;

export function renderCardGallery(container, cards, filters, rulesData) {
  _rulesData = rulesData;
  filteredCards = applyFilters(cards, filters);
  currentPage = 0;
  renderPage(container);
}

function _effectText(obj) {
  if (!obj) return '';
  const eff = obj.effect;
  return typeof eff === 'object' ? localized(eff) : (eff || '');
}

function applyFilters(cards, filters) {
  const colorSet = filters.colors instanceof Set ? filters.colors : null;
  const typeSet = filters.types instanceof Set ? filters.types : null;
  return cards.filter(card => {
    if (colorSet && colorSet.size > 0) {
      if (!colorSet.has(card.color)) return false;
    } else if (filters.color && filters.color !== 'all') {
      if (card.color !== filters.color) return false;
    }
    if (typeSet && typeSet.size > 0) {
      let match = false;
      for (const sel of typeSet) {
        if (sel === 'support') {
          if (card.type?.startsWith('支援')) { match = true; break; }
        } else if (card.type === sel) {
          match = true; break;
        }
      }
      if (!match) return false;
    } else if (filters.type && filters.type !== 'all') {
      if (filters.type === 'support') {
        if (!card.type?.startsWith('支援')) return false;
      } else {
        if (card.type !== filters.type) return false;
      }
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const searchable = [
        card.name, aliasTextFor(card.name), card.id, card.tag, card.type,
        card.oshiSkill?.name, _effectText(card.oshiSkill),
        card.spSkill?.name, _effectText(card.spSkill),
        card.effectC?.name, _effectText(card.effectC),
        card.art1?.name, _effectText(card.art1),
        localized(card.supportEffect),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

function renderPage(container) {
  const start = 0;
  const end = (currentPage + 1) * PAGE_SIZE;
  const visible = filteredCards.slice(start, end);
  const hasMore = end < filteredCards.length;

  let html = `<div class="card-count-info">${t('showing_cards', { shown: visible.length, total: filteredCards.length })}</div>`;
  html += '<div class="card-gallery">';
  const restricted = new Set(_rulesData?.restricted_cards || []);
  const errata = _rulesData?.errata || {};

  for (const card of visible) {
    const color = COLOR_HEX[card.color] || '#666';
    const isRestricted = restricted.has(card.id);
    const hasErrata = card.id in errata;
    const cardId = _escape(card.id || '');
    const cardName = _escape(card.name || '');
    const imageUrl = safeUrl(card.imageUrl || '');
    let badgesHtml = '';
    if (isRestricted) badgesHtml += `<span class="card-rule-badge restricted" title="${t('rule_restricted_desc')}">${t('rule_restricted')}</span>`;
    if (hasErrata) badgesHtml += `<span class="card-rule-badge errata" title="${t('rule_errata_desc')}">${t('rule_errata')}</span>`;

    html += `
      <div class="gallery-card" data-card-id="${cardId}">
        <div class="gallery-card-img-wrap">
          <img class="gallery-card-img" src="${imageUrl}" alt="${cardName}" loading="lazy" decoding="async"
               onerror="this.style.display='none'">
          ${badgesHtml ? `<div class="card-rule-badges">${badgesHtml}</div>` : ''}
        </div>
        <div class="gallery-card-info">
          <div class="gallery-card-name" title="${cardName}">${cardName}</div>
          <div class="gallery-card-meta">
            <span class="gallery-card-color" style="background:${color}"></span>
            <span>${_escape(card.type || '')}</span>
            ${card.bloom ? `<span>· ${_escape(card.bloom)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  html += '</div>';

  if (hasMore) {
    const remaining = filteredCards.length - end;
    html += `<div class="guides-load-more-wrap">
      <button class="guides-load-more-btn" id="loadMoreCards">${t('load_more', { remaining })}</button>
    </div>`;
  }

  container.innerHTML = html;

  if (hasMore) {
    document.getElementById('loadMoreCards')?.addEventListener('click', () => {
      currentPage++;
      renderPage(container);
    });
  }
}

function _statTile(label, value, opts = {}) {
  if (value == null || value === '') return '';
  const valClass = opts.cost ? ' cps-cost' : (opts.color ? ' cps-color' : '');
  const inner = opts.color
    ? `<span class="cd" style="background:${COLOR_HEX[value] || '#666'}"></span>${_escape(value)}`
    : _escape(value);
  return `<div class="cardp-stat">
    <div class="cps-label">${_escape(label)}</div>
    <div class="cps-val${valClass}">${inner}</div>
  </div>`;
}

function _abilityBlock({ kind, name, text, damage, holoPower, variant }) {
  const damageHtml = damage
    ? `<span class="ability-damage">${t('stat_damage')} <strong>${_escape(damage)}</strong></span>`
    : (holoPower != null
        ? `<span class="ability-damage">HP <strong>${_escape(holoPower)}</strong></span>`
        : '');
  const nameHtml = name ? `<span class="ability-name">${_escape(name)}</span>` : '';
  const textHtml = text ? `<p class="ability-text">${_escape(text)}</p>` : '';
  return `<div class="ability-block ability-${variant}">
    <div class="ability-head">
      <span class="ability-kind">${_escape(kind)}</span>
      ${nameHtml}
      ${damageHtml}
    </div>
    ${textHtml}
  </div>`;
}

export function renderCardDetail(container, card, allCards, rulesData) {
  if (!card) {
    container.innerHTML = `<p>${t('card_not_found')}</p>`;
    return;
  }

  const variants = allCards ? allCards.filter(c => c.id === card.id) : [card];

  const isOshi = card.type === '主推';
  const isMember = card.type === '成員';
  const isSupport = card.type?.startsWith('支援');
  const isCheer = card.type === '吶喊';

  const mainRarity = _rarityLabel(card.imageUrl);

  // Stats grid — fill 3 cells minimum so the bordered grid looks even.
  const statsCells = [];
  if (isOshi) {
    statsCells.push(_statTile('Life', card.life, { cost: true }));
    statsCells.push(_statTile(t('stat_color'), card.color, { color: true }));
    statsCells.push(_statTile(t('stat_type'), card.type));
  } else if (isMember) {
    statsCells.push(_statTile('HP', card.hp, { cost: true }));
    statsCells.push(_statTile('Bloom', card.bloom));
    statsCells.push(_statTile(t('stat_color'), card.color, { color: true }));
    statsCells.push(_statTile(t('stat_type'), card.type));
  } else {
    statsCells.push(_statTile(t('stat_type'), card.type));
    if (card.color) statsCells.push(_statTile(t('stat_color'), card.color, { color: true }));
  }
  statsCells.push(_statTile('Rarity', mainRarity));
  if (variants.length > 1) statsCells.push(_statTile('Arts', variants.length, { cost: true }));
  const statsHtml = statsCells.filter(Boolean).join('');

  // Sets (収録) — split product string into rows
  const productList = Array.isArray(card.product)
    ? card.product
    : (card.product ? String(card.product).split(/[,、\/]/).map(s => s.trim()).filter(Boolean) : []);
  const setsHtml = productList.map(p => {
    const codeMatch = String(p).match(/(h[A-Z]+\d+)/);
    const code = codeMatch ? codeMatch[1] : '';
    const label = code ? String(p).replace(code, '').trim() || p : p;
    return `<div class="set-row">
      <span class="set-kind">SET</span>
      <span class="set-label">${_escape(label)}</span>
      ${code ? `<span class="set-code">${_escape(code)}</span>` : ''}
    </div>`;
  }).join('');

  // Abilities — colored blocks. Bloom-family = gold; Arts = red.
  const abilityBlocks = [];
  if (isOshi) {
    if (card.oshiSkill) abilityBlocks.push(_abilityBlock({
      kind: t('effect_oshi_skill'), name: card.oshiSkill.name,
      text: _effectText(card.oshiSkill), holoPower: card.oshiSkill.holoPower, variant: 'bloom',
    }));
    if (card.spSkill) abilityBlocks.push(_abilityBlock({
      kind: t('effect_sp'), name: card.spSkill.name,
      text: _effectText(card.spSkill), holoPower: card.spSkill.holoPower, variant: 'arts',
    }));
  } else if (isMember) {
    if (card.effectC) abilityBlocks.push(_abilityBlock({
      kind: t('effect_collab'), name: card.effectC.name, text: _effectText(card.effectC), variant: 'bloom',
    }));
    if (card.effectB) abilityBlocks.push(_abilityBlock({
      kind: t('effect_bloom'), name: card.effectB.name, text: _effectText(card.effectB), variant: 'bloom',
    }));
    if (card.effectG) abilityBlocks.push(_abilityBlock({
      kind: t('effect_gift'), name: card.effectG.name, text: _effectText(card.effectG), variant: 'bloom',
    }));
    if (card.art1) abilityBlocks.push(_abilityBlock({
      kind: t('effect_arts'), name: card.art1.name, text: _effectText(card.art1), damage: card.art1.damage, variant: 'arts',
    }));
    if (card.art2) abilityBlocks.push(_abilityBlock({
      kind: t('effect_arts2'), name: card.art2.name, text: _effectText(card.art2), damage: card.art2.damage, variant: 'arts',
    }));
    if (card.extra) abilityBlocks.push(_abilityBlock({
      kind: t('effect_extra'), text: localized(card.extra), variant: 'bloom',
    }));
  } else if (isSupport && card.supportEffect) {
    abilityBlocks.push(_abilityBlock({
      kind: t('effect_support'), text: localized(card.supportEffect), variant: 'bloom',
    }));
  } else if (isCheer && card.yellEffect) {
    abilityBlocks.push(_abilityBlock({
      kind: t('effect_cheer'), text: localized(card.yellEffect), variant: 'bloom',
    }));
  }
  const abilitiesHtml = abilityBlocks.join('');

  // Tags — source may already include leading '#'
  const tagsHtml = card.tag
    ? card.tag.split('/').map(tg => tg.trim().replace(/^#+/, '')).filter(Boolean).map(tg => `<span class="kw-chip">#${_escape(tg)}</span>`).join('')
    : '';

  // Rules (restricted / errata / related articles) — keep functionality, render inline in info column
  const restricted = new Set(rulesData?.restricted_cards || []);
  const errataMap = rulesData?.errata || {};
  const isRestricted = restricted.has(card.id);
  const errataInfo = errataMap[card.id];
  const relatedArticles = (rulesData?.articles || []).filter(a => a.card_ids?.includes(card.id));

  let ruleSectionHtml = '';
  if (isRestricted || errataInfo || relatedArticles.length) {
    let badges = '';
    if (isRestricted) badges += `<span class="card-rule-badge restricted">${t('rule_restricted')}</span>`;
    if (errataInfo) badges += `<span class="card-rule-badge errata">${t('rule_errata')}</span>`;

    let articlesListHtml = '';
    if (relatedArticles.length) {
      articlesListHtml = relatedArticles.map(a => {
        const title = typeof a.title === 'object' ? localized(a.title) : a.title;
        return `<li class="rule-article-item">
          <span class="rule-article-date">${_escape(a.date || '')}</span>
          <a href="${safeUrl(a.url)}" target="_blank" rel="noopener" class="rule-article-link">${_escape(title)}</a>
        </li>`;
      }).join('');
    }

    ruleSectionHtml = `
      <div class="card-rule-section">
        <div class="card-rule-badges-detail">${badges}</div>
        ${isRestricted ? `<div class="card-rule-note restricted-note">${t('rule_restricted_desc')}</div>` : ''}
        ${errataInfo ? `<div class="card-rule-note errata-note">${t('rule_errata_desc')}</div>` : ''}
        ${articlesListHtml ? `<div class="card-rule-articles">
          <div class="card-rule-articles-title">${t('rule_articles_title')}</div>
          <ul class="rule-articles-list">${articlesListHtml}</ul>
        </div>` : ''}
      </div>
    `;
  }

  // Variant strip
  const variantsHtml = variants.length > 1
    ? `<div class="variant-strip">
        ${variants.map((v, i) => {
          const suffix = _rarityLabel(v.imageUrl);
          return `<button type="button" class="variant-thumb${i === 0 ? ' is-active' : ''}" data-variant-idx="${i}">
            <span class="variant-mini">
              <img src="${safeUrl(v.imageUrl)}" alt="${_escape(suffix)}" loading="lazy" decoding="async">
              <span class="variant-tag">${_escape(suffix)}</span>
            </span>
          </button>`;
        }).join('')}
      </div>`
    : '';

  const cvColor = COLOR_HEX[card.color] || 'var(--accent)';

  container.innerHTML = `
    <div class="card-page">
      <header class="cardp-hero">
        <div class="cardp-hero-eyebrow">卡片 CARD · ${_escape(card.id || '')}</div>
        <div class="cardp-hero-row">
          <div class="cardp-set-tag">
            <span class="set-rarity">${_escape(mainRarity)}</span>
            <span class="set-num">${_escape(card.id || '')}</span>
          </div>
        </div>
      </header>

      <div class="cardp-body">
        <section class="cardp-viewer">
          <div class="cardv-frame" style="--cv-color:${cvColor}">
            <span class="cardv-corner cardv-corner-tl"></span>
            <span class="cardv-corner cardv-corner-tr"></span>
            <span class="cardv-corner cardv-corner-bl"></span>
            <span class="cardv-corner cardv-corner-br"></span>
            <img class="cardv-img" id="cardDetailMainImg" src="${safeUrl(card.imageUrl || '')}" alt="${_escape(card.name)}"
                 onerror="this.style.display='none'">
          </div>
          ${variantsHtml}
        </section>

        <section class="cardp-info">
          <h1 class="cardp-title">${_escape(card.name)}</h1>

          <div class="cardp-stats">${statsHtml}</div>

          ${ruleSectionHtml}

          ${setsHtml ? `<div class="cardp-section">
            <div class="cardp-section-label">収録 / SETS</div>
            <div class="sets-list">${setsHtml}</div>
          </div>` : ''}

          ${abilitiesHtml ? `<div class="cardp-section">
            <div class="cardp-section-label">能力 / ABILITIES</div>
            <div class="ability-list">${abilitiesHtml}</div>
          </div>` : ''}

          ${tagsHtml ? `<div class="cardp-section">
            <div class="cardp-section-label">標籤 / TAGS</div>
            <div class="kw-row">${tagsHtml}</div>
          </div>` : ''}
        </section>
      </div>
    </div>
  `;

  if (variants.length > 1) {
    const mainImg = container.querySelector('#cardDetailMainImg');
    container.querySelectorAll('.variant-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const idx = parseInt(thumb.dataset.variantIdx);
        mainImg.src = sanitizeUrl(variants[idx].imageUrl);
        mainImg.style.display = '';
        container.querySelectorAll('.variant-thumb').forEach(t => t.classList.remove('is-active'));
        thumb.classList.add('is-active');
      });
    });
  }
}

const RARITY_SUFFIXES = {
  'C': 'C', 'U': 'U', 'R': 'R', 'RR': 'RR', 'SR': 'SR',
  'OSR': 'OSR', 'OUR': 'OUR', 'SEC': 'SEC', 'SSP': 'SSP',
  'SP': 'SP', 'UR': 'UR', 'SER': 'SER',
};

function _rarityLabel(url) {
  if (!url) return '?';
  const filename = url.split('/').pop().replace('.png', '').replace('.jpg', '');
  const parts = filename.split('_');
  parts.shift();
  const suffix = parts.join('_');
  for (const [key, label] of Object.entries(RARITY_SUFFIXES)) {
    if (suffix === key) return label;
  }
  if (suffix.startsWith('P')) return 'P';
  return suffix || '?';
}

