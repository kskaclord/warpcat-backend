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
// ---- Allow Warpcast to embed this page
app.use((req, res, next) => {
  // Bazı platformlar otomatik basabiliyor, önce temizleyelim
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');

  // İzinli çerçeve ataları: Warpcast/Farcaster + self
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.warpcast.com https://*.farcaster.xyz"
  );

  // Bazı proxy’ler XFO arıyor; boş geçmek yerine hiç koymamak daha iyi ama
  // olur da eklenirse etkisizleşsin diye boş set edelim
  res.setHeader('X-Frame-Options', '');

  // Mini App dokümanları bunu öneriyor
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

});

/* Log */
app.use((req, _res, next) => {
  const ua = req.headers['user-agent'] || '';
  console.log(`[REQ] ${req.method} ${req.originalUrl} UA="${ua}"`);
  next();
});

/* -------------------- Static -------------------- */
const STATIC_DIR = path.join(__dirname, 'static');

if (fs.existsSync(STATIC_DIR)) {
  // /.well-known/farcaster.json — manifest
  app.get('/.well-known/farcaster.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.json({
      accountAssociation: {
        header:   "eyJmaWQiOjQ3MzM2NiwidHlwZSI6ImF1dGgiLCJrZXkiOiIweDIwNDQyMDNCZGFiZTE0ZTQwNUEyQTY4MTE2MjFkZTI0Njg4RTZlNjkifQ",
        payload:  "eyJkb21haW4iOiJ3YXJwY2F0Lnh5eiJ9",
        signature:"OexyLeUjG/iWJemqCMOgFObd8i3xwUUpaogl8eKtAoBS/mMy/2n1ZTYFICWojInbzCSkaSLLUD1/zB3e5Qiwwhw="
      },
      miniapp: {
        version: "1", // <— Farcaster “1” istiyor; valid
        name: "WarpCat",
        description: "Mint your WarpCat NFT directly from Farcaster.",
        iconUrl: "https://warpcat.xyz/static/og.png",
        homeUrl: "https://warpcat.xyz/mini/frame",
        splashImageUrl: "https://warpcat.xyz/static/og.png",
        splashBackgroundColor: "#000000",
        splashTextColor: "#ffffff"
      }
    });
  });

  // /static — genel statikler
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

  // /.well-known (statik klasör varsa)
  const WELL_KNOWN_DIR = path.join(STATIC_DIR, '.well-known');
  if (fs.existsSync(WELL_KNOWN_DIR)) {
    app.use('/.well-known', express.static(WELL_KNOWN_DIR, {
      setHeaders(res) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    }));
  }
}

/* -------------------- Config -------------------- */
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
  `http://localhost:${PORT}`;

const CHAIN_ID         = process.env.CHAIN_ID ? `eip155:${process.env.CHAIN_ID}` : 'eip155:8453';
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
const MINT_PRICE_WEI   = process.env.MINT_PRICE_WEI || '0';
const MINT_SELECTOR    = (process.env.MINT_SELECTOR || '').toLowerCase(); // 0x........ (4 byte) veya boş
const NEYNAR_API_KEY   = process.env.NEYNAR_API_KEY || '';

const NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET || ''; // opsiyonel
const NEYNAR_WEBHOOK_ID     = process.env.NEYNAR_WEBHOOK_ID || '';     // opsiyonel

/* -------------------- Helpers -------------------- */
const toHex = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : ('0x' + BigInt(n).toString(16));
const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));

function buildMintData(fidStr) {
  if (!MINT_SELECTOR) return '0x';
  if (!/^0x[0-9a-f]{8}$/i.test(MINT_SELECTOR)) return '0x';
  try {
    const fid = BigInt(fidStr || '0');
    return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase();
  } catch {
    return MINT_SELECTOR;
  }
}

/* Neynar Frames v2 doğrulama (opsiyonel) */
async function validateWithNeynar(payload) {
  try {
    if (!NEYNAR_API_KEY) return { ok: true }; // dev mod
    const r = await fetch('https://api.neynar.com/v2/frames/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api_key': NEYNAR_API_KEY },
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

/* -------------------- DYNAMIC METADATA -------------------- */
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
      if (u?.username)     username   = u.username;
      if (u?.displayName)  displayName = u.displayName;
      if (u?.pfp?.url)     pfp        = u.pfp.url;
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

    res
      .status(200)
      .set({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      })
      .send(JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error('metadata error', err);
    const metadata = {
      name: `WarpCat #${fid}`,
      description: `WarpCat NFT`,
      image: fallbackImage,
      external_url: `${PUBLIC_BASE_URL}`,
      attributes: [{ trait_type: 'FID', value: fid }],
    };
    res
      .status(200)
      .set({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      })
      .send(JSON.stringify(metadata, null, 2));
  }
});

/* -------------------- MINI APP FRAME -------------------- */
function renderMiniFrame({ fid }) {
  const image    = `${PUBLIC_BASE_URL}/static/og.png`;
  const txUrl    = `${PUBLIC_BASE_URL}/mini/tx?fid=${encodeURIComponent(fid)}`;
  const postUrl  = `${PUBLIC_BASE_URL}/mini/frame?fid=${encodeURIComponent(fid)}`;
  const ogUrl    = `${PUBLIC_BASE_URL}/mini/frame`; // 👈 parametresiz

  return `<!doctype html><html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="fc:frame" content="vNext"/>

  <meta property="og:title" content="WarpCat Mint"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${ogUrl}"/>                        <!-- parametresiz -->
  <meta property="og:image" content="${image}"/>
  <meta property="og:image:width" content="1024"/>
  <meta property="og:image:height" content="1024"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:image" content="${image}"/>

  <!-- Frame UI -->
  <meta name="fc:frame:image" content="${image}"/>
  <meta name="fc:frame:image:aspect_ratio" content="1:1"/>

  <meta name="fc:frame:button:1" content="Mint"/>
  <meta name="fc:frame:button:1:action" content="tx"/>
  <meta name="fc:frame:button:1:target" content="${txUrl}"/>

  <meta name="fc:frame:button:2" content="Refresh"/>
  <meta name="fc:frame:button:2:action" content="post"/>

  <meta name="fc:frame:post_url" content="${postUrl}"/>               <!-- fid’li -->
  <title>WarpCat Mini</title>
  <style>
    html,body{margin:0;padding:0;background:#000;height:100%;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto}
    .wrap{min-height:100%;display:grid;place-items:center}
    .card{text-align:center;opacity:.9}
    .card img{width:160px;height:160px;border-radius:24px}
    .hint{margin-top:12px;font-size:14px;color:#bdbdbd}
    .links{margin-top:14px}
    .links a{color:#9cf;text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <img src="${image}" alt="WarpCat"/>
      <div class="hint">Tap <b>Mint</b> to send the transaction • FID: ${fid}</div>
      <div class="links"><a href="${postUrl}">Refresh</a></div>
    </div>
  </div>

  <!-- Mini App SDK: splash’i kapatmak için ready() -->
  <script type="module">
    import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk';
    const onReady = async () => { try { await sdk.actions.ready(); } catch(_) {} };
    if (document.readyState === 'complete') onReady();
    else window.addEventListener('load', onReady);
  </script>
</body></html>`;
}

/* GET/POST — Mini frame endpoint */
async function handleMiniFrame(req, res) {
  const fid = String(req.query.fid || req.body?.fid || '0');

  if (req.method === 'POST') {
    const v = await validateWithNeynar(req.body || {});
    if (!v.ok) return res.status(401).json({ error: 'neynar_validation_failed' });
  }

  const html = renderMiniFrame({ fid });

  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      // Güvenlik başlıkları yukarıdaki global middleware’den zaten geliyor,
      // ama proxy/cache bypass için burada da boş geçiyoruz:
      'X-Frame-Options': '',
      'Content-Security-Policy': "frame-ancestors 'self' https://*.warpcast.com https://*.farcaster.xyz",
    })
    .send(html);
}
app.get('/mini/frame', handleMiniFrame);
app.post('/mini/frame', handleMiniFrame);


/* -------------------- TX (Frames v2) -------------------- */
async function handleTx(req, res) {
  if (req.method === 'POST') {
    const v = await validateWithNeynar(req.body || {});
    if (!v.ok) return res.status(401).json({ error: 'neynar_validation_failed' });
  }

  if (!CONTRACT_ADDRESS) {
    return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
  }

  const fid = String(req.query.fid || req.body?.fid || '0');
  const tx = {
    chainId: CHAIN_ID,
    method: 'eth_sendTransaction',
    params: {
      to: CONTRACT_ADDRESS,
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
      const expected = crypto
        .createHmac('sha256', NEYNAR_WEBHOOK_SECRET)
        .update(bodyStr)
        .digest('hex');

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
app.get('/', (_req, res) => res.redirect(302, '/mini/frame?fid=12345'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* -------------------- Start -------------------- */
app.listen(PORT, () => {
  console.log(`WarpCat listening on ${PUBLIC_BASE_URL}`);
});




