// GET /api/config → browser config built from environment variables, so no key lives in the repo.
// Locally the values come from .env (loaded by scripts/dev.mjs); on Vercel from Project → Settings → Environment Variables.
// The Maps key is a browser key and is visible to visitors by design — its website/API restrictions are what protect it.
export function GET() {
  const cfg = {
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || "",
    GOOGLE_MAP_ID: process.env.GOOGLE_MAP_ID || "DEMO_MAP_ID",
  };
  return new Response(`window.APP_CONFIG = ${JSON.stringify(cfg)};\n`, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=3600" },
  });
}
