// MCP server for irorandom, as a Cloudflare Worker (Streamable HTTP, stateless, no dependencies).
// A language model picks parameters; the server checks them and returns a link that drops the shapes
// into the Irorandom app, where the browser builds and renders them. No mesh is built here, so every
// request stays well inside the Workers free plan's CPU limit.
//
//   POST /mcp   JSON-RPC 2.0 (initialize, tools/list, tools/call, ping)
//   GET  /      a short plain-text description

import { SCHEMA, DEFAULTS, randomParams } from '../src/params.js';
import { mulberry32 } from '../src/rng.js';
import spec from '../spec/parameters.json' with { type: 'json' };
import recipes from '../recipes/recipes.json' with { type: 'json' };

const APP = 'https://irorandom.irosawa.com/';
const SERVER = { name: 'irorandom', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_SHAPES = 4; // the app opens at most 4 shapes from one link (they arrive sealed in one blister)

// ---- share-link codec (must match the app: version 5) ----------------------------------------
// One byte for the version, then 2 bytes per parameter in a fixed order. Enums store the option index;
// numbers store (value − min) in units of step/100 (or step, when the range would not fit in 16 bits).
const V1_KEYS = ['base', 'sides', 'count', 'bulge', 'arc', 'size', 'height', 'radius', 'profile', 'taper', 'fillet', 'membrane', 'membraneTh',
  'lattice', 'grid', 'struts', 'strutLen', 'knob', 'drop', 'sym', 'bend', 'bendFreq', 'rnoise', 'rnoiseFreq', 'seed', 'hole', 'color'];
const SHARE_KEYS = [...V1_KEYS.flatMap((k) => (k === 'hole' ? [k, 'surface', 'clarity'] : [k])), 'depth', 'membraneFaces', 'holeDepth'];
const FIELDS = Object.fromEntries(SCHEMA.filter((s) => s.key).map((s) => [s.key, s]));
const unit = (s) => ((s.max - s.min) / (s.step / 100) <= 65535 ? s.step / 100 : s.step);

function encode(P) {
  const bytes = [5];
  for (const s of SHARE_KEYS.map((k) => FIELDS[k])) {
    const v = P[s.key] ?? s.def;
    const n = s.type === 'select' ? Math.max(0, s.options.findIndex(([o]) => o === v))
      : Math.round((Math.min(s.max, Math.max(s.min, v)) - s.min) / unit(s));
    bytes.push(n >> 8, n & 255);
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(code) {
  const b = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  if (b.charCodeAt(0) !== 5 || b.length !== 1 + SHARE_KEYS.length * 2) throw new Error('not a version-5 shape code (links made before 2026-11 are not supported here)');
  const P = { ...DEFAULTS };
  SHARE_KEYS.forEach((k, i) => {
    const s = FIELDS[k], n = (b.charCodeAt(1 + i * 2) << 8) | b.charCodeAt(2 + i * 2);
    P[k] = s.type === 'select' ? (s.options[n] || s.options[0])[0] : Math.min(s.max, Math.round((s.min + n * unit(s)) * 1e6) / 1e6);
  });
  return P;
}

const linkFor = (list) => `${APP}#o=${list.map(encode).join('.')}`;

// ---- parameter checking --------------------------------------------------------------------
// Fills defaults, clamps numbers into range and reports anything that was changed or ignored,
// so the model can see what will actually be built.
function normalize(input, i) {
  const P = { ...DEFAULTS }, notes = [];
  const tag = (m) => notes.push(`shape ${i + 1}: ${m}`);
  for (const [k, v] of Object.entries(input || {})) {
    const s = FIELDS[k];
    if (!s) { tag(`unknown parameter "${k}" ignored`); continue; }
    if (s.type === 'select') {
      const opt = s.options.find(([o]) => o === v || String(o) === String(v));
      if (opt) P[k] = opt[0];
      else tag(`${k}: ${JSON.stringify(v)} is not an option (${s.options.map(([o]) => o).join(', ')}); default ${JSON.stringify(s.def)} used`);
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) { tag(`${k}: ${JSON.stringify(v)} is not a number; default ${s.def} used`); continue; }
    const c = Math.min(s.max, Math.max(s.min, n));
    if (c !== n) tag(`${k}: ${n} clamped to ${c} (range ${s.min}–${s.max})`);
    P[k] = s.step >= 1 ? Math.round(c) : c;
  }
  return { P, notes };
}

// ---- tools -----------------------------------------------------------------------------------
const shapeSchema = {
  type: 'object',
  description: 'Shape parameters (see get_guide). Unspecified keys use their defaults.',
  additionalProperties: true,
};

const TOOLS = [
  {
    name: 'get_guide',
    title: 'Parameter guide',
    description: 'Returns the full parameter spec (every parameter with range, default, effect and when it applies) and worked recipes for common goals. Call this first, before make_shapes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'make_shapes',
    title: 'Make shapes',
    description: `Checks 1–${MAX_SHAPES} parameter sets and returns a link that opens them in the Irorandom app (iPhone/browser), where they fall into a toy box sealed in one blister pack and can be rotated, stacked, saved as transparent PNG, viewed in AR or exported as STL. Returns the parameters as they will be built and notes on anything clamped or ignored. The shapes are not rendered here: share the link with the user.`,
    inputSchema: {
      type: 'object',
      properties: { shapes: { type: 'array', minItems: 1, maxItems: MAX_SHAPES, items: shapeSchema } },
      required: ['shapes'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'random_shapes',
    title: 'Random shapes',
    description: `Draws 1–${MAX_SHAPES} random parameter sets (the same seed always gives the same shapes) and returns them with an app link. Good for inspiration, or as a starting point to adjust.`,
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: MAX_SHAPES, default: 1 },
        seed: { type: 'integer', description: 'Optional. Omit for a fresh random draw.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_link',
    title: 'Read an app link',
    description: 'Decodes an Irorandom share link (…#o=…) back into parameter sets, so shapes made in the app can be explained or adjusted and sent back with make_shapes.',
    inputSchema: {
      type: 'object',
      properties: { link: { type: 'string', description: 'A link like https://irorandom.irosawa.com/#o=BQ…' } },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const text = (obj, isError = false) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }], isError });

// Only the keys that differ from the defaults (DEFAULTS in get_guide), to keep replies short
const changed = (P) => Object.fromEntries(Object.entries(P).filter(([k, v]) => DEFAULTS[k] !== v));

function callTool(name, args = {}) {
  if (name === 'get_guide') {
    return text({
      howTo: 'Pick base by topology, set proportions (size, height, depth), material (radius, profile, fillet, taper), then structure or irregularity (lattice, struts, hole, bend, rnoise, sym). Colour (color), surface and clarity only change the look. Start from the closest recipe. Up to 4 shapes per link.',
      parameters: spec,
      recipes,
    });
  }
  if (name === 'make_shapes') {
    const shapes = Array.isArray(args.shapes) ? args.shapes : [];
    if (!shapes.length) return text('shapes must be a non-empty array of parameter objects', true);
    const notes = shapes.length > MAX_SHAPES ? [`only the first ${MAX_SHAPES} shapes were used`] : [];
    const list = shapes.slice(0, MAX_SHAPES).map((s, i) => { const r = normalize(s, i); notes.push(...r.notes); return r.P; });
    return text({ link: linkFor(list), changedFromDefaults: list.map(changed), notes });
  }
  if (name === 'random_shapes') {
    const count = Math.min(MAX_SHAPES, Math.max(1, Math.round(Number(args.count) || 1)));
    const seed = Number.isInteger(args.seed) ? args.seed : (Math.random() * 2 ** 31) | 0;
    const rng = mulberry32(seed);
    const list = Array.from({ length: count }, () => randomParams(rng));
    return text({ seed, link: linkFor(list), changedFromDefaults: list.map(changed) });
  }
  if (name === 'read_link') {
    const m = String(args.link || '').match(/#o=([\w.-]+)/);
    if (!m) return text('no #o= part found in the link', true);
    try {
      return text({ changedFromDefaults: m[1].split('.').slice(0, MAX_SHAPES).map((c) => changed(decode(c))) });
    } catch (e) {
      return text(String(e.message || e), true);
    }
  }
  return null;
}

// ---- JSON-RPC over Streamable HTTP ---------------------------------------------------------------
const INSTRUCTIONS = 'irorandom makes small procedural 3D objects from ~30 parameters (skeleton → flesh → lattice → noise). Call get_guide once, then make_shapes with 1–4 parameter sets and give the user the returned link: it opens the shapes in the Irorandom app. Shapes are toys, not precise models.';

function handle(msg) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid Request');
  if (id === undefined) return null; // notification (e.g. notifications/initialized): no reply
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const r = callTool(params?.name, params?.arguments);
      return r ? ok(r) : err(-32602, `Unknown tool: ${params?.name}`);
    }
    default: return err(-32601, `Method not found: ${method}`);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
};
const reply = (body, status = 200, type = 'application/json') =>
  new Response(body === null ? null : type === 'application/json' ? JSON.stringify(body) : body, { status, headers: { ...CORS, ...(body === null ? {} : { 'Content-Type': type }) } });

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204);
    if (pathname === '/') {
      return reply(`irorandom MCP server\n\nEndpoint: POST ${new URL('/mcp', request.url)} (Streamable HTTP, no auth)\nTools: ${TOOLS.map((t) => t.name).join(', ')}\nApp: ${APP}\nSource: https://github.com/modu1lor/irorandom\n`, 200, 'text/plain; charset=utf-8');
    }
    if (pathname !== '/mcp') return reply('Not found', 404, 'text/plain');
    // No server-initiated stream and no sessions: GET and DELETE are not offered
    if (request.method !== 'POST') return reply({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } }, 405);
    let body;
    try { body = await request.json(); } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
    if (Array.isArray(body)) {
      const out = body.map(handle).filter(Boolean);
      return out.length ? reply(out) : reply(null, 202);
    }
    const out = handle(body);
    return out ? reply(out) : reply(null, 202);
  },
};

// Exposed for tests
export { encode, decode, normalize };
