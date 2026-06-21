"""Translate scraped data using Gemini 2.5 Flash-Lite with hOCG terminology."""

import json
import os
import re
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GEMINI_MODEL = "gemini-2.5-flash-lite"
# Escalation ladder for items the cheap model echoes back untranslated (the
# ja->zh-TW shared-Han-script failure mode). Each tier only retries what the
# previous one couldn't finish, so the bulk stays on the cheap model.
STRONG_MODEL = "gemini-2.5-flash"
STRONGEST_MODEL = "gemini-2.5-pro"
ESCALATION_MODELS = [STRONG_MODEL, STRONGEST_MODEL]
BATCH_SIZE = 80
REQUEST_DELAY = 5.0
MAX_RETRIES = 8

TARGET_LANGS_JA = ["zh-TW", "en", "fr", "es"]
TARGET_LANGS_ZH = ["ja", "en", "fr", "es"]
TARGET_LANGS_EN = ["ja", "zh-TW", "fr", "es"]

LANG_NAMES = {
    "ja": "Japanese",
    "zh-TW": "Traditional Chinese (Taiwan)",
    "en": "English",
    "fr": "French",
    "es": "Spanish",
}

HOCG_GLOSSARY = """\
hololive OFFICIAL CARD GAME (ホロカ / hOCG) official terminology:

| Japanese | 繁體中文 | English | French | Spanish |
|---|---|---|---|---|
| ホロカ | hOCG | hOCG | hOCG | hOCG |
| エール | 吶喊 | Cheer | Encouragement | Cheer |
| エールデッキ | 吶喊牌組 | Cheer Deck | Deck d'encouragement | Mazo Cheer |
| ブルーム | 綻放 | Bloom | Bloom | Bloom |
| アーツ | 藝能 | Arts | Arts | Arts |
| ホロメン / メンバー | 成員 | Holomen / Member | Membre | Holomen / Miembro |
| コラボ | 聯動 | Collab | Collab | Collab |
| ダウン | 擊倒 | Down | K.O. | K.O. |
| 推し / 推しホロメン | 推 / 主推 | Oshi | Oshi | Oshi |
| 推しスキル | 推技能 | Oshi Skill | Compétence Oshi | Habilidad Oshi |
| SPスキル | SP技能 | SP Skill | Compétence SP | Habilidad SP |
| ホロパワー | Holo Power | Holo Power | Holo Power | Holo Power |
| デッキ | 牌組 | Deck | Deck | Mazo |
| 手札 | 手牌 | Hand | Main | Mano |
| アーカイブ | 存檔區 | Archive | Archive | Archivo |
| サポート | 支援卡 | Support | Support | Soporte |
| ステージ | 舞台 | Stage | Scène | Escenario |
| センター | 中心 | Center | Centre | Centro |
| バック | 後方 | Back | Arrière | Retaguardia |
| ライフ | 生命值 | Life | Points de vie | Vida |
| デッキレシピ | 牌組配置 | Deck Recipe | Recette de deck | Receta de mazo |
| 回し方 | 打法 | How to play | Comment jouer | Cómo jugar |
| 単 (デッキ) | 單色 | Mono | Mono | Mono |
| ギフト | 天賦 | Gift | Don | Don |
| Debut / 1st / 2nd | Debut / 1st / 2nd | Debut / 1st / 2nd | Debut / 1st / 2nd | Debut / 1st / 2nd |
| Buzz | Buzz | Buzz | Buzz | Buzz |
| Spot | Spot | Spot | Spot | Spot |
| LIMITED | LIMITED | LIMITED | LIMITED | LIMITED |
| マスコット | 吉祥物 | Mascot | Mascotte | Mascota |
| ファン | 粉絲 | Fan | Fan | Fan |
| 先攻 / 後攻 | 先攻 / 後攻 | Going first / Going second | Premier / Second | Primero / Segundo |
| ターン目 | 回合 | Turn | Tour | Turno |
| 火力 | 火力 | Firepower | Puissance de feu | Potencia |
| 素点 / 素ダメ | 基礎傷害 | Base damage | Dégâts de base | Daño base |
| エール加速 | 吶喊加速 | Cheer acceleration | Accélération d'encouragement | Aceleración de Cheer |
"""

SYSTEM_PROMPT_TEMPLATE = """\
You are a professional translator for the hololive OFFICIAL CARD GAME (ホロカ / hOCG).

RULES:
1. Translate from {source_lang} to {target_lang}.
2. You MUST use the official card game terminology from the glossary below. Never use literal translations for game terms.
3. Keep VTuber names in their original form (e.g. 大神ミオ, 兎田ぺこら, Amelia Watson).
4. Keep card IDs (e.g. hBP07-003) unchanged.
5. Keep numbers, symbols, and formatting (like ・, └, ＋, ＋20) unchanged.
6. Preserve line breaks (\\n) exactly as in the original.
7. Return ONLY a JSON array of translated strings, no other text.
8. Translate EVERY word into {target_lang}. The output must contain NO leftover Japanese hiragana or katakana, except proper names kept per rule 3. Japanese and Chinese share kanji — never pass Japanese text through untranslated just because it looks similar.

{glossary}
"""

_cache: dict[str, str] = {}
_cache_path: Path | None = None
_cache_dirty = False
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is not None:
        return _client
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set. "
            "Get a free key at https://aistudio.google.com/apikey"
        )
    _client = genai.Client(api_key=api_key)
    return _client


# Kana, CJK ideographs, and halfwidth katakana — "is this string actually
# Japanese/Chinese prose" for the poison heuristic below.
_CJK_RE = re.compile(r"[぀-ヿ㐀-鿿ｦ-ﾟ]")

# Japanese grammar markers (particles, verb/aux endings, connectors). Chinese,
# English, etc. never use these, and VTuber names kept in kana (すいせい, ぺこら)
# carry none — so counting them separates "Japanese prose left untranslated"
# from "a correct translation that keeps a name in kana". The ja->zh-TW pair is
# the main offender: the shared Han script lets the model pass Japanese through.
# The possessive の counts as grammar only after a noun (kanji/katakana/latin).
# Inside a kana name (とき->の<-そら) it sits between hiragana, so a negative
# lookbehind keeps a kept VTuber name from reading as a Japanese sentence.
_JA_GRAMMAR_RE = re.compile(
    r"を|(?<![ぁ-ゟ])の|する|した|して|され|でき|です|ます|ない|れる|られる"
    r"|ので|から|けど|たり|ながら|など|という|ように|まで|より|だっ|でも"
)
# VTuber / card names are kept in their original kana inside corner brackets and
# can carry a stray grammar char (「ふつうのパソコン」). Strip quoted spans first so
# a name's の doesn't read as a Japanese sentence.
_JA_QUOTE_RE = re.compile(r"[「『][^」』]*[」』]")


def _looks_untranslated(text: object, target: str) -> bool:
    """True when a non-Japanese target value still reads as Japanese prose.

    Used both to reject fresh under-translations before caching and to evict
    sticky ones already in the cache. After dropping quoted names, even one
    grammar marker means Japanese: correct Chinese/English output has none,
    while short Japanese titles ("...のデッキレシピと回し方") have at least one.
    """
    if target == "ja" or not isinstance(text, str):
        return False
    outside_names = _JA_QUOTE_RE.sub("", text)
    return len(_JA_GRAMMAR_RE.findall(outside_names)) >= 1


def _is_poisoned_entry(key: str, value) -> bool:
    """True when a cache entry should be evicted and retranslated, covering two
    failure modes:

    1. Give-up fallback cached by older code: the "translation" is the verbatim
       source text of a CJK-heavy, non-trivial string. Short tokens (card IDs,
       'AZKi') legitimately survive translation unchanged, so only strings over
       20 chars with substantial CJK count.
    2. Under-translation: a non-ja target whose value still reads as Japanese
       prose. It differs from the source (so the exact-match check below misses
       it) yet shows Japanese in the UI — the ja->zh-TW shared-script failure.
    """
    if not isinstance(value, str):
        return True
    parts = key.split("|", 3)
    if len(parts) != 4:
        return False
    target, text = parts[2], parts[3]
    if _looks_untranslated(value, target):
        return True
    if value != text or len(text) <= 20:
        return False
    return len(_CJK_RE.findall(text)) >= 8


def _load_cache(base_dir: Path):
    global _cache, _cache_path, _cache_dirty
    _cache_path = base_dir / "translation_cache.json"
    if _cache_path.exists():
        _cache = json.loads(_cache_path.read_text(encoding="utf-8"))
        # Evict poison on every load (not just once): the deploy workflow
        # reseeds the cache from git history on a cold Actions cache, so old
        # poisoned copies can resurface at any time.
        poisoned = [k for k, v in _cache.items() if _is_poisoned_entry(k, v)]
        for k in poisoned:
            del _cache[k]
        if poisoned:
            _cache_dirty = True
            print(f"[cache] Evicted {len(poisoned)} untranslated give-up entries; this run retranslates them")
        print(f"[cache] Loaded {len(_cache)} cached translations")
    else:
        _cache = {}
        print("[cache] No cache file found, starting fresh")


def _save_cache():
    if _cache_path and _cache_dirty:
        _cache_path.write_text(json.dumps(_cache, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[cache] Saved {len(_cache)} translations to cache")


def _cache_key(source: str, target: str, text: str) -> str:
    return f"gemini|{source}|{target}|{text}"


def _build_system_prompt(source: str, target: str) -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(
        source_lang=LANG_NAMES.get(source, source),
        target_lang=LANG_NAMES.get(target, target),
        glossary=HOCG_GLOSSARY,
    )


def _unwrap_result(item, target: str) -> str:
    """Extract plain text from LLM results that may be dicts instead of strings."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in ["text", target, "en", "translation", "translated"]:
            if key in item and isinstance(item[key], str):
                return item[key]
        vals = [v for v in item.values() if isinstance(v, str)]
        if vals:
            return vals[-1]
    return str(item)


def _translate_batch_gemini(
    texts: list[str], source: str, target: str, _no_split: bool = False, model: str | None = None
) -> list[str | None]:
    """Translate a batch of texts using a single Gemini API call.

    On persistent batch-size mismatch we split the batch in half rather than
    positionally padding — padding shifts all items after the gap by one and
    silently corrupts translations (e.g. card[N] gets card[N+1]'s text and
    the last card gets its source-language text as a fallback).

    `_no_split` is set when called recursively with a single item to avoid
    unbounded recursion. Items that still fail after that come back as None —
    callers fall back to source text themselves and must NOT cache the
    failure, so the next run retries instead of serving untranslated text
    forever.
    """
    client = _get_client()
    system_prompt = _build_system_prompt(source, target)
    model_id = model or GEMINI_MODEL

    numbered = "\n".join(f"[{i+1}] {t}" for i, t in enumerate(texts))
    user_prompt = f"Translate these {len(texts)} items:\n\n{numbered}"

    mismatch_retries = 0
    for attempt in range(MAX_RETRIES):
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            raw = (response.text or "").strip()
            results = json.loads(raw)
            if isinstance(results, list) and len(results) == len(texts):
                return [_unwrap_result(r, target) for r in results]
            got = len(results) if isinstance(results, list) else 0
            print(f"    [warn] Batch size mismatch: expected {len(texts)}, got {got}")
            mismatch_retries += 1
            if mismatch_retries >= 3:
                break  # exit retry loop, fall through to split/give-up
            time.sleep(2)
            continue
        except json.JSONDecodeError:
            print(f"    [warn] JSON parse failed (attempt {attempt + 1})")
        except Exception as e:
            err_str = str(e)
            print(f"    [warn] API error (attempt {attempt + 1}): {err_str[:200]}")
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                m = re.search(r"retry in (\d+(?:\.\d+)?)s", err_str, re.IGNORECASE)
                wait = float(m.group(1)) + 5 if m else 60.0
                print(f"    [rate-limit] Waiting {wait:.0f}s before retry...")
                time.sleep(wait)
                continue

        wait = min(REQUEST_DELAY * (2 ** attempt), 30)
        time.sleep(wait)

    # Recovery path: try splitting to find which sub-batch is causing the misalignment.
    if not _no_split and len(texts) > 1:
        mid = len(texts) // 2
        print(f"    [split] Recovering by splitting batch {len(texts)} -> {mid} + {len(texts) - mid}")
        left = _translate_batch_gemini(texts[:mid], source, target, _no_split=(mid == 1), model=model)
        right = _translate_batch_gemini(
            texts[mid:], source, target, _no_split=(len(texts) - mid == 1), model=model
        )
        return left + right

    # Single-item or already-split path: give up, signal failure per item.
    print(f"    [fail] Giving up on {len(texts)} items; leaving them untranslated")
    return [None] * len(texts)


def _translate_unique_map(unique_texts: list[str], source: str, target: str) -> dict[str, str]:
    global _cache_dirty
    mapping: dict[str, str] = {}
    to_translate: list[str] = []

    for text in unique_texts:
        if not text or not text.strip():
            mapping[text] = text
            continue
        key = _cache_key(source, target, text)
        if key in _cache:
            mapping[text] = _cache[key]
        else:
            to_translate.append(text)

    cached = len(unique_texts) - len(to_translate)
    print(f"    {source}->{target}: {cached} cached, {len(to_translate)} new")

    if not to_translate:
        return mapping

    failed_items: list[str] = []
    for batch_start in range(0, len(to_translate), BATCH_SIZE):
        batch = to_translate[batch_start:batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(to_translate) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"    {source}->{target}: batch {batch_num}/{total_batches} ({len(batch)} strings)")

        results = _translate_batch_gemini(batch, source, target)

        batch_failed = 0
        for text, result in zip(batch, results):
            # A give-up (None) or still-Japanese result is deferred to the
            # escalation pass below rather than cached as-is.
            if result is None or _looks_untranslated(result, target):
                failed_items.append(text)
                batch_failed += 1
                continue
            mapping[text] = result
            _cache[_cache_key(source, target, text)] = result
            _cache_dirty = True
        if batch_failed:
            print(f"    [warn] {batch_failed} items not translated by {GEMINI_MODEL}; will escalate")

        if batch_start + BATCH_SIZE < len(to_translate):
            time.sleep(REQUEST_DELAY)

    # Escalation ladder: the cheap model echoes hard ja->zh-TW strings back
    # untranslated (shared Han script). Retry rejects on progressively stronger
    # models, carrying only what each tier still can't finish to the next. Cache
    # what passes; leave any remainder uncached to retry next run — never cache
    # an under-translation, which is what made them sticky in the first place.
    remaining = failed_items
    for esc_model in ESCALATION_MODELS:
        if not remaining:
            break
        print(f"    {source}->{target}: escalating {len(remaining)} items to {esc_model}")
        next_remaining: list[str] = []
        for esc_start in range(0, len(remaining), BATCH_SIZE):
            esc_batch = remaining[esc_start:esc_start + BATCH_SIZE]
            results = _translate_batch_gemini(esc_batch, source, target, model=esc_model)
            for text, result in zip(esc_batch, results):
                if result is None or _looks_untranslated(result, target):
                    next_remaining.append(text)
                    continue
                mapping[text] = result
                _cache[_cache_key(source, target, text)] = result
                _cache_dirty = True
            if esc_start + BATCH_SIZE < len(remaining):
                time.sleep(REQUEST_DELAY)
        remaining = next_remaining

    for text in remaining:
        mapping[text] = text  # still untranslated at the top tier -> source, uncached
    if remaining:
        print(f"    [warn] {len(remaining)} items still untranslated after escalation; next run retries")

    return mapping


def _make_multilang_from_maps(original: str, source_key: str, lang_maps: dict[str, dict[str, str]]) -> dict:
    out = {source_key: original}
    for lang, mapping in lang_maps.items():
        out[lang] = mapping.get(original, original)
    return out


def _make_multilang_list_from_maps(original: list[str], source_key: str, lang_maps: dict[str, dict[str, str]]) -> dict:
    out = {source_key: original}
    for lang, mapping in lang_maps.items():
        out[lang] = [mapping.get(t, t) for t in original]
    return out


def translate_tier_list(data_dir: Path):
    tier_path = data_dir / "tier_list.json"
    if not tier_path.exists():
        print("[translate] tier_list.json not found, skipping")
        return

    tier_data = json.loads(tier_path.read_text(encoding="utf-8"))

    unique_texts = set()
    for tier in tier_data.get("tiers", []):
        for deck in tier.get("decks", []):
            if isinstance(deck.get("features"), list):
                unique_texts.update(t for t in deck["features"] if t and t.strip())
            if isinstance(deck.get("description"), str) and deck["description"].strip():
                unique_texts.add(deck["description"])

    unique_list = sorted(unique_texts)
    print(f"  Tier list: {len(unique_list)} unique strings")

    lang_maps = {}
    for lang in TARGET_LANGS_JA:
        lang_maps[lang] = _translate_unique_map(unique_list, "ja", lang)

    for tier in tier_data.get("tiers", []):
        for deck in tier.get("decks", []):
            if isinstance(deck.get("features"), list) and deck["features"]:
                deck["features"] = _make_multilang_list_from_maps(deck["features"], "ja", lang_maps)
            if isinstance(deck.get("description"), str) and deck["description"].strip():
                deck["description"] = _make_multilang_from_maps(deck["description"], "ja", lang_maps)

    tier_path.write_text(json.dumps(tier_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[translate] tier_list.json done")


def translate_decks(data_dir: Path):
    decks_path = data_dir / "decks.json"
    if not decks_path.exists():
        print("[translate] decks.json not found, skipping")
        return

    decks = json.loads(decks_path.read_text(encoding="utf-8"))

    unique_texts = set()
    for deck in decks:
        if isinstance(deck.get("title"), str) and deck["title"].strip():
            unique_texts.add(deck["title"])
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            unique_texts.add(deck["description"])
        for card in deck.get("cards", []):
            if isinstance(card.get("role"), str) and card["role"].strip():
                unique_texts.add(card["role"])
        for step in deck.get("strategy", []):
            if isinstance(step.get("title"), str) and step["title"].strip():
                unique_texts.add(step["title"])
            if isinstance(step.get("text"), str) and step["text"].strip():
                unique_texts.add(step["text"])

    unique_list = sorted(unique_texts)
    print(f"  Decks: {len(unique_list)} unique strings")

    lang_maps = {}
    for lang in TARGET_LANGS_JA:
        lang_maps[lang] = _translate_unique_map(unique_list, "ja", lang)

    for deck in decks:
        if isinstance(deck.get("title"), str) and deck["title"].strip():
            deck["title"] = _make_multilang_from_maps(deck["title"], "ja", lang_maps)
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            deck["description"] = _make_multilang_from_maps(deck["description"], "ja", lang_maps)
        for card in deck.get("cards", []):
            if isinstance(card.get("role"), str) and card["role"].strip():
                card["role"] = _make_multilang_from_maps(card["role"], "ja", lang_maps)
        for step in deck.get("strategy", []):
            if isinstance(step.get("title"), str) and step["title"].strip():
                step["title"] = _make_multilang_from_maps(step["title"], "ja", lang_maps)
            if isinstance(step.get("text"), str) and step["text"].strip():
                step["text"] = _make_multilang_from_maps(step["text"], "ja", lang_maps)

    decks_path.write_text(json.dumps(decks, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[translate] decks.json done")


def translate_cards(data_dir: Path):
    cards_path = data_dir / "cards.json"
    if not cards_path.exists():
        print("[translate] cards.json not found, skipping")
        return

    cards = json.loads(cards_path.read_text(encoding="utf-8"))

    SKILL_KEYS = ["oshiSkill", "spSkill", "effectC", "effectB", "effectG", "art1", "art2"]
    unique_texts = set()
    for c in cards:
        for sk in SKILL_KEYS:
            obj = c.get(sk)
            if obj and isinstance(obj, dict):
                if obj.get("effect") and isinstance(obj["effect"], str):
                    unique_texts.add(obj["effect"])
        if isinstance(c.get("supportEffect"), str) and c["supportEffect"].strip():
            unique_texts.add(c["supportEffect"])
        if isinstance(c.get("yellEffect"), str) and c["yellEffect"].strip():
            unique_texts.add(c["yellEffect"])
        if isinstance(c.get("extra"), str) and c["extra"].strip():
            unique_texts.add(c["extra"])

    unique_list = sorted(unique_texts)
    print(f"  Cards: {len(unique_list)} unique effect strings")

    lang_maps = {}
    for lang in TARGET_LANGS_ZH:
        lang_maps[lang] = _translate_unique_map(unique_list, "zh-TW", lang)

    for c in cards:
        for sk in SKILL_KEYS:
            obj = c.get(sk)
            if obj and isinstance(obj, dict) and isinstance(obj.get("effect"), str) and obj["effect"].strip():
                obj["effect"] = _make_multilang_from_maps(obj["effect"], "zh-TW", lang_maps)
        if isinstance(c.get("supportEffect"), str) and c["supportEffect"].strip():
            c["supportEffect"] = _make_multilang_from_maps(c["supportEffect"], "zh-TW", lang_maps)
        if isinstance(c.get("yellEffect"), str) and c["yellEffect"].strip():
            c["yellEffect"] = _make_multilang_from_maps(c["yellEffect"], "zh-TW", lang_maps)
        if isinstance(c.get("extra"), str) and c["extra"].strip():
            c["extra"] = _make_multilang_from_maps(c["extra"], "zh-TW", lang_maps)

    cards_path.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[translate] cards.json done ({len(unique_list)} unique strings)")


def translate_guides(data_dir: Path):
    guides_path = data_dir / "all_guides.json"
    if not guides_path.exists():
        print("[translate] all_guides.json not found, skipping")
        return

    guides = json.loads(guides_path.read_text(encoding="utf-8"))

    unique_texts = set()
    for deck in guides:
        if isinstance(deck.get("title"), str) and deck["title"].strip():
            unique_texts.add(deck["title"])
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            unique_texts.add(deck["description"])
        for card in deck.get("cards", []):
            if isinstance(card.get("role"), str) and card["role"].strip():
                unique_texts.add(card["role"])
        for step in deck.get("strategy", []):
            if isinstance(step.get("title"), str) and step["title"].strip():
                unique_texts.add(step["title"])
            if isinstance(step.get("text"), str) and step["text"].strip():
                unique_texts.add(step["text"])

    unique_list = sorted(unique_texts)
    print(f"  Guides: {len(unique_list)} unique strings")

    lang_maps = {}
    for lang in TARGET_LANGS_JA:
        lang_maps[lang] = _translate_unique_map(unique_list, "ja", lang)

    for deck in guides:
        if isinstance(deck.get("title"), str) and deck["title"].strip():
            deck["title"] = _make_multilang_from_maps(deck["title"], "ja", lang_maps)
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            deck["description"] = _make_multilang_from_maps(deck["description"], "ja", lang_maps)
        for card in deck.get("cards", []):
            if isinstance(card.get("role"), str) and card["role"].strip():
                card["role"] = _make_multilang_from_maps(card["role"], "ja", lang_maps)
        for step in deck.get("strategy", []):
            if isinstance(step.get("title"), str) and step["title"].strip():
                step["title"] = _make_multilang_from_maps(step["title"], "ja", lang_maps)
            if isinstance(step.get("text"), str) and step["text"].strip():
                step["text"] = _make_multilang_from_maps(step["text"], "ja", lang_maps)

    guides_path.write_text(json.dumps(guides, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[translate] all_guides.json done")


def translate_official(data_dir: Path):
    official_path = data_dir / "official_decks.json"
    if not official_path.exists():
        print("[translate] official_decks.json not found, skipping")
        return

    decks = json.loads(official_path.read_text(encoding="utf-8"))

    unique_texts = set()
    for deck in decks:
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            unique_texts.add(deck["description"])
        for s in deck.get("strategy", []):
            if isinstance(s.get("text"), str) and s["text"].strip():
                unique_texts.add(s["text"])
        for k in deck.get("key_cards", []):
            if isinstance(k.get("text"), str) and k["text"].strip():
                unique_texts.add(k["text"])

    unique_list = sorted(unique_texts)
    print(f"  Official decks: {len(unique_list)} unique strings")

    lang_maps = {}
    for lang in TARGET_LANGS_EN:
        lang_maps[lang] = _translate_unique_map(unique_list, "en", lang)

    for deck in decks:
        if isinstance(deck.get("description"), str) and deck["description"].strip():
            deck["description"] = _make_multilang_from_maps(deck["description"], "en", lang_maps)
        for s in deck.get("strategy", []):
            if isinstance(s.get("text"), str) and s["text"].strip():
                s["text"] = _make_multilang_from_maps(s["text"], "en", lang_maps)
        for k in deck.get("key_cards", []):
            if isinstance(k.get("text"), str) and k["text"].strip():
                k["text"] = _make_multilang_from_maps(k["text"], "en", lang_maps)

    official_path.write_text(json.dumps(decks, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[translate] official_decks.json done")


def translate_rules(data_dir: Path):
    rules_path = data_dir / "rules.json"
    if not rules_path.exists():
        print("[translate] rules.json not found, skipping")
        return

    rules = json.loads(rules_path.read_text(encoding="utf-8"))

    unique_texts = set()
    for art in rules.get("articles", []):
        if isinstance(art.get("title"), str) and art["title"].strip():
            unique_texts.add(art["title"])

    for cid, info in rules.get("errata", {}).items():
        if isinstance(info.get("title"), str) and info["title"].strip():
            unique_texts.add(info["title"])

    unique_list = sorted(unique_texts)
    print(f"  Rules: {len(unique_list)} unique strings")

    lang_maps = {}
    for lang in TARGET_LANGS_JA:
        lang_maps[lang] = _translate_unique_map(unique_list, "ja", lang)

    for art in rules.get("articles", []):
        if isinstance(art.get("title"), str) and art["title"].strip():
            art["title"] = _make_multilang_from_maps(art["title"], "ja", lang_maps)

    for cid, info in rules.get("errata", {}).items():
        if isinstance(info.get("title"), str) and info["title"].strip():
            info["title"] = _make_multilang_from_maps(info["title"], "ja", lang_maps)

    rules_path.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[translate] rules.json done")


def translate_all(data_dir: Path):
    base_dir = data_dir.parent
    _load_cache(base_dir)

    print("[translate] Translating tier_list.json...")
    translate_tier_list(data_dir)
    _save_cache()
    print("[translate] Translating decks.json...")
    translate_decks(data_dir)
    _save_cache()
    print("[translate] Translating all_guides.json...")
    translate_guides(data_dir)
    _save_cache()
    print("[translate] Translating official_decks.json...")
    translate_official(data_dir)
    _save_cache()
    print("[translate] Translating cards.json...")
    translate_cards(data_dir)
    _save_cache()
    print("[translate] Translating rules.json...")
    translate_rules(data_dir)

    _save_cache()
    print("[translate] All translations complete")


if __name__ == "__main__":
    translate_all(Path(__file__).resolve().parent.parent / "data")
