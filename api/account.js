// /api/account — simple profiles that keep your inputs (map filters, jobs, grade, budget planner) across browsers.
//   GET                              → { user: { id, name } | null, data, updatedAt }
//   POST { action: "signup", name, password, data? }  → creates a profile with a new 12-digit id and signs in
//   POST { action: "login", id, password }            → signs in
//   POST { action: "save", data }                     → stores your inputs
//   POST { action: "logout" }
//   POST { action: "password", current, next }       → changes the password and signs out other browsers
//   POST { action: "delete", password }               → deletes the profile and everything saved with it
// Security details are in _lib/auth.js.
import { dbReady, rest } from "./_lib/db.js";
import {
  hashPassword, verifyPassword, cleanName, passwordProblem, validId, newId, createSession, sessionCookie, currentUser,
  endSession, endOtherSessions, requestProblem, clientKey, loginLocked, signupLimited, recordAttempt, LIMITS,
} from "./_lib/auth.js";

const MAX_DATA = 200 * 1024;   // bytes of saved inputs per profile
const headers = extra => ({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: headers(extra) });
const fail = (status, error, extra) => json({ error }, status, extra);

// Only the two known sections, each a plain object, within the size limit.
function cleanData(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const k of ["map", "plan"]) if (d[k] && typeof d[k] === "object" && !Array.isArray(d[k])) out[k] = d[k];
  return Buffer.byteLength(JSON.stringify(out)) <= MAX_DATA ? out : null;
}

export async function GET(request) {
  if (!dbReady()) return fail(503, "Profiles aren't available right now.");
  try {
    const u = await currentUser(request, true);
    if (!u) return json({ user: null });
    return json({ user: { id: u.id, name: u.name }, data: u.data || {}, updatedAt: u.data_updated_at });
  } catch (e) { console.error("account GET:", e.message); return fail(502, "Couldn't reach the profile service."); }
}

export async function POST(request) {
  if (!dbReady()) return fail(503, "Profiles aren't available right now.");
  const bad = requestProblem(request); if (bad) return fail(403, bad);
  const raw = await request.text();
  if (raw.length > MAX_DATA + 4096) return fail(413, "That's too much data.");
  let body; try { body = JSON.parse(raw); } catch { return fail(400, "Bad request"); }
  const action = body?.action;
  try {
    if (action === "signup") return await signup(request, body);
    if (action === "login") return await login(request, body);
    const me = await currentUser(request);
    if (action === "logout") { if (me) await endSession(me.tokenHash); return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, null) }); }
    if (!me) return fail(401, "Please sign in again.", { "set-cookie": sessionCookie(request, null) });
    if (action === "save") {
      const data = cleanData(body.data); if (!data) return fail(400, "Those inputs couldn't be saved (too large or not valid).");
      const at = new Date().toISOString();
      await rest(`app_users?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { data, data_updated_at: at } });
      return json({ ok: true, updatedAt: at });
    }
    if (action === "password") {
      const rows = await rest(`app_users?select=pass_hash&id=eq.${me.id}`);
      if (!(await verifyPassword(body.current, rows[0]?.pass_hash))) return fail(403, "Your current password is incorrect.");
      const problem = passwordProblem(body.next, me.name); if (problem) return fail(400, problem);
      await rest(`app_users?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { pass_hash: await hashPassword(body.next) } });
      await endOtherSessions(me.id, me.tokenHash);
      return json({ ok: true });
    }
    if (action === "delete") {
      const rows = await rest(`app_users?select=pass_hash&id=eq.${me.id}`);
      if (!(await verifyPassword(body.password, rows[0]?.pass_hash))) return fail(403, "Your password is incorrect.");
      await rest(`app_users?id=eq.${me.id}`, { method: "DELETE", prefer: "return=minimal" });   // sessions go with it (cascade)
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, null) });
    }
    return fail(400, "Bad request");
  } catch (e) { console.error("account POST:", action, e.message); return fail(502, "Something went wrong — please try again."); }
}

async function signup(request, body) {
  const ip = clientKey(request);
  if (await signupLimited(ip)) return fail(429, "Too many new profiles from this network — please try again later.");
  const name = cleanName(body.name); if (!name) return fail(400, "Enter a name (1–60 characters).");
  const problem = passwordProblem(body.password, name); if (problem) return fail(400, problem);
  const data = body.data == null ? {} : cleanData(body.data);
  if (!data) return fail(400, "Your inputs couldn't be saved (too large or not valid).");
  const pass_hash = await hashPassword(body.password);
  let id = null;
  for (let tries = 0; tries < 5 && !id; tries++) {
    const candidate = newId();
    try {
      await rest("app_users", { method: "POST", prefer: "return=minimal", body: { id: candidate, name, pass_hash, data, data_updated_at: new Date().toISOString(), last_login_at: new Date().toISOString() } });
      id = candidate;
    } catch (e) { if (!/Database 409/.test(e.message)) throw e; }   // id already taken → try another
  }
  if (!id) return fail(503, "Couldn't create a profile — please try again.");
  await recordAttempt("signup", [ip], true);
  const { token, expires } = await createSession(id);
  return json({ user: { id, name } }, 201, { "set-cookie": sessionCookie(request, token, expires) });
}

async function login(request, body) {
  const ip = clientKey(request);
  const id = String(body.id ?? "").replace(/\D/g, "");
  if (!validId(id) || typeof body.password !== "string" || body.password.length > 128) {
    await verifyPassword("x");   // keep timing similar to a real check
    return fail(401, "That ID or password is incorrect.");
  }
  if (await loginLocked(id, ip)) return fail(429, `Too many attempts — please wait ${LIMITS.windowMin} minutes and try again.`);
  const rows = await rest(`app_users?select=id,name,pass_hash,data,data_updated_at&id=eq.${id}`);
  const u = rows[0];
  const ok = await verifyPassword(body.password, u?.pass_hash);
  await recordAttempt("login", ["id:" + id, ip], ok);
  if (!ok) return fail(401, "That ID or password is incorrect.");
  await rest(`app_users?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { last_login_at: new Date().toISOString() } });
  const { token, expires } = await createSession(id);
  return json({ user: { id: u.id, name: u.name }, data: u.data || {}, updatedAt: u.data_updated_at }, 200, { "set-cookie": sessionCookie(request, token, expires) });
}
