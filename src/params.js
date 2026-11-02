// パラメータの定義（UI はここから自動で組み立てる）と、ランダム生成。

export const PALETTE = [
  ['木地', '#cfa77a'], ['朱', '#c4553a'], ['藍', '#2f5f86'], ['黄土', '#d9a93a'],
  ['松葉', '#4d7a58'], ['生成り', '#ebe4d6'], ['墨', '#3b3936'], ['藤', '#9c7fb0'],
];

const FACED = ['loop', 'prism', 'pyramid', 'bipyramid'];

export const SCHEMA = [
  { group: '骨格' },
  { key: 'base', label: '骨格の型', type: 'select', def: 'prism', options: [
    ['blob', '点（塊）'], ['line', '線'], ['arc', '弧'], ['helix', '螺旋'], ['loop', '輪・多角形'],
    ['prism', '角柱・円柱'], ['pyramid', '角錐'], ['bipyramid', '双角錐'], ['star', '放射'],
  ] },
  { key: 'sides', label: '辺・腕の数', min: 3, max: 8, step: 1, def: 4, show: (P) => !['line', 'arc', 'helix'].includes(P.base) },
  { key: 'count', label: '点の数', min: 1, max: 4, step: 1, def: 1, show: (P) => P.base === 'blob' },
  { key: 'bulge', label: '辺のふくらみ', min: -0.8, max: 1, step: 0.01, def: 0, show: (P) => FACED.includes(P.base) },
  { key: 'arc', label: '弧の角度・巻き数', min: 60, max: 330, step: 1, def: 200, show: (P) => ['arc', 'helix'].includes(P.base) },
  { key: 'size', label: '大きさ', min: 0.5, max: 1.2, step: 0.01, def: 0.9 },
  { key: 'height', label: '高さ', min: 0.1, max: 1.6, step: 0.01, def: 0.8 },
  // 奥行きの比：手前・奥の向き（z）だけを縮める。1 でそのまま、小さいほど平たい楕円・長方形になる（肉の太さは変わらない）
  { key: 'depth', label: '奥行きの比', min: 0.3, max: 1, step: 0.01, def: 1 },

  { group: '肉' },
  { key: 'radius', label: '肉の太さ', min: 0.02, max: 0.3, step: 0.005, def: 0.07 },
  { key: 'profile', label: '断面（丸 → 角）', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'taper', label: '中太 ↔ 節太', min: -1, max: 1, step: 0.01, def: 0 },
  { key: 'fillet', label: '継ぎ目の丸み', min: 0, max: 2, step: 0.01, def: 0.8 },
  { key: 'membrane', label: '膜を張る割合', min: 0, max: 1, step: 0.01, def: 0, show: (P) => FACED.includes(P.base) },
  // 膜を張る面：0 は割合に従って乱数で選ぶ。1〜3 は、割合によらず決まった面に張る（上が開いた箱、筒など）
  { key: 'membraneFaces', label: '膜を張る面', type: 'select', def: 0, num: true, options: [[0, '乱数'], [1, '側面だけ'], [2, '上を開ける'], [3, '上下だけ']], show: (P) => FACED.includes(P.base) && P.membrane > 0 },
  { key: 'membraneTh', label: '膜の厚み', min: 0.2, max: 1, step: 0.01, def: 0.5, show: (P) => FACED.includes(P.base) && P.membrane > 0 },
  { key: 'hole', label: '縦の穴', min: 0, max: 0.6, step: 0.01, def: 0 },
  // 穴の深さ：上から測った深さの割合。1 で貫通、小さいほど浅いくぼみ（底が残る）
  { key: 'holeDepth', label: '穴の深さ', min: 0.1, max: 1, step: 0.01, def: 1, show: (P) => P.hole > 0 },

  { group: 'ネットワーク' },
  { key: 'lattice', label: '格子の段階', min: 0, max: 3, step: 1, def: 0 },
  { key: 'grid', label: '格子の密度', min: 1, max: 4, step: 1, def: 1, show: (P) => P.lattice > 0 },
  { key: 'struts', label: '突起の割合', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'strutLen', label: '突起の長さ', min: 0.05, max: 0.6, step: 0.01, def: 0.25, show: (P) => P.struts > 0 },
  { key: 'knob', label: '先端の玉', min: 0, max: 2.5, step: 0.05, def: 0, show: (P) => P.struts > 0 },
  { key: 'drop', label: '間引き', min: 0, max: 0.7, step: 0.01, def: 0 },

  { group: '対称性' },
  { key: 'sym', label: '対称', type: 'select', def: 4, num: true, options: [
    [0, 'なし'], [1, '左右'], [2, '2回'], [3, '3回'], [4, '4回'], [5, '5回'], [6, '6回'], [7, '7回'], [8, '8回'],
  ] },

  { group: 'ノイズ' },
  { key: 'bend', label: '骨格のゆがみ', min: 0, max: 0.3, step: 0.005, def: 0 },
  { key: 'bendFreq', label: 'ゆがみの細かさ', min: 0.5, max: 4, step: 0.05, def: 1.5, show: (P) => P.bend > 0 },
  { key: 'rnoise', label: '肉のむら', min: 0, max: 0.8, step: 0.01, def: 0 },
  { key: 'rnoiseFreq', label: 'むらの細かさ', min: 1, max: 8, step: 0.1, def: 3, show: (P) => P.rnoise > 0 },
  { key: 'seed', label: 'シード', min: 0, max: 9999, step: 1, def: 1 },

  { group: '色と素材' },
  // 表面のつや（5 段）と透け（4 段）は別々に選ぶ。組み合わせで、ガラス・すりガラス・乳白の樹脂などになる
  { key: 'surface', label: '表面', type: 'select', def: 2, num: true, options: [[0, 'つや'], [1, '半つや'], [2, 'ふつう'], [3, 'マット'], [4, 'ざらつき']] },
  { key: 'clarity', label: '透け', type: 'select', def: 0, num: true, options: [[0, '不透明'], [1, 'うっすら'], [2, '半透明'], [3, '透明']] },
  { key: 'color', label: '色', type: 'select', def: 0, num: true, options: PALETTE.map(([n], i) => [i, n]) },
];

export const DEFAULTS = Object.fromEntries(SCHEMA.filter((s) => s.key).map((s) => [s.key, s.def]));

const pick = (rng, items) => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of items) { if ((r -= w) <= 0) return v; }
  return items[items.length - 1][0];
};
const U = (rng, a, b) => a + (b - a) * rng();
const chance = (rng, p) => rng() < p;

export function randomParams(rng) {
  const P = { ...DEFAULTS };
  P.base = pick(rng, [['prism', 18], ['loop', 15], ['pyramid', 9], ['bipyramid', 8], ['star', 12], ['line', 7], ['arc', 8], ['helix', 6], ['blob', 12]]);
  P.sides = pick(rng, [[3, 5], [4, 6], [5, 3], [6, 4], [7, 1], [8, 2]]);
  P.count = pick(rng, [[1, 5], [2, 2], [3, 2], [4, 1]]);
  P.bulge = chance(rng, 0.45) ? 0 : chance(rng, 0.35) ? 1 : U(rng, -0.6, 1);
  P.arc = U(rng, 90, 330);
  P.size = U(rng, 0.7, 1.05);
  P.height = U(rng, 0.2, 1.4);
  P.radius = Math.exp(U(rng, Math.log(0.03), Math.log(0.18)));
  P.profile = chance(rng, 0.5) ? 0 : chance(rng, 0.5) ? 1 : rng();
  P.taper = chance(rng, 0.6) ? 0 : U(rng, -0.8, 0.8);
  P.fillet = U(rng, 0.3, 1.4);
  P.membrane = chance(rng, 0.65) ? 0 : chance(rng, 0.4) ? 1 : U(rng, 0.2, 0.9);
  P.membraneTh = U(rng, 0.3, 1);
  P.lattice = pick(rng, [[0, 4], [1, 3], [2, 2], [3, 1]]);
  P.grid = pick(rng, [[1, 4], [2, 3], [3, 2], [4, 1]]);
  P.struts = chance(rng, 0.6) ? 0 : U(rng, 0.3, 1);
  P.strutLen = U(rng, 0.1, 0.45);
  P.knob = chance(rng, 0.5) ? 0 : U(rng, 1, 2.2);
  P.drop = chance(rng, 0.75) ? 0 : U(rng, 0.1, 0.4);
  const polygonal = !['line', 'arc', 'helix'].includes(P.base);
  P.sym = polygonal ? pick(rng, [[P.sides, 5], [1, 3], [0, 2]]) : pick(rng, [[1, 6], [0, 4]]);
  const b = rng();
  P.bend = b < 0.5 ? U(rng, 0, 0.03) : b < 0.8 ? U(rng, 0.03, 0.1) : U(rng, 0.1, 0.22);
  P.bendFreq = U(rng, 0.8, 2.5);
  P.rnoise = chance(rng, 0.7) ? 0 : U(rng, 0.08, 0.35);
  P.rnoiseFreq = U(rng, 1.5, 6);
  P.hole = chance(rng, 0.85) ? 0 : U(rng, 0.15, 0.45);
  P.seed = Math.floor(rng() * 10000);
  P.color = Math.floor(rng() * PALETTE.length);
  // 表面と透け（あとから足した値。乱数の順は、前からある値のあとに足して、これまでの形を変えない）。透けはたまに出る当たり
  P.surface = pick(rng, [[0, 20], [1, 20], [2, 25], [3, 20], [4, 15]]);
  P.clarity = pick(rng, [[0, 88], [1, 4], [2, 4], [3, 4]]);
  // 奥行きの比・膜を張る面・穴の深さ（同じく、あとから足した値）
  P.depth = chance(rng, 0.8) ? 1 : U(rng, 0.5, 0.9);
  P.membraneFaces = chance(rng, 0.75) ? 0 : pick(rng, [[1, 1], [2, 1], [3, 1]]);
  P.holeDepth = chance(rng, 0.7) ? 1 : U(rng, 0.3, 0.8);
  return P;
}

// 同じ「系統」のまま細部だけ揺らす（近い話題 → 似た形、の確認用）
export function jitterParams(P0, rng) {
  const P = { ...P0 };
  const j = (k, amt, lo, hi) => { P[k] = Math.max(lo, Math.min(hi, P[k] + (rng() * 2 - 1) * amt)); };
  j('height', 0.15, 0.1, 1.6);
  j('radius', 0.015, 0.02, 0.3);
  j('bulge', 0.15, -0.8, 1);
  j('taper', 0.2, -1, 1);
  j('bend', 0.03, 0, 0.3);
  j('rnoise', 0.1, 0, 0.8);
  j('strutLen', 0.06, 0.05, 0.6);
  P.seed = Math.floor(rng() * 10000);
  return P;
}
