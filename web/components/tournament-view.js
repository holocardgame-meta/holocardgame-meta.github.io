import { t, getLang } from '../i18n.js';
import { escapeHtml as _esc, safeUrl } from '../utils/sanitize.js';

const KNOWN_WGP_EVENTS = [
  { event: 'WGP2025 Tokyo',               date: '2025-05-05', location: 'Tokyo Big Sight' },
  { event: 'WGP2025 Nagoya',              date: '2025-08-17', location: 'Portmesse Nagoya' },
  { event: 'WGP2025 Chiba - A Block',     date: '2025-09-15', location: 'Makuhari Messe' },
  { event: 'WGP2025 Chiba - B Block',     date: '2025-09-15', location: 'Makuhari Messe' },
  { event: 'WGP2025 Chiba - C Block',     date: '2025-09-15', location: 'Makuhari Messe' },
  { event: 'WGP2025 Chiba - D Block',     date: '2025-09-15', location: 'Makuhari Messe' },
  { event: 'WGP2025 Chiba - E Block',     date: '2025-09-15', location: 'Makuhari Messe' },
  { event: 'WGP25-26 Aichi - 個人戦 - A Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - 個人戦 - B Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - 個人戦 - C Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - 個人戦 - D Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - 個人戦 - E Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - 個人戦 - F Block',     date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - トリオバトル - A Block', date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Aichi - トリオバトル - B Block', date: '2026-02-08', location: 'Aichi Sky Expo' },
  { event: 'WGP25-26 Taipei',             date: '2026-03-14', location: 'Taipei International Convention Center' },
  { event: 'ぐるっとツアー2026 Miyagi - A Block',    date: '2026-04-04', location: '仙台市中小企業活性化センター' },
  { event: 'ぐるっとツアー2026 Miyagi - B Block',    date: '2026-04-04', location: '仙台市中小企業活性化センター' },
  { event: 'WGP25-26 Kuala Lumpur',       date: '2026-04-19', location: 'World Trade Centre KL' },
  { event: 'WGP25-26 Fukuoka - 個人戦 - A Block',                   date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - 個人戦 - B Block',                   date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - 個人戦 - C Block',                   date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - 個人戦 - D Block',                   date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - トリオバトル - A Block',             date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - トリオバトル - B Block',             date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Fukuoka - らでんのまいたけぐるぐるカップ',     date: '2026-05-10', location: 'Kitakyushu Messe' },
  { event: 'WGP25-26 Hong Kong',          date: '2026-05-23', location: '' },
];

const USAGE_RATE_DATA = {
  'WGP2025 Chiba': {
    scope: { 'zh-TW': '預選ラウンド 約2000人', en: 'Qualifier ~2000 players', ja: '予選ラウンド 約2000人', fr: 'Qualifications ~2000 joueurs' },
    source: 'hololive OFFICIAL CARD GAME X (@hololive_OCG)',
    rates: [
      { oshi: 'クレイジー・オリー', pct: 25 },
      { oshi: '天音かなた', pct: 23 },
      { oshi: '紫咲シオン', pct: 9 },
      { oshi: '小鳥遊キアラ', pct: 8 },
      { oshi: '沙花叉クロヱ', pct: 8 },
      { oshi: '星街すいせい', pct: 6 },
      { oshi: '宝鐘マリン', pct: 6 },
      { oshi: 'その他', pct: 15 },
    ],
  },
  'WGP25-26 Aichi - 個人戦': {
    scope: { 'zh-TW': '個人戰 預選ラウンド', en: 'Individual Qualifier Round', ja: '個人戦 予選ラウンド', fr: 'Qualifications individuelles' },
    source: 'hololive OFFICIAL CARD GAME (@hololive_OCG)',
    rates: [
      { oshi: '戌神ころね', pct: 25 },
      { oshi: '百鬼あやめ', pct: 17 },
      { oshi: '風真いろは', pct: 10 },
      { oshi: '森カリオペ', pct: 8 },
      { oshi: 'ラオーラ・パンデーラ', pct: 5 },
      { oshi: '大空スバル', pct: 4 },
      { oshi: 'ロボ子さん', pct: 4 },
      { oshi: '儒烏風亭らでん', pct: 4 },
      { oshi: '兎田ぺこら', pct: 3 },
      { oshi: '星咲リオナ', pct: 3 },
      { oshi: 'その他', pct: 17 },
    ],
  },
  'WGP25-26 Taipei': {
    scope: { 'zh-TW': '預選ラウンド', en: 'Qualifier Round', ja: '予選ラウンド', fr: 'Qualifications' },
    source: 'hololive OFFICIAL CARD GAME',
    rates: [
      { oshi: 'AZKi', pct: 22 },
      { oshi: '角巻わため', pct: 9 },
      { oshi: '風真いろは', pct: 8 },
      { oshi: '百鬼あやめ', pct: 8 },
      { oshi: '赤井はあと', pct: 7 },
      { oshi: '戌神ころね', pct: 5 },
      { oshi: '森カリオペ', pct: 4 },
      { oshi: '桃鈴ねね', pct: 3 },
      { oshi: '古石ビジュー', pct: 3 },
      { oshi: 'その他', pct: 31 },
    ],
  },
  'WGP25-26 Kuala Lumpur': {
    scope: { 'zh-TW': '預選ラウンド', en: 'Qualifier Round', ja: '予選ラウンド', fr: 'Qualifications' },
    source: 'hololive OFFICIAL CARD GAME (@hololive_OCG)',
    rates: [
      { oshi: 'AZKi', pct: 23 },
      { oshi: '大神ミオ', pct: 21 },
      { oshi: 'オーロ・クロニー', pct: 11 },
      { oshi: '角巻わため', pct: 6 },
      { oshi: '赤井はあと', pct: 6 },
      { oshi: '森カリオペ', pct: 4 },
      { oshi: '星街すいせい', pct: 4 },
      { oshi: '桃鈴ねね', pct: 3 },
      { oshi: '百鬼あやめ', pct: 3 },
      { oshi: 'その他', pct: 19 },
    ],
  },
  'WGP25-26 Fukuoka - 個人戦': {
    scope: { 'zh-TW': '個人戰 預選ラウンド', en: 'Individual Qualifier Round', ja: '個人戦 予選ラウンド', fr: 'Qualifications individuelles' },
    source: 'hololive OFFICIAL CARD GAME',
    rates: [
      { oshi: 'AZKi', pct: 23 },
      { oshi: 'オーロ・クロニー', pct: 14 },
      { oshi: '大神ミオ', pct: 14 },
      { oshi: '角巻わため', pct: 6 },
      { oshi: '風真いろは', pct: 5 },
      { oshi: '桃鈴ねね', pct: 5 },
      { oshi: '響咲リオナ', pct: 4 },
      { oshi: '赤井はあと', pct: 3 },
      { oshi: '森カリオペ', pct: 3 },
      { oshi: '戌神ころね', pct: 2 },
      { oshi: '兎田ぺこら', pct: 2 },
      { oshi: 'その他', pct: 19 },
    ],
  },
  'WGP25-26 Fukuoka - トリオバトル': {
    scope: { 'zh-TW': 'Trio 預選ラウンド', en: 'Trio Qualifier Round', ja: 'トリオバトル 予選ラウンド', fr: 'Trio Qualifications' },
    source: 'hololive OFFICIAL CARD GAME',
    rates: [
      { oshi: 'AZKi', pct: 24 },
      { oshi: 'オーロ・クロニー', pct: 18 },
      { oshi: '大神ミオ', pct: 17 },
      { oshi: '角巻わため', pct: 5 },
      { oshi: '風真いろは', pct: 4 },
      { oshi: '響咲リオナ', pct: 4 },
      { oshi: '赤井はあと', pct: 3 },
      { oshi: '桃鈴ねね', pct: 3 },
      { oshi: '兎田ぺこら', pct: 3 },
      { oshi: '戌神ころね', pct: 2 },
      { oshi: '森カリオペ', pct: 2 },
      { oshi: '百鬼あやめ', pct: 1 },
      { oshi: 'その他', pct: 14 },
    ],
  },
  'WGP25-26 Fukuoka - らでんのまいたけぐるぐるカップ': {
    scope: { 'zh-TW': 'らでんのまいたけぐるぐるカップ', en: "Raden's Maitake Guruguru Cup", ja: 'らでんのまいたけぐるぐるカップ', fr: 'Coupe Maitake Guruguru de Raden' },
    source: 'hololive OFFICIAL CARD GAME',
    rates: [
      { oshi: '儒烏風亭らでん', pct: 28 },
      { oshi: 'AZKi', pct: 21 },
      { oshi: 'オーロ・クロニー', pct: 14 },
      { oshi: '大神ミオ', pct: 6 },
      { oshi: '角巻わため', pct: 4 },
      { oshi: '風真いろは', pct: 3 },
      { oshi: '森カリオペ', pct: 2 },
      { oshi: '桃鈴ねね', pct: 2 },
      { oshi: '赤井はあと', pct: 2 },
      { oshi: '戌神ころね', pct: 2 },
      { oshi: 'その他', pct: 16 },
    ],
  },
  'WGP25-26 Hong Kong': {
    scope: { 'zh-TW': '預選ラウンド', en: 'Qualifier Round', ja: '予選ラウンド', fr: 'Qualifications' },
    source: 'hololive OFFICIAL CARD GAME',
    rates: [
      { oshi: 'AZKi', pct: 36 },
      { oshi: 'オーロ・クロニー', pct: 20 },
      { oshi: '大神ミオ', pct: 12 },
      { oshi: '角巻わため', pct: 5 },
      { oshi: '風真いろは', pct: 5 },
      { oshi: '赤井はあと', pct: 5 },
      { oshi: '桃鈴ねね', pct: 3 },
      { oshi: '百鬼あやめ', pct: 2 },
      { oshi: 'ラプラス・ダークネス', pct: 2 },
      { oshi: 'その他', pct: 10 },
    ],
  },
  'ぐるっとツアー2026 Miyagi': {
    scope: { 'zh-TW': 'Trio 預選ラウンド', en: 'Trio Qualifier Round', ja: 'トリオバトル 予選ラウンド', fr: 'Trio Qualifications' },
    source: 'hololive OFFICIAL CARD GAME (@hololive_OCG)',
    rates: [
      { oshi: 'AZKi', pct: 21 },
      { oshi: '大神ミオ', pct: 19 },
      { oshi: 'オーロ・クロニー', pct: 14 },
      { oshi: '赤井はあと', pct: 11 },
      { oshi: '角巻わため', pct: 9 },
      { oshi: '響咲リオナ', pct: 4 },
      { oshi: '風真いろは', pct: 4 },
      { oshi: '桃鈴ねね', pct: 2 },
      { oshi: '百鬼あやめ', pct: 2 },
      { oshi: '兎田ぺこら', pct: 2 },
      { oshi: 'その他', pct: 12 },
    ],
  },
};

// Oshi color (from hololive OCG card color) → bar fill colour.
// Lets the same oshi show in the same colour across every chart.
const OSHI_COLOR = {
  // 綠 (green)
  'AZKi': 'green',
  '儒烏風亭らでん': 'green',
  '兎田ぺこら': 'green',
  '大神ミオ': 'green',
  '風真いろは': 'green',
  // 藍 (blue)
  'オーロ・クロニー': 'blue',
  'シオリ・ノヴェラ': 'blue',
  '星街すいせい': 'blue',
  '沙花叉クロヱ': 'blue',
  // 紫 (purple)
  'クレイジー・オリー': 'purple',
  'ラプラス・ダークネス': 'purple',
  '森カリオペ': 'purple',
  // 黃 (yellow)
  '大空スバル': 'yellow',
  '戌神ころね': 'yellow',
  '桃鈴ねね': 'yellow',
  '角巻わため': 'yellow',
  // 紅 (red)
  '宝鐘マリン': 'red',
  '小鳥遊キアラ': 'red',
  '尾丸ポルカ': 'red',
  '百鬼あやめ': 'red',
  '赤井はあと': 'red',
  // 白 (white)
  '天音かなた': 'white',
  '姫森ルーナ': 'white',
  '響咲リオナ': 'white',
};

const CARD_COLOR_HEX = {
  green:  '#4caf50',
  blue:   '#2196f3',
  purple: '#9c27b0',
  yellow: '#ffeb3b',
  red:    '#f44336',
  white:  '#e0e0e0',
  other:  '#888888',
};

export function renderTournamentView(container, decklogDecks, cardsData) {
  const cardsMap = {};
  if (cardsData) {
    for (const c of cardsData) cardsMap[c.id] = c;
  }

  const grouped = {};

  if (decklogDecks?.length) {
    for (const deck of decklogDecks) {
      const key = deck.event || deck.source || 'Other';
      if (!grouped[key]) grouped[key] = { decks: [], date: deck.event_date || '' };
      grouped[key].decks.push(deck);
    }
  }

  for (const known of KNOWN_WGP_EVENTS) {
    if (!grouped[known.event]) {
      grouped[known.event] = { decks: [], date: known.date, location: known.location };
    }
    if (!grouped[known.event].location) {
      grouped[known.event].location = known.location;
    }
  }

  const _placementOrder = (p) => {
    if (!p) return 999;
    if (p.startsWith('1st') || p.startsWith('Trio 1st')) return 1;
    if (p.startsWith('2nd') || p.startsWith('Trio 2nd')) return 2;
    if (p.startsWith('3rd') || p.startsWith('Trio 3rd')) return 3;
    if (p.includes('Undefeated')) return 0;
    const m = p.match(/(\d+)/);
    return m ? parseInt(m[1]) : 500;
  };

  const sortedEvents = Object.entries(grouped)
    .sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));

  for (const [, g] of sortedEvents) {
    g.decks.sort((a, b) => _placementOrder(a.placement) - _placementOrder(b.placement));
  }

  let html = '';

  const today = new Date().toISOString().slice(0, 10);
  const usageRendered = new Set();

  // Group sub-events back under their parent tournament name (everything before the first " - ").
  // e.g. "WGP25-26 Fukuoka - 個人戦 - A Block" → group "WGP25-26 Fukuoka".
  const groups = {};
  const groupOrder = [];
  for (const [event, data] of sortedEvents) {
    const groupKey = event.split(' - ')[0];
    if (!groups[groupKey]) {
      groups[groupKey] = { events: [], date: data.date || '', location: data.location || '' };
      groupOrder.push(groupKey);
    }
    groups[groupKey].events.push([event, data]);
    if (!groups[groupKey].location && data.location) groups[groupKey].location = data.location;
  }

  for (let gi = 0; gi < groupOrder.length; gi++) {
    const groupKey = groupOrder[gi];
    const group = groups[groupKey];
    const totalDecks = group.events.reduce((sum, [, d]) => sum + d.decks.length, 0);
    const isUpcomingGroup = group.date > today;
    const isOpen = gi === 0; // first (most recent) group starts open
    const subSectionCount = group.events.length;
    const showInnerHeader = subSectionCount > 1; // single-section groups don't need the redundant inner header

    let innerHtml = '';
    for (const [event, { decks, date, location }] of group.events) {
      const isUpcoming = date > today;
      const statusBadge = isUpcoming
        ? `<span class="tournament-event-status upcoming">${t('tournament_upcoming')}</span>`
        : '';

      const locationHtml = (showInnerHeader && location)
        ? `<span class="tournament-event-location">${_esc(location)}</span>`
        : '';

      const usageKey = _findUsageKey(event);
      let usageHtml = '';
      if (usageKey && !usageRendered.has(usageKey)) {
        usageRendered.add(usageKey);
        usageHtml = _renderUsageChart(USAGE_RATE_DATA[usageKey]);
      }

      // Sub-section label is the part of the event name AFTER the group prefix (e.g. "個人戦 - A Block").
      const subLabel = event.startsWith(groupKey + ' - ') ? event.slice(groupKey.length + 3) : event;
      const innerHeader = showInnerHeader
        ? `<div class="tournament-event-header tournament-subsection-header">
            <span class="tournament-event-name">${_esc(subLabel)}</span>
            ${locationHtml}
            ${statusBadge}
            ${decks.length ? `<span class="tournament-event-count">${decks.length} ${_esc(t('decks_count'))}</span>` : ''}
          </div>`
        : '';

      // Split decks into 本戦 (finals) vs 予選ラウンド (qualifier round) when both exist.
      const mainEventDecks = decks.filter(d => !(d.placement || '').includes('Qualifier'));
      const qualifierDecks = decks.filter(d =>  (d.placement || '').includes('Qualifier'));
      let decksHtml;
      if (mainEventDecks.length && qualifierDecks.length) {
        decksHtml = `
          <div class="tournament-subsection-label">${t('tournament_main_event')}</div>
          <div class="tournament-deck-grid">${mainEventDecks.map(deck => renderTournamentDeckCard(deck, cardsMap)).join('')}</div>
          <div class="tournament-subsection-label">${t('tournament_qualifier')}</div>
          <div class="tournament-deck-grid">${qualifierDecks.map(deck => renderTournamentDeckCard(deck, cardsMap)).join('')}</div>
        `;
      } else if (decks.length) {
        decksHtml = `<div class="tournament-deck-grid">${decks.map(deck => renderTournamentDeckCard(deck, cardsMap)).join('')}</div>`;
      } else {
        decksHtml = `<div class="tournament-no-deck-placeholder">${isUpcoming ? t('tournament_upcoming_msg') : t('tournament_no_deck_data')}</div>`;
      }

      innerHtml += `
        <section class="tournament-event-section${isUpcoming ? ' upcoming-event' : ''}">
          ${innerHeader}
          ${usageHtml}
          ${decksHtml}
        </section>
      `;
    }

    const groupStatusBadge = isUpcomingGroup
      ? `<span class="tournament-event-status upcoming">${t('tournament_upcoming')}</span>`
      : '';
    const groupLocationHtml = group.location
      ? `<span class="tournament-event-location">${_esc(group.location)}</span>`
      : '';

    const metaBits = [
      group.date ? `<span class="tournament-event-date">${_esc(group.date)}</span>` : '',
      groupLocationHtml,
      groupStatusBadge,
      totalDecks ? `<span class="tournament-event-count">${totalDecks} ${_esc(t('decks_count'))}</span>` : '',
    ].filter(Boolean).join('');

    html += `
      <details class="tournament-group${isUpcomingGroup ? ' upcoming-event' : ''}" ${isOpen ? 'open' : ''}>
        <summary class="tournament-group-header">
          <span class="tournament-group-name">${_esc(groupKey)}</span>
          ${metaBits ? `<span class="tournament-group-meta">${metaBits}</span>` : ''}
        </summary>
        <div class="tournament-group-body">
          ${innerHtml}
        </div>
      </details>
    `;
  }

  container.innerHTML = html;
}

function _findUsageKey(eventName) {
  for (const key of Object.keys(USAGE_RATE_DATA)) {
    if (eventName === key || eventName.startsWith(key + ' -')) return key;
  }
  return null;
}

function _renderUsageChart(data) {
  const lang = getLang();
  const scope = data.scope[lang] || data.scope['en'] || '';
  const maxPct = Math.max(...data.rates.map(r => r.pct));

  const bars = data.rates.map((r) => {
    const color = CARD_COLOR_HEX[OSHI_COLOR[r.oshi]] || CARD_COLOR_HEX.other;
    const width = Math.max((r.pct / maxPct) * 100, 2);
    return `
      <div class="usage-bar-row">
        <span class="usage-bar-label">${_esc(r.oshi)}</span>
        <div class="usage-bar-track">
          <div class="usage-bar-fill" style="width:${width}%;background:${color}">
            <span class="usage-bar-pct">${_esc(r.pct)}%</span>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <details class="usage-chart-wrapper" open>
      <summary class="usage-chart-title">${_esc(t('tournament_usage_rate'))}<span class="usage-chart-scope">${_esc(scope)}</span></summary>
      <div class="usage-chart-bars">${bars}</div>
      <div class="usage-chart-source">${_esc(t('tournament_source'))}: ${_esc(data.source)}</div>
    </details>`;
}

function renderTournamentDeckCard(deck, cardsMap) {
  if (deck.missing) {
    const placementHtml = deck.placement
      ? `<span class="tournament-placement">${_esc(deck.placement)}</span>`
      : '';
    return `
      <div class="tournament-deck-card missing-deck">
        <div class="tournament-deck-top">
          <div class="tournament-oshi-placeholder missing-placeholder">?</div>
          <div class="tournament-deck-info">
            <div class="tournament-deck-name">${t('tournament_missing_deck')}</div>
            ${placementHtml}
          </div>
        </div>
        <div class="tournament-deck-stats">
          <span class="missing-deck-note">${t('tournament_missing_deck_note')}</span>
        </div>
      </div>
    `;
  }

  const oshiCard = deck.oshi_cards?.[0];
  const oshiInfo = oshiCard ? cardsMap[oshiCard.card_id] : null;
  const oshiImage = oshiInfo?.imageUrl || '';

  const placementHtml = deck.placement
    ? `<span class="tournament-placement">${_esc(deck.placement)}</span>`
    : '';

  return `
    <div class="tournament-deck-card" data-decklog-id="${_esc(deck.deck_id)}">
      <div class="tournament-deck-top">
        ${oshiImage ? `<img class="tournament-oshi-img" src="${safeUrl(oshiImage)}" alt="${_esc(deck.oshi)}" loading="lazy" decoding="async">` : '<div class="tournament-oshi-placeholder"></div>'}
        <div class="tournament-deck-info">
          <div class="tournament-deck-name">${_esc(deck.title)}</div>
          <div class="tournament-deck-oshi">${_esc(deck.oshi)}</div>
          ${placementHtml}
        </div>
      </div>
      <div class="tournament-deck-stats">
        <span>${_esc(t('tournament_main_deck'))}: ${_esc(deck.main_deck_count)} ${_esc(t('tournament_cards'))}</span>
        <span>${_esc(t('tournament_cheer_deck'))}: ${_esc(deck.cheer_deck_count)} ${_esc(t('tournament_cards'))}</span>
      </div>
    </div>
  `;
}

const _COLOR_HEX_TOURN = {
  '白': '#e8e8e8', '綠': '#4caf50', '緑': '#4caf50',
  '紅': '#f44336', '赤': '#f44336',
  '藍': '#2196f3', '青': '#2196f3',
  '紫': '#9c27b0', '黃': '#ffeb3b', '黄': '#ffeb3b',
};
const _COLOR_ALIAS_TOURN = {
  '白': '白', '綠': '綠', '緑': '綠', '紅': '紅', '赤': '紅',
  '藍': '藍', '青': '藍', '紫': '紫', '黃': '黃', '黄': '黃',
};

function _normColor(c) { return _COLOR_ALIAS_TOURN[String(c || '').trim()] || ''; }

function _dominantDeckColor(deck, cardsMap) {
  const counts = {};
  const sources = [deck?.oshi_cards, deck?.main_deck];
  for (const arr of sources) {
    if (!arr) continue;
    for (const c of arr) {
      const dbCard = c.card_id ? cardsMap[c.card_id] : null;
      const colors = String(dbCard?.color || c.color || '').split('/');
      for (const col of colors) {
        const norm = _normColor(col);
        if (norm) counts[norm] = (counts[norm] || 0) + (c.count || 1);
      }
    }
  }
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return sorted[0] || null;
}

function _glyphFromName(name) {
  if (!name) return '?';
  const m = String(name).match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/);
  return m ? m[0] : String(name)[0].toUpperCase();
}

function _renderDeckRow(c, cardsMap) {
  const info = cardsMap[c.card_id] || {};
  const imageUrl = info.imageUrl || c.imageUrl || '';
  const name = info.name || c.name || c.card_id || '';
  const color = _normColor(info.color || c.color || '') || '';
  const cssColor = _COLOR_HEX_TOURN[color] || '#666';
  const count = c.count || 1;
  return `
    <div class="dcr clickable-card" data-card-id="${_esc(c.card_id || '')}" style="--dcr-c:${cssColor}">
      <div class="dcr-thumb">
        ${imageUrl
          ? `<img src="${safeUrl(imageUrl)}" alt="${_esc(name)}" loading="lazy" decoding="async">`
          : `<div class="dcr-thumb-pattern"></div><span class="dcr-glyph">${_esc(_glyphFromName(name))}</span>`}
      </div>
      <div class="dcr-info">
        <div class="dcr-name" title="${_esc(name)}">${_esc(name)}</div>
        ${c.card_id ? `<div class="dcr-code">${_esc(c.card_id)}</div>` : ''}
        ${count > 1 ? `<div class="dcr-count">×${_esc(count)}</div>` : ''}
      </div>
    </div>
  `;
}

function _renderDeckBlock(no, title, count, cards, cardsMap, gridClass) {
  if (!cards?.length) return '';
  return `
    <div class="deckp-block">
      <div class="deckp-section-head">
        <span class="deckp-head-no">${_esc(no)}</span>
        <h2>${_esc(title)}</h2>
        <span class="deckp-head-count">×${_esc(count)}</span>
      </div>
      <div class="deck-rows-grid${gridClass ? ' ' + gridClass : ''}">
        ${cards.map(c => _renderDeckRow(c, cardsMap)).join('')}
      </div>
    </div>
  `;
}

export function renderTournamentDeckModal(container, decklogId, decklogDecks, cardsData) {
  const deck = decklogDecks?.find(d => d.deck_id === decklogId);
  if (!deck) {
    container.innerHTML = `<p>${t('deck_not_found')}</p>`;
    return;
  }

  const cardsMap = {};
  if (cardsData) for (const c of cardsData) cardsMap[c.id] = c;

  const oshiCount = (deck.oshi_cards || []).reduce((s, c) => s + (c.count || 1), 0);
  const mainCount = deck.main_deck_count || (deck.main_deck || []).reduce((s, c) => s + (c.count || 1), 0);
  const cheerCount = deck.cheer_deck_count || (deck.cheer_deck || []).reduce((s, c) => s + (c.count || 1), 0);

  // Dominant color → drives oshi badge color tinting
  const dominantColor = _dominantDeckColor(deck, cardsMap);
  const oshiBadgeColor = dominantColor ? _COLOR_HEX_TOURN[dominantColor] : '#9333ea';

  const badges = [];
  if (deck.oshi) badges.push({ kind: 'oshi', label: deck.oshi, style: `background:linear-gradient(135deg, ${oshiBadgeColor}cc 0%, ${oshiBadgeColor}99 100%); border-color: ${oshiBadgeColor};` });
  if (deck.event) badges.push({ kind: 'event', label: deck.event });
  if (deck.placement) badges.push({ kind: 'place', label: deck.placement });

  const badgesHtml = badges.map(b => `<span class="xbadge xbadge-${b.kind}"${b.style ? ` style="${b.style}"` : ''}>${_esc(b.label)}</span>`).join('');

  const countTilesHtml = `
    <div class="deckp-hero-counts">
      <div class="hc-tile"><div class="hc-val">${_esc(mainCount)}</div><div class="hc-label">${_esc(t('tournament_main_deck'))}</div></div>
      <div class="hc-tile"><div class="hc-val">${_esc(cheerCount)}</div><div class="hc-label">${_esc(t('tournament_cheer_deck'))}</div></div>
    </div>
  `;

  // Sections — only those with data
  let n = 1;
  const sectionsHtml = [
    deck.oshi_cards?.length ? _renderDeckBlock(String(n++).padStart(2, '0'), t('tournament_oshi_card'), oshiCount, deck.oshi_cards, cardsMap, 'deck-rows-grid--oshi') : '',
    deck.main_deck?.length ? _renderDeckBlock(String(n++).padStart(2, '0'), t('tournament_main_deck'), mainCount, deck.main_deck, cardsMap, '') : '',
    deck.cheer_deck?.length ? _renderDeckBlock(String(n++).padStart(2, '0'), t('tournament_cheer_deck'), cheerCount, deck.cheer_deck, cardsMap, 'deck-rows-grid--cheers') : '',
  ].join('');

  const footerHtml = deck.url ? `
    <div class="deckp-footer">
      <a href="${safeUrl(deck.url)}" class="dl-btn" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        <span>${_esc(t('tournament_view_decklog')).replace(/→\s*$/, '')}</span>
        <span class="dl-arrow">→</span>
      </a>
      <span class="deckp-footer-note">${_esc(t('tournament_source'))} · Bushiroad Deck Log</span>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="deck-page">
      <header class="deckp-hero deckp-hero--flat">
        <div class="deckp-hero-left">
          <div class="deckp-hero-eyebrow">${_esc(t('eyebrow_deck_recipe'))}</div>
          <h1 class="deckp-hero-title">${_esc(deck.title || '')}</h1>
          ${deck.oshi ? `<div class="deckp-hero-sub">${_esc(deck.oshi)}</div>` : ''}
          ${badgesHtml ? `<div class="deckp-hero-badges">${badgesHtml}</div>` : ''}
        </div>
        ${countTilesHtml}
      </header>

      <div class="deckp-body deckp-body--flat">
        <section class="deckp-flat-main">
          ${sectionsHtml}
          ${footerHtml}
        </section>
      </div>
    </div>
  `;
}
