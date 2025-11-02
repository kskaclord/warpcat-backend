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
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* Simple log */
app.use((req, _res, next) => {
  const ua = req.headers['user-agent'] || '';
  console.log(`[REQ] ${req.method} ${req.originalUrl} UA="${ua}"`);
  next();
});

/* Cache policy (frame/img/f) */
app.use((req, res, next) => {
  if (req.path.startsWith('/frame') || req.path.startsWith('/img') || req.path.startsWith('/f')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

/* Serve static/ statics/ as /static  */
function setHeaders(res, filePath) {
  // Uzantıya göre type ver (PNG/JPG/WebP); og.png PNG olduğu için zaten doğru.
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') res.setHeader('Content-Type', 'image/png');
  else if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
  else if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=600');
}
const STATIC_A = path.join(__dirname, 'static');
const STATIC_B = path.join(__dirname, 'statics'); // senin klasör
if (fs.existsSync(STATIC_A)) app.use('/static', express.static(STATIC_A, { setHeaders }));
if (fs.existsSync(STATIC_B)) app.use('/static', express.static(STATIC_B, { setHeaders }));

/* -------------------- Config -------------------- */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453';
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '500000000000000'; // 0.0005
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase(); // 0x40c10f19 gibi

const NEYNAR_API_KEY   = process.env.NEYNAR_API_KEY || '';
const NEYNAR_APP_ID    = process.env.NEYNAR_APP_ID || ''; // opsiyonel

/* -------------------- Helpers -------------------- */
const toHex = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : ('0x' + BigInt(n).toString(16));
const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));
const buildMintData = (fid) => {
  // selector boşsa parametresiz mint() kabul: data = "0x"
  if (!MINT_SELECTOR) return '0x';
  // 4-byte selector beklenir (0x + 8 hex = 10 uzunluk)
  if (!/^0x[0-9a-f]{8}$/i.test(MINT_SELECTOR)) return '0x';
  return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
};

/* Neynar validate helper (v2 Frames) */
async function validateWithNeynar(payload) {
  try {
    if (!NEYNAR_API_KEY) return { ok: true }; // dev mod
    const r = await fetch('https://api.neynar.com/v2/frames/validate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api_key': NEYNAR_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const json = await r.json();
    if (json?.valid === true || json?.is_valid === true) return { ok: true, data: json };
    return { ok: false, data: json };
  } catch (e) {
    console.error('neynar validate error', e);
    return { ok: false, err: String(e) };
  }
}

/* -------------------- SVG -> PNG -------------------- */
const ASSETS_DIR = path.join(__dirname, 'assets');
function ensureAsset(rel, fallbackRel = '') {
  const p = path.join(ASSETS_DIR, rel);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (fallbackRel) {
    const fb = path.join(ASSETS_DIR, fallbackRel);
    if (fs.existsSync(fb)) return fs.readFileSync(fb, 'utf8');
  }
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
  const bg   = ensureAsset(`background/${pickBg(fid)}`, 'background/neon_purple.svg');
  const face = ensureAsset('body/cat_base.svg', 'body/cat_base.svg');
  const eyes = ensureAsset('eyes/sharp.svg', 'eyes/sharp.svg');
  const mouth= ensureAsset('mouth/smile.svg', 'mouth/smile.svg');

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <defs><style>.shadow{filter:drop-shadow(0 4px 24px rgba(0,0,0,.35));}</style></defs>
  ${bg}
  <g class="shadow">${face}${eyes}${mouth}</g>
  <text x="48" y="1140" font-size="28" fill="#ffffffaa" font-family="Inter, Arial, sans-serif">
    WarpCat • FID ${fid}
  </text>
</svg>`.trim();
}
async function svgToPng(svg) {
  return await sharp(Buffer.from(svg)).png().resize(1024, 1024, { fit: 'cover' }).toBuffer();
}

/* -------------------- Public Images -------------------- */
app.get('/img/preview/:fid.png', async (req, res) => {
  const fid = String(req.params.fid || '0');
  try {
    const png = await svgToPng(buildSvg(fid));
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
      'Content-Length': png.length
    }).send(png);
  } catch (e) {
    console.error('png error', e);
    res.status(500).send('img error');
  }
});

/* -------------------- Sade OG Card (debug) -------------------- */
app.get('/frame/card', (req, res) => {
  const fid = String(req.query.fid || '12345');
  const img = `${PUBLIC_BASE_URL}/static/og.png`;

  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <meta property="og:title" content="WarpCat Preview"/>
    <meta property="og:type" content="website"/>
    <meta property="og:url" content="${PUBLIC_BASE_URL}/frame/card?fid=${encodeURIComponent(fid)}"/>
    <meta property="og:image" content="${img}"/>
    <meta property="og:image:width" content="1024"/>
    <meta property="og:image:height" content="1024"/>
    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:image" content="${img}"/>
    <title>WarpCat Card</title>
  </head><body></body></html>`;
  res.status(200)
     .set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, max-age=0'})
     .send(html);
});

/* -------------------- FRAME META -------------------- */
// Kısa ve paramsız path: /f/:fid  (cast’ta bunu kullan)
function frameHead({ fid }) {
-  const image   = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
-  const txUrl   = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
-  const postUrl = `${PUBLIC_BASE_URL}/f/${encodeURIComponent(fid)}`; // kısa, query yok
-  const fallbackOg = `${PUBLIC_BASE_URL}/static/og.png`;
+  const image   = `${PUBLIC_BASE_URL}/img/preview/${encodeURIComponent(fid)}.png`;
+  const txUrl   = `${PUBLIC_BASE_URL}/frame/tx?fid=${encodeURIComponent(fid)}`;
+  const postUrl = `${PUBLIC_BASE_URL}/f/${encodeURIComponent(fid)}`; // kısa, query yok

   return `
   <meta charset="utf-8"/>
   <meta name="viewport" content="width=device-width, initial-scale=1"/>

   <meta property="og:title" content="WarpCat Preview"/>
   <meta property="og:type" content="website"/>
   <meta property="og:url" content="${postUrl}"/>
-  <meta property="og:image" content="${fallbackOg}"/>
+  <meta property="og:image" content="${image}"/>
   <meta property="og:image:width" content="1024"/>
   <meta property="og:image:height" content="1024"/>
   <meta name="twitter:card" content="summary_large_image"/>
-  <meta name="twitter:image" content="${fallbackOg}"/>
+  <meta name="twitter:image" content="${image}"/>

   <meta name="fc:frame" content="vNext"/>
   <meta name="fc:frame:image" content="${image}"/>
   <meta name="fc:frame:image:aspect_ratio" content="1:1"/>

   <meta name="fc:frame:button:1" content="Mint"/>
   <meta name="fc:frame:button:1:action" content="tx"/>
   <meta name="fc:frame:button:1:target" content="${txUrl}"/>

   <meta name="fc:frame:button:2" content="Refresh"/>
   <meta name="fc:frame:button:2:action" content="post"/>

   <meta name="fc:frame:post_url" content="${postUrl}"/>
 `.trim();
}

/* GET/POST — /f/:fid (kısa rota) */
async function sendFrame(req, res) {
  const fid = String(req.params.fid || req.query.fid || req.body?.fid || '12345');

  // POST ise (frame action), Neynar ile doğrula
  if (req.method === 'POST') {
    const validation = await validateWithNeynar(req.body || {});
    if (!validation.ok) {
      return res.status(401).json({ error: 'neynar_validation_failed' });
    }
  }

  const html = `<!doctype html><html><head>
    ${frameHead({ fid })}
    <title>WarpCat Preview</title>
  </head><body></body></html>`;

  res.status(200)
     .set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, max-age=0'})
     .send(html);
}
app.get('/f/:fid', sendFrame);
app.post('/f/:fid', sendFrame);

/* Eski path’ler de çalışsın (compat) */
app.get('/frame/home', (req, res) => {
  const fid = String(req.query.fid || '12345');
  res.redirect(302, `/f/${encodeURIComponent(fid)}`);
});
app.post('/frame/home', (req, res) => {
  const fid = String(req.body?.fid || '12345');
  res.redirect(302, `/f/${encodeURIComponent(fid)}`);
});
app.post('/frame', (req, res) => res.redirect(302, '/f/12345'));

/* -------------------- TX endpoint (Neynar doğrulamalı) -------------------- */
async function sendTx(req, res) {
  // Neynar doğrulaması (GET olursa geç; POST olursa valide et)
  if (req.method === 'POST') {
    const validation = await validateWithNeynar(req.body || {});
    if (!validation.ok) {
      return res.status(401).json({ error: 'neynar_validation_failed' });
    }
  }

  const fid = String(req.query.fid || req.body?.fid || '0');
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
  res.status(200)
     .set({ 'Cache-Control': 'no-store, max-age=0' })
     .json(tx);
}
app.get('/frame/tx', sendTx);
app.post('/frame/tx', sendTx);

/* -------------------- Debug Frame -------------------- */
app.get('/frame/debug', (_req, res) => {
  const img = `${PUBLIC_BASE_URL}/static/og.png`;
  const tx  = `${PUBLIC_BASE_URL}/frame/tx?fid=0`;
  const next= `${PUBLIC_BASE_URL}/f/0`;

  const html = `<!doctype html><html><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta property="og:title" content="WarpCat Debug"/>
    <meta property="og:type" content="website"/>
    <meta property="og:url" content="${next}"/>
    <meta property="og:image" content="${img}"/>
    <meta property="og:image:width" content="1024"/>
    <meta property="og:image:height" content="1024"/>
    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:image" content="${img}"/>

    <meta name="fc:frame" content="vNext"/>
    <meta name="fc:frame:image" content="${img}"/>
    <meta name="fc:frame:image:aspect_ratio" content="1:1"/>
    <meta name="fc:frame:button:1" content="Mint"/>
    <meta name="fc:frame:button:1:action" content="tx"/>
    <meta name="fc:frame:button:1:target" content="${tx}"/>
    <meta name="fc:frame:button:2" content="Refresh"/>
    <meta name="fc:frame:button:2:action" content="post"/>
    <meta name="fc:frame:post_url" content="${next}"/>

    <title>WarpCat Debug</title>
  </head><body></body></html>`;
  res.status(200)
     .set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, max-age=0'})
     .send(html);
});

/* Root & health */
app.get('/', (_req, res) => res.redirect(302, '/f/12345'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* Start */
app.listen(PORT, () => {
  console.log(`WarpCat listening on ${PUBLIC_BASE_URL}`);
});

