// Game-phase (early/mid/late) parsing for official-deck strategy text.
//
// This is the FALLBACK path: decks scraped since the scraper started stamping
// `phase` on strategy chunks (scraper/scrape_official.py) don't need it — the
// stamped field survives translation untouched and is authoritative. For older
// data the phase has to be recovered from translated free text, which is what
// this module does.
//
// A phase heading only counts at a *segment start* — the start of the text or
// right after a newline / sentence-ending punctuation. That kills the two
// historical failure modes: substrings inside words or card names creating
// boundaries ("Fri-end-ly PC" → "end", "accumu-late" → "late", Spanish
// "holomen Debut" → "en début"), and mid-sentence mentions stealing the
// boundary from the real heading (「…、終盤に備えましょう。終盤は…」).
//
// Vocabulary covers all five display languages; the wordings are the ones the
// translation pipeline actually produces (surveyed from web/data 2026-07).

const CJK_LEAD = '(?:在)?(?:遊戲|游戏|ゲーム|對局|对局)?';

const PHASE_HEADS = {
  early: new RegExp(
    '^(?:'
    + CJK_LEAD + '(?:序盤|序章|前期|早期|早盤|初盤|初期|開局)'
    + '|(?:in|during|at)\\s+(?:the\\s+)?early(?:[-\\s]?game|\\s+stages?|\\s+turns?)?\\b'
    + '|early[-\\s]?game|early\\s+on\\b'
    + '|(?:en|au)\\s+d[ée]but\\b'
    + '|al\\s+principio\\b|al\\s+inicio\\b|al\\s+comienzo\\b'
    + '|(?:durante|en)\\s+el\\s+juego\\s+temprano'
    + '|(?:en|durante)\\s+la\\s+fase\\s+(?:inicial|temprana)'
    + ')', 'i'),
  mid: new RegExp(
    '^(?:'
    + CJK_LEAD + '(?:中盤|中期戦|中期)'
    + '|(?:in|during|at)\\s+(?:the\\s+)?mid(?:dle)?(?:[-\\s]?game|\\s+stages?|\\s+turns?)?\\b'
    + '|mid[-\\s]?game'
    + '|(?:en|au)\\s+milieu\\b'
    + '|a\\s+(?:la\\s+)?mitad\\b|en\\s+la\\s+mitad\\b|a\\s+mediados\\b'
    + '|(?:en|durante)\\s+el\\s+juego\\s+medio'
    + '|(?:en|durante)\\s+la\\s+fase\\s+media\\b'
    + ')', 'i'),
  late: new RegExp(
    '^(?:'
    + CJK_LEAD + '(?:終盤|終章|後期|後半|末期|終局)'
    + '|(?:in|during|at|towards?)\\s+(?:the\\s+)?late(?:r)?(?:[-\\s]?game|\\s+stages?|\\s+turns?)?\\b'
    + '|late[-\\s]?game|end[-\\s]?game|endgame\\b'
    + '|(?:in|at|towards?)\\s+(?:the\\s+)?end\\s+of\\s+the\\s+game'
    + '|(?:en|à\\s+la|vers\\s+la|pendant\\s+la)\\s+fin\\b'
    + '|al\\s+final\\b|hacia\\s+el\\s+final\\b'
    + '|(?:en|durante)\\s+el\\s+juego\\s+tard[íi]o'
    + '|(?:en|durante)\\s+la\\s+fase\\s+final\\b'
    + ')', 'i'),
};

// Sentence enders, optionally followed by closing quotes/brackets (`!!". In
// the late game…`), repeated to cover interleavings like `!!".` — closers
// alone never start a segment, so opening quotes can't create boundaries.
const SEGMENT_BREAK = /(?:(?:[。．.!?！？:：]|\n)+[”"」』)）\]]*)+\s*/g;
// Longest vocabulary entry is ~26 chars; 48 gives headroom without scanning
// whole paragraphs.
const HEAD_WINDOW = 48;

function* segmentStarts(text) {
  yield 0;
  SEGMENT_BREAK.lastIndex = 0;
  let m;
  while ((m = SEGMENT_BREAK.exec(text))) {
    const pos = m.index + m[0].length;
    if (pos < text.length) yield pos;
  }
}

/**
 * Split strategy text into phase sections.
 * Returns [{ phase: 'pre'|'early'|'mid'|'late'|'all', label, text }] — same
 * contract the deck view renders: 'all' when no headings were found, 'pre'
 * for text before the first heading. `label` is the matched heading (kept for
 * diagnostics; the UI renders i18n badges instead).
 */
export function parsePhases(text) {
  if (!text) return [];
  const boundaries = [];
  const seen = new Set();
  for (const start of segmentStarts(text)) {
    if (seen.size === 3) break;
    const head = text.slice(start, start + HEAD_WINDOW);
    for (const [phase, re] of Object.entries(PHASE_HEADS)) {
      if (seen.has(phase)) continue;
      const m = re.exec(head);
      if (m) {
        seen.add(phase);
        boundaries.push({ phase, label: m[0], start });
        break;
      }
    }
  }
  if (!boundaries.length) return [{ phase: 'all', label: '', text: text.trim() }];

  const phases = [];
  if (boundaries[0].start > 0) {
    const pre = text.slice(0, boundaries[0].start).trim();
    if (pre) phases.push({ phase: 'pre', label: '', text: pre });
  }
  for (let i = 0; i < boundaries.length; i++) {
    const end = i < boundaries.length - 1 ? boundaries[i + 1].start : text.length;
    const chunk = text.slice(boundaries[i].start, end).trim();
    if (chunk) phases.push({ phase: boundaries[i].phase, label: boundaries[i].label, text: chunk });
  }
  return phases;
}
