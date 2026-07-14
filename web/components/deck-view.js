import { t, localized } from '../i18n.js';
import { escapeHtml as _esc, safeUrl } from '../utils/sanitize.js';
import { COLOR_HEX, normalizeColor as _normColor, colorsFromValue as _colorsFromValue, glyphFrom as _glyphFrom } from '../utils/colors.js';
import { parsePhases } from '../utils/phases.js';

function _deckColors(deck, cardsMap) {
  if (Array.isArray(deck?.colors) && deck.colors.length) {
    return deck.colors.map(_normColor).filter(Boolean);
  }

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

// Badge labels are i18n keys so every language shows a consistent, correctly
// translated phase name regardless of how the strategy text words its
// headings.
const PHASE_LABEL_KEYS = { early: 'phase_early', mid: 'phase_mid', late: 'phase_late' };

// Build phase sections from scraper-stamped `phase` fields (authoritative —
// they survive translation untouched); consecutive same-phase chunks merge
// into one section. Falls back to parsePhases() text parsing for data scraped
// before stamping existed.
function _strategyPhases(strategy) {
  if (strategy.some(st => st && st.phase)) {
    const phases = [];
    for (const st of strategy) {
      const txt = localized(st.text, '');
      if (!txt) continue;
      // Whitelist: `phase` is scraped data and flows into a class attribute,
      // so anything but the known values degrades to the unbadged 'pre'.
      const phase = Object.hasOwn(PHASE_LABEL_KEYS, st.phase) ? st.phase : 'pre';
      const last = phases[phases.length - 1];
      if (last && last.phase === phase) last.text += '\n\n' + txt;
      else phases.push({ phase, label: '', text: txt });
    }
    return phases;
  }
  // Parse on a space-join, not '\n\n': chunk boundaries in pre-stamping data
  // sit wherever the OLD parser split — sometimes mid-sentence — and a
  // newline would turn each of those into a segment start, resurrecting the
  // very false boundaries the parser is meant to ignore. Real headings follow
  // sentence punctuation in the text itself, so they stay detectable.
  const chunks = strategy.map(st => localized(st.text, '')).filter(Boolean);
  const phases = parsePhases(chunks.join(' '));
  if (!phases.some(p => p.phase !== 'all' && p.phase !== 'pre')) {
    // No headings found: the single block keeps the '\n\n' chunk joins so
    // paragraph separation survives (.phase-text renders pre-line).
    return [{ phase: 'all', label: '', text: chunks.join('\n\n') }];
  }
  return phases;
}

const DEAD_IMAGE_HOSTS = ['holocardstrategy.jp'];
function _isLiveImg(url) {
  return !!url && !DEAD_IMAGE_HOSTS.some(h => url.includes(h));
}
// Resolve a card to a live image URL. Scraped `image` fields point at
// holocardstrategy.jp (dead), so prefer the official card DB art (github.io)
// resolved via card_id, and only use the scraped URL when it's still live.
function _liveCardImg(card, cardsMap) {
  const dbCard = card?.card_id ? cardsMap?.[card.card_id] : null;
  if (dbCard && _isLiveImg(dbCard.imageUrl)) return dbCard.imageUrl;
  if (_isLiveImg(card?.image)) return card.image;
  if (_isLiveImg(card?.imageUrl)) return card.imageUrl;
  if (dbCard && _isLiveImg(dbCard.image)) return dbCard.image;
  return null;
}
function _cardImage(card, cardsMap) {
  const src = _liveCardImg(card, cardsMap);
  if (!src) return null;
  const dbCard = card?.card_id ? cardsMap?.[card.card_id] : null;
  return {
    src,
    alt: card?.name || dbCard?.name || card?.card_id || '',
  };
}

function _heroEmblemImage({ recipe, deckInfo, deck, cardsMap }) {
  if (deck?.oshi_image) return { src: deck.oshi_image, alt: deck.oshi || deck.title || '' };
  if (recipe?.oshi_image) return { src: recipe.oshi_image, alt: deckInfo?.vtuber || '' };

  const cards = recipe?.cards || [];
  const oshiName = deck?.oshi || deckInfo?.vtuber || '';
  if (oshiName) {
    const matchedCard = cards.find(c => {
      const name = String(c?.name || cardsMap?.[c?.card_id]?.name || '');
      return name && (name.includes(oshiName) || oshiName.includes(name));
    });
    const matchedImage = _cardImage(matchedCard, cardsMap);
    if (matchedImage) return matchedImage;
  }

  for (const card of cards) {
    const image = _cardImage(card, cardsMap);
    if (image) return image;
  }
  return null;
}

function _renderHeroEmblem({ image, imageAlt, colors = [], glyph, badgeHtml = '' }) {
  const normalizedColors = colors.map(_normColor).filter(c => COLOR_HEX[c]);
  const imageHtml = image?.src
    ? `<img class="guide-hero-emblem-img" src="${safeUrl(image.src)}" alt="${_esc(imageAlt || image.alt || '')}" loading="lazy" decoding="async">`
    : '';
  const colorsHtml = !imageHtml && normalizedColors.length
    ? `<div class="guide-hero-emblem-colors" data-count="${normalizedColors.length}">
        ${normalizedColors.map(c => `<span class="guide-hero-emblem-color" style="background:${COLOR_HEX[c]}" title="${_esc(c)}"></span>`).join('')}
      </div>`
    : '';
  const glyphHtml = !imageHtml && !colorsHtml
    ? `<div class="emblem-glyph">${_esc(glyph || '?')}</div>`
    : '';
  const stateClass = imageHtml ? ' has-image' : colorsHtml ? ' has-colors' : '';
  return `
    <div class="guide-hero-emblem${stateClass}">
      ${imageHtml}
      ${colorsHtml}
      ${glyphHtml}
      <span class="emblem-corner emblem-corner-tl"></span>
      <span class="emblem-corner emblem-corner-tr"></span>
      <span class="emblem-corner emblem-corner-bl"></span>
      <span class="emblem-corner emblem-corner-br"></span>
      ${badgeHtml}
    </div>`;
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
  if (descText) sections.push({ id: 'overview', no: '01', title: t('section_overview'),     titleEn: 'Overview' });
  if (featuresList.length) sections.push({ id: 'features', no: String(sections.length + 1).padStart(2, '0'), title: t('section_features'),     titleEn: 'Features' });
  if (cards.length) sections.push({ id: 'keycards', no: String(sections.length + 1).padStart(2, '0'), title: t('official_key_cards'), titleEn: 'Key cards' });
  if (strategy.length) sections.push({ id: 'strategy', no: String(sections.length + 1).padStart(2, '0'), title: t('section_strategy'),     titleEn: 'Strategy' });

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
  const rawDeckImage = recipe?.deck_image || deckInfo?.image || '';
  const deckImage = _isLiveImg(rawDeckImage) ? rawDeckImage : '';
  const heroImage = _heroEmblemImage({ recipe, deckInfo, cardsMap });

  const heroMeta = [
    vtuber ? { label: t('meta_oshi'), val: _esc(vtuber) } : null,
    colorsHtml ? { label: t('meta_color'),  valHtml: `<span class="hero-meta-val hero-colors">${colorsHtml}</span>`, raw: true } : null,
    recipe?.deck_id ? { label: t('meta_id'),  val: _esc(recipe.deck_id), mono: true } : null,
    recipe?.date ? { label: t('meta_updated'), val: _esc(recipe.date), mono: true } : null,
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
        ${s.title.toLowerCase() !== s.titleEn.toLowerCase() ? `<span class="toc-titleEn">${_esc(s.titleEn)}</span>` : ''}
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
        const keyImg = _liveCardImg(c, cardsMap);
        const colorDot = c.color
          ? `<span class="cd" style="background:${COLOR_HEX[_normColor(c.color)] || '#666'}"></span>`
          : (() => {
              const dbCard = c.card_id ? cardsMap[c.card_id] : null;
              const col = dbCard?.color ? _normColor(dbCard.color) : '';
              return col ? `<span class="cd" style="background:${COLOR_HEX[col]}"></span>` : '';
            })();
        return `
          <article class="keycard clickable-card" data-card-id="${_esc(c.card_id || '')}">
            ${keyImg ? `<img class="keycard-img" src="${safeUrl(keyImg)}" alt="${_esc(c.name)}" loading="lazy" decoding="async">` : '<div class="keycard-noimg">🃏</div>'}
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
            ${s.title.toLowerCase() !== s.titleEn.toLowerCase() ? `<div class="section-sub">${_esc(s.titleEn)}</div>` : ''}
          </div>
        </header>
        ${body}
      </section>
    `;
  }).join('');

  const railHtml = recipe?.url
    ? `<aside class="guide-rail">
        <div class="rail-block">
          <div class="rail-label">${_esc(t('meta_source'))} / Source</div>
          <ul class="rail-sources">
            <li><a href="${safeUrl(recipe.url)}" target="_blank" rel="noopener" data-ga-link="source_guide" data-ga-item-id="${_esc(recipe.deck_id || '')}">${_esc(t('source_link'))}</a></li>
          </ul>
        </div>
      </aside>`
    : '';

  container.innerHTML = `
    <div class="guide-page">
      <header class="guide-hero">
        <div class="guide-hero-grid">
          ${_renderHeroEmblem({
            image: heroImage,
            imageAlt: vtuber || titleZh,
            colors: deckColors,
            glyph: _glyphFrom(titleJa || titleZh),
            badgeHtml: tierLetter,
          })}
          <div class="guide-hero-text">
            <div class="guide-hero-eyebrow">${_esc(t('eyebrow_guide'))}</div>
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
          <img src="${safeUrl(deckImage)}" alt="${_esc(titleZh)}" loading="lazy" decoding="async">
          <figcaption class="banner-caption">${_esc(t('deck_snapshot_caption'))} / DECK SNAPSHOT</figcaption>
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
  if (descText) sections.push({ id: 'overview', no: '01', title: t('section_overview'),  titleEn: 'Overview' });
  if (deck.oshi || deck.oshi_image) sections.push({ id: 'oshi', no: String(sections.length + 1).padStart(2, '0'), title: t('tournament_oshi_card'),  titleEn: 'Oshi' });
  if (keyCards.length) sections.push({ id: 'keycards', no: String(sections.length + 1).padStart(2, '0'), title: t('official_key_cards'),   titleEn: 'Key cards' });
  if (mainDeck.length) sections.push({ id: 'main',     no: String(sections.length + 1).padStart(2, '0'), title: t('tournament_main_deck'), titleEn: 'Main deck' });
  if (cheerDeck.length) sections.push({ id: 'cheer',   no: String(sections.length + 1).padStart(2, '0'), title: t('tournament_cheer_deck'),titleEn: 'Cheer deck' });
  if (strategy.length) sections.push({ id: 'strategy', no: String(sections.length + 1).padStart(2, '0'), title: t('section_strategy'),     titleEn: 'Strategy' });

  if (sections.length === 0) {
    container.innerHTML = `<div class="guide-page"><header class="guide-hero"><h1 class="guide-hero-title">${_esc(title)}</h1></header></div>`;
    return;
  }

  const heroMeta = [
    deck.oshi ? { label: t('meta_oshi'), val: _esc(deck.oshi) } : null,
    deck.date ? { label: t('meta_updated'), val: _esc(deck.date), mono: true } : null,
    deck.source ? { label: t('meta_source'), val: _esc(deck.source) } : null,
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
        ${s.title.toLowerCase() !== s.titleEn.toLowerCase() ? `<span class="toc-titleEn">${_esc(s.titleEn)}</span>` : ''}
      </span>
    </button>
  `).join('');

  const _gridSection = (cards) => {
    // Numeric coercion is load-bearing: scraped counts flow into innerHTML
    // unescaped via the {total} interpolation below.
    const total = cards.reduce((s, c) => s + (Number(c.count) || 1), 0);
    return `
      <div class="grid-totals">${t('deck_total_cards', { total: `<strong>${total}</strong>` })}</div>
      <div class="official-card-grid">
        ${cards.map(c => `
          <div class="official-card-entry clickable-card" data-card-id="${_esc(c.card_id || '')}">
            ${c.imageUrl ? `<img src="${safeUrl(c.imageUrl)}" alt="${_esc(c.card_id || '')}" loading="lazy" decoding="async">` : ''}
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
          ${deck.oshi_image ? `<img class="oshi-img" src="${safeUrl(deck.oshi_image)}" alt="${_esc(deck.oshi || '')}" loading="lazy" decoding="async">` : ''}
          <div class="oshi-info">
            <div class="oshi-eyebrow">${_esc(t('oshi_holomen_label'))}</div>
            <div class="oshi-name">${_esc(deck.oshi || '')}</div>
            ${oshiId ? `<div class="oshi-id">${_esc(oshiId)}</div>` : ''}
          </div>
        </div>
      `;
    } else if (s.id === 'keycards') {
      body = `<div class="keycards-grid">${keyCards.map(k => `
        <article class="keycard clickable-card" data-card-id="${_esc(k.card_id || '')}">
          ${k.imageUrl ? `<img class="keycard-img" src="${safeUrl(k.imageUrl)}" alt="${_esc(k.name || '')}" loading="lazy" decoding="async">` : '<div class="keycard-noimg">🃏</div>'}
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
      const phases = _strategyPhases(strategy);
      const hasPhases = phases.some(p => p.phase !== 'all' && p.phase !== 'pre');
      if (hasPhases) {
        body = `<div class="phase-flow">${phases.map(p => `
          <div class="phase-step phase-step-${p.phase}">
            ${PHASE_LABEL_KEYS[p.phase] ? `<div class="phase-head">
              <span class="phase-badge">${_esc(t(PHASE_LABEL_KEYS[p.phase]))}</span>
            </div>` : ''}
            <p class="phase-text">${_esc(p.text)}</p>
          </div>
        `).join('')}</div>`;
      } else {
        // Fallback: single block when no phase headings present
        const fullText = phases.map(p => p.text).join('\n\n');
        body = `<div class="phase-flow"><div class="phase-step phase-step-all"><p class="phase-text">${_esc(fullText)}</p></div></div>`;
      }
    }

    return `
      <section class="guide-section${i === 0 ? ' is-active' : ''}" data-section="${s.id}">
        <header class="guide-section-head">
          <div class="section-no">${s.no}</div>
          <div>
            <h2>${_esc(s.title)}</h2>
            ${s.title.toLowerCase() !== s.titleEn.toLowerCase() ? `<div class="section-sub">${_esc(s.titleEn)}</div>` : ''}
          </div>
        </header>
        ${body}
      </section>
    `;
  }).join('');

  const railHtml = deck.url
    ? `<aside class="guide-rail">
        <div class="rail-block">
          <div class="rail-label">${_esc(t('meta_source'))} / Source</div>
          <ul class="rail-sources">
            <li><a href="${safeUrl(deck.url)}" target="_blank" rel="noopener" data-ga-link="source_guide" data-ga-item-id="${_esc(deck.deck_id || '')}">${_esc(t('source_link'))}</a></li>
          </ul>
        </div>
      </aside>`
    : '';
  const heroImage = _heroEmblemImage({ deck });

  container.innerHTML = `
    <div class="guide-page">
      <header class="guide-hero">
        <div class="guide-hero-grid">
          ${_renderHeroEmblem({
            image: heroImage,
            imageAlt: deck.oshi || title,
            glyph: _glyphFrom(deck.oshi || title),
            badgeHtml: '<div class="emblem-letter">OFCL</div>',
          })}
          <div class="guide-hero-text">
            <div class="guide-hero-eyebrow">${_esc(t('eyebrow_official'))}</div>
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
