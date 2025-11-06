// scripts/gen-assoc.js
import 'dotenv/config';

const API_KEY  = process.env.NEYNAR_API_KEY || process.env.NEYNAR_APP_KEY || '';
const WALLET_ID = process.env.NEYNAR_WALLET_ID || '';
const DOMAIN   = process.env.PUBLIC_DOMAIN || 'warpcat.xyz';

if(!API_KEY)  { console.error('Missing NEYNAR_API_KEY'); process.exit(1); }
if(!WALLET_ID){ console.error('Missing NEYNAR_WALLET_ID'); process.exit(1); }

const url = "https://api.neynar.com/v2/app/create-account-association";

async function tryOnce(domainStr){
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api_key": API_KEY },
    body: JSON.stringify({ domain: domainStr, wallet_id: WALLET_ID }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

try {
  let json;
  try {
    json = await tryOnce(DOMAIN);
  } catch (e) {
    console.warn("First try failed, retrying with https:// prefix...");
    json = await tryOnce(`https://${DOMAIN.replace(/^https?:\/\//, "")}`);
  }
  console.log("\n=== accountAssociation ===");
  console.log(JSON.stringify(json, null, 2));
} catch (err) {
  console.error("Failed:", err.message);
  process.exit(1);
}
