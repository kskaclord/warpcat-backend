import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 8080;
// Backtick yerine klasik birleştirme kullandık:
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ("http://localhost:" + PORT);

// Body parsers
app.use(express.json());
// /dev formundan gelen application/x-www-form-urlencoded postları için:
app.use(express.urlencoded({ extended: true }));

/* === Health check === */
app.get('/health', (req, res) => {
  res.json({ ok: true, base: PUBLIC_BASE_URL });
});

/* === Ana Frame === */
app.get('/frame', (req, res) => {
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
  </html>
  `;
  res.set('Content-Type', 'text/html').send(html);
});

/* === Preview Adımı === */
app.post('/frame/preview', (req, res) => {
  const fid = (req.body && req.body['untrustedData[fid]']) || req.body?.untrustedData?.fid || 0;
  const html = `
  <!doctype html>
  <html>
  <head>
    <meta property="og:title" content="Your WarpCat Preview"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/static/preview_${Number(fid) % 5}.png"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Mint"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame/mint"/>
  </head>
  <body>
    <h1>WarpCat Preview</h1>
  </body>
  </html>
  `;
  res.set('Content-Type', 'text/html').send(html);
});

/* === Mint Adımı === */
app.post('/frame/mint', (req, res) => {
  const html = `
  <!doctype html>
  <html>
  <head>
    <meta property="og:title" content="WarpCat Minted"/>
    <meta property="og:image" content="${PUBLIC_BASE_URL}/static/thanks.png"/>
    <meta property="fc:frame" content="vNext"/>
    <meta property="fc:frame:button:1" content="Back"/>
    <meta property="fc:frame:post_url" content="${PUBLIC_BASE_URL}/frame"/>
  </head>
  <body>
    <h1>Mint complete!</h1>
  </body>
  </html>
  `;
  res.set('Content-Type', 'text/html').send(html);
});

/* === Basit renkli placeholder görseller === */
app.get('/static/:file', (req, res) => {
  const { file } = req.params;
  const colors = ["ff66cc","66ccff","ccff66","ffd166","cdb4db"];
  if (file.startsWith("preview_")) {
    const idx = Number(file.match(/\d+/)?.[0] || 0) % colors.length;
    const hex = colors[idx];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
      <rect width='100%' height='100%' fill='#${hex}'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='#111'>WarpCat Preview</text>
    </svg>`;
    res.set('Content-Type','image/svg+xml').send(svg);
    return;
  }
  if (file === 'intro.png' || file === 'thanks.png') {
    const label = file === 'intro.png' ? 'WarpCat — Tap to Preview' : 'Thanks!';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
      <rect width='100%' height='100%' fill='#2b2d42'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='#fff'>${label}</text>
    </svg>`;
    res.set('Content-Type','image/svg+xml').send(svg);
    return;
  }
  res.status(404).send('not found');
});

/* === Yerel test sayfası === */
app.get('/dev', (req, res) => {
  const html = `
  <!doctype html>
  <html>
  <head><meta charset="utf-8"><title>WarpCat Dev</title></head>
  <body style="font-family: Arial; padding:20px;">
    <h2>WarpCat — Yerel Test</h2>
    <p>Bu sayfadan Farcaster Frames olmadan buton akışını test edebilirsin.</p>

    <form action="/frame/preview" method="post" style="margin-bottom:20px;">
      <label>FID:
        <input name="untrustedData[fid]" value="12345" />
      </label>
      <button type="submit">Preview</button>
    </form>

    <form action="/frame/mint" method="post">
      <label>FID:
        <input name="untrustedData[fid]" value="12345" />
      </label>
      <button type="submit">Mint</button>
    </form>

    <p style="margin-top:30px;">
      <a href="/frame" target="_blank">/frame (OG meta sayfası)</a> |
      <a href="/health" target="_blank">/health</a>
    </p>
  </body>
  </html>
  `;
  res.set('Content-Type','text/html').send(html);
});

/* === Sunucu Başlat === */
app.listen(PORT, () => {
  console.log("WarpCat backend " + PUBLIC_BASE_URL + "/frame üzerinde çalışıyor 😼");
});
