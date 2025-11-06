# WarpCat Backend (Render)

Express backend for Farcaster Mini App + Frame + NFT metadata.

## Endpoints
- `/.well-known/farcaster.json` — Domain association + miniapp meta
- `/mini/launch` — Frame with `launch_frame` to open the Mini App
- `/mini/app` — Webview page (for same-origin testing)
- `/mini/tx` — Returns Frames v2 tx payload (GET/POST)
- `/frame/mint` — Frame image/buttons, POST-safe
- `/metadata/:fid.json` — OpenSea metadata (uses Warpcast API)
- `/render/:fid.svg` — **Dynamic SVG** WarpCat image (traits)
- `/healthz` — Healthcheck

## Run
```bash
cp .env.example .env
npm i
npm start
```
