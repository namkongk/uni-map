// GET /api/refresh?u=<university name>
// Fetches that university's course pages (only those listed in _lib/sources.js) and returns the
// international fee found on each. The browser can't do this itself: university sites don't send CORS headers.
import { scrapeCourse } from "./_lib/scrape.js";
import SOURCES from "./_lib/sources.js";

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

export async function GET(request) {
  const u = new URL(request.url).searchParams.get("u");
  if (!u) return json({ unis: Object.keys(SOURCES) }, 200, "public, s-maxage=3600");
  const urls = SOURCES[u];
  if (!urls) return json({ error: "Unknown university, or no course pages on record for it." }, 404);

  const results = await Promise.all(urls.map(async url => {
    try {
      const r = await scrapeCourse(url);
      return r.fee ? { url, ok: true, fee: r.fee.fee, year: r.fee.year, ctx: r.fee.ctx, src: r.src, via: r.via }
                   : { url, ok: false, err: "Fee not found on the course page" };
    } catch (e) {
      const blocked = /HTTP 40[13]|HTTP 429/.test(e.message);
      return { url, ok: false, err: blocked ? "Site blocks automated reading (" + e.message + ")" : e.name === "AbortError" ? "Timed out" : e.message };
    }
  }));
  // Cache at Vercel's edge for 6 h so repeated refreshes don't hammer university sites.
  return json({ u, checked: new Date().toISOString(), results }, 200, "public, s-maxage=21600, stale-while-revalidate=86400");
}
