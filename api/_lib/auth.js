// Accounts (username + password): password hashing, sessions, rate limits, photo checks and request checks for /api/account.
// Security model:
//   • Passwords are hashed with scrypt (memory-hard) and a random 16-byte salt, and compared in constant time.
//     Signing in with an unknown username still runs a hash check, so it takes as long as a wrong password.
//   • Sessions are 32 random bytes in an HttpOnly, SameSite=Strict cookie scoped to /api (page scripts can't read it);
//     only the token's SHA-256 is stored, and it expires after 30 days.
//   • State-changing requests must be same-origin JSON with a custom header (blocks cross-site request forgery).
//   • 5 wrong passwords lock a username for 15 minutes; 20 failures lock a network address; sign-ups are limited per
//     address. Addresses are kept only as keyed fingerprints.
//   • Names and usernames are validated; photos are checked by their actual bytes (JPEG/PNG/WebP) and size-capped.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { rest } from "./db.js";

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const COOKIE = "um_sid";
const SESSION_DAYS = 30;
const env = () => ({ url: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""), key: process.env.SUPABASE_SECRET_KEY || "" });
const keyHeaders = () => { const { key } = env(); return { apikey: key, ...(key.startsWith("ey") ? { authorization: "Bearer " + key } : {}) }; };

/* ---------------- passwords ---------------- */
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
export async function verifyPassword(pw, stored = DUMMY) {
  const [alg, N, r, p, salt, key] = String(stored).split("$");
  if (alg !== "scrypt" || typeof pw !== "string") return false;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(pw.normalize("NFKC"), Buffer.from(salt, "base64"), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want) && stored !== DUMMY;
}

/* ---------------- input rules ---------------- */
// Names: drop control, invisible/format (zero-width, bidirectional override) and line/paragraph-separator characters,
// which can be used to disguise a name.
export function cleanName(v) {
  const s = String(v ?? "").normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= 60 ? s : null;
}
/** Usernames: 3–20 characters, lowercase letters, digits, "_" or ".", starting with a letter. */
export function cleanUsername(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/^@/, "");
  return /^[a-z][a-z0-9_.]{2,19}$/.test(s) ? s : null;
}
const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou", "letmein1", "abc12345", "nepal123", "kathmandu"]);
/** Returns an error message, or "" if the password is acceptable. */
export function passwordProblem(pw, username = "") {
  if (typeof pw !== "string" || !pw) return "Enter a password.";
  if (pw.length < 8) return "Use at least 8 characters for the password.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess.";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Don't put your username in your password.";
  return "";
}

/* ---------------- sessions ---------------- */
const sha256 = s => createHash("sha256").update(s).digest("hex");
export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await rest("app_sessions", { method: "POST", prefer: "return=minimal", body: { token_hash: sha256(token), user_id: userId, expires_at: expires.toISOString() } });
  return { token, expires };
}
export function sessionCookie(request, token, expires) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const base = `${COOKIE}=${token || ""}; Path=/api; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  return token ? `${base}; Expires=${expires.toUTCString()}; Max-Age=${Math.floor((expires - Date.now()) / 1000)}` : `${base}; Max-Age=0`;
}
function readToken(request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`));
  return m ? m[1] : null;
}
/** The signed-in account for this request ({ id, username, name, avatar_url, data?, tokenHash }), or null. */
export async function currentUser(request, withData = false) {
  const token = readToken(request); if (!token) return null;
  const cols = "id,username,name,avatar_url" + (withData ? ",data,data_updated_at" : "");
  const rows = await rest(`app_sessions?select=expires_at,app_accounts(${cols})&token_hash=eq.${sha256(token)}&limit=1`);
  const s = rows[0];
  if (!s || new Date(s.expires_at) < new Date() || !s.app_accounts) return null;
  return { ...s.app_accounts, tokenHash: sha256(token) };
}
export const endSession = tokenHash => rest(`app_sessions?token_hash=eq.${tokenHash}`, { method: "DELETE", prefer: "return=minimal" });
export const endOtherSessions = (userId, keepHash) => rest(`app_sessions?user_id=eq.${userId}&token_hash=neq.${keepHash}`, { method: "DELETE", prefer: "return=minimal" });

/* ---------------- rate limits ---------------- */
export function clientKey(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  return "ip:" + createHmac("sha256", process.env.SUPABASE_SECRET_KEY || "uni-map").update(ip).digest("hex").slice(0, 32);
}
const sinceISO = min => new Date(Date.now() - min * 60e3).toISOString();
const count = async q => (await rest(`auth_attempts?select=id&${q}&limit=100`)).length;
export const LIMITS = { loginPerUser: 5, loginPerIp: 20, windowMin: 15, signupPerIp: 5, signupWindowMin: 60 };
export async function loginLocked(username, ipKey) {
  const since = sinceISO(LIMITS.windowMin);
  const [byUser, byIp] = await Promise.all([
    count(`kind=eq.login&key=eq.${encodeURIComponent("user:" + username)}&ok=eq.false&at=gte.${since}`),
    count(`kind=eq.login&key=eq.${encodeURIComponent(ipKey)}&ok=eq.false&at=gte.${since}`)]);
  return byUser >= LIMITS.loginPerUser || byIp >= LIMITS.loginPerIp;
}
export const signupLimited = async ipKey => (await count(`kind=eq.signup&key=eq.${encodeURIComponent(ipKey)}&at=gte.${sinceISO(LIMITS.signupWindowMin)}`)) >= LIMITS.signupPerIp;
export async function recordAttempt(kind, keys, ok) {
  await rest("auth_attempts", { method: "POST", prefer: "return=minimal", body: keys.map(key => ({ kind, key, ok })) });
  if (Math.random() < 0.05) await rest(`auth_attempts?at=lt.${sinceISO(24 * 60)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
}

/* ---------------- profile photos ---------------- */
const SIGS = { "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
               "image/png": b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
               "image/webp": b => b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP" };
export const MAX_PHOTO = 200 * 1024;
/** Check a base64 image by its real bytes. Returns { buf, mime } or an error string. */
export function checkPhoto(mime, base64) {
  if (!SIGS[mime]) return "Use a JPEG, PNG or WebP image.";
  if (typeof base64 !== "string" || base64.length > MAX_PHOTO * 1.4) return "That photo is too large.";
  const buf = Buffer.from(base64, "base64");
  if (!buf.length || buf.length > MAX_PHOTO) return "That photo is too large.";
  if (!SIGS[mime](buf)) return "That file isn't a valid image.";
  return { buf, mime };
}
export async function uploadPhoto(userId, { buf, mime }) {
  const { url } = env(), path = `${userId}/avatar`;
  const r = await fetch(`${url}/storage/v1/object/avatars/${path}`, {
    method: "POST", headers: { ...keyHeaders(), "content-type": mime, "x-upsert": "true", "cache-control": "3600" }, body: buf, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Storage ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return `${url}/storage/v1/object/public/avatars/${path}?v=${Date.now()}`;
}
export async function removePhoto(userId) {
  const { url } = env();
  await fetch(`${url}/storage/v1/object/avatars`, { method: "DELETE", headers: { ...keyHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [`${userId}/avatar`] }), signal: AbortSignal.timeout(10000) }).catch(() => {});
}

/* ---------------- request checks ---------------- */
/** Reject cross-site or non-JSON state-changing requests. Returns an error string, or "" if fine. */
export function requestProblem(request) {
  if (request.headers.get("x-requested-with") !== "unimap") return "Bad request";
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return "Bad request";
  const origin = request.headers.get("origin");
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host); } catch {}
    if (!ok) return "Cross-site request blocked";
  }
  return "";
}
