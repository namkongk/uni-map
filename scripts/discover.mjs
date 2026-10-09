// Finds course-page URLs from each university's sitemap.
//   node scripts/discover.mjs              → fill "url" on rows that don't have one
//   node scripts/discover.mjs --force      → re-discover every row
//   node scripts/discover.mjs --only "University of Derby"
// (Finding courses at universities that aren't on the map yet: scripts/discover_new.mjs.)
import { sitemapUrls, rankCourseUrls } from "../api/_lib/scrape.js";
import { loadRows, saveRows, loadUnis, cached, pool } from "./_rows.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const rows = loadRows(), UNIS = loadUnis();
const sitemap = u => cached("sitemap-" + new URL(UNIS[u].web).host, () => sitemapUrls(UNIS[u].web)).catch(() => []);

const todo = Object.keys(UNIS).filter(u => (!only || u === only) && rows.some(r => r.u === u && (force || !r.url)));
let found = 0, missed = [];
await pool(todo, 6, async u => {
  const urls = await sitemap(u);
  for (const r of rows.filter(r => r.u === u && (force || !r.url))) {
    const best = rankCourseUrls(urls, r.p, UNIS[u].web)[0];
    if (best) { r.url = best.url; found++; } else missed.push(`${u} — ${r.p}${urls.length ? "" : " (no sitemap)"}`);
  }
  process.stderr.write(".");
});
saveRows(rows);
console.log(`\n${found} course URLs found. ${missed.length} not found:\n  ` + missed.join("\n  "));
