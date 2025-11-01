import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

/* -------------------- Paths & App -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* Request log — frame ve image’ları da görelim */
app.use((req, _res, next) => {
  const ua = req.headers['user-agent'] || '';
  console.log(`[REQ] ${req.method} ${req.originalUrl} UA="${ua}"`);
  next();
});


/* Static assets for OG preview image */
const STATIC_A = path.join(__dirname, 'static');   // preferred
const STATIC_B = path.join(__dirname, 'statics');  // your folder name
if (fs.existsSync(STATIC_A)) app.use('/static', express.static(STATIC_A));
if (fs.existsSync(STATIC_B)) app.use('/static', express.static(STATIC_B));

/* -------------------- Config -------------------- */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

// chain/tx
const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453';
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase(); // REQUIRED for /frame/tx
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '500000000000000';    // 0.0005 ETH default
// 4-byte selector for mint(uint256 fid) gerekiyorsa: 0x40c10f19; paramsız mint ise boş bırak.
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase();

/* -------------------- Minimal store -------------------- */
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
const readMinted = () => { try { return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')); } catch { return {}; } };
const writeMinted = (o) => fs.writeFileSync(MINTED_FILE, JSON.stringify(o, null, 2));

/* -------------------- Helpers -------------------- */
const toHex = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : ('0x' + BigInt(n).toString(16));
const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));
const buildMintData = (fid) => {
  if (!MINT_SELECTOR || !MINT_SELECTOR.startsWith('0x') || MINT_SELECTOR.length !== 10) return '0x';
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
};

/* -------------------- SVG compositor (simple) -------------------- */
const ASSETS_DIR = path.join(__dirname, 'assets');
function ensureAsset(rel, fallbackRel = '') {
  const p = path.join(ASSETS_DIR, rel);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (fallbackRel) {
    const fb = path.join(ASSETS_DIR, fallbackRel);
    if (fs.existsSync(fb)) {
      console.warn(`Missing asset: ${rel} → fallback ${fallbackRel}`);
      return fs.readFileSync(fb, 'utf8');
    }
  }
  console.warn(`Missing asset: ${rel}`);
  return '';
}
function pickBg(fid) {
  const cands = ['neon_purple.svg', 'hologrid.svg', 'pink_grad.svg'].filter(f =>
    fs.existsSync(path.join(ASSETS_DIR, 'background', f))
  );
  if (!cands.length) return 'neon_purple.svg';
  const i = Number(BigInt(fid) % BigInt(cands.length));
  return cands[i];
}
function buildSvg(fid) {
  const bgFile = pickBg(fid);
  const bg     = ensureAsset(`background/${bgFile}`, 'background/neon_purple.svg');
  const face   = ensureAsset('body/cat_base.svg', 'body/cat_base.svg');
  const eyes   = ensureAsset('eyes/sharp.svg', 'eyes/sharp.svg');
  const mouth  = ensureAsset('mouth/smile.svg', 'mouth/smile.svg');
  const head   = ensureAsset('headgear/bandana.svg', '');
  const aura   = ensureAsset('aura/none.svg', '');
  const acc    = ensureAsset('accessory/none.svg', '');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs><style>.shadow{filter:drop-shadow(0 4px 24px rgba(0,0,0,.35));}</style></defs>
  ${bg}
  <g class="shadow">${face}${aura}${eyes}${mouth}${head}${acc}</g>
  <text x="48" y="1140" font-size="28" fill="#ffffffaa" font-family="Inter, Arial, sans-serif">WarpCat • FID ${fid}</text>
</svg>`.trim();
}
async function svgToPng(svg) {
  return await sharp(Buffer.from(svg)).png().resize(1024, 1024, { fit: 'cover' }).toBuffer();
}

/* -------------------- Browser preview pages -------------------- */
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
  res.status(200).type('html').send(html);
});

/* raw images used by preview/frames */
async function servePreviewPng(req, res) {
  const fid = String(req.params.fid || '0');
  try {
    const svg = buildSvg(fid);
    const png = await svgToPng(svg);
    res.set({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60',
      'content-length': png.length
    });
    res.send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
}
app.get('/img/preview/:fid.png', async (req, res) => {
  const fid = String(req.params.fid || '0');
  try {
    const svg = buildSvg(fid);
    const png = await svgToPng(svg);
    res.set({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=600',
      'content-length': png.length
    });
    res.send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
});
/* -------------------- Frames (meta endpoints) -------------------- */
/** frame HEAD builder
 * og/twitter IMAGE:  static/og.png  (kart güvenli)
 * fc:frame:image   : dynamic PNG    (Frame görseli)
 */
function frameHead({ fid }) {
  const ogImage   = `${PUBLIC_BASE_URL}/static/og.png`; // kart için sabit
  const frameImg  = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
  const txUrl     = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
  const postUrl   = `${PUBLIC_BASE_URL}/frame/home?fid=${encodeURIComponent(fid)}`;

  return `
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>

  <meta property="og:title" content="WarpCat Preview"/>
  <meta property="og:image" content="${ogImage}"/>
  <meta property="og:image:width" content="1024"/>
  <meta property="og:image:height" content="1024"/>
  <meta property="og:url" content="${postUrl}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:image" content="${ogImage}"/>

  <meta name="fc:frame" content="vNext"/>
  <meta name="fc:frame:image" content="${frameImg}"/>
  <meta name="fc:frame:image:aspect_ratio" content="1:1"/>

  <meta name="fc:frame:button:1" content="Mint"/>
  <meta name="fc:frame:button:1:action" content="tx"/>
  <meta name="fc:frame:button:1:target" content="${txUrl}"/>

  <meta name="fc:frame:button:2" content="Refresh"/>
  <meta name="fc:frame:button:2:action" content="post"/>
  <meta name="fc:frame:post_url" content="${postUrl}"/>

  <link rel="preload" as="image" href="${ogImage}"/>
`;
}

/* entry shown if someone opens /frame in a normal browser */
app.get('/frame', (_req, res) => {
  const demoUrl = `${PUBLIC_BASE_URL}/frame/preview?fid=12345`;
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <title>WarpCat Frame</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
  </head>
  <body style="font-family:Inter,Arial; text-align:center; padding:36px;">
    <h1>WarpCat Frame</h1>
    <p>Open in your Farcaster client or use <a href="${demoUrl}">browser preview</a>.</p>
    <form action="/frame/preview" method="get" style="margin-top:16px;">
      <label>FID: <input name="fid" value="12345" style="padding:4px 8px;"/></label>
      <button type="submit" style="margin-left:8px;">Preview</button>
    </form>
  </body></html>`;
  res.status(200).type('html').send(html);
});

/* Frame HOME (GET+POST) — TEK TANIM */
function sendFrameHome(req, res) {
  const fid = String((req.query && (req.query.fid || req.query.id)) ||
                     (req.body && (req.body.fid || req.body.id)) || '12345');

  const html = `<!doctype html>
<html>
  <head>
    ${frameHead({ fid })}
    <meta property="og:type" content="website"/>
    <meta property="og:image:width" content="1024"/>
    <meta property="og:image:height" content="1024"/>
    <title>WarpCat Preview</title>
  </head>
  <body></body>
</html>`;
  res.set('cache-control', 'no-store, max-age=0');
  res.status(200).type('html').send(html);
}
app.get('/frame/home', sendFrameHome);
app.post('/frame/home', sendFrameHome);

/* Farcaster genelde POST /frame de yapar */
app.post('/frame', sendFrameHome);

/* -------------------- Frame TX endpoint -------------------- */
function sendTx(req, res) {
  const fid =
    (req.query && (req.query.fid || req.query.id)) ||
    (req.body && (req.body.fid || req.body.id)) ||
    '0';

  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }

  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDRESS,
      data: buildMintData(fid),
      value: toHex(MINT_PRICE_WEI),
    },
  };
  res.status(200).json(tx);
}
app.get('/frame/tx', sendTx);
app.post('/frame/tx', sendTx);

/* (optional) record minted */
app.post('/frame/minted', (req, res) => {
  const fid = String((req.body && (req.body.fid || req.body.userFid)) || '0');
  const db = readMinted();
  db[fid] = { t: Date.now() };
  writeMinted(db);
  res.json({ ok: true });
});

/* Minimal, static-image debug frame */
app.get('/frame/debug', (_req, res) => {
  const img = `${PUBLIC_BASE_URL}/static/og.png`;
  const tx  = `${PUBLIC_BASE_URL}/frame/tx?fid=0`;
  const next = `${PUBLIC_BASE_URL}/frame/debug`;
  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta property="og:title" content="WarpCat Debug"/>
    <meta property="og:image" content="${img}"/>
    <meta property="og:url" content="${next}"/>

    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${img}"/>
    <meta name="fc:frame:image:aspect_ratio" content="1:1"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${next}"/>
  </head><body></body></html>`;
  res.type('html').send(html);
});

/* root -> /frame */
app.get('/', (_req, res) => res.redirect(302, '/frame'));

/* health */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* -------------------- Start -------------------- */
app.listen(PORT, () => {
  console.log(`WarpCat backend listening at ${PUBLIC_BASE_URL}/frame`);
});

