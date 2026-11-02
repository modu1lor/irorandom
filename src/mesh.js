// 距離場を Surface Nets でメッシュにする。法線は距離場の勾配、
// 隙間の暗さ（AO）も距離場から求めて頂点色に焼き込む。

export function polygonize({ f, bbox }, res) {
  const ext = [0, 1, 2].map((d) => bbox.max[d] - bbox.min[d]);
  const vox = Math.max(...ext) / res;
  const n = ext.map((e) => Math.ceil(e / vox) + 2);
  const o = bbox.min.map((m, d) => m - vox * 0.5 - (n[d] * vox - ext[d] - vox) / 2);
  const [nx, ny, nz] = n;
  const idx = (i, j, k) => (i * ny + j) * nz + k;
  const V = new Float32Array(nx * ny * nz);

  // 粗い格子で先に測り、表面から遠いところは細かく測らない
  const C = 4;
  const cn = n.map((m) => Math.ceil((m - 1) / C) + 1);
  const cv = new Float32Array(cn[0] * cn[1] * cn[2]);
  for (let i = 0; i < cn[0]; i++)
    for (let j = 0; j < cn[1]; j++)
      for (let k = 0; k < cn[2]; k++)
        cv[(i * cn[1] + j) * cn[2] + k] = f(o[0] + i * C * vox, o[1] + j * C * vox, o[2] + k * C * vox);
  // セル内のどの点も、いちばん近い角から半対角線以内にある
  const diag = C * vox * Math.sqrt(3) * 0.5 * 1.25;
  for (let i = 0; i < nx; i++) {
    const ci = Math.min(Math.floor(i / C), cn[0] - 2);
    for (let j = 0; j < ny; j++) {
      const cj = Math.min(Math.floor(j / C), cn[1] - 2);
      for (let k = 0; k < nz; k++) {
        const ck = Math.min(Math.floor(k / C), cn[2] - 2);
        let m = Infinity, sg = 1;
        for (let a = 0; a < 8; a++) {
          const v = cv[((ci + (a & 1)) * cn[1] + cj + ((a >> 1) & 1)) * cn[2] + ck + (a >> 2)];
          if (Math.abs(v) < m) { m = Math.abs(v); sg = Math.sign(v) || 1; }
        }
        V[idx(i, j, k)] = m > diag ? sg * (m - diag) : f(o[0] + i * vox, o[1] + j * vox, o[2] + k * vox);
      }
    }
  }

  // 各セルに頂点を1つ
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => (i * (ny - 1) + j) * (nz - 1) + k;
  const pos = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv8 = new Float32Array(8);
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < ny - 1; j++)
      for (let k = 0; k < nz - 1; k++) {
        let mask = 0;
        for (let a = 0; a < 8; a++) {
          const v = V[idx(i + (a & 1), j + ((a >> 1) & 1), k + (a >> 2))];
          cv8[a] = v;
          if (v < 0) mask |= 1 << a;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, c = 0;
        for (const [a, b] of EDGES) {
          const va = cv8[a], vb = cv8[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
          c++;
        }
        cellV[cidx(i, j, k)] = pos.length / 3;
        pos.push(o[0] + (i + sx / c) * vox, o[1] + (j + sy / c) * vox, o[2] + (k + sz / c) * vox);
      }

  // 符号が変わる格子の辺ごとに四角形
  const ind = [];
  const quad = (a, b, c, d, flip) => {
    if ([a, b, c, d].some((v) => v < 0)) return;
    if (flip) ind.push(a, c, b, a, d, c); else ind.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < ny - 1; j++)
      for (let k = 0; k < nz - 1; k++) {
        const v0 = V[idx(i, j, k)] < 0;
        if (j > 0 && k > 0 && v0 !== (V[idx(i + 1, j, k)] < 0))
          quad(cellV[cidx(i, j - 1, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i, j - 1, k)], !v0);
        if (i > 0 && k > 0 && v0 !== (V[idx(i, j + 1, k)] < 0))
          quad(cellV[cidx(i - 1, j, k - 1)], cellV[cidx(i - 1, j, k)], cellV[cidx(i, j, k)], cellV[cidx(i, j, k - 1)], !v0);
        if (i > 0 && j > 0 && v0 !== (V[idx(i, j, k + 1)] < 0))
          quad(cellV[cidx(i - 1, j - 1, k)], cellV[cidx(i, j - 1, k)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)], !v0);
      }

  // 表面へ寄せ、法線と AO を求める
  const nv = pos.length / 3;
  const P = new Float32Array(pos), N = new Float32Array(nv * 3), Col = new Float32Array(nv * 3);
  const h = vox * 0.5;
  // 四面体の4点で勾配を取る（6点より速い）。値 d も同時に得られる。
  const grad = (x, y, z) => {
    const a = f(x + h, y - h, z - h), b = f(x - h, y - h, z + h), c = f(x - h, y + h, z - h), e = f(x + h, y + h, z + h);
    const gx = a - b - c + e, gy = -a - b + c + e, gz = -a + b - c + e;
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l, (a + b + c + e) / 4];
  };
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const g = grad(x, y, z);
    const d = g[3];
    if (Math.abs(d) < vox) { x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = g[0]; N[v * 3 + 1] = g[1]; N[v * 3 + 2] = g[2];
    let occ = 0, sca = 1;
    for (let s = 1; s <= 4; s++) {
      const hh = 0.01 + 0.025 * s;
      occ += (hh - f(x + g[0] * hh, y + g[1] * hh, z + g[2] * hh)) * sca;
      sca *= 0.7;
    }
    const ao = Math.max(0, Math.min(1, 1 - 2.2 * occ));
    const c = 0.3 + 0.7 * ao;
    Col[v * 3] = Col[v * 3 + 1] = Col[v * 3 + 2] = c;
  }

  // 面の向きを法線とそろえる
  for (let t = 0; t < ind.length; t += 3) {
    const [a, b, c] = [ind[t], ind[t + 1], ind[t + 2]];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const vn = [N[a * 3] + N[b * 3] + N[c * 3], N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]];
    if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] < 0) { ind[t + 1] = c; ind[t + 2] = b; }
  }

  return { positions: P, normals: N, colors: Col, indices: nv > 65535 ? new Uint32Array(ind) : new Uint16Array(ind) };
}

// つながっていない破片を捨てて、いちばん大きなひとかたまりだけを残す（縦穴や間引きで切り離された部分など）。
// 現実なら別々に転がるはずの破片が、見えない糸でつながったように一緒に動くのを避けるため。
// 返す：{ m, near }。near(p, r) は「点 p から r 以内に、残した面の頂点があるか」（当たり判定の後始末に使う）。全部つながっていれば near は null
export function keepLargestPart(m) {
  const { positions: P, normals: N, colors: C, indices: I } = m;
  const nv = P.length / 3, parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < I.length; t += 3) { unite(I[t], I[t + 1]); unite(I[t], I[t + 2]); }
  const tris = new Map();
  for (let t = 0; t < I.length; t += 3) { const r = find(I[t]); tris.set(r, (tris.get(r) || 0) + 1); }
  if (tris.size <= 1) return { m, near: null };
  let best = -1, bn = -1;
  for (const [r, n] of tris) if (n > bn) { bn = n; best = r; }
  // 残すかたまりの頂点だけを詰め直す
  const remap = new Int32Array(nv).fill(-1);
  let k = 0;
  for (let i = 0; i < nv; i++) if (find(i) === best) remap[i] = k++;
  const P2 = new Float32Array(k * 3), N2 = new Float32Array(k * 3), C2 = new Float32Array(k * 3);
  for (let i = 0; i < nv; i++) {
    const j = remap[i];
    if (j < 0) continue;
    for (let d = 0; d < 3; d++) { P2[j * 3 + d] = P[i * 3 + d]; N2[j * 3 + d] = N[i * 3 + d]; C2[j * 3 + d] = C[i * 3 + d]; }
  }
  const ind = [];
  for (let t = 0; t < I.length; t += 3) if (remap[I[t]] >= 0) ind.push(remap[I[t]], remap[I[t + 1]], remap[I[t + 2]]);
  // 残した頂点の、ざっくりした格子（近くに面があるかを速く調べるため）
  const cell = 0.05, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (let j = 0; j < k; j++) {
    const g = key(Math.floor(P2[j * 3] / cell), Math.floor(P2[j * 3 + 1] / cell), Math.floor(P2[j * 3 + 2] / cell));
    if (!grid.has(g)) grid.set(g, []);
    grid.get(g).push(j);
  }
  const near = (p, r) => {
    const s = Math.ceil(r / cell), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell), r2 = r * r;
    for (let x = cx - s; x <= cx + s; x++) for (let y = cy - s; y <= cy + s; y++) for (let z = cz - s; z <= cz + s; z++) {
      const list = grid.get(key(x, y, z));
      if (!list) continue;
      for (const j of list) {
        const dx = P2[j * 3] - p[0], dy = P2[j * 3 + 1] - p[1], dz = P2[j * 3 + 2] - p[2];
        if (dx * dx + dy * dy + dz * dz <= r2) return true;
      }
    }
    return false;
  };
  return { m: { positions: P2, normals: N2, colors: C2, indices: k > 65535 ? new Uint32Array(ind) : new Uint16Array(ind) }, near };
}
