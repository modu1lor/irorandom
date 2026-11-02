// プリミティブ群から距離場（SDF）を作る。
// 同じ線に属する線分どうしは min、別の線・膜・塊どうしは smooth union でつなぎ、
// 継ぎ目に鋳物のようなフィレットを出す。

const MARGIN = 0.12; // これより遠い点は「十分外」として扱う（値は MARGIN で頭打ち）

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function buildField(prim) {
  const { segs, tris, balls, e, k, hole } = prim;
  const nS = segs.length, nT = tris.length, nB = balls.length, N = nS + nT + nB;

  // 線分の前計算
  const S = new Float64Array(nS * 16);
  segs.forEach((s, i) => {
    const o = i * 16;
    const ab = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
    const l = Math.sqrt(l2);
    S.set([s.a[0], s.a[1], s.a[2], ab[0], ab[1], ab[2], 1 / l2, s.ra, s.rb, s.n[0], s.n[1], s.n[2], s.bn[0], s.bn[1], s.bn[2], l], o);
  });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const T = tris.map((t) => {
    const ba = sub(t.b, t.a), cb = sub(t.c, t.b), ac = sub(t.a, t.c);
    const nor = crs(ba, ac);
    return { a: t.a, b: t.b, c: t.c, ba, cb, ac, nor, n2: dt(nor, nor) || 1e-12,
      e1: crs(ba, nor), e2: crs(cb, nor), e3: crs(ac, nor),
      ba2: dt(ba, ba) || 1e-12, cb2: dt(cb, cb) || 1e-12, ac2: dt(ac, ac) || 1e-12, th: t.th };
  });
  const group = new Int32Array(N);
  segs.forEach((s, i) => (group[i] = s.g));
  tris.forEach((t, i) => (group[nS + i] = t.g));
  balls.forEach((b, i) => (group[nS + nT + i] = b.g));

  // 各プリミティブの外接箱
  const boxes = [];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (pts, r) => {
    const bl = [0, 1, 2].map((d) => Math.min(...pts.map((p) => p[d])) - r);
    const bh = [0, 1, 2].map((d) => Math.max(...pts.map((p) => p[d])) + r);
    boxes.push([bl, bh]);
    for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], bl[d]); hi[d] = Math.max(hi[d], bh[d]); }
  };
  const rx = e > 2 ? Math.SQRT2 : 1;
  for (const s of segs) grow([s.a, s.b], Math.max(s.ra, s.rb) * rx);
  for (const t of tris) grow([t.a, t.b, t.c], t.th);
  for (const b of balls) grow([b.c], b.r * Math.max(1, b.sy) * (b.e > 2 ? Math.sqrt(3) : 1));
  // 形を作る範囲：部品の外側に少し余白をとる。継ぎ目の丸み（smooth union）は表面を k/4 ほど外へふくらませるので、
  // そのぶんも足す（足りないと、ふくらんだ所が範囲の端で切れて、表面に穴が開く）
  const mg = 0.04 + k * 0.3;
  const bbox = { min: lo.map((v) => v - mg), max: hi.map((v) => v + mg) };

  // 空間を格子に分け、各セルに近いプリミティブだけを登録する
  const G = 18;
  const gmin = lo.map((v) => v - MARGIN), gsz = [0, 1, 2].map((d) => (hi[d] - lo[d] + 2 * MARGIN) / G);
  const cells = Array.from({ length: G * G * G }, () => []);
  const pad = MARGIN + k;
  boxes.forEach(([bl, bh], id) => {
    const i0 = [0, 1, 2].map((d) => Math.max(0, Math.floor((bl[d] - pad - gmin[d]) / gsz[d])));
    const i1 = [0, 1, 2].map((d) => Math.min(G - 1, Math.floor((bh[d] + pad - gmin[d]) / gsz[d])));
    for (let x = i0[0]; x <= i1[0]; x++)
      for (let y = i0[1]; y <= i1[1]; y++)
        for (let z = i0[2]; z <= i1[2]; z++) cells[(x * G + y) * G + z].push(id);
  });
  const lists = cells.map((c) => Int32Array.from(c.sort((a, b) => group[a] - group[b] || a - b)));

  const rcf = prim.rcf;
  function segDist(i, x, y, z) {
    const o = i * 16;
    const px = x - S[o], py = y - S[o + 1], pz = z - S[o + 2];
    let t = (px * S[o + 3] + py * S[o + 4] + pz * S[o + 5]) * S[o + 6];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const wx = px - S[o + 3] * t, wy = py - S[o + 4] * t, wz = pz - S[o + 5] * t;
    const r = S[o + 7] + (S[o + 8] - S[o + 7]) * t;
    if (rcf >= 1) return Math.sqrt(wx * wx + wy * wy + wz * wz) - r;
    // 断面は角丸の四角。rc = 角の丸み半径
    const u = Math.abs(wx * S[o + 9] + wy * S[o + 10] + wz * S[o + 11]);
    const v = Math.abs(wx * S[o + 12] + wy * S[o + 13] + wz * S[o + 14]);
    const s = (wx * S[o + 3] + wy * S[o + 4] + wz * S[o + 5]) / S[o + 15];
    const rc = r * rcf, qx = u - (r - rc), qy = v - (r - rc);
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
    const d2 = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rc;
    if (s === 0) return d2;
    const nq = Math.max(d2 + r, 0);
    return Math.sqrt(nq * nq + s * s) - r;
  }
  function triDist(tr, x, y, z) {
    const pa = [x - tr.a[0], y - tr.a[1], z - tr.a[2]];
    const pb = [x - tr.b[0], y - tr.b[1], z - tr.b[2]];
    const pc = [x - tr.c[0], y - tr.c[1], z - tr.c[2]];
    const sg = Math.sign(dt(tr.e1, pa)) + Math.sign(dt(tr.e2, pb)) + Math.sign(dt(tr.e3, pc));
    let d2;
    if (sg < 2) {
      const f = (ed, p, l2) => {
        const t = Math.max(0, Math.min(1, dt(ed, p) / l2));
        const qx = ed[0] * t - p[0], qy = ed[1] * t - p[1], qz = ed[2] * t - p[2];
        return qx * qx + qy * qy + qz * qz;
      };
      d2 = Math.min(f(tr.ba, pa, tr.ba2), f(tr.cb, pb, tr.cb2), f(tr.ac, pc, tr.ac2));
    } else {
      const d = dt(tr.nor, pa);
      d2 = (d * d) / tr.n2;
    }
    return Math.sqrt(d2) - tr.th;
  }
  function ballDist(b, x, y, z) {
    const dx = x - b.c[0], dy = (y - b.c[1]) / b.sy, dz = z - b.c[2];
    let m;
    if (b.e === 2) m = Math.sqrt(dx * dx + dy * dy + dz * dz);
    else m = Math.pow(Math.abs(dx) ** b.e + Math.abs(dy) ** b.e + Math.abs(dz) ** b.e, 1 / b.e);
    return (m - b.r) * Math.min(1, b.sy);
  }

  function f(x, y, z) {
    const cx = Math.floor((x - gmin[0]) / gsz[0]), cy = Math.floor((y - gmin[1]) / gsz[1]), cz = Math.floor((z - gmin[2]) / gsz[2]);
    let acc = MARGIN;
    if (cx >= 0 && cy >= 0 && cz >= 0 && cx < G && cy < G && cz < G) {
      const list = lists[(cx * G + cy) * G + cz];
      // 部品ごとの最小距離のうち、近い2つだけを smooth union する。
      // 全部を順に smin すると、3本以上が集まる節点ほど玉のようにふくらむため。
      let m1 = MARGIN, m2 = MARGIN, curG = -1, gm = MARGIN;
      for (let j = 0; j < list.length; j++) {
        const id = list[j];
        const gi = group[id];
        if (gi !== curG) {
          if (gm < m1) { m2 = m1; m1 = gm; } else if (gm < m2) m2 = gm;
          curG = gi; gm = MARGIN;
        }
        const d = id < nS ? segDist(id, x, y, z) : id < nS + nT ? triDist(T[id - nS], x, y, z) : ballDist(balls[id - nS - nT], x, y, z);
        if (d < gm) gm = d;
      }
      if (gm < m1) { m2 = m1; m1 = gm; } else if (gm < m2) m2 = gm;
      acc = Math.min(smin(m1, m2, k), MARGIN);
    }
    if (hole) {
      // 穴の中ほど正。深さに限りがあれば、底（yb）より下は穴にしない
      const hd = Math.min(hole.r - Math.hypot(x - hole.c[0], z - hole.c[2]), y - hole.yb);
      acc = -smin(-acc, -hd, k);
    }
    return acc;
  }

  return { f, bbox };
}
