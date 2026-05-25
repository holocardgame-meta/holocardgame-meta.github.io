import { t, localized } from '../i18n.js';

const COLOR_ALIAS = {
  '白': '白', '綠': '綠', '緑': '綠', '紅': '紅', '赤': '紅',
  '藍': '藍', '青': '藍', '紫': '紫', '黃': '黃', '黄': '黃',
};
const COLOR_HEX = {
  '白': '#e8e8e8', '綠': '#4caf50', '紅': '#f44336',
  '藍': '#2196f3', '紫': '#9c27b0', '黃': '#ffeb3b',
};

function _normColor(c) { return COLOR_ALIAS[String(c || '').trim()] || ''; }
function _colorsFromValue(v) { return String(v || '').split('/').map(_normColor).filter(Boolean); }

function _deckColors(deck, cardsMap) {
  const counts = {};
  for (const c of deck?.cards || []) {
    const dbCard = c.card_id ? cardsMap[c.card_id] : null;
    for (const color of _colorsFromValue(dbCard?.color || c.color)) {
      counts[color] = (counts[color] || 0) + 1;
    }
  }
  return Object.keys(counts)
    .filter(c => COLOR_HEX[c])
    .sort((a, b) => counts[b] - counts[a]);
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const PHASE_MARKERS = {
  early: /^(序盤|序章|前期|早期|早盤|Early(?:\s*game)?|En\s+d[ée]but)/i,
  mid:   /^(中盤|中期(?:戦)?|Mid(?:dle)?(?:\s*game)?|En\s+milieu)/i,
  late:  /^(終盤|終章|後期|後半|Late(?:\s*game)?|End(?:\s*game)?|En\s+fin)/i,
};
const PHASE_PATTERN = /(序盤|序章|前期|早期|早盤|中盤|中期戦|中期|終盤|終章|後期|後半|Early(?:\s*game)?|Mid(?:dle)?(?:\s*game)?|Late(?:\s*game)?|End(?:\s*game)?|En\s+d[ée]but|En\s+milieu|En\s+fin)/gi;

function _classifyPhase(marker) {
  for (const [phase, re] of Object.entries(PHASE_MARKERS)) {
    if (re.test(marker)) return phase;
  }
  return null;
}

function _parsePhases(text) {
  if (!text) return [];
  const matches = [...text.matchAll(PHASE_PATTERN)];
  if (matches.length === 0) return [{ phase: 'all', text: text.trim() }];

  // Collect first occurrence of each phase (early/mid/late), in document order
  const boundaries = [];
  const seen = new Set();
  for (const m of matches) {
    const phase = _classifyPhase(m[1]);
    if (!phase || seen.has(phase)) continue;
    seen.add(phase);
    boundaries.push({ phase, label: m[1], start: m.index });
  }
  if (boundaries.length === 0) return [{ phase: 'all', text: text.trim() }];

  // Slice text between phase boundaries; any leading text before the first marker becomes preamble
  const phases = [];
  if (boundaries[0].start > 0) {
    const pre = text.slice(0, boundaries[0].start).trim();
    if (pre) phases.push({ phase: 'pre', label: '', text: pre });
  }
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].start;
    const end = i < boundaries.length - 1 ? boundaries[i + 1].start : text.length;
    phases.push({
      phase: boundaries[i].phase,
      label: boundaries[i].label,
      text: text.slice(start, end).trim(),
    });
  }
  return phases;
}

function _glyphFrom(text) {
  if (!text) return '?';
  const m = String(text).match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/);
  if (m) return m[0];
  const a = String(text).match(/[A-Za-z]/);
  return a ? a[0].toUpperCase() : '★';
}

export function renderDeckModal(container, deckId, tierData, decksData, allGuides, officialDecks, cardsData) {
  let deckInfo = null;
  let tierNum = null;
  if (tierData?.tiers) {
    for (const tier of tierData.tiers) {
      for (const d of tier.decks) {
        if (d.id === deckId) {
          deckInfo = d;
          tierNum = tier.tier;
          break;
        }
      }
      if (deckInfo) break;
    }
  }

  let recipe = decksData?.find(d => d.deck_id === deckId);
  if (!recipe && allGuides) {
    recipe = allGuides.find(d => d.deck_id === deckId);
  }

  const officialDeck = officialDecks?.find(d => d.deck_id === deckId);

  if (!deckInfo && !recipe && !officialDeck) {
    container.innerHTML = `<p>${t('deck_not_found')}</p>`;
    return;
  }

  if (officialDeck) {
    _renderOfficialDeckModal(container, officialDeck);
    return;
  }

  _renderGuidePage(container, { deckInfo, tierNum, recipe, cardsData });
}

function _renderGuidePage(container, { deckInfo, tierNum, recipe, cardsData }) {
  const cardsMap = {};
  if (cardsData) for (const c of cardsData) cardsMap[c.id] = c;

  const titleZh = localized(recipe?.title, '') || deckInfo?.name || recipe?.deck_id || '';
  const titleJa = (typeof recipe?.title === 'object' ? recipe.title.ja : '') || '';
  const titleEn = (typeof recipe?.title === 'object' ? recipe.title.en : '') || '';

  const descLocalized = recipe?.description ? localized(recipe.description, '') : '';
  const descText = typeof descLocalized === 'string' ? descLocalized : '';

  const features = deckInfo ? localized(deckInfo.features, []) : [];
  const featuresList = Array.isArray(features) ? features : [];

  const cards = recipe?.cards || [];
  const strategy = recipe?.strategy || [];

  const deckColors = _deckColors(recipe, cardsMap);
  if (deckColors.length === 0 && deckInfo?.colors) {
    for (const c of _colorsFromValue(deckInfo.colors)) if (!deckColors.includes(c)) deckColors.push(c);
  }

  // Build TOC dynamically — only show sections that have real data
  const sections = [];
  if (descText) sections.push({ id: 'overview', no: '01', title: '概要',     titleEn: 'Overview' });
  if (featuresList.length) sections.push({ id: 'features', no: String(sections.length + 1).padStart(2, '0'), title: '特徴',     titleEn: 'Features' });
  if (cards.length) sections.push({ id: 'keycards', no: String(sections.length + 1).padStart(2, '0'), title: '採用カード', titleEn: 'Key cards' });
  if (strategy.length) sections.push({ id: 'strategy', no: String(sections.length + 1).padStart(2, '0'), title: '回し方',     titleEn: 'Strategy' });

  if (sections.length === 0) {
    container.innerHTML = `
      <div class="guide-page">
        <header class="guide-hero">
          <h1 class="guide-hero-title">${_esc(titleZh)}</h1>
        </header>
        <div style="padding:1.5rem 2rem;color:var(--text-2)">${t('no_card_list')}</div>
      </div>`;
    return;
  }

  const tierLetter = tierNum
    ? `<div class="emblem-letter">T${_esc(tierNum)}</div>`
    : '';

  const colorsHtml = deckColors.length
    ? deckColors.map(c => `<span class="hero-color"><span class="hero-color-dot" style="background:${COLOR_HEX[c]}"></span>${_esc(c)}</span>`).join('')
    : '';

  const vtuber = deckInfo?.vtuber || '';
  const deckImage = recipe?.deck_image || deckInfo?.image || '';

  const heroMeta = [
    vtuber ? { label: '推し', val: _esc(vtuber) } : null,
    colorsHtml ? { label: '色',  valHtml: `<span class="hero-meta-val hero-colors">${colorsHtml}</span>`, raw: true } : null,
    recipe?.deck_id ? { label: 'ID',  val: _esc(recipe.deck_id), mono: true } : null,
    recipe?.date ? { label: '更新', val: _esc(recipe.date), mono: true } : null,
  ].filter(Boolean);

  const heroMetaHtml = heroMeta.map(m => {
    if (m.raw) return `<span class="hero-meta-item"><span class="hero-meta-label">${_esc(m.label)}</span>${m.valHtml}</span>`;
    const valClass = m.mono ? 'hero-meta-val hero-mono' : 'hero-meta-val';
    return `<span class="hero-meta-item">
      <span class="hero-meta-label">${_esc(m.label)}</span>
      <span class="${valClass}">${m.val}</span>
    </span>`;
  }).join('');

  const tocHtml = sections.map((s, i) => `
    <button type="button" class="toc-item${i === 0 ? ' is-active' : ''}" data-toc-target="${s.id}">
      <span class="toc-no">${s.no}</span>
      <span class="toc-text">
        <span class="toc-title">${_esc(s.title)}</span>
        <span class="toc-titleEn">${_esc(s.titleEn)}</span>
      </span>
    </button>
  `).join('');

  const sectionsHtml = sections.map((s, i) => {
    let body = '';
    if (s.id === 'overview') {
      body = `<p class="lead">${_esc(descText)}</p>`;
    } else if (s.id === 'features') {
      body = `<div class="pillars">${featuresList.map((f, j) => `
        <div class="pillar">
          <div class="pillar-no">${String.fromCharCode(65 + j)}</div>
          <div class="pillar-text">${_esc(f)}</div>
        </div>
      `).join('')}</div>`;
    } else if (s.id === 'keycards') {
      body = `<div class="keycards-grid">${cards.map(c => {
        const role = localized(c.role, '');
        const roleText = typeof role === 'string' ? role : '';
        const colorDot = c.color
          ? `<span class="cd" style="background:${COLOR_HEX[_normColor(c.color)] || '#666'}"></span>`
          : (() => {
              const dbCard = c.card_id ? cardsMap[c.card_id] : null;
              const col = dbCard?.color ? _normColor(dbCard.color) : '';
              return col ? `<span class="cd" style="background:${COLOR_HEX[col]}"></span>` : '';
            })();
        return `
          <article class="keycard clickable-card" data-card-id="${_esc(c.card_id || '')}">
            ${c.image ? `<img class="keycard-img" src="${_esc(c.image)}" alt="${_esc(c.name)}" loading="lazy" decoding="async">` : '<div class="keycard-noimg">🃏</div>'}
            <div class="keycard-info">
              <div class="keycard-name">${_esc(c.name || '')}</div>
              ${c.card_id ? `<div class="keycard-id">${colorDot}${_esc(c.card_id)}</div>` : ''}
              ${roleText ? `<p class="keycard-why">${_esc(roleText)}</p>` : ''}
            </div>
          </article>
        `;
      }).join('')}</div>`;
    } else if (s.id === 'strategy') {
      body = `<ol class="turn-flow">${strategy.map((st, j) => {
        const title = localized(st.title, '');
        const text = localized(st.text, '');
        return `
          <li class="turn-step">
            <div class="turn-marker">
              <div class="turn-no">${String(j + 1).padStart(2, '0')}</div>
              <div class="turn-line"></div>
            </div>
            <div class="turn-body">
              ${title ? `<h3 class="turn-title">${_esc(title)}</h3>` : ''}
              <p class="turn-text">${_esc(text)}</p>
            </div>
          </li>
        `;
      }).join('')}</ol>`;
    }

    return `
      <section class="guide-section${i === 0 ? ' is-active' : ''}" data-section="${s.id}">
        <header class="guide-section-head">
          <div class="section-no">${s.no}</div>
          <div>
            <h2>${_esc(s.title)}</h2>
            <div class="section-sub">${_esc(s.titleEn)}</div>
          </div>
        </header>
        ${body}
      </section>
    `;
  }).join('');

  const railHtml = recipe?.url
    ? `<aside class="guide-rail">
        <div class="rail-block">
          <div class="rail-label">出典 / Source</div>
          <ul class="rail-sources">
            <li><a href="${_esc(recipe.url)}" target="_blank" rel="noopener">${_esc(t('source_link'))}</a></li>
          </ul>
        </div>
      </aside>`
    : '';

  container.innerHTML = `
    <div class="guide-page">
      <header class="guide-hero">
        <div class="guide-hero-grid">
          <div class="guide-hero-emblem">
            <div class="emblem-glyph">${_esc(_glyphFrom(titleJa || titleZh))}</div>
            <span class="emblem-corner emblem-corner-tl"></span>
            <span class="emblem-corner emblem-corner-tr"></span>
            <span class="emblem-corner emblem-corner-bl"></span>
            <span class="emblem-corner emblem-corner-br"></span>
            ${tierLetter}
          </div>
          <div class="guide-hero-text">
            <div class="guide-hero-eyebrow">攻略 GUIDE</div>
            <h1 class="guide-hero-title">${_esc(titleZh)}</h1>
            ${titleJa || titleEn ? `<div class="guide-hero-sub">${_esc(titleJa || titleEn)}</div>` : ''}
            ${heroMetaHtml ? `<div class="guide-hero-meta">${heroMetaHtml}</div>` : ''}
          </div>
        </div>
        ${deckImage ? `
        <figure class="guide-hero-banner">
          <span class="banner-corner banner-corner-tl"></span>
          <span class="banner-corner banner-corner-tr"></span>
          <span class="banner-corner banner-corner-bl"></span>
          <span class="banner-corner banner-corner-br"></span>
          <img src="${_esc(deckImage)}" alt="${_esc(titleZh)}" loading="lazy" decoding="async">
          <figcaption class="banner-caption">牌組構築 / DECK SNAPSHOT</figcaption>
        </figure>` : ''}
      </header>

      <div class="guide-body${railHtml ? '' : ' no-rail'}">
        <aside class="guide-toc">
          <div class="toc-label">CONTENTS</div>
          ${tocHtml}
          <div class="toc-progress"><div class="toc-progress-bar" style="width:${(1 / sections.length) * 100}%"></div></div>
        </aside>

        <article class="guide-article">${sectionsHtml}</article>

        ${railHtml}
      </div>
    </div>
  `;

  // TOC section switching
  const tocBtns = container.querySelectorAll('.toc-item');
  const sectionEls = container.querySelectorAll('.guide-section');
  const progressBar = container.querySelector('.toc-progress-bar');
  tocBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tocTarget;
      tocBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      sectionEls.forEach(s => s.classList.toggle('is-active', s.dataset.section === target));
      if (progressBar) progressBar.style.width = `${((idx + 1) / sections.length) * 100}%`;
    });
  });
}

function _renderOfficialDeckModal(container, deck) {
  const title = deck.title || '';
  const descLocalized = deck.description ? localized(deck.description, '') : '';
  const descText = typeof descLocalized === 'string' ? descLocalized : '';

  const mainDeck = deck.main_deck || [];
  const cheerDeck = deck.cheer_deck || [];
  const keyCards = deck.key_cards || [];
  const strategy = deck.strategy || [];

  // Build TOC dynamically — only show sections that have data
  const sections = [];
  if (descText) sections.push({ id: 'overview', no: '01', title: '概要',       titleEn: 'Overview' });
  if (deck.oshi || deck.oshi_image) sections.push({ id: 'oshi', no: String(sections.length + 1).padStart(2, '0'), title: '推し',       titleEn: 'Oshi' });
  if (keyCards.length) sections.push({ id: 'keycards', no: String(sections.length + 1).padStart(2, '0'), title: '主要卡片',   titleEn: 'Key cards' });
  if (mainDeck.length) sections.push({ id: 'main',     no: String(sections.length + 1).padStart(2, '0'), title: 'メインデッキ', titleEn: 'Main deck' });
  if (cheerDeck.length) sections.push({ id: 'cheer',   no: String(sections.length + 1).padStart(2, '0'), title: 'エールデッキ', titleEn: 'Cheer deck' });
  if (strategy.length) sections.push({ id: 'strategy', no: String(sections.length + 1).padStart(2, '0'), title: '戦略',       titleEn: 'Strategy' });

  if (sections.length === 0) {
    container.innerHTML = `<div class="guide-page"><header class="guide-hero"><h1 class="guide-hero-title">${_esc(title)}</h1></header></div>`;
    return;
  }

  const heroMeta = [
    deck.oshi ? { label: '推し', val: _esc(deck.oshi) } : null,
    deck.date ? { label: '更新', val: _esc(deck.date), mono: true } : null,
    deck.source ? { label: '出典', val: _esc(deck.source) } : null,
  ].filter(Boolean);

  const heroMetaHtml = heroMeta.map(m => {
    const valClass = m.mono ? 'hero-meta-val hero-mono' : 'hero-meta-val';
    return `<span class="hero-meta-item">
      <span class="hero-meta-label">${_esc(m.label)}</span>
      <span class="${valClass}">${m.val}</span>
    </span>`;
  }).join('');

  const tocHtml = sections.map((s, i) => `
    <button type="button" class="toc-item${i === 0 ? ' is-active' : ''}" data-toc-target="${s.id}">
      <span class="toc-no">${s.no}</span>
      <span class="toc-text">
        <span class="toc-title">${_esc(s.title)}</span>
        <span class="toc-titleEn">${_esc(s.titleEn)}</span>
      </span>
    </button>
  `).join('');

  const _gridSection = (cards) => {
    const total = cards.reduce((s, c) => s + (c.count || 1), 0);
    return `
      <div class="grid-totals">合計 <strong>${total}</strong> 張</div>
      <div class="official-card-grid">
        ${cards.map(c => `
          <div class="official-card-entry clickable-card" data-card-id="${_esc(c.card_id || '')}">
            ${c.imageUrl ? `<img src="${_esc(c.imageUrl)}" alt="${_esc(c.card_id || '')}" loading="lazy" decoding="async">` : ''}
            <span class="official-card-count">×${_esc(c.count)}</span>
            ${c.card_id ? `<span class="official-card-id">${_esc(c.card_id)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  };

  const sectionsHtml = sections.map((s, i) => {
    let body = '';
    if (s.id === 'overview') {
      body = `<p class="lead">${_esc(descText)}</p>`;
    } else if (s.id === 'oshi') {
      const oshiId = deck.oshi_card_id || '';
      body = `
        <div class="oshi-spotlight clickable-card"${oshiId ? ` data-card-id="${_esc(oshiId)}"` : ''}>
          ${deck.oshi_image ? `<img class="oshi-img" src="${_esc(deck.oshi_image)}" alt="${_esc(deck.oshi || '')}" loading="lazy" decoding="async">` : ''}
          <div class="oshi-info">
            <div class="oshi-eyebrow">推しホロメン</div>
            <div class="oshi-name">${_esc(deck.oshi || '')}</div>
            ${oshiId ? `<div class="oshi-id">${_esc(oshiId)}</div>` : ''}
          </div>
        </div>
      `;
    } else if (s.id === 'keycards') {
      body = `<div class="keycards-grid">${keyCards.map(k => `
        <article class="keycard clickable-card" data-card-id="${_esc(k.card_id || '')}">
          ${k.imageUrl ? `<img class="keycard-img" src="${_esc(k.imageUrl)}" alt="${_esc(k.name || '')}" loading="lazy" decoding="async">` : '<div class="keycard-noimg">🃏</div>'}
          <div class="keycard-info">
            <div class="keycard-name">${_esc(k.name || '')}</div>
            ${k.card_id ? `<div class="keycard-id">${_esc(k.card_id)}</div>` : ''}
            <p class="keycard-why">${_esc(localized(k.text, ''))}</p>
          </div>
        </article>
      `).join('')}</div>`;
    } else if (s.id === 'main') {
      body = _gridSection(mainDeck);
    } else if (s.id === 'cheer') {
      body = _gridSection(cheerDeck);
    } else if (s.id === 'strategy') {
      // Concat all strategy text, then parse phases
      const fullText = strategy.map(st => localized(st.text, '')).filter(Boolean).join('\n\n');
      const phases = _parsePhases(fullText);
      const hasPhases = phases.some(p => p.phase !== 'all' && p.phase !== 'pre');
      if (hasPhases) {
        body = `<div class="phase-flow">${phases.map(p => `
          <div class="phase-step phase-step-${p.phase}">
            ${p.label ? `<div class="phase-head">
              <span class="phase-badge">${_esc(p.label)}</span>
            </div>` : ''}
            <p class="phase-text">${_esc(p.text)}</p>
          </div>
        `).join('')}</div>`;
      } else {
        // Fallback: single block when no phase markers present
        body = `<div class="phase-flow"><div class="phase-step phase-step-all"><p class="phase-text">${_esc(fullText)}</p></div></div>`;
      }
    }

    return `
      <section class="guide-section${i === 0 ? ' is-active' : ''}" data-section="${s.id}">
        <header class="guide-section-head">
          <div class="section-no">${s.no}</div>
          <div>
            <h2>${_esc(s.title)}</h2>
            <div class="section-sub">${_esc(s.titleEn)}</div>
          </div>
        </header>
        ${body}
      </section>
    `;
  }).join('');

  const railHtml = deck.url
    ? `<aside class="guide-rail">
        <div class="rail-block">
          <div class="rail-label">出典 / Source</div>
          <ul class="rail-sources">
            <li><a href="${_esc(deck.url)}" target="_blank" rel="noopener">${_esc(t('source_link'))}</a></li>
          </ul>
        </div>
      </aside>`
    : '';

  container.innerHTML = `
    <div class="guide-page">
      <header class="guide-hero">
        <div class="guide-hero-grid">
          <div class="guide-hero-emblem">
            <div class="emblem-glyph">${_esc(_glyphFrom(deck.oshi || title))}</div>
            <span class="emblem-corner emblem-corner-tl"></span>
            <span class="emblem-corner emblem-corner-tr"></span>
            <span class="emblem-corner emblem-corner-bl"></span>
            <span class="emblem-corner emblem-corner-br"></span>
            <div class="emblem-letter">OFCL</div>
          </div>
          <div class="guide-hero-text">
            <div class="guide-hero-eyebrow">公式 OFFICIAL</div>
            <h1 class="guide-hero-title">${_esc(title)}</h1>
            ${heroMetaHtml ? `<div class="guide-hero-meta">${heroMetaHtml}</div>` : ''}
          </div>
        </div>
      </header>

      <div class="guide-body${railHtml ? '' : ' no-rail'}">
        <aside class="guide-toc">
          <div class="toc-label">CONTENTS</div>
          ${tocHtml}
          <div class="toc-progress"><div class="toc-progress-bar" style="width:${(1 / sections.length) * 100}%"></div></div>
        </aside>

        <article class="guide-article">${sectionsHtml}</article>

        ${railHtml}
      </div>
    </div>
  `;

  // TOC switching
  const tocBtns = container.querySelectorAll('.toc-item');
  const sectionEls = container.querySelectorAll('.guide-section');
  const progressBar = container.querySelector('.toc-progress-bar');
  tocBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tocTarget;
      tocBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      sectionEls.forEach(s => s.classList.toggle('is-active', s.dataset.section === target));
      if (progressBar) progressBar.style.width = `${((idx + 1) / sections.length) * 100}%`;
    });
  });
}
