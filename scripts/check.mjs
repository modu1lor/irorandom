// Builds every recipe and a batch of random shapes, and prints their measurements.
// Run: node scripts/check.mjs
import { readFileSync } from 'node:fs';
import { generate, random, measure } from '../index.js';

const { recipes } = JSON.parse(readFileSync(new URL('../recipes/recipes.json', import.meta.url)));
let bad = 0;
for (const r of recipes) {
  const t0 = performance.now(), m = measure(generate(r.params));
  const ms = Math.round(performance.now() - t0);
  if (m.parts !== 1) bad++;
  console.log(`${r.id.padEnd(16)} size ${m.size.map((v) => v.toFixed(2)).join(' × ')}  holes ${String(m.holes).padStart(3)}  closed ${m.closed}  ${ms} ms`);
}
let open = 0;
for (let s = 1; s <= 50; s++) { const m = measure(generate(random(s))); if (m.parts !== 1) bad++; if (!m.closed) open++; }
console.log(`random 50: ${open} not fully closed, ${bad} with more than one part`);
process.exitCode = bad ? 1 : 0;
