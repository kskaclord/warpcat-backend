// scripts/gen-assoc.js
import fetch from "node-fetch";

const API_KEY  = process.env.NEYNAR_APP_KEY;    // .env'ye ekle
const WALLET_ID = process.env.NEYNAR_WALLET_ID; // .env'ye ekle
const DOMAIN   = "warpcat.xyz";                 // takılırsa "https://warpcat.xyz" deneyebilirsin

const url = "https://api.neynar.com/v2/app/create-account-association";

(async () => {
  const tryOnce = async (domainStr) => {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api_key": API_KEY,
      },
      body: JSON.stringify({ domain: domainStr, wallet_id: WALLET_ID }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    return JSON.parse(text);
  };

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
})();
