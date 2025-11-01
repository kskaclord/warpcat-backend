// index.js — WarpCat backend (Frames + preview + mint tx)
// All texts in English (as requested)

// ===== Imports & Setup =====
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Strip any accidental "download" headers and set sane security/cache defaults
app.use((req, res, next) => {
  res.removeHeader('Content-Disposition');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Serve /static (for og.png etc.)
const STATIC_DIR = path.join(__dirname, 'static');
if (!fs.existsSync(STATIC_DIR)) fs.mkdirSync(STATIC_DIR, { recursive: true });
app.use('/static', express.static(STATIC_DIR, { maxAge: '1h', etag: true }));

// ===== Paths =====
const DATA_DIR   = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets');
const TRAITS_DIR = path.join(__dirname, 'traits');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== Config =====
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const CHAIN_ID          = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453'; // Base mainnet by default
const CONTRACT_ADDRESS  = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI    = process.env.MINT_PRICE_WEI || '500000000000000'; // 0.0005 ETH default
const MINT_SELECTOR     = (process.env.MINT_SELECTOR || '').toLowerCase();  // e.g. 0x40c10f19 for mint(uint256)

// optional gating flags (wired for future use; currently not enforced)
const PRO_ONLY          = String(process.env.PRO_ONLY || 'false').toLowerCase() === 'true';
const POWER_BADGE_ONLY  = String(process.env.POWER_BADGE_ONLY || 'false').toLowerCase() === 'true';
const MIN_NEYNAR_SCORE  = Number(process.env.MIN_NEYNAR_SCORE || 0);
const NEYNAR_API_KEY    = process.env.NEYNAR_API_KEY || '';

const DEFAULT_OG_IMAGE  = `${PUBLIC_BASE_URL}/static/og.png`;

// ===== Tiny KV for minted FIDs =====
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
function readMinted() {
  try { return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')); }
  catch { return {}; }
}
function writeMinted(obj) {
  fs.writeFileSync(MINTED_FILE, JSON.stringify(obj, null, 2));
}

// ===== Utils =====
function toHex(n) {
  if (typeof n === 'string' && n.startsWith('0x')) return n;
  return '0x' + BigInt(n).toString(16);
}
function uint256Hex(n) {
  const hex = BigInt(n).toString(16);
  return '0x' + hex.padStart(64, '0');
}
function buildMintData(fid) {
  if (!MINT_SELECTOR || MINT_SELECTOR.length !== 10 || !MINT_SELECTOR.startsWith('0x')) {
    // No custom selector provided: pure payable (empty calldata)
    return '0x';
  }
  // Encode single uint256 argument (fid) after the 4-byte selector
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
}

// Deterministic pick by seed
function randFrom(arr, seed) {
  if (!arr || !arr.length) return null;
  const i = Number(BigInt(seed) % BigInt(arr.length));
  return arr[i];
}

// Read asset text; use fallback if missing
function ensureAsset(relPath, fallbackRel) {
  const p = path.join(ASSETS_DIR, relPath);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (fallbackRel) {
    const fb = path.join(ASSETS_DIR, fallbackRel);
    if (fs.existsSync(fb)) {
      console.warn(`Missing asset: ${relPath} → fallback ${fallbackRel}`);
      return fs.readFileSync(fb, 'utf8');
    }
  }
  console.warn(`Missing asset: ${relPath}`);
  return ''; // empty fragment
}

// ===== SVG compositor (very lightweight, trait-based) =====
function buildSvg(fid) {
  // backgrounds (optional list)
  const availableBgs = ['neon_purple.svg', 'hologrid.svg', 'pink_grad.svg']
    .filter(f => fs.existsSync(path.join(ASSETS_DIR, 'background', f)));
  const bgName = availableBgs.length ? randFrom(availableBgs, fid) : 'neon_purple.svg';
  const bgSvg  = ensureAsset(`background/${bgName}`, `background/neon_purple.svg`);

  // face parts (fallbacks are themselves to avoid empty)
  const face  = ensureAsset('body/cat_base.svg',       'body/cat_base.svg');
  const eyes  = ensureAsset('eyes/sharp.svg',          'eyes/sharp.svg');
  const mouth = ensureAsset('mouth/smile.svg',         'mouth/smile.svg');
  const head  = ensureAsset('headgear/bandana.svg',    '');
  const aura  = ensureAsset('aura/none.svg',           '');
  const acc   = ensureAsset('accessory/none.svg',      '');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs>
    <style>
      .shadow { filter: drop-shadow(0 4px 24px rgba(0,0,0,.35)); }
    </style>
  </defs>
  <g>${bgSvg}</g>
  <g class="shadow">
    ${face}
    ${aura}
    ${eyes}
    ${mouth}
    ${head}
    ${acc}
  </g>
  <text x="48" y="1140" font-size="28" fill="#ffffffaa" font-family="Inter, Arial, sans-serif">WarpCat • FID ${fid}</text>
</svg>
  `.trim();
}

async function svgToPng(svg) {
  // 1024x1024 PNG (Frames recommended size)
  return await sharp(Buffer.from(svg)).png().resize(1024, 1024, { fit: 'cover' }).toBuffer();
}

// ======= Browser landing (manual) =======
app.get('/frame', (_req, res) => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta property="og:title" content="WarpCat Frame"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>WarpCat Frame</title>
    <style>
      body{font-family:Inter,Arial,sans-serif; text-align:center; padding:36px;}
      .tip{color:#666; margin-top:8px}
    </style>
  </head>
  <body>
    <h1>WarpCat Frame</h1>
    <p>Open this in your Farcaster client or use <a href="/frame/preview?fid=12345">browser preview</a>.</p>
    <form action="/frame/preview" method="get" style="margin-top:16px;">
      <label>FID: <input name="fid" value="12345" style="padding:4px 8px;"/></label>
      <button type="submit" style="margin-left:8px;">Preview</button>
    </form>
    <p class="tip">Mint button is available only inside Farcaster clients.</p>
  </body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
});

// ======= Browser preview (HTML wrapper) =======
app.get('/frame/preview', (req, res) => {
  const fid = String(req.query.fid || '12345');
  const img = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <title>WarpCat — Browser Preview</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
      body{font-family:Inter,Arial,sans-serif; padding:24px;}
      img{max-width:100%; height:auto; display:block;}
      form{margin:10px 0;}
      a{color:#5b6dff; text-decoration:none;}
    </style>
  </head>
  <body>
    <h2>WarpCat — Browser Preview</h2>
    <div>
      <form action="/frame/preview" method="get">
        <input name="fid" value="${fid}" />
        <button type="submit">Show</button>
        <a style="margin-left:10px" href="${img}" target="_blank">Open PNG</a>
      </form>
    </div>
    <img src="${img}" width="1024" height="1024"/>
  </body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
});

// ======= Raw Image endpoints =======
app.get('/img/preview/:fid.png', async (req, res) => {
  const fid = String(req.params.fid || '0');
  try {
    const svg = buildSvg(fid);
    const png = await svgToPng(svg);
    res.set('Content-Type', 'image/png');
    // allow short caching for image URLs
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.status(200).send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
});

app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = String(req.params.fid || '0');
  const svg = buildSvg(fid);
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  res.status(200).send(svg);
});

// ======= Frames meta (entry) =======
// This is what you should paste into Warpcast composer:  https://api.warpcat.xyz/frame/home?fid=12345&_v=1
app.get('/frame/home', (req, res) => {
  const fid   = String(req.query.fid || '12345');
  const v     = String(req.query._v || '1'); // cache buster if needed
  const img   = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png?v=${encodeURIComponent(v)}`;
  const txUrl = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
  const next  = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}&_v=${Date.now()}`;

  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:image" content="${img}"/>
    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${img}"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:1:target" content="${txUrl}"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${next}"/>
    <meta name="twitter:card" content="summary_large_image"/>
  </head><body></body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
});

// Frames POST root → redirect to /frame/home with a default fid
app.post('/frame', (req, res) => {
  const fid = '12345';
  res.redirect(302, `/frame/home?fid=${fid}&_v=${Date.now()}`);
});

// ======= Frames TX endpoint (GET for manual test, POST for frames) =======
function buildTx(fid) {
  return {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDRESS,
      data: buildMintData(fid),
      value: toHex(MINT_PRICE_WEI),
    },
  };
}

app.get('/frame/tx', (req, res) => {
  const fid = String(req.query.fid || '0');
  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }
  res.json(buildTx(fid));
});

app.post('/frame/tx', (req, res) => {
  const fid =
    (req.query && (req.query.fid || req.query.id)) ||
    (req.body  && (req.body.fid  || req.body.id))  ||
    '0';
  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }
  res.json(buildTx(String(fid)));
});

// ======= Minted guard write (optional hook from client) =======
app.post('/frame/minted', (req, res) => {
  const fid = String((req.body && (req.body.fid || req.body.userFid)) || '0');
  const db  = readMinted();
  db[fid]   = { t: Date.now() };
  writeMinted(db);
  res.json({ ok: true });
});

// ======= Root & health =======
app.get('/', (_req, res) => res.redirect(302, '/frame'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// ======= Start =======
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
