// index.js — WarpCat backend (Frames + Preview + Eligibility Gate)

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

/* ================== BOOT ================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ================== CONFIG ================== */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const DATA_DIR    = path.join(__dirname, 'data');
const ASSETS_DIR  = path.join(__dirname, 'assets');
const TRAITS_DIR  = path.join(__dirname, 'traits');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ============ CHAIN / MINT CONFIG ============ */
const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453'; // Base
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase(); // your ERC721/1155
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '500000000000000';    // 0.0005 ETH default
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase();    // e.g. 0xabcdef01 for mint(uint256)

/* ============ ELIGIBILITY (OFF-CHAIN) ============ */
const PRO_ONLY         = String(process.env.PRO_ONLY || 'false').toLowerCase() === 'true';
const POWER_BADGE_ONLY = String(process.env.POWER_BADGE_ONLY || 'false').toLowerCase() === 'true';
const MIN_NEYNAR_SCORE = Number(process.env.MIN_NEYNAR_SCORE || '0');
const NEYNAR_API_KEY   = process.env.NEYNAR_API_KEY || '';

async function fetchUserFromNeynar(fid) {
  if (!NEYNAR_API_KEY) return null;
  try {
    const url = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(fid)}&viewer_fid=${encodeURIComponent(fid)}`;
    const r = await fetch(url, { headers: { accept: 'application/json', api_key: NEYNAR_API_KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    const u = j.users?.[0] || j.result?.users?.[0] || null;
    if (!u) return null;

    const powerBadge =
      !!(u.power_badge || u.verifications?.power_badge || u.farcaster_user?.power_badge);
    const score = Number(u.score ?? u.neynar_score ?? u.rank_score ?? 0);
    const isPro =
      !!(u.is_premium || u.is_pro || u.warpcast_pro || u.viewer_context?.is_premium || u.viewer_context?.is_pro);

    return { isPro, powerBadge, score };
  } catch (e) {
    console.error('neynar error', e);
    return null;
  }
}
async function isEligible(fid) {
  if (!PRO_ONLY && !POWER_BADGE_ONLY && MIN_NEYNAR_SCORE <= 0) return true;
  const u = await fetchUserFromNeynar(fid);
  if (!u) return false;
  if (PRO_ONLY && !u.isPro) return false;
  if (POWER_BADGE_ONLY && !u.powerBadge) return false;
  if (MIN_NEYNAR_SCORE > 0 && !(u.score >= MIN_NEYNAR_SCORE)) return false;
  return true;
}

/* ============== SIMPLE STORAGE (OPTIONAL) ============== */
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
function readMinted() {
  try { return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')); }
  catch { return {}; }
}
function writeMinted(obj) {
  fs.writeFileSync(MINTED_FILE, JSON.stringify(obj, null, 2));
}

/* ============== UTIL ENCODERS ============== */
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
    // No selector provided -> payable mint without calldata
    return '0x';
  }
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
}

/* ============== TRAIT / ASSET HELPERS ============== */
function randFrom(arr, seed) {
  const i = Number(BigInt(seed) % BigInt(arr.length));
  return arr[i];
}
function ensureAsset(relPath, fallback) {
  const p = path.join(ASSETS_DIR, relPath);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (fallback) {
    const fb = path.join(ASSETS_DIR, fallback);
    if (fs.existsSync(fb)) {
      console.warn(`Missing asset: ${relPath} → fallback ${fallback}`);
      return fs.readFileSync(fb, 'utf8');
    }
  }
  console.warn(`Missing asset: ${relPath}`);
  return '';
}

/* ============== SVG COMPOSITOR ============== */
function buildSvg(fid) {
  const bgOptions = ['neon_purple.svg', 'hologrid.svg', 'pink_grad.svg'].filter(f =>
    fs.existsSync(path.join(ASSETS_DIR, 'background', f))
  );
  const bgName = bgOptions.length ? randFrom(bgOptions, fid) : 'neon_purple.svg';
  const bgSvg  = ensureAsset(`background/${bgName}`, 'background/neon_purple.svg');

  const face      = ensureAsset('body/cat_base.svg', 'body/cat_base.svg');
  const eyes      = ensureAsset('eyes/sharp.svg', 'eyes/sharp.svg');
  const mouth     = ensureAsset('mouth/smile.svg', 'mouth/smile.svg');
  const headgear  = ensureAsset('headgear/bandana.svg', '');
  const aura      = ensureAsset('aura/none.svg', '');
  const accessory = ensureAsset('accessory/none.svg', '');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs>
    <style>.shadow{filter:drop-shadow(0 4px 24px rgba(0,0,0,.35));}</style>
  </defs>
  <g>${bgSvg}</g>
  <g class="shadow">
    ${face}
    ${aura}
    ${eyes}
    ${mouth}
    ${headgear}
    ${accessory}
  </g>
  <text x="48" y="1140" font-size="28" fill="#ffffffaa" font-family="Inter,Arial,sans-serif">
    WarpCat • FID ${fid}
  </text>
</svg>`.trim();
}

async function svgToPng(svg) {
  // Frames-friendly 1024x1024 PNG
  return await sharp(Buffer.from(svg)).png().resize(1024, 1024, { fit: 'cover' }).toBuffer();
}

/* ============== PUBLIC PAGES ============== */
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
    <img src="${img}" width="1024" height="1024" style="max-width:100%;height:auto;display:block;"/>
  </body></html>`;
  res.type('html').send(html);
});

/* ============== IMAGE ENDPOINTS ============== */
app.get('/img/preview/:fid.png', async (req, res) => {
  const fid = String(req.params.fid || '0');
  try {
    const svg = buildSvg(fid);
    const png = await svgToPng(svg);
    res.set('content-type', 'image/png').send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
});
app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = String(req.params.fid || '0');
  const svg = buildSvg(fid);
  res.set('content-type', 'image/svg+xml').send(svg);
});

/* ============== FRAMES META (HOME) ============== */
app.get('/frame/home', (req, res) => {
  const fid = String(req.query.fid || '12345');
  const img = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
  const txUrl   = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
  const nextUrl = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}`;

  const html = `<!doctype html><html><head>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:image" content="${img}"/>
    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${img}"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:1:target" content="${txUrl}"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${nextUrl}"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

app.post('/frame', (_req, res) => {
  // Default entry for Frames clients
  const fid = '12345';
  res.redirect(302, `/frame/home?fid=${fid}`);
});

/* ============== FRAMES TX (WITH ELIGIBILITY) ============== */
app.post('/frame/tx', async (req, res) => {
  const fid =
    (req.query && (req.query.fid || req.query.id)) ||
    (req.body  && (req.body.fid  || req.body.id)) ||
    '0';

  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }

  // Eligibility check
  const ok = await isEligible(fid);
  if (!ok) {
    const notOkImg = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`; // you can swap with a "Not eligible" banner
    const retryUrl = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}`;
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Not eligible"/>
      <meta property="og:image" content="${notOkImg}"/>
      <meta name="fc:frame" content="vNext"/>
      <meta name="fc:frame:image" content="${notOkImg}"/>
      <meta name="fc:frame:button:1" content="Back"/>
      <meta name="fc:frame:button:1:action" content="post"/>
      <meta name="fc:frame:post_url" content="${retryUrl}"/>
    </head><body></body></html>`;
    return res.type('html').send(html);
  }

  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: { to: CONTRACT_ADDRESS, data, value: toHex(MINT_PRICE_WEI) },
  };
  res.json(tx);
});

// also allow GET to test in browser
app.get('/frame/tx', async (req, res) => {
  const fid = String(req.query.fid || '0');
  const ok  = await isEligible(fid);
  if (!ok) return res.status(403).json({ eligible: false });
  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: { to: CONTRACT_ADDRESS, data, value: toHex(MINT_PRICE_WEI) },
  };
  res.json(tx);
});

/* ============== OPTIONAL: MARK AS MINTED ============== */
app.post('/frame/minted', (req, res) => {
  const fid = String((req.body && (req.body.fid || req.body.userFid)) || '0');
  const db = readMinted();
  db[fid] = { t: Date.now() };
  writeMinted(db);
  res.json({ ok: true });
});

/* ============== ROOT ============== */
app.get('/', (_req, res) => res.redirect(302, '/frame'));

/* ============== START ============== */
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
