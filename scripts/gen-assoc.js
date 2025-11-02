// scripts/gen-assoc.js
import fetch from "node-fetch";

const API_KEY = process.env.NEYNAR_APP_KEY; // App Wallet sayfandaki API Key'i .env'ye koy
const DOMAIN  = "warpcat.xyz";

(async () => {
  const r = await fetch("https://api.neynar.com/v2/app/create-account-association", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api_key": API_KEY,
    },
    body: JSON.stringify({ domain: DOMAIN }),
  });

  if (!r.ok) {
    console.error("Failed:", r.status, await r.text());
    process.exit(1);
  }
  const json = await r.json();
  console.log("\n=== accountAssociation ===");
  console.log(JSON.stringify(json, null, 2));
})();
