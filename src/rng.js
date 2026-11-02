// 乱数とノイズ。形はすべて seed から決定的に決まる。

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 座標を量子化してハッシュし [0,1) を返す。対称な位置どうしは同じ値になる。
export function hash3(x, y, z, seed) {
  let h = seed | 0;
  for (const v of [x, y, z]) {
    h = Math.imul(h ^ Math.round(v * 1000), 0x9e3779b1);
    h ^= h >>> 15;
  }
  h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// 3次元バリューノイズ。戻り値はおおよそ [-1, 1]。
export function makeNoise3(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rnd() * 2 - 1;
  const v = (x, y, z) => vals[perm[(x & 255) + perm[(y & 255) + perm[z & 255]]]];
  const s = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  return function (x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
    const a = lerp(lerp(v(xi, yi, zi), v(xi + 1, yi, zi), fx), lerp(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), fx), fy);
    const b = lerp(lerp(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), fx), lerp(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), fx), fy);
    return lerp(a, b, fz);
  };
}

// 2オクターブの fbm
export function makeFbm3(seed) {
  const n1 = makeNoise3(seed), n2 = makeNoise3(seed + 101);
  return (x, y, z) => (n1(x, y, z) + 0.5 * n2(x * 2.03 + 5.1, y * 2.03 - 3.7, z * 2.03 + 1.3)) / 1.5;
}
