// Germany: build the German course list from DAAD's International Programmes database.
//   npm run import-germany          → re-import (replaces every German row in masters_rows.json, keeps the UK ones)
// Keeps English-taught, on-campus master's in the map's subjects, reads each programme's DAAD page for fees, start
// semesters, living costs and requirements, and places new universities on the map (OpenStreetMap geocoding, cached
// in universities.json / cities_de.json). Then run `npm run data` to rebuild js/data.js.
// A website dropping the connection mid-download can surface as an uncaught network error in newer Node versions;
// treat it as one failed page, not a reason to stop the whole run.
process.on("uncaughtException", e => { if (/^UND_ERR|ECONNRESET|EPIPE/.test(e?.code || "")) console.warn(`  (network error ignored: ${e.code})`); else { console.error(e); process.exit(1); } });
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HERE, loadRows, saveRows, loadUnis, pool } from "./_rows.mjs";
import { DAAD, DAAD_SEARCH, parseDaadDetail, yearlyFee, nonEuTuition, PRIVATE, daadMasters, daadPick } from "../api/_lib/daad.js";

const UA = { "user-agent": "UniMap/1.0 (student course map; https://github.com/namkongk/uni-map)", accept: "application/json,text/html" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// QS World University Rankings 2027 (German universities in the top 210).
const QS = [[/Technical University of Munich|Technische Universität München/, 25], [/Ludwig-Maximilians|LMU/, 61], [/Heidelberg University|Universität Heidelberg|Ruprecht/, 86],
  [/Freie Universität Berlin|Free University of Berlin/, 98], [/RWTH Aachen/, 104], [/Karlsruhe Institute of Technology|\bKIT\b/, 110], [/Humboldt/, 140],
  [/Technische Universität Berlin|Technical University of Berlin|TU Berlin/, 158], [/Dresden University of Technology|Technische Universität Dresden|TUD/, 185], [/University of Bonn|Universität Bonn/, 209]];
const BLOCKED_ACCOUNT = 11904; // visa proof of funds per year, 2026 (€992/month)

// 1–2. All master's programmes in the DAAD database → English-taught, on campus, in our subjects.
const all = await daadMasters();
const picked = daadPick(all);
console.log(`DAAD: ${all.length} master's · ${picked.length} English-taught in the map's subjects`);

// 3. Details from each programme page.
const details = [];
await pool(picked, 3, async ({ g, c }) => {
  const url = DAAD + c.link;
  try {
    const html = await (await fetch(url, { headers: UA })).text();
    details.push({ g, c, url, d: parseDaadDetail(html) });
  } catch (e) { console.log("  ✗", c.academy, "|", c.courseName, e.message); }
  await sleep(250);
});

// 4. Universities and cities on the map (geocoded once, then cached).
const UNIS = loadUnis();
const cityFile = join(HERE, "cities_de.json");
let CITIES = {}; try { CITIES = JSON.parse(await readFile(cityFile, "utf8")); } catch {}
async function geocode(q) {
  await sleep(1100); // OpenStreetMap Nominatim: max 1 request a second
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`, { headers: UA });
  const j = await r.json(); return j[0] ? [+(+j[0].lat).toFixed(4), +(+j[0].lon).toFixed(4)] : null;
}
for (const city of [...new Set(details.map(x => x.c.city))]) if (!CITIES[city]) { const g = await geocode(city + ", Germany"); if (g) CITIES[city] = g; }
for (const u of [...new Set(details.map(x => x.c.academy))]) {
  if (UNIS[u]) continue;
  const city = details.find(x => x.c.academy === u).c.city;
  const g = (await geocode(`${u}, ${city}`)) || CITIES[city];
  if (!g) { console.log("  ? no location for", u); continue; }
  const site = details.find(x => x.c.academy === u && x.d.website)?.d.website;
  UNIS[u] = { web: site ? new URL(site).origin : "", c: city, lat: g[0], lng: g[1], co: "de" };
}

// 5. Rows.
const rows = loadRows().filter(r => r.co !== "de");
let added = 0; const skipped = [];
for (const { g, c, url, d } of details.sort((a, b) => a.c.academy.localeCompare(b.c.academy) || a.c.courseName.localeCompare(b.c.courseName))) {
  const u = c.academy;
  if (!UNIS[u]) { skipped.push(`${u} | ${c.courseName} (no location)`); continue; }
  const t = nonEuTuition({ uni: u, city: c.city, title: c.courseName, parsed: d });
  if (t.tuition == null) { skipped.push(`${u} | ${c.courseName} (fee not stated)`); continue; }
  const { f, fn } = yearlyFee(d, t.tuition);
  const l = Math.max(BLOCKED_ACCOUNT, Math.round((d.living || 0) * 12 / 100) * 100);
  const qs = (QS.find(([re]) => re.test(u)) || [])[1] ?? null;
  const en = [d.req, d.eng && `English: ${d.eng}`].filter(Boolean).join(" · ").slice(0, 400);
  rows.push({
    co: "de", g, u, c: c.city, uk: null, qs: qs ? String(qs) : null, qss: qs, p: c.courseName.replace(/\s+/g, " ").trim(),
    i: d.intakes.join(", ") || (/summer/i.test(c.beginning) ? "Apr" : "Oct"), f, fn: [fn, t.note].filter(Boolean).join(" · "),
    l, t: f + l, s: 0, sl: "", n: f + l, o: "DAAD scholarships (competitive)" + (PRIVATE.test(u) ? "" : " · Deutschlandstipendium (€300/month, merit-based)"),
    pl: "No", fl: [t.est ? "Fee estimated — check page" : "", PRIVATE.test(u) ? "Private university" : ""].filter(Boolean).join("; "),
    url, cw: d.website || "", en, dur: d.duration, dl: d.winterDeadline || "", ...(qs ? {} : { nr: true }),
  });
  added++;
}
saveRows(rows);
await writeFile(join(HERE, "universities.json"), JSON.stringify(UNIS, null, 1) + "\n");
await writeFile(cityFile, JSON.stringify(CITIES, null, 1) + "\n");
console.log(`Germany: ${added} courses at ${new Set(rows.filter(r => r.co === "de").map(r => r.u)).size} universities · skipped ${skipped.length}`);
skipped.forEach(s => console.log("  –", s));
