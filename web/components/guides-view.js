import { t, localized } from '../i18n.js';
import { escapeHtml as _esc, safeUrl } from '../utils/sanitize.js';

const COLOR_ALIAS = {
  '白': '白',
  '綠': '綠',
  '緑': '綠',
  '紅': '紅',
  '赤': '紅',
  '藍': '藍',
  '青': '藍',
  '紫': '紫',
  '黃': '黃',
  '黄': '黃',
};
const COLOR_CSS = { '白': '#e8e8e8', '綠': '#4caf50', '紅': '#f44336', '藍': '#2196f3', '紫': '#9c27b0', '黃': '#ffeb3b' };
const PAGE_SIZE = 50;
const TIER_LETTER = { 1: 'S', 2: 'A', 3: 'B' };

function _normalizeColor(color) {
  return COLOR_ALIAS[String(color || '').trim()] || '';
}

function _colorsFromValue(value) {
  return String(value || '')
    .split('/')
    .map(_normalizeColor)
    .filter(Boolean);
}

function _getDeckColors(deck, cardsMap) {
  if (Array.isArray(deck?.colors) && deck.colors.length) {
    return deck.colors.map(_normalizeColor).filter(Boolean);
  }

  const colors = {};
  for (const c of deck.cards || []) {
    const id = c.card_id;
    const dbCard = id ? cardsMap[id] : null;
    for (const color of _colorsFromValue(dbCard?.color || c.color)) {
      colors[color] = (colors[color] || 0) + 1;
    }
  }
  return Object.keys(colors)
    .filter(c => COLOR_CSS[c])
    .sort((a, b) => colors[b] - colors[a]);
}

let _state = null;
let _bound = false;

export function renderGuidesView(container, allGuides, decksData, cardsData, filters, officialDecks) {
  const cardsMap = {};
  if (cardsData) {
    for (const c of cardsData) cardsMap[c.id] = c;
  }

  const combined = [];
  if (officialDecks) {
    for (const d of officialDecks) {
      combined.push({ ...d, _source: 'official', cards: d.main_deck || [] });
    }
  }
  if (decksData) {
    for (const d of decksData) {
      combined.push({ ...d, _source: 'tier' });
    }
  }
  if (allGuides) {
    const tierUrls = new Set(decksData ? decksData.map(d => d.url) : []);
    for (const g of allGuides) {
      if (!tierUrls.has(g.url)) {
        combined.push({ ...g, _source: 'guide' });
      }
    }
  }

  // Multi-select filtering (Sets are authoritative; legacy single-value strings ignored)
  const colorSet = filters?.colors instanceof Set ? filters.colors : new Set();
  const tierSet = filters?.tiers instanceof Set ? filters.tiers : new Set();

  let filtered = combined;
  if (colorSet.size > 0) {
    filtered = filtered.filter(d => {
      const deckColors = _getDeckColors(d, cardsMap);
      for (const sel of colorSet) {
        if (deckColors.includes(_normalizeColor(sel))) return true;
      }
      return false;
    });
  }
  if (tierSet.size > 0) {
    filtered = filtered.filter(d => {
      if (tierSet.has('official') && d._source === 'official') return true;
      if (tierSet.has('guide') && d._source === 'guide' && !d.tier) return true;
      if (d.tier && tierSet.has(String(d.tier))) return true;
      return false;
    });
  }

  filtered.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (db > da) return 1;
    if (da > db) return -1;
    return (a.tier || 99) - (b.tier || 99);
  });

  const titleEl = document.getElementById('guidesTitle');
  const descEl = document.getElementById('guidesDesc');
  const searchEl = document.getElementById('guideSearch');
  const countEl = document.getElementById('guidesCount');
  const grid = document.getElementById('guidesGrid');
  const loadMoreWrap = document.getElementById('guidesLoadMoreWrap');
  const loadMoreBtn = document.getElementById('guidesLoadMore');

  if (titleEl) titleEl.textContent = t('guides_title');
  if (descEl) descEl.textContent = t('guides_desc');
  if (searchEl) searchEl.placeholder = t('guides_search_placeholder');

  if (!combined.length) {
    grid.innerHTML = `<div class="loading" style="grid-column:1/-1">${t('guides_no_data')}</div>`;
    if (countEl) countEl.textContent = '';
    loadMoreWrap.style.display = 'none';
    return;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-glyph">∅</div>
        <div class="empty-title">${t('empty_title')}</div>
        <div class="empty-sub">${t('empty_sub')}</div>
        <button class="empty-btn" id="emptyClearBtn">${t('empty_btn')}</button>
      </div>
    `;
    if (countEl) countEl.textContent = t('guides_showing', { shown: 0, total: combined.length });
    loadMoreWrap.style.display = 'none';
    document.getElementById('emptyClearBtn')?.addEventListener('click', () => {
      if (filters?.colors instanceof Set) filters.colors.clear();
      if (filters?.tiers instanceof Set) filters.tiers.clear();
      // Trigger active filter UI refresh via DOM event; app.js owns the actual refresh.
      document.getElementById('clearAllBtn')?.click();
    });
    return;
  }

  const shown = PAGE_SIZE;
  const initial = filtered.slice(0, shown);
  const remaining = filtered.length - shown;

  _state = { filtered, cardsMap, shown };

  if (countEl) countEl.textContent = t('guides_showing', { shown: Math.min(shown, filtered.length), total: filtered.length });
  grid.innerHTML = initial.map((d, i) => renderGuideCard(d, cardsMap, i)).join('');

  if (remaining > 0) {
    loadMoreWrap.style.display = '';
    loadMoreBtn.textContent = t('guides_load_more', { remaining });
  } else {
    loadMoreWrap.style.display = 'none';
  }

  if (!_bound) {
    _bound = true;

    loadMoreBtn.addEventListener('click', () => {
      if (!_state) return;
      const { filtered, cardsMap } = _state;
      const start = _state.shown;
      const next = filtered.slice(start, start + PAGE_SIZE);
      grid.insertAdjacentHTML('beforeend', next.map((d, i) => renderGuideCard(d, cardsMap, start + i)).join(''));
      _state.shown += next.length;
      const left = filtered.length - _state.shown;
      if (countEl) countEl.textContent = t('guides_showing', { shown: Math.min(_state.shown, filtered.length), total: filtered.length });
      if (left <= 0) {
        loadMoreWrap.style.display = 'none';
      } else {
        loadMoreBtn.textContent = t('guides_load_more', { remaining: left });
      }
    });

    let debounce;
    searchEl?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!_state) return;
        const { filtered, cardsMap } = _state;
        const q = searchEl.value.trim().toLowerCase();
        if (!q) {
          grid.innerHTML = filtered.slice(0, _state.shown).map((d, i) => renderGuideCard(d, cardsMap, i)).join('');
          if (countEl) countEl.textContent = t('guides_showing', { shown: Math.min(_state.shown, filtered.length), total: filtered.length });
          if (_state.shown < filtered.length) {
            loadMoreWrap.style.display = '';
            loadMoreBtn.textContent = t('guides_load_more', { remaining: filtered.length - _state.shown });
          } else {
            loadMoreWrap.style.display = 'none';
          }
          return;
        }
        const matched = filtered.filter(d => {
          const title = localized(d.title, '');
          const jaTitle = typeof d.title === 'object' ? (d.title.ja || '') : (d.title || '');
          const desc = localized(d.description, '');
          const text = [jaTitle, title, typeof desc === 'string' ? desc : '', d.deck_id].join(' ').toLowerCase();
          return text.includes(q);
        });
        grid.innerHTML = matched.length
          ? matched.map((d, i) => renderGuideCard(d, cardsMap, i)).join('')
          : `
            <div class="empty-state" style="grid-column:1/-1">
              <div class="empty-glyph">∅</div>
              <div class="empty-title">${t('empty_title')}</div>
              <div class="empty-sub">${t('empty_sub')}</div>
            </div>
          `;
        if (countEl) countEl.textContent = `${matched.length} ${t('guides_count_label')}`;
        loadMoreWrap.style.display = 'none';
      }, 200);
    });
  }
}

function renderGuideCard(deck, cardsMap, index = Infinity) {
  const title = localized(deck.title, deck.deck_id || '');
  const safeTitle = _esc(title);
  let thumbSrc = deck.deck_image || deck.oshi_image;
  if (index < 4 && window.__LCP_OPTS && window.__LCP_OPTS[index]) thumbSrc = window.__LCP_OPTS[index];
  const isCardArt = !deck.deck_image && !!deck.oshi_image;
  const imgCls = isCardArt ? 'guide-card-img card-art' : 'guide-card-img';
  const isEager = index < 4;
  const loadAttr = isEager ? '' : ' loading="lazy"';
  const priorityAttr = index < 4 ? ' fetchpriority="high"' : '';
  const imgHtml = thumbSrc
    ? `<img class="${imgCls}" src="${safeUrl(thumbSrc)}" alt="${safeTitle}"${loadAttr} decoding="async"${priorityAttr}>`
    : `<div class="guide-card-noimg">🃏</div>`;

  const tierLetter = deck.tier && TIER_LETTER[deck.tier]
    ? `<span class="deck-tier-letter" data-t="${_esc(deck.tier)}">${_esc(TIER_LETTER[deck.tier])}</span>`
    : '';

  // Tier tag overlay (top-left) — gold for T1, silver T2, bronze T3; orange for official, cyan for guide
  let tierTag = '';
  if (deck.tier) {
    tierTag = `<span class="deck-tier-tag" data-t="${_esc(deck.tier)}">T${_esc(deck.tier)}</span>`;
  } else if (deck._source === 'official') {
    tierTag = `<span class="deck-tier-tag official">OFFICIAL</span>`;
  } else if (deck._source === 'guide') {
    tierTag = `<span class="deck-tier-tag guide">GUIDE</span>`;
  }

  // Rank badge (top-right) — index is 0-based position in the filtered list
  const rank = Number.isFinite(index) ? `<span class="deck-src-badge">#${String(index + 1).padStart(2, '0')}</span>` : '';

  const deckColors = _getDeckColors(deck, cardsMap);
  const colorDots = deckColors.slice(0, 3).map(c =>
    `<span class="cd" style="background:${COLOR_CSS[c] || '#888'}"></span>`
  ).join('');

  const desc = localized(deck.description, '');
  const descText = typeof desc === 'string' ? desc : '';
  const safeDesc = _esc(descText.slice(0, 100));
  const cardCount = deck.cards_count ?? (deck.cards || []).length;
  const stratCount = deck.strategy_count ?? (deck.strategy || []).length;

  const jaTitle = typeof deck.title === 'object' ? (deck.title.ja || '') : (deck.title || '');
  const searchText = [jaTitle, title, descText, deck.deck_id].join(' ').toLowerCase();

  return `
    <div class="guide-card deck-card" data-deck-id="${_esc(deck.deck_id)}" data-search-text="${_esc(searchText)}">
      <div class="deck-thumb-wrap">
        ${imgHtml}
        ${tierTag}
        ${rank}
        ${tierLetter}
      </div>
      <div class="deck-body">
        <div class="deck-meta-row">
          ${colorDots ? `<span class="color-dots">${colorDots}</span>` : ''}
          ${deck.date ? `<span class="deck-date">${_esc(deck.date)}</span>` : ''}
        </div>
        <div class="deck-title">${safeTitle}</div>
        ${descText ? `<p class="deck-desc">${safeDesc}${descText.length > 100 ? '...' : ''}</p>` : ''}
        <div class="deck-foot">
          ${cardCount ? `<span><span class="stat-n">${_esc(cardCount)}</span> <span class="stat-lbl">${_esc(t('guides_cards'))}</span></span>` : ''}
          ${stratCount ? `<span><span class="stat-n">${_esc(stratCount)}</span> <span class="stat-lbl">${_esc(t('guides_strats'))}</span></span>` : ''}
          <span class="deck-foot-arrow" aria-hidden="true">→</span>
        </div>
      </div>
    </div>
  `;
}
