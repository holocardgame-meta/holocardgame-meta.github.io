// Romaji / English aliases for oshi & member card names so Latin-script
// searches (e.g. "suisei", "pekora") match Japanese card names.
// Keys are exact card names from cards.json; aliasTextFor falls back to a
// substring scan so themed variants (e.g. 魔法少女〜) still resolve.

export const NAME_ALIASES = {
  'AIこより': 'ai koyori hakui',
  'AZKi': 'azki',
  'FUWAMOCO': 'fuwamoco fuwawa mococo abyssgard',
  'IRyS': 'irys',
  'SorAZ': 'soraz tokino sora azki',
  'miComet': 'micomet sakura miko hoshimachi suisei',
  'こぼ・かなえる': 'kobo kanaeru',
  'さくらみこ': 'sakura miko',
  'ときのそら': 'tokino sora',
  'アイラニ・イオフィフティーン': 'airani iofifteen iofi',
  'アキ・ローゼンタール': 'aki rosenthal',
  'アユンダ・リス': 'ayunda risu',
  'アーニャ・メルフィッサ': 'anya melfissa',
  'エリザベス・ローズ・ブラッドフレイム': 'elizabeth rose bloodflame erb',
  'オーロ・クロニー': 'ouro kronii',
  'カエラ・コヴァルスキア': 'kaela kovalskia',
  'クレイジー・オリー': 'kureiji ollie crazy ollie',
  'シオリ・ノヴェラ': 'shiori novella',
  'ジジ・ムリン': 'gigi murin',
  'セシリア・イマーグリーン': 'cecilia immergreen',
  'ネリッサ・レイヴンクロフト': 'nerissa ravencroft',
  'ハコス・ベールズ': 'hakos baelz bae',
  'パヴォリア・レイネ': 'pavolia reine',
  'フワワ・アビスガード': 'fuwawa abyssgard fuwamoco',
  'ベスティア・ゼータ': 'vestia zeta',
  'ムーナ・ホシノヴァ': 'moona hoshinova',
  'モココ・アビスガード': 'mococo abyssgard fuwamoco',
  'ラオーラ・パンテーラ': 'raora panthera',
  'ラプラス・ダークネス': 'laplus la+ darknesss darkness',
  'ラムダック': 'ramduck',
  'ロボ子さん': 'roboco robocosan',
  'ワトソン・アメリア': 'watson amelia ame',
  '一伊那尓栖': 'ninomae inanis ina',
  '一条莉々華': 'ichijou ririka',
  '七詩ムメイ': 'nanashi mumei moom',
  '不知火フレア': 'shiranui flare furea',
  '儒烏風亭らでん': 'juufuutei raden',
  '兎田ぺこら': 'usada pekora peko',
  '博衣こより': 'hakui koyori koyo',
  '古石ビジュー': 'koseki bijou',
  '夏色まつり': 'natsuiro matsuri',
  '大神ミオ': 'ookami mio',
  '大空スバル': 'oozora subaru',
  '天音かなた': 'amane kanata',
  '姫森ルーナ': 'himemori luna',
  '宝鐘マリン': 'houshou marine',
  '小鳥遊キアラ': 'takanashi kiara',
  '尾丸ポルカ': 'omaru polka',
  '常闇トワ': 'tokoyami towa',
  '戌神ころね': 'inugami korone',
  '星街すいせい': 'hoshimachi suisei',
  '桃鈴ねね': 'momosuzu nene',
  '森カリオペ': 'mori calliope calli',
  '水宮枢': 'mizumiya su',
  '沙花叉クロヱ': 'sakamata chloe',
  '火威青': 'hiodoshi ao',
  '猫又おかゆ': 'nekomata okayu',
  '獅白ぼたん': 'shishiro botan',
  '癒月ちょこ': 'yuzuki choco',
  '白上フブキ': 'shirakami fubuki',
  '白銀ノエル': 'shirogane noel',
  '百鬼あやめ': 'nakiri ayame',
  '紫咲シオン': 'murasaki shion',
  '綺々羅々ヴィヴィ': 'kikirara vivi',
  '虎金妃笑虎': 'koganei niko',
  '角巻わため': 'tsunomaki watame',
  '赤井はあと': 'akai haato haachama',
  '輪堂千速': 'rindo chihaya',
  '轟はじめ': 'todoroki hajime',
  '雪花ラミィ': 'yukihana lamy',
  '音乃瀬奏': 'otonose kanade',
  '響咲リオナ': 'isaki riona',
  '鷹嶺ルイ': 'takane lui',
};

const _cache = new Map();

export function aliasTextFor(name) {
  if (!name) return '';
  if (_cache.has(name)) return _cache.get(name);
  let alias = NAME_ALIASES[name] || '';
  if (!alias) {
    for (const [key, val] of Object.entries(NAME_ALIASES)) {
      if (name.includes(key)) { alias = val; break; }
    }
  }
  _cache.set(name, alias);
  return alias;
}
