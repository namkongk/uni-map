/* Uni Map — app logic. No build step; plain browser JS. */
(() => {
"use strict";

const CFG = window.APP_CONFIG || {};
const { rows: ROWS, unis: UNIS, cities: CITY } = window.UNIDATA;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------------- country + display currency ---------------- */
// Course data is stored in the selected country's own currency; yearly amounts can be shown in another one.
// Hourly pay stays in the local currency because that's what jobs in that country pay in.
const COUNTRY = { code: "uk", name: "UK", cur: "GBP" };
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
const fxRate = () => (FX.rates[S.cur] ?? NaN) / FX.rates[COUNTRY.cur];
const curCode = () => isFinite(fxRate()) ? S.cur : COUNTRY.cur;
const toCur = n => { const k = fxRate(); return isFinite(k) ? n * k : n; };
// Converted figures are estimates anyway, so round them to tidy steps.
function money(n) {
  const code = curCode(), c = CUR[code];
  let v = toCur(n);
  if (code !== COUNTRY.cur) { const a = Math.abs(v); v = Math.round(v / (a >= 1e6 ? 1000 : a >= 1e4 ? 100 : 10)) * (a >= 1e6 ? 1000 : a >= 1e4 ? 100 : 10); }
  v = Math.round(v);
  return (v < 0 ? "−" : "") + c.sym + Math.abs(v).toLocaleString(c.grp || "en-GB");
}
const r100 = n => Math.round(n / 100) * 100;
const PNAME = { CS: "Computer Science", AI: "AI", HCI: "HCI / UX", HM: "Health & public health", NUR: "Nursing" };
const PA = 12570, DED = 0.28; // personal allowance; 20% income tax + 8% NI above it

ROWS.forEach((r, i) => { r.id = i; r.f0 = r.f; r.fn0 = r.fn; r.s0 = r.s; r.sl0 = r.sl; });

/* ---------------- state ---------------- */
const MOBILE = matchMedia("(max-width:760px)").matches;
const GLASS_DEF = { theme: "auto", glassT: 45, glassBlur: 22 };
const newJob = (o = {}) => ({ name: "", rate: 12.71, hrs: 20, wks: 52, ...o });
const DEF = { lv: "ALL", subj: "ALL", dep: 50, jobs: [newJob()], sortK: "n", dir: 1, cur: COUNTRY.cur, grade: { uni: "", years: "4", type: "", val: "" }, budgetOpen: !MOBILE, filtersOpen: !MOBILE, alert: true, ...GLASS_DEF };
let S = { ...DEF, colf: {} };
try { Object.assign(S, JSON.parse(localStorage.getItem("ukmap-state") || "{}"), { colf: {} }); } catch (e) {}
// Older saves had a single rate / hours / weeks — turn that into the first job.
if (!Array.isArray(S.jobs) || !S.jobs.length || S.jobs === DEF.jobs) S.jobs = [newJob("rate" in S ? { rate: +S.rate || 0, hrs: +S.hrs || 0, wks: +S.wks || 0 } : {})];
delete S.rate; delete S.hrs; delete S.wks;
const save = () => { try { const { colf, ...rest } = S; localStorage.setItem("ukmap-state", JSON.stringify(rest)); } catch (e) {} };
const rowRate = {};

/* ---------------- finance ---------------- */
// Work is a list of jobs, each with its own £/hr, hours/week and weeks/year; earnings add up across jobs.
const clamp = (v, max) => Math.min(max, Math.max(0, +v || 0));
const jobHours = j => clamp(j.hrs, 168) * clamp(j.wks, 52);
const jobGross = j => clamp(j.rate, 1000) * jobHours(j);
const hours = () => S.jobs.reduce((a, j) => a + jobHours(j), 0);          // total hours / year
const grossAll = () => S.jobs.reduce((a, j) => a + jobGross(j), 0);
const avgRate = () => hours() ? grossAll() / hours() : 0;                 // blended £/hr across all jobs
const weekHrs = () => S.jobs.reduce((a, j) => a + clamp(j.hrs, 168), 0);
const takeHome = rate => { const g = rate * hours(); return g - DED * Math.max(0, g - PA); };
const netFee = r => Math.max(0, r.f - r.s);
const dep = r => Math.min(100, Math.max(0, +S.dep || 0)) / 100 * netFee(r);
const remFee = r => netFee(r) - dep(r);
const need = r => remFee(r) + r.l;
const needHr = r => { const q = need(r), H = hours(); if (!H) return Infinity; const g = q <= PA ? q : (q - DED * PA) / (1 - DED); return g / H; };
const rateOf = r => rowRate[r.id] ?? avgRate();
const deficit = r => need(r) - takeHome(rateOf(r));
const defText = d => d > 0 ? "~" + money(r100(d)) : "Covered" + (d < 0 ? " (+" + money(r100(-d)) + ")" : "");

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
    r.f = r.f0; r.fn = r.fn0; r.live = null;
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

/* ---------------- columns (all from the previous table + level + remaining fee + map) ---------------- */
const COLS = [
  { k: "lv", h: "Level", type: "text", get: r => r.lv },
  { k: "g", h: "Subject", type: "text", get: r => r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g] },
  { k: "u", h: "University", type: "text", get: r => r.u + " " + r.c },
  { k: "uk", h: "UK rank<br>(CUG 2027)", type: "num", get: r => r.uk ?? 99999, disp: r => rankText(r.uk, r) },
  { k: "qs", h: "World rank<br>(QS 2027)", type: "num", get: r => r.qss ?? 99999, disp: r => rankText(r.qs, r) },
  { k: "p", h: "Programme", type: "text", get: r => r.p },
  { k: "i", h: "Intakes", type: "text", get: r => r.i },
  { k: "f", h: "Tuition / yr<br>(intl)", type: "num", get: r => r.f, money: true },
  { k: "l", h: "Living / yr", type: "num", get: r => r.l, money: true },
  { k: "t", h: "Total yr 1", type: "num", get: r => r.t, money: true },
  { k: "s", h: "Sure scholarship<br>(automatic)", type: "num", get: r => r.s, money: true },
  { k: "n", h: "Total with sure<br>scholarship", type: "num", get: r => r.n, money: true },
  { k: "dep", h: "Pre-CAS deposit", type: "num", get: dep, dyn: () => `Pre-CAS deposit<br>(${+S.dep || 0}% tuition)`, money: true },
  { k: "rem", h: "Remaining fee<br>(after deposit)", type: "num", get: remFee, money: true },
  { k: "hr", h: "Pay needed / hr<br>(fee + living)", type: "num", get: needHr },
  { k: "rt", h: `Your avg rate<br>${LSYM}/hr`, type: "num", get: rateOf },
  { k: "df", h: "Deficit / yr<br>(− = surplus)", type: "num", get: deficit, money: true },
  { k: "aw", h: "Scholarships<br>for you", type: "text", get: r => awardsText(r) },
  { k: "o", h: "Other scholarships<br>(competitive)", type: "text", get: r => otherSch(r) },
  { k: "pl", h: "Placement", type: "text", get: r => r.pl },
  { k: "fl", h: "Warnings", type: "text", get: r => r.fl || "" },
  { k: "map", h: "Map", type: "none", get: () => "" },
];
// Universities added later (nr) haven't had their league-table positions checked yet.
const rankText = (v, r) => v ?? (r.nr ? "Not checked" : "Unranked");
// Small note under a tuition figure: live source link, or why the stored figure is still shown.
function feeNote(r) {
  const st = liveStatus(r), x = r.url && LIVE.res[r.url];
  if (r.live) return `<a class="sub live" href="${esc(x.src || r.url)}" target="_blank" rel="noopener" title="${esc(x.ctx || "")}">${esc(r.fn)}${r.f !== r.f0 ? ` · was ${money(r.f0)}` : ""} ↗</a>`;
  if (st === "mismatch") return `<span class="sub warn" title="${esc(x.ctx || "")}">${esc(r.fn)}${r.fn ? " · " : ""}page shows ${money(x.fee)} — check</span>`;
  return r.fn ? `<span class="sub">${esc(r.fn)}</span>` : "";
}
// Plain text (for filtering/sorting) and HTML (for the table) of the scholarships matched to a course.
function awardsText(r) {
  const A = awardsFor(r); if (r.lv !== "Masters") return "";
  return [...(r.s0 && !A.sure.some(a => a.amt >= r.s0) ? [money(r.s0) + " " + (r.sl0 || "")] : []), ...A.sure.map(a => a.amtText + " " + a.name), ...A.grade.map(a => a.amtText + " if " + a.min), ...A.apply.map(a => a.name), ...A.early.map(a => a.name)].join(" · ");
}
function awardsCell(r) {
  if (r.lv !== "Masters") return `<span class="muted">—</span>`;
  const A = awardsFor(r), cls = myClass(), out = [];
  // A scholarship already in the built-in data (and not beaten by a newer award) still counts.
  if (r.s0 && !A.sure.some(a => a.amt >= r.s0)) out.push(`<span class="awc ok">✓ ${money(r.s0)} <small>${esc(r.sl0 || "Built-in scholarship")}</small></span>`);
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
  const max = +$("maxcost").value, city = $("city").value, rank = $("rank").value, rad = +$("radius").value || 0;
  return ROWS.filter(r => {
    if (S.lv !== "ALL" && r.lv !== S.lv) return false;
    if (S.subj !== "ALL" && !r.subj.includes(S.subj)) return false;
    if (r.n > max) return false;
    if (city) { if (rad > 0 ? uniKm(r.u, city) > rad : r.c !== city) return false; }
    if (rank === "ranked" && r.qs == null) return false;
    if (rank && rank !== "ranked" && !(r.qss <= +rank)) return false;
    if ($("f-sure").checked && !r.s) return false;
    if ($("f-place").checked && !r.pl.startsWith("Yes")) return false;
    if ($("f-jan").checked && !/Jan|Feb|Mar|Apr|May|Jun|Jul|Nov/.test(r.i)) return false;
    if ($("f-london").checked && r.c === "London") return false;
    if ($("f-noflag").checked && r.fl) return false;
    if ($("f-noest").checked && /est/.test(r.fn)) return false;
    if (q && ![r.u, r.c, r.p, r.i, r.sl, otherSch(r), r.pl, r.fl, r.lv, PNAME[r.g], r.en].join(" ").toLowerCase().includes(q)) return false;
    for (const c of COLS) {
      const f = S.colf[c.k]; if (!f || c.type === "none") continue;
      if (c.type === "num") {
        const ok = numMatch(c.money ? toCur(c.get(r)) : c.get(r), f); // money filters are typed in the display currency
        if (ok === null) { if (!String(c.disp ? c.disp(r) : c.get(r)).toLowerCase().includes(f.toLowerCase())) return false; }
        else if (!ok) return false;
      } else if (!String(c.get(r)).toLowerCase().includes(f.toLowerCase())) return false;
    }
    return true;
  });
}

/* ---------------- header controls ---------------- */
$("lv").addEventListener("input", () => { S.lv = $("lv").value; save(); update(); });
$("subj").addEventListener("input", () => { S.subj = $("subj").value; save(); update(); });
Object.keys(CITY).sort().forEach(c => { const o = document.createElement("option"); o.value = o.textContent = c; $("city").appendChild(o); });
function fitMaxCost() {
  const el = $("maxcost"), atMax = el.value === el.max;
  el.max = Math.ceil(Math.max(...ROWS.map(r => r.n)) / 1000) * 1000;
  if (atMax) el.value = el.max;
}
fitMaxCost(); $("maxcost").value = $("maxcost").max;
["q", "maxcost", "city", "radius", "rank", "f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest"].forEach(id => $(id).addEventListener("input", () => update({ fit: ["city", "radius"].includes(id) })));
$("reset").addEventListener("click", () => {
  $("q").value = ""; $("maxcost").value = $("maxcost").max; $("city").value = ""; $("radius").value = ""; $("rank").value = "";
  ["f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest"].forEach(id => $(id).checked = false);
  document.querySelectorAll("#frow input").forEach(i => i.value = ""); S.colf = {};
  S.lv = "ALL"; S.subj = "ALL"; S.sortK = "n"; S.dir = 1; save(); update({ fit: true });
});
if (!S.alert) $("alert").hidden = true;
$("alertX").addEventListener("click", () => { $("alert").hidden = true; S.alert = false; save(); });

/* ---------------- floating filter card ---------------- */
// On phones the cards stack at the bottom of the screen, so only one is open at a time.
$("filtersToggle").addEventListener("click", () => { S.filtersOpen = !S.filtersOpen; if (MOBILE && S.filtersOpen) { S.budgetOpen = false; applyBudget(); } save(); applyFilters(); });
const applyFilters = () => { $("filtersToggle").setAttribute("aria-expanded", String(S.filtersOpen)); $("filtersBody").hidden = !S.filtersOpen; };
applyFilters();
function activeFilterCount() {
  let n = ["q", "city", "rank"].filter(id => $(id).value.trim()).length;
  n += ["f-sure", "f-place", "f-jan", "f-london", "f-noflag", "f-noest"].filter(id => $(id).checked).length;
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
function syncGradeOut() {
  const g = S.grade, cls = ukClassOf(g), out = $("gradeOut");
  out.hidden = !cls;
  if (!cls) return;
  const what = g.type === "pct" ? `${g.val}%` : g.type === "gpa" ? `CGPA ${g.val}` : g.type === "letter" ? `grade ${g.val}` : $("gVal").selectedOptions?.[0]?.textContent;
  const notes = [];
  if (g.type === "div" && g.val === "first") notes.push("First Division can be a 2:1 at 65%+ — enter your percentage for a more exact result.");
  if (g.years === "3") notes.push("From a 3-year degree. Some universities (e.g. Edinburgh, QUB, Westminster, UCLan) need a 4-year bachelor's or a master's.");
  if (cls === "3rd") notes.push("Most UK master's ask for at least a 2:2 equivalent.");
  if (!g.uni && g.type === "pct") notes.push("Pick your university — Tribhuvan percentages convert more generously.");
  out.innerHTML = `<div class="go-main"><span class="go-k">UK equivalent</span><b class="go-cls cls-${cls.replace(":", "")}">${cls === "3rd" ? "Below 2:2" : cls}</b></div>
    <p class="go-sub">${esc(CLS_LABEL[cls])} · ${esc(what || "")}${g.uni ? " from " + esc(NEPAL_UNI[g.uni]) : ""}, ${g.years === "3" ? "3" : "4"}-year degree. Typical conversion — each university sets its own.</p>
    ${notes.map(n => `<p class="go-note">${esc(n)}</p>`).join("")}`;
}
function gradeChanged() { save(); syncGradeOut(); applyLive(); fitMaxCost(); update(); }
$("gUni").addEventListener("input", e => { S.grade.uni = e.target.value; gradeChanged(); });
$("gYears").addEventListener("input", e => { S.grade.years = e.target.value; gradeChanged(); });
$("gType").addEventListener("input", e => { S.grade.type = e.target.value; S.grade.val = ""; renderGradeInput(); gradeChanged(); });

/* ---------------- display currency ---------------- */
const FX_KEY = "ukmap-fx";
try { const c = JSON.parse(localStorage.getItem(FX_KEY) || "null"); if (c && c.rates && c.rates.GBP) FX = c; } catch (e) {}
if (!CUR[S.cur]) S.cur = COUNTRY.cur;
// Compact labels for the toolbar pill ("£ GBP (UK)", "Rs NPR"); full names go in each option's tooltip.
$("cur").innerHTML = [COUNTRY.cur, ...CUR_LIST.filter(k => k !== COUNTRY.cur)]
  .map(k => `<option value="${k}" title="${CUR[k].name}${k === COUNTRY.cur ? ` (${COUNTRY.name} currency)` : ""}">${CUR[k].sym.trim()} ${k}${k === COUNTRY.cur ? ` (${COUNTRY.name})` : ""}</option>`).join("");
function syncCurrency() {
  $("cur").value = S.cur;
  const when = new Date(FX.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  $("curPick").title = "Show prices in " + CUR[S.cur].name + ". " + (S.cur === COUNTRY.cur ? `Prices as published, in ${CUR[COUNTRY.cur].name}s.`
    : `${LSYM}1 = ${CUR[S.cur].sym}${fxRate().toFixed(fxRate() < 10 ? 4 : 2)} · rates of ${when}${FX.src === "live" ? "" : " (offline estimate)"}. Hourly pay stays in ${COUNTRY.cur}.`);
}
$("cur").addEventListener("input", () => { S.cur = $("cur").value; save(); syncCurrency(); syncFin(); update(); });
async function loadRates() {
  if (FX.src === "live" && Date.now() - Date.parse(FX.fetched) < 12 * 3600e3) return; // cached for 12 h
  try {
    const j = await (await fetch("https://open.er-api.com/v6/latest/GBP")).json();
    if (j.result !== "success" || !j.rates.NPR) throw new Error("bad rates");
    FX = { date: new Date(j.time_last_update_unix * 1000).toISOString(), fetched: new Date().toISOString(), src: "live", rates: j.rates };
    try { localStorage.setItem(FX_KEY, JSON.stringify(FX)); } catch (e) {}
    syncCurrency(); if (S.cur !== COUNTRY.cur) { syncFin(); update(); }
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
/* ---------------- country picker (UK only for now; others listed as coming soon) ---------------- */
const countryItems = () => [...$("countryMenu").querySelectorAll("button")];
function setCountryMenu(open) {
  const btn = $("countryBtn"), menu = $("countryMenu");
  menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  if (open) {
    const r = btn.getBoundingClientRect();
    menu.style.top = r.bottom + 10 + "px";
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.querySelector('[aria-checked="true"]').focus();
  }
}
$("countryBtn").addEventListener("click", e => { e.stopPropagation(); setCountryMenu($("countryMenu").hidden); });
$("countryMenu").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.getAttribute("aria-disabled") === "true") { b.classList.remove("nudge"); void b.offsetWidth; b.classList.add("nudge"); return; }
  setCountryMenu(false); $("countryBtn").focus();
});
$("countryMenu").addEventListener("keydown", e => {
  const items = countryItems(), i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  else if (e.key === "Tab") setCountryMenu(false);
});
document.addEventListener("pointerdown", e => { if (!$("countryMenu").hidden && !e.target.closest("#countryMenu, #countryBtn")) setCountryMenu(false); });

const setSettings = open => { $("settings").hidden = !open; $("settingsBtn").setAttribute("aria-expanded", String(open)); };
$("settingsBtn").addEventListener("click", e => { e.stopPropagation(); setSettings($("settings").hidden); });
document.addEventListener("pointerdown", e => { if (!$("settings").hidden && !e.target.closest("#settings, #settingsBtn")) setSettings(false); });
applyAppearance();

const syncHdr = () => document.documentElement.style.setProperty("--hdr", $("hdr").getBoundingClientRect().height + "px");
new ResizeObserver(syncHdr).observe($("hdr")); syncHdr();

/* ---------------- finance: deposit + jobs (budget panel + table view, kept in sync) ---------------- */
const MAX_JOBS = 8;
const FIN = [$("budgetBody"), $("finInline")];
FIN.forEach(el => { el.insertAdjacentHTML("afterbegin", `<div class="fin"></div>`); });
$("budgetBody").insertAdjacentHTML("beforeend", `
  <div class="legend">
    <span class="lg"><i class="ring-k" style="--pct:100%"></i>Green ring: your jobs cover remaining fee + living</span>
    <span class="lg"><i class="ring-k" style="--pct:0%"></i>Red ring: you'd be in deficit</span>
    <span class="lg"><i class="ring-k" style="--pct:40%"></i>Split ring: share of that university's courses covered</span>
    <span class="lg"><span class="cl-tally demo"><span class="t ok"><i></i>3</span><span class="t bad"><i></i>5</span></span>Groups: universities covered / in deficit</span>
  </div>
  <p class="howto">Deposit = % × (tuition − sure scholarship), paid before CAS from savings. Remaining fee + 12 months' living must come from work. Earnings from all jobs are added up; take-home is after 20% tax + 8% NI above £12,570. Visa cap: 20 h/week in term time (full-time allowed in official vacations). Number on pin = matching courses.</p>`);

const jobHTML = (j, i) => `
  <div class="job" data-i="${i}">
    <div class="job-top">
      <input class="job-name" data-f="name" value="${esc(j.name)}" placeholder="Job ${i + 1}" maxlength="40" aria-label="Job ${i + 1} name">
      <span class="job-out" data-out="gross${i}"></span>
      ${S.jobs.length > 1 ? `<button type="button" class="rm-job" data-rm="${i}" aria-label="Remove ${esc(j.name || "job " + (i + 1))}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>` : ""}
    </div>
    <div class="job-grid">
      <label><span>${LSYM} / hour</span><input type="number" data-f="rate" min="0" max="1000" step="0.01" value="${j.rate}"></label>
      <label><span>Hours / week</span><input type="number" data-f="hrs" min="0" max="168" step="0.5" value="${j.hrs}"></label>
      <label><span>Weeks / year</span><input type="number" data-f="wks" min="0" max="52" step="1" value="${j.wks}"></label>
    </div>
  </div>`;
function renderFin() {
  FIN.forEach(el => {
    el.querySelector(".fin").innerHTML = `
      <div class="field dep"><label for="dep-${el.id}">Pre-CAS deposit (% of tuition)</label><input type="number" id="dep-${el.id}" data-k="dep" min="0" max="100" step="5" value="${S.dep}"></div>
      <div class="jobs-h"><span>Jobs</span><button type="button" class="btn-plain sm add-job"${S.jobs.length >= MAX_JOBS ? " disabled" : ""}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Add job</button></div>
      <div class="jobs">${S.jobs.map(jobHTML).join("")}</div>
      <p class="visa-warn" data-out="warn" hidden></p>
      <div class="fin-out"><span class="k">Take-home / yr</span><b class="th"></b><span class="fin-sum" data-out="sum"></span></div>`;
  });
  syncFin();
}
// Refresh computed outputs, and copy values into the other copy of the form (never the field being typed in).
function syncFin(except) {
  FIN.forEach(el => el.querySelectorAll("input[data-k], input[data-f]").forEach(i => {
    if (i === except) return;
    const v = i.dataset.k ? S[i.dataset.k] : S.jobs[+i.closest(".job").dataset.i]?.[i.dataset.f];
    if (v !== undefined && String(v) !== i.value) i.value = v;
  }));
  const th = money(takeHome(avgRate())), wk = weekHrs();
  const sum = `${money(grossAll())} gross · avg ${LSYM}${avgRate().toFixed(2)}/hr · ${hours().toLocaleString("en-GB")} h/yr`;
  const warn = wk > 20 ? `If worked at the same time these jobs add up to ${wk} h/week. Student visas allow 20 h/week in term time; more only in official vacations — use weeks/year to model vacation-only work.` : "";
  document.querySelectorAll(".fin-out .th").forEach(b => b.textContent = th);
  document.querySelectorAll('[data-out="sum"]').forEach(b => b.textContent = sum);
  document.querySelectorAll('[data-out="warn"]').forEach(b => { b.hidden = !warn; b.textContent = warn; });
  S.jobs.forEach((j, i) => document.querySelectorAll(`[data-out="gross${i}"]`).forEach(b => b.textContent = money(jobGross(j)) + "/yr"));
  $("thMini").textContent = th + "/yr";
}
FIN.forEach(el => {
  el.addEventListener("input", e => {
    const i = e.target;
    if (i.dataset.k) S[i.dataset.k] = i.value === "" ? 0 : +i.value;
    else if (i.dataset.f) { const j = S.jobs[+i.closest(".job").dataset.i]; j[i.dataset.f] = i.dataset.f === "name" ? i.value : (i.value === "" ? 0 : +i.value); }
    else return;
    save(); syncFin(i); if (i.dataset.f !== "name") update();
  });
  el.addEventListener("click", e => {
    const add = e.target.closest(".add-job"), rm = e.target.closest(".rm-job");
    if (add && S.jobs.length < MAX_JOBS) {
      const last = S.jobs[S.jobs.length - 1];
      S.jobs.push(newJob({ rate: last ? last.rate : 12.71, hrs: 10, wks: last ? last.wks : 52 }));
      save(); renderFin(); update();
      el.querySelector(`.job[data-i="${S.jobs.length - 1}"] .job-name`)?.focus();
    } else if (rm) {
      S.jobs.splice(+rm.dataset.rm, 1);
      save(); renderFin(); update();
      el.querySelector(".add-job")?.focus();
    }
  });
});
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
  else if (!$("settings").hidden) { setSettings(false); $("settingsBtn").focus(); } else if (tableOpen) setView(false); else closeCard();
});

/* ---------------- table ---------------- */
const hrow = $("hrow"), frow = $("frow");
COLS.forEach(c => {
  const th = document.createElement("th"); th.dataset.k = c.k; th.scope = "col";
  if (c.type === "none") { th.innerHTML = `<button type="button" tabindex="-1"><span>${c.h}</span></button>`; }
  else {
    th.innerHTML = `<button type="button"><span class="lbl">${c.h}</span><span class="arr">↕</span></button>`;
    th.querySelector("button").addEventListener("click", () => {
      if (S.sortK === c.k) S.dir = -S.dir; else { S.sortK = c.k; S.dir = 1; }
      save(); renderTable();
    });
  }
  hrow.appendChild(th);
  const fth = document.createElement("th");
  if (c.type !== "none") {
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
  const col = COLS.find(c => c.k === S.sortK) || COLS[11];
  return list.slice().sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    const v = col.type === "num" ? x - y : String(x).localeCompare(String(y));
    return (v || (a.n - b.n)) * S.dir;
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
    return `<tr>
    <td>${r.lv}</td>
    <td>${r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g]}</td>
    <td class="uni"><b>${esc(r.u)}</b><span class="sub">${esc(r.c)}${city && r.c !== city ? ` · ${Math.round(uniKm(r.u, city))} km from ${esc(city)}` : ""}</span></td>
    <td class="num">${esc(rankText(r.uk, r))}</td>
    <td class="num">${esc(rankText(r.qs, r))}</td>
    <td>${esc(r.p)}</td>
    <td>${esc(r.i)}</td>
    <td class="num">~${money(r.f)}${feeNote(r)}</td>
    <td class="num">~${money(r.l)}</td>
    <td class="num">~${money(r.t)}</td>
    <td class="sure ${r.s ? "has" : ""}">${r.s ? `<b>${money(r.s)}</b><span class="sub" style="color:inherit">${esc(r.sl)}</span>` : "None confirmed"}</td>
    <td class="num net">~${money(r.n)}</td>
    <td class="num">~${money(Math.round(dep(r) / 50) * 50)}</td>
    <td class="num">~${money(Math.round(remFee(r) / 50) * 50)}</td>
    <td class="num hr ${h > 20 ? "hi" : ""}"><b>${LSYM}${isFinite(h) ? h.toFixed(2) : "—"}</b><span class="sub">needs ~${money(r100(need(r)))}/yr</span></td>
    <td class="rate"><input type="number" min="0" max="200" step="0.01" data-id="${r.id}" class="${r.id in rowRate ? "ovr" : ""}" value="${rateOf(r).toFixed(2)}" aria-label="Hourly rate for ${esc(r.u)}"></td>
    <td class="num def ${d > 0 ? "short" : "ok"}" data-def="${r.id}">${defText(d)}</td>
    <td class="aw">${awardsCell(r)}</td>
    <td>${esc(otherSch(r))}</td>
    <td class="pl ${r.pl.startsWith("Yes") ? "yes" : ""}">${esc(r.pl)}</td>
    <td class="fl ${r.fl ? "has" : ""}">${esc(r.fl || "")}</td>
    <td><button type="button" class="maplink" data-u="${esc(r.u)}">View on map</button></td>
  </tr>`; }).join("");
  $("empty").hidden = list.length > 0;
  const col = COLS.find(c => c.k === S.sortK);
  $("count").textContent = `${list.length} of ${ROWS.length} courses · ${new Set(list.map(r => r.u)).size} universities · sorted by ${(col.dyn ? col.dyn() : col.h).replace(/<br>/g, " ")} (${S.dir === 1 ? "low → high" : "high → low"})`;
  document.querySelector("#tbl").style.setProperty("--h1", hrow.getBoundingClientRect().height + "px");
}
$("tbody").addEventListener("input", e => {
  const inp = e.target.closest("td.rate input"); if (!inp) return;
  const id = +inp.dataset.id, r = ROWS[id];
  if (inp.value === "") delete rowRate[id]; else rowRate[id] = Math.max(0, +inp.value);
  inp.classList.toggle("ovr", id in rowRate);
  const td = document.querySelector(`td[data-def="${id}"]`), d = deficit(r);
  td.className = "num def " + (d > 0 ? "short" : "ok"); td.textContent = defText(d);
  refreshMarkers(); if (openUni === r.u) renderCard(r.u, false);
});
$("tbody").addEventListener("click", e => {
  const b = e.target.closest(".maplink"); if (!b) return;
  setView(false); openCard(b.dataset.u, true);
});
$("clearrates").addEventListener("click", () => { for (const k in rowRate) delete rowRate[k]; update(); });

/* ---------------- map groups ---------------- */
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
    (g.best > 0 ? ` (closest: short ${money(r100(g.best))}/yr)` : ` (best: ${money(r100(-g.best))}/yr spare)`);
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
const UK = { lat: 54.6, lng: -3.2 };
// Keep fitted areas clear of the floating toolbar and side cards.
const pad = () => ({ top: $("hdr").getBoundingClientRect().bottom + 16, left: MOBILE ? 16 : $("side").getBoundingClientRect().right + 16 });

const GoogleMap = {
  kind: "google",
  async init(el) {
    // Official Google Maps dynamic library loader
    ((g) => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key: CFG.GOOGLE_MAPS_API_KEY, v: "weekly", region: "GB" });
    const [{ Map, Circle }, { AdvancedMarkerElement }] = await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]);
    await loadScript("https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js");
    this.AME = AdvancedMarkerElement; this.Circle = Circle; this.GMap = Map; this.el = el;
    this.markers = [];
    this.build({ center: UK, zoom: 6 });
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
  reset() { this.map.panTo(UK); this.map.setZoom(6); },
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
    this.map = L.map(el, { zoomControl: false }).setView([UK.lat, UK.lng], 6);
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
  reset() { this.map.setView([UK.lat, UK.lng], 6); },
  async place() { return null; },
};

let MAP = null;
function status(msg) { const el = $("mapStatus"); el.hidden = !msg; el.innerHTML = msg || ""; }
async function startMap() {
  const el = $("map");
  if (CFG.GOOGLE_MAPS_API_KEY) {
    window.gm_authFailure = async () => { // invalid / restricted key → fall back so the site still works
      status("Google Maps key rejected — showing OpenStreetMap. Check the key and its allowed referrers (README).");
      MAP = LeafletMap; await MAP.init(el); refreshMarkers(); applyCityOnMap();
    };
    try { await GoogleMap.init(el); MAP = GoogleMap; onThemeChange = () => { if (MAP === GoogleMap) GoogleMap.setScheme(); }; }
    catch (e) { console.error(e); status("Google Maps failed to load — showing OpenStreetMap."); MAP = LeafletMap; await MAP.init(el); }
  } else {
    MAP = LeafletMap; await MAP.init(el);
    status("No Google Maps key set — add GOOGLE_MAPS_API_KEY to <b>.env</b> (or your Vercel settings) for Google photos &amp; reviews.");
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
      <div class="tags"><span class="tag ${r.lv === "PhD" ? "phd" : ""}">${r.lv}</span><span class="tag">${r.lv === "PhD" ? "CS / AI / HCI" : PNAME[r.g]}</span>${r.s ? `<span class="tag sure">Sure scholarship</span>` : ""}${r.pl.startsWith("Yes") ? `<span class="tag pl">Placement</span>` : ""}${r.fl ? `<span class="tag warn">${esc(r.fl)}</span>` : ""}</div>
      <b>${esc(r.p)}</b>
    </div>
    <div class="kv">
      ${r.en ? row("Entry", esc(r.en)) : ""}
      ${row("Intakes", esc(r.i))}
      ${row("Tuition / yr (intl)", `~${money(r.f)}${feeNote(r)}`)}
      ${row("Living / yr", "~" + money(r.l))}
      ${row("Total yr 1", "~" + money(r.t))}
      ${row("Sure scholarship", r.s ? `${money(r.s)}<span class="sub">${esc(r.sl)}</span>` : "None confirmed")}
      ${row("Total with sure scholarship", "~" + money(r.n))}
      ${row(`Pre-CAS deposit (${+S.dep || 0}%)`, "~" + money(Math.round(dep(r) / 50) * 50))}
      ${row("Remaining fee", "~" + money(Math.round(remFee(r) / 50) * 50))}
      ${row("Pay needed / hr", `${LSYM}${isFinite(h) ? h.toFixed(2) : "—"}<span class="sub">to earn ~${money(r100(need(r)))}/yr</span>`, h > 20 ? "hl" : "")}
      ${row(S.jobs.length > 1 ? "Your avg rate" : "Your rate", LSYM + rateOf(r).toFixed(2) + "/hr" + (r.id in rowRate ? "" : `<span class="sub">${S.jobs.length} job${S.jobs.length === 1 ? "" : "s"} · ${hours().toLocaleString("en-GB")} h/yr</span>`))}
      ${row("Deficit / yr", defText(d), d > 0 ? "hl" : "ok")}
      ${row("Placement", esc(r.pl))}
      <div class="full"><b>Other scholarships:</b> ${esc(otherSch(r))}</div>
      ${r.url ? `<div class="full"><a href="${esc(r.url)}" target="_blank" rel="noopener">Course page ↗</a>${courseCheck(r)}</div>` : ""}
      ${planRow(r)}
    </div>
  </article>`;
}
function courseCheck(r) {
  const x = LIVE.res[r.url];
  if (!x) return ` <span class="muted">· not checked yet — use Refresh fees</span>`;
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
function payHTML(u) {
  const P = UNIS[u].pay, when = window.UNIDATA.payChecked ? new Date(window.UNIDATA.payChecked).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  // Short badge: "Deposit £2,000", "Deposit from £1,000", "Deposit 50%" — the full wording is in the rows below.
  const dep = P && P.dep, money = dep && dep.match(/£[\d,]+/), pct = dep && dep.match(/\d+%/);
  const chip = !dep ? "" : /^£[\d,]+$/.test(dep) ? dep : money && (pct ? dep.indexOf(money[0]) < dep.indexOf(pct[0]) : true) ? `from ${money[0]}` : pct ? pct[0] : "";
  const head = `<summary><span class="pp-ico" aria-hidden="true">£</span><span>Paying your fees</span>${chip ? `<span class="pp-chip">Deposit ${esc(chip)}</span>` : ""}</summary>`;
  if (!P) return `<details class="pp" open>${head}<p class="pp-none">Deposit and installment rules aren't confirmed for this university yet — their pages couldn't be read automatically. Check their <a href="${esc(UNIS[u].web)}" target="_blank" rel="noopener">website ↗</a> or your offer letter.</p></details>`;
  const row = (k, v, cls = "") => v ? `<div class="pp-row ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>` : "";
  const sched = P.sched ? Object.entries(P.sched).map(([k, v]) => row(esc(k), esc(v), "sched")).join("") : "";
  return `<details class="pp" open>${head}<div class="pp-body">
    ${row("Minimum deposit<small>before your CAS</small>", P.dep ? esc(P.dep) + (P.depNote ? `<small>${esc(P.depNote)}</small>` : "") : `<span class="muted">Not stated on the pages read</span>`)}
    ${row("From Nepal", P.nepal ? esc(P.nepal) : "", "nepal")}
    ${row("Installments", P.plan ? esc(P.plan) + (P.n ? `<small>${esc(P.n)} payment${P.n === "1" ? "" : "s"} in total</small>` : "") : `<span class="muted">Not stated on the pages read</span>`)}
    ${sched || (P.plan ? row("Dates", `<span class="muted">Not published — given on your invoice</span>`) : "")}
    <p class="pp-src"><a href="${esc(P.src)}" target="_blank" rel="noopener">University's payment page ↗</a>${when ? ` · checked ${when}` : ""} · confirm with your offer letter</p>
  </div></details>`;
}
// Scholarships for this university, matched to your grade (if given) and to its courses.
function awardsHTML(u) {
  const rows = ROWS.filter(r => r.u === u && r.lv === "Masters"), list = UNIS[u].sch || [], cls = myClass();
  const when = window.UNIDATA.schChecked ? new Date(window.UNIDATA.schChecked).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const gradeChip = cls ? `<span class="pp-chip">Your grade ≈ ${cls === "3rd" ? "below 2:2" : cls}</span>` : "";
  const head = `<summary><span class="pp-ico aw-ico" aria-hidden="true">★</span><span>Scholarships for you</span>${gradeChip}</summary>`;
  if (!list.length) return `<details class="pp" open>${head}<p class="pp-none">No Nepal-specific or automatic scholarships found on this university's pages${rows.some(r => r.s0) ? " (the course card shows any built-in scholarship)" : ""}. Check their scholarships page and the competitive awards listed with each course.</p></details>`;
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
    <p class="pp-src">Automatic awards you qualify for are counted in each course's "Sure scholarship"${when ? ` · checked ${when}` : ""} · confirm terms with the university</p>
  </div></details>`;
}
function renderCard(u, withPlace) {
  const city = $("city").value, U = UNIS[u];
  const rs = LIST.filter(r => r.u === u);
  const any = rs.length ? rs : ROWS.filter(r => r.u === u);
  const f = any[0];
  $("cardTitle").textContent = u;
  $("cardSub").textContent = [U.c, f.uk ? `UK #${f.uk}` : f.nr ? "" : "UK unranked", f.qs ? `QS ${f.qs}` : f.nr ? "" : "QS unranked",
    city && U.c !== city ? `${Math.round(uniKm(u, city))} km from ${city}` : "", `${rs.length} matching course${rs.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  $("cardAwards").innerHTML = awardsHTML(u);
  $("cardPay").innerHTML = payHTML(u);
  $("cardCourses").innerHTML = (rs.length ? rs : []).sort((a, b) => a.n - b.n).map(courseHTML).join("") || `<p class="gp-empty">No courses here match the current filters.</p>`;
  if (withPlace) loadPlace(u);
}
const stars = n => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
async function loadPlace(u) {
  const box = $("gplace"), id = ++placeReq;
  const gmSearch = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(UNIS[u].q);
  if (!MAP || MAP.kind !== "google") {
    box.innerHTML = `<div class="gp-empty">Google photos &amp; reviews need a Google Maps API key (GOOGLE_MAPS_API_KEY).<br><a href="${gmSearch}" target="_blank" rel="noopener">Open ${esc(u)} in Google Maps ↗</a></div>`;
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
  const st = msg || (LIVE.checked ? `Live fees for ${ok} courses, checked ${fmtWhen(LIVE.checked)}` : "Showing built-in fees");
  $("liveStatus").textContent = st; // read by screen readers; sighted users get it on hover
  $("refreshBtn").title = `Refresh fees — re-read the international fee from each university's course page.\n${st}`;
  $("liveReportBtn").hidden = !LIVE.checked;
}
let refreshing = false;
async function refreshFees() {
  if (refreshing) return;
  refreshing = true; $("refreshBtn").disabled = true; $("refreshBtn").classList.add("spin");
  const res = {}, queue = SOURCE_UNIS.slice(); let done = 0, apiMissing = false;
  syncLiveBar(`Checking 0 / ${queue.length} universities…`);
  async function worker() {
    while (queue.length && !apiMissing) {
      const u = queue.shift();
      try {
        const rsp = await fetch("api/refresh?u=" + encodeURIComponent(u));
        if (!rsp.ok && !/json/.test(rsp.headers.get("content-type") || "")) { apiMissing = true; break; }
        const j = await rsp.json();
        (j.results || []).forEach(x => { res[x.url] = x; });
      } catch (e) { ROWS.filter(r => r.u === u && r.url).forEach(r => { res[r.url] = { url: r.url, ok: false, err: "Network error" }; }); }
      syncLiveBar(`Checking ${++done} / ${SOURCE_UNIS.length} universities…`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  refreshing = false; $("refreshBtn").disabled = false; $("refreshBtn").classList.remove("spin");
  if (apiMissing) {
    syncLiveBar();
    showReport("The refresh service isn't running here. Start the site with <code>npm run dev</code> (not a plain static server), or deploy it to Vercel — the <code>/api/refresh</code> function fetches the university pages.");
    return;
  }
  LIVE = { checked: new Date().toISOString(), res }; saveLive();
  applyLive(); fitMaxCost(); update(); syncLiveBar(); showReport();
}

function showReport(errorHTML) {
  const dlg = $("liveReport");
  if (errorHTML) { $("lrSummary").innerHTML = errorHTML; $("lrBody").innerHTML = ""; dlg.showModal(); return; }
  const rows = ROWS.filter(r => r.lv === "Masters").map(r => ({ r, st: liveStatus(r) }));
  const n = st => rows.filter(x => x.st === st).length;
  $("lrSummary").innerHTML = `Checked ${fmtWhen(LIVE.checked)}. <b>${n("updated")}</b> fees changed, <b>${n("same")}</b> unchanged, ` +
    `<b>${n("mismatch")}</b> need a manual check, <b>${n("unreadable")}</b> pages had no readable fee, and <b>${n("nosource")}</b> courses have no course page on record ` +
    `(mostly sites that block automated reading). Those keep the built-in figure.`;
  const ORDER = { updated: 0, mismatch: 1, unreadable: 2, same: 3, nosource: 4, unchecked: 5 };
  const LABEL = { updated: "Updated", same: "Unchanged", mismatch: "Needs check", unreadable: "Not readable", nosource: "No page on record", unchecked: "Not checked" };
  $("lrBody").innerHTML = rows.sort((a, b) => ORDER[a.st] - ORDER[b.st] || a.r.u.localeCompare(b.r.u)).map(({ r, st }) => {
    const x = r.url && LIVE.res[r.url];
    return `<tr class="st-${st}"><td><b>${esc(r.u)}</b><span class="sub">${esc(r.p)}</span></td>
      <td class="num">${money(r.f0)}</td><td class="num">${x && x.ok ? money(x.fee) : "—"}</td>
      <td>${LABEL[st]}${x && !x.ok ? `<span class="sub">${esc(x.err)}</span>` : ""}</td>
      <td>${r.url ? `<a href="${esc((x && x.src) || r.url)}" target="_blank" rel="noopener">Page ↗</a>` : ""}</td></tr>`;
  }).join("");
  dlg.showModal();
}
$("refreshBtn").addEventListener("click", refreshFees);
$("liveReportBtn").addEventListener("click", () => showReport());
$("lrClose").addEventListener("click", () => $("liveReport").close());
$("lrReset").addEventListener("click", () => {
  LIVE = { checked: null, res: {} }; try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
  applyLive(); fitMaxCost(); update(); syncLiveBar(); $("liveReport").close();
});
syncLiveBar();

/* ---------------- main update ---------------- */
function update(opts = {}) {
  $("lv").value = S.lv;
  $("subj").value = S.subj;
  $("maxv").textContent = money(+$("maxcost").value);
  const nf = activeFilterCount(); $("fCount").hidden = !nf; $("fCount").textContent = nf;
  fillRanges();
  LIST = filtered();
  $("vtCount").textContent = LIST.length;
  refreshMarkers();
  if (opts.fit) applyCityOnMap();
  if (openUni) renderCard(openUni, false);
  renderTable();
}

update();
startMap();
loadRates();
})();
