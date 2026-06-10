const TEXT_PAYLOAD = '<svg/onload=alert(1)>';
const ATTR_PAYLOAD = 'x" onmouseover="alert(1)';
const BAD_URL = 'javascript:alert(1)';

function makeElement(id = '') {
  return {
    id,
    innerHTML: '',
    textContent: '',
    placeholder: '',
    value: '',
    hidden: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    click() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
  };
}

let elements;

function resetDom() {
  elements = new Map();
  globalThis.window = {
    __LCP_OPTS: [],
    location: { search: '' },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages: ['en'], language: 'en' },
    configurable: true,
  });
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  globalThis.document = {
    title: '',
    documentElement: makeElement('html'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function assertSanitized(label, html) {
  const forbidden = [
    TEXT_PAYLOAD,
    '<svg/onload',
    ' onmouseover="',
    BAD_URL,
  ];
  const found = forbidden.filter(token => html.includes(token));
  if (found.length) {
    throw new Error(`${label} leaked unsafe token(s): ${found.join(', ')}`);
  }
}

function emptyFilters() {
  return { colors: new Set(), tiers: new Set(), types: new Set(), search: '' };
}

resetDom();
const [
  { renderCardGallery },
  { renderRulesView },
  { renderGuidesView },
  { renderTournamentView },
] = await Promise.all([
  import('../web/components/card-view.js'),
  import('../web/components/rules-view.js'),
  import('../web/components/guides-view.js'),
  import('../web/components/tournament-view.js'),
]);

resetDom();
{
  const container = makeElement('cards');
  renderCardGallery(container, [{
    id: `card-${ATTR_PAYLOAD}`,
    name: TEXT_PAYLOAD,
    imageUrl: BAD_URL,
    type: TEXT_PAYLOAD,
    bloom: TEXT_PAYLOAD,
    color: '白',
  }], emptyFilters(), {});
  assertSanitized('card gallery', container.innerHTML);
}

resetDom();
{
  const cardId = `rule-${ATTR_PAYLOAD}`;
  const container = makeElement('rules');
  renderRulesView(container, {
    scraped_at: TEXT_PAYLOAD,
    restricted_cards: [cardId],
    errata: {
      [cardId]: { title: { en: TEXT_PAYLOAD }, date: TEXT_PAYLOAD },
    },
    articles: [{
      title: { en: TEXT_PAYLOAD },
      url: BAD_URL,
      date: TEXT_PAYLOAD,
      type: ATTR_PAYLOAD,
      card_ids: [ATTR_PAYLOAD],
    }],
  }, [{
    id: cardId,
    name: TEXT_PAYLOAD,
    imageUrl: BAD_URL,
  }]);
  assertSanitized('rules view', container.innerHTML);
}

resetDom();
{
  renderGuidesView(makeElement('guides'), [{
    deck_id: `guide-${ATTR_PAYLOAD}`,
    title: { en: TEXT_PAYLOAD, ja: TEXT_PAYLOAD },
    description: { en: TEXT_PAYLOAD },
    deck_image: BAD_URL,
    date: TEXT_PAYLOAD,
    cards: [],
    strategy: [],
  }], [], [], emptyFilters(), []);
  assertSanitized('guides view', document.getElementById('guidesGrid').innerHTML);
}

resetDom();
{
  const container = makeElement('tournament');
  const oshiCardId = `oshi-${ATTR_PAYLOAD}`;
  renderTournamentView(container, [{
    deck_id: `decklog-${ATTR_PAYLOAD}`,
    title: TEXT_PAYLOAD,
    oshi: TEXT_PAYLOAD,
    event: TEXT_PAYLOAD,
    event_date: '9999-01-01',
    placement: TEXT_PAYLOAD,
    oshi_cards: [{ card_id: oshiCardId, count: 1 }],
    main_deck: [],
    cheer_deck: [],
    main_deck_count: 0,
    cheer_deck_count: 0,
  }], [{
    id: oshiCardId,
    imageUrl: BAD_URL,
  }]);
  assertSanitized('tournament view', container.innerHTML);
}

console.log('render sanitization checks passed');
