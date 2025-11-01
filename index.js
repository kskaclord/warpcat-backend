import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== Basit “kalıcı” kayıt (dosyada FID sakla) ========== */
// Not: Render Free'de disk kalıcı olmayabilir. Prod’da Redis/Upstash öneririm.
// Şimdilik demo için ./data/minted.json dosyasını kullanıyoruz.
const DATA_DIR = './data';
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MINTED_FILE)) fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids: [] }, null, 2));

function loadMinted() {
  try {
    return JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')).fids || [];
  } catch {
    return [];
  }
}
function saveMinted(fids) {
  fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids }, null, 2));
}

/* ========== Health ========== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, base: PUBLIC_BASE_URL });
});

/* ========== FRAME: Landing ========== */
app.get('/frame', (_req, res) => {
  const html = `
  <!doctype html>
  <html>
    <head>
      <meta property="og:title" content="Mint your WarpCat"/>
      <meta property="og:image" content="${PUBLIC_BASE_URL}/static/intro.png"/>
      <meta property="fc:frame" content="vNext"/>
      <meta property="fc:frame:button:1" content="Preview"/>
      <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/preview"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>WarpCat</title>
    </head>
    <body style="font-family:sans-serif;text-align:center;padding:40px;">
      <h1>WarpCat Frame</h1>
      <p>Click Preview to see your WarpCat</p>
    </body>
  </html>`;
  res.set('Content-Type', 'text/html').send(html);
});

/* ========== FRAME: Preview ========== */
app.post('/frame/preview', (req, res) => {
  // Warpcast formu (dev) veya gerçek frame payload’ı
  const fid =
    (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) ??
    req.body?.untrustedData?.fid ??
    0;

  const minted = loadMinted();
  const already = minted.includes(Number(fid));
  const imgIdx = Number(fid) % 5;

  // Button dinamiği: mintlenmişse “View” göster
  const buttonText = already ? 'Already Minted — View' : 'Mint';

  const html = `
  <!doctype html>
  <html>
    <head>
      <meta property="og:title" content="Your WarpCat Preview"/>
      <meta property="og:image" content="${PUBLIC_BASE_URL}/static/preview_${imgIdx}.png"/>
      <meta property="fc:frame" content="vNext"/>
      <meta property="fc:frame:button:1" content="${buttonText}"/>
      <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/mint"/>
    </head>
    <body><h1>WarpCat Preview (FID: ${fid})</h1></body>
  </html>`;
  res.set('Content-Type', 'text/html').send(html);
});

/* ========== FRAME: Mint (şimdilik kontratsız stub) ========== */
app.post('/frame/mint', (req, res) => {
  const fid =
    (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) ??
    req.body?.untrustedData?.fid ??
    0;

  const minted = loadMinted();
  const already = minted.includes(Number(fid));

  let title, image, button, postUrl;

  if (already) {
    // Zaten mintlemiş → “View” akışı (ileride token URL’si vereceğiz)
    title = 'Already Minted';
    image = `${PUBLIC_BASE_URL}/static/already.png`;
    button = 'Back';
    postUrl = `${PUBLIC_BASE_URL}/frame`;
  } else {
    // Burada GERÇEK MINT olacak (bir sonraki adım):
    // 1) Farcaster imzası doğrula
    // 2) Görsel + metadata üret → IPFS
    // 3) Base kontratında mint() çağır
    // Şimdilik “başarılı” kabul edip FID’i kaydediyoruz:
    minted.push(Number(fid));
    saveMinted(minted);

    title = 'WarpCat Minted';
    image = `${PUBLIC_BASE_URL}/static/thanks.png`;
    button = 'Back';
    postUrl = `${PUBLIC_BASE_URL}/frame`;
  }

  const html = `
  <!doctype html>
  <html>
    <head>
      <meta property="og:title" content="${title}"/>
      <meta property="og:image" content="${image}"/>
      <meta property="fc:frame" content="vNext"/>
      <meta property="fc:frame:button:1" content="${button}"/>
      <meta property="fc:frame:post_url" content="${postUrl}"/>
    </head>
    <body><h1>${title} (FID: ${fid})</h1></body>
  </html>`;
  res.set('Content-Type', 'text/html').send(html);
});

/* ========== Placeholder görseller ========== */
app.get('/static/:file', (req, res) => {
  const { file } = req.params;
  const colors = ['ff66cc', '66ccff', 'ccff66', 'ffd166', 'cdb4db'];

  if (file.startsWith('preview_')) {
    const idx = Number(file.match(/\d+/)?.[0] || 0) % colors.length;
    const hex = colors[idx];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
      <rect width='100%' height='100%' fill='#${hex}'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='#111'>WarpCat Preview</text>
    </svg>`;
    res.set('Content-Type', 'image/svg+xml').send(svg);
    return;
  }

  if (file === 'intro.png' || file === 'thanks.png' || file === 'already.png') {
    const label =
      file === 'intro.png'
        ? 'WarpCat — Tap to Preview'
        : file === 'thanks.png'
        ? 'Minted! 🎉'
        : 'Already Minted';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
      <rect width='100%' height='100%' fill='#2b2d42'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='#fff'>${label}</text>
    </svg>`;
    res.set('Content-Type', 'image/svg+xml').send(svg);
    return;
  }

  res.status(404).send('not found');
});

/* ========== Yerel /dev test sayfası ========== */
app.get('/dev', (_req, res) => {
  const html = `
  <!doctype html>
  <html>
  <head><meta charset="utf-8"><title>WarpCat Dev</title></head>
  <body style="font-family: Arial; padding:20px;">
    <h2>WarpCat — Yerel Test</h2>
    <p>Farcaster olmadan akışı dene.</p>

    <form action="/frame/preview" method="post" style="margin-bottom:20px;">
      <label>FID: <input name="untrustedData[fid]" value="12345" /></label>
      <button type="submit">Preview</button>
    </form>

    <form action="/frame/mint" method="post">
      <label>FID: <input name="untrustedData[fid]" value="12345" /></label>
      <button type="submit">Mint</button>
    </form>

    <p style="margin-top:30px;">
      <a href="/frame" target="_blank">/frame (OG meta)</a> |
      <a href="/health" target="_blank">/health</a>
    </p>
  </body>
  </html>`;
  res.set('Content-Type', 'text/html').send(html);
});

/* ========== Sunucu ========== */
app.listen(PORT, () => {
  console.log('WarpCat backend ' + PUBLIC_BASE_URL + '/frame üzerinde çalışıyor 😼');
});
