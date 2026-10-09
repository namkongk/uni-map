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
  const rows = await rest("course_fees?select=url,uni,fee,fee_year,ctx,src,via,checked_at,last_error,error_at&limit=5000");
  return Object.fromEntries(rows.map(r => [r.url, r]));
}

/**
 * Save one university's refresh results (the objects /api/refresh returns).
 * A successful reading replaces the stored fee (and is logged in fee_history if the fee changed);
 * a failed one only records the error, so the last good fee is kept.
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
    await rest("course_fees?on_conflict=url", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: ok.map(x => ({ url: x.url, uni, fee: Math.round(x.fee), fee_year: x.year ?? null, ctx: (x.ctx || "").slice(0, 400), src: x.src || x.url, via: x.via || null,
        checked_at: now, last_error: null, error_at: null, updated_at: now })),
    });
    const changed = ok.filter(x => prev[x.url] !== Math.round(x.fee));
    if (changed.length) await rest("fee_history", {
      method: "POST", prefer: "return=minimal",
      body: changed.map(x => ({ url: x.url, uni, fee: Math.round(x.fee), fee_year: x.year ?? null, prev_fee: prev[x.url] ?? null, ctx: (x.ctx || "").slice(0, 400), checked_at: now })),
    });
  }
  if (bad.length) await rest("course_fees?on_conflict=url", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: bad.map(x => ({ url: x.url, uni, last_error: String(x.err || "Unknown error").slice(0, 200), error_at: now, updated_at: now })),
  });
  return { saved: ok.length, errors: bad.length, changed: ok.filter(x => prev[x.url] !== Math.round(x.fee)).length };
}
