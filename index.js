import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

/* ============ Paths & App ============ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ============ Config ============ */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const DATA_DIR   = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets');
const TRAITS_DIR = path.join(__dirname, 'traits');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- NEW: serve /static for OG image ---------- */
app.use('/static', express.static(path.join(__dirname, 'static'), { maxAge: '1h' }));

/* ============ Chain / Mint Config ============ */
const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453'; // Base
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '500000000000000'; // 0.0005 ETH
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase(); // e.g. 0x40c10f19 if mint(uint256)

/* ============ Simple storage ============ */
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
function readMinted() {
  try { return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')); }
  catch { return {}; }
}
function writeMinted(obj) {
  fs.writeFileSync(MINTED_FILE, JSON.stringify(obj, null, 2));
}

/* ============ Utils ============ */
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
    // payable mint() with no args
    return '0x';
  }
  // encode uint256 fid
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
}

/* ============ Trait helpers ============ */
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

/* ============ SVG compositor ============ */
function buildSvg(fid) {
  const bgs = ['neon_purple.svg', 'hologrid.svg', 'pink_grad.svg'].filter(f =>
    fs.existsSync(path.join(ASSETS_DIR, 'background', f))
  );
  const bg = bgs.length ? randFrom(bgs, fid) : 'neon_purple.svg';

  const face      = ensureAsset('body/cat_base.svg', 'body/cat_base.svg');
  const eyes      = ensureAsset('eyes/sharp.svg', 'eyes/sharp.svg');
  const mouth     = ensureAsset('mouth/smile.svg', 'mouth/smile.svg');
  const head      = ensureAsset('headgear/bandana.svg', '');
  const aura      = ensureAsset('aura/none.svg', '');
  const accessory = ensureAsset('accessory/none.svg', '');
  const bgSvg     = ensureAsset(`background/${bg}`, 'background/neon_purple.svg');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs>
    <style>.shadow{ filter: drop-shadow(0 4px 24px rgba(0,0,0,.35)); }</style>
  </defs>
  <g>${bgSvg}</g>
  <g class="shadow">
    ${face}
    ${aura}
    ${eyes}
    ${mouth}
    ${head}
    ${accessory}
  </g>
  <text x="48" y="1140" font-size="28" fill="#ffffffaa" font-family="Inter, Arial, sans-serif">WarpCat • FID ${fid}</text>
</svg>`.trim();
}

async function svgToPng(svg) {
  return await sharp(Buffer.from(svg)).png().resize(1024, 1024, { fit: 'cover' }).toBuffer();
}

/* ============ Browser UI ============ */
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
    <div style="margin: 10px 0;">
      <form action="/frame/preview" method="get">
        <input name="fid" value="${fid}" />
        <button type="submit">Show</button>
        <a style="margin-left:10px" href="${img}" target="_blank">Open PNG</a>
      </form>
    </div>
    <img src="${img}" width="1024" height="1024" style="max-width:100%; height:auto; display:block;"/>
  </body></html>`;
  res.type('html').send(html);
});

/* ============ Image endpoints ============ */
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

/* ---------- NEW: HEAD handler (crawler-friendly) ---------- */
app.head('/img/preview/:fid.png', async (req, res) => {
  try {
    const svg = buildSvg(String(req.params.fid || '0'));
    const png = await svgToPng(svg);
    res.set({
      'content-type': 'image/png',
      'content-length': String(png.length),
      'cache-control': 'public, max-age=60'
    });
    res.status(200).end();
  } catch {
    res.status(200).end();
  }
});

app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = String(req.params.fid || '0');
  const svg = buildSvg(fid);
  res.set('content-type', 'image/svg+xml').send(svg);
});

/* ============ Frames meta (home) ============ */
app.get('/frame/home', (req, res) => {
  const fid      = String(req.query.fid || '12345');
  const frameImg = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`; // dynamic
  const ogImg    = `${PUBLIC_BASE_URL}/static/og.png`;                               // static
  const txUrl    = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
  const nextUrl  = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}`;

  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <title>WarpCat Preview</title>

    <!-- OG/Twitter (fast, static) -->
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:description" content="Mint your WarpCat on Base."/>
    <meta property="og:image" content="${ogImg}"/>
    <meta property="og:image:type" content="image/png"/>
    <meta property="og:image:width" content="1024"/>
    <meta property="og:image:height" content="1024"/>
    <meta property="og:url" content="${PUBLIC_BASE_URL}/frame/home"/>

    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:image" content="${ogImg}"/>

    <!-- Frames (interactive) -->
    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${frameImg}"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:1:target" content="${txUrl}"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${nextUrl}"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

// default entry for Frames clients (POST)
app.post('/frame', (_req, res) => {
  const fid = '12345';
  res.redirect(302, `/frame/home?fid=${fid}`);
});

/* ============ Frames TX endpoint ============ */
app.post('/frame/tx', (req, res) => {
  const fid =
    (req.query && (req.query.fid || req.query.id)) ||
    (req.body && (req.body.fid || req.body.id)) ||
    '0';

  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }

  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDRESS,
      data,
      value: toHex(MINT_PRICE_WEI),
    },
  };
  res.json(tx);
});

// allow GET for manual testing
app.get('/frame/tx', (req, res) => {
  const fid = String(req.query.fid || '0');
  const data = buildMintData(fid);
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDRESS,
      data,
      value: toHex(MINT_PRICE_WEI),
    },
  };
  res.json(tx);
});

/* ============ Optional minted guard ============ */
app.post('/frame/minted', (req, res) => {
  const fid = String((req.body && (req.body.fid || req.body.userFid)) || '0');
  const db = readMinted();
  db[fid] = { t: Date.now() };
  writeMinted(db);
  res.json({ ok: true });
});

/* ============ Root redirect ============ */
app.get('/', (_req, res) => {
  res.redirect(302, '/frame');
});

/* ============ Start ============ */
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});
