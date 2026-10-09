// Re-read every course page we hold for one university (shared by /api/refresh and scripts/refresh_all.mjs).
// One result per page: { url, ok, fee, year, ctx, src, via, info } — info = { title, intakes, status, statusNote, entry } —
// or { url, ok: false, err, info? } when no fee was found. A page that no longer exists gets info.status "gone".
import { scrapeCourse } from "./scrape.js";
import SOURCES from "./sources.js";

export const sourceUnis = () => Object.keys(SOURCES);
export const hasSources = u => !!SOURCES[u];

export async function refreshUni(u) {
  return Promise.all((SOURCES[u] || []).map(async url => {
    try {
      const r = await scrapeCourse(url);
      return r.fee ? { url, ok: true, fee: r.fee.fee, year: r.fee.year, ctx: r.fee.ctx, src: r.src, via: r.via, info: r.info }
                   : { url, ok: false, err: "Fee not found on the course page", info: r.info };
    } catch (e) {
      if (/HTTP 40[4]|HTTP 410/.test(e.message)) return { url, ok: false, err: "Course page no longer exists (" + e.message + ")", info: { status: "gone", statusNote: "The course page has been removed (" + e.message + ")" } };
      const blocked = /HTTP 40[13]|HTTP 429/.test(e.message);
      return { url, ok: false, err: blocked ? "Site blocks automated reading (" + e.message + ")" : e.name === "AbortError" ? "Timed out" : e.message };
    }
  }));
}
