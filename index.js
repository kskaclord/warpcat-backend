    import 'dotenv/config';
    import express from 'express';
    import fs from 'fs';
    import path from 'path';
    import { fileURLToPath } from 'url';

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const app = express();
    app.set('trust proxy', true);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    /* -------- Config -------- */
    const PORT = Number(process.env.PORT || 8080);
    const PUBLIC_BASE_URL =
      (process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.replace(/\/$/, '')) ||
      ('http://localhost:' + PORT);

    const CHAIN_ID_NUM   = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 8453; // base
    const CHAIN_ID       = 'eip155:' + CHAIN_ID_NUM;
    const CONTRACT_ADDR  = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
    const MINT_PRICE_WEI = process.env.MINT_PRICE_WEI || '5000000000000000'; // 0.005

    const NEYNAR_API_KEY        = process.env.NEYNAR_API_KEY || '';
    const NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET || '';

    /* -------- Utils -------- */
    const MINT_SELECTOR = '0xa0712d68'; // keccak256("mint(uint256)")
    const toHex = (n) => (typeof n === 'string' && n.startsWith('0x')) ? n : ('0x' + BigInt(n).toString(16));
    const uint256Hex = (n) => ('0x' + BigInt(n).toString(16).padStart(64, '0'));
    const buildMintData = (fidStr) => {
      try { const fid = BigInt(fidStr || '0'); return (MINT_SELECTOR + uint256Hex(fid).slice(2)).toLowerCase(); }
      catch { return MINT_SELECTOR; }
    };

    async function validateWithNeynar(payload){
      try {
        if (!NEYNAR_API_KEY) return { ok: true };
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

    /* -------- CORS (frontend on warpcat.xyz) -------- */
    app.use((req, res, next) => {
      const origin = req.headers.origin || '';
      const allow = ['https://warpcat.xyz', 'https://www.warpcat.xyz'];
      if (allow.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,api_key,x-neynar-signature');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    /* -------- Static -------- */
    const STATIC_DIR = path.join(__dirname, 'static');
    if (fs.existsSync(STATIC_DIR)) {
      app.use('/static', express.static(STATIC_DIR, {
        setHeaders(res, filePath){
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.png')  res.setHeader('Content-Type','image/png');
          if (ext === '.svg')  res.setHeader('Content-Type','image/svg+xml');
          res.setHeader('Cache-Control','public, max-age=600');
        }
      }));
    }

    // Support serving .well-known/farcaster.json statically *and* dynamically
    const WELL_KNOWN_DIR = path.join(STATIC_DIR, '.well-known');
    if (fs.existsSync(WELL_KNOWN_DIR)) {
      app.use('/.well-known', express.static(WELL_KNOWN_DIR, {
        setHeaders(res){
          res.setHeader('Content-Type','application/json; charset=utf-8');
          res.setHeader('Cache-Control','public, max-age=300');
        }
      }));
    }

    /* -------- Dynamic /.well-known/farcaster.json -------- */
    app.get('/.well-known/farcaster.json', (_req, res) => {
      const accountAssociation = {
        header:   "eyJmaWQiOjQ3MzM2NiwidHlwZSI6ImF1dGgiLCJrZXkiOiIweDIwNDQyMDNCZGFiZTE0ZTQwNUEyQTY4MTE2MjFkZTI0Njg4RTZlNjkifQ",
        payload:  "eyJkb21haW4iOiJ3YXJwY2F0Lnh5eiJ9",
        signature:"OexyLeUjG/iWJemqCMOgFObd8i3xwUUpaogl8eKtAoBS/mMy/2n1ZTYFICWojInbzCSkaSLLUD1/zB3e5Qiwwhw="
      };
      const miniapp = {
        version: "1",
        name: "WarpCat",
        description: "Mint your WarpCat NFT directly from Farcaster.",
        iconUrl: PUBLIC_BASE_URL + "/static/og.png",
        homeUrl: PUBLIC_BASE_URL + "/mini/launch",
        splashImageUrl: PUBLIC_BASE_URL + "/static/og.png",
        splashBackgroundColor: "#000000",
        splashTextColor: "#ffffff",
        ogTitle: "WarpCat — Mini App",
        ogImageUrl: PUBLIC_BASE_URL + "/static/og.png",
      };
      res.status(200).set({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'})
        .send(JSON.stringify({ accountAssociation, miniapp }, null, 2));
    });

    /* -------- OpenSea Metadata -------- */
    app.get('/metadata/:fid.json', async (req, res) => {
      const fid = String(req.params.fid || '0');
      const image = PUBLIC_BASE_URL + '/render/' + encodeURIComponent(fid) + '.svg';
      try {
        const url = 'https://client.warpcast.com/v2/user-by-fid?fid=' + encodeURIComponent(fid);
        const r = await fetch(url, { headers: { 'accept': 'application/json' } });
        let username = 'user-' + fid;
        if (r.ok) {
          const j = await r.json();
          const u = j?.result?.user;
          if (u?.username) username = u.username;
        }
        const metadata = {
          name: 'WarpCat #' + fid,
          description: 'WarpCat NFT linked to Farcaster user @' + username,
          image,
          external_url: 'https://warpcast.com/' + username,
          attributes: [{ trait_type:'FID', value: fid }, { trait_type:'Collection', value: 'WarpCat' }],
        };
        res.status(200).set({'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60'})
          .send(JSON.stringify(metadata, null, 2));
      } catch (e) {
        res.status(200).json({ name:'WarpCat #' + fid, image, attributes:[{trait_type:'FID', value: fid}] });
      }
    });

    /* -------- Dynamic SVG Renderer -------- */
    function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
    function loadJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return null; }}

    app.get('/render/:fid.svg', (req, res) => {
      const fid = String(req.params.fid || '0');
      const eyesCfg = loadJSON(path.join(__dirname,'data','eyes.json')) || [];
      // Deterministic pseudo-random by fid:
      let seed = 0n; for(const c of fid) seed = (seed*131n + BigInt(c.charCodeAt(0))) & ((1n<<61n)-1n);
      function rand(){ seed = (seed*1103515245n + 12345n) & ((1n<<31n)-1n); return Number(seed % 1000n)/1000; }
      function weightedPick(list){
        const total = list.reduce((s,x)=>s+(x.weight||1),0);
        let r = rand()*total;
        for(const x of list){ r -= (x.weight||1); if(r<=0) return x; }
        return list[list.length-1];
      }

      const eye = eyesCfg.length? weightedPick(eyesCfg) : { svgId:'normal' };
      const faceColor = '#1f1f1f';
      const stroke = '#0b0b0b';

      const grinPath = fs.existsSync(path.join(__dirname,'static','grin.svg')) ? fs.readFileSync(path.join(__dirname,'static','grin.svg'),'utf8') : '';
      const earPath  = '<path d="M200 120 L260 40 L300 120 Z" fill="'+stroke+'"/><path d="M724 120 L664 40 L624 120 Z" fill="'+stroke+'"/>';

      // Minimal embedded shapes; eyes vary by svgId
      const eyes = (id=>{
        if(id==='laser') return '<rect x="320" y="380" width="360" height="24" rx="12" fill="#ff0033"/>';
        if(id==='sleepy')return '<ellipse cx="400" cy="400" rx="80" ry="16" fill="#eee"/><ellipse cx="624" cy="400" rx="80" ry="16" fill="#eee"/>';
        if(id==='neon')  return '<circle cx="420" cy="400" r="18" fill="#00e" /><circle cx="604" cy="400" r="18" fill="#0ff" />';
        if(id==='sharp') return '<polygon points="360,392 440,392 400,408" fill="#fff"/><polygon points="584,392 664,392 624,408" fill="#fff"/>';
        return '<ellipse cx="400" cy="400" rx="64" ry="18" fill="#fff"/><ellipse cx="624" cy="400" rx="64" ry="18" fill="#fff"/>';
      })(eye.svgId || 'normal');

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="1" y2="0">
      <stop offset="0" stop-color="#5b34ff"/><stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g transform="translate(0,0)">
    <circle cx="512" cy="560" r="360" fill="${faceColor}" stroke="${stroke}" stroke-width="28"/>
    ${earPath}
    ${eyes}
    <path d="M352 680 Q 512 740 672 680" stroke="#ffe500" stroke-width="22" fill="none" stroke-linecap="round"/>
  </g>
  <text x="40" y="980" fill="#ccc" font-family="monospace" font-size="28">WarpCat • FID ${fid}</text>
</svg>`;

      res.status(200).set({'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=120'}).send(svg);
    });

    /* -------- Frame: launch + mint -------- */
    function renderLaunch(){
      const image = PUBLIC_BASE_URL + '/static/og.png';
      const frame = {
        version: 'next',
        imageUrl: image,
        button: { title: 'Open', action: { type: 'launch_frame', name: 'WarpCat', url: PUBLIC_BASE_URL + '/mini/app', splashImageUrl: image, splashBackgroundColor: '#000000' } }
      };
      return '<!doctype html><html><head>'
        + '<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>'
        + '<meta property="og:image" content="'+image+'"/>'
        + '<meta name="twitter:card" content="summary_large_image"/>'
        + '<meta name="twitter:image" content="'+image+'"/>'
        + '<meta name="fc:frame" content=\'' + JSON.stringify(frame).replace(/'/g,'&apos;') + '\' />'
        + '<title>WarpCat Launch</title></head><body style="margin:0;background:#000"></body></html>';
    }
    app.get('/mini/launch', (_req,res)=> res.status(200).set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).send(renderLaunch()));

    function renderMintFrame(fid){
      const image = PUBLIC_BASE_URL + '/render/' + encodeURIComponent(fid) + '.svg';
      const postUrl = PUBLIC_BASE_URL + '/frame/mint?fid=' + encodeURIComponent(fid);
      const txUrl = PUBLIC_BASE_URL + '/mini/tx?fid=' + encodeURIComponent(fid);
      return '<!doctype html><html><head>'
        + '<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>'
        + '<meta name="fc:frame" content="vNext"/>'
        + '<meta property="og:image" content="'+image+'"/>'
        + '<meta name="twitter:card" content="summary_large_image"/>'
        + '<meta name="twitter:image" content="'+image+'"/>'
        + '<meta name="fc:frame:image" content="'+image+'"/>'
        + '<meta name="fc:frame:image:aspect_ratio" content="1:1"/>'
        + '<meta name="fc:frame:button:1" content="Mint"/>'
        + '<meta name="fc:frame:button:1:action" content="tx"/>'
        + '<meta name="fc:frame:button:1:target" content="'+txUrl+'"/>'
        + '<meta name="fc:frame:button:2" content="Refresh"/>'
        + '<meta name="fc:frame:button:2:action" content="post"/>'
        + '<meta name="fc:frame:post_url" content="'+postUrl+'"/>'
        + '<title>WarpCat Frame</title></head><body style="margin:0;background:#000"></body></html>';
    }

    async function handleMintFrame(req,res){
      const fid = String(req.query.fid || req.body?.fid || '0');
      if (req.method === 'POST') {
        const v = await validateWithNeynar(req.body || {});
        if (!v.ok) return res.status(401).json({ error:'neynar_validation_failed' });
      }
      res.status(200).set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).send(renderMintFrame(fid));
    }
    app.get('/frame/mint', handleMintFrame);
    app.post('/frame/mint', handleMintFrame);
    app.get('/mini/frame', handleMintFrame);

    /* -------- TX (Frames v2) -------- */
    async function handleTx(req,res){
      if (req.method === 'POST') {
        const v = await validateWithNeynar(req.body || {});
        if (!v.ok) return res.status(401).json({ error: 'neynar_validation_failed' });
      }
      if (!CONTRACT_ADDR) return res.status(500).json({ error: 'CONTRACT_ADDRESS missing' });
      const fid = String(req.query.fid || req.body?.fid || req.body?.untrustedData?.fid || '0');
      const tx = {
        chainId: CHAIN_ID,
        method: 'eth_sendTransaction',
        params: { to: CONTRACT_ADDR, data: buildMintData(fid), value: toHex(MINT_PRICE_WEI) },
      };
      res.status(200).set({'Cache-Control':'no-store'}).json(tx);
    }
    app.get('/mini/tx', handleTx);
    app.post('/mini/tx', handleTx);

    /* -------- Mini App Webview (simple) -------- */
    function renderMini(fid){
      const txUrl = PUBLIC_BASE_URL + '/mini/tx?fid=' + encodeURIComponent(fid);
      const frameMintUrl = PUBLIC_BASE_URL + '/frame/mint?fid=' + encodeURIComponent(fid);
      const image = PUBLIC_BASE_URL + '/render/' + encodeURIComponent(fid) + '.svg';
      return '<!doctype html><html><head>'
        + '<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>'
        + '<title>WarpCat — Mint</title>'
        + '<style>:root{color-scheme:dark}body{margin:0;background:#000;color:#fff;font-family:system-ui}'
        + '.wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}'
        + '.card{width:min(560px,90vw);background:#0b0b0b;border:1px solid #222;border-radius:16px;padding:24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5)}'
        + '.btn{appearance:none;border:0;border-radius:12px;padding:14px 18px;font-weight:700;cursor:pointer}'
        + '.btn-primary{background:linear-gradient(90deg,#5b34ff,#8b5cf6);color:#fff}'
        + '</style></head><body>'
        + '<div class="wrap"><div class="card">'
        + '<img src="'+image+'" alt="WarpCat" style="width:240px;height:240px;border-radius:16px;border:1px solid #222;background:#111"/>'
        + '<h2>WarpCat — Mint</h2><div>1 FID = 1 NFT • Base</div>'
        + '<div style="display:flex;gap:12px;justify-content:center;margin-top:16px">'
        + '<button id="mint" class="btn btn-primary">✨ Mint</button>'
        + '<button id="refresh" class="btn" style="background:#1a1a1a;color:#ddd">Refresh</button>'
        + '</div><div id="status" style="opacity:.8;margin-top:12px">Loading…</div>'
        + '<div id="result" style="opacity:.8;margin-top:8px"></div>'
        + '</div></div>'
        + '<script type="module">'
        + "import { createConfig, connect, getAccount, sendTransaction } from 'https://esm.sh/@wagmi/core@2.13.4';"
        + "import { http } from 'https://esm.sh/viem@2.13.7';"
        + "import { base } from 'https://esm.sh/viem@2.13.7/chains';"
        + "import { FarcasterMiniAppConnector } from 'https://esm.sh/@farcaster/miniapp-wagmi-connector@0.1.7';"
        + "import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk@0.2.1';"
        + "const statusEl=document.getElementById('status'); const resultEl=document.getElementById('result');"
        + "const mintBtn=document.getElementById('mint'); const refreshBtn=document.getElementById('refresh');"
        + "function setStatus(t){statusEl.textContent=t;} function setBusy(b){mintBtn.disabled=refreshBtn.disabled=b;}"
        + "(async()=>{ try{ await sdk.actions.ready(); setStatus('Ready.'); }catch(e){ setStatus('Ready.'); } })();"
        + "const fcConnector=new FarcasterMiniAppConnector({ chains:[base] });"
        + "const config=createConfig({ chains:[base], transports:{[base.id]:http()}, connectors:[fcConnector] });"
        + "refreshBtn.onclick=()=>location.reload();"
        + "mintBtn.onclick=async()=>{ setBusy(true); resultEl.textContent=''; try{"
        + "const r=await fetch('"+txUrl+"',{headers:{'accept':'application/json','cache-control':'no-cache'}});"
        + "if(!r.ok) throw new Error('Tx payload failed: '+r.status); const tx=await r.json();"
        + "let acc=getAccount(config); if(!acc.isConnected){ await connect(config,{connector:fcConnector}); acc=getAccount(config);}"
        + "if(!acc.isConnected) throw new Error('Wallet provider missing');"
        + "const chainIdNum=Number(String(tx.chainId).split(':').pop()||"+str(CHAIN_ID_NUM)+");"
        + "const txHash=await sendTransaction(config,{ chainId:chainIdNum, to:tx.params.to, data:tx.params.data, value: BigInt(tx.params.value) });"
        + "setStatus('Mint submitted.'); resultEl.innerHTML='Tx: <a href="https://basescan.org/tx/'+txHash+'" target="_blank" rel="noopener">view on BaseScan</a>';"
        + "}catch(err){ const msg=String(err&&err.message||err).toLowerCase();"
        + "if(msg.includes('wallet provider')){ setStatus('No wallet. Opening Frame mint…'); try{ await sdk.actions.openUrl('"+frameMintUrl+"'); }catch(_e){ location.href='"+frameMintUrl+"'; } }"
        + "else{ setStatus('Mint failed: '+(err&&err.message?err.message:String(err))); } } finally{ setBusy(false);} };"
        + '</script></body></html>';
    }
    app.get('/mini/app', (req,res)=>{
      const fid = String(req.query.fid || '0');
      res.status(200).set({'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).send(renderMini(fid));
    });

    /* -------- Root & health -------- */
    app.get('/', (_req,res)=> res.redirect(302, '/mini/launch'));
    app.get('/healthz', (_req,res)=> res.json({ ok:true }));

    app.listen(PORT, ()=> console.log(`WarpCat listening on ${PUBLIC_BASE_URL}`));
