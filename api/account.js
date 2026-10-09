// /api/account — username + password accounts that keep your inputs (map filters, jobs, grade, budget planner) across
// browsers, plus your name and photo.
//   GET                                                → { user: { id, username, name, avatar } | null, data, updatedAt }
//   POST { action: "signup", username, password, data? } → create an account and sign in
//   POST { action: "login", username, password }       → sign in
//   POST { action: "username", username }              → { available }
//   POST { action: "save", data }                      → store your inputs
//   POST { action: "profile", name?, username? }       → change your name / username
//   POST { action: "photo", mime, image }              → set your photo (base64 JPEG/PNG/WebP ≤ 200 KB)
//   POST { action: "photo-remove" }
//   POST { action: "password", current, next }         → change password (signs out your other browsers)
//   POST { action: "delete", password }                → delete your account and everything saved with it
//   POST { action: "logout" }
// Security details are in _lib/auth.js.
import { dbReady, rest } from "./_lib/db.js";
import {
  hashPassword, verifyPassword, cleanName, cleanUsername, passwordProblem, createSession, sessionCookie, currentUser,
  endSession, endOtherSessions, clientKey, loginLocked, signupLimited, recordAttempt, LIMITS, requestProblem,
  checkPhoto, uploadPhoto, removePhoto, MAX_PHOTO,
} from "./_lib/auth.js";

const MAX_DATA = 200 * 1024;   // bytes of saved inputs per account
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });
const fail = (status, error, extra) => json({ error }, status, extra);
const setupMissing = e => /PGRST205|42P01|Could not find the table/.test(e?.message || "");
const SETUP_MSG = "Accounts aren't set up on the server yet — the database tables are missing.";
const pub = p => ({ id: p.id, username: p.username, name: p.name, avatar: p.avatar_url || null });
const WRONG = "That username or password is incorrect.";

// Only the two known sections, each a plain object, within the size limit.
function cleanData(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const k of ["map", "plan"]) if (d[k] && typeof d[k] === "object" && !Array.isArray(d[k])) out[k] = d[k];
  return Buffer.byteLength(JSON.stringify(out)) <= MAX_DATA ? out : null;
}
const findByUsername = async (u, cols = "id") => (await rest(`app_accounts?select=${cols}&username=eq.${encodeURIComponent(u)}&limit=1`))[0] || null;

export async function GET(request) {
  if (!dbReady()) return fail(503, "Accounts aren't available right now.");
  try {
    const u = await currentUser(request, true);
    if (!u) return json({ user: null });
    return json({ user: pub(u), data: u.data || {}, updatedAt: u.data_updated_at });
  } catch (e) { console.error("account GET:", e.message); return setupMissing(e) ? json({ user: null, setup: false }) : fail(502, "Couldn't reach the account service."); }
}

export async function POST(request) {
  if (!dbReady()) return fail(503, "Accounts aren't available right now.");
  const bad = requestProblem(request); if (bad) return fail(403, bad);
  const raw = await request.text();
  if (raw.length > Math.max(MAX_DATA, MAX_PHOTO * 1.4) + 4096) return fail(413, "That's too much data.");
  let body; try { body = JSON.parse(raw); } catch { return fail(400, "Bad request"); }
  const action = body?.action;
  try {
    if (action === "signup") return await signup(request, body);
    if (action === "login") return await login(request, body);
    if (action === "username") {
      const u = cleanUsername(body.username); if (!u) return json({ available: false });
      const me = await currentUser(request), hit = await findByUsername(u);
      return json({ available: !hit || hit.id === me?.id });
    }
    const me = await currentUser(request);
    if (action === "logout") { if (me) await endSession(me.tokenHash); return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, null) }); }
    if (!me) return fail(401, "Please sign in again.", { "set-cookie": sessionCookie(request, null) });

    if (action === "save") {
      const data = cleanData(body.data); if (!data) return fail(400, "Those inputs couldn't be saved (too large or not valid).");
      const at = new Date().toISOString();
      await rest(`app_accounts?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { data, data_updated_at: at } });
      return json({ ok: true, updatedAt: at });
    }
    if (action === "profile") {
      const patch = {};
      if (body.name != null) { const n = cleanName(body.name); if (!n) return fail(400, "Enter a name (1–60 characters)."); patch.name = n; }
      if (body.username != null) {
        const u = cleanUsername(body.username); if (!u) return fail(400, "Usernames are 3–20 letters, digits, _ or ., starting with a letter.");
        if (u !== me.username) { const hit = await findByUsername(u); if (hit && hit.id !== me.id) return fail(409, "That username is taken."); patch.username = u; }
      }
      if (!Object.keys(patch).length) return json({ user: pub(me) });
      try { await rest(`app_accounts?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: patch }); }
      catch (e) { if (/23505|409/.test(e.message)) return fail(409, "That username is taken."); throw e; }
      return json({ user: pub({ ...me, ...patch }) });
    }
    if (action === "photo") {
      const p = checkPhoto(body.mime, body.image); if (typeof p === "string") return fail(400, p);
      const avatar_url = await uploadPhoto(me.id, p);
      await rest(`app_accounts?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { avatar_url } });
      return json({ user: pub({ ...me, avatar_url }) });
    }
    if (action === "photo-remove") {
      await removePhoto(me.id);
      await rest(`app_accounts?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { avatar_url: null } });
      return json({ user: pub({ ...me, avatar_url: null }) });
    }
    if (action === "password") {
      const row = await findByUsername(me.username, "pass_hash");
      if (!(await verifyPassword(body.current, row?.pass_hash))) return fail(403, "Your current password is incorrect.");
      const problem = passwordProblem(body.next, me.username); if (problem) return fail(400, problem);
      await rest(`app_accounts?id=eq.${me.id}`, { method: "PATCH", prefer: "return=minimal", body: { pass_hash: await hashPassword(body.next) } });
      await endOtherSessions(me.id, me.tokenHash);
      return json({ ok: true });
    }
    if (action === "delete") {
      const row = await findByUsername(me.username, "pass_hash");
      if (!(await verifyPassword(body.password, row?.pass_hash))) return fail(403, "Your password is incorrect.");
      await removePhoto(me.id);
      await rest(`app_accounts?id=eq.${me.id}`, { method: "DELETE", prefer: "return=minimal" });   // sessions go with it
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, null) });
    }
    return fail(400, "Bad request");
  } catch (e) { console.error("account POST:", action, e.message); return fail(setupMissing(e) ? 503 : 502, setupMissing(e) ? SETUP_MSG : "Something went wrong — please try again."); }
}

async function signup(request, body) {
  const ip = clientKey(request);
  if (await signupLimited(ip)) return fail(429, "Too many new accounts from this network — please try again later.");
  const username = cleanUsername(body.username);
  if (!username) return fail(400, "Choose a username: 3–20 letters, digits, _ or ., starting with a letter.");
  const problem = passwordProblem(body.password, username); if (problem) return fail(400, problem);
  if (await findByUsername(username)) return fail(409, "That username is taken — choose another.");
  const data = body.data == null ? {} : cleanData(body.data);
  if (!data) return fail(400, "Your inputs couldn't be saved (too large or not valid).");
  const now = new Date().toISOString();
  let row;
  try {
    [row] = await rest("app_accounts", { method: "POST", prefer: "return=representation",
      body: { username, name: username, pass_hash: await hashPassword(body.password), data, data_updated_at: now, last_login_at: now } });
  } catch (e) { if (/23505|409/.test(e.message)) return fail(409, "That username is taken — choose another."); throw e; }
  await recordAttempt("signup", [ip], true);
  const { token, expires } = await createSession(row.id);
  return json({ user: pub(row), created: true, updatedAt: now }, 201, { "set-cookie": sessionCookie(request, token, expires) });
}

async function login(request, body) {
  const ip = clientKey(request);
  const username = cleanUsername(body.username);
  if (!username || typeof body.password !== "string" || body.password.length > 128) { await verifyPassword("x"); return fail(401, WRONG); }
  if (await loginLocked(username, ip)) return fail(429, `Too many attempts — please wait ${LIMITS.windowMin} minutes and try again.`);
  const u = await findByUsername(username, "id,username,name,avatar_url,pass_hash,data,data_updated_at");
  const ok = await verifyPassword(body.password, u?.pass_hash);
  await recordAttempt("login", ["user:" + username, ip], ok);
  if (!ok) return fail(401, WRONG);
  await rest(`app_accounts?id=eq.${u.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_login_at: new Date().toISOString() } });
  const { token, expires } = await createSession(u.id);
  return json({ user: pub(u), data: u.data || {}, updatedAt: u.data_updated_at }, 200, { "set-cookie": sessionCookie(request, token, expires) });
}
