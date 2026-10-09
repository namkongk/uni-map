// Re-read every course page we hold for one university (shared by /api/refresh and scripts/refresh_all.mjs).
// One result per page: { url, ok, fee, year, ctx, src, via, info } — info = { title, intakes, status, statusNote, entry } —
// or { url, ok: false, err, info? } when no fee was found. A page that no longer exists gets info.status "gone".
import { scrapeCourse, fetchText } from "./scrape.js";
import { isDaad, parseDaadDetail, nonEuTuition, yearlyFee } from "./daad.js";
import SOURCES from "./sources.js";

// German courses: re-read their DAAD page; the fee is per year in EUR (2 × (non-EU tuition + semester fee)).
async function refreshDaad(u, url) {
  const { text: html } = await fetchText(url, { timeout: 15000 });
  const d = parseDaadDetail(html);
  const t = nonEuTuition({ uni: u, title: d.title, parsed: d });
  const info = { title: d.title, intakes: d.intakes, status: "open", statusNote: "", entry: [d.req, d.eng && "English: " + d.eng].filter(Boolean).join(" · ") };
  if (t.tuition == null) return { url, ok: false, err: "Tuition varies — see the course page", info };
  const { f, fn } = yearlyFee(d, t.tuition);
  return { url, ok: true, fee: f, year: null, ctx: [fn, t.note].filter(Boolean).join(" · "), src: d.website || url, via: "DAAD", info };
}

export const sourceUnis = () => Object.keys(SOURCES);
export const hasSources = u => !!SOURCES[u];

// At most 4 pages at a time per university, so big ones (e.g. TUM's DAAD pages) don't trip rate limits.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function refreshUni(u) {
  return mapLimit(SOURCES[u] || [], 4, async url => {
    try {
      if (isDaad(url)) return await refreshDaad(u, url);
      const r = await scrapeCourse(url);
      return r.fee ? { url, ok: true, fee: r.fee.fee, year: r.fee.year, ctx: r.fee.ctx, src: r.src, via: r.via, info: r.info }
                   : { url, ok: false, err: "Fee not found on the course page", info: r.info };
    } catch (e) {
      if (/HTTP 40[4]|HTTP 410/.test(e.message)) return { url, ok: false, err: "Course page no longer exists (" + e.message + ")", info: { status: "gone", statusNote: "The course page has been removed (" + e.message + ")" } };
      const blocked = /HTTP 40[13]|HTTP 429/.test(e.message);
      return { url, ok: false, err: blocked ? "Site blocks automated reading (" + e.message + ")" : e.name === "AbortError" ? "Timed out" : e.message };
    }
  });
}
