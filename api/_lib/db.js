// Supabase (Postgres) access for the API functions, over its REST interface — no extra dependencies.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server-only; never sent to the browser). Tables: supabase/schema.sql.

const env = () => ({ url: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""), key: process.env.SUPABASE_SECRET_KEY || "" });
export const dbReady = () => { const { url, key } = env(); return !!(url && key); };

async function rest(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = env();
  const headers = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("ey")) headers.authorization = "Bearer " + key;   // legacy service_role keys are JWTs
  if (prefer) headers.prefer = prefer;
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Database ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** Latest stored reading for every course page: { [url]: row }. */
export async function loadFees() {
  const rows = await rest("course_fees?select=url,uni,fee,fee_year,ctx,src,via,checked_at,last_error,error_at,title,intakes,course_status,status_note,entry,info_at&limit=5000");
  return Object.fromEntries(rows.map(r => [r.url, r]));
}

// Course details (title, intakes, open/closed, entry) from a result, as table columns. Empty readings don't
// overwrite stored ones, except the status, which always reflects the latest read.
const infoCols = (x, now) => {
  const i = x.info; if (!i) return {};
  return { course_status: i.status || null, status_note: i.statusNote || null, info_at: now,
    ...(i.title ? { title: i.title.slice(0, 160) } : {}), ...(i.intakes?.length ? { intakes: i.intakes } : {}), ...(i.entry ? { entry: i.entry.slice(0, 400) } : {}) };
};

// PostgREST bulk upserts need every row to have the same columns: send rows in groups by their column set.
async function upsertGrouped(table, rows) {
  const groups = {};
  for (const row of rows) (groups[Object.keys(row).sort().join()] ||= []).push(row);
  for (const body of Object.values(groups)) await rest(`${table}?on_conflict=url`, { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body });
}

/**
 * Save one university's refresh results (the objects /api/refresh returns).
 * A successful reading replaces the stored fee (and is logged in fee_history if the fee changed);
 * a failed one only records the error, so the last good fee is kept. Course details are saved either way.
 */
export async function saveResults(uni, results) {
  const now = new Date().toISOString();
  const ok = results.filter(x => x.ok && Number.isFinite(x.fee));
  const bad = results.filter(x => !x.ok);
  let prev = {};
  if (ok.length) {
    const list = ok.map(x => `"${x.url.replace(/"/g, '\\"')}"`).join(",");
    const rows = await rest(`course_fees?select=url,fee&url=in.(${encodeURIComponent(list)})`);
    prev = Object.fromEntries(rows.map(r => [r.url, r.fee]));
    await upsertGrouped("course_fees", ok.map(x => ({ url: x.url, uni, fee: Math.round(x.fee), fee_year: x.year ?? null, ctx: (x.ctx || "").slice(0, 400),
      src: x.src || x.url, via: x.via || null, checked_at: now, last_error: null, error_at: null, updated_at: now, ...infoCols(x, now) })));
    const changed = ok.filter(x => prev[x.url] !== Math.round(x.fee));
    if (changed.length) await rest("fee_history", {
      method: "POST", prefer: "return=minimal",
      body: changed.map(x => ({ url: x.url, uni, fee: Math.round(x.fee), fee_year: x.year ?? null, prev_fee: prev[x.url] ?? null, ctx: (x.ctx || "").slice(0, 400), checked_at: now })),
    });
  }
  await upsertGrouped("course_fees", bad.map(x => ({ url: x.url, uni, last_error: String(x.err || "Unknown error").slice(0, 200), error_at: now, updated_at: now, ...infoCols(x, now) })));
  return { saved: ok.length, errors: bad.length, changed: ok.filter(x => prev[x.url] !== Math.round(x.fee)).length,
    closed: results.filter(x => x.info && (x.info.status === "closed" || x.info.status === "gone")).length };
}

/* ---------------- discovery: courses at universities not on the map yet ---------------- */
/** URLs already in the candidates table (any status), so reviewed ones aren't re-checked. */
export async function candidateUrls() {
  const rows = await rest("course_candidates?select=url,status&limit=20000");
  return new Map(rows.map(r => [r.url, r.status]));
}
/** Add new candidates; for ones already listed, only bump last_seen (keeps your review status). */
export async function saveCandidates(list) {
  if (!list.length) return;
  const now = new Date().toISOString();
  await upsertGrouped("course_candidates", list.map(c => ({ url: c.url, uni: c.uni, subject: c.subject || null, title: (c.title || "").slice(0, 160) || null,
    fee: c.fee ?? null, intakes: c.intakes?.length ? c.intakes : null, entry: c.entry ? c.entry.slice(0, 400) : null, last_seen: now })));
}
export async function touchCandidates(urls) {
  if (!urls.length) return;
  const now = new Date().toISOString();
  await upsertGrouped("course_candidates", urls.map(u => ({ url: u.url, uni: u.uni, last_seen: now })));
}
