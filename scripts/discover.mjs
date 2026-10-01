// Finds course-page URLs from each university's sitemap.
//   node scripts/discover.mjs              → fill "url" on rows that don't have one
//   node scripts/discover.mjs --force      → re-discover every row
//   node scripts/discover.mjs --suggest    → for universities in universities.json with no rows yet, list CS / AI / HCI
//                                            masters pages + scraped fee (add the good ones to masters_rows.json by hand)
//   node scripts/discover.mjs --only "University of Derby"
import { sitemapUrls, rankCourseUrls, scrapeCourse } from "../api/_lib/scrape.js";
import { loadRows, saveRows, loadUnis, cached, pool, CACHE } from "./_rows.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force"), suggest = args.includes("--suggest");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const rows = loadRows(), UNIS = loadUnis();
const sitemap = u => cached("sitemap-" + new URL(UNIS[u].web).host, () => sitemapUrls(UNIS[u].web)).catch(() => []);

if (!suggest) {
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
} else {
  const GENERIC = {
    CS: ["MSc Computer Science", "MSc Advanced Computer Science", "MSc Computing", "MSc Advanced Computing", "MSc Applied Computing"],
    AI: ["MSc Artificial Intelligence", "MSc Applied Artificial Intelligence", "MSc Artificial Intelligence and Data Science", "MSc Data Science and Artificial Intelligence", "MSc Machine Learning"],
    HCI: ["MSc Human Computer Interaction", "MSc User Experience Design", "MA User Experience Design", "MSc UX Design", "MSc Human-Centred AI"],
  };
  const todo = Object.keys(UNIS).filter(u => (!only || u === only) && (only || !rows.some(r => r.u === u)));
  const out = {};
  await pool(todo, 5, async u => {
    const urls = await sitemap(u);
    out[u] = { sitemapSize: urls.length, picks: [] };
    for (const [g, names] of Object.entries(GENERIC)) {
      const seen = new Set();
      for (const p of names) {
        const best = rankCourseUrls(urls, p, UNIS[u].web)[0];
        if (!best || seen.has(best.url)) continue; seen.add(best.url);
        let s; try { s = await scrapeCourse(best.url); } catch (e) { s = { err: e.message }; }
        out[u].picks.push({ g, p, url: best.url, fee: s.fee?.fee ?? null, ctx: s.fee?.ctx, err: s.err });
      }
    }
    process.stderr.write(".");
  });
  writeFileSync(join(CACHE, "suggest.json"), JSON.stringify(out, null, 1));
  for (const [u, o] of Object.entries(out)) {
    console.log(`\n${u} (${o.sitemapSize} sitemap URLs)`);
    o.picks.forEach(x => console.log(`  ${x.g} ${x.p} → ${x.url}\n      fee ${x.fee ?? "—"} ${x.err ?? x.ctx?.slice(-90) ?? ""}`));
  }
}
