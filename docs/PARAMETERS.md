# Parameters

Generated from `src/params.js` by `scripts/build-spec.mjs`. Machine-readable version: [`spec/parameters.json`](../spec/parameters.json).

Parameters for generate(). Every combination yields one connected, closed mesh (occasionally with a few non-manifold edges where thin parts touch; slicers repair these). Unspecified parameters take their defaults.

Scene units, Y up, centred on the origin. The longest outer side equals size. toSTL rescales (default longest side 60 mm, Z up).

## skeleton

The core lines or points the shape is built on.

| key | range / options | default | what it does |
|---|---|---|---|
| `base` | `blob`, `line`, `arc`, `helix`, `loop`, `prism`, `pyramid`, `bipyramid`, `star` | `"prism"` | Skeleton type. Decides what the other parameters act on.<br>**blob** — Points (1–4, see count) with round flesh: a soft lump or cluster of lumps.<br>**line** — One straight bar along X.<br>**arc** — Part of a circle; arc sets the opening angle in degrees.<br>**helix** — A coil spring. Turns = arc / 110 (330 gives 3 turns). height sets the pitch.<br>**loop** — One closed horizontal ring or polygon (sides). Flat: height has no effect.<br>**prism** — Two horizontal polygons (sides) joined by vertical posts. Box, cylinder (bulge 1), tray, cage.<br>**pyramid** — A horizontal polygon whose corners meet at one apex above.<br>**bipyramid** — Apexes above and below a horizontal polygon (an abacus bead / octahedron with sides 4).<br>**star** — Arms radiating from the centre (sides = number of arms). height ≥ 0.45 adds arms up and down. |
| `sides` | 3 – 8 | `4` | Polygon sides, or number of arms for star. 3 = triangle … 8 = octagon. *(applies when `!['line', 'arc', 'helix'].includes(base)`)* |
| `count` | 1 – 4 | `1` | Number of points for blob (1–4). *(applies when `base === 'blob'`)* |
| `bulge` | -0.8 – 1 | `0` | Bends the horizontal polygon edges: negative curves them inward (star-like), positive outward, 1 = circle. Only horizontal polygon edges bend; vertical posts and slanted edges stay straight (a bipyramid never becomes a sphere). *(applies when `FACED.includes(base)`)* |
| `arc` | 60 – 330 | `200` | arc: opening angle in degrees. helix: number of turns = value / 110. *(applies when `['arc', 'helix'].includes(base)`)* |
| `size` | 0.5 – 1.2 | `0.9` | Overall size. The whole shape is scaled so that its longest outer side equals this value. |
| `height` | 0.1 – 1.6 | `0.8` | Height ratio; small = flat, large = tall. The effect depends on base (outer height ÷ width, approx.): prism/pyramid/bipyramid ≈ value × 0.5 (so 1.6 → 0.8, never a full cube); helix ≈ value × 1.6; star and blob ≈ value (star is flat below 0.45); no effect on loop, line, arc. |
| `depth` | 0.3 – 1 | `1` | Depth ratio: squashes the shape front-to-back (Z) only. 1 = unchanged; smaller = flatter (circle ring → ellipse, square → rectangle). Flesh thickness is kept. |

## flesh

The material wrapped around the skeleton: thickness, cross-section, joints, membranes, holes.

| key | range / options | default | what it does |
|---|---|---|---|
| `radius` | 0.02 – 0.3 | `0.07` | Flesh thickness around the skeleton lines: small = thin wire, large = chunky. |
| `profile` | 0 – 1 | `0` | Cross-section of the flesh: 0 = round, 1 = square. |
| `taper` | -1 – 1 | `0` | How thickness varies along each line: negative = thick in the middle (spindle), positive = thick at the ends/joints. A line with taper 1 makes a dumbbell. |
| `fillet` | 0 – 2 | `0.8` | Rounding where lines meet: 0 = sharp joints, 2 = smoothly melted together. |
| `membrane` | 0 – 1 | `0` | Fraction of polygon faces covered by a thin plate (0 = wire only, 1 = all faces). Below 1, which faces get a plate is random (depends on seed) unless membraneFaces is set. *(applies when `FACED.includes(base)`)* |
| `membraneFaces` | `0` random, `1` sides only, `2` open top, `3` top and bottom only | `0` | Which faces get plates (membrane must be > 0). 0 random (by fraction); 1 sides only (prism → open tube, pyramid → open-bottom canopy); 2 all but upward-facing horizontal faces (prism → open-top box / vessel; low height → tray); 3 horizontal faces only (prism → lidded cage). *(applies when `FACED.includes(base) && membrane > 0`)* |
| `membraneTh` | 0.2 – 1 | `0.5` | Plate thickness, relative to flesh thickness. *(applies when `FACED.includes(base) && membrane > 0`)* |
| `hole` | 0 – 0.6 | `0` | A vertical hole bored through the centre (seen from above), as a fraction of the shape width. |
| `holeDepth` | 0.1 – 1 | `1` | How deep the hole goes, measured from the top as a fraction of height. 1 = straight through; smaller leaves a bottom (cup, bowl, planter). Works on solid shapes (blob, thick flesh). *(applies when `hole > 0`)* |

## network

Subdividing faces into lattices, growing struts, thinning.

| key | range / options | default | what it does |
|---|---|---|---|
| `lattice` | 0 – 3 | `0` | Lattice levels: subdivides faces into a mesh of lines. 0 = none. Adds many skeleton points (useful together with struts). |
| `grid` | 1 – 4 | `1` | Density of each lattice level. *(applies when `lattice > 0`)* |
| `struts` | 0 – 1 | `0` | Fraction of skeleton points that grow spikes. Shapes with few points (blob, line) get few spikes; add lattice to get many. |
| `strutLen` | 0.05 – 0.6 | `0.25` | Spike length. *(applies when `struts > 0`)* |
| `knob` | 0 – 2.5 | `0` | Ball on the tip of each spike; 0 = none. *(applies when `struts > 0`)* |
| `drop` | 0 – 0.7 | `0` | Randomly removes this fraction of lines (thinning). Disconnected pieces are dropped automatically. |

## symmetry

How many times the shape repeats around the vertical axis. Noise follows the same symmetry.

| key | range / options | default | what it does |
|---|---|---|---|
| `sym` | `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8` | `4` | Symmetry around the vertical axis: 0 none, 1 mirror, n = n-fold (kaleidoscope-like, also mirrored). Noise obeys it. |

## noise

Hand-made irregularity: bent skeleton lines and lumpy flesh.

| key | range / options | default | what it does |
|---|---|---|---|
| `bend` | 0 – 0.3 | `0` | Bends the skeleton lines (wobble amplitude). |
| `bendFreq` | 0.5 – 4 | `1.5` | Wobble frequency: small = slow large waves, large = fine waves. *(applies when `bend > 0`)* |
| `rnoise` | 0 – 0.8 | `0` | Lumpiness of the flesh along lines. Has little effect on blob balls. |
| `rnoiseFreq` | 1 – 8 | `3` | Lump frequency: small = big lumps, large = fine roughness. *(applies when `rnoise > 0`)* |
| `seed` | 0 – 9999 | `1` | Random seed for every random choice (wobble, lumps, thinning, random membranes). Same seed = same result. |

## finish

Colour and surface finish. These do not change the geometry.

| key | range / options | default | what it does |
|---|---|---|---|
| `surface` | `0` glossy, `1` semi-gloss, `2` standard, `3` matte, `4` grainy | `2` | Surface finish (rendering only): 0 glossy, 1 semi-gloss, 2 standard, 3 matte, 4 grainy. |
| `clarity` | `0` opaque, `1` slightly translucent, `2` translucent, `3` clear | `0` | Transparency (rendering only): 0 opaque, 1 slightly translucent, 2 translucent, 3 clear (refractive). |
| `color` | `0` #cfa77a, `1` #c4553a, `2` #2f5f86, `3` #d9a93a, `4` #4d7a58, `5` #ebe4d6, `6` #3b3936, `7` #9c7fb0 | `0` | Palette colour index (rendering only). |
