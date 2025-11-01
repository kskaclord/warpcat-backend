// index.js — WarpCat (poster frame)

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ========== CONFIG ========== */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const DATA_DIR    = path.join(__dirname, 'data');
const ASSETS_DIR  = path.join(__dirname, 'assets');
const TRAITS_DIR  = path.join(__dirname, 'traits');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ========== CHAIN / MINT ========== */
const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453';
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '500000000000000'; // 0.0005 ETH
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase(); // e.g. 0x12345678

/* ========== SIMPLE DB ========== */
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
const readMinted  = () => { try { return JSON.parse(fs.readFileSync(MINTED_FILE,'utf8')); } catch { return {}; } };
const writeMinted = (obj) => fs.writeFileSync(MINTED_FILE, JSON.stringify(obj, null, 2));

/* ========== HELPERS ========== */
const toHex = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : '0x'+BigInt(n).toString(16);
const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));

function buildMintData(fid) {
  if (!MINT_SELECTOR || MINT_SELECTOR.length !== 10 || !MINT_SELECTOR.startsWith('0x')) return '0x';
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
}

function pickOne(arr, seed) {
  if (!arr.length) return null;
  return arr[Number(BigInt(seed) % BigInt(arr.length))];
}

function hasAsset(rel) { return fs.existsSync(path.join(ASSETS_DIR, rel)); }
function readAsset(rel) { return fs.readFileSync(path.join(ASSETS_DIR, rel), 'utf8'); }

function ensureAsset(rel, fallbackRel = null) {
  if (hasAsset(rel)) return readAsset(rel);
  if (fallbackRel && hasAsset(fallbackRel)) {
    console.warn(`Missing asset: ${rel} → fallback ${fallbackRel}`);
    return readAsset(fallbackRel);
  }
  console.warn(`Missing asset: ${rel}`);
  return ''; // empty
}

/* ========== SVG LAYERING ========== */
// if body/eyes/mouth/headgear yoksa bozulmasın diye basit fallback kedi
function fallbackCatGroup(fid) {
  return `
    <g transform="translate(100,150)">
      <ellipse cx="500" cy="500" rx="420" ry="360" fill="#332944" stroke="#0b0b0b" stroke-width="18"/>
      <g fill="#1e1926" stroke="#0b0b0b" stroke-width="10">
        <polygon points="240,110 320,300 110,280"/>
        <polygon points="740,110 660,300 870,280"/>
      </g>
      <g>
        <ellipse cx="420" cy="520" rx="95" ry="36" fill="#fff"/>
        <circle cx="420" cy="520" r="10" fill="#111"/>
        <ellipse cx="590" cy="520" rx="95" ry="36" fill="#fff"/>
        <circle cx="590" cy="520" r="10" fill="#111"/>
        <path d="M360 690 q160 60 320 0" stroke="#e6da08" stroke-width="20" fill="none" stroke-linecap="round"/>
      </g>
    </g>
  `;
}

function buildCatFromAssets(fid) {
  const face = ensureAsset('body/cat_base.svg', null);
  const eyes = ensureAsset('eyes/sharp.svg', null);
  const mouth = ensureAsset('mouth/smile.svg', null);
  const head = ensureAsset('headgear/bandana.svg', null);
  const aura = ensureAsset('aura/none.svg', null);
  const accessory = ensureAsset('accessory/none.svg', null);

  const any = face || eyes || mouth || head || aura || accessory;
  if (!any) return fallbackCatGroup(fid);

  return `
    <g class="cat">
      ${face || ''}
      ${aura || ''}
      ${eyes || ''}
      ${mouth || ''}
      ${head || ''}
      ${accessory || ''}
    </g>
  `;
}

function posterBackground(fid) {
  const list = ['background/neon_purple.svg','background/hologrid.svg','background/pink_grad.svg']
    .filter(p => hasAsset(p));
  const picked = pickOne(list, fid) || 'background/neon_purple.svg';
  return ensureAsset(picked, 'background/neon_purple.svg');
}

function buildPosterSvg(fid, title = 'I just minted my WarpCat!', footer = 'Mint Now') {
  // full poster 1200x1200
  const bg = posterBackground(fid);
  const cat = buildCatFromAssets(fid);

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs>
    <style>
      .shadow { filter: drop-shadow(0 8px 30px rgba(0,0,0,.35)); }
      .title  { font: 700 64px/1.2 Inter,ui-sans-serif,Arial; fill:#ffffff; letter-spacing:.5px; }
      .foot   { font: 700 40px/1 Inter,ui-sans-serif,Arial; fill:#fff; }
      .subtle { font: 500 24px/1 Inter,ui-sans-serif,Arial; fill:#ffffffcc; }
    </style>
  </defs>

  <!-- background -->
  <g>${bg}</g>

  <!-- header title -->
  <text x="72" y="120" class="title">${title}</text>
  <text x="72" y="165" class="subtle">WarpCat • FID ${fid}</text>

  <!-- CAT -->
  <g class="shadow" transform="translate(0,60)">
    ${cat}
  </g>

  <!-- footer bar (fake button look) -->
  <g transform="translate(0,1035)">
    <rect x="0" y="0" width="1200" height="165" rx="0" fill="#5b3df6"/>
    <text x="600" y="105" text-anchor="middle" class="foot">${footer}</text>
  </g>
</svg>`.trim();
}

/* ========== RENDERERS ========== */
async function svgToPng(svg) {
  // 1200x1200 -> 1024x1024 (Frames)
  return sharp(Buffer.from(svg)).png().resize(1024,1024,{ fit:'cover' }).toBuffer();
}

/* ========== BROWSER PAGES ========== */
app.get('/frame', (_req, res) => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta property="og:title" content="WarpCat Frame"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>WarpCat Frame</title>
  </head>
  <body style="font-family:Inter,Arial; text-align:center; padding:36px;">
    <h1>WarpCat Frame</h1>
    <p>Open this in your Farcaster client or use <a href="/frame/preview?fid=12345">browser preview</a>.</p>
    <form action="/frame/preview" method="get" style="margin-top:16px;">
      <label>FID: <input name="fid" value="12345" style="padding:4px 8px;"/></label>
      <button type="submit" style="margin-left:8px;">Preview</button>
    </form>
  </body></html>`;
  res.type('html').send(html);
});

app.get('/frame/preview', (req, res) => {
  const fid = String(req.query.fid || '12345');
  const img = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <title>WarpCat — Browser Preview</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
  </head>
  <body style="font-family:Inter,Arial; padding:24px;">
    <h2>WarpCat — Browser Preview</h2>
    <div style="margin:10px 0;">
      <form action="/frame/preview" method="get">
        <input name="fid" value="${fid}"/>
        <button type="submit">Show</button>
        <a style="margin-left:10px" href="${img}" target="_blank">Open PNG</a>
      </form>
    </div>
    <img src="${img}" width="1024" height="1024" style="max-width:100%; height:auto; display:block;"/>
  </body></html>`;
  res.type('html').send(html);
});

/* ========== IMAGES ========== */
app.get('/img/preview/:fid.png', async (req, res) => {
  const fid = String(req.params.fid || '0');
  try {
    const svg = buildPosterSvg(fid);
    const png = await svgToPng(svg);
    res.set('content-type','image/png').send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
});
app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = String(req.params.fid || '0');
  res.set('content-type','image/svg+xml').send(buildPosterSvg(fid));
});

/* ========== FRAMES (OG META) ========== */
app.get('/frame/home', (req, res) => {
  const fid   = String(req.query.fid || '12345');
  const img   = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
  const txUrl = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
  const next  = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}`;

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:description" content="Mint your WarpCat on Base."/>
    <meta property="og:image" content="${img}"/>

    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${img}"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:1:target" content="${txUrl}"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${next}"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// Default Frames entry: route POST /frame → redirect to /frame/home
app.post('/frame', (_req, res) => {
  res.redirect(302, `/frame/home?fid=12345`);
});

/* ========== TX ENDPOINTS ========== */
app.post('/frame/tx', (req, res) => {
  const fid =
    (req.query && (req.query.fid || req.query.id)) ||
    (req.body  && (req.body.fid  || req.body.id)) ||
    '0';

  if (!CONTRACT_ADDRESS) return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });

  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to:    CONTRACT_ADDRESS,
      data,
      value: toHex(MINT_PRICE_WEI),
    },
  };
  res.json(tx);
});

app.get('/frame/tx', (req, res) => {
  const fid = String(req.query.fid || '0');
  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: { to: CONTRACT_ADDRESS, data, value: toHex(MINT_PRICE_WEI) },
  };
  res.json(tx);
});

/* ========== OPTIONAL: minted marker ========== */
app.post('/frame/minted', (req, res) => {
  const fid = String((req.body && (req.body.fid || req.body.userFid)) || '0');
  const db = readMinted();
  db[fid] = { t: Date.now() };
  writeMinted(db);
  res.json({ ok: true });
});

/* ========== ROOT ========== */
app.get('/', (_req, res) => res.redirect(302, '/frame'));

/* ========== START ========== */
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
