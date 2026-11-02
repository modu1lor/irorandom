// Public entry point.
// generate(params) turns a handful of parameters into a finished, closed triangle mesh in one call:
// skeleton → flesh → lattice → noise, evaluated as a signed distance field and meshed with Surface Nets.
// No dependencies. Works in browsers, Node.js, Deno and Web Workers.

import { generate as buildPrimitives } from './src/skeleton.js';
import { buildField } from './src/sdf.js';
import { polygonize, keepLargestPart } from './src/mesh.js';
import { simplifyColliders, pruneColliders } from './src/colliders.js';
import { SCHEMA, DEFAULTS, PALETTE, randomParams } from './src/params.js';
import { mulberry32 } from './src/rng.js';

export { SCHEMA, DEFAULTS, PALETTE };

/**
 * Build a mesh from parameters. Missing parameters take their defaults (see spec/parameters.json).
 * @param {object} params
 * @param {{ resolution?: number, colliders?: boolean }} [options]
 *   resolution: voxels along the longest side (56 is quick, 104 is fine detail).
 *   colliders: also return a simplified set of capsules/triangles for physics engines.
 * @returns {{ positions: Float32Array, normals: Float32Array, colors: Float32Array, indices: Uint16Array|Uint32Array,
 *            color: string, params: object, colliders?: object }}
 *   positions are in scene units, centred on the origin, Y up; the longest side equals params.size.
 *   colors hold baked ambient occlusion (grey levels); color is the palette colour (hex).
 */
export function generate(params = {}, { resolution = 56, colliders = false } = {}) {
  const P = { ...DEFAULTS, ...params };
  const prim = buildPrimitives(P);
  // Pieces cut loose by holes or thinning are dropped, so the result is always one connected part
  const { m, near } = keepLargestPart(polygonize(buildField(prim), resolution));
  const out = { ...m, color: PALETTE[P.color]?.[1] ?? PALETTE[0][1], params: P };
  if (colliders) {
    const col = simplifyColliders(prim.colliders);
    out.colliders = near ? pruneColliders(col, near) : col;
  }
  return out;
}

/** Random parameters from an integer seed (the same seed always gives the same parameters). */
export function random(seed = (Math.random() * 2 ** 31) | 0) {
  return randomParams(mulberry32(seed));
}

/**
 * Measure a mesh: outer size, volume, connected parts, whether it is closed, and the number of
 * through-holes (genus: a ring has 1, a lattice cube many). Useful to check a result without looking at it.
 */
export function measure(mesh) {
  const P = mesh.positions, I = mesh.indices, nv = P.length / 3, nt = I.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i * 3 + a]); hi[a] = Math.max(hi[a], P[i * 3 + a]); }
  let vol = 0;
  const edges = new Map();
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [a, b, c].flatMap((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * nv + v : v * nv + u; edges.set(k, (edges.get(k) || 0) + 1); }
    parent[find(a)] = find(b); parent[find(a)] = find(c);
  }
  const roots = new Set();
  for (let t = 0; t < I.length; t++) roots.add(find(I[t]));
  let open = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
  const chi = new Set(I).size - edges.size + nt;
  return {
    size: hi.map((h, a) => h - lo[a]), // [x, y, z]
    volume: Math.abs(vol),
    parts: roots.size,
    closed: open === 0, // no boundary edges (watertight)
    nonManifoldEdges: nonManifold, // edges where two thin parts touch; slicers repair these automatically
    holes: Math.round((2 * roots.size - chi) / 2),
    triangles: nt,
  };
}

// Orient for printing or export: lay the thinnest axis vertical, sit on the floor, centre, and scale the
// longest side to `size`. zUp turns Y-up into Z-up (what most slicers and CAD tools expect).
function placed(mesh, size, zUp) {
  const P = mesh.positions, nv = P.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i * 3 + a]); hi[a] = Math.max(hi[a], P[i * 3 + a]); }
  const ext = hi.map((h, a) => h - lo[a]);
  const k = size / Math.max(...ext);
  const out = new Float32Array(P.length);
  for (let i = 0; i < nv; i++) {
    const x = (P[i * 3] - (lo[0] + hi[0]) / 2) * k, y = (P[i * 3 + 1] - lo[1]) * k, z = (P[i * 3 + 2] - (lo[2] + hi[2]) / 2) * k;
    if (zUp) { out[i * 3] = x; out[i * 3 + 1] = -z; out[i * 3 + 2] = y; } else { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; }
  }
  return out;
}

/** Binary STL (ArrayBuffer). Longest side = size (default 60, i.e. 60 mm in most slicers), Z up, standing on z = 0. */
export function toSTL(mesh, { size = 60 } = {}) {
  const P = placed(mesh, size, true), I = mesh.indices, nt = I.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++) {
    const o = 84 + t * 50, v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = v[1].map((x, a) => x - v[0][a]), e2 = v[2].map((x, a) => x - v[0][a]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    n.forEach((x, a) => dv.setFloat32(o + a * 4, x / l, true));
    v.forEach((p, j) => p.forEach((x, a) => dv.setFloat32(o + 12 + j * 12 + a * 4, x, true)));
  }
  return buf;
}

/** Wavefront OBJ text with normals. Longest side = size (default 1), Y up, standing on y = 0. */
export function toOBJ(mesh, { size = 1 } = {}) {
  const P = placed(mesh, size, false), N = mesh.normals, I = mesh.indices, lines = [];
  for (let i = 0; i < P.length; i += 3) lines.push(`v ${P[i].toFixed(5)} ${P[i + 1].toFixed(5)} ${P[i + 2].toFixed(5)}`);
  for (let i = 0; i < N.length; i += 3) lines.push(`vn ${N[i].toFixed(4)} ${N[i + 1].toFixed(4)} ${N[i + 2].toFixed(4)}`);
  for (let t = 0; t < I.length; t += 3) { const [a, b, c] = [I[t] + 1, I[t + 1] + 1, I[t + 2] + 1]; lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`); }
  return lines.join('\n') + '\n';
}
