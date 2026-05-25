import { renderDeckModal } from './components/deck-view.js';
import { renderCardGallery, renderCardDetail } from './components/card-view.js';
import { renderTournamentView, renderTournamentDeckModal } from './components/tournament-view.js';
import { renderGuidesView } from './components/guides-view.js';
import { renderRulesView } from './components/rules-view.js';
import { initI18n, setLang, getLang, applyStaticTranslations, t } from './i18n.js';

const COLOR_HEX = { '白': '#e0e0e0', '綠': '#4caf50', '紅': '#f44336', '藍': '#2196f3', '紫': '#9c27b0', '黃': '#ffeb3b' };
const TIER_LABEL = { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', 'official': 'Official', 'guide': '其他攻略' };
const TYPE_LABEL = { '主推': '主推', '成員': '成員', 'support': '支援', '吶喊': '吶喊' };

let cardsData = [];
let tierData = null;
let decksData = [];
let decklogDecks = [];
let allGuides = [];
let officialDecks = [];
let rulesData = null;
let currentView = 'guides';
const filters = {
  colors: new Set(),
  tiers: new Set(),
  types: new Set(),
  search: '',
};

const _loaded = { cards: false, decklog: false };

function _fetchJSON(url) {
  return fetch(url).then(r => r.ok ? r.json() : null);
}

async function loadCoreData() {
  const [tierResp, decksResp, guidesResp, officialResp, rulesResp] = await Promise.all([
    _fetchJSON('data/tier_list.json'),
    _fetchJSON('data/decks.json'),
    _fetchJSON('data/all_guides.json'),
    _fetchJSON('data/official_decks.json'),
    _fetchJSON('data/rules.json'),
  ]);
  tierData = tierResp;
  decksData = decksResp || [];
  allGuides = guidesResp || [];
  officialDecks = officialResp || [];
  rulesData = rulesResp;
}

async function ensureCards() {
  if (_loaded.cards) return;
  _loaded.cards = true;
  cardsData = (await _fetchJSON('data/cards.json')) || [];
  updateNavCounts();
}

async function ensureDecklog() {
  if (_loaded.decklog) return;
  _loaded.decklog = true;
  decklogDecks = (await _fetchJSON('data/decklog_decks.json')) || [];
  updateNavCounts();
}

// ── View / filter state coordination ─────────────────────────────────────
function _legacyFilters() {
  // Bridge multi-select Sets to the single-value shape existing components expect.
  return {
    color: filters.colors.size === 1 ? [...filters.colors][0] : 'all',
    colors: filters.colors,
    tier: filters.tiers.size === 1 ? [...filters.tiers][0] : 'all',
    tiers: filters.tiers,
    type: filters.types.size === 1 ? [...filters.types][0] : 'all',
    types: filters.types,
    search: filters.search,
  };
}

async function render() {
  const guidesView = document.getElementById('guidesView');
  const tournamentView = document.getElementById('tournamentView');
  const cardsView = document.getElementById('cardsView');
  const rulesView = document.getElementById('rulesView');

  guidesView.classList.toggle('active', currentView === 'guides');
  tournamentView.classList.toggle('active', currentView === 'tournament');
  cardsView.classList.toggle('active', currentView === 'cards');
  rulesView.classList.toggle('active', currentView === 'rules');

  // Show only relevant filter blocks per view.
  const filterSection = document.getElementById('filterSection');
  const tierBlock = document.getElementById('tierFilterBlock');
  const typeBlock = document.getElementById('typeFilterBlock');
  const colorHeader = document.querySelector('.filter-header[data-filter="color"]');
  const colorGrid = document.getElementById('colorDotGrid');

  const showColor = currentView === 'guides' || currentView === 'cards';
  const showTier = currentView === 'guides';
  const showType = currentView === 'cards';
  const showAnyFilter = showColor || showTier || showType;
  if (filterSection) filterSection.hidden = !showAnyFilter;
  if (colorHeader) colorHeader.hidden = !showColor;
  if (colorGrid) colorGrid.hidden = !showColor;
  if (tierBlock) tierBlock.hidden = !showTier;
  if (typeBlock) typeBlock.hidden = !showType;

  updateTopbar();
  updateActiveFilterBar();

  if (currentView === 'guides') {
    await ensureCards();
    renderGuidesView(guidesView, allGuides, decksData, cardsData, _legacyFilters(), officialDecks);
    updateTopbarSubtitleFromGuides();
  } else if (currentView === 'tournament') {
    await Promise.all([ensureDecklog(), ensureCards()]);
    renderTournamentView(tournamentView, decklogDecks, cardsData);
  } else if (currentView === 'cards') {
    await ensureCards();
    renderCardGallery(cardsView, cardsData, _legacyFilters(), rulesData);
    document.getElementById('topbarSubtitle').textContent = t('topbar_subtitle_cards', { total: cardsData.length });
  } else if (currentView === 'rules') {
    await ensureCards();
    renderRulesView(rulesView, rulesData, cardsData);
    document.getElementById('topbarSubtitle').textContent = t('topbar_subtitle_rules');
  }
}

function updateTopbar() {
  const titleKey = currentView === 'guides' ? 'nav_guides'
    : currentView === 'tournament' ? 'nav_tournament'
    : currentView === 'cards' ? 'nav_cards'
    : 'nav_rules';
  const label = t(titleKey);
  document.getElementById('topbarTitle').textContent = label;
  document.getElementById('crumbCur').textContent = label;
  document.getElementById('topbarSubtitle').textContent = '';
  if (currentView === 'tournament') {
    document.getElementById('topbarSubtitle').textContent = t('topbar_subtitle_tournament');
  }
}

function updateTopbarSubtitleFromGuides() {
  // Use the guides view's own count if it rendered one
  const cnt = document.getElementById('guidesCount');
  const sub = document.getElementById('topbarSubtitle');
  if (cnt && cnt.textContent.trim()) {
    sub.textContent = cnt.textContent.trim();
  }
}

// ── Nav (sidebar) ────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    const activate = () => {
      document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      closeDrawer();
      render();
    };
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}

function updateNavCounts() {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  // Guides count = unique tier-decks + guides + official
  const guidesCount = (decksData?.length || 0) +
    (officialDecks?.length || 0) +
    (allGuides?.filter(g => !decksData?.some(d => d.url === g.url)).length || 0);
  setText('navCountGuides', guidesCount || '·');
  setText('navCountTournament', decklogDecks?.length || (rulesData ? '·' : '·'));
  setText('navCountCards', cardsData?.length || '·');
  const rulesCount = ((rulesData?.restricted_cards?.length) || 0) +
    (Object.keys(rulesData?.errata || {}).length) +
    ((rulesData?.articles?.length) || 0);
  setText('navCountRules', rulesCount || '·');
}

// ── Filters: color dots + tier chips + type chips ────────────────────────
function setupFilters() {
  document.querySelectorAll('#colorDotGrid .color-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.color;
      if (filters.colors.has(v)) filters.colors.delete(v);
      else filters.colors.add(v);
      applyFilterUI();
      render();
    });
  });

  document.querySelectorAll('#tierChipRow .tier-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.tier;
      if (filters.tiers.has(v)) filters.tiers.delete(v);
      else filters.tiers.add(v);
      applyFilterUI();
      render();
    });
  });

  document.querySelectorAll('#typeChipRow .tier-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.type;
      if (filters.types.has(v)) filters.types.delete(v);
      else filters.types.add(v);
      applyFilterUI();
      render();
    });
  });

  // Header "clear" buttons
  document.getElementById('colorFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.colors.clear();
    applyFilterUI();
    render();
  });
  document.getElementById('tierFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.tiers.clear();
    applyFilterUI();
    render();
  });
  document.getElementById('typeFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.types.clear();
    applyFilterUI();
    render();
  });

  document.getElementById('clearAllBtn')?.addEventListener('click', () => {
    filters.colors.clear();
    filters.tiers.clear();
    filters.types.clear();
    applyFilterUI();
    render();
  });
}

function applyFilterUI() {
  // Update color dots
  document.querySelectorAll('#colorDotGrid .color-dot').forEach(btn => {
    const on = filters.colors.has(btn.dataset.color);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#tierChipRow .tier-chip').forEach(btn => {
    const on = filters.tiers.has(btn.dataset.tier);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('#typeChipRow .tier-chip').forEach(btn => {
    const on = filters.types.has(btn.dataset.type);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  // Filter header counts + clear buttons
  const updHeader = (countId, clearId, n) => {
    const c = document.getElementById(countId);
    const x = document.getElementById(clearId);
    if (c) { c.hidden = n === 0; c.textContent = String(n); }
    if (x) x.hidden = n === 0;
  };
  updHeader('colorFilterCount', 'colorFilterClear', filters.colors.size);
  updHeader('tierFilterCount', 'tierFilterClear', filters.tiers.size);
  updHeader('typeFilterCount', 'typeFilterClear', filters.types.size);

  const totalFilters = filters.colors.size + filters.tiers.size + filters.types.size;
  const clearAll = document.getElementById('clearAllBtn');
  if (clearAll) clearAll.hidden = totalFilters === 0;
}

function updateActiveFilterBar() {
  const bar = document.getElementById('activeFilterBar');
  if (!bar) return;
  const totalFilters = filters.colors.size + filters.tiers.size + filters.types.size;
  if (totalFilters === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;

  const parts = [`<span class="active-filter-label">${t('active_filter_label')}</span>`];

  for (const v of filters.colors) {
    parts.push(`
      <button class="active-filter-pill" data-kind="color" data-value="${v}">
        <span class="active-filter-swatch" style="background:${COLOR_HEX[v] || '#888'}"></span>
        ${v}
        <span class="active-filter-x" aria-hidden="true">×</span>
      </button>`);
  }
  for (const v of filters.tiers) {
    parts.push(`
      <button class="active-filter-pill" data-kind="tier" data-value="${v}">
        ${TIER_LABEL[v] || v}
        <span class="active-filter-x" aria-hidden="true">×</span>
      </button>`);
  }
  for (const v of filters.types) {
    parts.push(`
      <button class="active-filter-pill" data-kind="type" data-value="${v}">
        ${TYPE_LABEL[v] || v}
        <span class="active-filter-x" aria-hidden="true">×</span>
      </button>`);
  }
  parts.push(`<button class="active-filter-clear" id="activeFilterClearAll">${t('active_filter_clear')}</button>`);
  bar.innerHTML = parts.join('');

  bar.querySelectorAll('.active-filter-pill').forEach(p => {
    p.addEventListener('click', () => {
      const kind = p.dataset.kind;
      const val = p.dataset.value;
      const set = kind === 'color' ? filters.colors : kind === 'tier' ? filters.tiers : filters.types;
      set.delete(val);
      applyFilterUI();
      render();
    });
  });
  document.getElementById('activeFilterClearAll')?.addEventListener('click', () => {
    filters.colors.clear();
    filters.tiers.clear();
    filters.types.clear();
    applyFilterUI();
    render();
  });
}

// ── Topbar search ────────────────────────────────────────────────────────
function setupTopbarSearch() {
  const topSearch = document.getElementById('topbarSearch');
  if (!topSearch) return;
  let timeout;
  topSearch.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const v = topSearch.value.trim();
      filters.search = v;

      if (currentView === 'guides') {
        const g = document.getElementById('guideSearch');
        if (g) {
          g.value = v;
          g.dispatchEvent(new Event('input'));
        }
      } else if (currentView === 'cards') {
        const c = document.getElementById('cardSearch');
        if (c) c.value = v;
        render();
      }
    }, 220);
  });
}

// ── Collapse / drawer ────────────────────────────────────────────────────
const appShell = () => document.getElementById('appShell');

function setupCollapse() {
  const btn = document.getElementById('collapseBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const app = appShell();
    const isCollapsed = app.dataset.collapsed === 'true';
    app.dataset.collapsed = isCollapsed ? 'false' : 'true';
  });
}

function openDrawer() {
  const app = appShell();
  if (app) app.dataset.drawer = 'open';
}
function closeDrawer() {
  const app = appShell();
  if (app) app.dataset.drawer = 'closed';
}

function setupDrawer() {
  document.getElementById('mobileHamburger')?.addEventListener('click', openDrawer);
  document.getElementById('mobileClose')?.addEventListener('click', closeDrawer);
  document.getElementById('mobileBackdrop')?.addEventListener('click', closeDrawer);
}

// ── Language (popover dropdown) ──────────────────────────────────────────
function renderLangSwitcher() {
  const current = getLang();
  const opts = document.querySelectorAll('#langPop .lang-opt');
  let activeOpt = null;
  opts.forEach(opt => {
    const on = opt.dataset.lang === current;
    opt.classList.toggle('is-active', on);
    opt.setAttribute('aria-selected', String(on));
    if (on) activeOpt = opt;
  });
  if (activeOpt) {
    const code = activeOpt.querySelector('.lang-opt-code')?.textContent;
    const name = activeOpt.querySelector('.lang-opt-name')?.textContent;
    const codeEl = document.getElementById('langTriggerCode');
    const nameEl = document.getElementById('langTriggerName');
    if (codeEl && code) codeEl.textContent = code;
    if (nameEl && name) nameEl.textContent = name;
  }
}

function setupLangSwitcher() {
  const trigger = document.getElementById('langTrigger');
  const pop = document.getElementById('langPop');
  const picker = document.getElementById('langPicker');
  if (!trigger || !pop || !picker) return;

  const openPop = () => {
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  const closePop = () => {
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const togglePop = () => (pop.hidden ? openPop() : closePop());

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop();
  });

  document.addEventListener('click', (e) => {
    if (!pop.hidden && !picker.contains(e.target)) closePop();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      closePop();
      trigger.focus();
    }
  });

  pop.querySelectorAll('.lang-opt').forEach(opt => {
    const choose = () => {
      setLang(opt.dataset.lang);
      applyStaticTranslations();
      renderLangSwitcher();
      updateNavCounts();
      render();
      closePop();
      trigger.focus();
    };
    opt.addEventListener('click', choose);
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
  });
}

// ── Modals (carry-over from original) ────────────────────────────────────
function setupModals() {
  const deckModal = document.getElementById('deckModal');
  const deckModalBody = document.getElementById('deckModalBody');
  const cardModal = document.getElementById('cardModal');
  const cardModalBody = document.getElementById('cardModalBody');

  document.addEventListener('click', async (e) => {
    const clickableCard = e.target.closest('.clickable-card');
    if (clickableCard && !e.target.closest('.gallery-card')) {
      const cardId = clickableCard.dataset.cardId;
      if (cardId) {
        await ensureCards();
        const card = cardsData.find(c => c.id === cardId);
        if (card) {
          renderCardDetail(cardModalBody, card, cardsData, rulesData);
          cardModal.hidden = false;
          document.body.style.overflow = 'hidden';
          return;
        }
      }
    }

    const tournamentDeckCard = e.target.closest('.tournament-deck-card');
    if (tournamentDeckCard) {
      const decklogId = tournamentDeckCard.dataset.decklogId;
      await ensureCards();
      renderTournamentDeckModal(deckModalBody, decklogId, decklogDecks, cardsData);
      deckModal.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }

    const deckCard = e.target.closest('.deck-card');
    if (deckCard) {
      const deckId = deckCard.dataset.deckId;
      await ensureCards();
      renderDeckModal(deckModalBody, deckId, tierData, decksData, allGuides, officialDecks, cardsData);
      deckModal.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }

    const galleryCard = e.target.closest('.gallery-card');
    if (galleryCard) {
      const cardId = galleryCard.dataset.cardId;
      await ensureCards();
      const card = cardsData.find(c => c.id === cardId);
      renderCardDetail(cardModalBody, card, cardsData, rulesData);
      cardModal.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }
  });

  function closeModal(modal) {
    modal.hidden = true;
    if (modal === cardModal && !deckModal.hidden) return;
    document.body.style.overflow = '';
  }

  for (const modal of [deckModal, cardModal]) {
    modal.querySelector('.modal-backdrop')?.addEventListener('click', () => closeModal(modal));
    modal.querySelector('.modal-close')?.addEventListener('click', () => closeModal(modal));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!cardModal.hidden) closeModal(cardModal);
      else if (!deckModal.hidden) closeModal(deckModal);
      else closeDrawer();
    }
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────
async function init() {
  initI18n();
  applyStaticTranslations();
  renderLangSwitcher();
  setupNav();
  setupFilters();
  setupTopbarSearch();
  setupCollapse();
  setupDrawer();
  setupLangSwitcher();
  setupModals();
  applyFilterUI();
  await loadCoreData();
  updateNavCounts();
  render();
  // Preload card + tournament data in the background so nav counts populate
  // without the user having to visit those views first.
  ensureCards();
  ensureDecklog();
}

init();
