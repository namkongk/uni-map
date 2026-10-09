// GET /api/refresh?u=<university name>
// Fetches that university's course pages (only those listed in _lib/sources.js) and returns the
// international fee found on each. The browser can't do this itself: university sites don't send CORS headers.
// When the database is configured (SUPABASE_URL + SUPABASE_SECRET_KEY), the results are also saved there,
// so /api/fees serves them to every visitor.
import { refreshUni, sourceUnis, hasSources } from "./_lib/refresh-uni.js";
import { dbReady, saveResults } from "./_lib/db.js";

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

export async function GET(request) {
  const u = new URL(request.url).searchParams.get("u");
  if (!u) return json({ unis: sourceUnis() }, 200, "public, s-maxage=3600");
  if (!hasSources(u)) return json({ error: "Unknown university, or no course pages on record for it." }, 404);

  const results = await refreshUni(u);
  let db = "off";
  if (dbReady()) {
    try { const s = await saveResults(u, results); db = `saved ${s.saved}, ${s.changed} changed, ${s.errors} unreadable`; }
    catch (e) { db = "error: " + e.message; console.error("refresh → database:", e.message); }
  }
  // Cache at Vercel's edge for 6 h so repeated refreshes don't hammer university sites (the database already has the result).
  return json({ u, checked: new Date().toISOString(), db, results }, 200, "public, s-maxage=21600, stale-while-revalidate=86400");
}
