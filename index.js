// index.js — WarpCat compositor and frame server (English-only)
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Paths
const ROOT = process.cwd();
const TRAITS_DIR = path.join(ROOT, 'traits');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DATA_DIR = path.join(ROOT, 'data');
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');

// Ensure data directory and minted file exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MINTED_FILE)) fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids: [] }, null, 2));

// Helpers for minted storage
const loadMinted = () => {
  try {
    return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')).fids || [];
  } catch {
    return [];
  }
};
const saveMinted = (fids) => fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids }, null, 2));

// Safe JSON loader
function mustReadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    console.warn('Failed to read JSON:', p);
    return null;
  }
}

// Deterministic PRNG based on seed text (sha256)
function prng(seedText) {
  const hash = crypto.createHash('sha256').update(seedText).digest('hex');
  let i = 0;
  return () => {
    const chunk = hash.slice(i, i + 8);
    i = (i + 8) % hash.length;
    return parseInt(chunk || '0', 16) / 0xffffffff;
  };
}

// Weighted pick helper
function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + (it.weight || 0), 0);
  let r = rng() * (total || 1);
  for (const it of items) {
    r -= (it.weight || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Apply simple rules defined in rules.json
function applyRules(selection, rules) {
  if (!rules) return selection;

  // Conflicts: if a trait triggers denial of others, unset denied choices
  for (const rule of (rules.conflicts || [])) {
    const ifKeys = Object.keys(rule.if || {});
    for (const traitKey of ifKeys) {
      const chosen = selection[traitKey];
      if (!chosen) continue;
      if ((rule.if[traitKey] || []).includes(chosen.id)) {
        for (const denyKey of Object.keys(rule.deny || {})) {
          const denyIds = rule.deny[denyKey] || [];
          if (selection[denyKey] && denyIds.includes(selection[denyKey].id)) {
            selection[denyKey] = null;
          }
        }
      }
    }
  }

  // Requires: if a trait requires a limited body set, enforce it
  for (const req of (rules.requires || [])) {
    const reqKeys = Object.keys(req.if || {});
    for (const reqKey of reqKeys) {
      const chosen = selection[reqKey];
      if (!chosen) continue;
      if ((req.if[reqKey] || []).includes(chosen.id)) {
        const allowBodies = req.allowBody || null;
        if (allowBodies && selection.body && !allowBodies.includes(selection.body.id)) {
          selection.body = null;
        }
      }
    }
  }

  return selection;
}

// Load config, rules, and trait tables
const CONFIG = mustReadJSON(path.join(TRAITS_DIR, 'config.json')) || {
  collectionName: 'WarpCat',
  totalSupply: 10000,
  determinism: { seedFrom: 'fid', hash: 'sha256', salt: 'warpcat_v1' },
  svgCanvas: { width: 1200, height: 1200 },
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

// Choose traits deterministically from fid (or numeric id)
function chooseTraits(fid) {
  const seed = `${fid}|${CONFIG.determinism?.salt || 'warpcat_v1'}`;
  const R = prng(seed);

  const selection = {};
  for (const key of CONFIG.order) {
    const table = TABLES[key] || [];
    if (!table.length) { selection[key] = null; continue; }
    selection[key] = weightedPick(R, table);
  }

  applyRules(selection, RULES);

  // Simple fallback: if something became null due to rules, pick first available
  for (const key of Object.keys(selection)) {
    if (!selection[key]) {
      const table = TABLES[key] || [];
      if (table.length) selection[key] = table[0];
    }
  }

  return selection;
}

// Compose SVG string by concatenating selected SVG layer contents
function composeSVG(fid, selection) {
  const { width, height } = CONFIG.svgCanvas || { width: 1200, height: 1200 };
  const layers = [];

  for (const type of CONFIG.order) {
    const choice = selection[type];
    if (!choice || !choice.svgId) continue;
    const filePath = path.join(ASSETS_DIR, type, `${choice.svgId}.svg`);
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing asset: ${type}/${choice.svgId}.svg`);
      continue;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    // Remove outer svg wrapper to embed safely
    content = content
      .replace(/<\?xml[^>]*>\s*/gi, '')
      .replace(/<!DOCTYPE[^>]*>\s*/gi, '')
      .replace(/<\/?svg[^>]*>/gi, '');
    layers.push(`<g id="${type}-${choice.id}">${content}</g>`);
  }

  const title = `${CONFIG.collectionName} • FID ${fid}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <desc>${title}</desc>
  ${layers.join('\n')}
</svg>`;
}

// Routes

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, base: PUBLIC_BASE_URL }));

// Basic frame landing
app.get('/frame', (_req, res) => {
  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta property="og:title" content="WarpCat Mint"/>
    <meta property="fc:frame" content="vNext"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>WarpCat</title>
  </head>
  <body style="font-family: Arial, sans-serif; text-align:center; padding:40px;">
    <h1>WarpCat</h1>
    <p>Preview and mint your WarpCat.</p>
    <form action="/frame/preview" method="post">
      <label>FID: <input name="untrustedData[fid]" value="1" /></label>
      <button type="submit">Preview</button>
    </form>
  </body>
  </html>
  `;
  res.type('html').send(html);
});

// Frame preview - prepares social/meta tags for frame
app.post('/frame/preview', (req, res) => {
  const fid = (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) || (req.body?.untrustedData?.fid) || 0;
  const minted = loadMinted();
  const already = minted.includes(Number(fid));
  const buttonText = already ? 'Already Minted' : 'Mint';

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/img/preview/${fid}.svg"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="${buttonText}"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/mint"/>
  </head>
  <body>
    <h1>Preview for FID ${fid}</h1>
    <img src="/img/preview/${fid}.svg" alt="WarpCat ${fid}" style="max-width:420px"/>
  </body>
  </html>
  `;
  res.type('html').send(html);
});

// Frame mint endpoint (simple local stub)
app.post('/frame/mint', (req, res) => {
  const fid = (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) || (req.body?.untrustedData?.fid) || 0;
  const minted = loadMinted();
  const already = minted.includes(Number(fid));

  let title, image;
  if (already) {
    title = 'Already Minted';
    image = `${PUBLIC_BASE_URL}/static/already.svg`;
  } else {
    minted.push(Number(fid));
    saveMinted(minted);
    title = 'WarpCat Minted';
    image = `${PUBLIC_BASE_URL}/static/thanks.svg`;
  }

  const html = `
  <!doctype html><html><head>
    <meta property="og:title" content="${title}"/>
    <meta property="og:image" content="${image}"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Back"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame"/>
  </head><body><h1>${title} (FID: ${fid})</h1></body></html>
  `;
  res.type('html').send(html);
});

// Dynamic composed SVG for preview
app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = Number(req.params.fid || 0);
  const selection = chooseTraits(fid);
  const svg = composeSVG(fid, selection);
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

// Static placeholder SVGs
app.get('/static/:which.svg', (req, res) => {
  const which = req.params.which;
  const label = which === 'thanks' ? 'Minted' : which === 'already' ? 'Already Minted' : 'WarpCat';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
    <rect width='100%' height='100%' fill='#1f2937'/>
    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='48' fill='#fff'>${label}</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

// Development helper page
app.get('/dev', (_req, res) => {
  const html = `
  <!doctype html><html><head><meta charset="utf-8"><title>WarpCat Dev</title></head>
  <body style="font-family: Arial; padding:20px;">
    <h2>WarpCat — Compositor Test</h2>
    <form action="/frame/preview" method="post" style="margin-bottom:20px;">
      <label>FID: <input name="untrustedData[fid]" value="12345" /></label>
      <button type="submit">Preview</button>
    </form>
    <p><a href="/img/preview/12345.svg" target="_blank">/img/preview/12345.svg</a></p>
    <p><a href="/frame" target="_blank">/frame</a> — <a href="/health" target="_blank">/health</a></p>
  </body></html>`;
  res.type('html').send(html);
});

// Start server
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
