// Write a recipe (or a random shape) to an STL file.
// Run: node examples/stl.mjs vase      → out/vase.stl
//      node examples/stl.mjs 1234      → out/random-1234.stl
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generate, random, measure, toSTL } from '../index.js';

const arg = process.argv[2] || 'vase';
const { recipes } = JSON.parse(readFileSync(new URL('../recipes/recipes.json', import.meta.url)));
const recipe = recipes.find((r) => r.id === arg);
const params = recipe ? recipe.params : random(Number(arg) || 1);
const mesh = generate(params, { resolution: 104 }); // finer mesh for printing
mkdirSync('out', { recursive: true });
const file = `out/${recipe ? arg : `random-${arg}`}.stl`;
writeFileSync(file, Buffer.from(toSTL(mesh, { size: 60 })));
console.log(file, measure(mesh));
