import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

/* -------------------- Paths & App -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* -------------------- Logging -------------------- */
app.use((req, _res, next) => {
  const ua = req.headers['user-agent'] || '';
  console.log(`[REQ] ${req.method} ${req.originalUrl} UA="${ua}"`);
  next();
});

/* -------------------- Config -------------------- */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const CHAIN_ID       = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453';
const CONTRACT_ADDR  = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI = process.env.MINT_PRICE_WEI || '5000000000000000'; // 0.005 ETH default

// Sende NEYNAR_APP_KEY var; ikisini de destekleyelim
const NEYNAR_API_KEY        = process.env.NEYNAR_API_KEY || process.env.NEYNAR_APP_KEY || '';
const NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET || '';
const NEYNAR_WEBHOOK_ID     = process.env.NEYNAR_WEBHOOK_ID || '';

/* -------------------- Helpers -------------------- */
// keccak256("mint(uint256)") -> 0xa0712d68
const MINT_SELECTOR = '0xa0712d68';

const toHex      = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : ('0x' + BigInt(n).toString(16));
const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));

function buildMintData(fidStr) {
  try {
    const fid = BigInt(fidStr || '0');
    return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
  } catch {
    return MINT_SELECTOR; // fail-soft
  }
}

/* Neynar Frames v2 doğrulama (opsiyonel) */
async function validateWithNeynar(payload) {
  try {
    if (!NEYNAR_API_KEY) return { ok: true }; // dev mod
    const r = await fetch('https://api.neynar.com/v2/frames/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api_key': NEYNAR_API_KEY },
      body: JSON.stringify(payload ?? {}),
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

/* -------------------- Static -------------------- */
const STATIC_DIR = path.join(__dirname, 'static');
if (fs.existsSync(STATIC_DIR)) {
  app.use('/static', express.static(STATIC_DIR, {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.png')  res.setHeader('Content-Type', 'image/png');
      if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
      if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
      if (ext === '.svg')  res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=600');
    }
  }));
}

/* -------------------- /.well-known/farcaster.json (dinamik) -------------------- */
app.get('/.well-known/farcaster.json', (_req, res) => {
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  const accountAssociation = {
    header:   "eyJmaWQiOjQ3MzM2NiwidHlwZSI6ImF1dGgiLCJrZXkiOiIweDIwNDQyMDNCZGFiZTE0ZTQwNUEyQTY4MTE2MjFkZTI0Njg4RTZlNjkifQ",
    payload:  "eyJkb21haW4iOiJ3YXJwY2F0Lnh5eiJ9",
    signature:"OexyLeUjG/iWJemqCMOgFObd8i3xwUUpaogl8eKtAoBS/mMy/2n1ZTYFICWojInbzCSkaSLLUD1/zB3e5Qiwwhw="
  };

  // ÖNEMLİ: homeUrl artık /mini/launch
  const miniapp = {
    version: "1",
    name: "WarpCat",
    description: "Mint your WarpCat NFT directly from Farcaster.",
    iconUrl: `${PUBLIC_BASE_URL}/static/og.png`,
    homeUrl: `${PUBLIC_BASE_URL}/mini/launch`,
    splashImageUrl: `${PUBLIC_BASE_URL}/static/og.png`,
    splashBackgroundColor: "#000000",
    splashTextColor: "#ffffff",
    ogTitle: "WarpCat — Mini App",
    ogImageUrl: `${PUBLIC_BASE_URL}/static/og.png`,
  };

  res.send(JSON.stringify({ accountAssociation, miniapp }, null, 2));
});

// (varsa) statik .well-known altını da servis et
const WELL_KNOWN_DIR = path.join(STATIC_DIR, '.well-known');
if (fs.existsSync(WELL_KNOWN_DIR)) {
  app.use('/.well-known', express.static(WELL_KNOWN_DIR, {
    setHeaders(res) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }));
}

/* -------------------- OpenSea Metadata -------------------- */
app.get('/metadata/:fid.json', async (req, res) => {
  const fid = String(req.params.fid || '0');

  const fallbackImage =
    fs.existsSync(path.join(STATIC_DIR, 'default.png'))
      ? `${PUBLIC_BASE_URL}/static/default.png`
      : `${PUBLIC_BASE_URL}/static/og.png`;

  try {
    const url = `https://client.warpcast.com/v2/user-by-fid?fid=${encodeURIComponent(fid)}`;
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    let username = `user-${fid}`;
    let displayName = `WarpCat #${fid}`;
    let pfp = fallbackImage;

    if (r.ok) {
      const j = await r.json();
      const u = j?.result?.user;
      if (u?.username)     username    = u.username;
      if (u?.displayName)  displayName = u.displayName;
      if (u?.pfp?.url)     pfp         = u.pfp.url;
    }

    const metadata = {
      name: `WarpCat #${fid}`,
      description: `WarpCat NFT linked to Farcaster user @${username}`,
      image: pfp,
      external_url: `https://warpcast.com/${username}`,
      attributes: [
        { trait_type: 'FID', value: fid },
        { trait_type: 'Username', value: username },
        { trait_type: 'Collection', value: 'WarpCat' },
      ],
    };

    res.status(200).set({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    }).send(JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error('metadata error', err);
    const metadata = {
      name: `WarpCat #${fid}`,
      description: `WarpCat NFT`,
      image: fallbackImage,
      external_url: `${PUBLIC_BASE_URL}`,
      attributes: [{ trait_type: 'FID', value: fid }],
    };
    res.status(200).set({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    }).send(JSON.stringify(metadata, null, 2));
  }
});

/* -------------------- Launch Embed (Mini App) -------------------- */
/**
 * /mini/launch → Mini App’ı açar (Open).
 * Embed Tool bu sayfayı “Embed Valid ✅” olarak görür.
 */
function renderLaunchEmbed() {
  const image = `${PUBLIC_BASE_URL}/static/og.png`;
  const frame = {
    version: 'next',
    imageUrl: image,
    button: {
      title: 'Open',
      action: {
        type: 'launch_frame',
        name: 'WarpCat',
        url: `${PUBLIC_BASE_URL}/frame/mint`, // mini app içinden mint frame’e de gidebilirsin
        splashImageUrl: image,
        splashBackgroundColor: '#000000',
      },
    },
  };

  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta property="og:title" content="WarpCat — Open Mini App"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${PUBLIC_BASE_URL}/mini/launch"/>
<meta property="og:image" content="${image}"/>
<meta property="og:image:width" content="1024"/>
<meta property="og:image:height" content="1024"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="${image}"/>
<meta name="fc:frame" content='${JSON.stringify(frame)}'/>
<title>WarpCat Launch</title>
</head>
<body style="margin:0;background:#000;"></body>
</html>`;
}
app.get('/mini/launch', (_req, res) => {
  res.status(200).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
  }).send(renderLaunchEmbed());
});
/* ===================== [EKLE] Mini App (web sayfası) ===================== */
// Basit, şık bir sayfa: logo, FID göstergesi, Mint ve Refresh butonları.
// İçeride sdk.actions.ready() çağrısı var; siyah ekran kalkar.
function renderMiniAppPage({ fid }) {
  const image = `${PUBLIC_BASE_URL}/static/og.png`;
  const safeFid = String(fid || '0');
  const txUrl = `${PUBLIC_BASE_URL}/mini/tx?fid=${encodeURIComponent(safeFid)}`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>WarpCat — Mini App</title>
<link rel="preload" as="image" href="${image}">
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#000; color:#fff; font:16px/1.4 system-ui, -apple-system, Segoe UI, Roboto; }
  .wrap { min-height:100dvh; display:grid; place-items:center; padding:24px; }
  .card { width:100%; max-width:460px; border-radius:20px; background:#0b0b0b; border:1px solid #222; box-shadow:0 8px 40px rgba(0,0,0,.35); }
  .hero { padding:28px 28px 0; text-align:center; }
  .hero img { width:120px; height:120px; border-radius:16px; display:block; margin:0 auto 14px; }
  .hero h1 { margin:6px 0 4px; font-size:22px; font-weight:700; letter-spacing:.2px; }
  .hero p { margin:0; opacity:.75; font-size:13px; }
  .body { padding:22px 24px 24px; }
  .row { display:flex; gap:12px; }
  .btn { flex:1; padding:14px 16px; font-weight:700; border-radius:14px; border:1px solid #2a2a2a; background:#1a1a1a; color:#fff; cursor:pointer; }
  .btn:hover { background:#222; }
  .btn.primary { background:linear-gradient(180deg, #3b82f6, #4338ca); border-color:#3b82f6; }
  .note { margin-top:14px; font-size:12px; opacity:.7; text-align:center; }
  .pill { display:inline-block; padding:4px 10px; border:1px solid #2a2a2a; border-radius:999px; font-size:12px; opacity:.9; }
</style>
<script type="module">
  import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.2.1';

  // Splash'ı kaldır
  (async () => {
    try { await sdk.actions.ready(); } catch(e) { console.warn('ready() failed', e); }
  })();

  async function doMint() {
    try {
      // backend'den tx payload al
      const res = await fetch('${txUrl}', { method: 'GET', headers: { 'cache-control':'no-cache' } });
      if (!res.ok) throw new Error('tx endpoint failed');
      const tx = await res.json();

      // Warpcast Mini App içinde transaction isteği (postMessage pattern)
      // Warpcast bu formatı anlar (eth_sendTransaction).
      window.parent?.postMessage({ type: 'warp_sendTransaction', data: tx }, '*');
    } catch (e) {
      alert('Mint başlatılamadı: ' + (e && e.message ? e.message : e));
    }
  }

  function doRefresh() {
    location.reload();
  }

  window.__WC_APP__ = { doMint, doRefresh };
</script>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <img src="${image}" alt="WarpCat"/>
        <h1>WarpCat — Mint</h1>
        <p>1 FID = 1 NFT • Base 🔵</p>
        <p style="margin-top:8px"><span class="pill">FID: ${safeFid}</span></p>
      </div>
      <div class="body">
        <div class="row">
          <button class="btn primary" onclick="__WC_APP__.doMint()">✨ Mint</button>
          <button class="btn" onclick="__WC_APP__.doRefresh()">Refresh</button>
        </div>
        <div class="note">Cüzdan mini pencerede gözükür; onaylayınca mint tamamlanır.</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* [EKLE] Mini App route */
app.get('/mini/app', (req, res) => {
  const fid = String(req.query.fid || '0');
  res
    .status(200)
    .set({ 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' })
    .send(renderMiniAppPage({ fid }));
});

/* -------------------- Frame (Mint) -------------------- */
function renderMintFrame({ fid }) {
  const image   = `${PUBLIC_BASE_URL}/static/og.png`;
  const postUrl = `${PUBLIC_BASE_URL}/frame/mint?fid=${encodeURIComponent(fid)}`;
  const txUrl   = `${PUBLIC_BASE_URL}/mini/tx?fid=${encodeURIComponent(fid)}`;

  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="fc:frame" content="vNext"/>

<meta property="og:title" content="WarpCat — Mint"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${postUrl}"/>
<meta property="og:image" content="${image}"/>
<meta property="og:image:width" content="1024"/>
<meta property="og:image:height" content="1024"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="${image}"/>

<meta name="fc:frame:image" content="${image}"/>
<meta name="fc:frame:image:aspect_ratio" content="1:1"/>

<meta name="fc:frame:button:1" content="Mint"/>
<meta name="fc:frame:button:1:action" content="tx"/>
<meta name="fc:frame:button:1:target" content="${txUrl}"/>

<meta name="fc:frame:button:2" content="Refresh"/>
<meta name="fc:frame:button:2:action" content="post"/>

<meta name="fc:frame:post_url" content="${postUrl}"/>
<title>WarpCat Frame</title>
</head><body style="margin:0;background:#000"></body></html>`;
}

async function handleMintFrame(req, res) {
  const fid = String(req.query.fid || req.body?.fid || '0');
  if (req.method === 'POST') {
    const v = await validateWithNeynar(req.body || {});
    if (!v.ok) return res.status(401).json({ error: 'neynar_validation_failed' });
  }
  res.status(200).set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).send(renderMintFrame({ fid }));
}
app.get('/frame/mint', handleMintFrame);
app.post('/frame/mint', handleMintFrame);

/* -------------------- TX (Frames v2) -------------------- */
async function handleTx(req, res) {
  if (req.method === 'POST') {
    const v = await validateWithNeynar(req.body || {});
    if (!v.ok) return res.status(401).json({ error: 'neynar_validation_failed' });
  }
  if (!CONTRACT_ADDR) return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });

  const fid = String(
    req.query.fid ||
    req.body?.fid ||
    req.body?.untrustedData?.fid || '0'
  );

  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDR,
      data: buildMintData(fid),
      value: toHex(MINT_PRICE_WEI),
    },
  };

  res.status(200).set({ 'Cache-Control': 'no-store, max-age=0' }).json(tx);
}
app.get('/mini/tx', handleTx);
app.post('/mini/tx', handleTx);

/* -------------------- Neynar Webhook -------------------- */
app.post('/neynar/webhook', (req, res) => {
  try {
    const bodyStr   = JSON.stringify(req.body || {});
    const signature = req.headers['x-neynar-signature'];

    if (NEYNAR_WEBHOOK_SECRET) {
      const expected = crypto.createHmac('sha256', NEYNAR_WEBHOOK_SECRET).update(bodyStr).digest('hex');
      if (signature !== expected) {
        console.warn('[NEYNAR WEBHOOK] ❌ invalid signature');
        return res.status(401).json({ ok: false, error: 'invalid_signature' });
      }
    } else {
      console.warn('[NEYNAR WEBHOOK] warning: no secret set, accepting without verification');
    }

    const type = req.body?.type || 'unknown';
    console.log('[NEYNAR WEBHOOK] ✅', type, bodyStr.slice(0, 1500));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[NEYNAR WEBHOOK] error', e);
    return res.status(200).json({ ok: true }); // fail-soft
  }
});

/* -------------------- Health & root -------------------- */
app.get('/', (_req, res) => res.redirect(302, '/mini/launch'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* -------------------- Start -------------------- */
app.listen(PORT, () => {
  console.log(`WarpCat listening on ${PUBLIC_BASE_URL}`);
});

