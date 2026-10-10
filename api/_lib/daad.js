// Germany: course details from DAAD's International Programmes database (www2.daad.de), the official catalogue of
// international degree programmes, kept up to date by the universities themselves. Shared by scripts/import_germany.mjs
// (to build the German course list) and scrapeCourse() (so Refresh re-reads German fees from the same pages).
import { htmlToText } from "./scrape.js";

export const DAAD = "https://www2.daad.de";
export const DAAD_SEARCH = DAAD + "/deutschland/studienangebote/international-programmes/api/solr/en/search.json";
export const isDaad = url => /^https:\/\/www2\.daad\.de\/deutschland\/studienangebote\/international-programmes\//.test(url);

// "1.500" / "1,500" → 1500; "340.50" / "340,50" → 340.5
const num = s => { const t = String(s).trim(); return /^\d{1,3}([.,]\d{3})+$/.test(t) ? +t.replace(/[.,]/g, "") : +t.replace(",", "."); };
const EUR = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(?:EUR|€|euros?)\b/gi;
const section = (t, from, to) => { const i = t.indexOf(from); if (i < 0) return ""; const j = to ? t.indexOf(to, i + from.length) : -1; return t.slice(i + from.length, j > i ? j : i + 900); };

/** Parse a DAAD programme detail page. Amounts in EUR. */
export function parseDaadDetail(html) {
  const t = htmlToText(html);
  // Tuition per semester: "None", or an amount — when both EU and non-EU fees are given, the non-EU one.
  const tu = section(t, "Tuition fees per semester", "Semester contribution");
  const amounts = [...tu.matchAll(EUR)].map(m => ({ v: num(m[1]), i: m.index }));
  let tuition = 0;
  if (amounts.length) {
    const non = tu.search(/non-?EU|third[- ]countr|international students|non-European/i);
    const pick = non >= 0 ? amounts.find(a => a.i > non) || amounts[amounts.length - 1] : amounts[0];
    tuition = pick.v;
  }
  const scSec = section(t, "Semester contribution", "Costs of living");
  const contribution = (() => { const m = [...scSec.matchAll(EUR)].map(x => num(x[1])).filter(v => v >= 30 && v <= 1500); return m[0] ?? null; })();
  const lv = section(t, "Costs of living", "Funding opportunities");
  const living = (() => { const m = lv.match(/(\d{1,2}[.,]\d{3}|\d{3,4})\s*(?:EUR|€)[^|]{0,30}(?:per|a|\/)\s*month/i); const v = m ? num(m[1]) : null; return v >= 400 && v <= 3000 ? v : null; })();
  const begin = (section(t, "Beginning", "Application") || "").split("|").map(s => s.trim()).find(Boolean) || "";
  const intakes = [/winter/i.test(begin) && "Oct", /summer/i.test(begin) && "Apr"].filter(Boolean);
  const duration = ((section(t, "Programme duration", "Beginning") || "").match(/(\d+)\s*semesters?/i) || [])[1];
  const clean = s => s.replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").replace(/^[\s·]+|[\s·]+$/g, "").trim();
  const req = clean(section(t, "Academic admission requirements", "German language skills") || "").slice(0, 300);
  const eng = clean(section(t, "English language skills", "Language requirements exemptions") || section(t, "English language skills", "Application") || "").slice(0, 160);
  const winterDeadline = ((section(t, "For the winter semester:", "The following") || "").match(/until\s+([^|]{3,40})/i) || [])[1] || "";
  const website = (html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*Course website\s*<\/a>/i) || [])[1] || "";
  const varies = /^\s*\|?\s*Varied|Tuition fees may vary/i.test(tu);
  const title = (html.match(/<h2[^>]*class="[^"]*c-detail-header__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ").replace(/\s*[-–|]\s*DAAD.*$/i, "").replace(/\s+/g, " ").trim();
  return { title, tuition, varies: varies && !amounts.length, contribution, living, intakes, duration: duration ? +duration : null, req, eng, winterDeadline: winterDeadline.trim(), website };
}

/** Yearly fee (EUR) = 2 semesters × (tuition + semester contribution), with a note explaining it. */
export function yearlyFee(d, tuition = d.tuition) {
  const sc = d.contribution ?? 300;   // not stated on the page: assume a typical semester fee
  const scTxt = d.contribution == null ? "≈€300 semester fee (not stated)" : `€${Math.round(sc)} semester fee`;
  const f = Math.round(2 * (tuition + sc));
  const fn = tuition ? `€${tuition.toLocaleString("en-GB")}/semester tuition + ${scTxt}` : `no tuition · ${scTxt.replace("semester fee", "/semester fee").replace(" /", "/")}`;
  return { f, fn };
}

/* ---------------- what non-EU students actually pay ---------------- */
// Public universities in Baden-Württemberg charge non-EU students €1,500 per semester; TUM charges €4,000–6,000 per
// semester for most master's (a few stay free). DAAD often lists these as "Tuition varies", so apply the rules here.
const BW = /(Heidelberg|Karlsruhe|\bKIT\b|Freiburg|Stuttgart|Tübingen|Tuebingen|Mannheim|\bUlm\b|Konstanz|Hohenheim|Pforzheim|Reutlingen|Esslingen|Offenburg|Furtwangen|Aalen|Heilbronn|Ludwigsburg|Nürtingen|Biberach|Sigmaringen|Albstadt|Kehl|Rottenburg|Weingarten|Schwäbisch Gmünd|Ravensburg|Mosbach|Lörrach|Villingen|Baden-Württemberg)/i;
export const PRIVATE = /(SRH|Fresenius|IU International|Frankfurt School|ESMT|\bWHU\b|\bEBS\b|Hertie|Bucerius|Constructor|Jacobs University|Zeppelin|Munich Business School|GISMA|Berlin International University|\bISM\b|\bCBS\b|Macromedia|Steinbeis|Schiller|Lancaster University Leipzig|University of Europe|Arden|accadis|\bHHL\b|Kühne|Witten|Friedensau|Touro|Northern Business School|New European College|\bBSP\b|\bFOM\b|Quadriga|Hamburg School of Business|XU Exponential|EU Business School|Psychologische Hochschule|Media Design|AMD|Hamburg Media School|Berlin School of Business)/i;
const TUM = /Technical University of Munich|Technische Universität München|\bTUM\b/i;
const TUM_FREE = /software engineering|bioinformatics|information engineering|quantum|land management|geospatial/i;

/** Non-EU tuition per semester: { tuition, note, est } — tuition null when it can't be determined. */
export function nonEuTuition({ uni, city = "", title = "", parsed }) {
  const where = `${uni} ${city}`;
  if (parsed.tuition > 0) return { tuition: parsed.tuition, note: "" };
  if (TUM.test(uni)) return TUM_FREE.test(title) ? { tuition: 0, note: "TUM keeps this programme tuition-free" }
    : { tuition: 6000, note: "TUM non-EU fee (€4,000–6,000 per semester) — check the course page", est: true };
  if (BW.test(where) && !PRIVATE.test(uni)) return { tuition: 1500, note: "Baden-Württemberg non-EU fee €1,500 per semester" };
  if (parsed.varies) return { tuition: null, note: "Tuition varies — see the course page" };
  return { tuition: 0, note: "" };
}


/* ---------------- which programmes the map lists ---------------- */
// The map's subject groups, matched on the programme name (first match wins).
export const DAAD_SUBJECTS = [
  ["HM", /public health|global health|international health|health (care |services? )?(management|economics|policy)|healthcare management|epidemiology|health sciences?|health promotion/i],
  ["SF", /sustainab\w* finance|green finance|climate finance|finance and sustainab|sustainab\w* (and|&) finance|responsible (finance|invest)|\besg\b|impact invest|sustainable (investment|banking)/i],
  ["DEV", /development economics|development finance|economics of development|international and development economics|economic development|microfinance/i],
  ["DM", /international development|development studies|global development|development management|development cooperation|\bngo\b|non-?profit|humanitarian|sustainable development|development (policy|practice)|social (innovation|entrepreneurship)|peace and conflict/i],
  ["HCI", /human[- ]computer|\bhci\b|interaction design|user experience|\bux\b|human[- ]cent(er|re)d|usability/i],
  ["AI", /artificial intelligence|machine learning|\bai\b|intelligent systems|autonomous systems|cognitive systems|data science and ai/i],
  ["CS", /computer science|informatics|\bcomputing\b|software engineering|computational science|information systems/i],
];
const EXCLUDE = /online|part-time|distance|extra-occupational|executive|\bMBA\b|postgraduate master|weiterbildend|berufsbegleitend|blended/i;
const EXCLUDE_UNI = /distance learning|Fernuniversit|IU International University|Wilhelm Büchner|AKAD|Euro-FH|APOLLON|Diploma Hochschule/i;

/** Every master's programme in the DAAD database (list view: name, university, city, start, fee summary, link). */
export async function daadMasters() {
  const all = [];
  for (let off = 0; ; off += 100) {
    const r = await fetch(`${DAAD_SEARCH}?q=&degree%5B%5D=2&limit=100&sort=4&display=list&offset=${off}`, { headers: { "user-agent": "UniMap/1.0 (student course map)", accept: "application/json" } });
    const j = await r.json(); all.push(...j.courses); if (j.courses.length < 100) break;
    await new Promise(res => setTimeout(res, 300));
  }
  return all;
}
/** English-taught, on-campus master's in the map's subjects: [{ g, c }]. */
export function daadPick(all) {
  const picked = [];
  for (const c of all) {
    const langs = c.languages || [];
    if (!langs.includes("English") || (langs[0] !== "English" && langs.includes("German"))) continue;
    if (c.isElearning || /online/i.test(c.badgeLabel || "") || EXCLUDE.test(c.courseName) || EXCLUDE_UNI.test(c.academy)) continue;
    const s = DAAD_SUBJECTS.find(([, re]) => re.test(c.courseName)); if (!s) continue;
    picked.push({ g: s[0], c });
  }
  return picked;
}
