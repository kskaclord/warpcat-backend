import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== Basit kalıcı kayıt (FID limiti) ========== */
const DATA_DIR = './data';
const MINTED_FILE = path.join(DATA_DIR, 'minted.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MINTED_FILE)) fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids: [] }, null, 2));
const loadMinted = () => JSON.parse(fs.readFileSync(MINTED_FILE, 'utf8')).fids || [];
const saveMinted = (fids) => fs.writeFileSync(MINTED_FILE, JSON.stringify({ fids }, null, 2));

/* ========== Deterministik RNG (FID’den) ========== */
function prngFromFid(fid) {
  const h = crypto.createHash('sha256').update(String(fid)).digest('hex');
  let i = 0;
  return () => {
    const chunk = h.slice(i, i + 8);
    i = (i + 8) % h.length;
    return parseInt(chunk || '0', 16) / 0xffffffff;
  };
}
function pickOne(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/* ========== WarpCat SVG Üretici ========== */
function renderWarpCatSVG(fid) {
  const rng = prngFromFid(fid);

  // Renk paletleri (mor-sarı ağırlıklı + birkaç cyber ton)
  const palettes = [
    { bg1:'#2e026d', bg2:'#8b5cf6', accent:'#ffd166' }, // mor → lila + sarı accent
    { bg1:'#1b1b3a', bg2:'#6a00f4', accent:'#f5d90a' },
    { bg1:'#190b28', bg2:'#7c3aed', accent:'#f59e0b' },
    { bg1:'#111827', bg2:'#8b5cf6', accent:'#fbbf24' },
    { bg1:'#201a31', bg2:'#9333ea', accent:'#fde047' }
  ];
  const pal = pickOne(rng, palettes);

  // Trait setleri (deterministik)
  const eyeStyles = ['normal','sleepy','sharp'];          // göz
  const glasses   = ['none','round','visor','aviator'];   // gözlük
  const hats      = ['none','beanie','cap','headset'];    // başlık
  const necks     = ['none','scarf','chain'];             // aksesuar
  const furs      = ['short','smooth','long'];            // tüy

  const trait = {
    eyes:    pickOne(rng, eyeStyles),
    glasses: pickOne(rng, glasses),
    hat:     pickOne(rng, hats),
    neck:    pickOne(rng, necks),
    fur:     pickOne(rng, furs)
  };

  // Boyutlar
  const W = 1200, H = 630;
  // Basit yardımcı çizimler
  const EARS = `
    <path d="M340,210 L420,80 L460,220 Z" fill="#2b2b2b" stroke="#111" stroke-width="6"/>
    <path d="M760,210 L680,80 L640,220 Z" fill="#2b2b2b" stroke="#111" stroke-width="6"/>
  `;
  const HEAD = `
    <ellipse cx="600" cy="340" rx="260" ry="210" fill="#2f2f2f" stroke="#111" stroke-width="8"/>
  `;
  const EYES = (() => {
    let leftPupilX = 520, rightPupilX = 680, y=340;
    let eyeBase = `
      <ellipse cx="520" cy="${y}" rx="60" ry="40" fill="#ffffff"/>
      <ellipse cx="680" cy="${y}" rx="60" ry="40" fill="#ffffff"/>
    `;
    if (trait.eyes === 'sleepy') {
      eyeBase += `
        <path d="M460 ${y} Q520 ${y+20} 580 ${y}" stroke="#111" stroke-width="6" fill="none"/>
        <path d="M620 ${y} Q680 ${y+20} 740 ${y}" stroke="#111" stroke-width="6" fill="none"/>
      `;
    }
    if (trait.eyes === 'sharp') {
      eyeBase += `
        <path d="M455 ${y-15} L585 ${y-5}" stroke="#111" stroke-width="6"/>
        <path d="M615 ${y-5} L745 ${y-15}" stroke="#111" stroke-width="6"/>
      `;
    }
    const pupils = `
      <circle cx="${leftPupilX}" cy="${y}" r="14" fill="#111"/>
      <circle cx="${rightPupilX}" cy="${y}" r="14" fill="#111"/>
    `;
    return eyeBase + pupils;
  })();

  const GLASSES = (() => {
    if (trait.glasses === 'none') return '';
    if (trait.glasses === 'round') {
      return `
        <circle cx="520" cy="340" r="70" fill="none" stroke="${pal.accent}" stroke-width="10"/>
        <circle cx="680" cy="340" r="70" fill="none" stroke="${pal.accent}" stroke-width="10"/>
        <rect x="520" y="336" width="160" height="8" fill="${pal.accent}"/>
      `;
    }
    if (trait.glasses === 'visor') {
      return `
        <rect x="460" y="300" width="280" height="80" rx="20" fill="${pal.accent}" opacity="0.85"/>
        <rect x="445" y="320" width="20" height="14" fill="${pal.accent}"/>
        <rect x="740" y="320" width="20" height="14" fill="${pal.accent}"/>
      `;
    }
    if (trait.glasses === 'aviator') {
      return `
        <path d="M460,320 Q520,280 580,320 Q520,360 460,320 Z" fill="none" stroke="${pal.accent}" stroke-width="8"/>
        <path d="M740,320 Q680,280 620,320 Q680,360 740,320 Z" fill="none" stroke="${pal.accent}" stroke-width="8"/>
        <rect x="580" y="330" width="40" height="6" fill="${pal.accent}"/>
      `;
    }
    return '';
  })();

  const HAT = (() => {
    if (trait.hat === 'none') return '';
    if (trait.hat === 'beanie') {
      return `
        <path d="M420,220 Q600,120 780,220 L780,250 Q600,210 420,250 Z" fill="#1f2937" stroke="#111" stroke-width="6"/>
        <rect x="420" y="240" width="360" height="30" fill="${pal.accent}" />
      `;
    }
    if (trait.hat === 'cap') {
      return `
        <path d="M420,230 Q600,150 780,230 L780,250 Q600,210 420,250 Z" fill="#111827" stroke="#111" stroke-width="6"/>
        <path d="M740,250 Q820,270 840,290 Q760,290 720,270 Z" fill="#1f2937"/>
      `;
    }
    if (trait.hat === 'headset') {
      return `
        <path d="M430,260 Q600,120 770,260" stroke="${pal.accent}" stroke-width="22" fill="none"/>
        <rect x="410" y="270" width="50" height="90" rx="10" fill="#2b2b2b" stroke="#111" stroke-width="4"/>
        <rect x="740" y="270" width="50" height="90" rx="10" fill="#2b2b2b" stroke="#111" stroke-width="4"/>
      `;
    }
    return '';
  })();

  const NECK = (() => {
    if (trait.neck === 'none') return '';
    if (trait.neck === 'scarf') {
      return `
        <path d="M460,460 Q600,520 740,460 L720,500 Q600,540 480,500 Z" fill="${pal.accent}" stroke="#111" stroke-width="6"/>
      `;
    }
    if (trait.neck === 'chain') {
      return `
        <path d="M480,470 Q600,520 720,470" stroke="${pal.accent}" stroke-width="10" fill="none"/>
        <path d="M520,490 Q600,540 680,490" stroke="${pal.accent}" stroke-width="10" fill="none" opacity="0.7"/>
      `;
    }
    return '';
  })();

  const FUR_DECOR = trait.fur === 'long'
    ? `<path d="M360,360 Q600,600 840,360" stroke="#3b3b3b" stroke-width="10" fill="none" opacity="0.5"/>`
    : trait.fur === 'smooth'
    ? `<path d="M380,380 Q600,560 820,380" stroke="#3b3b3b" stroke-width="6" fill="none" opacity="0.4"/>`
    : '';

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal.bg1}"/>
        <stop offset="100%" stop-color="${pal.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <!-- Neon grid / aura -->
    <g opacity="0.20" stroke="#ffffff">
      <path d="M0 540 L1200 540" />
      <path d="M0 480 L1200 480" />
      <path d="M0 420 L1200 420" />
    </g>

    ${EARS}
    ${HEAD}
    ${FUR_DECOR}
    ${EYES}
    ${GLASSES}
    ${HAT}
    ${NECK}

    <!-- Title -->
    <text x="50%" y="80" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="44" opacity="0.9">
      WarpCat • FID ${fid}
    </text>
  </svg>`;
}

/* ========== HEALTH ========== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, base: PUBLIC_BASE_URL });
});

/* ========== FRAME: Landing ========== */
app.get('/frame', (_req, res) => {
  const html = `
  <!doctype html><html><head>
    <meta property="og:title" content="Mint your WarpCat"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/static/intro.png"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Preview"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/preview"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>WarpCat</title>
  </head><body style="font-family:sans-serif;text-align:center;padding:40px;">
    <h1>WarpCat Frame</h1>
    <p>Click Preview to see your WarpCat</p>
  </body></html>`;
  res.set('Content-Type','text/html').send(html);
});

/* ========== FRAME: Preview → Artık dinamik SVG ==========
   og:image olarak /img/preview/:fid.svg kullanıyoruz
========================================================== */
app.post('/frame/preview', (req, res) => {
  const fid =
    (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) ??
    req.body?.untrustedData?.fid ?? 0;

  const minted = loadMinted();
  const already = minted.includes(Number(fid));
  const buttonText = already ? 'Already Minted — View' : 'Mint';

  const html = `
  <!doctype html><html><head>
    <meta property="og:title" content="Your WarpCat Preview"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/img/preview/${fid}.svg"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="${buttonText}"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/mint"/>
  </head><body><h1>WarpCat Preview (FID: ${fid})</h1></body></html>`;
  res.set('Content-Type','text/html').send(html);
});

/* ========== FRAME: Mint (şimdilik FID limiti + stub) ========== */
app.post('/frame/mint', (req, res) => {
  const fid =
    (req.body && (req.body['untrustedData[fid]'] || req.body.fid)) ??
    req.body?.untrustedData?.fid ?? 0;

  const minted = loadMinted();
  const already = minted.includes(Number(fid));

  let title, image, button, postUrl;
  if (already) {
    title = 'Already Minted';
    image = `${PUBLIC_BASE_URL}/static/already.png`;
    button = 'Back';
    postUrl = `${PUBLIC_BASE_URL}/frame`;
  } else {
    minted.push(Number(fid));
    saveMinted(minted);
    title = 'WarpCat Minted';
    image = `${PUBLIC_BASE_URL}/static/thanks.png`;
    button = 'Back';
    postUrl = `${PUBLIC_BASE_URL}/frame`;
  }

  const html = `
  <!doctype html><html><head>
    <meta property="og:title" content="${title}"/>
    <meta property="og:image" content="${image}"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="${button}"/>
    <meta property="fc:frame:post_url" content="${postUrl}"/>
  </head><body><h1>${title} (FID: ${fid})</h1></body></html>`;
  res.set('Content-Type','text/html').send(html);
});

/* ========== Dinamik SVG endpoint ========== */
app.get('/img/preview/:fid.svg', (req, res) => {
  const fid = Number(req.params.fid || 0);
  const svg = renderWarpCatSVG(fid);
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

/* ========== Basit placeholder PNG/SVG’ler ========== */
app.get('/static/:file', (req, res) => {
  const { file } = req.params;
  if (file === 'intro.png' || file === 'thanks.png' || file === 'already.png') {
    const label = file === 'intro.png' ? 'WarpCat — Tap to Preview'
                : file === 'thanks.png' ? 'Minted! 🎉'
                : 'Already Minted';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
      <rect width='100%' height='100%' fill='#2b2d42'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
        font-size='64' fill='#fff'>${label}</text>
    </svg>`;
    res.set('Content-Type','image/svg+xml').send(svg);
    return;
  }
  res.status(404).send('not found');
});

/* ========== /dev test sayfası ========== */
app.get('/dev', (_req, res) => {
  const html = `
  <!doctype html><html><head><meta charset="utf-8"><title>WarpCat Dev</title></head>
  <body style="font-family: Arial; padding:20px;">
    <h2>WarpCat — Yerel Test</h2>
    <p>Farcaster olmadan akışı dene. Preview artık SVG üretir.</p>

    <form action="/frame/preview" method="post" style="margin-bottom:20px;">
      <label>FID: <input name="untrustedData[fid]" value="12345" /></label>
      <button type="submit">Preview</button>
    </form>

    <form action="/frame/mint" method="post">
      <label>FID: <input name="untrustedData[fid]" value="12345" /></label>
      <button type="submit">Mint</button>
    </form>

    <p style="margin-top:30px;">
      <a href="/img/preview/12345.svg" target="_blank">örnek SVG (12345)</a> |
      <a href="/frame" target="_blank">/frame</a> |
      <a href="/health" target="_blank">/health</a>
    </p>
  </body></html>`;
  res.set('Content-Type','text/html').send(html);
});

/* ========== Sunucu ========== */
app.listen(PORT, () => {
  console.log('WarpCat backend ' + PUBLIC_BASE_URL + '/frame üzerinde çalışıyor 😼');
});
