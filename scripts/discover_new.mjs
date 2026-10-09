// Weekly discovery: look for master's in the map's subjects at UK universities that aren't on the map yet, and put
// what's found in the database table course_candidates for review (nothing is added to the map automatically).
//   npm run discover-new                 → all unlisted universities
//   npm run discover-new -- "Derby"      → only names containing this text
// Universities scanned: those in universities.json with no courses on the map, plus scripts/discovery_unis.json.
import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { HERE, pool, loadRows, loadUnis, cached } from "./_rows.mjs";
import { sitemapUrls, fetchText, htmlToText, extractIntlFee, extractCourseInfo } from "../api/_lib/scrape.js";

try {
  for (const line of (await readFile(join(HERE, "..", ".env"), "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch {}
const { dbReady, candidateUrls, saveCandidates, touchCandidates } = await import("../api/_lib/db.js");
if (!dbReady()) { console.error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set"); process.exit(1); }

const rows = loadRows(), UNIS = loadUnis();
const onMap = new Set(rows.map(r => r.u));
const extra = JSON.parse(await readFile(join(HERE, "discovery_unis.json"), "utf8"));
const TARGETS = {
  ...Object.fromEntries(Object.entries(UNIS).filter(([u]) => !onMap.has(u)).map(([u, x]) => [u, x.web])),
  ...Object.fromEntries(Object.entries(extra).filter(([u]) => !u.startsWith("_") && !onMap.has(u))),
};
const only = process.argv[2];
const todo = Object.keys(TARGETS).filter(u => !only || u.toLowerCase().includes(only.toLowerCase()));

// Subject groups, matched against the course page address. Order matters: the first match wins.
const SUBJECTS = [
  ["NUR", /(adult|mental-health|child(ren'?s)?|learning-disabilit(y|ies))-nursing|nursing-(adult|mental-health|child|pre-?reg|with-(nmc-)?registration)|pre-?registration-nursing/],
  ["HM", /(health(-and-social)?-?care-management|health-management|healthcare-leadership|health-services-management|public-health|global-health|international-health)/],
  ["SF", /(sustainable-finance|green-finance|climate-finance|finance-and-sustainab|sustainab[a-z-]*-finance|responsible-(finance|invest)|esg|impact-invest|sustainable-investment|carbon-finance)/],
  ["DEV", /(development-economics|development-finance|economics-(of|and|for)-development|finance-and-development|microfinance|financial-inclusion|economic-development)/],
  ["DM", /(international-development|development-studies|global-development|development-management|development-practice|ngo|non-?profit|charity-management|humanitarian|sustainable-development|social-innovation)/],
  ["HCI", /(human-computer-interaction|user-experience|ux-design|interaction-design|\bhci\b)/],
  ["AI", /(artificial-intelligence|machine-learning|\bai\b)/],
  ["CS", /(computer-science|computing|software-engineering)/],
];
const BAD = /(phd|doctor|research-degree|mres\b|pgcert|pg-cert|pgdip|pg-dip|postgraduate-certificate|postgraduate-diploma|short-course|cpd|module|undergrad|\/ug\/|bsc|-ba-|\/ba-|ba-hons|\bba\b|foundation|apprentice|news|event|blog|staff|people|profile|research\/|clearing|top-up|online|distance|part-time|\.pdf|alumni|stor(y|ies)|case-stud|podcast|webinar|scholarship|funding|welcome|induction|open-day)/;
const PG = /(postgrad|masters|\/pg|taught|msc|\/ma-|-ma\b|\/ma\/|mba|\/courses?\/|graduate)/;
const MASTERS = /\b(MSc|MA|MRes|MPhil|MBA|MPH|MSt|LLM|MNurs|Master'?s?|Masters)\b/i;
const NOT_PG = /\b(BSc|BA|PhD|PGCert|PGDip|Foundation|Apprenticeship|Short course|Online|Distance learning)\b/i;

const known = await candidateUrls();
const found = [], seenAgain = [], noSitemap = [];
await pool(todo, 5, async u => {
  const web = TARGETS[u];
  let urls = [];
  try { urls = await cached("sitemap-" + new URL(web).host, () => sitemapUrls(web)); } catch {}
  if (!urls.length) { noSitemap.push(u); return; }
  const picks = [], keys = new Set();
  for (const url of urls) {
    const l = decodeURIComponent(url).toLowerCase();
    if (BAD.test(l) || !PG.test(l)) continue;
    const s = SUBJECTS.find(([, re]) => re.test(l)); if (!s) continue;
    const k = l.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop().replace(/-?\d{4}.*$/, "");
    if (keys.has(k)) continue; keys.add(k);
    picks.push({ url, subject: s[0] });
  }
  const fresh = [];
  for (const p of picks.slice(0, 30)) (known.has(p.url) ? seenAgain : fresh).push({ ...p, uni: u });
  await pool(fresh, 3, async p => {
    try {
      const { text: html, url: final } = await fetchText(p.url, { timeout: 15000 });
      const info = extractCourseInfo(html), text = htmlToText(html);
      if (!MASTERS.test(info.title) || NOT_PG.test(info.title)) return;      // not a taught master's page
      const fee = extractIntlFee(text) || extractIntlFee(htmlToText(html, { keepScripts: true }));
      found.push({ url: final, uni: u, subject: p.subject, title: info.title, fee: fee?.fee ?? null, intakes: info.intakes, entry: info.entry });
    } catch {}
  });
  process.stderr.write(".");
});
await saveCandidates(found);
await touchCandidates(seenAgain.filter(x => known.get(x.url) === "new"));

console.log(`\nScanned ${todo.length} universities not on the map. New candidates: ${found.length}.` +
  (noSitemap.length ? `\nNo readable sitemap (not scanned): ${noSitemap.join(", ")}` : ""));
for (const c of found) console.log(`  + ${c.uni} | ${c.subject} | ${c.title} | ${c.fee ? "£" + c.fee.toLocaleString("en-GB") : "fee not found"} | ${c.url}`);

// On GitHub Actions, list them on the run's summary page too.
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`### Course discovery`, `Scanned **${todo.length}** universities not on the map · **${found.length}** new candidate course${found.length === 1 ? "" : "s"} saved to \`course_candidates\` for review.`, ""];
  if (found.length) md.push("| University | Subject | Course | Intl fee |", "|---|---|---|---|", ...found.map(c => `| ${c.uni} | ${c.subject} | [${c.title.replace(/\|/g, "/")}](${c.url}) | ${c.fee ? "£" + c.fee.toLocaleString("en-GB") : "—"} |`));
  if (noSitemap.length) md.push("", `No readable sitemap: ${noSitemap.join(", ")}`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
}
