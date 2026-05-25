import { renderDeckModal } from './components/deck-view.js';
import { renderCardGallery, renderCardDetail } from './components/card-view.js';
import { renderTournamentView, renderTournamentDeckModal } from './components/tournament-view.js';
import { renderGuidesView } from './components/guides-view.js';
import { renderRulesView } from './components/rules-view.js';
import { initI18n, setLang, getLang, applyStaticTranslations, t } from './i18n.js';

const COLOR_HEX = { '白': '#e0e0e0', '綠': '#4caf50', '紅': '#f44336', '藍': '#2196f3', '紫': '#9c27b0', '黃': '#ffeb3b' };
const TIER_LABEL = { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', 'official': 'Official', 'guide': '其他攻略' };
const TYPE_LABEL = { '主推': '主推', '成員': '成員', 'support': '支援', '吶喊': '吶喊' };
const GA_MEASUREMENT_ID = window.HOLOCARD_GA_ID || 'G-8WS4X0WWQQ';
const IOS_INSTALL_DISMISSED_KEY = 'holo-ios-install-dismissed-until';
const GA_PAGE_TITLES = {
  guides: 'HOLOCARD META - Deck Guides',
  tournament: 'HOLOCARD META - Tournament Decks',
  cards: 'HOLOCARD META - Card Search',
  rules: 'HOLOCARD META - Rules / Errata',
};

let cardsData = [];
let cardIndexData = [];
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
const _guideDetailCache = new Map();

function getGtag({ load = true } = {}) {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function(){ window.dataLayer.push(arguments); };
  }
  if (load && typeof window.holocardLoadGoogleTag === 'function') {
    window.holocardLoadGoogleTag();
  }
  return window.gtag;
}

function getGaPageLocation(viewName) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', viewName);
  url.hash = '';
  return url.toString();
}

function trackGaEvent(eventName, params = {}, options = {}) {
  const gtag = getGtag(options);
  gtag('event', eventName, {
    app_name: 'HOLOCARD META',
    view_name: currentView,
    language: getLang(),
    ...params,
  });
}

function trackGaPageView(viewName, options = {}) {
  trackGaEvent('page_view', {
    page_title: GA_PAGE_TITLES[viewName] || `HOLOCARD META - ${viewName}`,
    page_location: getGaPageLocation(viewName),
    page_path: `/${viewName}`,
    view_name: viewName,
  }, options);
}

function trackFilterChange(filterType, filterValue, isActive) {
  trackGaEvent('filter_change', {
    filter_type: filterType,
    filter_value: filterValue,
    filter_state: isActive ? 'add' : 'remove',
  });
}

function _fetchJSON(url) {
  return fetch(url).then(r => r.ok ? r.json() : null);
}

async function loadCoreData() {
  const [tierResp, decksResp, guidesResp, officialResp, rulesResp, cardIndexResp] = await Promise.all([
    _fetchJSON('data/tier_list.json'),
    _fetchJSON('data/decks.json'),
    _fetchJSON('data/guides_index.json'),
    _fetchJSON('data/official_decks.json'),
    _fetchJSON('data/rules.json'),
    _fetchJSON('data/card_index.json'),
  ]);
  tierData = tierResp;
  decksData = decksResp || [];
  allGuides = guidesResp || [];
  officialDecks = officialResp || [];
  rulesData = rulesResp;
  cardIndexData = cardIndexResp || [];
}

async function ensureCardIndex() {
  if (cardIndexData.length) return;
  cardIndexData = (await _fetchJSON('data/card_index.json')) || [];
  updateNavCounts();
}

async function ensureCards() {
  if (_loaded.cards) return;
  _loaded.cards = true;
  cardsData = (await _fetchJSON('data/cards.json')) || [];
  if (!cardIndexData.length) cardIndexData = cardsData;
  updateNavCounts();
}

async function ensureDecklog() {
  if (_loaded.decklog) return;
  _loaded.decklog = true;
  decklogDecks = (await _fetchJSON('data/decklog_decks.json')) || [];
  updateNavCounts();
}

async function ensureGuideDetail(deckId) {
  if (!deckId || _guideDetailCache.has(deckId)) return _guideDetailCache.get(deckId) || null;
  const guide = allGuides?.find(d => d.deck_id === deckId);
  if (!guide) return null;
  if (guide.cards || !guide.detail_path) {
    _guideDetailCache.set(deckId, guide);
    return guide;
  }

  const detail = await _fetchJSON(guide.detail_path);
  const fullGuide = detail ? { ...guide, ...detail } : guide;
  const idx = allGuides.indexOf(guide);
  if (idx >= 0) allGuides[idx] = fullGuide;
  _guideDetailCache.set(deckId, fullGuide);
  return fullGuide;
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
    await ensureCardIndex();
    renderGuidesView(guidesView, allGuides, decksData, cardIndexData, _legacyFilters(), officialDecks);
    updateTopbarSubtitleFromGuides();
  } else if (currentView === 'tournament') {
    await Promise.all([ensureDecklog(), ensureCardIndex()]);
    renderTournamentView(tournamentView, decklogDecks, cardIndexData);
  } else if (currentView === 'cards') {
    await ensureCards();
    renderCardGallery(cardsView, cardsData, _legacyFilters(), rulesData);
    document.getElementById('topbarSubtitle').textContent = t('topbar_subtitle_cards', { total: cardsData.length });
  } else if (currentView === 'rules') {
    await ensureCardIndex();
    renderRulesView(rulesView, rulesData, cardIndexData);
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
      const nextView = btn.dataset.view;
      document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const changedView = nextView !== currentView;
      currentView = nextView;
      if (changedView) trackGaPageView(currentView);
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
  setText('navCountCards', cardIndexData?.length || cardsData?.length || '·');
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
      const nextActive = !filters.colors.has(v);
      if (nextActive) filters.colors.add(v);
      else filters.colors.delete(v);
      trackFilterChange('color', v, nextActive);
      applyFilterUI();
      render();
    });
  });

  document.querySelectorAll('#tierChipRow .tier-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.tier;
      const nextActive = !filters.tiers.has(v);
      if (nextActive) filters.tiers.add(v);
      else filters.tiers.delete(v);
      trackFilterChange('tier', v, nextActive);
      applyFilterUI();
      render();
    });
  });

  document.querySelectorAll('#typeChipRow .tier-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.type;
      const nextActive = !filters.types.has(v);
      if (nextActive) filters.types.add(v);
      else filters.types.delete(v);
      trackFilterChange('type', v, nextActive);
      applyFilterUI();
      render();
    });
  });

  // Header "clear" buttons
  document.getElementById('colorFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.colors.clear();
    trackGaEvent('filter_clear', { filter_type: 'color' });
    applyFilterUI();
    render();
  });
  document.getElementById('tierFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.tiers.clear();
    trackGaEvent('filter_clear', { filter_type: 'tier' });
    applyFilterUI();
    render();
  });
  document.getElementById('typeFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filters.types.clear();
    trackGaEvent('filter_clear', { filter_type: 'type' });
    applyFilterUI();
    render();
  });

  document.getElementById('clearAllBtn')?.addEventListener('click', () => {
    filters.colors.clear();
    filters.tiers.clear();
    filters.types.clear();
    trackGaEvent('filter_clear', { filter_type: 'all' });
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
      trackFilterChange(kind, val, false);
      applyFilterUI();
      render();
    });
  });
  document.getElementById('activeFilterClearAll')?.addEventListener('click', () => {
    filters.colors.clear();
    filters.tiers.clear();
    filters.types.clear();
    trackGaEvent('filter_clear', { filter_type: 'all_active_bar' });
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
      if (v.length >= 2) {
        trackGaEvent('search', {
          search_term: v,
          search_context: currentView,
        });
      }

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
      const previousLanguage = getLang();
      const selectedLanguage = opt.dataset.lang;
      setLang(selectedLanguage);
      applyStaticTranslations();
      renderLangSwitcher();
      updateNavCounts();
      if (selectedLanguage !== previousLanguage) {
        trackGaEvent('language_change', {
          previous_language: previousLanguage,
          selected_language: selectedLanguage,
        });
      }
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
          trackGaEvent('select_content', {
            content_type: 'card',
            item_id: cardId,
            source: 'inline_card',
          });
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
      await ensureCardIndex();
      trackGaEvent('select_content', {
        content_type: 'tournament_deck',
        item_id: decklogId,
      });
      renderTournamentDeckModal(deckModalBody, decklogId, decklogDecks, cardIndexData);
      deckModal.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }

    const deckCard = e.target.closest('.deck-card');
    if (deckCard) {
      const deckId = deckCard.dataset.deckId;
      await Promise.all([ensureCardIndex(), ensureGuideDetail(deckId)]);
      trackGaEvent('select_content', {
        content_type: 'deck_guide',
        item_id: deckId,
      });
      renderDeckModal(deckModalBody, deckId, tierData, decksData, allGuides, officialDecks, cardIndexData);
      deckModal.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }

    const galleryCard = e.target.closest('.gallery-card');
    if (galleryCard) {
      const cardId = galleryCard.dataset.cardId;
      await ensureCards();
      const card = cardsData.find(c => c.id === cardId);
      trackGaEvent('select_content', {
        content_type: 'card',
        item_id: cardId,
        source: 'card_gallery',
      });
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

function setupOutboundTracking() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;

    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (url.origin === window.location.origin) return;

    trackGaEvent('click_outbound', {
      link_domain: url.hostname,
      link_url: url.href,
    });
  });
}

function setupIosInstallPrompt() {
  const prompt = document.getElementById('iosInstallPrompt');
  const laterBtn = document.getElementById('iosInstallLater');
  const dismissBtn = document.getElementById('iosInstallDismiss');
  if (!prompt || !laterBtn || !dismissBtn) return;

  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Edg/i.test(ua);
  const isIosSafari = isIos && isSafari;
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  let dismissedUntil = 0;
  try {
    dismissedUntil = Number(localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) || 0);
  } catch {}

  if (!isIosSafari || isStandalone || Date.now() < dismissedUntil) return;

  const hidePrompt = (days, action) => {
    prompt.classList.remove('is-visible');
    window.setTimeout(() => { prompt.hidden = true; }, 180);
    try {
      localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
    } catch {}
    trackGaEvent('pwa_install_prompt', { prompt_action: action });
  };

  window.setTimeout(() => {
    prompt.hidden = false;
    requestAnimationFrame(() => prompt.classList.add('is-visible'));
    trackGaEvent('pwa_install_prompt', { prompt_action: 'show' });
  }, 2500);

  laterBtn.addEventListener('click', () => hidePrompt(7, 'later'));
  dismissBtn.addEventListener('click', () => hidePrompt(30, 'dismiss'));
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
  setupOutboundTracking();
  setupIosInstallPrompt();
  applyFilterUI();
  await loadCoreData();
  updateNavCounts();
  render();
  trackGaPageView(currentView, { load: false });
}

init();
