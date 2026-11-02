// 当たり判定（骨格のカプセルの列）を軽くする。three を使わないので、Worker からも呼べる。

// ---- 当たり判定を軽くする --------------------------------------------------------
// 骨格の線は細かく区切ったカプセルの列でできていて、格子などでは 1 つの形に数百個になる。
// 物理の重さはほぼこの数で決まるので、見た目の当たり方を変えずに減らす：
//   1. まっすぐつながったカプセルを 1 本にまとめる
//   2. ほかのカプセルにすっぽり入っているものを捨てる
//   3. それでも多ければ、ずれの小さい隣どうしから順にまとめる（ずれた分は半径を太らせて覆う）。
//      ただし元の太さの 1.35 倍を超えるまとめ方はしない（角で折れた辺どうしをまとめると、
//      ずれを覆うために何倍にも太って、見た目より大きな当たり判定になるため）
//   4. まだ多ければ、小さいものから捨てる
const MAX_CAPSULES = 56, MAX_GROW = 1.35;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segDist(p, a, b) {
  const ab = sub3(b, a), L2 = dot3(ab, ab);
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / L2));
  const d = sub3(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
  return Math.sqrt(dot3(d, d));
}
const pkey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
// まとめられる隣どうしの候補を、ずれの小さい順に返す
function mergeCandidates(caps, strict) {
  const at = new Map();
  caps.forEach((c, i) => {
    if (pkey(c.a) === pkey(c.b)) return; // 玉はまとめない
    for (const end of ['a', 'b']) { const k = pkey(c[end]); if (!at.has(k)) at.set(k, []); at.get(k).push([i, end]); }
  });
  const cand = [];
  for (const list of at.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const [i, ei] = list[x], [j, ej] = list[y];
      if (i === j) continue;
      const ci = caps[i], cj = caps[j];
      const S = ci[ei], P = ci[ei === 'a' ? 'b' : 'a'], Q = cj[ej === 'a' ? 'b' : 'a'];
      if (pkey(P) === pkey(Q)) continue;
      // まとめた線が S の側でふくらまないよう、S は P と Q のあいだにあること
      if (dot3(sub3(S, P), sub3(Q, P)) <= 0 || dot3(sub3(S, Q), sub3(P, Q)) <= 0) continue;
      const d = segDist(S, P, Q), err = d + Math.abs(ci.r - cj.r) * 0.5;
      if (strict && err > 0.12 * Math.min(ci.r, cj.r)) continue;
      const r = Math.max(ci.r, cj.r) + d, r0 = Math.max(ci.r0, cj.r0);
      if (r > r0 * MAX_GROW) continue;
      cand.push({ err, i, j, P, Q, r, r0 });
    }
  }
  return cand.sort((x, y) => x.err - y.err);
}
// 候補を、同じカプセルを二度使わないように、ずれの小さい順にまとめて当てる（limit 個まで）
function mergeBatch(caps, cand, limit = Infinity) {
  const used = new Set(), add = [];
  for (const m of cand) {
    if (add.length >= limit) break;
    if (used.has(m.i) || used.has(m.j)) continue;
    used.add(m.i); used.add(m.j);
    add.push({ a: m.P, b: m.Q, r: m.r, r0: m.r0 });
  }
  return add.length ? caps.filter((_, k) => !used.has(k)).concat(add) : null;
}
export function simplifyColliders(col) {
  let caps = col.capsules.map((c) => ({ a: [...c.a], b: [...c.b], r: c.r, r0: c.r }));
  // 1. まっすぐなつながり
  for (let next; (next = mergeBatch(caps, mergeCandidates(caps, true)));) caps = next;
  // 2. ほかに入っているもの（太いものから見ていく）
  caps.sort((x, y) => y.r - x.r);
  const out = [];
  for (const c of caps) {
    const inside = out.some((o) => segDist(c.a, o.a, o.b) + c.r <= o.r * 1.02 && segDist(c.b, o.a, o.b) + c.r <= o.r * 1.02);
    if (!inside) out.push(c);
  }
  caps = out;
  // 3. まだ多ければ、ずれの小さいところから（1 回にまとめすぎないよう、減らしたい数の半分ずつ）
  while (caps.length > MAX_CAPSULES) {
    const next = mergeBatch(caps, mergeCandidates(caps, false), Math.ceil((caps.length - MAX_CAPSULES) / 2));
    if (!next) break;
    caps = next;
  }
  if (caps.length > MAX_CAPSULES) {
    const vol = (c) => c.r * c.r * (Math.sqrt(dot3(sub3(c.b, c.a), sub3(c.b, c.a))) + c.r);
    caps = caps.sort((x, y) => vol(y) - vol(x)).slice(0, MAX_CAPSULES);
  }
  return { ...col, capsules: caps.map(({ a, b, r }) => ({ a, b, r })) };
}

// 捨てた破片のぶんの当たり判定も外す（残した面の近くにないカプセル・膜）
export function pruneColliders(col, near) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const capsules = col.capsules.filter((c) => [0, 0.25, 0.5, 0.75, 1].some((t) => near(lerp(c.a, c.b, t), c.r + 0.06)));
  const tris = (col.tris || []).filter((t) => [t.a, t.b, t.c].some((p) => near(p, (t.th || 0) + 0.06)));
  return { ...col, capsules, tris };
}
