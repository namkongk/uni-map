/* Uni Map — app logic. No build step; plain browser JS. */
(() => {
"use strict";

const CFG = window.APP_CONFIG || {};
/* ---------------- country ---------------- */
// Each country has its own currency, map view, work rules and take-home pay model. You can show one country or several
// together (changing the selection reloads); each course keeps its own country's currency, tax and your work there.
const COUNTRIES = {
  uk: { code: "uk", name: "UK", full: "United Kingdom", flag: "🇬🇧", cur: "GBP", center: { lat: 54.6, lng: -3.2 }, zoom: 6, region: "GB",
        minWage: 12.71, visaHrs: 20, rank: "UK rank<br>(CUG 2027)",
        // 20% income tax + 8% National Insurance above the £12,570 personal allowance
        tax: g => 0.28 * Math.max(0, g - 12570),
        taxText: "after 20% tax + 8% NI above £12,570",
        visaText: "Visa: 20 h/week in term, full-time in vacations",
        depLabel: "Pre-CAS deposit" },
  de: { code: "de", name: "DE", full: "Germany", flag: "🇩🇪", cur: "EUR", center: { lat: 51.2, lng: 10.4 }, zoom: 6, region: "DE",
        minWage: 13.90, visaHrs: 20, rank: null,
        // Working students (Werkstudent): ≈9.3% pension contribution above the €603/month mini-job limit, plus income tax
        // (from 14%, ≈15% here) above the €12,348 tax-free allowance (2026).
        tax: g => 0.093 * Math.max(0, g - 7236) + 0.15 * Math.max(0, g - 12348),
        taxText: "after ≈9.3% pension above €603/month + ≈15% tax above €12,348",
        visaText: "Visa: 140 full days a year, 20 h/week in term",
        depLabel: "Paid before arrival" },
};
const SAVED_STATE = (() => { try { return JSON.parse(localStorage.getItem("ukmap-state") || "{}"); } catch (e) { return {}; } })();
const ALL = window.UNIDATA;
// Ticked countries, in menu order (older saves had a single "country").
const SEL = (() => {
  const want = Array.isArray(SAVED_STATE.countries) ? SAVED_STATE.countries : [SAVED_STATE.country || "uk"];
  const s = Object.keys(COUNTRIES).filter(k => want.includes(k));
  return s.length ? s : ["uk"];
})();
const MULTI = SEL.length > 1;
// The first ticked country: its currency is the default, and costs from other countries are compared in it.
const COUNTRY = COUNTRIES[SEL[0]];
const inCountry = co => SEL.includes(co || "uk");
const coOf = r => COUNTRIES[r.co || "uk"];
const ROWS = ALL.rows.filter(r => inCountry(r.co));
const UNIS = Object.fromEntries(Object.entries(ALL.unis).filter(([, u]) => inCountry(u.co)));
const CITY = Object.fromEntries(Object.entries(ALL.cities).filter(([c]) => inCountry(ALL.cityCo?.[c])));
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------------- country + display currency ---------------- */
// Course data is stored in the selected country's own currency; yearly amounts can be shown in another one.
// Hourly pay stays in the local currency because that's what jobs in that country pay in.
const CUR = {
  GBP: { sym: "£", name: "British pound" },
  NPR: { sym: "Rs ", name: "Nepalese rupee", grp: "en-IN" },
  USD: { sym: "US$", name: "US dollar" },
  EUR: { sym: "€", name: "Euro" },
  AUD: { sym: "A$", name: "Australian dollar" },
  CAD: { sym: "C$", name: "Canadian dollar" },
};
const CUR_LIST = ["NPR", "USD", "GBP", "EUR", "AUD"]; // offered for every country, alongside the country's own currency
const LSYM = CUR[COUNTRY.cur].sym;
// Units per 1 GBP. Built-in snapshot, replaced by live rates (open.er-api.com) when they load.
let FX = { date: "2026-10-01T00:02:31Z", src: "built-in", rates: { GBP: 1, NPR: 203.51, USD: 1.3266, EUR: 1.17, AUD: 1.9077, CAD: 1.8856 } };
// Amounts are stored in their own country's currency (`from`) and shown in the display currency.
const fxRate = (from = COUNTRY.cur) => (FX.rates[S.cur] ?? NaN) / FX.rates[from];
const curCode = (from = COUNTRY.cur) => isFinite(fxRate(from)) ? S.cur : from;
const toCur = (n, from = COUNTRY.cur) => { const k = fxRate(from); return isFinite(k) ? n * k : n; };
// A course's amount in the first country's currency, so costs from different countries can be compared and sorted.
const toBase = (n, r) => { const from = coOf(r).cur; return from === COUNTRY.cur ? n : n * FX.rates[COUNTRY.cur] / FX.rates[from]; };
// Converted figures are estimates anyway, so round them to tidy steps.
function money(n, from = COUNTRY.cur) {
  const code = curCode(from), c = CUR[code];
  let v = toCur(n, from);
  if (code !== from) { const a = Math.abs(v); v = Math.round(v / (a >= 1e6 ? 1000 : a >= 1e4 ? 100 : 10)) * (a >= 1e6 ? 1000 : a >= 1e4 ? 100 : 10); }
  v = Math.round(v);
  return (v < 0 ? "−" : "") + c.sym + Math.abs(v).toLocaleString(c.grp || "en-GB");
}
const r100 = n => Math.round(n / 100) * 100;
const rm = (r, n) => money(n, coOf(r).cur);   // an amount belonging to course r
const rsym = r => CUR[coOf(r).cur].sym;       // r's local currency symbol (hourly pay is always local)
const PNAME = { CS: "Computer Science", AI: "AI", HCI: "HCI / UX", HM: "Health & public health", NUR: "Nursing", DEV: "Development economics & finance", SF: "Sustainable & green finance", DM: "International development & NGO management" };
// Gross pay needed for a given take-home under the country's tax model (bisection — the model is piecewise linear).
const grossFor = (net, co = COUNTRY) => { if (net <= 0) return 0; let lo = net, hi = net * 3; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (m - co.tax(m) < net) lo = m; else hi = m; } return hi; };

// "Private university" used to be a warning on German courses; it's now the University type filter and a tag.
ROWS.forEach(r => { if (r.fl) r.fl = r.fl.split("; ").filter(x => x !== "Private university").join("; "); });
ROWS.forEach((r, i) => { r.id = i; r.f0 = r.f; r.fn0 = r.fn; r.s0 = r.s; r.sl0 = r.sl; r.i0 = r.i; r.fl0 = r.fl; });

/* ---------------- state ---------------- */
const MOBILE = matchMedia("(max-width:760px)").matches;
const GLASS_DEF = { theme: "auto", glassT: 45, glassBlur: 22 };
const newJob = (o = {}, co = COUNTRY) => ({ name: "", rate: co.minWage, hrs: 20, wks: 52, ...o });
const DEF = { lvs: [], dep: 50, jobs: [newJob()], sortK: "n", dir: 1, cur: COUNTRY.cur, grade: { uni: "", years: "4", type: "", val: "" }, subjs: [], budgetOpen: !MOBILE, filtersOpen: !MOBILE, alert: true, ...GLASS_DEF };
let S = { ...DEF, colf: {} };
try { Object.assign(S, JSON.parse(localStorage.getItem("ukmap-state") || "{}"), { colf: {} }); } catch (e) {}
S.countries = SEL.slice(); delete S.country;
// Jobs are kept per country (UK pay in £, German pay in €): "jobs" for the UK, "jobs_<code>" for others.
const JOBS = {};
for (const co of Object.keys(COUNTRIES)) { const v = co === "uk" ? S.jobs : S["jobs_" + co]; JOBS[co] = Array.isArray(v) && v.length && v !== DEF.jobs ? v : null; }
// Older saves had a single rate / hours / weeks — turn that into the first UK job.
if (!JOBS.uk) JOBS.uk = [newJob("rate" in S ? { rate: +S.rate || 0, hrs: +S.hrs || 0, wks: +S.wks || 0 } : {}, COUNTRIES.uk)];
for (const co in JOBS) JOBS[co] ||= [newJob({}, COUNTRIES[co])];
S.jobs = JOBS.uk;
delete S.rate; delete S.hrs; delete S.wks;
// The country whose jobs the Budget & work panel shows (a choice only when several countries are ticked).
let FIN_CO = SEL.includes(S.finCo) ? S.finCo : SEL[0];
// Study levels became a multi-select (empty = all); older saves had a single level.
if (!Array.isArray(SAVED_STATE.lvs)) S.lvs = S.lv && S.lv !== "ALL" ? [S.lv] : [];
delete S.lv;
// Subjects became a multi-select (empty = all); older saves had a single subject.
if (!Array.isArray(S.subjs)) S.subjs = [];
if (typeof S.subj === "string" && S.subj !== "ALL" && !S.subjs.length) S.subjs = [S.subj];
delete S.subj;
const save = () => { try {
  const { colf, ...rest } = S;
  for (const co in JOBS) rest[co === "uk" ? "jobs" : "jobs_" + co] = JOBS[co];
  localStorage.setItem("ukmap-state", JSON.stringify(rest));
} catch (e) {} };
const rowRate = {};

/* ---------------- finance ---------------- */
// Work is a list of jobs per country, each with its own pay/hr, hours/week and weeks/year; earnings add up across
// jobs. A course is judged on your work in its own country, under that country's tax rules.
const clamp = (v, max) => Math.min(max, Math.max(0, +v || 0));
const jobHours = j => clamp(j.hrs, 168) * clamp(j.wks, 52);
const jobGross = j => clamp(j.rate, 1000) * jobHours(j);
const J = (co = FIN_CO) => JOBS[co || "uk"];
const hours = (co = FIN_CO) => J(co).reduce((a, j) => a + jobHours(j), 0);          // total hours / year
const grossAll = (co = FIN_CO) => J(co).reduce((a, j) => a + jobGross(j), 0);
const avgRate = (co = FIN_CO) => hours(co) ? grossAll(co) / hours(co) : 0;           // blended pay/hr across all jobs
const weekHrs = (co = FIN_CO) => J(co).reduce((a, j) => a + clamp(j.hrs, 168), 0);
const takeHome = (rate, co = FIN_CO) => { const g = rate * hours(co); return g - COUNTRIES[co].tax(g); };
const netFee = r => Math.max(0, r.f - r.s);
const dep = r => Math.min(100, Math.max(0, +S.dep || 0)) / 100 * netFee(r);
const remFee = r => netFee(r) - dep(r);
const need = r => remFee(r) + r.l;
const needHr = r => { const H = hours(r.co || "uk"); if (!H) return Infinity; return grossFor(need(r), coOf(r)) / H; };
const rateOf = r => rowRate[r.id] ?? avgRate(r.co || "uk");
const deficit = r => need(r) - takeHome(rateOf(r), r.co || "uk");
const defText = (d, r) => d > 0 ? "~" + rm(r, r100(d)) : "Covered" + (d < 0 ? " (+" + rm(r, r100(-d)) + ")" : "");

/* ---------------- your bachelor's grade (Nepal) → typical UK class ---------------- */
// Typical conversions from UK universities' published Nepal tables (QMUL, LJMU, RGU, Surrey, Portsmouth, Suffolk…).
// Tribhuvan University marks lower than KU / PU / Purbanchal, so TU percentages need ~5 points less for the same class.
// A 3-year degree is treated as ~5 points (0.2 GPA) lower than a 4-year one; some universities need 4 years or a master's.
const CLS_RANK = { "1st": 4, "2:1": 3, "2:2": 2, "3rd": 1 };
const CLS_LABEL = { "1st": "First-class (1st)", "2:1": "Upper second (2:1)", "2:2": "Lower second (2:2)", "3rd": "Below a 2:2" };
const LETTER_GPA = { "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7, "C+": 2.3, "C": 2.0 };
const NEPAL_UNI = { TU: "Tribhuvan University", KU: "Kathmandu University", PU: "Pokhara University", PUR: "Purbanchal University", OTHER: "another Nepali university" };
function ukClassOf(g) {
  if (!g || !g.type || g.val === "" || g.val == null) return null;
  const three = g.years === "3";
  if (g.type === "div") {
    // Divisions are broad bands: First Division (60%+) is only a 2:1 at 65%+, so without a % we use the safer 2:2.
    const c = { dist: "1st", first: "2:2", second: "3rd", third: "3rd" }[g.val];
    return c && three && c === "1st" ? "2:1" : c || null;
  }
  if (g.type === "pct") {
    let p = +g.val; if (!(p >= 0 && p <= 100)) return null;
    if (three) p -= 5;
    const [a, b, c] = g.uni === "TU" ? [75, 65, 55] : [80, 70, 60];
    return p >= a ? "1st" : p >= b ? "2:1" : p >= c ? "2:2" : "3rd";
  }
  let gpa = g.type === "letter" ? LETTER_GPA[g.val] : +g.val;
  if (!(gpa >= 0 && gpa <= 4)) return null;
  if (three) gpa -= 0.2;
  return gpa >= 3.6 ? "1st" : gpa >= 3.0 ? "2:1" : gpa >= 2.4 ? "2:2" : "3rd";
}
const myClass = () => ukClassOf(S.grade);

/* ---------------- scholarships you can get (from scripts/scholarships.json) ---------------- */
// Sorts each university's awards for one course: sure (automatic, incl. grade awards you meet), needs a higher grade,
// apply (competitive), early-payment discounts, and conditional/other ones.
function awardsFor(r, cls = myClass()) {
  const res = { sure: [], grade: [], apply: [], early: [], other: [] };
  if (r.lv !== "Masters") return res;
  for (const a of UNIS[r.u].sch || []) {
    if (a.courses && !a.courses.includes(r.p)) { res.other.push({ ...a, why: `Only for ${a.courses.join(", ")}` }); continue; }
    if (a.kind === "nepal" || a.kind === "auto") res.sure.push(a);
    else if (a.kind === "grade") (cls && CLS_RANK[cls] >= CLS_RANK[a.min] ? res.sure : res.grade).push(a);
    else if (a.kind === "apply") res.apply.push(a);
    else if (a.kind === "early") res.early.push(a);
    else res.other.push({ ...a, why: a.kind === "pathway" ? "Pathway college only" : "Partner institutions only" });
  }
  return res;
}
// The best automatic award you qualify for becomes the course's "sure scholarship" (never added on top of another).
function applyAwards() {
  for (const r of ROWS) {
    r.s = r.s0; r.sl = r.sl0; r.aw = null;
    if (r.lv !== "Masters") continue;
    const best = awardsFor(r).sure.filter(a => a.amt).sort((a, b) => b.amt - a.amt)[0];
    if (best && best.amt > r.s0) { r.s = best.amt; r.sl = `${best.name} (${best.kind === "nepal" ? "Nepal, " : ""}${best.kind === "grade" ? "your grade, " : ""}automatic)`; r.aw = best; }
    r.t = r.f + r.l; r.n = r.t - r.s;
  }
}

/* ---------------- live data (fees re-read from university course pages via /api/refresh) ---------------- */
const LIVE_KEY = "ukmap-live";
let LIVE = { checked: null, res: {} };
try { Object.assign(LIVE, JSON.parse(localStorage.getItem(LIVE_KEY) || "{}")); } catch (e) {}
const saveLive = () => { try { localStorage.setItem(LIVE_KEY, JSON.stringify(LIVE)); } catch (e) {} };
// A live fee is applied only when it's within this range of the stored one; anything else is more likely a
// mis-read (part-time / home fee picked up) than a real change, so it's listed as "needs check" instead.
const SANE = [0.85, 1.35];
const yearLabel = y => y ? `${String(y).slice(2)}/${String(y + 1).slice(2)}` : "";

function liveStatus(r) {
  const x = r.url && LIVE.res[r.url];
  if (!x) return r.url ? "unchecked" : "nosource";
  if (!x.ok) return "unreadable";
  const k = x.fee / r.f0;
  return k >= SANE[0] && k <= SANE[1] ? (x.fee === r.f0 ? "same" : "updated") : "mismatch";
}
function applyLive() {
  for (const r of ROWS) {
    if (r.lv !== "Masters") continue;
    r.f = r.f0; r.fn = r.fn0; r.live = null; r.i = r.i0; r.fl = r.fl0; r.iLive = false; r.closed = null;
    // Course details read from the course page: start dates replace the stored intakes; a course that has
    // stopped recruiting (or whose page is gone) gets a warning, which "Hide warnings" also filters out.
    const info = r.url && LIVE.res[r.url]?.info;
    if (info) {
      if (info.intakes?.length) { r.i = info.intakes.join(", "); r.iLive = r.i !== r.i0; }
      if (info.status === "closed" || info.status === "gone") {
        r.closed = { status: info.status, note: info.statusNote || "" };
        r.fl = [r.fl0, info.status === "gone" ? "Course page removed — check it still runs" : "Not taking applications (per course page)"].filter(Boolean).join("; ");
      }
    }
    const st = liveStatus(r);
    if (st === "updated" || st === "same") {
      const x = LIVE.res[r.url];
      r.f = x.fee; r.fn = "live" + (x.year ? " " + yearLabel(x.year) : ""); r.live = x;
    }
    r.t = r.f + r.l; r.n = r.t - r.s;
  }
  // PhD fees are estimates derived from the same university's masters fees (≈85%, see scripts/build_data.py).
  const by = {};
  ROWS.forEach(r => { if (r.lv === "Masters") (by[r.u] ||= []).push(r.f); });
  for (const r of ROWS) {
    if (r.lv !== "PhD" || !by[r.u]) continue;
    const avg = by[r.u].reduce((a, b) => a + b, 0) / by[r.u].length;
    r.f = Math.min(42000, Math.max(15000, Math.round(avg * 0.85 / 500) * 500));
    r.t = r.f + r.l; r.n = r.t - r.s;
  }
  applyAwards();
}
applyLive();

/* ---------------- geo ---------------- */
const kmBetween = (a, b) => { const t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const uniKm = (u, city) => kmBetween([UNIS[u].lat, UNIS[u].lng], CITY[city]);

const DEP_LABEL = MULTI ? "Deposit" : COUNTRY.depLabel;
/* ---------------- columns (all from the previous table + level + remaining fee + map) ---------------- */
const COLS = [
  { k: "sl", h: "★", type: "star", get: r => isShort(r) ? 0 : 1 },
  { k: "lv", h: "Level", type: "text", get: r => r.lv },
  { k: "g", h: "Subject", type: "text", get: r => r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g] },
  { k: "u", h: "University", type: "text", get: r => r.u + " " + r.c },
  ...(SEL.includes("uk") ? [{ k: "uk", h: COUNTRIES.uk.rank, type: "num", get: r => r.uk ?? 99999, disp: r => ukRankText(r) }] : []),
  { k: "qs", h: "World rank<br>(QS 2027)", type: "num", get: r => r.qss ?? 99999, disp: r => rankText(r.qs, r) },
  { k: "p", h: "Programme", type: "text", get: r => r.p },
  { k: "i", h: "Intakes", type: "text", get: r => r.i },
  { k: "f", h: "Tuition / yr<br>(intl)", type: "num", get: r => r.f, money: true },
  { k: "l", h: "Living / yr", type: "num", get: r => r.l, money: true },
  { k: "t", h: "Total yr 1", type: "num", get: r => r.t, money: true },
  { k: "s", h: "Sure scholarship<br>(automatic)", type: "num", get: r => r.s, money: true },
  { k: "n", h: "Total with sure<br>scholarship", type: "num", get: r => r.n, money: true },
  { k: "dep", h: DEP_LABEL, type: "num", get: dep, dyn: () => `${DEP_LABEL}<br>(${+S.dep || 0}% tuition)`, money: true },
  { k: "rem", h: "Remaining fee<br>(after deposit)", type: "num", get: remFee, money: true },
  { k: "hr", h: "Pay needed / hr<br>(fee + living)", type: "num", get: needHr, local: true },
  { k: "rt", h: MULTI ? "Your avg rate<br>per hour" : `Your avg rate<br>${LSYM}/hr`, type: "num", get: rateOf, local: true },
  { k: "df", h: "Deficit / yr<br>(− = surplus)", type: "num", get: deficit, money: true },
  { k: "aw", h: "Scholarships<br>for you", type: "text", get: r => awardsText(r) },
  { k: "o", h: "Other scholarships<br>(competitive)", type: "text", get: r => otherSch(r) },
  { k: "pl", h: "Placement", type: "text", get: r => r.pl },
  { k: "fl", h: "Warnings", type: "text", get: r => r.fl || "" },
  { k: "map", h: "Map", type: "none", get: () => "" },
];
// Universities added later (nr) haven't had their league-table positions checked yet.
const isPrivate = u => !!UNIS[u]?.priv;   // privately run; all other universities are public
const rankText = (v, r) => v ?? (r.nr ? "Not checked" : "Unranked");
const ukRankText = r => (r.co || "uk") === "uk" ? rankText(r.uk, r) : "—";   // the UK league table only ranks UK universities
// Small note under a tuition figure: live source link, or why the stored figure is still shown.
function feeNote(r) {
  const st = liveStatus(r), x = r.url && LIVE.res[r.url];
  if (r.live) return `<a class="sub live" href="${esc(x.src || r.url)}" target="_blank" rel="noopener" title="${esc(x.ctx || "")}">${esc(r.fn)}${r.f !== r.f0 ? ` · was ${rm(r, r.f0)}` : ""} ↗</a>`;
  if (st === "mismatch") return `<span class="sub warn" title="${esc(x.ctx || "")}">${esc(r.fn)}${r.fn ? " · " : ""}page shows ${rm(r, x.fee)} — check</span>`;
  return r.fn ? `<span class="sub">${esc(r.fn)}</span>` : "";
}
// Plain text (for filtering/sorting) and HTML (for the table) of the scholarships matched to a course.
function awardsText(r) {
  const A = awardsFor(r); if (r.lv !== "Masters") return "";
  return [...(r.s0 && !A.sure.some(a => a.amt >= r.s0) ? [rm(r, r.s0) + " " + (r.sl0 || "")] : []), ...A.sure.map(a => a.amtText + " " + a.name), ...A.grade.map(a => a.amtText + " if " + a.min), ...A.apply.map(a => a.name), ...A.early.map(a => a.name)].join(" · ");
}
function awardsCell(r) {
  if (r.lv !== "Masters") return `<span class="muted">—</span>`;
  const A = awardsFor(r), cls = myClass(), out = [];
  // A scholarship already in the built-in data (and not beaten by a newer award) still counts.
  if (r.s0 && !A.sure.some(a => a.amt >= r.s0)) out.push(`<span class="awc ok">✓ ${rm(r, r.s0)} <small>${esc(r.sl0 || "Listed scholarship")}</small></span>`);
  A.sure.forEach(a => out.push(`<span class="awc ok" title="${esc(a.note)}">✓ ${esc(a.amtText)} <small>${esc(a.name)}${a.kind === "nepal" ? " · Nepal" : ""}</small></span>`));
  A.grade.forEach(a => out.push(`<span class="awc need" title="${esc(a.note)}">${esc(a.amtText)} <small>needs ${esc(a.min)}${cls ? ` (you ≈ ${esc(cls)})` : " — add your grade"}</small></span>`));
  if (A.apply.length) out.push(`<span class="awc apply" title="${esc(A.apply.map(a => a.name + ": " + a.amtText).join("\n"))}">+${A.apply.length} to apply for <small>${esc(A.apply.map(a => a.amtText).join(", "))}</small></span>`);
  A.early.forEach(a => out.push(`<span class="awc early" title="${esc(a.note)}">${esc(a.amtText)} <small>if you pay early</small></span>`));
  return out.join("") || `<span class="muted">None found</span>`;
}
const otherSch = r => r.lv === "PhD" ? (r.o || "") : "Chevening (full)" + (r.o ? "; " + r.o : "");

/* ---------------- filters ---------------- */
function numMatch(val, expr) {
  const m = expr.replace(/[^\d.<>=-]/g, "").match(/^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)(?:-(\d+))?$/);
  if (!m) return null;
  if (m[3]) return val >= +m[2] && val <= +m[3];
  const n = +m[2];
  switch (m[1]) { case "<": return val < n; case "<=": return val <= n; case ">": return val > n; case ">=": return val >= n; default: return val === n; }
}
function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const max = +$("maxcost").value, city = $("city").value, rank = $("rank").value, rad = +$("radius").value || 0, utype = $("utype").value;
  return ROWS.filter(r => {
    if (S.lvs.length && !S.lvs.includes(r.lv)) return false;
    if (S.subjs.length && !r.subj.some(g => S.subjs.includes(g))) return false;
    if (toBase(r.n, r) > max) return false;
    if (city) { if (rad > 0 ? uniKm(r.u, city) > rad : r.c !== city) return false; }
    if (rank === "ranked" && r.qs == null) return false;
    if (rank && rank !== "ranked" && !(r.qss <= +rank)) return false;
    if (utype && (utype === "private") !== isPrivate(r.u)) return false;
    if ($("f-sure").checked && !r.s) return false;
    if ($("f-place").checked && !r.pl.startsWith("Yes")) return false;
    if ($("f-jan").checked && !/Jan|Feb|Mar|Apr|May|Jun|Jul|Nov/.test(r.i)) return false;
    if ($("f-london").checked && r.c === "London") return false;
    if ($("f-noflag").checked && r.fl) return false;
    if ($("f-noest").checked && /est/.test(r.fn)) return false;
    if ($("f-entry").checked && entryCheck(r).state === "no") return false;
    if (q && ![r.u, r.c, r.p, r.i, r.sl, otherSch(r), r.pl, r.fl, r.lv, PNAME[r.g], r.en].join(" ").toLowerCase().includes(q)) return false;
    for (const c of COLS) {
      const f = S.colf[c.k]; if (!f || c.type === "none") continue;
      if (c.type === "num") {
        const ok = numMatch(c.money ? toCur(c.get(r), coOf(r).cur) : c.get(r), f); // money filters are typed in the display currency
        if (ok === null) { if (!String(c.disp ? c.disp(r) : c.get(r)).toLowerCase().includes(f.toLowerCase())) return false; }
        else if (!ok) return false;
      } else if (!String(c.get(r)).toLowerCase().includes(f.toLowerCase())) return false;
    }
    return true;
  });
}

/* ---------------- header controls ---------------- */
/* countries, study levels and subjects: dropdowns of checkboxes */
// The interface is drawn slightly smaller (CSS zoom --uiz); positions measured on screen are divided by it.
const UIZ = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--uiz")) || 1;
function placeMenu(btn, menu, open) {
  menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  if (open) {
    const r = btn.getBoundingClientRect(), z = UIZ(), w = menu.getBoundingClientRect().width;
    menu.style.top = (r.bottom + 10) / z + "px";
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) / z + "px";
    menu.querySelector("input:checked, input").focus();
  }
}
/* study levels: any combination; ticking "All levels" clears the rest */
const LEVELS = ["Masters", "PhD"];
const setLvMenu = open => placeMenu($("lvBtn"), $("lvMenu"), open);
function syncLv() {
  const all = !S.lvs.length;
  $("lvMenu").querySelectorAll("input").forEach(i => { i.checked = i.value === "ALL" ? all : S.lvs.includes(i.value); });
  $("lvLbl").textContent = all ? "All levels" : S.lvs.join(" + ");
  $("lvBtn").classList.toggle("on", !all);
  $("lvN-ALL").textContent = ROWS.length;
  LEVELS.forEach(l => { $("lvN-" + l).textContent = ROWS.filter(r => r.lv === l).length; });
}
$("lvBtn").addEventListener("click", e => { e.stopPropagation(); setLvMenu($("lvMenu").hidden); });
$("lvMenu").addEventListener("change", e => {
  const i = e.target; if (i.type !== "checkbox") return;
  if (i.value === "ALL") S.lvs = [];
  else S.lvs = LEVELS.filter(l => l === i.value ? i.checked : S.lvs.includes(l));
  if (S.lvs.length === LEVELS.length) S.lvs = [];   // everything ticked = all levels
  save(); update();
});
document.addEventListener("pointerdown", e => { if (!$("lvMenu").hidden && !e.target.closest("#lvMenu, #lvBtn")) setLvMenu(false); });
addEventListener("resize", () => { if (!$("lvMenu").hidden) setLvMenu(false); });
/* subjects: any combination; ticking "All subjects" clears the rest */
const setSubjMenu = open => placeMenu($("subjBtn"), $("subjMenu"), open);
function syncSubj() {
  const all = !S.subjs.length;
  $("subjMenu").querySelectorAll("input").forEach(i => { i.checked = i.value === "ALL" ? all : S.subjs.includes(i.value); });
  $("subjLbl").textContent = all ? "All subjects" : S.subjs.length === 1 ? PNAME[S.subjs[0]] : `${S.subjs.length} subjects`;
  $("subjBtn").classList.toggle("on", !all);
  // how many courses each subject has at the chosen level
  const lv = ROWS.filter(r => !S.lvs.length || S.lvs.includes(r.lv));
  $("subjN-ALL").textContent = lv.length;
  Object.keys(PNAME).forEach(g => { $("subjN-" + g).textContent = lv.filter(r => r.subj.includes(g)).length; });
}
$("subjBtn").addEventListener("click", e => { e.stopPropagation(); setSubjMenu($("subjMenu").hidden); });
$("subjMenu").addEventListener("change", e => {
  const i = e.target; if (i.type !== "checkbox") return;
  if (i.value === "ALL") S.subjs = [];
  else S.subjs = i.checked ? [...new Set([...S.subjs, i.value])] : S.subjs.filter(g => g !== i.value);
  if (S.subjs.length === Object.keys(PNAME).length) S.subjs = [];   // everything ticked = all subjects
  save(); update();
});
document.addEventListener("pointerdown", e => { if (!$("subjMenu").hidden && !e.target.closest("#subjMenu, #subjBtn")) setSubjMenu(false); });
addEventListener("resize", () => { if (!$("subjMenu").hidden) setSubjMenu(false); });
Object.keys(CITY).sort().forEach(c => { const o = document.createElement("option"); o.value = o.textContent = c; $("city").appendChild(o); });
function fitMaxCost() {
  const el = $("maxcost"), atMax = el.value === el.max;
  el.max = Math.ceil(Math.max(...ROWS.map(r => toBase(r.n, r))) / 1000) * 1000;
  if (atMax) el.value = el.max;
}
fitMaxCost(); $("maxcost").value = $("maxcost").max;
// University type: how many courses each option has (in the ticked countries)
{ const nPriv = ROWS.filter(r => isPrivate(r.u)).length;
  $("utype").options[1].textContent = `Public (${ROWS.length - nPriv})`; $("utype").options[2].textContent = `Private (${nPriv})`;
  if (!nPriv) $("utype").options[2].disabled = true; }
["q", "maxcost", "city", "radius", "rank", "utype", "f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest"].forEach(id => $(id).addEventListener("input", () => update({ fit: ["city", "radius"].includes(id) })));
$("reset").addEventListener("click", () => {
  $("q").value = ""; $("maxcost").value = $("maxcost").max; $("city").value = ""; $("radius").value = ""; $("rank").value = ""; $("utype").value = "";
  ["f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest", "f-entry"].forEach(id => $(id).checked = false);
  document.querySelectorAll("#frow input").forEach(i => i.value = ""); S.colf = {};
  S.lvs = []; S.subjs = []; S.sortK = "n"; S.dir = 1; save(); update({ fit: true });
});
if (!S.alert || !SEL.includes("uk")) $("alert").hidden = true; // the alert is about a UK scholarship
// UK-only filter: "Outside London".
if (!SEL.includes("uk")) { $("f-london").checked = false; $("f-london").closest("label").hidden = true; }
$("alertX").addEventListener("click", () => { $("alert").hidden = true; S.alert = false; save(); });

/* ---------------- floating filter card ---------------- */
// On phones the cards stack at the bottom of the screen, so only one is open at a time.
$("filtersToggle").addEventListener("click", () => { S.filtersOpen = !S.filtersOpen; if (MOBILE && S.filtersOpen) { S.budgetOpen = false; applyBudget(); } save(); applyFilters(); });
const applyFilters = () => { $("filtersToggle").setAttribute("aria-expanded", String(S.filtersOpen)); $("filtersBody").hidden = !S.filtersOpen; };
applyFilters();
function activeFilterCount() {
  let n = ["q", "city", "rank", "utype"].filter(id => $(id).value.trim()).length;
  n += ["f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest", "f-entry"].filter(id => $(id).checked).length;
  if ($("maxcost").value !== $("maxcost").max) n++;
  return n;
}

/* ---------------- bachelor's grade form (filters card) ---------------- */
if (!S.grade || typeof S.grade !== "object") S.grade = { uni: "", years: "4", type: "", val: "" };
function renderGradeInput() {
  const t = S.grade.type, wrap = $("gValWrap"), v = S.grade.val;
  const opts = { letter: Object.keys(LETTER_GPA).map(k => [k, `${k} (${LETTER_GPA[k].toFixed(1)})`]),
                 div: [["dist", "Distinction"], ["first", "First Division"], ["second", "Second Division"], ["third", "Third Division / Pass"]] }[t];
  wrap.innerHTML = `<label for="gVal">Your result</label>` + (opts
    ? `<select id="gVal"><option value="">Select…</option>${opts.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("")}</select>`
    : `<input id="gVal" type="number" inputmode="decimal" ${t === "pct" ? 'min="0" max="100" step="0.1" placeholder="e.g. 68"' : t === "gpa" ? 'min="0" max="4" step="0.01" placeholder="e.g. 3.2"' : 'disabled placeholder="—"'} value="${esc(v)}">`);
  $("gVal").addEventListener("input", e => { S.grade.val = e.target.value; gradeChanged(); });
}
function syncGradeForm() {
  $("gUni").value = S.grade.uni; $("gYears").value = S.grade.years || "4"; $("gType").value = S.grade.type;
  renderGradeInput(); syncGradeOut();
}
// Germany: the modified Bavarian formula used by most German universities, N = 1 + 3 × (best − yours) / (best − pass),
// on a 1.0 (best) – 4.0 (pass) scale. Pass marks assumed: 40% or CGPA 2.0; divisions use a typical percentage.
function germanGrade(g) {
  if (!g || !g.type || g.val === "") return null;
  let best, pass, v;
  if (g.type === "pct") { best = 100; pass = 40; v = +g.val; }
  else if (g.type === "gpa") { best = 4; pass = 2; v = +g.val; }
  else if (g.type === "letter") { best = 4; pass = 2; v = LETTER_GPA[g.val]; }
  else if (g.type === "div") { best = 100; pass = 40; v = { dist: 80, first: 65, second: 50, third: 42 }[g.val]; }
  if (!isFinite(v)) return null;
  return Math.min(4, Math.max(1, 1 + 3 * (best - v) / (best - pass)));
}
function syncGradeOut() {
  const gap = gapYears() || 0;
  const out = $("gradeOut"), parts = [SEL.includes("uk") ? gradeUK() : "", SEL.includes("de") ? gradeDE() : "",
    gap ? `<p class="go-note">${gap}-year gap${workYears() ? ` — your ${workYears()} year${workYears() === 1 ? "" : "s"} of work experience ${workYears() >= gap ? "covers it" : "helps explain it"}; mention it in your statement` : ": explain it in your statement; some universities ask for work or study evidence"}.</p>` : ""].filter(Boolean);
  out.hidden = !parts.length;
  out.innerHTML = parts.map(p => `<div class="go-part">${p}</div>`).join("");
}
function gradeDE() {
    const g = S.grade, n = germanGrade(g);
    if (n == null) return "";
    return `<div class="go-main"><span class="go-k">German grade</span><b class="go-cls">${n.toFixed(1)}</b></div>
      <p class="go-sub">Bavarian formula, ${g.type === "gpa" || g.type === "letter" ? "2.0 CGPA" : "40%"} pass mark · universities convert it themselves</p>
      <p class="go-note">${n <= 2.5 ? "Meets the usual 2.5 cut-off." : "Many courses ask for 2.5 or better."}</p>`;
}
function gradeUK() {
  const g = S.grade, cls = ukClassOf(g);
  if (!cls) return "";
  const what = g.type === "pct" ? `${g.val}%` : g.type === "gpa" ? `CGPA ${g.val}` : g.type === "letter" ? `grade ${g.val}` : $("gVal").selectedOptions?.[0]?.textContent;
  const notes = [];
  if (g.type === "div" && g.val === "first") notes.push("Enter your % for a precise result (65%+ can be a 2:1).");
  if (g.years === "3") notes.push("Some universities (e.g. Edinburgh, QUB) need a 4-year degree.");
  if (cls === "3rd") notes.push("Most UK master's need a 2:2.");
  if (!g.uni && g.type === "pct") notes.push("Pick your university — TU % convert more generously.");
  return `<div class="go-main"><span class="go-k">UK equivalent</span><b class="go-cls cls-${cls.replace(":", "")}">${cls === "3rd" ? "Below 2:2" : cls}</b></div>
    <p class="go-sub">${esc(CLS_LABEL[cls])} · ${esc(what || "")}${g.uni ? " from " + esc(NEPAL_UNI[g.uni]) : ""}, ${g.years === "3" ? "3" : "4"}-year degree · typical conversion</p>
    ${notes.map(n => `<p class="go-note">${esc(n)}</p>`).join("")}`;
}
function gradeChanged() { save(); syncGradeOut(); syncEduHint(); applyLive(); fitMaxCost(); update(); }
$("gUni").addEventListener("input", e => { S.grade.uni = e.target.value; gradeChanged(); });
$("gYears").addEventListener("input", e => { S.grade.years = e.target.value; gradeChanged(); });
$("gType").addEventListener("input", e => { S.grade.type = e.target.value; S.grade.val = ""; renderGradeInput(); gradeChanged(); });

/* ---------------- display currency ---------------- */
const FX_KEY = "ukmap-fx";
try { const c = JSON.parse(localStorage.getItem(FX_KEY) || "null"); if (c && c.rates && c.rates.GBP) FX = c; } catch (e) {}
if (!CUR[S.cur]) S.cur = COUNTRY.cur;
// Compact labels for the toolbar pill ("£ GBP (UK)", "Rs NPR"); full names go in each option's tooltip.
const OWN = Object.fromEntries(SEL.map(co => [COUNTRIES[co].cur, COUNTRIES[co].name]));   // currency → country
$("cur").innerHTML = [...new Set([...Object.keys(OWN), ...CUR_LIST])]
  .map(k => `<option value="${k}" title="${CUR[k].name}${OWN[k] ? ` (${OWN[k]} currency)` : ""}">${CUR[k].sym.trim()} ${k}${OWN[k] ? ` (${OWN[k]})` : ""}</option>`).join("");
function syncCurrency() {
  $("cur").value = S.cur;
  const when = new Date(FX.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const conv = SEL.map(co => COUNTRIES[co].cur).filter(c => c !== S.cur);
  $("curPick").title = "Show prices in " + CUR[S.cur].name + ". " + (!conv.length ? `Prices as published, in ${CUR[S.cur].name}s.`
    : conv.map(c => `${CUR[c].sym}1 = ${CUR[S.cur].sym}${fxRate(c).toFixed(fxRate(c) < 10 ? 4 : 2)}`).join(" · ") + ` · rates of ${when}${FX.src === "live" ? "" : " (offline estimate)"}. Hourly pay stays in each country's currency.`);
}
$("cur").addEventListener("input", () => { S.cur = $("cur").value; save(); syncCurrency(); syncFin(); update(); });
async function loadRates() {
  if (FX.src === "live" && Date.now() - Date.parse(FX.fetched) < 12 * 3600e3) return; // cached for 12 h
  try {
    const j = await (await fetch("https://open.er-api.com/v6/latest/GBP")).json();
    if (j.result !== "success" || !j.rates.NPR) throw new Error("bad rates");
    FX = { date: new Date(j.time_last_update_unix * 1000).toISOString(), fetched: new Date().toISOString(), src: "live", rates: j.rates };
    try { localStorage.setItem(FX_KEY, JSON.stringify(FX)); } catch (e) {}
    syncCurrency(); if (S.cur !== COUNTRY.cur || MULTI) { fitMaxCost(); syncFin(); update(); }
  } catch (e) { /* keep the built-in rates */ }
}
syncCurrency();
syncGradeForm();

/* ---------------- appearance: theme, glass transparency, blur ---------------- */
// Transparency 0 → nearly solid windows (tint .94); 100 → almost clear (tint .08).
let onThemeChange = () => {}; // set once a map exists
function applyAppearance() {
  const root = document.documentElement, t = Math.min(100, Math.max(0, +S.glassT)), b = Math.min(40, Math.max(0, +S.glassBlur));
  root.style.setProperty("--glass-a", (0.94 - t / 100 * 0.86).toFixed(3));
  root.style.setProperty("--glass-blur", b + "px");
  if (S.theme === "auto") delete root.dataset.theme; else root.dataset.theme = S.theme;
  onThemeChange(); // the Google map follows the site theme
  $("themeSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === S.theme)));
  $("glassT").value = t; $("glassTv").textContent = t + "%";
  $("glassBlur").value = b; $("glassBlurv").textContent = b ? b + " px" : "Off";
  fillRanges();
}
// Paint the accent fill of every range slider up to its thumb.
function fillRanges() {
  document.querySelectorAll('input[type="range"]').forEach(r => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100 || 0) + "%"));
}
$("themeSeg").querySelectorAll("button").forEach(x => x.addEventListener("click", () => { S.theme = x.dataset.v; save(); applyAppearance(); }));
$("glassT").addEventListener("input", e => { S.glassT = +e.target.value; save(); applyAppearance(); });
$("glassBlur").addEventListener("input", e => { S.glassBlur = +e.target.value; save(); applyAppearance(); });
$("glassReset").addEventListener("click", () => { Object.assign(S, GLASS_DEF); save(); applyAppearance(); });
/* ---------------- country picker: tick one or more; applied (with a reload) when the menu closes ---------------- */
const CO_ROWS = Object.fromEntries(Object.keys(COUNTRIES).map(co => [co, ALL.rows.filter(r => (r.co || "uk") === co).length]));
(function syncCountryUI() {
  $("countryBtn").querySelector(".flag").textContent = SEL.map(co => COUNTRIES[co].flag).join("");
  $("countryBtn").querySelector(".c-name").textContent = SEL.map(co => COUNTRIES[co].name).join(" + ");
  $("countryBtn").setAttribute("aria-label", "Countries: " + SEL.map(co => COUNTRIES[co].full).join(" and "));
  $("countryMenu").querySelectorAll("input").forEach(i => { i.checked = SEL.includes(i.value); $("coN-" + i.value).textContent = CO_ROWS[i.value]; });
})();
const pickedCountries = () => [...$("countryMenu").querySelectorAll("input:checked")].map(i => i.value);
function setCountryMenu(open) {
  placeMenu($("countryBtn"), $("countryMenu"), open);
  if (!open) applyCountries();
}
function applyCountries() {
  const want = Object.keys(COUNTRIES).filter(co => pickedCountries().includes(co));
  if (!want.length || want.join() === SEL.join()) { $("countryMenu").querySelectorAll("input").forEach(i => { i.checked = SEL.includes(i.value); }); $("coApply").hidden = true; return; }
  // Keep the chosen display currency unless it was the old first country's own; column filters are per selection.
  if (S.cur === COUNTRY.cur) S.cur = COUNTRIES[want[0]].cur;
  if (!want.includes(FIN_CO)) S.finCo = want[0];
  S.countries = want; S.colf = {}; save(); location.reload();
}
$("countryBtn").addEventListener("click", e => { e.stopPropagation(); setCountryMenu($("countryMenu").hidden); });
$("countryMenu").addEventListener("change", e => {
  const picked = pickedCountries();
  if (!picked.length) e.target.checked = true;   // at least one country
  $("coApply").hidden = Object.keys(COUNTRIES).filter(co => pickedCountries().includes(co)).join() === SEL.join();
});
$("coApply").addEventListener("click", () => setCountryMenu(false));
$("countryMenu").addEventListener("click", e => {
  const b = e.target.closest("button[aria-disabled]"); if (!b) return;
  b.classList.remove("nudge"); void b.offsetWidth; b.classList.add("nudge");
});
$("countryMenu").addEventListener("keydown", e => {
  const items = [...$("countryMenu").querySelectorAll("input, button:not([hidden])")], i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  else if (e.key === "Tab") setCountryMenu(false);
});
document.addEventListener("pointerdown", e => { if (!$("countryMenu").hidden && !e.target.closest("#countryMenu, #countryBtn")) setCountryMenu(false); });

// The settings button opens the profile & settings modal (js/account.js), which holds the appearance controls.
applyAppearance();

const syncHdr = () => document.documentElement.style.setProperty("--hdr", $("hdr").getBoundingClientRect().height / UIZ() + "px");
new ResizeObserver(syncHdr).observe($("hdr")); syncHdr();

/* ---------------- finance: deposit + jobs (budget panel + table view, kept in sync) ---------------- */
const MAX_JOBS = 8;
const FIN = [$("budgetBody"), $("finInline")];
FIN.forEach(el => { el.insertAdjacentHTML("afterbegin", `<div class="fin"></div>`); });
$("budgetBody").insertAdjacentHTML("beforeend", `
  <div class="legend">
    <span class="lg"><i class="ring-k" style="--pct:100%"></i>Green: your work covers it</span>
    <span class="lg"><i class="ring-k" style="--pct:0%"></i>Red: you'd fall short</span>
    <span class="lg"><i class="ring-k" style="--pct:40%"></i>Split: share of courses covered</span>
    <span class="lg"><span class="cl-tally demo"><span class="t ok"><i></i>3</span><span class="t bad"><i></i>5</span></span>Groups: covered / short</span>
  </div>
  <p class="howto" id="finHowto"></p>`);
const FC = () => COUNTRIES[FIN_CO], FSYM = () => CUR[FC().cur].sym, fmoney = n => money(n, FC().cur);

const jobHTML = (j, i) => `
  <div class="job" data-i="${i}">
    <div class="job-top">
      <input class="job-name" data-f="name" value="${esc(j.name)}" placeholder="Job ${i + 1}" maxlength="40" aria-label="Job ${i + 1} name">
      <span class="job-out" data-out="gross${i}"></span>
      ${J().length > 1 ? `<button type="button" class="rm-job" data-rm="${i}" aria-label="Remove ${esc(j.name || "job " + (i + 1))}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>` : ""}
    </div>
    <div class="job-grid">
      <label><span>${FSYM()} / hour</span><input type="number" data-f="rate" min="0" max="1000" step="0.01" value="${j.rate}"></label>
      <label><span>Hours / week</span><input type="number" data-f="hrs" min="0" max="168" step="0.5" value="${j.hrs}"></label>
      <label><span>Weeks / year</span><input type="number" data-f="wks" min="0" max="52" step="1" value="${j.wks}"></label>
    </div>
  </div>`;
function renderFin() {
  FIN.forEach(el => {
    el.querySelector(".fin").innerHTML = `
      <div class="field dep"><label for="dep-${el.id}">${DEP_LABEL} (% of tuition)</label><input type="number" id="dep-${el.id}" data-k="dep" min="0" max="100" step="5" value="${S.dep}"></div>
      ${MULTI ? `<div class="seg small fin-co" role="group" aria-label="Jobs in">${SEL.map(co => `<button type="button" data-fco="${co}" aria-pressed="${co === FIN_CO}">${COUNTRIES[co].flag} Jobs in ${COUNTRIES[co].name}</button>`).join("")}</div>` : ""}
      <div class="jobs-h"><span>${MULTI ? `Jobs in ${FC().full}` : "Jobs"}</span><button type="button" class="btn-plain sm add-job"${J().length >= MAX_JOBS ? " disabled" : ""}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Add job</button></div>
      <div class="jobs">${J().map(jobHTML).join("")}</div>
      <p class="visa-warn" data-out="warn" hidden></p>
      <div class="fin-out"><span class="k">Take-home / yr</span><b class="th"></b><span class="fin-sum" data-out="sum"></span></div>`;
  });
  $("finHowto").textContent = `Deposit comes from savings; the rest of the fee + living from work${MULTI ? " in that course's country" : ""}. Take-home is ` +
    SEL.map(co => (MULTI ? COUNTRIES[co].name + " " : "") + COUNTRIES[co].taxText + ". " + COUNTRIES[co].visaText + ".").join(" ");
  syncFin();
}
// Refresh computed outputs, and copy values into the other copy of the form (never the field being typed in).
function syncFin(except) {
  FIN.forEach(el => el.querySelectorAll("input[data-k], input[data-f]").forEach(i => {
    if (i === except) return;
    const v = i.dataset.k ? S[i.dataset.k] : J()[+i.closest(".job").dataset.i]?.[i.dataset.f];
    if (v !== undefined && String(v) !== i.value) i.value = v;
  }));
  const th = fmoney(takeHome(avgRate())), wk = weekHrs();
  const sum = `${fmoney(grossAll())} gross · avg ${FSYM()}${avgRate().toFixed(2)}/hr · ${hours().toLocaleString("en-GB")} h/yr`;
  const warn = wk > FC().visaHrs ? `${wk} h/week together — over the 20 h term-time visa limit. Use weeks/year for vacation-only jobs.` : "";
  document.querySelectorAll(".fin-out .th").forEach(b => b.textContent = th);
  document.querySelectorAll('[data-out="sum"]').forEach(b => b.textContent = sum);
  document.querySelectorAll('[data-out="warn"]').forEach(b => { b.hidden = !warn; b.textContent = warn; });
  J().forEach((j, i) => document.querySelectorAll(`[data-out="gross${i}"]`).forEach(b => b.textContent = fmoney(jobGross(j)) + "/yr"));
  $("thMini").textContent = (MULTI ? FC().flag + " " : "") + th + "/yr";
  const item = (k, v, cls = "") => `<span class="fs-i ${cls}"><span class="fs-k">${k}</span><b>${v}</b></span>`;
  $("tvFinSum").innerHTML = (MULTI ? item("Jobs in", FC().flag + " " + esc(FC().name)) : "") +
    item("Deposit", `${+S.dep || 0}%`) + item(J().length === 1 ? "Job" : "Jobs", J().length) +
    item("Hours", `${wk} h/week`, wk > FC().visaHrs ? "warn" : "") + item("Take-home", `${th}<small>/yr</small>`, "take") +
    (wk > FC().visaHrs ? `<span class="fs-badge">Over ${FC().visaHrs} h visa limit</span>` : "");
}
FIN.forEach(el => {
  el.addEventListener("input", e => {
    const i = e.target;
    if (i.dataset.k) S[i.dataset.k] = i.value === "" ? 0 : +i.value;
    else if (i.dataset.f) { const j = J()[+i.closest(".job").dataset.i]; j[i.dataset.f] = i.dataset.f === "name" ? i.value : (i.value === "" ? 0 : +i.value); }
    else return;
    save(); syncFin(i); if (i.dataset.f !== "name") update();
  });
  el.addEventListener("click", e => {
    const add = e.target.closest(".add-job"), rm = e.target.closest(".rm-job"), fco = e.target.closest("[data-fco]");
    if (fco) { FIN_CO = S.finCo = fco.dataset.fco; save(); renderFin(); el.querySelector(`[data-fco="${FIN_CO}"]`)?.focus(); return; }
    const jobs = J();
    if (add && jobs.length < MAX_JOBS) {
      const last = jobs[jobs.length - 1];
      jobs.push(newJob({ rate: last ? last.rate : FC().minWage, hrs: 10, wks: last ? last.wks : 52 }, FC()));
      save(); renderFin(); update();
      el.querySelector(`.job[data-i="${jobs.length - 1}"] .job-name`)?.focus();
    } else if (rm) {
      jobs.splice(+rm.dataset.rm, 1);
      save(); renderFin(); update();
      el.querySelector(".add-job")?.focus();
    }
  });
});
// List view: the Budget & work fold under the table remembers whether you left it open.
$("tvFin").open = !!S.tvFinOpen;
$("tvFin").addEventListener("toggle", () => { S.tvFinOpen = $("tvFin").open; save(); });
$("budgetToggle").addEventListener("click", () => { S.budgetOpen = !S.budgetOpen; if (MOBILE && S.budgetOpen) { S.filtersOpen = false; applyFilters(); } save(); applyBudget(); });
const applyBudget = () => { $("budgetToggle").setAttribute("aria-expanded", String(S.budgetOpen)); $("budgetBody").hidden = !S.budgetOpen; };
applyBudget(); renderFin();

/* ---------------- view toggle ---------------- */
let tableOpen = false;
function setView(open) {
  tableOpen = open;
  $("tableview").hidden = !open;
  $("viewToggle").setAttribute("aria-pressed", String(open));
  $("viewToggle").querySelector(".vt-label").textContent = open ? "Back to map" : "View list";
  if (open) renderTable();
}
$("viewToggle").addEventListener("click", () => setView(!tableOpen));

/* ---------------- university search (toolbar): suggest → fly to it on the map → open its card ---------------- */
const normName = s => s.toLowerCase().replace(/univ\./g, "university").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const SKIP = new Set(["of", "the", "and", "for", "at"]);
const UNI_INDEX = Object.keys(UNIS).map(u => {
  const n = normName(u), words = n.split(" ");
  return { u, n, words, initials: words.filter(w => !SKIP.has(w)).map(w => w[0]).join(""), city: UNIS[u].c, cn: normName(UNIS[u].c), courses: ROWS.filter(r => r.u === u).length };
});
function suggestUnis(q) {
  const t = normName(q); if (!t) return [];
  const parts = t.split(" ");
  return UNI_INDEX.map(x => {
    let sc;
    if (x.n.startsWith(t)) sc = 100;                                          // "university of gla…"
    else if (t.length >= 2 && x.initials.startsWith(t.replace(/ /g, ""))) sc = 90; // "kcl", "qmul", "uwe"
    else if (x.words.some(w => w.startsWith(t))) sc = 80;                     // "glasgow", "imperial"
    else if (parts.every(p => x.n.includes(p))) sc = 60;                      // words in any order
    else if (x.cn.startsWith(t)) sc = 40;                                     // city: "london"
    else return null;
    return { ...x, sc: sc - x.n.length / 1000 };
  }).filter(Boolean).sort((a, b) => b.sc - a.sc || a.u.localeCompare(b.u)).slice(0, 8);
}
// Highlight what was typed inside the university name.
function markMatch(name, q) {
  const t = q.trim(); if (!t) return esc(name);
  const i = name.toLowerCase().indexOf(t.toLowerCase());
  return i < 0 ? esc(name) : esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + t.length)) + "</mark>" + esc(name.slice(i + t.length));
}
let usItems = [], usActive = -1;
const usInput = $("uniSearch"), usList = $("uniSuggest");
function usRender() {
  const q = usInput.value;
  usItems = suggestUnis(q); usActive = usItems.length ? 0 : -1;
  $("uniSearchClear").hidden = !q;
  if (!q.trim()) { usClose(); return; }
  usList.innerHTML = usItems.length ? usItems.map((x, i) => {
    const shown = LIST.filter(r => r.u === x.u).length;
    return `<li role="option" id="us-opt-${i}" aria-selected="${i === usActive}" data-u="${esc(x.u)}">
      <span class="us-name">${markMatch(x.u, q)}</span>
      <span class="us-meta">${esc(x.city)} · ${x.courses} course${x.courses === 1 ? "" : "s"}${shown < x.courses ? ` · ${shown ? shown + " match your filters" : "hidden by your filters"}` : ""}</span></li>`;
  }).join("") : `<li class="us-empty" role="presentation">No university matches “${esc(q.trim())}”</li>`;
  usList.hidden = false; usInput.setAttribute("aria-expanded", "true");
  usInput.setAttribute("aria-activedescendant", usActive >= 0 ? "us-opt-0" : "");
}
function usMove(d) {
  if (!usItems.length) return;
  usActive = (usActive + d + usItems.length) % usItems.length;
  usList.querySelectorAll("[role=option]").forEach((li, i) => li.setAttribute("aria-selected", String(i === usActive)));
  usInput.setAttribute("aria-activedescendant", "us-opt-" + usActive);
  usList.querySelector(`#us-opt-${usActive}`)?.scrollIntoView({ block: "nearest" });
}
function usClose() { usList.hidden = true; usInput.setAttribute("aria-expanded", "false"); usInput.removeAttribute("aria-activedescendant"); }
function usChoose(u) {
  usInput.value = u; $("uniSearchClear").hidden = false; usClose(); usInput.blur();
  if (tableOpen) setView(false);
  openCard(u, true); // pans/zooms the map to the university and opens its information card
}
usInput.addEventListener("input", usRender);
usInput.addEventListener("focus", () => { if (usInput.value.trim()) usRender(); });
usInput.addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); usList.hidden ? usRender() : usMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); usMove(-1); }
  else if (e.key === "Enter") { if (usActive >= 0 && !usList.hidden) { e.preventDefault(); usChoose(usItems[usActive].u); } }
  else if (e.key === "Escape" && !usList.hidden) { e.stopPropagation(); usClose(); }
});
usList.addEventListener("pointerdown", e => { const li = e.target.closest("[data-u]"); if (li) { e.preventDefault(); usChoose(li.dataset.u); } });
usInput.addEventListener("blur", () => setTimeout(usClose, 120));
$("uniSearchClear").addEventListener("click", () => { usInput.value = ""; $("uniSearchClear").hidden = true; usClose(); usInput.focus(); });
// "/" jumps to the search box from anywhere on the page (unless you're typing somewhere).
document.addEventListener("keydown", e => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea, select, [contenteditable]") || $("liveReport").open) return;
  e.preventDefault(); usInput.focus(); usInput.select();
});
$("tableClose").addEventListener("click", () => { setView(false); $("viewToggle").focus(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || $("liveReport").open) return;
  if (!$("countryMenu").hidden) { setCountryMenu(false); $("countryBtn").focus(); }
  else if (!$("lvMenu").hidden) { setLvMenu(false); $("lvBtn").focus(); }
  else if (!$("subjMenu").hidden) { setSubjMenu(false); $("subjBtn").focus(); }
  else if (document.querySelector("dialog[open]") || $("acctMenu")?.hidden === false) return; else if (tableOpen) setView(false); else closeCard();
});

/* ---------------- table ---------------- */
const hrow = $("hrow"), frow = $("frow");
COLS.forEach(c => {
  const th = document.createElement("th"); th.dataset.k = c.k; th.scope = "col";
  if (c.type === "none") { th.innerHTML = `<button type="button" tabindex="-1"><span>${c.h}</span></button>`; }
  else if (c.type === "star") {
    th.innerHTML = `<button type="button" title="Sort shortlisted first" aria-label="Shortlist"><span class="lbl">${c.h}</span><span class="arr">↕</span></button>`;
    th.querySelector("button").addEventListener("click", () => { if (S.sortK === c.k) S.dir = -S.dir; else { S.sortK = c.k; S.dir = 1; } save(); renderTable(); });
  }
  else {
    th.innerHTML = `<button type="button"><span class="lbl">${c.h}</span><span class="arr">↕</span></button>`;
    th.querySelector("button").addEventListener("click", () => {
      if (S.sortK === c.k) S.dir = -S.dir; else { S.sortK = c.k; S.dir = 1; }
      save(); renderTable();
    });
  }
  hrow.appendChild(th);
  const fth = document.createElement("th");
  if (c.type !== "none" && c.type !== "star") {
    const inp = document.createElement("input"); inp.type = "search";
    inp.placeholder = c.type === "num" ? (["uk", "qs"].includes(c.k) ? "e.g. <200" : ["hr", "rt"].includes(c.k) ? "e.g. <20" : c.k === "df" ? "e.g. <5000" : "e.g. <30000") : "filter…";
    inp.setAttribute("aria-label", "Filter " + c.h.replace(/<br>/g, " "));
    inp.addEventListener("input", () => { S.colf[c.k] = inp.value.trim(); update(); });
    fth.appendChild(inp);
  }
  frow.appendChild(fth);
});

let LIST = [];
function sorted(list) {
  const col = COLS.find(c => c.k === S.sortK) || COLS.find(c => c.k === "n");
  // Money (and hourly pay) from different countries is compared in one currency.
  const val = r => (col.money || col.local) && MULTI ? toBase(col.get(r), r) : col.get(r);
  return list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    const v = col.type === "num" ? x - y : String(x).localeCompare(String(y));
    return (v || (toBase(a.n, a) - toBase(b.n, b))) * S.dir;
  });
}
function renderTable() {
  if (!tableOpen) return;
  const city = $("city").value;
  document.querySelectorAll("thead th[data-k]").forEach(th => {
    const c = COLS.find(x => x.k === th.dataset.k); if (c.type === "none") return;
    if (c.dyn) th.querySelector(".lbl").innerHTML = c.dyn();
    const on = c.k === S.sortK;
    th.setAttribute("aria-sort", on ? (S.dir === 1 ? "ascending" : "descending") : "none");
    th.querySelector(".arr").textContent = on ? (S.dir === 1 ? "▲" : "▼") : "↕";
  });
  const list = sorted(LIST);
  $("tbody").innerHTML = list.map(r => {
    const d = deficit(r), h = needHr(r);
    return `<tr class="${isShort(r) ? "starred" : ""}">
    <td class="star-td">${starBtn(r)}</td>
    <td>${r.lv}</td>
    <td>${r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g]}</td>
    <td class="uni"><b>${esc(r.u)}</b><span class="sub">${MULTI ? coOf(r).flag + " " : ""}${esc(r.c)}${city && r.c !== city ? ` · ${Math.round(uniKm(r.u, city))} km from ${esc(city)}` : ""}</span></td>
    ${SEL.includes("uk") ? `<td class="num">${esc(ukRankText(r))}</td>` : ""}
    <td class="num">${esc(rankText(r.qs, r))}</td>
    <td>${esc(r.p)}</td>
    <td>${esc(r.i)}</td>
    <td class="num">~${rm(r, r.f)}${feeNote(r)}</td>
    <td class="num">~${rm(r, r.l)}</td>
    <td class="num">~${rm(r, r.t)}</td>
    <td class="sure ${r.s ? "has" : ""}">${r.s ? `<b>${rm(r, r.s)}</b><span class="sub" style="color:inherit">${esc(r.sl)}</span>` : "None confirmed"}</td>
    <td class="num net">~${rm(r, r.n)}</td>
    <td class="num">~${rm(r, Math.round(dep(r) / 50) * 50)}</td>
    <td class="num">~${rm(r, Math.round(remFee(r) / 50) * 50)}</td>
    <td class="num hr ${h > 20 ? "hi" : ""}"><b>${rsym(r)}${isFinite(h) ? h.toFixed(2) : "—"}</b><span class="sub">needs ~${rm(r, r100(need(r)))}/yr</span></td>
    <td class="rate"><input type="number" min="0" max="200" step="0.01" data-id="${r.id}" class="${r.id in rowRate ? "ovr" : ""}" value="${rateOf(r).toFixed(2)}" aria-label="Hourly rate for ${esc(r.u)}"></td>
    <td class="num def ${d > 0 ? "short" : "ok"}" data-def="${r.id}">${defText(d, r)}</td>
    <td class="aw">${awardsCell(r)}</td>
    <td>${esc(otherSch(r))}</td>
    <td class="pl ${r.pl.startsWith("Yes") ? "yes" : ""}">${esc(r.pl)}</td>
    <td class="fl ${r.fl ? "has" : ""}">${esc(r.fl || "")}</td>
    <td><button type="button" class="maplink" data-u="${esc(r.u)}">View on map</button></td>
  </tr>`; }).join("");
  $("empty").hidden = list.length > 0;
  const col = COLS.find(c => c.k === S.sortK);
  $("count").textContent = `${list.length} of ${ROWS.length} courses · ${new Set(list.map(r => r.u)).size} universities · sorted by ${(col.dyn ? col.dyn() : col.h).replace(/<br>/g, " ")} (${S.dir === 1 ? "low → high" : "high → low"})`;
  document.querySelector("#tbl").style.setProperty("--h1", hrow.getBoundingClientRect().height / UIZ() + "px");
}
$("tbody").addEventListener("input", e => {
  const inp = e.target.closest("td.rate input"); if (!inp) return;
  const id = +inp.dataset.id, r = ROWS[id];
  if (inp.value === "") delete rowRate[id]; else rowRate[id] = Math.max(0, +inp.value);
  inp.classList.toggle("ovr", id in rowRate);
  const td = document.querySelector(`td[data-def="${id}"]`), d = deficit(r);
  td.className = "num def " + (d > 0 ? "short" : "ok"); td.textContent = defText(d, r);
  refreshMarkers(); if (openUni === r.u) renderCard(r.u, false);
});
$("tbody").addEventListener("click", e => {
  const b = e.target.closest(".maplink"); if (!b) return;
  setView(false); openCard(b.dataset.u, true);
});
$("clearrates").addEventListener("click", () => { for (const k in rowRate) delete rowRate[k]; update(); });

/* ---------------- map groups ---------------- */
const uniCo = u => COUNTRIES[UNIS[u].co || "uk"], uniCur = u => uniCo(u).cur;
function groups() {
  const by = {};
  LIST.forEach(r => (by[r.u] ||= []).push(r));
  return Object.entries(by).map(([u, rs]) => {
    const ds = rs.map(deficit), ok = ds.filter(d => d <= 0).length, best = Math.min(...ds);
    // A university counts as covered when your jobs cover fee + living for at least one matching course.
    return { u, lat: UNIS[u].lat, lng: UNIS[u].lng, count: rs.length, okCount: ok, best, ok: ok > 0 };
  });
}
// Ring = share of this university's matching courses your work covers: all green, all red, or split.
function pinHTML(g) {
  const pct = (g.okCount / g.count * 100).toFixed(1);
  const tip = `${g.u} — ${g.count} course${g.count === 1 ? "" : "s"}: ${g.okCount} covered by your work, ${g.count - g.okCount} short` +
    (g.best > 0 ? ` (closest: short ${money(r100(g.best), uniCur(g.u))}/yr)` : ` (best: ${money(r100(-g.best), uniCur(g.u))}/yr spare)`);
  return `<div class="pin ${g.ok ? "ok" : "bad"}${g.u === openUni ? " sel" : ""}" title="${esc(tip)}" style="--pct:${pct}%">` +
    `<span class="ring"><span class="dot">${g.count}</span></span><span class="nm">${esc(g.u)}</span></div>`;
}
// Cluster bubble: number of universities, plus a tally of covered (green) vs short (red) ones.
function clusterHTML(oks) {
  const ok = oks.filter(Boolean).length, bad = oks.length - ok;
  return `<div class="cl" title="${oks.length} universities: ${ok} covered by your work, ${bad} short"><span class="cl-n">${oks.length}</span>` +
    `<span class="cl-tally">${ok ? `<span class="t ok"><i></i>${ok}</span>` : ""}${bad ? `<span class="t bad"><i></i>${bad}</span>` : ""}</span></div>`;
}

/* ---------------- map: Google implementation ---------------- */
const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Failed: " + src)); document.head.appendChild(s); });
const loadCss = href => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); };
// Map view: the ticked country, or north-west Europe when the UK and Germany are both shown.
const VIEW = MULTI ? { center: { lat: 53, lng: 3.5 }, zoom: MOBILE ? 4 : 5 } : { center: COUNTRY.center, zoom: COUNTRY.zoom };
const UK = VIEW.center;
// Keep fitted areas clear of the floating toolbar and side cards.
const pad = () => ({ top: $("hdr").getBoundingClientRect().bottom + 16, left: MOBILE ? 16 : $("side").getBoundingClientRect().right + 16 });

const GoogleMap = {
  kind: "google",
  async init(el) {
    // Official Google Maps dynamic library loader
    ((g) => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key: CFG.GOOGLE_MAPS_API_KEY, v: "weekly", region: COUNTRY.region });
    const [{ Map, Circle }, { AdvancedMarkerElement }] = await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]);
    await loadScript("https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js");
    this.AME = AdvancedMarkerElement; this.Circle = Circle; this.GMap = Map; this.el = el;
    this.markers = [];
    this.build({ center: UK, zoom: VIEW.zoom });
  },
  // Google only accepts a colour scheme when a map is created, so changing theme means building a new map.
  scheme: () => S.theme === "dark" ? "DARK" : S.theme === "light" ? "LIGHT" : "FOLLOW_SYSTEM",
  build(view) {
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;inset:0";
    this.el.appendChild(holder);
    this.builtScheme = this.scheme();
    this.map = new this.GMap(holder, { ...view, mapId: CFG.GOOGLE_MAP_ID || "DEMO_MAP_ID", colorScheme: this.builtScheme,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy", clickableIcons: false });
    const AME = this.AME;
    this.cluster = new markerClusterer.MarkerClusterer({ map: this.map, markers: [], renderer: {
      render: ({ count, position, markers }) => { const d = document.createElement("div"); d.innerHTML = clusterHTML(markers.map(m => m.ok)); return new AME({ position, content: d.firstElementChild, zIndex: 1000 + count, title: count + " universities" }); } } });
    this.map.addListener("zoom_changed", () => document.body.classList.toggle("show-names", this.map.getZoom() >= 11));
    return holder;
  },
  // Rebuild in the current theme, keeping the view, pins and radius circle; swap once the new tiles are drawn.
  setScheme() {
    if (!this.map || this.scheme() === this.builtScheme) return;
    const old = { holder: this.map.getDiv(), cluster: this.cluster, circle: this.circle };
    const holder = this.build({ center: this.map.getCenter(), zoom: this.map.getZoom() });
    holder.style.opacity = "0"; holder.style.transition = "opacity .35s";
    if (this.circleArgs) { this.circle = null; this.drawCircle(...this.circleArgs); }
    this.setMarkers(groups());
    old.cluster.clearMarkers(); old.cluster.setMap(null); old.circle?.setMap(null);
    const swap = () => { holder.style.opacity = "1"; setTimeout(() => old.holder.remove(), 400); };
    google.maps.event.addListenerOnce(this.map, "tilesloaded", swap);
    setTimeout(swap, 2500); // in case tiles were cached and the event never fires
  },
  setMarkers(gs) {
    this.cluster.clearMarkers();
    this.markers = gs.map(g => {
      const div = document.createElement("div"); div.innerHTML = pinHTML(g);
      const m = new this.AME({ position: { lat: g.lat, lng: g.lng }, content: div.firstElementChild, title: g.u, gmpClickable: true, zIndex: g.u === openUni ? 999 : undefined });
      m.ok = g.ok; // read by the cluster renderer's tally
      m.addEventListener("gmp-click", () => openCard(g.u, false));
      return m;
    });
    this.cluster.addMarkers(this.markers);
  },
  focus(lat, lng) { this.map.panTo({ lat, lng }); if (this.map.getZoom() < 13) this.map.setZoom(13); },
  drawCircle(center, km) {
    this.circle = new this.Circle({ map: this.map, center: { lat: center[0], lng: center[1] }, radius: km * 1000, strokeColor: "#007aff", strokeOpacity: .85, strokeWeight: 2, fillColor: "#007aff", fillOpacity: .08, clickable: false });
  },
  setRadius(center, km) {
    if (this.circle) { this.circle.setMap(null); this.circle = null; }
    this.circleArgs = center && km > 0 ? [center, km] : null;
    if (!center) return;
    if (km > 0) {
      this.drawCircle(center, km);
      this.map.fitBounds(this.circle.getBounds(), { top: pad().top, left: pad().left, right: 24, bottom: 24 });
    } else { this.map.panTo({ lat: center[0], lng: center[1] }); this.map.setZoom(11); }
  },
  reset() { this.map.panTo(UK); this.map.setZoom(VIEW.zoom); },
  async place(u) {
    const { Place } = await google.maps.importLibrary("places");
    const { places } = await Place.searchByText({ textQuery: UNIS[u].q, fields: ["id"], maxResultCount: 1, locationBias: { lat: UNIS[u].lat, lng: UNIS[u].lng } });
    if (!places || !places.length) return null;
    const p = places[0];
    await p.fetchFields({ fields: ["displayName", "formattedAddress", "rating", "userRatingCount", "photos", "reviews", "googleMapsURI", "websiteURI"] });
    return p;
  },
};

/* ---------------- map: OpenStreetMap fallback (no key) ---------------- */
const LeafletMap = {
  kind: "leaflet",
  async init(el) {
    loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    loadCss("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css");
    loadCss("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css");
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    await loadScript("https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js");
    el.innerHTML = "";
    this.map = L.map(el, { zoomControl: false }).setView([UK.lat, UK.lng], VIEW.zoom);
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(this.map);
    this.cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50,
      iconCreateFunction: c => L.divIcon({ className: "cl-wrap", html: clusterHTML(c.getAllChildMarkers().map(m => m.options.ok)), iconSize: null, iconAnchor: [21, 21] }) }).addTo(this.map);
    this.map.on("zoomend", () => document.body.classList.toggle("show-names", this.map.getZoom() >= 11));
  },
  setMarkers(gs) {
    this.cluster.clearLayers();
    gs.forEach(g => {
      const m = L.marker([g.lat, g.lng], { ok: g.ok, icon: L.divIcon({ className: "pin-wrap", html: pinHTML(g), iconSize: null, iconAnchor: [17, 17] }), zIndexOffset: g.u === openUni ? 1000 : 0 });
      m.on("click", () => openCard(g.u, false));
      this.cluster.addLayer(m);
    });
  },
  focus(lat, lng) { this.map.setView([lat, lng], Math.max(this.map.getZoom(), 13)); },
  setRadius(center, km) {
    if (this.circle) { this.circle.remove(); this.circle = null; }
    if (!center) return;
    if (km > 0) { this.circle = L.circle(center, { radius: km * 1000, color: "#007aff", weight: 2, fillOpacity: .08, interactive: false }).addTo(this.map); this.map.fitBounds(this.circle.getBounds(), { paddingTopLeft: [pad().left, pad().top], paddingBottomRight: [24, 24] }); }
    else this.map.setView(center, 11);
  },
  reset() { this.map.setView([UK.lat, UK.lng], VIEW.zoom); },
  async place() { return null; },
};

let MAP = null;
function status(msg) { const el = $("mapStatus"); el.hidden = !msg; el.innerHTML = msg || ""; }
async function startMap() {
  const el = $("map");
  if (CFG.GOOGLE_MAPS_API_KEY) {
    window.gm_authFailure = async () => { // invalid / restricted key → fall back so the site still works
      status("Google Maps key rejected — showing OpenStreetMap.");
      MAP = null; await LeafletMap.init(el); MAP = LeafletMap; refreshMarkers(); applyCityOnMap();   // only use it once it's ready
    };
    try { await GoogleMap.init(el); MAP = GoogleMap; onThemeChange = () => { if (MAP === GoogleMap) GoogleMap.setScheme(); }; }
    catch (e) { console.error(e); status("Google Maps failed to load — showing OpenStreetMap."); MAP = null; await LeafletMap.init(el); MAP = LeafletMap; }
  } else {
    await LeafletMap.init(el); MAP = LeafletMap;
    status("No Google Maps key — showing OpenStreetMap.");
    setTimeout(() => status(""), 9000);
  }
  refreshMarkers(); applyCityOnMap();
}
function refreshMarkers() { if (MAP) MAP.setMarkers(groups()); }
function applyCityOnMap() {
  if (!MAP) return;
  const city = $("city").value;
  if (city) MAP.setRadius(CITY[city], +$("radius").value || 0); else { MAP.setRadius(null); MAP.reset(); }
}

/* ---------------- info card ---------------- */
let openUni = null, placeReq = 0;
const placeCache = {};
function closeCard() { if (!openUni) return; openUni = null; $("card").hidden = true; refreshMarkers(); }
$("cardClose").addEventListener("click", closeCard);
// Intake picked on a course card: remembered per course and passed to the budget planner.
$("cardCourses").addEventListener("change", e => {
  const sel = e.target.closest("select[data-intake]"); if (!sel) return;
  const r = ROWS[+sel.dataset.intake];
  S.intakes = { ...S.intakes, [intakeKey(r)]: sel.value }; save();
  sel.closest(".plan-row").querySelector("a[data-plan]").href = plannerLink(r, sel.value).replace(/&amp;/g, "&");
});

function openCard(u, focus) {
  openUni = u; $("card").hidden = false;
  renderCard(u, true);
  refreshMarkers();
  if (focus && MAP) MAP.focus(UNIS[u].lat, UNIS[u].lng);
}
function courseHTML(r) {
  const d = deficit(r), h = needHr(r);
  const row = (k, v, cls = "") => `<div class="lbl">${k}</div><div class="${cls}">${v}</div>`;
  return `<article class="course">
    <div class="course-h">
      <div class="tags"><span class="tag ${r.lv === "PhD" ? "phd" : ""}">${r.lv}</span><span class="tag">${r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g]}</span>${isPrivate(r.u) ? `<span class="tag priv" title="Privately run university">Private</span>` : ""}${r.s ? `<span class="tag sure">Sure scholarship</span>` : ""}${r.pl.startsWith("Yes") ? `<span class="tag pl">Placement</span>` : ""}${r.fl ? `<span class="tag warn">${esc(r.fl)}</span>` : ""}</div>
      <div class="course-t"><b>${esc(r.p)}</b>${starBtn(r, "lg")}</div>
      ${isShort(r) ? `<div class="course-st"><span>Application</span>${statusSelect(courseKey(r), S.short[courseKey(r)].st)}</div>` : ""}
    </div>
    <div class="kv">
      ${r.en ? row("Entry", esc(r.en) + (entryBadge(r) ? `<span class="sub">${entryBadge(r)}</span>` : "")) : ""}
      ${row("Intakes", esc(r.i) + (r.iLive ? `<span class="sub">updated · was ${esc(r.i0)}</span>` : ""))}
      ${r.closed ? row(r.closed.status === "gone" ? "Course page" : "Applications", `<span class="sub warn">${esc(r.closed.note || (r.closed.status === "gone" ? "The page has been removed" : "Not taking applications"))}</span>`, "hl") : ""}
      ${row("Tuition / yr (intl)", `~${rm(r, r.f)}${feeNote(r)}`)}
      ${row("Living / yr", "~" + rm(r, r.l))}
      ${row("Total yr 1", "~" + rm(r, r.t))}
      ${row("Sure scholarship", r.s ? `${rm(r, r.s)}<span class="sub">${esc(r.sl)}</span>` : "None confirmed")}
      ${row("Total with sure scholarship", "~" + rm(r, r.n))}
      ${row(`${coOf(r).depLabel} (${+S.dep || 0}%)`, "~" + rm(r, Math.round(dep(r) / 50) * 50))}
      ${row("Remaining fee", "~" + rm(r, Math.round(remFee(r) / 50) * 50))}
      ${row("Pay needed / hr", `${rsym(r)}${isFinite(h) ? h.toFixed(2) : "—"}<span class="sub">to earn ~${rm(r, r100(need(r)))}/yr</span>`, h > 20 ? "hl" : "")}
      ${row(J(r.co).length > 1 ? "Your avg rate" : "Your rate", rsym(r) + rateOf(r).toFixed(2) + "/hr" + (r.id in rowRate ? "" : `<span class="sub">${J(r.co).length} job${J(r.co).length === 1 ? "" : "s"}${MULTI ? " in " + coOf(r).name : ""} · ${hours(r.co || "uk").toLocaleString("en-GB")} h/yr</span>`))}
      ${row("Deficit / yr", defText(d, r), d > 0 ? "hl" : "ok")}
      ${row("Placement", esc(r.pl))}
      <div class="full"><b>Other scholarships:</b> ${esc(otherSch(r))}</div>
      ${r.dur ? row("Duration", `${r.dur} semesters`) : ""}
      ${r.dl ? row("Apply by (winter)", esc(r.dl)) : ""}
      ${r.cw ? `<div class="full"><a href="${esc(r.cw)}" target="_blank" rel="noopener">University course page ↗</a> · <a href="${esc(r.url)}" target="_blank" rel="noopener">DAAD listing ↗</a>${courseCheck(r)}</div>`
        : r.url ? `<div class="full"><a href="${esc(r.url)}" target="_blank" rel="noopener">Course page ↗</a>${courseCheck(r)}</div>` : ""}
      ${(r.co || "uk") === "uk" ? planRow(r) : ""}
      <div class="full card-acts"><button type="button" class="act-btn" data-funds="${esc(courseKey(r))}" title="Proof of funds for the visa">${IC.funds}<span>Proof of funds</span></button>
        <button type="button" class="act-btn quiet" data-report="${esc(courseKey(r))}" title="Report wrong information about this course">${IC.flag}<span>Report</span></button></div>
      <div class="full">${noteHTML(courseKey(r))}</div>
    </div>
  </article>`;
}
function courseCheck(r) {
  const x = LIVE.res[r.url];
  if (!x) return ` <span class="muted">· not checked yet</span>`;
  const when = new Date(LIVE.checked).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return x.ok ? ` <span class="muted">· checked ${when}</span>` : ` <span class="muted">· couldn't read fee (${esc(x.err)})</span>`;
}
// Fee payment policy for international postgraduate students, from the university's own pages.
// Budget planner link: the planner fills itself in from this course (live fee, sure scholarship incl. grade-based awards,
// typical living cost, any pay rate set for this row) plus the university's payment schedule and your work from this page.
function plannerLink(r, intake) {
  const q = new URLSearchParams({ u: r.u, p: r.p, f: Math.round(r.f), s: Math.round(r.s || 0), l: Math.round(r.l || 0) });
  if (intake) q.set("in", intake);
  if (r.s && r.sl) q.set("sl", r.sl);
  if (r.id in rowRate) q.set("rate", rowRate[r.id]);
  return "planner.html?" + esc(q.toString());
}
// The course's intakes ("Sept, Jan") as start months, from the one that began up to 3 months ago; values "YYYY-MM".
// The planner uses the same rule and dates the installments from the intake picked here.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function courseIntakes(r) {
  const ms = [...new Set((String(r.i || "").toLowerCase().match(/[a-z]{3}/g) || []).map(m => MON[m]).filter(m => m != null))];
  if (!ms.length) ms.push(8, 0);
  const now = new Date(), m0 = now.getFullYear() * 12 + now.getMonth() - 3, out = [];
  for (let mi = m0; mi < m0 + 16 && out.length < 4; mi++) if (ms.includes(mi % 12))
    out.push({ v: `${Math.floor(mi / 12)}-${String(mi % 12 + 1).padStart(2, "0")}`, name: new Date(Math.floor(mi / 12), mi % 12, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) });
  return out;
}
const intakeKey = r => r.u + "|" + r.p;
function planRow(r) {
  const opts = courseIntakes(r), pick = (opts.find(o => o.v === S.intakes?.[intakeKey(r)]) || opts[0])?.v;
  return `<div class="full plan-row"><label class="intake-pick"><span class="plan-q">Enrolled here? Intake</span><select data-intake="${r.id}" aria-label="Your intake for ${esc(r.p)}">${opts.map(o => `<option value="${o.v}"${o.v === pick ? " selected" : ""}>${o.name}</option>`).join("")}</select></label>
    <a href="${plannerLink(r, pick)}" data-plan="${r.id}" title="Opens the budget planner with this course's fee, scholarship, the installment dates for your intake, living costs and your work filled in">Plan my budget →</a></div>`;
}
// Germany: fees are paid per semester; the visa needs proof of funds (a blocked account).
function payHTML_de(u) {
  const rs = ROWS.filter(r => r.u === u), any = rs[0] || {};
  const sem = Math.round((any.f || 0) / 2);
  return `<details class="pp" open><summary><span class="pp-ico" aria-hidden="true">€</span><span>Paying your fees</span><span class="pp-chip">Per semester</span></summary><div class="pp-body">
    <div class="pp-row"><span class="k">When</span><span class="v">Each semester, before enrolling (Oct / Apr)<small>~${money(sem, "EUR")} a semester incl. semester fee</small></span></div>
    <div class="pp-row"><span class="k">Blocked account<small>visa proof of funds</small></span><span class="v">€11,904 (€992/month, 2026)<small>Paid before the visa, released monthly</small></span></div>
    <div class="pp-row"><span class="k">Deposit</span><span class="v">${UNIS[u]?.priv ? "Private university — may ask for one<small>Check its own payment terms</small>" : "Public universities don't ask for one"}</span></div>
    <p class="pp-src">Confirm exact fees on the course page</p>
  </div></details>`;
}
function payHTML(u) {
  if (uniCo(u).code === "de") return payHTML_de(u);
  const P = UNIS[u].pay, when = window.UNIDATA.payChecked ? new Date(window.UNIDATA.payChecked).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  // Short badge: "Deposit £2,000", "Deposit from £1,000", "Deposit 50%" — the full wording is in the rows below.
  const dep = P && P.dep, money = dep && dep.match(/£[\d,]+/), pct = dep && dep.match(/\d+%/);
  const chip = !dep ? "" : /^£[\d,]+$/.test(dep) ? dep : money && (pct ? dep.indexOf(money[0]) < dep.indexOf(pct[0]) : true) ? `from ${money[0]}` : pct ? pct[0] : "";
  const head = `<summary><span class="pp-ico" aria-hidden="true">£</span><span>Paying your fees</span>${chip ? `<span class="pp-chip">Deposit ${esc(chip)}</span>` : ""}</summary>`;
  if (!P) return `<details class="pp" open>${head}<p class="pp-none">Not confirmed yet — check their <a href="${esc(UNIS[u].web)}" target="_blank" rel="noopener">website ↗</a> or your offer letter.</p></details>`;
  const row = (k, v, cls = "") => v ? `<div class="pp-row ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>` : "";
  const sched = P.sched ? Object.entries(P.sched).map(([k, v]) => row(esc(k), esc(v), "sched")).join("") : "";
  return `<details class="pp" open>${head}<div class="pp-body">
    ${row("Minimum deposit<small>before your CAS</small>", P.dep ? esc(P.dep) + (P.depNote ? `<small>${esc(P.depNote)}</small>` : "") : `<span class="muted">Not stated on the pages read</span>`)}
    ${row("From Nepal", P.nepal ? esc(P.nepal) : "", "nepal")}
    ${row("Installments", P.plan ? esc(P.plan) + (P.n ? `<small>${esc(P.n)} payment${P.n === "1" ? "" : "s"} in total</small>` : "") : `<span class="muted">Not stated on the pages read</span>`)}
    ${sched || (P.plan ? row("Dates", `<span class="muted">Not published — given on your invoice</span>`) : "")}
    <p class="pp-src"><a href="${esc(P.src)}" target="_blank" rel="noopener">University's payment page ↗</a>${when ? ` · checked ${when}` : ""}</p>
  </div></details>`;
}
// Scholarships for this university, matched to your grade (if given) and to its courses.
function awardsHTML(u) {
  if (uniCo(u).code === "de") {
    const g = germanGrade(S.grade);
    return `<details class="pp" open><summary><span class="pp-ico aw-ico" aria-hidden="true">★</span><span>Scholarships for you</span>${g ? `<span class="pp-chip">Your grade ≈ ${g.toFixed(1)}</span>` : ""}</summary><div class="pp-body">
      <div class="pp-row"><span class="k">DAAD scholarships</span><span class="v">Competitive, e.g. EPOS for professionals from Nepal<small><a href="https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/" target="_blank" rel="noopener">DAAD scholarship database ↗</a></small></span></div>
      <div class="pp-row"><span class="k">Deutschlandstipendium</span><span class="v">€300/month for a year, merit-based — apply after enrolling</span></div>
      <p class="pp-none">Automatic fee discounts are rare in Germany.</p>
    </div></details>`;
  }
  const rows = ROWS.filter(r => r.u === u && r.lv === "Masters"), list = UNIS[u].sch || [], cls = myClass();
  const when = window.UNIDATA.schChecked ? new Date(window.UNIDATA.schChecked).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const gradeChip = cls ? `<span class="pp-chip">Your grade ≈ ${cls === "3rd" ? "below 2:2" : cls}</span>` : "";
  const head = `<summary><span class="pp-ico aw-ico" aria-hidden="true">★</span><span>Scholarships for you</span>${gradeChip}</summary>`;
  if (!list.length) return `<details class="pp" open>${head}<p class="pp-none">No Nepal or automatic scholarships found${rows.some(r => r.s0) ? " (listed ones show on the course)" : ""}.</p></details>`;
  const status = a => {
    if (a.courses && !rows.some(r => a.courses.includes(r.p))) return ["muted", `Only for ${a.courses.join(", ")}`];
    if (a.kind === "nepal") return ["ok", "✓ Automatic for Nepal"];
    if (a.kind === "auto") return ["ok", "✓ Automatic"];
    if (a.kind === "grade") return cls ? (CLS_RANK[cls] >= CLS_RANK[a.min] ? ["ok", `✓ Automatic — you meet the ${a.min}`] : ["need", `Needs a ${a.min} — you're ≈ ${cls === "3rd" ? "below 2:2" : cls}`]) : ["need", `Needs a ${a.min} — add your grade in Filters`];
    if (a.kind === "apply") return ["apply", "Apply · competitive"];
    if (a.kind === "early") return ["early", "Discount for paying early"];
    if (a.kind === "pathway") return ["muted", "Pathway college only"];
    return ["muted", "Partner institutions only"];
  };
  return `<details class="pp" open>${head}<div class="pp-body">
    ${list.map(a => { const [c, t] = status(a); return `<div class="aw-row"><div class="aw-top"><b>${esc(a.name)}</b><span class="aw-amt">${esc(a.amtText)}</span></div>
      <span class="aw-st ${c}">${esc(t)}${a.courses && rows.some(r => a.courses.includes(r.p)) ? ` · ${esc(a.courses.join(", "))}` : ""}${a.deadline ? ` · deadline ${esc(a.deadline)}` : ""}</span>
      <p class="aw-note">${esc(a.note)} <a href="${esc(a.src)}" target="_blank" rel="noopener">Source ↗</a></p></div>`; }).join("")}
    <p class="pp-src">Automatic awards count as "Sure scholarship"${when ? ` · checked ${when}` : ""}</p>
  </div></details>`;
}
function renderCard(u, withPlace) {
  const city = $("city").value, U = UNIS[u];
  const rs = LIST.filter(r => r.u === u);
  const any = rs.length ? rs : ROWS.filter(r => r.u === u);
  const f = any[0];
  $("cardTitle").textContent = u;
  $("cardSub").textContent = [MULTI ? uniCo(u).flag + " " + U.c : U.c, U.priv ? "Private" : "", uniCo(u).rank ? (f.uk ? `UK #${f.uk}` : f.nr ? "" : "UK unranked") : "", f.qs ? `QS ${f.qs}` : f.nr ? "" : "QS unranked",
    city && U.c !== city ? `${Math.round(uniKm(u, city))} km from ${city}` : "", `${rs.length} matching course${rs.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  $("cardAwards").innerHTML = `<div class="uni-note">${noteHTML(uniKey(u))}</div>` + awardsHTML(u);
  $("cardPay").innerHTML = payHTML(u);
  $("cardCourses").innerHTML = (rs.length ? rs : []).sort((a, b) => a.n - b.n).map(courseHTML).join("") || `<p class="gp-empty">No courses here match the current filters.</p>`;
  if (withPlace) loadPlace(u);
}
const stars = n => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
async function loadPlace(u) {
  const box = $("gplace"), id = ++placeReq;
  const gmSearch = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(UNIS[u].q);
  if (!MAP || MAP.kind !== "google") {
    box.innerHTML = `<div class="gp-empty">Photos &amp; reviews need a Google Maps key.<br><a href="${gmSearch}" target="_blank" rel="noopener">Open ${esc(u)} in Google Maps ↗</a></div>`;
    return;
  }
  box.innerHTML = `<div class="skeleton"></div><div class="gp-body"><p class="gp-note">Loading Google Maps details…</p></div>`;
  let p;
  try { p = placeCache[u] ?? (placeCache[u] = await MAP.place(u)); }
  catch (e) { console.error(e); p = null; }
  if (id !== placeReq) return;
  if (!p) { box.innerHTML = `<div class="gp-empty">Couldn't load Google details (check that "Places API (New)" is enabled for your key).<br><a href="${gmSearch}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>`; return; }
  const photos = (p.photos || []).slice(0, 8).map(ph => {
    const a = (ph.authorAttributions || [])[0];
    return `<figure><img loading="lazy" src="${esc(ph.getURI({ maxHeight: 400 }))}" alt="Photo of ${esc(p.displayName)}">${a ? `<figcaption><a href="${esc(a.uri)}" target="_blank" rel="noopener">${esc(a.displayName)}</a></figcaption>` : ""}</figure>`;
  }).join("");
  const reviews = (p.reviews || []).map(rv => {
    const a = rv.authorAttribution || {};
    return `<div class="review">
      <div class="review-h">${a.photoURI ? `<img src="${esc(a.photoURI)}" alt="" referrerpolicy="no-referrer">` : ""}<a href="${esc(a.uri || "#")}" target="_blank" rel="noopener">${esc(a.displayName || "Google user")}</a><span class="stars">${stars(rv.rating || 0)}</span><span class="when">${esc(rv.relativePublishTimeDescription || "")}</span></div>
      <p>${esc(rv.text || "")}</p>${(rv.text || "").length > 260 ? `<button type="button" class="more">More</button>` : ""}
    </div>`;
  }).join("");
  box.innerHTML = `
    ${photos ? `<div class="gp-photos">${photos}</div>` : ""}
    <div class="gp-body">
      <div class="gp-title"><b>${esc(p.displayName)}</b>${p.rating ? `<span class="stars">${p.rating.toFixed(1)} ${stars(p.rating)}<small>(${(p.userRatingCount || 0).toLocaleString("en-GB")})</small></span>` : ""}</div>
      <p class="gp-addr">${esc(p.formattedAddress || "")}</p>
      <div class="gp-links">
        <a href="${esc(p.googleMapsURI || gmSearch)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>
        ${p.websiteURI ? `<a href="${esc(p.websiteURI)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
        <a href="https://www.google.com/search?q=${encodeURIComponent(u + " international fees " + (LIST.find(r => r.u === u)?.lv === "PhD" ? "PhD computer science" : "MSc"))}" target="_blank" rel="noopener">Verify fees ↗</a>
      </div>
      ${reviews || `<p class="gp-note">No Google reviews returned.</p>`}
      <p class="gp-note">Photos, rating and reviews from Google Maps.</p>
    </div>`;
  box.querySelectorAll(".review .more").forEach(b => b.addEventListener("click", () => { const t = b.previousElementSibling; t.classList.toggle("open"); b.textContent = t.classList.contains("open") ? "Less" : "More"; }));
}

/* ---------------- refresh fees from university websites ---------------- */
const SOURCE_UNIS = [...new Set(ROWS.filter(r => r.url).map(r => r.u))];
const fmtWhen = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function syncLiveBar(msg) {
  const ok = ROWS.filter(r => r.live).length;
  const st = msg || (LIVE.checked ? `Live fees for ${ok} courses, checked ${fmtWhen(LIVE.checked)}` : "Showing saved fees");
  $("liveStatus").textContent = st; // read by screen readers; sighted users get it on hover
  $("refreshBtn").title = `Refresh fees from course pages\n${st}`;
  $("liveReportBtn").hidden = !LIVE.checked;
}
// Shared fees: the latest readings saved in the database by anyone's refresh (api/fees). Applied on load,
// with the same safeguard as a manual refresh (a fee far from the built-in one shows as "needs check").
async function loadSharedFees(fresh) {
  try {
    const rsp = await fetch("api/fees" + (fresh ? "?t=" + Date.now() : ""));
    if (!rsp.ok) return false;
    const j = await rsp.json();
    if (!j.res || !j.n) return false;
    LIVE = { checked: j.checked, res: j.res, shared: true };
    return true;
  } catch (e) { return false; }
}
let refreshing = false;
async function refreshFees() {
  if (refreshing) return;
  refreshing = true; $("refreshBtn").disabled = true; $("refreshBtn").classList.add("spin");
  const res = {}, queue = SOURCE_UNIS.slice(); let done = 0, apiMissing = false, dbSaved = false;
  syncLiveBar(`Checking 0 / ${queue.length} universities…`);
  async function worker() {
    while (queue.length && !apiMissing) {
      const u = queue.shift();
      try {
        const rsp = await fetch("api/refresh?u=" + encodeURIComponent(u));
        if (!rsp.ok && !/json/.test(rsp.headers.get("content-type") || "")) { apiMissing = true; break; }
        const j = await rsp.json();
        (j.results || []).forEach(x => { res[x.url] = x; });
        if (/^saved/.test(j.db || "")) dbSaved = true;
      } catch (e) { ROWS.filter(r => r.u === u && r.url).forEach(r => { res[r.url] = { url: r.url, ok: false, err: "Network error" }; }); }
      syncLiveBar(`Checking ${++done} / ${SOURCE_UNIS.length} universities…`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  refreshing = false; $("refreshBtn").disabled = false; $("refreshBtn").classList.remove("spin");
  if (apiMissing) {
    syncLiveBar();
    showReport("Refresh isn't available here — run <code>npm run dev</code> or deploy to Vercel.");
    return;
  }
  LIVE = { checked: new Date().toISOString(), res };
  // Saved to the shared database: reload from there, so pages that failed this time keep their last good fee.
  if (dbSaved) await loadSharedFees(true);
  saveLive();
  applyLive(); fitMaxCost(); update(); syncLiveBar(); showReport();
}

function showReport(errorHTML) {
  const dlg = $("liveReport");
  if (errorHTML) { $("lrSummary").innerHTML = errorHTML; $("lrBody").innerHTML = ""; dlg.showModal(); return; }
  const rows = ROWS.filter(r => r.lv === "Masters").map(r => ({ r, st: liveStatus(r) }));
  const n = st => rows.filter(x => x.st === st).length;
  const closed = ROWS.filter(r => r.closed).length, intakes = ROWS.filter(r => r.iLive).length;
  $("lrSummary").innerHTML = `Checked ${fmtWhen(LIVE.checked)}: <b>${n("updated")}</b> changed · <b>${n("same")}</b> unchanged · <b>${intakes}</b> new start dates · ` +
    `<b>${closed}</b> closed · <b>${n("mismatch")}</b> to check · <b>${n("unreadable") + n("nosource")}</b> unreadable (last saved fee kept).`;
  const ORDER = { updated: 0, mismatch: 1, unreadable: 2, same: 3, nosource: 4, unchecked: 5 };
  const LABEL = { updated: "Updated", same: "Unchanged", mismatch: "Needs check", unreadable: "Not readable", nosource: "No page on record", unchecked: "Not checked" };
  $("lrBody").innerHTML = rows.sort((a, b) => (!!b.r.closed - !!a.r.closed) || ORDER[a.st] - ORDER[b.st] || a.r.u.localeCompare(b.r.u)).map(({ r, st }) => {
    const x = r.url && LIVE.res[r.url];
    return `<tr class="st-${st}"><td><b>${esc(r.u)}</b><span class="sub">${esc(r.p)}</span></td>
      <td class="num">${rm(r, r.f0)}</td><td class="num">${x && x.ok ? rm(r, x.fee) : "—"}</td>
      <td>${LABEL[st]}${x && !x.ok ? `<span class="sub">${esc(x.err)}</span>` : ""}${r.closed ? `<span class="sub warn">${r.closed.status === "gone" ? "Page removed" : "Not recruiting"}: ${esc(r.closed.note)}</span>` : ""}${r.iLive ? `<span class="sub">Intakes now ${esc(r.i)} (was ${esc(r.i0)})</span>` : ""}</td>
      <td>${r.url ? `<a href="${esc((x && x.src) || r.url)}" target="_blank" rel="noopener">Page ↗</a>` : ""}</td></tr>`;
  }).join("");
  dlg.showModal();
}
$("refreshBtn").addEventListener("click", refreshFees);
$("liveReportBtn").addEventListener("click", () => showReport());
$("lrClose").addEventListener("click", () => $("liveReport").close());
syncLiveBar();

/* ---------------- main update ---------------- */
/* ---------------- shortlist ⭐, application status, "what changed", saved searches ----------------
   Stored with your other inputs (S → localStorage "ukmap-state"), so they sync to your account when signed in.
   S.short[key] = { at, st, snap: { f, i, c } } — snap is the fee / start dates / open-closed state you last saw;
   when the weekly refresh changes any of these, the shortlist shows what changed until you mark it as seen. */
if (!S.short || typeof S.short !== "object" || Array.isArray(S.short)) S.short = {};
if (!Array.isArray(S.searches)) S.searches = [];
const courseKey = r => `${r.co || "uk"}|${r.u}|${r.p}`;
const keyShown = k => inCountry(k.split("|")[0]);   // shortlisted course in a ticked country
const KEYED = new Map(ROWS.map(r => [courseKey(r), r]));
const isShort = r => !!S.short[courseKey(r)];
const STATUS = [["considering", "Considering"], ["applied", "Applied"], ["offer", "Offer"], ["accepted", "Accepted"], ["rejected", "Rejected"]];
const STATUS_LBL = Object.fromEntries(STATUS);
const haveLive = () => !!LIVE.checked;   // only compare once the latest fees/course details are in
const snapOf = r => ({ f: r.f, i: r.i, c: r.closed ? r.closed.status : null });
const STAR = on => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="${on ? "currentColor" : "none"}"/></svg>`;
const starBtn = (r, cls = "") => { const on = isShort(r); return `<button type="button" class="star-btn ${on ? "on" : ""} ${cls}" data-star="${esc(courseKey(r))}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} shortlist: ${esc(r.p)}, ${esc(r.u)}" title="${on ? "Remove from shortlist" : "Add to shortlist"}">${STAR(on)}</button>`; };
const statusSelect = (key, st) => `<select class="st-sel st-${st}" data-status="${esc(key)}" aria-label="Application status">${STATUS.map(([v, l]) => `<option value="${v}"${v === st ? " selected" : ""}>${l}</option>`).join("")}</select>`;

function toggleShort(key) {
  const r = KEYED.get(key);
  if (S.short[key]) delete S.short[key];
  else S.short[key] = { at: new Date().toISOString(), st: "considering", ...(r && haveLive() ? { snap: snapOf(r) } : {}) };
  save(); refreshShortUI();
}
function setStatus(key, st) { if (S.short[key] && STATUS_LBL[st]) { S.short[key].st = st; save(); refreshShortUI(); } }
// What changed on your shortlisted courses since you last looked.
function shortChanges() {
  if (!haveLive()) return [];
  const out = [];
  for (const [key, e] of Object.entries(S.short)) {
    if (!keyShown(key)) continue;
    const r = KEYED.get(key);
    if (!r) { out.push({ key, text: "is no longer listed on the map", kind: "gone", title: key.split("|").slice(1).join(" · ") }); continue; }
    if (!e.snap) continue;
    const t = `${r.p} · ${r.u}`;
    if (e.snap.f !== r.f && isFinite(e.snap.f)) out.push({ key, title: t, kind: r.f > e.snap.f ? "up" : "down", text: `tuition ${r.f > e.snap.f ? "went up" : "went down"}: ${rm(r, e.snap.f)} → ${rm(r, r.f)} a year` });
    if (e.snap.i !== r.i && e.snap.i) out.push({ key, title: t, kind: "info", text: `start dates changed: ${e.snap.i} → ${r.i}` });
    const c = r.closed ? r.closed.status : null;
    if (c !== e.snap.c) out.push({ key, title: t, kind: c ? "bad" : "good", text: c === "gone" ? "course page has been removed — check it still runs" : c ? "is no longer taking applications" : "is open for applications again" });
  }
  return out;
}
function markSeen() {
  for (const [key, e] of Object.entries(S.short)) { const r = KEYED.get(key); if (r) e.snap = snapOf(r); else if (keyShown(key)) delete S.short[key]; }
  save(); refreshShortUI();
}
function syncShortBtn() {
  // Courses shortlisted before the latest data loaded get their "last seen" values now (no change reported).
  if (haveLive()) { let fill = false; for (const [key, e] of Object.entries(S.short)) { const r = KEYED.get(key); if (r && !e.snap) { e.snap = snapOf(r); fill = true; } } if (fill) save(); }
  const mine = Object.keys(S.short).filter(keyShown).length, ch = shortChanges().length;
  $("shortCount").textContent = mine; $("shortCount").hidden = !mine;
  $("shortDot").hidden = !ch;
  $("shortBtn").title = `My shortlist — ${mine} course${mine === 1 ? "" : "s"}${ch ? ` · ${ch} update${ch === 1 ? "" : "s"}` : ""}`;
}
function refreshShortUI() {
  if (openUni) renderCard(openUni, false);
  renderTable(); syncShortBtn();
  if ($("shortDlg").open) renderShortlist();
}
let shortFilter = "all";   // status shown in the shortlist ("all" or a status)
function renderShortlist() {
  const all = Object.entries(S.short).filter(([k]) => keyShown(k)).map(([k, e]) => ({ k, e, r: KEYED.get(k) })).filter(x => x.r)
    .sort((a, b) => STATUS.findIndex(s => s[0] === a.e.st) - STATUS.findIndex(s => s[0] === b.e.st) || a.r.n - b.r.n);
  if (shortFilter !== "all" && !all.some(x => x.e.st === shortFilter)) shortFilter = "all";
  const items = shortFilter === "all" ? all : all.filter(x => x.e.st === shortFilter);
  const hidden = Object.keys(S.short).filter(k => !keyShown(k)), other = hidden.length;
  const otherNames = [...new Set(hidden.map(k => COUNTRIES[k.split("|")[0]]?.full).filter(Boolean))].join(" and ");
  const changes = shortChanges();
  syncTools();
  $("shortSub").textContent = all.length ? `${all.length} course${all.length === 1 ? "" : "s"}${changes.length ? ` · ${changes.length} update${changes.length === 1 ? "" : "s"}` : ""}` : "";
  // sidebar: status filter, upcoming deadlines, what changed, notes
  $("shortSum").innerHTML = [["all", "All courses", all.length], ...STATUS.map(([v, l]) => [v, l, all.filter(x => x.e.st === v).length])]
    .map(([v, l, n]) => `<button type="button" class="shx-f st-${v}" data-sfilter="${v}" aria-pressed="${shortFilter === v}"${!n && v !== "all" ? " disabled" : ""}><i aria-hidden="true"></i><span>${l}</span><b>${n}</b></button>`).join("");
  $("shortUp").innerHTML = upcomingHTML();
  $("shortChanges").innerHTML = changes.length ? `<section class="shx-box sh-changes" aria-label="What changed">
      <h3>What changed <span class="shx-badge">${changes.length}</span></h3>
      <ul>${changes.map(c => `<li class="ch-${c.kind}"><b>${esc(c.title)}</b><span>${esc(c.text)}</span></li>`).join("")}</ul>
      <button type="button" class="btn-plain sm" id="shortSeen">Mark as seen</button></section>` : "";
  $("shortFoot").innerHTML = (other ? `<p class="acct-hint">+${other} shortlisted in ${esc(otherNames)} (not ticked in the country menu).</p>` : "")
    + `<p class="signin-nudge">Saved in this browser only. <button type="button" class="link-btn" data-signin="signup">Sign in</button> to keep your shortlist on any device — no email, just a username &amp; password.</p>`;
  // main: one card per course
  $("shortBody").innerHTML = items.length ? `<div class="shx-cards">${items.map(({ k, e, r }) => { const d = deficit(r);
    return `<article class="shc st-${e.st}">
      <div class="shc-top">${starBtn(r)}
        <div class="shc-name"><button type="button" class="shc-title sh-open" data-open="${esc(r.u)}" data-key="${esc(k)}" title="Show on the map">${esc(r.p)}</button>
          <span class="shc-uni">${coOf(r).flag} ${esc(r.u)} <span class="shc-city">${IC.pin}${esc(r.c)}</span></span></div>
        ${statusSelect(k, e.st)}</div>
      ${r.closed ? `<p class="shc-warn">${r.closed.status === "gone" ? "Course page removed — check it still runs" : "Not taking applications (per course page)"}</p>` : ""}
      <dl class="shc-figs">
        <div class="tot" title="Total for year 1, after any sure scholarship"><dt>${IC.pound}Year 1</dt><dd>~${rm(r, r.n)}</dd></div>
        <div title="Tuition per year"><dt>${IC.doc}Tuition</dt><dd>${rm(r, r.f)}</dd></div>
        <div title="Intakes"><dt>${IC.cal}Starts</dt><dd>${esc(r.i)}</dd></div>
        <div class="aff ${d > 0 ? "short" : "ok"}" title="Whether your jobs cover the remaining fee and living costs"><dt>${IC.work}Work</dt><dd>${d > 0 ? `−${rm(r, r100(d))}/yr` : "✓ Covered"}</dd></div>
      </dl>
      ${planHTML(k)}
      ${noteHTML(k)}
      <div class="shc-acts">
        <label class="act-btn cmp-pick" title="Add to the side-by-side comparison"><input type="checkbox" data-cmp="${esc(k)}"${S.cmp.includes(k) ? " checked" : ""}>${IC.cmp}<span>Compare</span></label>
        <button type="button" class="act-btn" data-funds="${esc(k)}" title="Proof of funds for the visa">${IC.funds}<span>Funds</span></button>
        <button type="button" class="act-btn quiet" data-report="${esc(k)}" title="Report wrong information about this course">${IC.flag}<span>Report</span></button>
      </div></article>`; }).join("")}</div>`
    : `<p class="sh-empty">${STAR(false)}<span>${all.length ? "No courses with this status." : "Star a course on the map or in the list to save it here."}</span></p>`;
  $("shortSeen")?.addEventListener("click", markSeen);
}
$("shortSum").addEventListener("click", e => { const b = e.target.closest("[data-sfilter]"); if (b) { shortFilter = b.dataset.sfilter; renderShortlist(); } });
$("shortBtn").addEventListener("click", () => { renderShortlist(); $("shortDlg").showModal(); });
$("shortClose").addEventListener("click", () => $("shortDlg").close());
$("shortDlg").addEventListener("click", e => {
  if (e.target === $("shortDlg")) return $("shortDlg").close();
  const o = e.target.closest("[data-open]");
  if (o) {   // open the university card and bring this course into view
    $("shortDlg").close(); setView(false); openCard(o.dataset.open, true);
    const art = [...document.querySelectorAll("#card [data-star]")].find(b => b.dataset.star === o.dataset.key)?.closest(".course");
    if (art) { art.scrollIntoView({ block: "start", behavior: "smooth" }); art.classList.remove("flash"); void art.offsetWidth; art.classList.add("flash"); }
  }
});
// Stars and status menus anywhere: course cards, list rows, the shortlist.
document.addEventListener("click", e => { const b = e.target.closest("[data-star]"); if (b) { e.stopPropagation(); toggleShort(b.dataset.star); } }, true);
document.addEventListener("change", e => { const s = e.target.closest("select[data-status]"); if (s) setStatus(s.dataset.status, s.value); });

/* saved searches: the current filters under a name, re-applied in one click (per set of ticked countries) */
const SEL_KEY = SEL.join("+");
const CHIPS = ["f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest", "f-entry"];
const filterSnap = () => ({ q: $("q").value, max: $("maxcost").value === $("maxcost").max ? null : +$("maxcost").value, city: $("city").value, radius: $("radius").value,
  rank: $("rank").value, utype: $("utype").value, chips: CHIPS.filter(id => $(id).checked), lvs: S.lvs.slice(), subjs: S.subjs.slice() });
function applySearch(f) {
  $("q").value = f.q || ""; $("city").value = f.city || ""; $("radius").value = f.radius || ""; $("rank").value = f.rank || ""; $("utype").value = f.utype || "";
  $("maxcost").value = f.max == null ? $("maxcost").max : Math.min(+$("maxcost").max, f.max);
  CHIPS.forEach(id => $(id).checked = (f.chips || []).includes(id));
  S.lvs = Array.isArray(f.lvs) ? f.lvs.filter(l => LEVELS.includes(l)) : f.lv && f.lv !== "ALL" ? [f.lv] : []; S.subjs = Array.isArray(f.subjs) ? f.subjs.filter(g => PNAME[g]) : [];
  save(); update({ fit: true });
}
function renderSearches() {
  const mine = S.searches.filter(s => s.co === SEL_KEY);
  $("ssSel").innerHTML = `<option value="">${mine.length ? "Saved searches…" : "No saved searches yet"}</option>` + mine.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  $("ssDel").hidden = !$("ssSel").value;
}
$("ssSel").addEventListener("change", () => { const s = S.searches.find(x => x.id === $("ssSel").value); if (s) applySearch(s.f); $("ssDel").hidden = !s; });
$("ssSaveBtn").addEventListener("click", () => { $("ssForm").hidden = false; $("ssSaveBtn").hidden = true; $("ssName").value = ""; $("ssName").focus(); });
$("ssCancel").addEventListener("click", () => { $("ssForm").hidden = true; $("ssSaveBtn").hidden = false; });
$("ssForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("ssName").value.replace(/\s+/g, " ").trim().slice(0, 40); if (!name) return $("ssName").focus();
  const id = Date.now().toString(36);
  S.searches = [{ id, co: SEL_KEY, name, f: filterSnap() }, ...S.searches.filter(s => !(s.co === SEL_KEY && s.name.toLowerCase() === name.toLowerCase()))].slice(0, 30);
  save(); $("ssForm").hidden = true; $("ssSaveBtn").hidden = false; renderSearches(); $("ssSel").value = id; $("ssDel").hidden = false;
});
$("ssDel").addEventListener("click", () => { S.searches = S.searches.filter(s => s.id !== $("ssSel").value); save(); renderSearches(); });
renderSearches();

/* ---------------- application tools: deadlines & checklist, calendar, compare, notes, proof of funds, report, share, print ----------------
   All saved in S (so they sync to your account): S.short[key].d = dates, .docs = ticked documents; S.notes; S.cmp; S.funds. */
if (!S.notes || typeof S.notes !== "object" || Array.isArray(S.notes)) S.notes = {};
if (!Array.isArray(S.cmp)) S.cmp = [];
if (!S.funds || typeof S.funds !== "object") S.funds = {};
const ALLKEYED = new Map(ALL.rows.map(r => [courseKey(r), r]));
const keyCo = k => COUNTRIES[k.split("|")[0]] || COUNTRIES.uk;
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const fmtDate = iso => new Date(iso + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const daysTo = iso => Math.round((new Date(iso + "T00:00") - today0()) / 864e5);
// Amounts in a given currency, without converting to the display currency (proof of funds is checked in local money).
const inCur = (n, cur) => (n < 0 ? "−" : "") + CUR[cur].sym + Math.round(Math.abs(n)).toLocaleString(CUR[cur].grp || "en-GB");
const toNPR = (n, cur) => n / FX.rates[cur] * FX.rates.NPR;
const fromNPR = (n, cur) => n / FX.rates.NPR * FX.rates[cur];
let toolMsgT;
function toolMsg(t) { const el = $("shortMsg"); if (!el) return; el.textContent = t; el.hidden = !t; clearTimeout(toolMsgT); toolMsgT = setTimeout(() => { el.hidden = true; }, 5000); }

/* deadlines and documents for each shortlisted course */
const DATES = co => [["apply", "Apply by"], ["dep", co === "de" ? "Semester fee due" : "Deposit due"], ["cas", co === "de" ? "Admission letter" : "CAS"], ["visa", "Visa appointment"], ["fly", "Travel"]];
const DOCS = {
  uk: [["eng", "English test (IELTS etc.)"], ["tr", "Transcripts & degree"], ["sop", "Statement of purpose"], ["ref", "2 references"], ["cv", "CV"], ["pp", "Passport"],
       ["offer", "Offer letter"], ["dep", "Deposit paid"], ["cas", "CAS received"], ["tb", "TB test"], ["funds", "Funds held 28 days"], ["visa", "Visa applied"]],
  de: [["eng", "English test"], ["tr", "Transcripts & degree"], ["mot", "Motivation letter"], ["cv", "CV"], ["ref", "References"], ["ua", "uni-assist / VPD"],
       ["adm", "Admission letter"], ["blk", "Blocked account"], ["ins", "Health insurance"], ["visa", "Visa appointment"]],
};
const docsOf = k => DOCS[keyCo(k).code] || DOCS.uk;
function planSummary(k) {
  const e = S.short[k] || {}, docs = docsOf(k), done = docs.filter(([id]) => e.docs?.[id]).length;
  const next = DATES(keyCo(k).code).map(([f, l]) => ({ l, d: e.d?.[f] })).filter(x => x.d && daysTo(x.d) >= 0).sort((a, b) => a.d.localeCompare(b.d))[0];
  return `<span class="pl-prog" title="${done} of ${docs.length} documents ready">${IC.doc}<i style="--p:${Math.round(done / docs.length * 100)}%"></i>${done}/${docs.length}</span>` +
    (next ? `<span class="pl-next" title="Next date">${IC.clock}<b>${esc(next.l)}</b> ${fmtDate(next.d)}${daysTo(next.d) <= 14 ? ` <em>${daysTo(next.d)}d</em>` : ""}</span>` : `<span class="pl-next muted">${IC.clock}No dates yet</span>`);
}
function planHTML(k) {
  const e = S.short[k] || {}, co = keyCo(k).code;
  return `<details class="sh-plan" data-plan="${esc(k)}"${openPlans.has(k) ? " open" : ""}><summary title="Dates and document checklist">${IC.list}<span class="pl-t">Checklist</span><span class="pl-sum">${planSummary(k)}</span></summary>
    <div class="pl-body">
      <h4>${IC.cal}Key dates</h4>
      <div class="pl-dates">${DATES(co).map(([f, l]) => `<label><span>${l}</span><input type="date" data-date="${esc(k)}|${f}" value="${esc(e.d?.[f] || "")}"></label>`).join("")}</div>
      <h4>${IC.doc}Documents</h4>
      <div class="pl-docs">${docsOf(k).map(([id, l]) => `<label><input type="checkbox" data-doc="${esc(k)}|${id}"${e.docs?.[id] ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>
    </div></details>`;
}
const openPlans = new Set();
function upcomingHTML() {
  const t = [];
  for (const [k, e] of Object.entries(S.short)) {
    if (!keyShown(k) || !e.d) continue;
    const r = KEYED.get(k); if (!r) continue;
    for (const [f, l] of DATES(keyCo(k).code)) { const d = e.d[f]; if (d && daysTo(d) >= -7 && daysTo(d) <= 120) t.push({ d, l, r }); }
  }
  if (!t.length) return `<h3>${IC.clock}Upcoming</h3><p class="shx-empty">Add dates in a course's checklist to see them here.</p>`;
  t.sort((a, b) => a.d.localeCompare(b.d));
  return `<h3>${IC.clock}Upcoming</h3><ul class="sh-up">${t.slice(0, 8).map(x => { const n = daysTo(x.d), dt = new Date(x.d + "T00:00");
    return `<li class="${n < 0 ? "past" : n <= 7 ? "soon" : ""}"><span class="up-cal"><b>${dt.getDate()}</b>${dt.toLocaleDateString("en-GB", { month: "short" })}</span>
      <span class="up-t"><b>${esc(x.l)}</b><span>${esc(x.r.p)} · ${esc(x.r.u)}</span></span><span class="up-n">${n < 0 ? "passed" : n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"}`}</span></li>`; }).join("")}</ul>`;
}
function syncTools() {
  S.cmp = S.cmp.filter(k => S.short[k] && keyShown(k) && KEYED.has(k));
  $("cmpN").textContent = S.cmp.length; $("cmpBtn").disabled = S.cmp.length < 2;
  $("cmpBtn").title = S.cmp.length < 2 ? "Tick Compare on 2–4 course cards" : "Compare the ticked courses side by side";
}
// Typing in dates, documents, notes and compare boxes saves straight away without redrawing the list.
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.date) {
    const i = t.dataset.date.lastIndexOf("|"), k = t.dataset.date.slice(0, i), f = t.dataset.date.slice(i + 1), x = S.short[k]; if (!x) return;
    x.d = { ...x.d, [f]: t.value }; if (!t.value) delete x.d[f];
  } else if (t.dataset.doc) {
    const i = t.dataset.doc.lastIndexOf("|"), k = t.dataset.doc.slice(0, i), id = t.dataset.doc.slice(i + 1), x = S.short[k]; if (!x) return;
    x.docs = { ...x.docs, [id]: t.checked }; if (!t.checked) delete x.docs[id];
  } else if (t.dataset.cmp) {
    const k = t.dataset.cmp;
    if (t.checked && S.cmp.length >= 4) { t.checked = false; toolMsg("You can compare up to 4 courses."); return; }
    S.cmp = t.checked ? [...new Set([...S.cmp, k])] : S.cmp.filter(x => x !== k);
  } else return;
  save(); syncTools();
  const box = t.closest(".sh-plan"); if (box) box.querySelector(".pl-sum").innerHTML = planSummary(box.dataset.plan);
  if (t.dataset.date) { const html = upcomingHTML(); if ($("shortUp").innerHTML !== html) $("shortUp").innerHTML = html; }   // only if it changed
});
document.addEventListener("toggle", e => { const d = e.target; if (d.classList?.contains("sh-plan")) { if (d.open) openPlans.add(d.dataset.plan); else openPlans.delete(d.dataset.plan); } }, true);

/* private notes on a course or a university */
const uniKey = u => `u|${UNIS[u]?.co || "uk"}|${u}`;
const ICO = (d, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 20 20" aria-hidden="true">${d}</svg>`;
const IC = {
  funds: ICO('<rect x="2.5" y="5" width="15" height="11" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M2.5 8.5h15" stroke="currentColor" stroke-width="1.6"/><circle cx="13.5" cy="12.3" r="1.2" fill="currentColor"/>'),
  flag: ICO('<path d="M5 17V3.5m0 0h9l-1.8 3.2L14 10H5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  cmp: ICO('<rect x="3" y="4" width="5.5" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="11.5" y="4" width="5.5" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/>'),
  list: ICO('<path d="M8.5 6h8M8.5 10h8M8.5 14h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m3.5 6 1 1 2-2M3.5 10l1 1 2-2M3.5 14l1 1 2-2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  doc: ICO('<path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M11.5 2.5V6H15" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>'),
  clock: ICO('<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M10 6.2V10l2.6 1.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  cal: ICO('<rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  pin: ICO('<path d="M10 17.5s5.5-5 5.5-9.3a5.5 5.5 0 1 0-11 0c0 4.3 5.5 9.3 5.5 9.3z" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="10" cy="8.2" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>'),
  pound: ICO('<circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12.6 6.6A2.4 2.4 0 0 0 8.4 8.1v5.4M7 10.5h4.4M7 13.5h6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>'),
  work: ICO('<rect x="2.5" y="6" width="15" height="10.5" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6" stroke="currentColor" stroke-width="1.6" fill="none"/>'),
};
const NOTE_ICO = `<svg class="note-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V12l-4 4.5H5.5A1.5 1.5 0 0 1 4 15z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 12h-2.5a1.5 1.5 0 0 0-1.5 1.5v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 7h6M7 9.8h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
// University notes use keys "u|…"; everything else is a course.
const noteHTML = key => { const what = key.startsWith("u|") ? "this university" : "this course";
  return `<details class="note-box"${S.notes[key] ? " open" : ""}><summary title="Only you can see your notes">${NOTE_ICO}<span>${S.notes[key] ? `Your notes on ${what}` : `Add a note for ${what}`}</span></summary>
  <textarea data-note="${esc(key)}" maxlength="2000" rows="3" placeholder="Contacts, interview dates, scholarship emails… only you can see these">${esc(S.notes[key] || "")}</textarea></details>`; };
let noteT;
document.addEventListener("input", e => {
  const t = e.target.closest?.("textarea[data-note]"); if (!t) return;
  const k = t.dataset.note, v = t.value.slice(0, 2000);
  if (v.trim()) S.notes[k] = v; else delete S.notes[k];
  document.querySelectorAll("textarea[data-note]").forEach(o => { if (o !== t && o.dataset.note === k) o.value = v; });
  clearTimeout(noteT); noteT = setTimeout(save, 500);
});

/* calendar file (.ics) with every date, each with a reminder 3 days before */
function downloadICS() {
  const ev = [], stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const icsEsc = s => String(s).replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const ymd = iso => iso.replace(/-/g, ""), next = iso => { const d = new Date(iso + "T00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
  for (const [k, e] of Object.entries(S.short)) {
    const r = ALLKEYED.get(k); if (!r || !e.d) continue;
    for (const [f, l] of DATES(keyCo(k).code)) {
      const d = e.d[f]; if (!d) continue;
      ev.push(["BEGIN:VEVENT", `UID:${ymd(d)}-${f}-${btoa(unescape(encodeURIComponent(k))).replace(/[^a-z0-9]/gi, "").slice(0, 40)}@unimap`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${next(d)}`, `SUMMARY:${icsEsc(`${l} — ${r.p}, ${r.u}`)}`,
        `DESCRIPTION:${icsEsc(`${r.p} at ${r.u} (${r.c}). From your Uni Map shortlist.${r.url ? "\n" + r.url : ""}`)}`,
        "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(l + " in 3 days")}`, "END:VALARM", "END:VEVENT"].join("\r\n"));
    }
  }
  if (!ev.length) return toolMsg("Add some dates first (open Dates & checklist on a course).");
  const blob = new Blob([["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Uni Map//Shortlist//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Uni Map deadlines", ...ev, "END:VCALENDAR"].join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "uni-map-deadlines.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toolMsg(`${ev.length} date${ev.length === 1 ? "" : "s"} saved as a calendar file — open it to add them to your calendar.`);
}

/* compare 2–4 courses side by side */
function renderCompare() {
  const rs = S.cmp.map(k => KEYED.get(k)).filter(Boolean);
  const best = (vals, low = true) => { const ok = vals.filter(v => isFinite(v)); const b = low ? Math.min(...ok) : Math.max(...ok); return vals.map(v => ok.length > 1 && v === b); };
  const row = (label, cells, mark) => `<tr><th scope="row">${label}</th>${cells.map((c, i) => `<td class="${mark?.[i] ? "best" : ""}">${c}</td>`).join("")}</tr>`;
  const base = f => rs.map(r => toBase(f(r), r));
  const ent = rs.map(r => { const c = entryCheck(r); return c.state === "ok" ? `<span class="ent ok">✓ You meet it</span>` : c.state === "no" ? `<span class="ent no">✗ ${esc(c.fail.join(", "))}</span>` : c.state === "add" ? `<span class="muted">Add your degree &amp; English test</span>` : `<span class="muted">Not listed</span>`; });
  $("cmpBody").innerHTML = `<table class="cmp-tbl"><thead><tr><th></th>${rs.map(r => `<th scope="col"><b>${esc(r.p)}</b><span class="sub">${esc(r.u)} · ${MULTI ? coOf(r).flag + " " : ""}${esc(r.c)}</span></th>`).join("")}</tr></thead><tbody>
    ${row("Level · subject", rs.map(r => `${r.lv} · ${esc(r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g])}`))}
    ${row("Ranking", rs.map(r => [(r.co || "uk") === "uk" ? `UK ${esc(ukRankText(r))}` : "", `QS ${esc(rankText(r.qs, r))}`].filter(Boolean).join(" · ")))}
    ${row("Intakes", rs.map(r => esc(r.i)))}
    ${row("Tuition / yr", rs.map(r => "~" + rm(r, r.f)), best(base(r => r.f)))}
    ${row("Living / yr", rs.map(r => "~" + rm(r, r.l)), best(base(r => r.l)))}
    ${row("Sure scholarship", rs.map(r => r.s ? rm(r, r.s) : "—"), best(base(r => r.s || 0), false))}
    ${row("<b>Total year 1</b>", rs.map(r => `<b>~${rm(r, r.n)}</b>`), best(base(r => r.n)))}
    ${row(DEP_LABEL, rs.map(r => "~" + rm(r, Math.round(dep(r) / 50) * 50)))}
    ${row("Your work covers it?", rs.map(r => { const d = deficit(r); return d > 0 ? `<span class="ent no">Short ~${rm(r, r100(d))}/yr</span>` : `<span class="ent ok">Covered</span>`; }), best(base(deficit)))}
    ${row("Pay needed / hr", rs.map(r => { const h = needHr(r); return isFinite(h) ? rsym(r) + h.toFixed(2) : "—"; }), best(base(needHr)))}
    ${row("Entry", rs.map(r => esc(r.en || "Not listed")))}
    ${row("You meet entry?", ent)}
    ${row("Placement", rs.map(r => esc(r.pl)))}
    ${row("Paying", rs.map(r => { const P = UNIS[r.u].pay; return (r.co || "uk") === "de" ? "Per semester" : P ? esc([P.dep && "Deposit " + P.dep, P.plan].filter(Boolean).join(" · ")) : `<span class="muted">Not confirmed</span>`; }))}
    ${row("Warnings", rs.map(r => r.fl ? `<span class="warn-txt">${esc(r.fl)}</span>` : "—"))}
    ${row("Status", rs.map(r => STATUS_LBL[S.short[courseKey(r)]?.st] || "—"))}
    ${row("Your notes", rs.map(r => S.notes[courseKey(r)] ? esc(S.notes[courseKey(r)]).replace(/\n/g, "<br>") : `<span class="muted">—</span>`))}
  </tbody></table><p class="cmp-key"><span class="best-k"></span> best of these</p>`;
}

/* proof of funds for the visa: UK 28-day rule, Germany blocked account; your savings and loan in NPR */
const FUNDS = {
  uk: { london: 1483, other: 1136, months: 9 },          // UKVI maintenance, per month (from 2 Jan 2025)
  de: { block: 11904 },                                   // blocked account per year (2026)
};
let fundsKey = null;
function openFunds(k) { fundsKey = k; renderFunds(); $("fundsDlg").showModal(); }
function renderFunds() {
  const k = fundsKey, r = ALLKEYED.get(k); if (!r) return;
  const co = r.co || "uk", cur = coOf(r).cur, F = S.funds, sh = S.short[k];
  const paid = F.paid?.[k] ?? Math.round(dep(r));
  const visa = sh?.d?.visa || F.visa?.[k] || "";
  $("fundsTitle").textContent = "Proof of funds";
  $("fundsBody").innerHTML = `<p class="f-course"><b>${esc(r.p)}</b> · ${esc(r.u)}, ${esc(r.c)}</p>
    <div class="f-grid">
      <label><span>Paid to the university so far (${CUR[cur].sym.trim()})</span><input type="number" min="0" step="100" data-f="paid" value="${paid}"></label>
      <label><span>Visa application date</span><input type="date" data-f="visa" value="${esc(visa)}"></label>
      <label><span>Savings, yours or family's (Rs)</span><input type="number" min="0" step="10000" data-f="sav" value="${esc(F.sav ?? "")}" placeholder="0"></label>
      <label><span>Education loan (Rs)</span><input type="number" min="0" step="10000" data-f="loan" value="${esc(F.loan ?? "")}" placeholder="0"></label>
      <label><span>Loan interest (% a year)</span><input type="number" min="0" max="40" step="0.1" data-f="rate" value="${esc(F.rate ?? 11)}"></label>
      <label><span>Loan term (years)</span><input type="number" min="1" max="20" step="1" data-f="yrs" value="${esc(F.yrs ?? 7)}"></label>
    </div><div id="fundsOut"></div>`;
  fundsOut();
}
function fundsOut() {
  const k = fundsKey, r = ALLKEYED.get(k), co = r.co || "uk", cur = coOf(r).cur, F = S.funds;
  const paid = +(F.paid?.[k] ?? Math.round(dep(r))) || 0, visa = S.short[k]?.d?.visa || F.visa?.[k] || "";
  let need, parts, rule;
  if (co === "de") {
    const sem = Math.max(0, r.f / 2 - paid);
    need = FUNDS.de.block + sem;
    parts = [["Blocked account (12 × €992)", FUNDS.de.block], ["First semester's fee still to pay", sem]];
    rule = visa ? `Open the blocked account by <b>${fmtDate(new Date(new Date(visa + "T00:00") - 42 * 864e5).toISOString().slice(0, 10))}</b> — it takes a few weeks, and the confirmation is needed for your visa appointment.` : "Add your visa date to see when to open the blocked account.";
  } else {
    const london = r.c === "London", rate = london ? FUNDS.uk.london : FUNDS.uk.other, fee = Math.max(0, r.f - (r.s || 0) - paid);
    need = fee + rate * FUNDS.uk.months;
    parts = [["Rest of your first-year fee", fee], [`Living: 9 months × £${rate.toLocaleString("en-GB")}${london ? " (London)" : ""}`, rate * FUNDS.uk.months]];
    if (visa) { const by = new Date(new Date(visa + "T00:00") - 28 * 864e5).toISOString().slice(0, 10);
      rule = `Have the full amount in your account by <b>${fmtDate(by)}</b> and keep it there for 28 days in a row. The statement's last date must be within 31 days of applying (${fmtDate(visa)}).`; }
    else rule = "Add your visa application date to see when the money must be in your account.";
  }
  const have = fromNPR((+F.sav || 0) + (+F.loan || 0), cur), gap = need - have;
  const pick = (v, d) => v === "" || v == null ? d : +v;   // empty boxes use the defaults shown in them
  const L = +F.loan || 0, i = pick(F.rate, 11) / 1200, n = Math.max(1, Math.round(pick(F.yrs, 7))) * 12;
  const emi = L ? (i ? L * i * (1 + i) ** n / ((1 + i) ** n - 1) : L / n) : 0;
  $("fundsOut").innerHTML = `<div class="f-out">
      ${parts.map(([l, v]) => `<div class="f-row"><span>${l}</span><span>${inCur(v, cur)}</span></div>`).join("")}
      <div class="f-row tot"><span>You must show</span><span>${inCur(need, cur)} <small>≈ Rs ${Math.round(toNPR(need, cur)).toLocaleString("en-IN")}</small></span></div>
      <div class="f-row"><span>Savings + loan</span><span>${inCur(have, cur)} <small>≈ Rs ${Math.round((+F.sav || 0) + (+F.loan || 0)).toLocaleString("en-IN")}</small></span></div>
      <div class="f-row res ${gap > 0.5 ? "short" : "ok"}"><span>${gap > 0.5 ? "Still to find" : "Covered, with spare"}</span><span>${inCur(Math.abs(gap), cur)} <small>≈ Rs ${Math.round(Math.abs(toNPR(gap, cur))).toLocaleString("en-IN")}</small></span></div>
    </div>
    <p class="f-rule">${rule}</p>
    ${emi ? `<p class="f-emi">Loan repayment: about <b>Rs ${Math.round(emi).toLocaleString("en-IN")}</b> a month for ${Math.round(n / 12)} years (Rs ${Math.round(emi * n - L).toLocaleString("en-IN")} interest in total).</p>` : ""}
    <p class="f-fine">${co === "de" ? "Blocked account amount for 2026" : "UKVI amounts from January 2025"} at today's exchange rate — check the current rules on ${co === "de" ? "the German embassy's site" : "gov.uk"} before applying.</p>`;
}
$("fundsDlg").addEventListener("input", e => {
  const t = e.target, f = t.dataset.f; if (!f) return;
  const k = fundsKey;
  if (f === "paid") S.funds.paid = { ...S.funds.paid, [k]: t.value === "" ? 0 : +t.value };
  else if (f === "visa") { if (S.short[k]) { S.short[k].d = { ...S.short[k].d, visa: t.value }; if (!t.value) delete S.short[k].d.visa; } else S.funds.visa = { ...S.funds.visa, [k]: t.value }; }
  else S.funds[f] = t.value === "" ? "" : +t.value;
  save(); fundsOut();
});

/* report wrong info about a course → /api/report (you review them in the database) */
let reportKey = null;
function openReport(k) {
  reportKey = k; const r = ALLKEYED.get(k); if (!r) return;
  $("repBody").innerHTML = `<p class="f-course"><b>${esc(r.p)}</b> · ${esc(r.u)}</p>
    <form class="acct-form" id="repForm" novalidate>
      <label class="acct-f"><span>What's wrong?</span><select id="repField"><option value="fee">Tuition fee</option><option value="dates">Start dates / deadline</option><option value="entry">Entry requirements</option><option value="closed">Course closed or doesn't exist</option><option value="scholarship">Scholarship</option><option value="other">Something else</option></select></label>
      <label class="acct-f"><span>The correct information</span><textarea id="repText" rows="3" maxlength="600" required placeholder="e.g. The fee for 2027 is £17,500"></textarea></label>
      <label class="acct-f"><span>Link to where it says so <i>(optional)</i></span><input id="repLink" type="url" maxlength="400" placeholder="https://"></label>
      <button type="submit" class="btn-primary">Send report</button>
      <p class="acct-msg" id="repMsg" role="status"></p>
    </form>`;
  $("reportDlg").showModal(); $("repText").focus();
}
$("reportDlg").addEventListener("submit", async e => {
  e.preventDefault(); const r = ALLKEYED.get(reportKey), btn = e.target.querySelector("button[type=submit]"), msg = $("repMsg");
  const details = $("repText").value.trim(); if (details.length < 3) { msg.className = "acct-msg err"; msg.textContent = "Please say what's wrong."; return; }
  btn.disabled = true; msg.className = "acct-msg"; msg.textContent = "Sending…";
  try {
    const rsp = await fetch("api/report", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "unimap" },
      body: JSON.stringify({ co: r.co || "uk", uni: r.u, course: r.p, field: $("repField").value, details, link: $("repLink").value.trim() }) });
    const j = await rsp.json().catch(() => ({}));
    if (!rsp.ok) throw new Error(j.error || "Couldn't send — please try again.");
    $("repBody").innerHTML = `<p class="f-course">Thanks — we'll check it and update the course.</p><button type="button" class="btn-primary" data-close>Done</button>`;
  } catch (err) { msg.className = "acct-msg err"; msg.textContent = err.message; btn.disabled = false; }
});

/* share: a link that carries the shortlist (courses + status, no notes), plus a printable page */
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
async function shareLink() {
  const keys = Object.entries(S.short).filter(([k]) => ALLKEYED.has(k)).map(([k, e]) => [k, e.st]);
  if (!keys.length) return toolMsg("Star some courses first.");
  const url = location.origin + location.pathname + "#s=" + b64e(JSON.stringify({ v: 1, k: keys }));
  try { await navigator.clipboard.writeText(url); toolMsg("Link copied — anyone with it can see your shortlist (not your notes or money)."); }
  catch (e) { prompt("Copy this link:", url); }
}
function openShared() {
  const m = location.hash.match(/^#s=([\w-]+)/); if (!m) return;
  let data; try { data = JSON.parse(b64d(m[1])); } catch (e) { return; }
  const items = (Array.isArray(data.k) ? data.k : []).slice(0, 100).map(([k, st]) => ({ k, st: STATUS_LBL[st] ? st : "considering", r: ALLKEYED.get(k) })).filter(x => x.r);
  history.replaceState(null, "", location.pathname + location.search);
  if (!items.length) return;
  $("sharedBody").innerHTML = `<p class="dlg-pad muted">Someone shared ${items.length} course${items.length === 1 ? "" : "s"} with you. Costs are first-year estimates.</p>
    <ul class="sh-list">${items.map(({ k, st, r }) => `<li><span class="flag-s">${coOf(r).flag}</span>
      <div class="sh-main"><b>${esc(r.p)}</b><span class="sub">${esc(r.u)} · ${esc(r.c)} · starts ${esc(r.i)}</span></div>
      <div class="sh-num"><b>~${rm(r, r.n)}</b><span class="sub">yr 1 total · ${rm(r, r.f)} tuition</span></div>
      <span class="st-sel st-${st}">${STATUS_LBL[st]}</span></li>`).join("")}</ul>
    <div class="dlg-pad"><button type="button" class="btn-primary" id="sharedAdd">Add these to my shortlist</button></div>`;
  $("sharedAdd").addEventListener("click", () => {
    let n = 0; for (const { k } of items) if (!S.short[k]) { S.short[k] = { at: new Date().toISOString(), st: "considering" }; n++; }
    save(); refreshShortUI(); $("sharedDlg").close();
    if (n) { renderShortlist(); $("shortDlg").showModal(); toolMsg(`${n} course${n === 1 ? "" : "s"} added.`); }
  });
  $("sharedDlg").showModal();
}
function printShortlist() {
  const items = Object.entries(S.short).map(([k, e]) => ({ k, e, r: ALLKEYED.get(k) })).filter(x => x.r)
    .sort((a, b) => STATUS.findIndex(s => s[0] === a.e.st) - STATUS.findIndex(s => s[0] === b.e.st) || toBase(a.r.n, a.r) - toBase(b.r.n, b.r));
  if (!items.length) return toolMsg("Star some courses first.");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const counts = STATUS.map(([v, l]) => [v, l, items.filter(x => x.e.st === v).length]).filter(x => x[2]);
  // every dated step across the shortlist, soonest first
  const dates = items.flatMap(({ k, e, r }) => DATES(keyCo(k).code).filter(([f]) => e.d?.[f]).map(([f, l]) => ({ d: e.d[f], l, r }))).sort((a, b) => a.d.localeCompare(b.d));
  const g = S.grade || {}, cls = myClass(), m = myEng();
  const edu = [g.subj, cls ? `UK ≈ ${cls === "3rd" ? "below 2:2" : cls}` : "", m.overall ? `${m.T.name} ${m.raw.overall}${m.test === "ielts" ? "" : ` (≈ IELTS ${m.overall.toFixed(1)})`}` : ""].filter(Boolean).join(" · ");
  $("printArea").innerHTML = `<header class="pr-head"><div><h1>My shortlist</h1><p>${items.length} course${items.length === 1 ? "" : "s"} · ${today}${edu ? ` · ${esc(edu)}` : ""}</p></div><span class="pr-brand">Uni Map</span></header>
    <div class="pr-counts">${counts.map(([v, l, n]) => `<span class="pr-pill st-${v}">${n} ${l}</span>`).join("")}</div>
    ${dates.length ? `<section class="pr-sec"><h2>Deadlines</h2><div class="pr-dates">${dates.map(x => { const n = daysTo(x.d);
      return `<div class="pr-dr ${n < 0 ? "past" : n <= 14 ? "soon" : ""}"><span class="dd">${fmtDate(x.d)}</span><b>${esc(x.l)}</b><span>${esc(x.r.p)} — ${esc(x.r.u)}</span><span class="dn">${n < 0 ? "passed" : n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`}</span></div>`; }).join("")}</div></section>` : ""}
    <section class="pr-sec"><h2>Courses</h2>
    ${items.map(({ k, e, r }) => { const d = keyShown(k) ? deficit(r) : null, docs = docsOf(k), done = docs.filter(([id]) => e.docs?.[id]).length, ds = DATES(keyCo(k).code).filter(([f]) => e.d?.[f]);
      return `<article class="pr-card st-${e.st}">
        <div class="pr-top"><div><h3>${esc(r.p)}</h3><p>${coOf(r).flag} ${esc(r.u)} · ${esc(r.c)} · starts ${esc(r.i)}</p></div><span class="pr-pill st-${e.st}">${STATUS_LBL[e.st] || "Considering"}</span></div>
        <div class="pr-figs">
          <div><span>Tuition / yr</span><b>${rm(r, r.f)}</b></div>
          <div><span>Living / yr</span><b>${rm(r, r.l)}</b></div>
          <div><span>Scholarship</span><b>${r.s ? rm(r, r.s) : "—"}</b></div>
          <div class="tot"><span>Total year 1</span><b>~${rm(r, r.n)}</b></div>
          ${d != null ? `<div class="${d > 0 ? "short" : "ok"}"><span>Your work</span><b>${d > 0 ? `Short ~${rm(r, r100(d))}/yr` : "Covers it"}</b></div>` : ""}
        </div>
        ${r.en ? `<p class="pr-line"><b>Entry:</b> ${esc(r.en)}</p>` : ""}
        ${ds.length ? `<p class="pr-line"><b>Dates:</b> ${ds.map(([f, l]) => `${l} <b>${fmtDate(e.d[f])}</b>`).join(" &nbsp;·&nbsp; ")}</p>` : ""}
        <div class="pr-docs"><div class="pr-docs-h"><b>Documents</b><span>${done} of ${docs.length} ready</span><i style="--p:${Math.round(done / docs.length * 100)}%"></i></div>
          <ul>${docs.map(([id, l]) => `<li class="${e.docs?.[id] ? "on" : ""}">${l}</li>`).join("")}</ul></div>
        ${S.notes[k] ? `<div class="pr-note"><b>Notes</b><p>${esc(S.notes[k]).replace(/\n/g, "<br>")}</p></div>` : ""}
      </article>`; }).join("")}</section>
    <footer class="pr-foot">First-year estimates from Uni Map, ${today}. Fees, deadlines and requirements change — confirm each one with the university.</footer>`;
  window.print();
}

/* shortlist tool buttons and card actions */
$("cmpBtn").addEventListener("click", () => { renderCompare(); $("cmpDlg").showModal(); });
$("icsBtn").addEventListener("click", downloadICS);
$("shareBtn").addEventListener("click", shareLink);
$("printBtn").addEventListener("click", printShortlist);
document.addEventListener("click", e => {
  const f = e.target.closest("[data-funds]"), rp = e.target.closest("[data-report]"), x = e.target.closest("[data-close]");
  if (f) openFunds(f.dataset.funds);
  else if (rp) openReport(rp.dataset.report);
  else if (x) x.closest("dialog")?.close();
});
["cmpDlg", "fundsDlg", "reportDlg", "sharedDlg"].forEach(id => $(id).addEventListener("click", e => { if (e.target === $(id)) $(id).close(); }));
$("fundsDlg").addEventListener("close", () => { if ($("shortDlg").open) renderShortlist(); else if (openUni) renderCard(openUni, false); });

/* entry requirements vs your grade and IELTS */
function entryReq(r) {
  const t = r.en || "";
  // the lowest class mentioned (e.g. "2:1, or 2:2 with experience" → 2:2)
  const cls = /\b2:2\b|lower second/i.test(t) ? "2:2" : /\b2:1\b|upper second/i.test(t) ? "2:1" : /first[- ]class/i.test(t) ? "1st" : null;
  const m = t.match(/IELTS[^0-9;]{0,25}(\d(?:\.\d)?)/i);
  const b = t.match(/no (?:band|component|element|skill|sub-?score)s?[^0-9;]{0,20}(?:below|less than|under|lower than)\s*(\d(?:\.\d)?)/i) || t.match(/(\d\.\d)\s*in (?:each|all|every)/i);
  return { cls, ielts: m ? +m[1] : null, band: b ? +b[1] : null };
}
function entryCheck(r) {
  const q = entryReq(r), g = S.grade || {}, cls = myClass(), fail = [], pass = [];
  if (q.cls && cls) (CLS_RANK[cls] >= CLS_RANK[q.cls] ? pass : fail).push(`needs a ${q.cls}${CLS_RANK[cls] < CLS_RANK[q.cls] ? ` (you ≈ ${cls === "3rd" ? "below 2:2" : cls})` : ""}`);
  const m = myEng(), you = v => m.test === "ielts" ? `you ${v}` : `you ≈ ${v.toFixed(1)}`;
  if (q.ielts && m.overall) (m.overall >= q.ielts ? pass : fail).push(`IELTS ${q.ielts}${m.overall < q.ielts ? ` (${you(m.overall)})` : ""}`);
  if (q.band && m.low) (m.low >= q.band ? pass : fail).push(`${q.band} in each band${m.low < q.band ? ` (${you(m.low)})` : ""}`);
  const listed = q.cls || q.ielts;
  return { q, fail, pass, state: fail.length ? "no" : pass.length ? "ok" : listed ? "add" : "none" };
}
function entryBadge(r) {
  const c = entryCheck(r);
  const moi = S.grade.more?.moi && c.fail.some(f => /IELTS|band/.test(f)) ? `<span class="ent add">Your English-medium degree may be accepted instead — ask the university</span>` : "";
  return c.state === "ok" ? `<span class="ent ok">✓ You meet the listed entry</span>` : c.state === "no" ? `<span class="ent no">✗ ${esc(c.fail.join(" · "))}</span>${moi}`
    : c.state === "add" ? `<button type="button" class="ent add link-btn" data-edu>Add your degree &amp; English test to check</button>` : "";
}
/* My education: bachelor's (university, subject, pass-out year, result) and English test (overall + each skill).
   TOEFL iBT, PTE Academic and Duolingo are compared as an approximate IELTS score (published concordance tables:
   ETS for TOEFL, Pearson for PTE, Duolingo's own), since courses list IELTS. */
const SK4 = ["Listening", "Reading", "Writing", "Speaking"];
const ENG = {
  ielts: { name: "IELTS", max: 9, step: 0.5, skills: SK4, ph: ["6.5", "6.0"] },
  toefl: { name: "TOEFL iBT", max: 120, skMax: 30, step: 1, skills: SK4, ph: ["90", "22"],
           o: [[118, 9], [115, 8.5], [110, 8], [102, 7.5], [94, 7], [79, 6.5], [60, 6], [46, 5.5], [35, 5], [32, 4.5]],
           l: [[29, 8.5], [27, 8], [24, 7.5], [21, 7], [18, 6.5], [16, 6], [13, 5.5], [10, 5]] },
  pte:   { name: "PTE Academic", max: 90, step: 1, skills: SK4, ph: ["65", "60"],
           o: [[84, 8.5], [79, 8], [73, 7.5], [65, 7], [58, 6.5], [50, 6], [42, 5.5], [36, 5], [30, 4.5]] },
  duo:   { name: "Duolingo", max: 160, step: 5, skills: ["Literacy", "Comprehension", "Conversation", "Production"], ph: ["125", "120"],
           o: [[160, 8.5], [155, 8], [145, 7.5], [135, 7], [125, 6.5], [115, 6], [105, 5.5], [95, 5]] },
};
// Older saves: IELTS only (ielts / band), a single "lowest" score, a typed-in gap, no grading picked.
if (!S.grade.eng || typeof S.grade.eng !== "object") S.grade.eng = { test: "ielts", overall: S.grade.ielts || "", low: S.grade.band || "" };
if (!S.grade.eng.s || typeof S.grade.eng.s !== "object") S.grade.eng.s = {};
if (!S.grade.type) S.grade.type = "pct";
delete S.grade.ielts; delete S.grade.band; delete S.grade.gap;
const myEng = () => {
  const e = S.grade.eng, test = e.test in ENG ? e.test : "ielts", T = ENG[test];
  const conv = (v, sk) => { if (!(+v)) return null; if (test === "ielts") return +v; const hit = ((sk && T.l) || T.o).find(([sc]) => +v >= sc); return hit ? hit[1] : 4; };
  const skills = Object.values(e.s || {}).filter(v => +v > 0).map(Number);
  const lowRaw = skills.length ? Math.min(...skills) : +e.low || null;   // the weakest skill
  return { T, test, overall: conv(e.overall), low: conv(lowRaw, true), lowRaw, raw: e };
};
function gapYears() { const y = +S.grade.year; return y >= 1990 && y <= new Date().getFullYear() ? new Date().getFullYear() - y : null; }
function syncEduForm() {
  const g = S.grade, e = g.eng, test = e.test in ENG ? e.test : "ielts", T = ENG[test];
  if (document.activeElement !== $("gSubj")) $("gSubj").value = g.subj || "";
  if (document.activeElement !== $("gYear")) $("gYear").value = g.year || "";
  const gap = gapYears(); $("gGapOut").textContent = gap == null ? "—" : gap === 0 ? "Graduating / graduated this year" : `${gap} year${gap === 1 ? "" : "s"} (since ${g.year})`;
  $("gTest").value = test;
  $("gEng").max = T.max; $("gEng").step = T.step; $("gEng").placeholder = "e.g. " + T.ph[0];
  if (document.activeElement !== $("gEng")) $("gEng").value = e.overall || "";
  // one box per skill (rebuilt when the test changes)
  if ($("gSkills").dataset.test !== test) {
    $("gSkills").dataset.test = test;
    $("gSkills").innerHTML = T.skills.map((l, k) => `<div class="field"><label for="gSk${k}">${l}</label><input id="gSk${k}" data-skill="${k}" type="number" inputmode="decimal" min="0" max="${T.skMax || T.max}" step="${T.step}" placeholder="${T.ph[1]}"></div>`).join("");
  }
  $("gSkills").querySelectorAll("input").forEach(i => { if (document.activeElement !== i) i.value = e.s?.[i.dataset.skill] ?? ""; });
  const m = myEng(), out = $("engOut");
  out.hidden = !m.overall && !m.low;
  if (!out.hidden) out.innerHTML = test === "ielts"
    ? `<div class="go-main"><span class="go-k">IELTS</span><b class="go-cls">${m.overall ? m.overall.toFixed(1) : "—"}${m.low ? ` <small>(lowest ${m.low.toFixed(1)})</small>` : ""}</b></div>`
    : `<div class="go-main"><span class="go-k">≈ IELTS</span><b class="go-cls">${m.overall ? m.overall.toFixed(1) : "—"}${m.low ? ` <small>(lowest ≈ ${m.low.toFixed(1)})</small>` : ""}</b></div>
       <p class="go-sub">Approximate, from published ${esc(T.name)} to IELTS tables — used to check courses that list IELTS. Universities set their own ${esc(T.name)} scores.</p>`;
}
$("gSubj").addEventListener("input", e => { S.grade.subj = e.target.value.slice(0, 80); save(); syncEduHint(); });
$("gYear").addEventListener("input", e => { S.grade.year = e.target.value; syncEduForm(); gradeChanged(); });
$("gTest").addEventListener("input", e => { S.grade.eng = { test: e.target.value, overall: "", s: {} }; syncEduForm(); gradeChanged(); });
$("gEng").addEventListener("input", e => { S.grade.eng.overall = e.target.value; syncEduForm(); gradeChanged(); });
$("gSkills").addEventListener("input", e => { const k = e.target.dataset.skill; if (k == null) return; S.grade.eng.s = { ...S.grade.eng.s, [k]: e.target.value }; if (e.target.value === "") delete S.grade.eng.s[k]; delete S.grade.eng.low; syncEduForm(); gradeChanged(); });
// The other details (college, +2, work experience, test date, notes…) are stored as S.grade.more[path].
if (!S.grade.more || typeof S.grade.more !== "object") S.grade.more = {};
const edGet = p => p.split(".").reduce((o, k) => o?.[k], S.grade.more);
function edSet(p, v) { const ks = p.split("."), last = ks.pop(); let o = S.grade.more; for (const k of ks) o = o[k] = (o[k] && typeof o[k] === "object") ? o[k] : {}; if (v === "" || v === false) delete o[last]; else o[last] = v; }
function syncEdMore() {
  $("gradeBox").querySelectorAll("[data-ed]").forEach(i => { if (document.activeElement === i) return; const v = edGet(i.dataset.ed); if (i.type === "checkbox") i.checked = !!v; else i.value = v ?? ""; });
  // English test results are valid for 2 years.
  const d = edGet("engDate"), out = $("gEngValid");
  if (!d) { out.textContent = "—"; out.className = "gap-out"; return; }
  const [y, m, dd] = d.split("-").map(Number), untilIso = `${y + 2}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;   // same day, 2 years on
  const left = daysTo(untilIso);
  out.textContent = left < 0 ? `Expired ${fmtDate(untilIso)}` : fmtDate(untilIso) + (left < 180 ? ` (${left} days)` : "");
  out.className = "gap-out" + (left < 0 ? " bad" : left < 180 ? " warn" : "");
}
/* work experience: any number of jobs, S.grade.more.jobs = [{ role, field, org, yrs }] (older saves had one "work") */
if (!Array.isArray(S.grade.more.jobs)) S.grade.more.jobs = S.grade.more.work && Object.keys(S.grade.more.work).length ? [S.grade.more.work] : [];
delete S.grade.more.work;
const MAX_EDJOBS = 10;
function workYears() { return (S.grade.more?.jobs || []).reduce((a, j) => a + (+j.yrs || 0), 0); }   // also used by the grade note at load
function renderEdJobs() {
  const jobs = S.grade.more.jobs;
  $("gJobs").innerHTML = jobs.length ? jobs.map((j, k) => `<div class="ed-job" data-k="${k}">
      <div class="field"><label for="gJr${k}">Role</label><input id="gJr${k}" type="search" data-job="role" maxlength="80" value="${esc(j.role || "")}" placeholder="e.g. Software developer" autocomplete="off"></div>
      <div class="field"><label for="gJf${k}">Field</label><input id="gJf${k}" type="search" data-job="field" maxlength="80" value="${esc(j.field || "")}" placeholder="e.g. IT, banking, NGO" autocomplete="off"></div>
      <div class="field"><label for="gJo${k}">Organisation <i class="opt">optional</i></label><input id="gJo${k}" type="search" data-job="org" maxlength="100" value="${esc(j.org || "")}" autocomplete="off"></div>
      <div class="field"><label for="gJy${k}">Years</label><input id="gJy${k}" type="number" data-job="yrs" inputmode="decimal" min="0" max="40" step="0.5" value="${esc(j.yrs || "")}" placeholder="0"></div>
      <button type="button" class="rm-job" data-rmjob="${k}" aria-label="Remove ${esc(j.role || "job " + (k + 1))}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>
    </div>`).join("") + (jobs.length > 1 ? `<p class="ed-total">${workYears()} year${workYears() === 1 ? "" : "s"} of work experience in total</p>` : "")
    : `<p class="ed-empty">No work experience added.</p>`;
  $("gJobAdd").disabled = jobs.length >= MAX_EDJOBS;
}
$("gJobs").addEventListener("input", e => {
  const i = e.target.closest("[data-job]"); if (!i) return;
  const j = S.grade.more.jobs[+i.closest(".ed-job").dataset.k], f = i.dataset.job;
  if (i.value === "") delete j[f]; else j[f] = i.value.slice(0, +i.maxLength > 0 ? +i.maxLength : 100);
  if (f === "yrs") { const t = $("gJobs").querySelector(".ed-total"); if (t) t.textContent = `${workYears()} year${workYears() === 1 ? "" : "s"} of work experience in total`; gradeChanged(); } else save();
});
$("gJobs").addEventListener("click", e => {
  const b = e.target.closest("[data-rmjob]"); if (!b) return;
  S.grade.more.jobs.splice(+b.dataset.rmjob, 1); renderEdJobs(); gradeChanged(); $("gJobAdd").focus();
});
$("gJobAdd").addEventListener("click", () => {
  if (S.grade.more.jobs.length >= MAX_EDJOBS) return;
  S.grade.more.jobs.push({}); renderEdJobs(); save();
  $("gJobs").querySelector(`.ed-job[data-k="${S.grade.more.jobs.length - 1}"] input`)?.focus();
});
renderEdJobs();
$("gradeBox").addEventListener("input", e => {
  const i = e.target.closest("[data-ed]"); if (!i) return;
  edSet(i.dataset.ed, i.type === "checkbox" ? i.checked : i.value.slice(0, +i.maxLength > 0 ? +i.maxLength : 1500));
  syncEdMore(); if (i.dataset.ed === "moi") gradeChanged(); else save();
});
syncEduForm(); syncGradeForm(); syncEdMore();
// Filters panel: what's filled in, with a link to My education.
function syncEduHint() {
  const cls = myClass(), m = myEng(), parts = [];
  if (S.grade.subj) parts.push(esc(S.grade.subj));
  if (cls) parts.push(cls === "3rd" ? "below 2:2" : cls);
  else if (SEL.includes("de") && germanGrade(S.grade) != null) parts.push("grade " + germanGrade(S.grade).toFixed(1));
  if (m.overall) parts.push(`${m.T.name} ${esc(m.raw.overall)}`);
  $("eduSum").innerHTML = parts.length ? "· " + parts.join(" · ") : "";
  $("eduHint").classList.toggle("set", parts.length > 0);
  $("eduHint").querySelector(".eh-t").textContent = parts.length ? "Used for scholarship and entry suggestions." : "Add your degree and English test in My education for more accurate scholarship and entry suggestions.";
  $("eduHint").querySelector("button").textContent = parts.length ? "Edit My education →" : "Open My education →";
}
// "My education" (top bar, filters panel, course cards) opens the window.
document.addEventListener("click", e => { if (!e.target.closest("[data-edu]")) return; e.preventDefault(); document.querySelectorAll("dialog[open]").forEach(d => d.close()); $("eduDlg").showModal(); });
$("eduDlg").addEventListener("click", e => { if (e.target === $("eduDlg")) $("eduDlg").close(); });
$("f-entry").addEventListener("input", () => update());
syncEduHint();

// A banner with a closing date stops showing after it.
if ($("alert").dataset.until && Date.now() > Date.parse($("alert").dataset.until)) $("alert").hidden = true;

function update(opts = {}) {
  syncLv();
  syncSubj();
  $("maxv").textContent = money(+$("maxcost").value);
  const nf = activeFilterCount(); $("fCount").hidden = !nf; $("fCount").textContent = nf;
  fillRanges();
  LIST = filtered();
  $("vtCount").textContent = LIST.length;
  refreshMarkers();
  if (opts.fit) applyCityOnMap();
  if (openUni) renderCard(openUni, false);
  renderTable();
  syncShortBtn();
}

update();
startMap();
loadSharedFees().then(ok => { if (!ok || refreshing) return; saveLive(); applyLive(); fitMaxCost(); update(); syncLiveBar(); });
loadRates();
openShared(); addEventListener("hashchange", openShared);
})();
