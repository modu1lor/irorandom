// 骨格 → ネットワーク → ノイズ → 肉 の順に、形の部品（プリミティブ）を組み立てる。
// 出力は SDF 用のプリミティブと、物理エンジン用の当たり判定。

import { hash3, makeFbm3 } from './rng.js';

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const avg = (pts) => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---- 対称性 ------------------------------------------------------------
// canon(p) は p を基本領域に折りたたんだ点 q と、q での変位ベクトルを元の向きに戻す関数を返す。
// 鏡映面の近くでは面に垂直な変位を弱め、折り目で形が裂けないようにする。
const BAND = 0.15;

function makeSym(sym) {
  if (sym === 0) return (p) => ({ q: p, back: (d) => d });
  if (sym === 1) {
    return (p) => {
      const flip = p[0] < 0;
      const q = [Math.abs(p[0]), p[1], p[2]];
      return {
        q,
        back: (d) => {
          const dx = d[0] * clamp01(q[0] / BAND);
          return [flip ? -dx : dx, d[1], d[2]];
        },
      };
    };
  }
  const n = sym, w = TAU / n, beta = Math.PI / 2 + w / 2;
  const u = [Math.cos(beta), Math.sin(beta)]; // 2本目の鏡映線の向き (x, z)
  const nrm2 = [-u[1], u[0]];
  return (p) => {
    const r = Math.hypot(p[0], p[2]);
    let psi = Math.atan2(p[2], p[0]) - Math.PI / 2;
    psi = ((psi % TAU) + TAU) % TAU;
    const k = Math.floor(psi / w);
    let loc = psi - k * w;
    const refl = loc > w / 2;
    if (refl) loc = w - loc;
    const th = Math.PI / 2 + loc;
    const q = [r * Math.cos(th), p[1], r * Math.sin(th)];
    const back = (d) => {
      let dx = d[0], dz = d[2];
      // 1本目の鏡映線（z軸）に垂直な成分 = x 成分
      dx *= clamp01(Math.abs(q[0]) / BAND);
      // 2本目の鏡映線に垂直な成分
      const dist2 = Math.abs(q[0] * nrm2[0] + q[2] * nrm2[1]);
      const c2 = dx * nrm2[0] + dz * nrm2[1];
      const a2 = 1 - clamp01(dist2 / BAND);
      dx -= a2 * c2 * nrm2[0]; dz -= a2 * c2 * nrm2[1];
      // 回転軸の近くでは水平な変位を消す
      const ar = clamp01(r / BAND);
      dx *= ar; dz *= ar;
      if (refl) {
        const c = dx * u[0] + dz * u[1];
        dx = 2 * c * u[0] - dx; dz = 2 * c * u[1] - dz;
      }
      const a = k * w;
      return [dx * Math.cos(a) - dz * Math.sin(a), d[1], dx * Math.sin(a) + dz * Math.cos(a)];
    };
    return { q, back };
  };
}

// ---- 折れ線ユーティリティ ----------------------------------------------
function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len(sub(pts[i], pts[i - 1]));
  return L;
}

function polyAt(pts, t) {
  const L = polyLength(pts) * t;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len(sub(pts[i], pts[i - 1]));
    if (acc + l >= L || i === pts.length - 1) return lerp3(pts[i - 1], pts[i], l > 0 ? clamp01((L - acc) / l) : 0);
    acc += l;
  }
  return pts[0];
}

// 弧長で等間隔に取り直す。rs（半径の倍率）も補間する。
function resample(pts, rs, step) {
  const L = polyLength(pts);
  const n = Math.max(1, Math.ceil(L / step));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const out = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < pts.length - 1 && cum[j] < s) j++;
    const l = cum[j] - cum[j - 1];
    const f = l > 0 ? clamp01((s - cum[j - 1]) / l) : 0;
    const r = rs ? rs[j - 1] + (rs[j] - rs[j - 1]) * f : 1;
    out.push({ p: lerp3(pts[j - 1], pts[j], f), rs: r, t: k / n });
  }
  return out;
}

// ---- 骨格の型 ------------------------------------------------------------
function buildBase(P) {
  const s = P.size * 0.5;
  const h = P.height * s;
  const n = P.sides;
  const nodes = [], edges = [], faces = [];
  const blobs = [];
  const extra = {}; // 型ごとの補助情報（格子づくりに使う）
  const addNode = (p) => nodes.push(p) - 1;
  const addEdge = (a, b, pts, kind = 'base', rs = null) => {
    edges.push({ a, b, pts: pts || [nodes[a], nodes[b]], kind, rs });
    return edges.length - 1;
  };
  const ang = (i) => Math.PI / 2 + (TAU * i) / n;

  // 多角形の1辺。bulge=1 で外接円の弧、負で内側へ反る。
  const loopEdge = (i, y, R) => {
    const pts = [];
    const segs = 16;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const a = [R * Math.cos(ang(i)), y, R * Math.sin(ang(i))];
      const b = [R * Math.cos(ang(i + 1)), y, R * Math.sin(ang(i + 1))];
      const st = lerp3(a, b, t);
      const th = ang(i) + (TAU / n) * t;
      const ci = [R * Math.cos(th), y, R * Math.sin(th)];
      pts.push(lerp3(st, ci, P.bulge));
    }
    return pts;
  };
  const ring = (y, R) => {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(addNode([R * Math.cos(ang(i)), y, R * Math.sin(ang(i))]));
    const es = [];
    for (let i = 0; i < n; i++) {
      const pts = loopEdge(i, y, R);
      pts[0] = nodes[ids[i]]; pts[pts.length - 1] = nodes[ids[(i + 1) % n]];
      es.push(addEdge(ids[i], ids[(i + 1) % n], pts));
    }
    return { ids, es };
  };

  switch (P.base) {
    case 'blob': {
      const c = P.count;
      const pos = c === 1 ? [[0, 0, 0]]
        : c === 2 ? [[-0.32 * s, 0, 0], [0.32 * s, 0, 0]]
        : c === 3 ? [0, 1, 2].map((i) => [0.38 * s * Math.cos(Math.PI / 2 + (TAU * i) / 3), 0, 0.38 * s * Math.sin(Math.PI / 2 + (TAU * i) / 3)])
        : [[0, 0.3 * s, 0], ...[0, 1, 2].map((i) => [0.4 * s * Math.cos(Math.PI / 2 + (TAU * i) / 3), -0.15 * s, 0.4 * s * Math.sin(Math.PI / 2 + (TAU * i) / 3)])];
      const br = Math.min(Math.max(P.radius * 2.6, 0.1), s * (c === 1 ? 0.75 : 0.5));
      for (const p of pos) blobs.push({ node: addNode(p), r: br });
      for (let i = 0; i + 1 < pos.length; i++) addEdge(i, i + 1);
      if (c === 4) { addEdge(1, 3); }
      extra.blobR = br;
      break;
    }
    case 'line': {
      addEdge(addNode([-s, 0, 0]), addNode([s, 0, 0]));
      break;
    }
    case 'arc': {
      const A = (P.arc * Math.PI) / 180;
      const R = s;
      const pts = [];
      for (let k = 0; k <= 48; k++) {
        const th = Math.PI / 2 - A / 2 + (A * k) / 48;
        pts.push([R * Math.cos(th), 0, R * Math.sin(th)]);
      }
      const zs = pts.map((p) => p[2]);
      const zc = (Math.max(...zs) + Math.min(...zs)) / 2;
      for (const p of pts) p[2] -= zc;
      extra.center = [0, 0, -zc];
      addEdge(addNode(pts[0]), addNode(pts[pts.length - 1]), pts);
      break;
    }
    case 'helix': {
      const turns = P.arc / 110;
      const R = s * 0.6;
      const m = Math.ceil(turns * 28);
      const pts = [];
      for (let k = 0; k <= m; k++) {
        const t = k / m, th = Math.PI / 2 + TAU * turns * t;
        pts.push([R * Math.cos(th), -h + 2 * h * t, R * Math.sin(th)]);
      }
      extra.turns = turns;
      addEdge(addNode(pts[0]), addNode(pts[pts.length - 1]), pts);
      break;
    }
    case 'loop': {
      const { es } = ring(0, s);
      faces.push(es.map((e) => [e, 1]));
      break;
    }
    case 'prism': {
      const bot = ring(-h / 2, s), top = ring(h / 2, s);
      const vs = [];
      for (let i = 0; i < n; i++) vs.push(addEdge(bot.ids[i], top.ids[i]));
      faces.push(bot.es.map((e) => [e, 1]), top.es.map((e) => [e, 1]));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        faces.push([[bot.es[i], 1], [vs[j], 1], [top.es[i], -1], [vs[i], -1]]);
      }
      break;
    }
    case 'pyramid': {
      const bot = ring(-h / 2, s);
      const apex = addNode([0, h / 2, 0]);
      const sides = bot.ids.map((id) => addEdge(id, apex));
      faces.push(bot.es.map((e) => [e, 1]));
      for (let i = 0; i < n; i++) faces.push([[bot.es[i], 1], [sides[(i + 1) % n], 1], [sides[i], -1]]);
      break;
    }
    case 'bipyramid': {
      const mid = ring(0, s);
      const up = addNode([0, h / 2, 0]), dn = addNode([0, -h / 2, 0]);
      const su = mid.ids.map((id) => addEdge(id, up));
      const sd = mid.ids.map((id) => addEdge(id, dn));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        faces.push([[mid.es[i], 1], [su[j], 1], [su[i], -1]]);
        faces.push([[mid.es[i], -1], [sd[i], 1], [sd[j], -1]]);
      }
      break;
    }
    case 'star': {
      const c = addNode([0, 0, 0]);
      extra.tips = [];
      for (let i = 0; i < n; i++) {
        const t = addNode([s * Math.cos(ang(i)), 0, s * Math.sin(ang(i))]);
        extra.tips.push(t);
        addEdge(c, t);
      }
      extra.vtips = [];
      if (P.height > 0.45) {
        for (const y of [h, -h]) { const t = addNode([0, y, 0]); extra.vtips.push(t); addEdge(c, t); }
      }
      extra.center = [0, 0, 0];
      break;
    }
  }
  return { nodes, edges, faces, blobs, extra, s, h };
}

// ---- ネットワーク（格子・突起・間引き） -----------------------------------
function orientedEdgePts(edges, [e, dir]) {
  const pts = edges[e].pts;
  return dir > 0 ? pts : [...pts].reverse();
}

function addNetwork(G, P, canon) {
  const { nodes, edges, faces, extra, s, h } = G;
  const L = P.lattice, Gd = P.grid;
  const lat = (pts) => edges.push({ a: -1, b: -1, pts, kind: 'lattice', rs: null });
  const bodyC = avg(nodes);

  if (L >= 1 && faces.length) {
    for (const f of faces) {
      const sides = f.map((fe) => orientedEdgePts(edges, fe));
      const verts = sides.map((p) => p[0]);
      const c = avg(verts);
      if (sides.length === 4) {
        for (let g = 1; g <= Gd; g++) {
          const t = g / (Gd + 1);
          lat([polyAt(sides[0], t), polyAt(sides[2], 1 - t)]);
          lat([polyAt(sides[1], t), polyAt(sides[3], 1 - t)]);
        }
      } else {
        for (const sp of sides) lat([c, polyAt(sp, 0.5)]);
        const boundary = sides.flatMap((sp, i) => (i === 0 ? sp : sp.slice(1)));
        for (let g = 1; g < Gd; g++) lat(boundary.map((p) => lerp3(c, p, g / Gd)));
      }
      if (L >= 2) for (const v of verts) lat([c, v]);
    }
    if (L >= 3) {
      if (faces.length >= 2) {
        for (const f of faces) lat([avg(f.map((fe) => orientedEdgePts(edges, fe)[0])), bodyC]);
      } else {
        const c = avg(faces[0].map((fe) => orientedEdgePts(edges, fe)[0]));
        lat([add(c, [0, s * 0.5, 0]), add(c, [0, -s * 0.5, 0])]);
      }
    }
  } else if (L >= 1) {
    switch (P.base) {
      case 'line': {
        const cnt = Gd * 2 + 1, w = Math.max(h, 0.08);
        const ends = [];
        for (let g = 0; g < cnt; g++) {
          const x = -s + (2 * s * (g + 1)) / (cnt + 1);
          lat([[x, 0, -w / 2], [x, 0, w / 2]]);
          ends.push([[x, 0, -w / 2], [x, 0, w / 2]]);
          if (L >= 2) lat([[x, -w / 2, 0], [x, w / 2, 0]]);
        }
        if (L >= 3) {
          lat(ends.map((e) => e[0]));
          lat(ends.map((e) => e[1]));
        }
        break;
      }
      case 'arc': {
        const arc = edges[0].pts, c = extra.center;
        const cnt = Gd * 2 + 1;
        for (let g = 0; g <= cnt; g++) lat([c, polyAt(arc, g / cnt)]);
        if (L >= 2) lat([arc[0], arc[arc.length - 1]]);
        if (L >= 3) lat(arc.map((p) => lerp3(c, p, 0.5)));
        break;
      }
      case 'helix': {
        const hp = edges[0].pts;
        const cnt = Math.max(2, Math.round(extra.turns * 4 * Gd));
        for (let g = 0; g <= cnt; g++) {
          const p = polyAt(hp, g / cnt);
          lat([[0, p[1], 0], p]);
        }
        if (L >= 2) lat([[0, -h, 0], [0, h, 0]]);
        break;
      }
      case 'star': {
        const tips = extra.tips.map((i) => nodes[i]);
        for (let g = 1; g <= Gd; g++) {
          const f = g / Gd;
          const rim = tips.map((p) => mul(p, f));
          lat([...rim, rim[0]]);
        }
        if (L >= 2) {
          const rim = tips.map((p) => mul(p, 0.5));
          for (let i = 0; i < tips.length; i++) lat([tips[i], rim[(i + 1) % tips.length]]);
        }
        if (L >= 3) for (const vt of extra.vtips) for (const t of tips) lat([nodes[vt], t]);
        break;
      }
      case 'blob': {
        if (nodes.length > 2) for (let i = 0; i < nodes.length; i++) for (let j = i + 2; j < nodes.length; j++) lat([nodes[i], nodes[j]]);
        break;
      }
    }
  }

  // 突起：頂点（と面の中心）から外へ伸ばす
  const strutLen = P.strutLen * P.size;
  const knobs = [];
  if (P.struts > 0) {
    const cand = [];
    if (P.base === 'blob' && nodes.length === 1) {
      const br = extra.blobR;
      const dirs = [];
      for (let i = 0; i < P.sides; i++) dirs.push([Math.cos(Math.PI / 2 + (TAU * i) / P.sides), 0, Math.sin(Math.PI / 2 + (TAU * i) / P.sides)]);
      if (P.height > 0.45) dirs.push([0, 1, 0], [0, -1, 0]);
      for (const d of dirs) cand.push({ p: mul(d, br * 0.85), d });
    } else {
      for (const p of nodes) {
        const d = sub(p, bodyC);
        if (len(d) > 1e-4) cand.push({ p, d: norm(d) });
      }
      if (faces.length >= 2) {
        for (const f of faces) {
          const c = avg(f.map((fe) => orientedEdgePts(edges, fe)[0]));
          const d = sub(c, bodyC);
          if (len(d) > 1e-4) cand.push({ p: c, d: norm(d) });
        }
      }
    }
    for (const { p, d } of cand) {
      const { q } = canon(p);
      if (hash3(q[0], q[1], q[2], P.seed + 3) >= P.struts) continue;
      const tip = add(p, mul(d, strutLen));
      edges.push({ a: -1, b: -1, pts: [p, tip], kind: 'strut', rs: [1, 0.55] });
      if (P.knob > 0.15) knobs.push(tip);
    }
  }

  // 間引き
  if (P.drop > 0) {
    let alive = 0;
    for (const e of edges) {
      if (e.kind === 'strut') continue;
      const { q } = canon(polyAt(e.pts, 0.5));
      if (hash3(q[0], q[1], q[2], P.seed + 7) < P.drop) e.dropped = true; else alive++;
    }
    if (!alive && !G.blobs.length) { const e = edges.find((x) => x.kind !== 'strut'); if (e) e.dropped = false; }
  }
  return keepLargestPart(edges, knobs, G.blobs.map((b) => ({ p: nodes[b.node], r: b.r })), P.radius);
}

// 間引きで宙に浮いた部品を取り除く。端点が他の線（や塊）に触れていればつながっているとみなす。
function keepLargestPart(edges, knobs, blobs, R) {
  const live = edges.map((e, i) => i).filter((i) => !edges[i].dropped);
  const items = [...live.map((i) => ({ pts: edges[i].pts, edge: i })), ...blobs.map((b) => ({ pts: [b.p], r: b.r }))];
  if (items.length < 2) return knobs;
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const nearPoly = (p, pts, tol) => {
    for (let i = 0; i < pts.length; i++) {
      if (len(sub(p, pts[i])) < tol) return true;
      if (i > 0) {
        const ab = sub(pts[i], pts[i - 1]);
        const t = clamp01(dot(sub(p, pts[i - 1]), ab) / (dot(ab, ab) || 1));
        if (len(sub(p, add(pts[i - 1], mul(ab, t)))) < tol) return true;
      }
    }
    return false;
  };
  // 交差（同心の輪と放射線など）も拾えるよう、片方の全点ともう片方の折れ線を比べる
  const dense = items.map((it) => (it.pts.length > 1 ? resample(it.pts, null, R).map((o) => o.p) : it.pts));
  const bb = items.map((it) => [0, 1, 2].map((d) => [Math.min(...it.pts.map((p) => p[d])), Math.max(...it.pts.map((p) => p[d]))]));
  for (let i = 0; i < items.length; i++)
    for (let j = 0; j < items.length; j++) {
      if (i === j || find(i) === find(j)) continue;
      const a = items[i], b = items[j];
      const tol = R * 1.2 + (a.r || 0) + (b.r || 0);
      if ([0, 1, 2].some((d) => bb[i][d][0] > bb[j][d][1] + tol || bb[j][d][0] > bb[i][d][1] + tol)) continue;
      if (dense[i].some((p) => nearPoly(p, b.pts, tol))) parent[find(i)] = find(j);
    }
  const size = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    size.set(r, (size.get(r) || 0) + (it.pts.length > 1 ? polyLength(it.pts) : 10));
  });
  const best = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const keptPts = [];
  items.forEach((it, i) => {
    if (it.edge === undefined) return;
    if (find(i) !== best) edges[it.edge].dropped = true;
    else keptPts.push(it.pts);
  });
  // 先端の玉は、残った突起の先にあるものだけ
  return knobs.filter((k) => keptPts.some((pts) => len(sub(pts[pts.length - 1], k)) < 1e-6));
}

// ---- 全体 ----------------------------------------------------------------
// base を渡すと、骨格の型の代わりにその骨格（nodes, edges, faces, blobs, extra, s, h）を使う。
// P.noFit なら中心合わせと寸法合わせをせず、座標をそのまま使う（床の壁など）。
export function generate(P, base = null) {
  const canon = makeSym(P.sym);
  const G = base || buildBase(P);
  const knobs = addNetwork(G, P, canon);
  const { edges, faces, blobs, nodes } = G;

  const fb = [makeFbm3(P.seed * 3 + 1), makeFbm3(P.seed * 3 + 2), makeFbm3(P.seed * 3 + 3)];
  const fr = makeFbm3(P.seed * 7 + 5);
  const bendAmp = P.bend * P.size, bf = P.bendFreq;
  const disp = (p) => {
    if (bendAmp <= 0) return p;
    const { q, back } = canon(p);
    const d = fb.map((f) => f(q[0] * bf + 11.3, q[1] * bf - 4.1, q[2] * bf + 7.7) * bendAmp);
    return add(p, back(d));
  };
  const rnoise = (p) => {
    if (P.rnoise <= 0) return 1;
    const { q } = canon(p);
    const f = P.rnoiseFreq;
    return 1 + P.rnoise * fr(q[0] * f, q[1] * f, q[2] * f) * 1.4;
  };

  const R = P.radius;
  const e = 2 + Math.pow(P.profile, 1.5) * 10;
  const kindScale = { base: 1, lattice: 0.68, strut: 0.85 };
  const segs = [], tris = [], balls = [];
  const col = { capsules: [], hulls: [], tris: [] };
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let g = 0;

  // 骨格の線 → 肉付きの線分
  for (const ed of edges) {
    // ゆがみ・むらが無ければ粗く刻んでよい（半径は線分内で線形補間される）
    const rs = resample(ed.pts, ed.rs, P.bend > 0 || P.rnoise > 0 ? 0.035 : 0.07);
    // 変位前の点で半径を決め、変位後の点に置く
    const pts = rs.map((o) => {
      let f = 1;
      if (ed.kind !== 'strut') f = 1 + P.taper * 0.6 * (2 * (2 * o.t - 1) ** 2 - 1);
      const r = Math.max(0.012, R * kindScale[ed.kind] * o.rs * f * rnoise(o.p));
      return { p: disp(o.p), r };
    });
    ed.disp = pts;
    if (ed.dropped) continue;
    // 断面の向き：線全体で接線と最も直交する軸を基準にする
    const score = axes.map((ax) => {
      let sc = 0;
      for (let i = 1; i < pts.length; i++) sc += Math.abs(dot(norm(sub(pts[i].p, pts[i - 1].p)), ax));
      return sc;
    });
    const refIdx = score.indexOf(Math.min(...score));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const t = norm(sub(b.p, a.p));
      let ref = axes[refIdx];
      if (Math.abs(dot(ref, t)) > 0.97) ref = axes[(refIdx + 1) % 3];
      const nn = norm(sub(ref, mul(t, dot(ref, t))));
      segs.push({ a: a.p, b: b.p, ra: a.r, rb: b.r, n: nn, bn: cross(t, nn), g });
    }
    const stride = P.bend > 0 || P.rnoise > 0 ? 3 : 2;
    for (let i = 0; i < pts.length - 1; i += stride) {
      const j = Math.min(i + stride, pts.length - 1);
      let r = 0;
      for (let k = i; k <= j; k++) r += pts[k].r;
      col.capsules.push({ a: pts[i].p, b: pts[j].p, r: (r / (j - i + 1)) * (e > 3 ? 1.08 : 1) });
    }
    g++;
  }

  // 膜
  const memTh = R * P.membraneTh;
  faces.forEach((f) => {
    if (P.membrane <= 0) return;
    const boundary = [];
    for (const [ei, dir] of f) {
      const pts = edges[ei].disp.map((o) => o.p);
      const seq = dir > 0 ? pts : [...pts].reverse();
      boundary.push(...(boundary.length ? seq.slice(1) : seq));
    }
    boundary.pop();
    // どの面に張るか。0 は割合に従って乱数で。1〜3 は面の向きで決める（水平な面＝上下のふた、それ以外＝側面）
    const mode = P.membraneFaces || 0;
    let on;
    if (mode === 0) {
      const { q } = canon(avg(f.map((fe) => orientedEdgePts(edges, fe)[0])));
      on = faces.length === 1 ? P.membrane >= 0.5 : hash3(q[0], q[1], q[2], P.seed + 13) < P.membrane;
    } else {
      const nr = [0, 0, 0];
      for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i], b = boundary[(i + 1) % boundary.length];
        nr[0] += (a[1] - b[1]) * (a[2] + b[2]); nr[1] += (a[2] - b[2]) * (a[0] + b[0]); nr[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const flat = Math.abs(nr[1]) > 0.8 * Math.hypot(...nr), up = avg(boundary)[1] > 1e-6;
      on = mode === 1 ? !flat : mode === 2 ? !(flat && up) : flat;
    }
    if (!on) return;
    // 膜の三角形は粗くてよい（縁は線の肉が覆う）
    const step = Math.max(1, Math.ceil(boundary.length / 32));
    const bd = boundary.filter((_, i) => i % step === 0);
    boundary.length = 0; boundary.push(...bd);
    const c = avg(boundary);
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      tris.push({ a: c, b: a, c: b, th: memTh, g });
      if (i % 4 === 0) col.tris.push({ a: c, b: a, c: boundary[(i + 4) % boundary.length], th: memTh });
    }
    g++;
  });

  // 塊（超楕円体）と突起の先端の玉
  const sy = Math.max(0.3, P.height);
  for (const b of blobs) {
    const c = disp(nodes[b.node]);
    const r = b.r * rnoise(nodes[b.node]);
    balls.push({ c, r, e, sy, g: g++ });
    const pts = [];
    for (let i = 0; i < 120; i++) {
      const yy = 1 - (2 * (i + 0.5)) / 120, rr = Math.sqrt(1 - yy * yy), th = i * 2.39996;
      const d = [rr * Math.cos(th), yy, rr * Math.sin(th)];
      const m = Math.pow(Math.abs(d[0]) ** e + Math.abs(d[1] / sy) ** e + Math.abs(d[2]) ** e, 1 / e);
      pts.push(add(c, mul(d, r / m)));
    }
    col.hulls.push(pts);
  }
  for (const k of knobs) {
    const c = disp(k);
    const r = R * P.knob * rnoise(k);
    balls.push({ c, r, e: 2, sy: 1, g: g++ });
    col.capsules.push({ a: c, b: c, r });
  }

  // 中心をそろえ、いちばん長い辺の外寸が P.size になるよう全体を拡大縮小する
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const ext = (p, r, ry = r) => {
    for (let i = 0; i < 3; i++) {
      const rr = i === 1 ? ry : r;
      lo[i] = Math.min(lo[i], p[i] - rr); hi[i] = Math.max(hi[i], p[i] + rr);
    }
  };
  for (const s of segs) { ext(s.a, s.ra); ext(s.b, s.rb); }
  for (const t of tris) { ext(t.a, t.th); ext(t.b, t.th); ext(t.c, t.th); }
  for (const b of balls) ext(b.c, b.r, b.r * b.sy);
  const ctr = P.noFit ? [0, 0, 0] : mul(add(lo, hi), 0.5);
  const sc = P.noFit ? 1 : P.size / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  // 奥行きの比：手前・奥（z）だけを縮める。肉の太さはそのまま
  const dz = P.depth ?? 1;
  const sh = (p) => { const q = mul(sub(p, ctr), sc); q[2] *= dz; return q; };
  for (const s of segs) { s.a = sh(s.a); s.b = sh(s.b); s.ra *= sc; s.rb *= sc; }
  for (const t of tris) { t.a = sh(t.a); t.b = sh(t.b); t.c = sh(t.c); t.th *= sc; }
  for (const b of balls) { b.c = sh(b.c); b.r *= sc; }
  for (const c of col.capsules) { c.a = sh(c.a); c.b = sh(c.b); c.r *= sc; }
  for (const t of col.tris) { t.a = sh(t.a); t.b = sh(t.b); t.c = sh(t.c); t.th *= sc; }
  col.hulls = col.hulls.map((h) => h.map(sh));
  const halfXZ = (Math.min(hi[0] - lo[0], (hi[2] - lo[2]) * dz) * sc) / 2;
  // 穴の深さ：上の面から測って、高さのこの割合まで掘る（1 で貫通）
  const yTop = (hi[1] - ctr[1]) * sc, yBot = (lo[1] - ctr[1]) * sc, hd = P.holeDepth ?? 1;

  return {
    segs, tris, balls, e,
    rcf: P.profile > 0 ? 1 - 0.85 * P.profile : 1,
    k: P.fillet * R * sc,
    hole: P.hole > 0 ? { c: sh([0, 0, 0]), r: P.hole * halfXZ, yb: hd >= 1 ? -Infinity : yTop - hd * (yTop - yBot) } : null,
    colliders: col,
  };
}
