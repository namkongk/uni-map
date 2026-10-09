// GET /api/fees — the latest fee and course details (start dates, open/closed, entry) read from each course page, as stored in the database by /api/refresh.
// The map applies these on load (with the same "needs check" safeguard as a manual refresh), so every visitor
// sees the most recent figures. Shape matches what /api/refresh returns: { checked, res: { [url]: result } }.
import { dbReady, loadFees } from "./_lib/db.js";

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

export async function GET() {
  if (!dbReady()) return json({ error: "Database not configured" }, 503);
  try {
    const rows = await loadFees();
    const res = {};
    let checked = null;
    for (const r of Object.values(rows)) {
      const info = r.info_at ? { info: { title: r.title, intakes: r.intakes || [], status: r.course_status, statusNote: r.status_note, entry: r.entry, at: r.info_at } } : {};
      if (r.fee != null) res[r.url] = { url: r.url, ok: true, fee: r.fee, year: r.fee_year, ctx: r.ctx, src: r.src, via: r.via, at: r.checked_at,
        ...(r.last_error ? { lastErr: r.last_error, lastErrAt: r.error_at } : {}), ...info };
      else res[r.url] = { url: r.url, ok: false, err: r.last_error || "Fee not found", at: r.error_at, ...info };
      const t = r.fee != null ? r.checked_at : r.error_at;
      if (t && (!checked || t > checked)) checked = t;
    }
    // Short edge cache: fresh enough after a refresh, and keeps the database quiet under traffic.
    return json({ checked, n: Object.keys(res).length, res }, 200, "public, s-maxage=300, stale-while-revalidate=3600");
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
