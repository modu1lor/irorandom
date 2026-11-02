// Writes spec/parameters.json and docs/PARAMETERS.md from src/params.js plus the English notes below.
// The spec is written for both people and language models: what each parameter does, its range,
// when it applies, and how it interacts with others.
// Run: node scripts/build-spec.mjs
import { writeFileSync } from 'node:fs';
import { SCHEMA, DEFAULTS, PALETTE } from '../src/params.js';

const GROUPS = {
  骨格: ['skeleton', 'The core lines or points the shape is built on.'],
  肉: ['flesh', 'The material wrapped around the skeleton: thickness, cross-section, joints, membranes, holes.'],
  ネットワーク: ['network', 'Subdividing faces into lattices, growing struts, thinning.'],
  対称性: ['symmetry', 'How many times the shape repeats around the vertical axis. Noise follows the same symmetry.'],
  ノイズ: ['noise', 'Hand-made irregularity: bent skeleton lines and lumpy flesh.'],
  色と素材: ['finish', 'Colour and surface finish. These do not change the geometry.'],
};

const BASES = {
  blob: 'Points (1–4, see count) with round flesh: a soft lump or cluster of lumps.',
  line: 'One straight bar along X.',
  arc: 'Part of a circle; arc sets the opening angle in degrees.',
  helix: 'A coil spring. Turns = arc / 110 (330 gives 3 turns). height sets the pitch.',
  loop: 'One closed horizontal ring or polygon (sides). Flat: height has no effect.',
  prism: 'Two horizontal polygons (sides) joined by vertical posts. Box, cylinder (bulge 1), tray, cage.',
  pyramid: 'A horizontal polygon whose corners meet at one apex above.',
  bipyramid: 'Apexes above and below a horizontal polygon (an abacus bead / octahedron with sides 4).',
  star: 'Arms radiating from the centre (sides = number of arms). height ≥ 0.45 adds arms up and down.',
};

const NOTES = {
  base: 'Skeleton type. Decides what the other parameters act on.',
  sides: 'Polygon sides, or number of arms for star. 3 = triangle … 8 = octagon.',
  count: 'Number of points for blob (1–4).',
  bulge: 'Bends the horizontal polygon edges: negative curves them inward (star-like), positive outward, 1 = circle. Only horizontal polygon edges bend; vertical posts and slanted edges stay straight (a bipyramid never becomes a sphere).',
  arc: 'arc: opening angle in degrees. helix: number of turns = value / 110.',
  size: 'Overall size. The whole shape is scaled so that its longest outer side equals this value.',
  height: 'Height ratio; small = flat, large = tall. The effect depends on base (outer height ÷ width, approx.): prism/pyramid/bipyramid ≈ value × 0.5 (so 1.6 → 0.8, never a full cube); helix ≈ value × 1.6; star and blob ≈ value (star is flat below 0.45); no effect on loop, line, arc.',
  depth: 'Depth ratio: squashes the shape front-to-back (Z) only. 1 = unchanged; smaller = flatter (circle ring → ellipse, square → rectangle). Flesh thickness is kept.',
  radius: 'Flesh thickness around the skeleton lines: small = thin wire, large = chunky.',
  profile: 'Cross-section of the flesh: 0 = round, 1 = square.',
  taper: 'How thickness varies along each line: negative = thick in the middle (spindle), positive = thick at the ends/joints. A line with taper 1 makes a dumbbell.',
  fillet: 'Rounding where lines meet: 0 = sharp joints, 2 = smoothly melted together.',
  membrane: 'Fraction of polygon faces covered by a thin plate (0 = wire only, 1 = all faces). Below 1, which faces get a plate is random (depends on seed) unless membraneFaces is set.',
  membraneFaces: 'Which faces get plates (membrane must be > 0). 0 random (by fraction); 1 sides only (prism → open tube, pyramid → open-bottom canopy); 2 all but upward-facing horizontal faces (prism → open-top box / vessel; low height → tray); 3 horizontal faces only (prism → lidded cage).',
  membraneTh: 'Plate thickness, relative to flesh thickness.',
  hole: 'A vertical hole bored through the centre (seen from above), as a fraction of the shape width.',
  holeDepth: 'How deep the hole goes, measured from the top as a fraction of height. 1 = straight through; smaller leaves a bottom (cup, bowl, planter). Works on solid shapes (blob, thick flesh).',
  lattice: 'Lattice levels: subdivides faces into a mesh of lines. 0 = none. Adds many skeleton points (useful together with struts).',
  grid: 'Density of each lattice level.',
  struts: 'Fraction of skeleton points that grow spikes. Shapes with few points (blob, line) get few spikes; add lattice to get many.',
  strutLen: 'Spike length.',
  knob: 'Ball on the tip of each spike; 0 = none.',
  drop: 'Randomly removes this fraction of lines (thinning). Disconnected pieces are dropped automatically.',
  sym: 'Symmetry around the vertical axis: 0 none, 1 mirror, n = n-fold (kaleidoscope-like, also mirrored). Noise obeys it.',
  bend: 'Bends the skeleton lines (wobble amplitude).',
  bendFreq: 'Wobble frequency: small = slow large waves, large = fine waves.',
  rnoise: 'Lumpiness of the flesh along lines. Has little effect on blob balls.',
  rnoiseFreq: 'Lump frequency: small = big lumps, large = fine roughness.',
  seed: 'Random seed for every random choice (wobble, lumps, thinning, random membranes). Same seed = same result.',
  surface: 'Surface finish (rendering only): 0 glossy, 1 semi-gloss, 2 standard, 3 matte, 4 grainy.',
  clarity: 'Transparency (rendering only): 0 opaque, 1 slightly translucent, 2 translucent, 3 clear (refractive).',
  color: 'Palette colour index (rendering only).',
};

const OPTION_EN = {
  base: Object.fromEntries(Object.keys(BASES).map((k) => [k, k])),
  membraneFaces: ['random', 'sides only', 'open top', 'top and bottom only'],
  surface: ['glossy', 'semi-gloss', 'standard', 'matte', 'grainy'],
  clarity: ['opaque', 'slightly translucent', 'translucent', 'clear'],
  sym: null,
  color: PALETTE.map(([, hex]) => hex),
};

const params = [];
let group = null;
for (const s of SCHEMA) {
  if (s.group) { group = GROUPS[s.group][0]; continue; }
  const e = { key: s.key, group, default: DEFAULTS[s.key], description: NOTES[s.key] || '' };
  if (s.type === 'select') {
    e.type = 'enum';
    e.options = s.options.map(([v], i) => {
      const names = OPTION_EN[s.key];
      const label = Array.isArray(names) ? names[i] : names ? names[v] : String(v);
      return s.key === 'base' ? { value: v, description: BASES[v] } : { value: v, label };
    });
  } else Object.assign(e, { type: s.step >= 1 ? 'integer' : 'number', min: s.min, max: s.max, step: s.step });
  if (s.show) e.appliesWhen = s.show.toString().replace(/^\(P\) => /, '').replace(/P\./g, '');
  params.push(e);
}

const spec = {
  name: 'parameters',
  about: 'Parameters for generate(). Every combination yields one connected, closed mesh (occasionally with a few non-manifold edges where thin parts touch; slicers repair these). Unspecified parameters take their defaults.',
  units: 'Scene units, Y up, centred on the origin. The longest outer side equals size. toSTL rescales (default longest side 60 mm, Z up).',
  groups: Object.fromEntries(Object.values(GROUPS)),
  parameters: params,
};
writeFileSync(new URL('../spec/parameters.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');

// Markdown version for people
let md = '# Parameters\n\nGenerated from `src/params.js` by `scripts/build-spec.mjs`. Machine-readable version: [`spec/parameters.json`](../spec/parameters.json).\n\n';
md += `${spec.about}\n\n${spec.units}\n`;
for (const [jp, [g, about]] of Object.entries(GROUPS)) {
  md += `\n## ${g}\n\n${about}\n\n| key | range / options | default | what it does |\n|---|---|---|---|\n`;
  for (const p of params.filter((x) => x.group === g)) {
    const range = p.type === 'enum'
      ? p.options.map((o) => `\`${o.value}\`${o.label && o.label !== String(o.value) ? ` ${o.label}` : ''}`).join(', ')
      : `${p.min} – ${p.max}`;
    let what = p.description + (p.appliesWhen ? ` *(applies when \`${p.appliesWhen}\`)*` : '');
    if (p.key === 'base') what += '<br>' + p.options.map((o) => `**${o.value}** — ${o.description}`).join('<br>');
    md += `| \`${p.key}\` | ${range} | \`${JSON.stringify(p.default)}\` | ${what} |\n`;
  }
}
writeFileSync(new URL('../docs/PARAMETERS.md', import.meta.url), md);
console.log(`wrote ${params.length} parameters`);
