/* Uni Map — budget planner for students who are already enrolled.
   Month-by-month cash flow: savings + take-home pay − living costs − fee installments. Plain browser JS. */
(() => {
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => (v === "" || v == null || !isFinite(+v)) ? 0 : +v;
const gbp = n => (n < -0.5 ? "−£" : "£") + Math.abs(Math.round(n)).toLocaleString("en-GB");
const signed = n => (n >= 0.5 ? "+" : "") + gbp(n);

// UK take-home rules (same as the map's calculator): 20% income tax + 8% NI above the personal allowance.
const PA = 12570, DED = 0.28, WPM = 52 / 12, VISA_HRS = 20, MIN_WAGE = 12.71;

/* ---------------- months ---------------- */
const mIdx = s => { const [y, m] = String(s).split("-").map(Number); return y * 12 + (m - 1); };
const mStr = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
const mLabel = (i, long) => new Date(Math.floor(i / 12), i % 12, 1).toLocaleDateString("en-GB", { month: long ? "long" : "short", year: "numeric" });
const dLabel = s => new Date(s + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dParts = s => { const d = new Date(s + "T00:00"); return { mi: d.getFullYear() * 12 + d.getMonth(), day: d.getDate(), dim: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }; };
const now = new Date(), thisMonth = mStr(now.getFullYear() * 12 + now.getMonth());

/* ---------------- state ---------------- */
const KEY = "ukmap-plan";
const DEF_COSTS = [
  { label: "Rent", amount: 650, freq: "month" },
  { label: "Food & groceries", amount: 220, freq: "month" },
  { label: "Transport", amount: 60, freq: "month" },
  { label: "Phone, internet & bills", amount: 45, freq: "month" },
  { label: "Miscellaneous", amount: 80, freq: "month" },
];
function freshPlan() {
  const p = { country: "uk", uni: "", course: "", fee: "", scholarship: "", paid: "", paidMode: "gbp", savings: "", start: thisMonth, end: mStr(mIdx(thisMonth) + 11),
    inst: [], instMode: "gbp", extras: [], costs: DEF_COSTS.map(c => ({ ...c })), jobs: [],
    intake: "", sched: false, feeAuto: true, schAuto: true, folded: {} };
  // Start with the jobs already entered on the map page, if any.
  try {
    const s = JSON.parse(localStorage.getItem("ukmap-state") || "{}");
    if (Array.isArray(s.jobs)) p.jobs = s.jobs.map(j => ({ name: j.name || "", rate: num(j.rate), hrs: num(j.hrs), from: "", to: "" }));
  } catch (e) {}
  if (!p.jobs.length) p.jobs = [{ name: "", rate: MIN_WAGE, hrs: 20, from: "", to: "" }];
  return p;
}
let P = freshPlan();
try { const saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved && saved.costs) P = { ...P, ...saved }; } catch (e) {}
let saveT;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {}
  const el = $("saved"); el.textContent = "Saved"; el.classList.add("on");
  clearTimeout(saveT); saveT = setTimeout(() => { el.textContent = "Saved in this browser"; el.classList.remove("on"); }, 1200);
}

/* ---------------- university / course lookup (from the map's data) ---------------- */
const DATA = window.UNIDATA || { rows: [], unis: {} };
const UNI_NAMES = Object.keys(DATA.unis).sort((a, b) => a.localeCompare(b));
$("uniList").innerHTML = UNI_NAMES.map(u => `<option value="${esc(u)}"></option>`).join("");
const coursesOf = u => DATA.rows.filter(r => r.u === u);
const courseRow = () => coursesOf(P.uni).find(x => x.p === P.course);
function fillCourses() {
  const rs = coursesOf(P.uni), r = courseRow();
  $("courseList").innerHTML = rs.map(r => `<option value="${esc(r.p)}">${esc(r.lv)} · ~${gbp(r.f)}/yr</option>`).join("");
  $("courseHint").textContent = r ? `Listed fee ~${gbp(r.f)}/yr${r.fn ? ` (${r.fn})` : ""} · typical living here ~${gbp(r.l / 12)}/month · intakes: ${r.i}`
    : rs.length ? `${rs.length} course${rs.length === 1 ? "" : "s"} on the map for this university — pick one to fill in its fee.` : "";
  fillIntakes();
}

/* ---------------- intakes & the university's payment schedule ---------------- */
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const todayIso = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
// A course's intakes (e.g. "Sept, Jan") as start months, from the one that began up to 3 months ago onwards.
// Same rule as the intake picker on the map's course card; values are "YYYY-MM".
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function intakeChoices(u, p) {
  const row = DATA.rows.find(x => x.u === u && x.p === p);
  const ms = [...new Set((String(row?.i || "").toLowerCase().match(/[a-z]{3}/g) || []).map(m => MON[m]).filter(m => m != null))];
  if (!ms.length) ms.push(8, 0);
  const out = [], m0 = mIdx(thisMonth) - 3;
  for (let mi = m0; mi < m0 + 16 && out.length < 4; mi++) if (ms.includes(mi % 12)) out.push({ v: mStr(mi), mi, y: Math.floor(mi / 12), m: mi % 12, name: mLabel(mi, true) });
  return out;
}
const curIntake = () => intakeChoices(P.uni, P.course).find(c => c.v === P.intake);
function fillIntakes() {
  const cs = intakeChoices(P.uni, P.course);
  if (!cs.some(c => c.v === P.intake)) P.intake = cs[0]?.v || "";
  $("intake").innerHTML = cs.map(c => `<option value="${c.v}"${c.v === P.intake ? " selected" : ""}>${c.name}</option>`).join("");
}
// Universities publish dates for their September and January intakes; October starts follow the September
// schedule and February starts the January one. Other intakes get the deposit only.
const schedKey = m => m === 8 || m === 9 ? "sep" : m === 0 || m === 1 ? "jan" : null;
const uniPF = () => DATA.unis[P.uni]?.pay?.pf;
// What the university publishes for the chosen intake: a deposit and/or installment dates.
// Without any policy, a deposit % carried over from the map counts as an estimate.
function schedInfo() {
  const pf = uniPF(), it = curIntake(), key = it && schedKey(it.m);
  const dates = !!(pf && key && pf[key]?.length), dep = pf ? pf.dep != null : !!(P.pre && P.pre.u === P.uni && P.pre.depPct);
  return { pf, it, key, dates, dep, any: !!it && (dates || dep), otherDates: !!(pf && (pf.sep || pf.jan)) && !dates };
}
// The deposit and installments for the chosen intake, in £, from the fee after scholarship.
function scheduleFor(net) {
  const { pf, it, key } = schedInfo(), rows = [];
  if (!it) return { dep: 0, depLabel: "", rows };
  const at = md => {   // "MM-DD" (or "~MM-DD" when only the month/term is known) → a date in this intake's year
    const approx = md[0] === "~", [mm, dd] = md.replace("~", "").split("-").map(Number);
    const yr = key === "sep" ? (mm >= 7 ? it.y : it.y + 1) : (mm >= 10 ? it.y - 1 : it.y);
    return { date: iso(yr, mm, dd), approx };
  };
  let dep = 0, depLabel = "pre-CAS deposit";
  if (pf?.dep != null) dep = typeof pf.dep === "string" ? net * parseFloat(pf.dep) / 100 : pf.dep;
  else if (!pf && P.pre?.u === P.uni && P.pre.depPct) { dep = net * P.pre.depPct / 100; depLabel = `deposit (your ${P.pre.depPct}% estimate from the map)`; }
  dep = Math.min(net, Math.round(dep));
  const sched = (key && pf?.[key]) || [];
  if (sched.length) {
    const base = pf.bal ? net - dep : net;
    let left = pf.bal ? 0 : dep;
    const owe = sched.map(x => x[1] / 100 * base).map(a => { const t = Math.min(a, left); left -= t; return a - t; });   // the deposit counts towards the first payments
    const amts = owe.map(a => Math.round(a)), lastPos = amts.map(a => a > 0).lastIndexOf(true);
    if (lastPos >= 0) amts[lastPos] += Math.round(net - dep) - amts.reduce((a, b) => a + b, 0);   // rounding goes on the last one
    sched.forEach((x, k) => { if (amts[k] > 0) { const d = at(x[0]); rows.push({ ...d, amount: amts[k], label: (x[2] || (sched.length === 1 ? "Balance" : `Installment ${k + 1} of ${sched.length}`)) + (d.approx ? " · date ≈" : "") }); } });
  }
  return { dep, depLabel, rows };
}
// Use the schedule: the deposit (and anything due before today) goes into "Already paid", the rest into installments.
// While P.sched is on, changing the fee, scholarship, course or intake recalculates it; editing an installment or
// "Already paid" yourself turns it off (the plan is then yours, with a one-click "fit to what I owe").
function applySchedule() {
  const { dep, depLabel, rows } = scheduleFor(netFee());
  const past = rows.filter(r => r.date < todayIso), next = rows.filter(r => r.date >= todayIso);
  const pastSum = past.reduce((a, r) => a + r.amount, 0);
  P.inst = next.map(r => ({ date: r.date, amount: r.amount, extra: "", label: r.label }));
  P.instMode = "gbp"; P.paidMode = "gbp"; P.paid = dep + pastSum || "";
  P.sched = true; P.schedPaid = { dep, depLabel, past: pastSum, n: past.length };
  const last = next.reduce((m, r) => Math.max(m, mIdx(r.date.slice(0, 7))), 0);
  if (last && last > mIdx(P.end || thisMonth)) P.end = mStr(last);
}
const unlink = () => { P.sched = false; };
function readMap() { try { return JSON.parse(localStorage.getItem("ukmap-state") || "{}"); } catch (e) { return {}; } }

/* ---------------- prefill from the map ----------------
   "Plan my budget" on a course card opens planner.html?u=&p=&f=&s=&sl=&l=&in=[&rate=] (in = the intake picked there).
   We fill in the fee and sure scholarship (as shown on the map), the university's payment schedule for that intake
   (pf in payment_policies.json), living costs scaled to the city's typical cost, and the jobs from the map's Work card.
   The previous plan is kept so it can be undone. */
let undoPlan = null;
function fromLink() {
  const q = new URLSearchParams(location.search), u = q.get("u"), p = q.get("p") || "";
  if (!u || !DATA.unis[u]) return;
  history.replaceState(null, "", location.pathname);
  undoPlan = JSON.parse(JSON.stringify(P));
  const r = DATA.rows.find(x => x.u === u && x.p === p), S = readMap();
  P.uni = u; P.course = p;
  P.fee = (q.has("f") ? num(q.get("f")) : r ? r.f : num(P.fee)) || ""; P.feeAuto = true;
  P.scholarship = (q.has("s") ? num(q.get("s")) : r ? r.s : 0) || ""; P.schAuto = true;
  // Living costs: keep the usual split, scaled to this city's typical cost.
  const liv = q.has("l") ? num(q.get("l")) : r ? r.l : 0;
  if (liv > 0) {
    const sum = DEF_COSTS.reduce((a, c) => a + c.amount, 0), m = liv / 12;
    P.costs = DEF_COSTS.map(c => ({ ...c, amount: Math.round(c.amount / sum * m / 5) * 5 }));
  }
  // Work: the jobs from the map, with weeks per year turned into average hours a week (same yearly pay).
  const rate = q.has("rate") ? num(q.get("rate")) : null;
  if (Array.isArray(S.jobs) && S.jobs.length) P.jobs = S.jobs.map(j => {
    const wks = j.wks == null ? 52 : Math.min(52, num(j.wks));
    return { name: j.name || "", rate: rate ?? num(j.rate), hrs: wks < 52 ? Math.round(num(j.hrs) * wks / 52 * 2) / 2 : num(j.hrs), from: "", to: "" };
  });
  if (mIdx(P.start || thisMonth) < mIdx(thisMonth)) P.start = thisMonth;
  const cs = intakeChoices(u, p), want = q.get("in");
  P.intake = (cs.find(c => c.v === want) || cs[0])?.v || "";
  P.pre = { u, p, sl: q.get("sl") || "", liv, rate, jobs: P.jobs.length, wks: (S.jobs || []).some(j => j.wks != null && num(j.wks) < 52), depPct: num(S.dep) };
  if (schedInfo().any) applySchedule(); else { P.inst = []; P.paid = ""; unlink(); }
  save();
}
function renderPrefill() {
  const box = $("prefill"), pre = P.pre;
  box.hidden = !pre || P.uni !== pre.u;
  if (box.hidden) return;
  const it = curIntake(), sp = P.sched && P.schedPaid;
  const items = [
    `<li>Fee and scholarship${pre.sl ? ` <span class="muted">(${esc(pre.sl)})</span>` : ""} as shown on the map</li>`,
    sp ? `<li>${esc(pre.u)}'s payment plan for the <b>${esc(it?.name || "")}</b> intake${sp.dep ? ` — the ${gbp(sp.dep)} ${esc(sp.depLabel)} is in <b>Already paid</b>` : ""}</li>` : "",
    pre.liv ? `<li>Living costs scaled to this city's typical <b>${gbp(pre.liv / 12)}</b>/month</li>` : "",
    `<li>Your ${pre.jobs === 1 ? "job" : pre.jobs + " jobs"} from the map${pre.rate != null ? ` at the £${pre.rate.toFixed(2)}/hr you set for this course` : ""}${pre.wks ? " (weeks per year turned into average hours a week)" : ""}</li>`,
  ];
  box.innerHTML = `<div class="pf-top"><b>Filled in from the map</b>
      <span class="pf-act">${undoPlan ? `<button type="button" class="btn-plain sm ghost" id="prefillUndo">Undo</button>` : ""}
      <button type="button" class="icon-btn sm" id="prefillClose" aria-label="Dismiss">${X}</button></span></div>
    <ul>${items.join("")}</ul>`;
}
$("prefill").addEventListener("click", e => {
  if (e.target.closest("#prefillClose")) { P.pre = null; undoPlan = null; save(); renderPrefill(); }
  if (e.target.closest("#prefillUndo")) { P = undoPlan; undoPlan = null; P.pre = null; save(); init(); }
});
// The schedule note above the installments: following the university's plan, or an offer to use it.
function renderSched() {
  const box = $("schedBox"), si = schedInfo();
  box.hidden = !P.uni || !DATA.unis[P.uni];
  if (box.hidden) return;
  const u = esc(P.uni), it = esc(si.it?.name || "this");
  if (P.sched && si.any && !netFee()) {
    box.className = "sched on";
    box.innerHTML = `<span class="sched-ic" aria-hidden="true">✓</span><div><b>${u}'s payment plan for ${it} starts is ready.</b> Enter your tuition fee (or pick a course) and the deposit and installment dates fill in.</div>`;
  } else if (P.sched && si.any) {
    const sp = P.schedPaid || {}, approx = P.inst.some(x => /date ≈$/.test(x.label));
    box.className = "sched on";
    box.innerHTML = `<span class="sched-ic" aria-hidden="true">✓</span><div><b>Following ${u}'s payment plan for ${it} starts.</b>
      ${sp.dep ? `Your ${gbp(sp.dep)} ${esc(sp.depLabel)} is counted in Already paid${sp.past ? `, with ${gbp(sp.past)} due before today` : ""}. ` : sp.past ? `${gbp(sp.past)} due before today is counted in Already paid. ` : ""}
      ${si.dates ? "" : `${u} hasn't published installment dates${si.otherDates ? " for this intake" : ""} — add them from your invoice. `}
      ${approx ? "Dates marked ≈ are estimates from the month or term given. " : ""}It updates with your fee, scholarship and intake until you edit an amount.</div>`;
  } else if (si.any) {
    box.className = "sched";
    box.innerHTML = `<div>${u} publishes ${si.dates ? "a deposit and payment dates" : "its deposit"} for ${it} starts.</div>
      <button type="button" class="btn-plain sm" id="useSched">Use ${si.dates ? "these dates" : "this deposit"}</button>`;
  } else {
    box.className = "sched none";
    box.innerHTML = `<div>${u} hasn't published payment dates${si.otherDates ? ` for ${it} starts` : ""} — add your installments from your offer or invoice.</div>`;
  }
}
$("schedBox").addEventListener("click", e => {
  if (!e.target.closest("#useSched")) return;
  applySchedule(); save(); init();
});

/* ---------------- editable lists ---------------- */
const X = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
const LISTS = {
  inst: {
    el: "instRows",
    get head() { return `<div class="rh inst5"><span>Due date</span><span>Amount (${P.instMode === "pct" ? "% of fee" : "£"})</span><span>Extra cost (£) <i class="opt">optional</i></span><span>Label</span><span class="r">Total</span><span></span></div>`; },
    row: (r, i) => `<div class="row inst5" data-i="${i}">
      <input type="date" data-f="date" value="${esc(r.date)}" aria-label="Installment ${i + 1} due date">
      <input type="number" data-f="amount" min="0" ${P.instMode === "pct" ? 'max="100" step="0.5"' : 'step="10"'} inputmode="decimal" value="${esc(r.amount)}" placeholder="${P.instMode === "pct" ? "Amount %" : "Amount"}" aria-label="Installment ${i + 1} amount (${P.instMode === "pct" ? "% of fee after scholarship" : "£"})">
      <input type="number" data-f="extra" min="0" step="5" inputmode="decimal" value="${esc(r.extra ?? "")}" placeholder="Extra (opt.)" aria-label="Installment ${i + 1} extra cost (£, optional), e.g. a fee paid with it">
      <input data-f="label" value="${esc(r.label)}" placeholder="Installment ${i + 1}" maxlength="40" aria-label="Installment ${i + 1} label">
      <output class="tot" data-out="it${i}" aria-label="Installment ${i + 1} total"></output>
      <button type="button" class="rm" data-rm="${i}" aria-label="Remove installment ${i + 1}">${X}</button></div>`,
    empty: `<p class="empty-row">No installments yet. Add each payment you still have to make, or use “Split what I owe”.</p>`,
    make: () => { const last = P.inst[P.inst.length - 1]; let date = ""; if (last && last.date) { const d = new Date(last.date + "T00:00"); d.setMonth(d.getMonth() + 1); date = d.toISOString().slice(0, 10); } return { date, amount: "", extra: "", label: "" }; },
  },
  extras: {
    el: "extraRows",
    head: `<div class="rh inst"><span>Due date</span><span>Amount (£)</span><span>What for</span><span></span></div>`,
    row: (r, i) => `<div class="row inst" data-i="${i}">
      <input type="date" data-f="date" value="${esc(r.date)}" aria-label="One-off cost ${i + 1} due date">
      <input type="number" data-f="amount" min="0" step="5" inputmode="decimal" value="${esc(r.amount)}" placeholder="0" aria-label="One-off cost ${i + 1} amount (£)">
      <input data-f="label" value="${esc(r.label)}" placeholder="e.g. Visa & IHS" maxlength="40" aria-label="One-off cost ${i + 1} description">
      <button type="button" class="rm" data-rm="${i}" aria-label="Remove ${esc(r.label || "one-off cost " + (i + 1))}">${X}</button></div>`,
    empty: `<p class="empty-row">None added.</p>`,
    make: () => ({ date: "", amount: "", label: "" }),
  },
  costs: {
    el: "costRows",
    head: `<div class="rh cost"><span>Cost</span><span>Amount (£)</span><span>Every</span><span></span></div>`,
    row: (r, i) => `<div class="row cost" data-i="${i}">
      <input data-f="label" value="${esc(r.label)}" placeholder="e.g. Gym" maxlength="40" aria-label="Cost ${i + 1} name">
      <input type="number" data-f="amount" min="0" step="5" inputmode="decimal" value="${esc(r.amount)}" placeholder="0" aria-label="${esc(r.label || "Cost " + (i + 1))} amount (£)">
      <select data-f="freq" aria-label="${esc(r.label || "Cost " + (i + 1))} frequency">
        ${["week", "month", "year"].map(f => `<option value="${f}"${r.freq === f ? " selected" : ""}>${f}</option>`).join("")}</select>
      <button type="button" class="rm" data-rm="${i}" aria-label="Remove ${esc(r.label || "cost " + (i + 1))}">${X}</button></div>`,
    empty: `<p class="empty-row">No living costs added.</p>`,
    make: () => ({ label: "", amount: "", freq: "month" }),
  },
  jobs: {
    el: "jobRows",
    head: "",
    row: (r, i) => `<div class="row job" data-i="${i}">
      <div class="job-top"><input class="job-name" data-f="name" value="${esc(r.name)}" placeholder="Job ${i + 1}" maxlength="40" aria-label="Job ${i + 1} name">
        <span class="job-out" data-out="job${i}"></span>
        <button type="button" class="rm" data-rm="${i}" aria-label="Remove ${esc(r.name || "job " + (i + 1))}">${X}</button></div>
      <div class="job-grid4">
        <label><span>£ / hour</span><input type="number" data-f="rate" min="0" step="0.01" inputmode="decimal" value="${esc(r.rate)}"></label>
        <label><span>Hours / week</span><input type="number" data-f="hrs" min="0" max="80" step="0.5" inputmode="decimal" value="${esc(r.hrs)}"></label>
        <label><span>From <i>(optional)</i></span><input type="month" data-f="from" value="${esc(r.from)}"></label>
        <label><span>Until <i>(optional)</i></span><input type="month" data-f="to" value="${esc(r.to)}"></label>
      </div></div>`,
    empty: `<p class="empty-row">No work added — the plan assumes no income.</p>`,
    make: () => { const last = P.jobs[P.jobs.length - 1]; return { name: "", rate: last ? last.rate : MIN_WAGE, hrs: 10, from: "", to: "" }; },
  },
};
function renderList(k) {
  const L = LISTS[k], list = P[k];
  $(L.el).innerHTML = list.length ? L.head + list.map(L.row).join("") : L.empty;
}
// Every edit, in any list, recalculates everything straight away (input fires on each keystroke and on
// date / select changes). Changing an installment's money or date makes the schedule your own.
for (const [k, L] of Object.entries(LISTS)) {
  const box = $(L.el);
  const onEdit = e => {
    const f = e.target.dataset.f, row = e.target.closest("[data-i]"); if (!f || !row) return;
    const item = P[k][+row.dataset.i]; if (!item) return;
    const v = ["amount", "extra", "rate", "hrs"].includes(f) ? (e.target.value === "" ? "" : +e.target.value) : e.target.value;
    if (item[f] === v) return;
    item[f] = v;
    if (k === "inst" && (f === "amount" || f === "date") && P.sched) { unlink(); renderSched(); }
    save(); compute();
  };
  box.addEventListener("input", onEdit); box.addEventListener("change", onEdit);
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    P[k].splice(+b.dataset.rm, 1);
    if (k === "inst") unlink();
    save(); renderList(k); refresh();
  });
}
const adder = (btn, k, focusSel) => $(btn).addEventListener("click", () => {
  P[k].push(LISTS[k].make()); if (k === "inst") unlink();
  save(); renderList(k); refresh();
  $(LISTS[k].el).querySelector(`[data-i="${P[k].length - 1}"] ${focusSel}`)?.focus();
});
adder("addInst", "inst", "input"); adder("addExtra", "extras", "input"); adder("addCost", "costs", "input"); adder("addJob", "jobs", "input");

/* ---------------- top fields ---------------- */
// Fee and scholarship follow the chosen course until you type your own; a linked schedule follows the fee.
const FIELDS = ["country", "uni", "course", "intake", "fee", "scholarship", "paid", "savings", "start", "end"];
const NUMF = ["fee", "scholarship", "paid", "savings"];
function fillFields() {
  if (P.country !== "uk") P.country = "uk";
  fillCourses();
  FIELDS.forEach(f => { if (f !== "intake" && document.activeElement !== $(f)) $(f).value = P[f] ?? ""; });
  syncModes();
}
function onField(f) {
  const el = $(f), v = NUMF.includes(f) ? (el.value === "" ? "" : +el.value) : el.value;
  if (P[f] === v) return;
  P[f] = v;
  let relink = false;
  if (f === "uni" || f === "course") {
    if (f === "uni" && P.course && !courseRow()) P.course = "";
    const r = courseRow();
    if (r) {
      if (P.feeAuto !== false || !num(P.fee)) { P.fee = r.f; P.feeAuto = true; }
      if (P.schAuto !== false || !num(P.scholarship)) { P.scholarship = r.s || ""; P.schAuto = true; }
    }
    fillCourses();
    // A university with a published plan: use it straight away if nothing has been entered yet.
    if (DATA.unis[P.uni] && !P.sched && !P.inst.length && !num(P.paid) && schedInfo().any) applySchedule();
    relink = true;
  }
  if (f === "intake") relink = true;
  if (f === "fee") { P.feeAuto = false; relink = true; }
  if (f === "scholarship") { P.schAuto = false; relink = true; }
  if (f === "paid") unlink();
  if (relink && P.sched) { if (schedInfo().any) applySchedule(); else unlink(); }
  save(); refresh();
}
FIELDS.forEach(f => { $(f).addEventListener("input", () => onField(f)); $(f).addEventListener("change", () => onField(f)); });

// Fit the installments to what's owed (scale them, or split evenly if they're empty).
function fitInst() {
  const target = P.instMode === "pct" ? pctOf(owed()) : owed();
  const cur = P.inst.map(x => num(x.amount)), sum = cur.reduce((a, b) => a + b, 0);
  if (!P.inst.length || target <= 0) return;
  const dp = P.instMode === "pct" ? 100 : 1;
  const amts = cur.map(a => Math.round((sum > 0 ? a / sum : 1 / cur.length) * target * dp) / dp);
  amts[amts.length - 1] = Math.round((amts[amts.length - 1] + target - amts.reduce((a, b) => a + b, 0)) * dp) / dp;
  P.inst.forEach((x, i) => { x.amount = amts[i]; });
  save(); renderList("inst"); refresh();
}
$("instCheck").addEventListener("click", e => {
  if (e.target.closest("#fitInst")) fitInst();
  if (e.target.closest("#useSched2")) { applySchedule(); save(); init(); }
});

/* ---------------- collapsible sections ---------------- */
document.querySelectorAll(".pl-card .fold").forEach(b => b.addEventListener("click", () => {
  const sec = b.closest(".pl-card"); P.folded = { ...P.folded, [sec.id]: !P.folded?.[sec.id] }; save(); syncFolds();
}));
function syncFolds() {
  document.querySelectorAll(".pl-card .fold").forEach(b => {
    const sec = b.closest(".pl-card"), shut = !!P.folded?.[sec.id];
    sec.classList.toggle("shut", shut); b.setAttribute("aria-expanded", String(!shut));
    b.setAttribute("aria-label", (shut ? "Expand " : "Collapse ") + sec.querySelector("h2").textContent.replace(/^\d/, ""));
    sec.querySelector(".card-b").hidden = shut;
  });
}

/* ---------------- £ / % switches (already paid, installments) ---------------- */
// Percentages are of the fee after scholarship. Switching converts what's typed so the money doesn't change.
const r2 = n => Math.round(n * 100) / 100;
const pctOf = v => netFee() ? v / netFee() * 100 : 0;
const pctTxt = v => r2(v).toLocaleString("en-GB", { maximumFractionDigits: 2 }) + "%";
function syncModes() {
  [["paidMode", P.paidMode], ["instMode", P.instMode]].forEach(([id, v]) =>
    $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))));
  $("paidUnit").textContent = P.paidMode === "pct" ? "(% of fee)" : "(£)";
  $("paid").step = P.paidMode === "pct" ? "0.5" : "10";
  $("instModeHint").hidden = P.instMode !== "pct";
  $("instModeHint").textContent = `Enter each installment as a percentage of your fee after scholarship${netFee() ? ` (${gbp(netFee())})` : " — fill in the fee above first"}.`;
}
function setMode(which, v) {
  if (P[which] === v) return;
  const canConvert = netFee() > 0;
  if (which === "paidMode") {
    if (canConvert && P.paid !== "") P.paid = r2(v === "pct" ? pctOf(paidGBP()) : paidGBP());
    P.paidMode = v; $("paid").value = P.paid;
  } else {
    if (canConvert) P.inst.forEach(x => { if (x.amount !== "") x.amount = r2(v === "pct" ? pctOf(instGBP(x.amount)) : instGBP(x.amount)); });
    P.instMode = v; renderList("inst");
  }
  unlink(); syncModes(); save(); refresh();
}
["paidMode", "instMode"].forEach(id => $(id).addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b) setMode(id, b.dataset.v); }));

/* split what's owed into equal monthly installments */
$("splitInst").addEventListener("click", () => {
  const box = $("splitBox"); box.hidden = !box.hidden;
  $("splitAmt").textContent = gbp(owed()) + (P.instMode === "pct" && netFee() ? ` (${pctTxt(pctOf(owed()))})` : "");
  if (!$("splitFrom").value) { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); $("splitFrom").value = d.toISOString().slice(0, 10); }
});
$("splitGo").addEventListener("click", () => {
  const n = Math.min(24, Math.max(1, Math.round(num($("splitN").value)))), from = $("splitFrom").value;
  const total = P.instMode === "pct" ? pctOf(owed()) : owed();
  if (!from || total <= 0) return;
  const each = Math.floor(total / n * 100) / 100;
  P.inst = Array.from({ length: n }, (_, i) => {
    const d = new Date(from + "T00:00"); d.setMonth(d.getMonth() + i);
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      amount: i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each, label: `Installment ${i + 1}` };
  });
  unlink(); $("splitBox").hidden = true; save(); renderList("inst"); refresh();
});

$("resetPlan").addEventListener("click", e => {
  const b = e.currentTarget;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to clear"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Start over"; }, 3000); return; }
  b.dataset.armed = ""; b.textContent = "Start over";
  P = freshPlan(); save(); init();
});

/* ---------------- the projection ---------------- */
const netFee = () => Math.max(0, num(P.fee) - num(P.scholarship));               // fee after scholarship
const paidGBP = () => P.paidMode === "pct" ? netFee() * num(P.paid) / 100 : num(P.paid);
const instGBP = v => P.instMode === "pct" ? netFee() * num(v) / 100 : num(v);
const owed = () => Math.max(0, netFee() - paidGBP());
const costPerMonth = c => num(c.amount) * (c.freq === "week" ? WPM : c.freq === "year" ? 1 / 12 : 1);
const jobActive = (j, mi) => (!j.from || mIdx(j.from) <= mi) && (!j.to || mIdx(j.to) >= mi);

function project() {
  const S0 = mIdx(P.start || thisMonth);
  const inst = [
    ...P.inst.map((x, k) => ({ ...x, kind: "inst", pct: P.instMode === "pct" ? num(x.amount) : null, tuition: instGBP(x.amount), extra: num(x.extra), amount: instGBP(x.amount) + num(x.extra), label: x.label || `Installment ${k + 1}` })),
    ...P.extras.map((x, k) => ({ ...x, kind: "extra", amount: num(x.amount), label: x.label || `Additional fee ${k + 1}` })),
  ].filter(x => x.date && x.amount > 0).map(x => ({ ...x, ...dParts(x.date) })).sort((a, b) => a.date.localeCompare(b.date));
  const before = inst.filter(x => x.mi < S0), live = inst.filter(x => x.mi >= S0);
  const lastMi = Math.max(mIdx(P.end || P.start || thisMonth), ...live.map(x => x.mi), S0);
  const N = Math.min(60, lastMi - S0 + 1);
  const cost = P.costs.reduce((a, c) => a + costPerMonth(c), 0);
  // If the plan starts this month, count from today: only the rest of this month's pay and costs remain.
  const today = new Date(), todayMi = today.getFullYear() * 12 + today.getMonth(), fromToday = S0 === todayMi;
  const t0 = fromToday ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date(Math.floor(S0 / 12), S0 % 12, 1);
  const months = [];
  let bal = num(P.savings), cumH = 0, cumG = 0;
  for (let i = 0; i < N; i++) {
    const mi = S0 + i, dim = new Date(Math.floor(mi / 12), mi % 12 + 1, 0).getDate();
    const sd = i === 0 && fromToday ? today.getDate() - 1 : 0, frac = (dim - sd) / dim; // days of this month already gone
    const elapsed = day => Math.max(0, day - sd) / dim;
    const hrsWk = P.jobs.filter(j => jobActive(j, mi)).reduce((a, j) => a + num(j.hrs), 0);
    const gross = P.jobs.filter(j => jobActive(j, mi)).reduce((a, j) => a + num(j.rate) * num(j.hrs) * WPM, 0);
    const tax = DED * Math.max(0, gross - PA / 12), net = gross - tax, flow = net - cost;
    const dues = live.filter(x => x.mi === mi), start = bal;
    let paidThisMonth = 0;
    const hrsMonth = hrsWk * WPM;
    for (const d of dues) {
      // Money in hand on the due date: income and costs build up evenly through the month.
      const e = elapsed(d.day);
      d.avail = start + flow * e - paidThisMonth;
      d.ok = d.avail >= d.amount - 0.5;
      d.hoursUntil = cumH + hrsMonth * e;      // hours you'll have worked from now until the due date
      d.grossUntil = cumG + gross * e;         // pay (before tax) earned in those hours
      d.daysUntil = Math.max(0, (new Date(d.date + "T00:00") - t0) / 864e5);
      paidThisMonth += d.amount;
    }
    bal = start + flow * frac - paidThisMonth;
    cumH += hrsMonth * frac; cumG += gross * frac;
    months.push({ mi, gross, tax, net, cost, flow, hrsWk, dues, paid: paidThisMonth, start, end: bal, netP: net * frac, costP: cost * frac, partial: sd > 0 ? sd + 1 : 0 });
  }
  return { S0, N, months, inst: live, before, cost, fromToday, t0 };
}

/* ---------------- results ---------------- */
function compute() {
  const R = project(), M = R.months, ow = owed();
  const all = [...R.inst, ...R.before], sumOf = kind => all.filter(x => x.kind === kind).reduce((a, x) => a + x.amount, 0);
  // Tuition part of installments (checked against what you owe) vs extra costs (separate fees + extras paid with installments).
  const instSum = all.filter(x => x.kind === "inst").reduce((a, x) => a + x.tuition, 0);
  const instExtra = all.filter(x => x.kind === "inst").reduce((a, x) => a + x.extra, 0);
  const extraSum = sumOf("extra") + instExtra, nExtra = all.filter(x => x.kind === "extra" || x.extra > 0).length;
  const money = v => P.instMode === "pct" && netFee() ? `${pctTxt(pctOf(v))} = ${gbp(v)}` : gbp(v);
  const avg = k => M.reduce((a, m) => a + m[k], 0) / Math.max(1, M.length);
  const net = avg("net"), gross = avg("gross"), flow = avg("flow");
  const endBal = M.length ? M[M.length - 1].end : num(P.savings);
  const low = M.reduce((a, m) => m.end < a.end ? m : a, { end: num(P.savings), mi: R.S0 - 1 });
  const firstNeg = M.find(m => m.end < -0.5);
  const okCount = R.inst.filter(x => x.ok).length, firstShort = R.inst.find(x => !x.ok);
  const allPaid = !firstShort, onTrack = allPaid && endBal >= -0.5;
  const hrs = P.jobs.reduce((a, j) => a + num(j.hrs), 0);
  const rate = hrs ? P.jobs.reduce((a, j) => a + num(j.rate) * num(j.hrs), 0) / hrs : MIN_WAGE;
  const keep = gross > PA / 12 ? 1 - DED : 1; // share of an extra £ you'd keep after tax
  // For every payment: how short you'd be on the day, and what extra work between now and then would cover it
  // (this payment and everything due before it).
  R.inst.forEach(d => {
    d.short = Math.max(0, d.amount - d.avail);
    const wk = Math.max(1, d.daysUntil) / 7;
    d.perWeek = d.short / wk; d.perMonth = d.perWeek * WPM;
    d.addHrs = d.perWeek / (rate * keep);                                   // extra hours a week at your average rate
    d.curRate = d.hoursUntil > 0 ? d.grossUntil / d.hoursUntil : null;      // what you'd be earning per hour until then
    d.addRate = d.hoursUntil > 0 ? d.short / (d.hoursUntil * keep) : null;  // extra £ per hour on the hours you already work
  });
  const needPerMonth = Math.max(0, ...R.inst.map(d => d.perMonth));
  const extraHrs = needPerMonth / (rate * keep * WPM), rateTxt = "£" + rate.toFixed(2);
  const needRate = Math.max(0, ...R.inst.filter(d => d.addRate != null).map(d => d.addRate));
  // Largest cumulative gap on any due date = extra cash needed up front if work can't close it.
  const worst = R.inst.reduce((a, d) => (d.amount - d.avail) > (a ? a.amount - a.avail : 0.5) ? d : a, null);
  const workCanFix = hrs + extraHrs <= VISA_HRS;

  // One payment: will you have the money on the day, and if not, what would close the gap by then.
  function payAdvice(d) {
    const when = d.daysUntil < 1 ? "today" : `in ${d.daysUntil < 14 ? Math.round(d.daysUntil) + " days" : Math.round(d.daysUntil / 7) + " weeks"}`;
    if (d.ok) return `<p class="il-note ok">Due ${when}. With your work from now until ${dLabel(d.date)} you'll have ${gbp(d.avail)} — enough, with <b>${gbp(d.avail - d.amount)}</b> to spare.</p>`;
    if (d.daysUntil < 1) return `<p class="il-note bad">Due ${when} and you have ${gbp(d.avail)} — <b>${gbp(d.short)} short</b>. There's no time left to earn it; you'd need savings, family help or to ask the university for more time.</p>`;
    const totalHrs = hrs + d.addHrs, overVisa = totalHrs > VISA_HRS;
    return `<div class="il-note bad">
      <p>Due ${when}. From now until ${dLabel(d.date)} you'd have ${gbp(d.avail)}, so you'd be <b>${gbp(d.short)} short</b>${d.avail < 0 ? " (earlier payments already use up your money)" : ""}. To cover it by then you need <b>${gbp(d.perMonth)} more a month</b> (${gbp(d.perWeek)} a week) after tax. Any of these would do it:</p>
      <ul>
        <li><b>${d.addHrs < 0.1 ? "<0.1" : d.addHrs.toFixed(1)} extra hours a week</b> at ${rateTxt}/hr${hrs ? ` → ${totalHrs.toFixed(1)} h/week in total` : ""}${overVisa ? ` <span class="warn-tag">over the ${VISA_HRS} h term-time visa limit</span>` : ""}</li>
        ${d.addRate != null ? `<li>or <b>£${d.addRate.toFixed(2)} more per hour</b> on the hours you already work — <b>£${(d.curRate + d.addRate).toFixed(2)}/hr</b> instead of £${d.curRate.toFixed(2)}/hr</li>` : `<li>You have no work hours before this date, so a better hourly rate alone can't help — add work or savings.</li>`}
        <li>or spend ${gbp(d.perMonth)} less a month (or a mix of these)</li>
      </ul></div>`;
  }

  /* section 1: what's owed */
  $("owed").innerHTML = num(P.fee)
    ? `<span>Still to pay</span><b>${gbp(ow)}</b><small>${gbp(num(P.fee))} fee${num(P.scholarship) ? ` − ${gbp(num(P.scholarship))} scholarship` : ""}${paidGBP() ? ` − ${gbp(paidGBP())} paid${P.paidMode === "pct" ? ` (${pctTxt(num(P.paid))})` : ""}` : ""}${extraSum ? ` · plus ${gbp(extraSum)} additional fees` : ""}</small>`
    : `<span>Enter your fee to see what's left to pay.</span>`;

  /* section 2: do the installments add up? */
  const chk = $("instCheck"), gap = ow - instSum;
  chk.hidden = !(num(P.fee) && (P.inst.length || ow > 0));
  chk.className = "check " + (Math.abs(gap) < 1 ? "ok" : "warn");
  const si = schedInfo();
  const fixes = Math.abs(gap) < 1 ? "" : `<span class="chk-act">${P.inst.length ? `<button type="button" class="btn-plain sm" id="fitInst">Fit installments to ${money(ow)}</button>` : ""}${si.any && !P.sched ? `<button type="button" class="btn-plain sm ghost" id="useSched2">Use ${esc(P.uni)}'s dates</button>` : ""}</span>`;
  chk.innerHTML = (Math.abs(gap) < 1 ? `✓ Installments add up to what you owe (${money(ow)}).`
    : gap > 0 ? `⚠ Installments add up to ${money(instSum)} — <b>${money(gap)} of what you owe isn't scheduled yet.</b>`
    : `⚠ Installments add up to ${money(instSum)}, which is ${money(-gap)} more than you owe (${money(ow)}).`) + fixes;
  if (R.before.length) chk.innerHTML += `<br>${R.before.length} payment${R.before.length === 1 ? " is" : "s are"} dated before ${mLabel(R.S0, true)} and ${R.before.length === 1 ? "isn't" : "aren't"} included in the projection.`;

  /* £ shown beside % inputs, and the already-paid hint */
  P.inst.forEach((x, i) => {
    const el = document.querySelector(`[data-out="it${i}"]`); if (!el) return;
    const t = instGBP(x.amount), e = num(x.extra);
    el.innerHTML = t + e ? `<b>${gbp(t + e)}</b>${e && t ? `<small>${gbp(t)} + ${gbp(e)}</small>` : P.instMode === "pct" && t ? `<small>${pctTxt(num(x.amount))} of fee</small>` : ""}` : `<span class="muted">—</span>`;
  });
  const instAll = P.inst.reduce((a, x) => a + instGBP(x.amount) + num(x.extra), 0);
  $("instTotal").innerHTML = P.inst.length ? `Total <b>${gbp(instAll)}</b>${instExtra ? ` <small>(incl. ${gbp(instExtra)} extra costs)</small>` : ""}` : "";
  $("paidHint").textContent = P.paidMode === "pct"
    ? (netFee() ? `= ${gbp(paidGBP())} of ${gbp(netFee())} (fee after scholarship)` : "Enter your fee first to turn this into pounds")
    : P.sched && P.schedPaid?.dep && num(P.paid) ? `Includes the ${gbp(P.schedPaid.dep)} ${P.schedPaid.depLabel}${P.schedPaid.past ? ` and ${gbp(P.schedPaid.past)} due before today` : ""} · ${pctTxt(pctOf(num(P.paid)))} of your fee after scholarship`
    : (netFee() && num(P.paid) ? `${pctTxt(pctOf(num(P.paid)))} of your fee after scholarship · your deposit and anything else paid so far` : "Your deposit and anything else paid so far");
  $("instModeHint").textContent = `Enter each installment as a percentage of your fee after scholarship${netFee() ? ` (${gbp(netFee())})` : " — fill in the fee above first"}.`;
  $("extraTotal").innerHTML = sumOf("extra") ? `Total <b>${gbp(sumOf("extra"))}</b>` : "";
  $("extraSum").textContent = P.extras.length ? `${P.extras.length} · ${gbp(P.extras.reduce((a, x) => a + num(x.amount), 0))}` : "visa, health surcharge, graduation…";

  /* section 3/4 totals */
  $("costTotal").innerHTML = `Total <b>${gbp(R.cost)}</b>/month`;
  P.jobs.forEach((j, i) => { const el = document.querySelector(`[data-out="job${i}"]`); if (el) el.textContent = `${gbp(num(j.rate) * num(j.hrs) * WPM)}/month before tax`; });
  $("jobTotal").innerHTML = M.length ? `Avg take-home <b>${gbp(net)}</b>/month` : "";
  const busy = M.filter(m => m.hrsWk > VISA_HRS);
  $("visaWarn").hidden = !busy.length;
  if (busy.length) $("visaWarn").innerHTML = `⚠ In ${busy.length === M.length ? "every month" : busy.length + " month" + (busy.length === 1 ? "" : "s")} your jobs add up to more than ${VISA_HRS} h/week (up to ${Math.max(...busy.map(m => m.hrsWk))} h). Student visas allow ${VISA_HRS} h/week in term time — more only in official vacations. Use each job's From/Until months to model vacation work.`;

  /* always-visible summary bar */
  const status = !M.length || (!num(P.fee) && !R.inst.length) ? ["", "•", "Fill in your plan"] : onTrack ? ["good", "✓", "On track"] : ["bad", "⚠", allPaid ? "Runs out of money" : "Shortfall"];
  const lastM = M.length ? M[M.length - 1].mi : R.S0;
  $("sumbar").innerHTML = `
    <span class="pill ${status[0]}"><span aria-hidden="true">${status[1]}</span> ${status[2]}</span>
    <div class="kpi"><span>Each month</span><b class="${flow >= 0.5 ? "pos" : flow <= -0.5 ? "neg" : ""}">${signed(flow)}</b><small>take-home − living</small></div>
    <div class="kpi"><span>Payments on time</span><b class="${R.inst.length && !allPaid ? "neg" : ""}">${R.inst.length ? `${okCount} of ${R.inst.length}` : "—"}</b><small>${R.inst.length ? (allPaid ? "all covered" : `first short ${dLabel(firstShort.date).replace(/ \d{4}$/, "")}`) : "none scheduled"}</small></div>
    <div class="kpi"><span>Lowest point</span><b class="${low.end < -0.5 ? "neg" : ""}">${gbp(low.end)}</b><small>${low.mi >= R.S0 ? mLabel(low.mi) : "today"}</small></div>
    <div class="kpi"><span>At the end</span><b class="${endBal < -0.5 ? "neg" : ""}">${gbp(endBal)}</b><small>${mLabel(lastM)}</small></div>
    <nav class="jump" aria-label="Jump to"><a href="#sec-course">Course</a><a href="#sec-fees">Tuition</a><a href="#sec-living">Living</a><a href="#sec-income">Income</a><span aria-hidden="true"></span><a href="#hero">Verdict</a><a href="#h-pay">Payments</a><a href="#h-chart">Chart</a></nav>
    <a class="btn-plain sm to-res" href="#results">Details ↓</a>`;

  /* section headers: a live total for each part of the plan */
  const it = curIntake();
  $("sum-course").textContent = P.uni ? [P.uni.replace(/^University of /, "").replace(/ University$/, ""), it && it.name].filter(Boolean).join(" · ") : "Not set";
  $("sum-fees").innerHTML = num(P.fee) ? `${gbp(ow)} to pay${Math.abs(gap) >= 1 && (P.inst.length || ow > 0) ? ` <span class="warn-dot" title="Installments don't match what you owe">!</span>` : ""}` : "";
  $("sum-living").textContent = `${gbp(R.cost)}/month`;
  $("sum-income").textContent = `${gbp(net)}/month${num(P.savings) ? ` + ${gbp(num(P.savings))} saved` : ""}`;

  /* verdict */
  const headline = status[0] === "" ? "Fill in your fee, installments, costs and work to see whether your plan works."
    : onTrack ? `You can make every payment on time and finish with <b class="pos">${gbp(endBal)}</b>.`
    : allPaid ? `Your payments are covered, but <b class="neg">you run out of money in ${mLabel(firstNeg.mi, true)}</b>.`
    : `You'll be <b class="neg">${gbp(firstShort.short)} short</b> for ${esc(firstShort.label)} on ${dLabel(firstShort.date)}${R.inst.length - okCount > 1 ? `, and ${R.inst.length - okCount - 1} more payment${R.inst.length - okCount - 1 === 1 ? "" : "s"} after it` : ""}.`;
  $("hero").innerHTML = `
    <p class="verdict">${headline}</p>
    <div class="tiles">
      <div class="tile"><span>Take-home pay</span><b>${gbp(net)}</b><small>per month (avg)</small></div>
      <div class="tile"><span>Living costs</span><b>${gbp(R.cost)}</b><small>per month</small></div>
      <div class="tile"><span>${flow >= 0 ? "Left over" : "Shortfall"}</span><b class="${flow >= 0.5 ? "pos" : flow <= -0.5 ? "neg" : ""}">${signed(flow)}</b><small>per month, before fees</small></div>
      <div class="tile"><span>Fees still due</span><b>${gbp(R.inst.reduce((a, d) => a + d.amount, 0))}</b><small>${R.inst.length} payment${R.inst.length === 1 ? "" : "s"}</small></div>
    </div>
    ${needPerMonth > 0.5 ? (workCanFix
      ? `<p class="need">To make every payment on time you need about <b>${gbp(needPerMonth)} more per month</b> from now — roughly <b>${extraHrs < 0.1 ? "<0.1" : extraHrs.toFixed(1)} extra hours a week</b> at ${rateTxt}/hr${hrs ? " (your average rate)" : ""}${needRate ? `, or <b>£${needRate.toFixed(2)} more per hour</b> on your current hours (£${(rate + needRate).toFixed(2)}/hr)` : ""}, or ${gbp(needPerMonth)} less spending a month.</p>`
      : `<p class="need">You'd be <b>${gbp(worst.amount - worst.avail)} short by ${dLabel(worst.date)}</b>. Extra hours can't cover that within the ${VISA_HRS} h/week visa limit${needRate ? ` — on your current hours you'd need to earn <b>£${(rate + needRate).toFixed(2)}/hr</b> instead of ${rateTxt}/hr` : ""}. Otherwise you'd need it from savings, family or a change to your payment plan (or ${gbp(needPerMonth)} a month more income or less spending).</p>`) : ""}`;

  /* chart + table */
  $("chartSub").textContent = M.length ? `Projected money in hand from ${R.fromToday ? "today (" + R.t0.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ")" : mLabel(R.S0)} to ${mLabel(M[M.length - 1].mi)}, starting from ${gbp(num(P.savings))}. Dots mark payment due dates (installments and additional fees).` : "";
  drawChart(R);
  $("monthTbl").innerHTML = `<thead><tr><th scope="col">Month</th><th scope="col">Take-home</th><th scope="col">Living costs</th><th scope="col">Payments due</th><th scope="col">Can you pay?</th><th scope="col">Balance at month end</th></tr></thead><tbody>` +
    M.map(m => `<tr><th scope="row">${mLabel(m.mi)}${m.partial ? `<span class="sub">from ${m.partial} ${mLabel(m.mi).split(" ")[0]}</span>` : ""}</th><td>${gbp(m.netP)}</td><td>−${gbp(m.costP)}</td>
      <td>${m.dues.length ? m.dues.map(d => `<span class="sub-line">${esc(d.label)} · ${dLabel(d.date).replace(/ \d{4}$/, "")} · ${gbp(d.amount)}</span>`).join("") : "—"}</td>
      <td class="cando">${m.dues.length ? m.dues.map(d => `<span class="sub-line ${d.ok ? "pos" : "neg"}">${d.ok ? "✓ Yes, " + gbp(d.avail - d.amount) + " spare" : "⚠ Short " + gbp(d.short)}</span>`).join("") : ""}</td>
      <td class="${m.end < -0.5 ? "neg" : ""}">${gbp(m.end)}</td></tr>`).join("") + "</tbody>";

  /* installment list */
  $("instOut").innerHTML = R.inst.length ? `<ul class="inst-list">${R.inst.map(d => `
      <li class="${d.ok ? "ok" : "bad"}"><div class="il-main"><b>${esc(d.label)}</b><span>${dLabel(d.date)} · ${d.kind === "extra" ? "Additional fee" : "Installment"}${d.pct != null ? ` · ${pctTxt(d.pct)} of fee` : ""}${d.kind === "inst" && d.extra ? ` · ${gbp(d.tuition)} + ${gbp(d.extra)} extra cost` : ""}</span></div>
        <div class="il-amt">${gbp(d.amount)}</div>
        <div class="il-st"><span class="pill ${d.ok ? "good" : "bad"}"><span aria-hidden="true">${d.ok ? "✓" : "⚠"}</span> ${d.ok ? "Covered" : "Short " + gbp(d.short)}</span>
          <small>${gbp(d.avail)} in hand on the day</small></div>
        ${payAdvice(d)}</li>`).join("")}</ul>`
    : `<p class="empty-row">Add your installments and any additional fees to see whether each one is covered in time.</p>`;

  /* the story */
  const p = [];
  const who = [P.course, P.uni].filter(Boolean).join(" at ");
  if (num(P.fee)) p.push(`You still owe <b>${gbp(ow)}</b> in tuition${who ? ` for ${esc(who)}` : ""}${num(P.scholarship) || paidGBP() ? ` after ${[num(P.scholarship) ? gbp(num(P.scholarship)) + " scholarship" : "", paidGBP() ? gbp(paidGBP()) + " already paid" : ""].filter(Boolean).join(" and ")}` : ""}.` +
    (Math.abs(gap) >= 1 ? ` Your scheduled installments cover ${money(instSum)} of that${gap > 0 ? `, so <b>${gbp(gap)} still needs a payment date</b>` : ""}.` : ""));
  if (nExtra) p.push(`On top of tuition you have <b>${gbp(extraSum)}</b> of extra costs${sumOf("extra") ? ` (${all.filter(x => x.kind === "extra").map(x => esc(x.label)).join(", ")}${instExtra ? ", plus extras paid with installments" : ""})` : " paid together with your installments"}.`);
  if (M.length) {
    p.push(`Your work brings in about <b>${gbp(gross)}</b> a month before tax and <b>${gbp(net)}</b> after tax. Living costs come to <b>${gbp(R.cost)}</b> a month, so you are ` +
      (flow >= 0.5 ? `<b class="pos">making ${gbp(flow)} more than you spend</b> each month — that's what builds up towards your fees.`
        : flow <= -0.5 ? `<b class="neg">spending ${gbp(-flow)} more than you earn</b> each month, before paying any fees. That gap comes out of your savings.`
        : `breaking even each month, with nothing left over for fees.`));
    p.push(`Starting with ${gbp(num(P.savings))}, you're projected to have <b>${gbp(endBal)}</b> at the end of ${mLabel(M[M.length - 1].mi, true)}` +
      (low.end < num(P.savings) - 0.5 && low !== M[M.length - 1] ? `. Your lowest point is ${gbp(low.end)} in ${mLabel(low.mi, true)}` : "") +
      (firstNeg ? `, and <b class="neg">you run out of money in ${mLabel(firstNeg.mi, true)}</b>.` : "."));
  }
  if (R.inst.length) {
    if (allPaid) p.push(`<b class="pos">You can make all ${R.inst.length} payment${R.inst.length === 1 ? "" : "s"} on time.</b> The tightest one is ${esc(R.inst.reduce((a, d) => d.avail - d.amount < a.avail - a.amount ? d : a).label)}, with ${gbp(Math.min(...R.inst.map(d => d.avail - d.amount)))} to spare on the day.`);
    else p.push(`You can make ${okCount} of ${R.inst.length} payments on time. <b class="neg">${esc(firstShort.label)} (${gbp(firstShort.amount)}, due ${dLabel(firstShort.date)}) is the first you can't cover</b> — you'd have ${gbp(firstShort.avail)} on the day, ${gbp(firstShort.amount - firstShort.avail)} short.` +
      (workCanFix
        ? ` To cover every payment in time you'd need about <b>${gbp(needPerMonth)} more each month</b>: around ${extraHrs.toFixed(1)} extra hours a week at ${rateTxt}/hr, cutting spending by the same amount, or a mix of both.`
        : ` In total you'd be <b class="neg">${gbp(worst.amount - worst.avail)} short by ${dLabel(worst.date)}</b>. Closing that with work alone would take about ${Math.round(hrs + extraHrs)} hours a week, well over the ${VISA_HRS} h term-time visa limit — so plan for that amount from savings or family, ask the university about a longer payment plan, or cut ${gbp(needPerMonth)} a month of spending.`));
  }
  if (!p.length) p.push("Fill in your fee, installments, living costs and work on the left — the projection updates as you type.");
  p.push(`<span class="fine">This is an estimate. Tax is approximated monthly; real pay, bills and exchange rates vary, so leave yourself a buffer.</span>`);
  $("story").innerHTML = p.map(x => `<p>${x}</p>`).join("");
}

/* ---------------- chart: balance over time (single series, SVG) ---------------- */
const SVGNS = "http://www.w3.org/2000/svg";
function niceStep(range) { const raw = range / 4, mag = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / mag; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag; }
function drawChart(R) {
  const box = $("chart"), M = R.months;
  if (!M.length) { box.innerHTML = ""; return; }
  const W = Math.max(280, box.clientWidth), H = W < 520 ? 220 : 270, padL = 58, padR = W < 520 ? 16 : 70, padT = 18, padB = 30;
  // points: balance at the start of the plan, then at the end of every month
  const pts = [{ x: 0, y: num(P.savings), m: null }, ...M.map((m, i) => ({ x: i + 1, y: m.end, m }))];
  const lo = Math.min(0, ...pts.map(p => p.y)), hi = Math.max(0, ...pts.map(p => p.y));
  const step = niceStep(hi - lo || 1000), y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step || step;
  const X = x => padL + x / M.length * (W - padL - padR), Y = y => padT + (y1 - y) / (y1 - y0) * (H - padT - padB);
  const balAt = x => { const i = Math.min(M.length - 1, Math.floor(x)), f = x - i; return pts[i].y + (pts[i + 1].y - pts[i].y) * f; };

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Projected balance from ${mLabel(R.S0)} to ${mLabel(M[M.length - 1].mi)}: starts at ${gbp(pts[0].y)}, ends at ${gbp(pts[pts.length - 1].y)}">`;
  s += `<defs><clipPath id="cAbove"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath><clipPath id="cBelow"><rect x="0" y="${Y(0)}" width="${W}" height="${H}"/></clipPath></defs>`;
  for (let v = y0; v <= y1 + 1e-6; v += step) s += `<line class="grid${Math.abs(v) < 1e-6 ? " zero" : ""}" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? (v < 0 ? "−" : "") + "£" + (Math.abs(v) / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 }) + "k" : gbp(v)}</text>`;
  const every = Math.ceil(M.length / (W < 520 ? 4 : 8));
  M.forEach((m, i) => { if (i % every === 0) s += `<text class="tick" x="${X(i)}" y="${H - 8}" text-anchor="${i ? "middle" : "start"}">${new Date(Math.floor(m.mi / 12), m.mi % 12, 1).toLocaleDateString("en-GB", { month: "short" })}${m.mi % 12 === 0 || i === 0 ? " " + String(Math.floor(m.mi / 12)).slice(2) : ""}</text>`; });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const area = `${line}L${X(pts[pts.length - 1].x)},${Y(0)}L${X(0)},${Y(0)}Z`;
  s += `<path class="area pos" d="${area}" clip-path="url(#cAbove)"/><path class="area neg" d="${area}" clip-path="url(#cBelow)"/>`;
  s += `<path class="line" d="${line}"/>`;
  // installment due dates sit on the line at their day of the month
  R.inst.forEach((d, k) => { const x = d.mi - R.S0 + d.day / d.dim; s += `<circle class="due ${d.ok ? "ok" : "bad"}" data-k="${k}" cx="${X(x)}" cy="${Y(balAt(x))}" r="5"/>`; });
  // selective direct labels: the end value, and the lowest point if it dips below zero
  const last = pts[pts.length - 1];
  if (W >= 520) s += `<text class="end-lbl" x="${X(last.x) + 8}" y="${Y(last.y) + 4}">${gbp(last.y)}</text>`;
  const low = pts.reduce((a, p) => p.y < a.y ? p : a);
  if (low.y < -0.5 && low !== last) s += `<text class="low-lbl" x="${X(low.x)}" y="${Y(low.y) + 18}" text-anchor="middle">Lowest ${gbp(low.y)}</text>`;
  s += `<line class="xhair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/><circle class="hdot" r="4.5" visibility="hidden"/>`;
  s += `<rect class="hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}"/></svg><div class="tip" hidden></div>`;
  box.innerHTML = s;

  const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), xh = svg.querySelector(".xhair"), hd = svg.querySelector(".hdot");
  const showTip = (html, px, py) => {
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(W - tw - 4, Math.max(4, px + 14 > W - tw ? px - tw - 14 : px + 14)) + "px";
    tip.style.top = Math.max(0, py - th - 10) + "px";
  };
  const hide = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); hd.setAttribute("visibility", "hidden"); };
  svg.querySelector(".hit").addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((x - padL) / (W - padL - padR) * M.length))), p = pts[i];
    xh.setAttribute("x1", X(p.x)); xh.setAttribute("x2", X(p.x)); xh.setAttribute("visibility", "visible");
    hd.setAttribute("cx", X(p.x)); hd.setAttribute("cy", Y(p.y)); hd.setAttribute("visibility", "visible");
    showTip(p.m ? `<b>End of ${mLabel(p.m.mi, true)}</b>
      <div><span>Take-home${p.m.partial ? " (rest of month)" : ""}</span><span>+${gbp(p.m.netP)}</span></div><div><span>Living costs</span><span>−${gbp(p.m.costP)}</span></div>
      ${p.m.paid ? `<div><span>Installments</span><span>−${gbp(p.m.paid)}</span></div>` : ""}<div class="t-end"><span>Balance</span><span>${gbp(p.m.end)}</span></div>`
      : `<b>${R.fromToday ? "Today · " + R.t0.toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "Start · " + mLabel(R.S0, true)}</b><div class="t-end"><span>Money you have</span><span>${gbp(p.y)}</span></div>`, X(p.x) * r.width / W, Y(p.y) * r.height / H);
  });
  svg.querySelector(".hit").addEventListener("pointerleave", hide);
  svg.querySelectorAll(".due").forEach(c => {
    const d = R.inst[+c.dataset.k];
    c.addEventListener("pointerenter", () => { const r = svg.getBoundingClientRect();
      showTip(`<b>${esc(d.label)} · ${dLabel(d.date)}</b><div><span>Due</span><span>${gbp(d.amount)}</span></div><div><span>In hand that day</span><span>${gbp(d.avail)}</span></div>
        <div class="t-end"><span>${d.ok ? "✓ Covered" : "⚠ Short"}</span><span>${d.ok ? "+" + gbp(d.avail - d.amount) : gbp(d.amount - d.avail)}</span></div>`, +c.getAttribute("cx") * r.width / W, +c.getAttribute("cy") * r.height / H); });
    c.addEventListener("pointerleave", () => { tip.hidden = true; });
  });
}
let lastW = 0;
new ResizeObserver(() => { const w = $("chart").clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; drawChart(project()); } }).observe($("chart"));

/* ---------------- boot ---------------- */
const syncHdr = () => document.documentElement.style.setProperty("--hdr", $("hdr").getBoundingClientRect().height + "px");
new ResizeObserver(syncHdr).observe($("hdr")); syncHdr();
// After anything that can change several sections at once (schedule, course, fee): sync fields, then recalc.
function refresh() { fillFields(); renderList("inst"); renderSched(); renderPrefill(); compute(); }
function init() { fillFields(); Object.keys(LISTS).forEach(renderList); syncFolds(); renderSched(); renderPrefill(); compute(); }
fromLink();
init();
})();
