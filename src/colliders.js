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

// 当たり判定を、実際にできた形に合わせて切り詰める。当たり判定は骨格から作るので、そのままだと
//   ・縦穴（hole）で掘った所にも、骨格の線や塊の当たり判定が残る（穴に物が入らない、見えない棒に当たる）
//   ・切り離して捨てた破片のぶんも残る（何もない所で何かに乗る・ぶつかる）
// そこで、当たり判定の中の点が本当に形の中か（距離場 f がマイナス）、残した面の近くか（near）を調べて、外れた所を落とす。
//   カプセル：軸を細かく区切って、中にある区間ごとに短いカプセルに分け直す
//   膜：3 点と中心が中なら残す。外れた所があれば 9 枚に割って、中にある小片だけ残す（穴か破片があるときだけ）
//   塊：穴の柱の中と、捨てた破片の側の点を除き、穴のまわりを 8 つの扇に分けて包み直す
// field：buildField の結果（f）、hole：generate の hole、near：keepLargestPart の near（破片がなければ null）
export function clipColliders(col, field, hole, near) {
  const f = field.f;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // near は残した面の頂点までの距離で調べるので、形の奥深く（太い所の芯）にある点は、その深さのぶん遠くまで探す
  const ok = (p, r, slack = 0) => { const d = f(p[0], p[1], p[2]); return d < slack && (!near || near(p, Math.max(r, -d) + 0.04)); };
  const capsules = [];
  for (const c of col.capsules) {
    const L = Math.sqrt(dot3(sub3(c.b, c.a), sub3(c.b, c.a)));
    const n = L < 1e-6 ? 0 : Math.max(2, Math.min(16, Math.ceil(L / (c.r * 0.8))));
    if (!n) { if (ok(c.a, c.r)) capsules.push(c); continue; }
    let run = -1;
    for (let i = 0; i <= n + 1; i++) {
      const inside = i <= n && ok(lerp(c.a, c.b, i / n), c.r);
      if (inside && run < 0) run = i;
      if (!inside && run >= 0) {
        if (run === 0 && i === n + 1) capsules.push(c); // 全部が中：元のまま
        else capsules.push({ a: lerp(c.a, c.b, run / n), b: lerp(c.a, c.b, (i - 1) / n), r: c.r });
        run = -1;
      }
    }
  }
  const tris = [];
  // 膜の当たり判定は縁を何本かおきに結んだ大まかなもので、少しはみ出すのがふつう。割るのは穴か捨てた破片があるときだけ
  const triOk = (a, b, c, th) => [a, b, c, lerp(lerp(a, b, 0.5), c, 1 / 3)].every((p) => ok(p, th, 0.05));
  for (const t of col.tris || []) {
    if (!hole && !near) { tris.push(t); continue; }
    if (triOk(t.a, t.b, t.c, t.th || 0)) { tris.push(t); continue; }
    const S = 3, P = (i, j) => lerp(lerp(t.a, t.b, i / S), lerp(t.a, t.c, i / S), i ? j / i : 0); // i 段目の j 番目の点
    for (let i = 0; i < S; i++) for (let j = 0; j <= i; j++) {
      const sub = [[P(i, j), P(i + 1, j), P(i + 1, j + 1)]];
      if (j < i) sub.push([P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
      for (const [a, b, c] of sub) if (triOk(a, b, c, t.th || 0)) tris.push({ a, b, c, th: t.th });
    }
  }
  const hulls = [];
  for (const h of col.hulls) {
    const inHole = (p) => hole && Math.hypot(p[0] - hole.c[0], p[2] - hole.c[2]) < hole.r * 1.05;
    const pts = h.filter((p) => !inHole(p) && (!near || near(p, 0.06)));
    if (pts.length === h.length) { hulls.push(h); continue; }
    if (!hole) { if (pts.length >= 4) hulls.push(pts); continue; }
    const fan = Array.from({ length: 8 }, () => []);
    for (const p of pts) {
      const a = Math.atan2(p[2] - hole.c[2], p[0] - hole.c[0]);
      fan[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8].push(p);
    }
    for (const g of fan) if (g.length >= 4) hulls.push(g);
  }
  return { ...col, capsules, tris, hulls };
}
