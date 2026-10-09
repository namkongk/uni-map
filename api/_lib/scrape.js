// Shared scraping helpers — used by the Vercel function (api/refresh.js), the local dev server
// and the CLI scripts in scripts/. No dependencies: Node 18+ global fetch + zlib.
import { gunzipSync } from "node:zlib";

const UA = "Mozilla/5.0 (compatible; UniMap/1.0; student course-fee checker)";

export async function fetchText(url, { timeout = 12000, binary = false } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!binary) return { text: await res.text(), url: res.url };
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    return { text: buf.toString("utf8"), url: res.url };
  } finally { clearTimeout(t); }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", ndash: "–", mdash: "—", rsquo: "'", lsquo: "'" };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

/** HTML → plain text, keeping block boundaries as " | " so table cells don't run together. */
export function htmlToText(html, { keepScripts = false } = {}) {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, " ");
  h = keepScripts ? h.replace(/<\/?script\b[^>]*>/gi, " | ").replace(/\\u([0-9a-f]{4})/gi, (m, c) => String.fromCharCode(parseInt(c, 16))).replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/["{}[\]]/g, " ").replace(/\\n|\\t/g, " ")
                  : h.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  h = h.replace(/<\/?(p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|dt|dd|dl|br|header|footer|aside|main|nav|span class="[^"]*label)[^>]*>/gi, " | ");
  h = decode(h.replace(/<[^>]+>/g, " "));
  return h.replace(/\s+/g, " ").replace(/(\s*\|\s*)+/g, " | ").trim();
}

const MONEY = /(?:£|GBP\s?)\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d{2})?(?!\d)|(\d{1,3}(?:,\d{3})+)\s?GBP/g;
const INTL = /international|overseas|non[- ]uk|outside (?:of )?the uk|\bintl\b/gi;
const HOME = /\bhome\b|\buk students?\b|\b(?:uk|home) fees?\b|\bscottish\b|\bscotland\b|\bruk\b|rest of (?:the )?uk|\bengland\b|\(uk\)|\buk:|\buk\s*\/|\|\s*uk\s*\||republic of ireland|channel islands|isle of man/gi;
const NOISE = /pre-?masters|pre-?sessional|foundation|scholarship|bursar|discount|deposit|award|reduction|waiver|alumni|living cost|accommodation|salary|earn|per (?:10|15|20|30|60) credits?|per credit|per module|bench fee|additional cost|loan|stipend/gi;
const YEARS = /20(2\d)(?:\s?[\/–-]\s?(?:20)?(2\d))?/g;
const matches = (re, s) => [...s.matchAll(new RegExp(re.source, "gi"))].map(m => ({ i: m.index, end: m.index + m[0].length }));
const lastIdx = (re, s) => { const a = matches(re, s); return a.length ? a[a.length - 1].i : -1; };

/**
 * Find the full-time international tuition fee on a course page.
 * Every £ amount is scored by the words around it; the best-scoring one wins. Handles the three common layouts:
 *   "International: £33,000"                       (label before the amount)
 *   "UK | International | £14,390 | £33,900"       (column headers, then a row of amounts)
 *   "2026/27 | 2027/28 | International | £18,700 | £19,300"  (year columns)
 * Returns { fee, score, ctx, year } or null when nothing looks like an international fee.
 */
export function extractIntlFee(text, debug = false) {
  const cands = [];
  for (const m of text.matchAll(new RegExp(MONEY.source, "g"))) {
    const v = +(m[1] || m[2]).replace(/,/g, "");
    if (v < 9000 || v > 80000) continue;
    const before = text.slice(Math.max(0, m.index - 220), m.index), after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const near = before.slice(-90);
    let s = 0;
    const iI = lastIdx(INTL, before), iH = lastIdx(HOME, before);
    if (iI >= 0) s += iI >= before.length - 90 ? 5 : 3;
    if (/^\W{0,6}\(?(international|overseas)\b(?! scholarship)/i.test(after)) s += 4;
    if (iH > iI) s -= iH >= before.length - 60 ? 6 : 3;

    // Column layout: two adjacent header labels (home + international) followed by a run of amounts.
    const labels = [...matches(HOME, before).map(x => ({ ...x, t: "H" })), ...matches(INTL, before).map(x => ({ ...x, t: "I" }))].sort((a, b) => a.i - b.i);
    // The header is the trailing cluster of labels with no amount between them. Exactly two → column headers;
    // three or more is a tab bar followed by the open panel's own title, which the proximity score already handles.
    let c = labels.length - 1;
    while (c > 0 && labels[c].i - labels[c - 1].end < 40 && !matches(MONEY, before.slice(labels[c - 1].end, labels[c].i)).length) c--;
    // Several home labels in a row ("UK / Channel Islands / Isle of Man / Republic of Ireland") count as one column.
    const cluster = labels.slice(c).filter((l, i, a) => !i || l.t !== a[i - 1].t), [l1, l2] = cluster;
    if (cluster.length === 2 && l1.t !== l2.t) {
      const k = matches(MONEY, before.slice(l2.end)).length; // amounts between the header and this one
      const isIntl = (l1.t === "I") === (k % 2 === 0);
      s += isIntl ? 6 : -6;
    }
    // Year columns: amounts in a row under "2026/27 | 2027/28" — prefer the latest year's column.
    const runPos = (before.match(/(?:£\s?[\d,]+\*?\s*\|\s*)+$/) || [""])[0];
    const k = (runPos.match(/£/g) || []).length;
    const hdrYears = [...before.slice(0, before.length - runPos.length).matchAll(YEARS)].map(y => 2000 + +y[1]);
    let year = hdrYears.length ? hdrYears[hdrYears.length - 1] : 0;
    if (hdrYears.length >= 2) {
      const cols = hdrYears.slice(-Math.max(2, Math.min(hdrYears.length, 4)));
      if (cols.every((y, j) => !j || y > cols[j - 1]) && k < cols.length) { year = cols[k]; }
    }

    if (/part[- ]time/i.test(before.slice(-70)) && !/full[- ]time/i.test(before.slice(-40))) s -= 3;
    if (/full[- ]time/i.test(before)) s += 1;
    if (/^\W{0,3}(per year |a year )?\(?part[- ]time/i.test(after)) s -= 5;
    if (/^\W{0,3}(per year |a year )?\(?full[- ]time/i.test(after)) s += 2;
    if (lastIdx(NOISE, near.slice(Math.max(0, near.lastIndexOf("|", near.length - 3)))) >= 0 || lastIdx(NOISE, near.slice(-45)) >= 0 || /^[^|]{0,30}(scholarship|discount|deposit|bursary|waiver)/i.test(after)) s -= 5;
    if (/^\W{0,4}(per (year|annum)|a year|\/\s?year|pa\b|total|for the course)/i.test(after)) s += 1;
    cands.push({ fee: v, s, i: m.index, year, ctx: (before.slice(-110) + m[0] + after.slice(0, 30)).replace(/\s+/g, " ").trim() });
  }
  // Amounts labelled with a past academic year (e.g. "2024/25" in October 2026) are leftovers, not current fees.
  const stale = new Date().getFullYear() - 1;
  cands.forEach(c => { if (c.year && c.year < stale) c.s -= 10; });
  if (debug) return cands;
  if (!cands.length) return null;
  // Prefer the latest academic year mentioned (pages often list 2026/27 and 2027/28 side by side).
  const maxY = Math.max(...cands.filter(c => c.s >= 3).map(c => c.year), 0);
  cands.forEach(c => { if (maxY && c.year === maxY) c.s += 2; });
  const top = Math.max(...cands.map(c => c.s));
  if (top < 3) return null;
  const best = cands.filter(c => c.s === top);
  const freq = {}; best.forEach(c => freq[c.fee] = (freq[c.fee] || 0) + 1);
  const pick = best.sort((a, b) => freq[b.fee] - freq[a.fee] || a.i - b.i)[0];
  return { fee: pick.fee, score: pick.s, ctx: pick.ctx, year: pick.year || null };
}

/* ---------------- course details: title, start dates, whether it's still running, entry requirement ---------------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const SHORT = { 0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 4: "May", 5: "June", 6: "July", 7: "Aug", 8: "Sept", 9: "Oct", 10: "Nov", 11: "Dec" };
const monIdx = m => MONTHS.findIndex(x => x.toLowerCase().startsWith(m.slice(0, 3).toLowerCase()));
// Strong signs a course isn't recruiting any more; a closed deadline for one intake is not one of them.
const CLOSED = /(no longer (?:accepting|taking|recruiting|open to|running|offered|available)|not (?:currently )?(?:accepting|recruiting) (?:applications|students)|(?:course|programme) (?:has been |is (?:being )?)?(?:withdrawn|discontinued|suspended|closed to (?:new )?applic)|will not (?:run|be (?:running|offered|recruiting))|recruitment (?:has been |is )?(?:paused|suspended)|not open (?:to|for) (?:new )?applications)/i;
const DEADLINE_CLOSED = /applications? (?:for [^|.]{0,40})?(?:are |is |have |has )?(?:now )?closed/i;

/**
 * Course details from a course page's text: { title, intakes: ["Sept", "Jan"], status: "open"|"closed"|"check", statusNote, entry }.
 * Intakes only come from dates next to words like "start", "intake" or "entry", not open days or deadlines.
 */
export function extractCourseInfo(html, text = htmlToText(html)) {
  const clean = s => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const title = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]).slice(0, 160);
  const seen = new Set();
  const near = new RegExp(`(?:start(?:s|ing)?(?: dates?| month| in)?|intakes?|entry (?:points?|dates?|in)|course (?:begins|starts)|begins?|commenc\\w*)[^.]{0,45}?\\b${MON_RE}\\b`, "gi");
  for (const m of text.matchAll(near)) {
    // also pick up lists right after the first month: "Start dates: September, January"
    const tail = text.slice(m.index, m.index + m[0].length + 60);
    for (const x of tail.matchAll(new RegExp(`\\b${MON_RE}\\b`, "gi"))) { const k = monIdx(x[1]); if (k >= 0) seen.add(k); }
  }
  // Order from the September intake round: Sept, Oct, …, Aug.
  const intakes = [...seen].sort((a, b) => ((a + 4) % 12) - ((b + 4) % 12)).map(k => SHORT[k]).slice(0, 6);
  let status = "open", statusNote = "";
  const c = text.match(new RegExp(`[^|.]{0,80}${CLOSED.source}[^|.]{0,80}`, "i"));
  if (c) { status = "closed"; statusNote = clean(c[0]).slice(0, 200); }
  else { const d = text.match(new RegExp(`[^|.]{0,60}${DEADLINE_CLOSED.source}[^|.]{0,60}`, "i")); if (d) { status = "check"; statusNote = clean(d[0]).slice(0, 200); } }
  let entry = "";
  for (const m of text.matchAll(/entry requirements?|academic requirements?|you will need|applicants (?:should|must|will)/gi)) {
    const w = text.slice(m.index, m.index + 900);
    const e = w.match(/[^|.]{0,200}(2:1|2:2|2\.1|2\.2|upper second|lower second|second[- ]class|first[- ]class|honours degree|bachelor'?s degree|undergraduate degree)[^|]{0,240}/i);
    if (e) { entry = clean(e[0]).slice(0, 400); break; }
  }
  return { title, intakes, status, statusNote, entry };
}

/**
 * Fetch a course page and pull out the international fee (and the course details above).
 * Falls back to (1) JSON embedded in <script> tags for JS-rendered pages, then (2) a fees sub-page
 * linked from the course page (e.g. Cambridge's ".../cscsmpacs/finance").
 */
export async function scrapeCourse(url) {
  const { text: html, url: finalUrl } = await fetchText(url);
  let fee = extractIntlFee(htmlToText(html)), via = "page", src = finalUrl;
  if (!fee) { fee = extractIntlFee(htmlToText(html, { keepScripts: true })); via = "embedded data"; }
  if (!fee) {
    const base = new URL(finalUrl), path = base.pathname.replace(/\/+$/, "");
    const subs = [...new Set([...html.matchAll(/href="([^"#]+)"/gi)].map(x => { try { return new URL(x[1].replace(/&amp;/g, "&"), base); } catch { return null; } })
      .filter(u => u && u.host === base.host && u.pathname.startsWith(path + "/") && /fee|financ|cost/i.test(u.pathname.slice(path.length))).map(u => u.href))].slice(0, 2);
    for (const sub of subs) {
      try { const r = await fetchText(sub); fee = extractIntlFee(htmlToText(r.text)); if (fee) { via = "fees page"; src = r.url; break; } } catch {}
    }
  }
  return { url: finalUrl, src, fee, via, info: extractCourseInfo(html) };
}

/* ---------------- sitemap discovery (used by scripts/discover.mjs) ---------------- */
export async function sitemapUrls(origin, { want = /postgrad|masters|taught|course|study|pg|programme/i, max = 60000, log = () => {} } = {}) {
  const seeds = new Set();
  try { const { text } = await fetchText(origin + "/robots.txt"); for (const m of text.matchAll(/^sitemap:\s*(\S+)/gim)) seeds.add(m[1].trim()); } catch {}
  if (!seeds.size) ["/sitemap.xml", "/sitemap_index.xml", "/sitemap/sitemap.xml"].forEach(p => seeds.add(origin + p));
  const out = new Set(), seen = new Set(), queue = [...seeds].map(u => ({ u, d: 0 }));
  while (queue.length && seen.size < 80 && out.size < max) {
    const { u, d } = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    let xml; try { xml = (await fetchText(u, { binary: true, timeout: 20000 })).text; } catch (e) { log(`  sitemap ${u}: ${e.message}`); continue; }
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/g)].map(x => decode(x[1].trim()));
    if (/<sitemapindex/i.test(xml)) {
      // Child sitemaps: visit the course/study ones first, skip obvious news/events/people dumps.
      const kids = locs.filter(l => !/news|event|blog|staff|people|profile|research-output|publication|image|video|story|press/i.test(l));
      kids.sort((a, b) => want.test(b) - want.test(a));
      if (d < 3) kids.forEach(l => queue.push({ u: l, d: d + 1 }));
    } else locs.forEach(l => out.add(l));
  }
  return [...out];
}

// Words that don't distinguish one course page from another (degree names, placement variants, filler).
const SOFT = new Set(["msc", "ma", "mres", "mphil", "mfa", "with", "and", "the", "of", "in", "for", "a", "placement", "placements", "year", "industry", "professional", "practice", "months", "month", "yr", "yrs", "plus", "route", "industrial", "version", "adjacent", "by", "hons", "ft", "full", "time", "fulltime", "taught", "course", "courses", "degree", "masters", "postgraduate", "pg", "pgt", "wmg", "programme", "intake", "september", "january", "sept", "jan", "postgraduate"]);
// Qualifiers that change what the course is — a URL may not add one the programme name doesn't have.
const QUAL = new Set(["advanced", "applied", "conversion", "data", "cyber", "security", "business", "management", "engineering", "games", "robotics", "health", "finance", "analytics", "design", "research", "digital", "software", "network", "networks", "cloud", "information", "systems", "technology", "technologies", "law", "education", "marketing", "media", "creative", "art", "arts"]);
const ALIAS = { cs: ["computer", "science"], ai: ["artificial", "intelligence"], adv: ["advanced"], ux: ["user", "experience"], hci: ["human", "computer", "interaction"], "&": [], "vr/ar": [] };
export function progTokens(p) {
  const base = p.replace(/\(.*?\)|–.*$|\+.*$/g, " ").split("/")[0].toLowerCase();
  return base.split(/[^a-z&-]+/).flatMap(w => ALIAS[w] ?? w.split("-")).flatMap(w => ALIAS[w] ?? [w]).filter(w => w && !SOFT.has(w) && !/^\d+$/.test(w));
}
const isCourseUrl = u => /\/\/courses?\.|postgrad|masters|\/pg\b|\/pgt\b|taught|\/courses?\/|\/course-structure\/|\/study\/|programme|\/msc|-msc\b|\/degrees?\/|\/ma-|-ma\b/i.test(u)
  && !/news|event|blog|stor(y|ies)|journey|research-?(?:degree|group|centre|project)|postgraduate-research|staff|people|profile|module|online|distance|apprentice|undergrad|\/ug\/|foundation|short-course|cpd|summer|clearing|phd|doctor|mres|top-up|bsc|beng|meng|ba-|\/ba\/|part-time|-pt\b|library|case-stud|alumni|department|\/school|faculty|about|career|facilit|\/research\/|hub|campaign|applicant|prep|student-life|\/student\/|academic-information|induction|welcome|dubai|malaysia|ningbo|singapore|china|india|qatar|tashkent|sri-lanka|nepal|abroad|international-campus|-online|webinar|open-day/i.test(u);

/** Rank sitemap URLs for a programme name. Only URLs whose last path segment contains every key word qualify. */
export function rankCourseUrls(urls, programme, base) {
  const toks = progTokens(programme), want = new Set(toks), pl = programme.toLowerCase();
  if (!toks.length) return [];
  return urls.filter(isCourseUrl).map(url => {
    let U; try { U = new URL(url); } catch { return null; }
    const path = decodeURIComponent(U.pathname.toLowerCase());
    const segs = path.replace(/\/+$/, "").replace(/\/index\.\w+$/, "").split("/");
    let last = segs.pop().replace(/\.aspx?$|\.html?$|\.php$/, "");
    // ".../advanced-computer-science-msc/september-2027" → the slug is the parent segment
    if (/^((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-?)?(20\d\d(-\d\d)?)?$|^(overview|course|full-time|ft)$/.test(last) && segs.length) last = segs.pop();
    if (/pgcert|pgdip|pg-cert|pg-dip/.test(last) && !/msc|-ma\b|mphil/.test(last)) return null;
    if (/(^|-)courses?$/.test(last)) return null; // subject listing page, not a course
    const words = last.split(/[^a-z]+/).filter(Boolean).flatMap(w => ALIAS[w] ?? [w]);
    if (!toks.every(t => words.includes(t))) return null;
    const extra = words.filter(w => !want.has(w) && !SOFT.has(w));
    if (extra.length > 1 || extra.some(w => QUAL.has(w) && !pl.includes(w))) return null;
    const year = Math.max(0, ...(path.match(/20[2-3]\d/g) || []).map(Number));
    if (year && year < 2025) return null;
    let score = 10 - extra.length * 3 + (/postgrad|masters|\/pg|taught|msc/.test(path) ? 2 : 0) + (year ? (year - 2020) / 10 : 0);
    if (/placement|industry|professional|year-in/.test(last) && !/placement|industry|professional|year in/i.test(programme)) score -= 1;
    // Sitemaps sometimes list a CMS/CDN host (e.g. *.azurewebsites.net); serve the public site instead.
    if (base && !/\.ac\.uk$/.test(U.hostname)) { const B = new URL(base); U.protocol = B.protocol; U.host = B.host; }
    return { url: U.href, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.url.length - b.url.length);
}
