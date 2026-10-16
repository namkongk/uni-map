// GET /api/rating?u=<university> — that university's Google Maps star rating, fetched only when someone opens its card.
// The first lookup asks Google (Places API, server key) and saves the answer in place_ratings; everyone after that gets
// the saved one until it's 60 days old. Only universities on the map can be looked up (api/_lib/places.js).
//   → { r: 4.5, n: 1242, uri, at } · { none: true } when Google has no rating · 503 when Google's quota is used up
import { dbReady, rest } from "./_lib/db.js";
import PLACES from "./_lib/places.js";

const MAX_AGE = 60 * 864e5;
const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });
const out = row => json({ r: row.rating, n: row.rating_count, uri: row.maps_uri, at: row.checked_at }, 200, "public, s-maxage=86400, stale-while-revalidate=604800");

export async function GET(request) {
  if (request.headers.get("x-requested-with") !== "unimap") return json({ error: "Bad request" }, 400);
  const u = new URL(request.url).searchParams.get("u") || "";
  const place = Object.hasOwn(PLACES, u) ? PLACES[u] : null;
  if (!place) return json({ error: "Unknown university" }, 404);

  // 1. A saved rating that's recent enough.
  let saved = null;
  if (dbReady()) {
    try { saved = (await rest(`place_ratings?select=*&uni=eq.${encodeURIComponent(u)}&limit=1`))[0] || null; }
    catch (e) { console.error("rating: read", e.message); }   // table not created yet → just ask Google
    if (saved && Date.now() - Date.parse(saved.checked_at) < MAX_AGE) return saved.rating == null ? json({ none: true }, 200, "public, s-maxage=86400") : out(saved);
  }

  // 2. Ask Google, then save the answer (even "no rating", so it isn't asked again for a while).
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return saved ? out(saved) : json({ error: "No Google key on the server" }, 503);
  let p;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": "places.displayName,places.rating,places.userRatingCount,places.googleMapsUri" },
      body: JSON.stringify({ textQuery: place[0], maxResultCount: 1, locationBias: { circle: { center: { latitude: place[1], longitude: place[2] }, radius: 5000 } } }),
    });
    if (!res.ok) {
      console.error("rating: google", res.status, (await res.text()).slice(0, 160));
      return saved ? out(saved) : json({ error: res.status === 429 ? "Google's daily limit is used up" : "Google lookup failed" }, 503);
    }
    p = (await res.json()).places?.[0] || null;
  } catch (e) {
    return saved ? out(saved) : json({ error: "Google lookup failed" }, 503);
  }
  const row = { uni: u, rating: p?.rating ?? null, rating_count: p?.userRatingCount ?? 0, maps_uri: (p?.googleMapsUri || "").replace(/[&?]g_mp=[^&]*/, "") || null,
    place_name: p?.displayName?.text || null, checked_at: new Date().toISOString() };
  if (dbReady()) {
    try { await rest("place_ratings?on_conflict=uni", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: row }); }
    catch (e) { console.error("rating: save", e.message); }
  }
  return row.rating == null ? json({ none: true }, 200, "public, s-maxage=86400") : out(row);
}
