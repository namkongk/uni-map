// /api/report — "Report wrong info" on a course. Saved to course_reports for you to review in Supabase.
//   POST { co, uni, course, field, details, link? } → { ok: true }
// Same-origin JSON only (see requestProblem); at most 10 reports per network address an hour.
import { dbReady, rest } from "./_lib/db.js";
import { requestProblem, clientKey, recordAttempt, currentUser } from "./_lib/auth.js";

const FIELDS = ["fee", "dates", "entry", "closed", "scholarship", "other"];
const PER_HOUR = 10;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
// Plain text only: no control characters, trimmed, length-capped.
const clean = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(request) {
  if (!dbReady()) return json({ error: "Reports aren't available right now." }, 503);
  const bad = requestProblem(request); if (bad) return json({ error: bad }, 403);
  const raw = await request.text(); if (raw.length > 4000) return json({ error: "That's too long." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400); }
  const co = ["uk", "de"].includes(b.co) ? b.co : null, uni = clean(b.uni, 160), course = clean(b.course, 200);
  const field = FIELDS.includes(b.field) ? b.field : null, details = clean(b.details, 600);
  let link = clean(b.link, 400);
  if (link) { try { const u = new URL(link); if (!/^https?:$/.test(u.protocol)) link = ""; } catch { link = ""; } }
  if (!co || !uni || !course || !field) return json({ error: "Bad request" }, 400);
  if (details.length < 3) return json({ error: "Please say what's wrong (a few words)." }, 400);
  try {
    const ip = clientKey(request), since = new Date(Date.now() - 3600e3).toISOString();
    const recent = await rest(`auth_attempts?select=id&kind=eq.report&key=eq.${encodeURIComponent(ip)}&at=gte.${since}&limit=${PER_HOUR}`);
    if (recent.length >= PER_HOUR) return json({ error: "Thanks — that's enough reports for now. Please try again later." }, 429);
    const me = await currentUser(request).catch(() => null);
    await rest("course_reports", { method: "POST", prefer: "return=minimal", body: { co, uni, course, field, details, link: link || null, user_id: me?.id || null } });
    await recordAttempt("report", [ip], true);
    return json({ ok: true });
  } catch (e) {
    console.error("report:", e.message);
    return json({ error: /PGRST205|42P01|Could not find the table/.test(e.message) ? "Reports aren't set up on the server yet." : "Couldn't send — please try again." }, 502);
  }
}
