// index.js — WarpCat Frames backend (final, English-only)
// Features:
// - Frames flow: /frame -> /frame/preview (POST) -> /frame/mint
// - Human-friendly browser preview: GET /frame/preview?fid=12345
// - Deterministic compositor from traits tables (traits/*.json + assets/*/*.svg)
// - Safe fallbacks if an asset is missing (no white screen)
// - One-mint-per-FID memory (data/minted.json)
// - Basic rate-limit for abuse protection
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);

// ───────────────────────────────────────────────────────────────────────────────
// Paths & storage
const ROOT = process.cwd();
const TRAITS_DIR = path.join(ROOT, 'traits');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DATA_DIR   = path.join(ROOT, 'data');
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MINTED_FILE)) fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids: [] }, null, 2));

const loadMinted = () => {
  try { return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')).fids || []; }
  catch { return []; }
};
const saveMinted = (fids) => fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids }, null, 2));

// ───────────────────────────────────────────────────────────────────────────────
// Utils
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function mustReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}
function prng(seedText) {
  const hash = crypto.createHash('sha256').update(seedText).digest('hex');
  let i = 0;
  return () => {
    const chunk = hash.slice(i, i + 8);
    i = (i + 8) % hash.length;
    return parseInt(chunk || '0', 16) / 0xffffffff;
  };
}
function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + (it.weight || 0), 0) || 1;
  let r = rng() * total;
  for (const it of items) { r -= (it.weight || 0); if (r <= 0) return it; }
  return items[items.length - 1];
}

// ───────────────────────────────────────────────────────────────────────────────
// Config + rules + tables
const CONFIG = mustReadJSON(path.join(TRAITS_DIR, 'config.json')) || {
  collectionName: 'WarpCat',
  totalSupply: 10000,
  svgCanvas: { width: 1200, height: 1200 },
  determinism: { seedFrom: 'fid', hash: 'sha256', salt: 'warpcat_v1' },
  order: ['background','aura','body','eyes','mouth','headgear','accessory','expression']
};
const RULES = mustReadJSON(path.join(TRAITS_DIR, 'rules.json')) || { conflicts: [], requires: [] };
const TABLES = {
  background: mustReadJSON(path.join(TRAITS_DIR, 'background.json')) || [],
  body:       mustReadJSON(path.join(TRAITS_DIR, 'body.json')) || [],
  eyes:       mustReadJSON(path.join(TRAITS_DIR, 'eyes.json')) || [],
  mouth:      mustReadJSON(path.join(TRAITS_DIR, 'mouth.json')) || [],
  headgear:   mustReadJSON(path.join(TRAITS_DIR, 'headgear.json')) || [],
  accessory:  mustReadJSON(path.join(TRAITS_DIR, 'accessory.json')) || [],
  aura:       mustReadJSON(path.join(TRAITS_DIR, 'aura.json')) || [],
  expression: mustReadJSON(path.join(TRAITS_DIR, 'expression.json')) || []
};

// Apply simple rules if present
function applyRules(sel) {
  const rules = RULES || {};
  for (const r of (rules.conflicts || [])) {
    for (const k of Object.keys(r.if || {})) {
      const chosen = sel[k];
      if (!chosen) continue;
      if ((r.if[k] || []).includes(chosen.id)) {
        for (const dk of Object.keys(r.deny || {})) {
          const denyIds = r.deny[dk] || [];
          if (sel[dk] && denyIds.includes(sel[dk].id)) sel[dk] = null;
        }
      }
    }
  }
  for (const rq of (rules.requires || [])) {
    for (const k of Object.keys(rq.if || {})) {
      const chosen = sel[k];
      if (!chosen) continue;
      if ((rq.if[k] || []).includes(chosen.id)) {
        const allowBodies = rq.allowBody || null;
        if (allowBodies && sel.body && !allowBodies.includes(sel.body.id)) sel.body = null;
      }
    }
  }
  // Ensure non-null by falling back to the first available entry for any null slot
  for (const key of Object.keys(sel)) {
    if (!sel[key]) {
      const table = TABLES[key] || [];
      if (table.length) sel[key] = table[0];
    }
  }
  return sel;
}

function chooseTraits(fid) {
  const seed = `${fid}|${CONFIG.determinism?.salt || 'warpcat_v1'}`;
  const R = prng(seed);
  const sel = {};
  for (const key of CONFIG.order) {
    const table = TABLES[key] || [];
    sel[key] = table.length ? weightedPick(R, table) : null;
  }
  return applyRules(sel);
}

// Compose SVG with safe fallbacks if asset files are missing
function composeSVG(fid, selection) {
  const { width, height } = CONFIG.svgCanvas || { width: 1200, height: 1200 };

  // Fallback map (must match actual files in assets/*/*.svg)
  const FALLBACK = {
    background: 'neon_purple',
    aura: 'none',
    body: 'feline',
    eyes: 'sharp',
    mouth: 'smirk',
    headgear: 'cap',
    accessory: 'none',
    expression: 'chill'
  };

  const layers = [];
  for (const type of CONFIG.order) {
    const choice = selection[type];
    if (!choice) continue;

    // Try the chosen svgId
    let svgId = choice.svgId;
    let filePath = path.join(ASSETS_DIR, type, `${svgId}.svg`);

    // If missing, try fallback for that layer type
    if (!fs.existsSync(filePath)) {
      const fb = FALLBACK[type];
      if (fb) {
        console.warn(`Missing asset: ${type}/${svgId}.svg → fallback ${fb}.svg`);
        svgId = fb;
        filePath = path.join(ASSETS_DIR, type, `${svgId}.svg`);
      }
    }

    // If still missing, skip that layer gracefully
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing asset (no fallback available): ${type}/${choice.svgId}.svg`);
      continue;
    }

    // Read and strip outer <svg> wrapper to nest safely
    let content = fs.readFileSync(filePath, 'utf8')
      .replace(/<\?xml[^>]*>\s*/gi, '')
      .replace(/<!DOCTYPE[^>]*>\s*/gi, '')
      .replace(/<\/?svg[^>]*>/gi, '');

    layers.push(`<g id="${type}-${svgId}">${content}</g>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${layers.join('\n')}
</svg>`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Simple in-memory rate limit
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'ip';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 15_000); // 15s window
  if (arr.length > 5) return res.status(429).send('Too Many Requests');
  arr.push(now); hits.set(ip, arr); next();
}

// ───────────────────────────────────────────────────────────────────────────────
// Routes
app.get('/health', (_req, res) => res.json({ ok: true, base: PUBLIC_BASE_URL }));

// Human-friendly browser preview (use this in a normal browser)
app.get('/frame/preview', (req, res) => {
  const fid = Number(req.query.fid || 12345);
  const img = `${PUBLIC_BASE_URL}/img/preview/${fid}.svg`;
  res.type('html').send(`
    <!doctype html><html><head><meta charset="utf-8"><title>WarpCat Preview</title>
    <style>body{font-family:Inter,Arial;margin:32px}input{padding:8px}button{padding:8px 12px;margin-left:8px}</style>
    </head><body>
      <h2>WarpCat — Browser Preview</h2>
      <form action="/frame/preview" method="get">
        <label>FID: <input name="fid" value="${fid}" /></label>
        <button type="submit">Show</button>
        <a href="/img/preview/${fid}.svg" target="_blank">Open SVG</a>
      </form>
      <div style="margin-top:20px"><img src="${img}" style="max-width:100%;height:auto;border:1px solid #eee"/></div>
    </body></html>
  `);
});

// Basic landing for Frames
app.get('/frame', (_req, res) => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta property="og:title" content="WarpCat Frame"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>WarpCat</title>
  </head>
  <body style="font-family:Inter,Arial; text-align:center; padding:40px;">
    <h1>WarpCat Frame</h1>
    <p>Open this in your Farcaster client or use <a href="/frame/preview?fid=12345" target="_blank">browser preview</a>.</p>
    <form action="/frame/preview" method="post" style="margin-top:24px;">
      <label>FID: <input name="untrustedData[fid]" value="12345"/></label>
      <button type="submit">Preview</button>
    </form>
  </body></html>`;
  res.type('html').send(html);
});

// Frame: preview (for Farcaster; returns meta tags only)
app.post('/frame/preview', rateLimit, (req, res) => {
  const fid = Number(req.body?.['untrustedData[fid]'] ?? req.body?.fid ?? 0);
  const minted = loadMinted();
  const already = minted.includes(fid);
  const button = already ? 'Already Minted' : 'Mint';
  const img = `${PUBLIC_BASE_URL}/img/preview/${fid}.svg`;
  const postUrl = already ? `${PUBLIC_BASE_URL}/frame/already` : `${PUBLIC_BASE_URL}/frame/mint`;

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:image" content="${img}"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="${button}"/>
    <meta property="fc:frame:post_url" content="${postUrl}"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// Frame: mint (single per FID)
app.post('/frame/mint', rateLimit, (req, res) => {
  const fid = Number(req.body?.['untrustedData[fid]'] ?? req.body?.fid ?? 0);
  const minted = loadMinted();
  if (!minted.includes(fid)) {
    minted.push(fid);
    saveMinted(minted);
  }
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="WarpCat Minted"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/static/thanks.svg"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="View"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/view"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// Frame: already minted
app.post('/frame/already', (_req, res) => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Already Minted"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/static/already.svg"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Back"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// Frame: view screen (shows user’s composed image)
app.post('/frame/view', (req, res) => {
  const fid = Number(req.body?.['untrustedData[fid]'] ?? req.body?.fid ?? 0);
  const img = `${PUBLIC_BASE_URL}/img/preview/${fid}.svg`;
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Your WarpCat"/>
    <meta property="og:image" content="${img}"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Back"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// Dynamic composed SVG (always returns an SVG even if some assets are missing)
app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = Number(req.params.fid || 0);
  const svg = composeSVG(fid, chooseTraits(fid));
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

// Simple metadata endpoint (future on-chain use)
app.get('/metadata/:fid', (req, res) => {
  const fid = Number(req.params.fid || 0);
  const traits = chooseTraits(fid);
  const image = `${PUBLIC_BASE_URL}/img/preview/${fid}.svg`;
  const attrs = Object.entries(traits).map(([k, v]) => ({ trait_type: k, value: v?.id || 'none' }));
  res.json({
    name: `WarpCat #${fid}`,
    description: 'WarpCat — generated from your Farcaster identity.',
    image,
    external_url: `${PUBLIC_BASE_URL}/frame`,
    attributes: attrs
  });
});

// Static placeholders
app.get('/static/:which.svg', (req, res) => {
  const which = req.params.which;
  const label = which === 'thanks' ? 'Minted' : which === 'already' ? 'Already Minted' : 'WarpCat';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
    <rect width='100%' height='100%' fill='#111827'/>
    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='48' fill='#fff'>${label}</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

// Dev helper
app.get('/dev', (_req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>WarpCat Dev</title></head>
  <body style="font-family: Arial; padding:20px;">
    <h2>WarpCat — Compositor Test</h2>
    <p><a href="/img/preview/12345.svg" target="_blank">/img/preview/12345.svg</a></p>
    <form action="/frame/preview" method="post">
      <label>FID: <input name="untrustedData[fid]" value="12345"/></label>
      <button type="submit">Preview</button>
    </form>
    <p style="margin-top:10px;"><a href="/frame/preview?fid=12345" target="_blank">Browser Preview</a></p>
  </body></html>`;
  res.type('html').send(html);
});

// Start
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
