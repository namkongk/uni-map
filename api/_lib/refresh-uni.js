// Re-read the international fee on every course page we hold for one university (shared by /api/refresh and
// scripts/refresh_all.mjs). Returns one result per page: { url, ok, fee, year, ctx, src, via } or { url, ok: false, err }.
import { scrapeCourse } from "./scrape.js";
import SOURCES from "./sources.js";

export const sourceUnis = () => Object.keys(SOURCES);
export const hasSources = u => !!SOURCES[u];

export async function refreshUni(u) {
  return Promise.all((SOURCES[u] || []).map(async url => {
    try {
      const r = await scrapeCourse(url);
      return r.fee ? { url, ok: true, fee: r.fee.fee, year: r.fee.year, ctx: r.fee.ctx, src: r.src, via: r.via }
                   : { url, ok: false, err: "Fee not found on the course page" };
    } catch (e) {
      const blocked = /HTTP 40[13]|HTTP 429/.test(e.message);
      return { url, ok: false, err: blocked ? "Site blocks automated reading (" + e.message + ")" : e.name === "AbortError" ? "Timed out" : e.message };
    }
  }));
}
