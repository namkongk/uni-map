// User profiles: password hashing, sessions, rate limits and request checks for /api/account.
// Security model:
//   • Passwords are hashed with scrypt (memory-hard) and a random 16-byte salt; compared in constant time.
//   • The login id is 12 random digits (crypto.randomInt), unique by primary key.
//   • Sessions are 32 random bytes in an HttpOnly, SameSite=Strict cookie scoped to /api (page scripts can't read it);
//     only the token's SHA-256 is stored, and it expires after 30 days.
//   • State-changing requests must be same-origin JSON with a custom header (blocks cross-site form/fetch forgery).
//   • Failed sign-ins lock an id for 15 minutes after 5 failures, and a network address after 20; sign-ups are limited per
//     address. Addresses are kept only as HMAC fingerprints.
import { scrypt as scryptCb, randomBytes, randomInt, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { rest } from "./db.js";

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const COOKIE = "um_sid";
const SESSION_DAYS = 30;

/* ---------------- passwords ---------------- */
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
// A fixed hash to check against when the id doesn't exist, so "no such id" takes as long as "wrong password".
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
export async function verifyPassword(pw, stored = DUMMY) {
  const [alg, N, r, p, salt, key] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(String(pw).normalize("NFKC"), Buffer.from(salt, "base64"), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want) && stored !== DUMMY;
}

/* ---------------- input rules ---------------- */
export function cleanName(v) {
  const s = String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= 60 ? s : null;
}
const COMMON = new Set(["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou", "letmein1", "abc12345", "nepal123", "kathmandu"]);
/** Returns an error message, or "" if the password is acceptable. */
export function passwordProblem(pw, name = "") {
  if (typeof pw !== "string") return "Enter a password.";
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess.";
  if (name && pw.toLowerCase() === name.toLowerCase()) return "Don't use your name as the password.";
  return "";
}
export const validId = v => typeof v === "string" && /^\d{12}$/.test(v);
export const newId = () => String(randomInt(1e11, 1e12));   // 12 digits, never starting with 0

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
  const base = `${COOKIE}=${token ? token : ""}; Path=/api; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  return token ? `${base}; Expires=${expires.toUTCString()}; Max-Age=${Math.floor((expires - Date.now()) / 1000)}` : `${base}; Max-Age=0`;
}
export function readToken(request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`));
  return m ? m[1] : null;
}
/** The signed-in user for this request, or null. */
export async function currentUser(request, withData = false) {
  const token = readToken(request); if (!token) return null;
  const cols = withData ? "id,name,data,data_updated_at" : "id,name";
  const rows = await rest(`app_sessions?select=user_id,expires_at,app_users(${cols})&token_hash=eq.${sha256(token)}&limit=1`);
  const s = rows[0];
  if (!s || new Date(s.expires_at) < new Date() || !s.app_users) return null;
  return { ...s.app_users, tokenHash: sha256(token) };
}
export const endSession = tokenHash => rest(`app_sessions?token_hash=eq.${tokenHash}`, { method: "DELETE", prefer: "return=minimal" });
export const endOtherSessions = (userId, keepHash) => rest(`app_sessions?user_id=eq.${userId}&token_hash=neq.${keepHash}`, { method: "DELETE", prefer: "return=minimal" });

/* ---------------- request checks & rate limits ---------------- */
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
export function clientKey(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  // Keyed fingerprint: the raw address is never stored.
  return "ip:" + createHmac("sha256", process.env.SUPABASE_SECRET_KEY || "uni-map").update(ip).digest("hex").slice(0, 32);
}
async function failuresSince(kind, key, minutes) {
  const since = new Date(Date.now() - minutes * 60e3).toISOString();
  const rows = await rest(`auth_attempts?select=id&kind=eq.${kind}&key=eq.${encodeURIComponent(key)}&ok=eq.false&at=gte.${since}&limit=100`);
  return rows.length;
}
export const LIMITS = { loginPerId: 5, loginPerIp: 20, windowMin: 15, signupPerIp: 5, signupWindowMin: 60 };
export async function loginLocked(id, ipKey) {
  const [byId, byIp] = await Promise.all([failuresSince("login", "id:" + id, LIMITS.windowMin), failuresSince("login", ipKey, LIMITS.windowMin)]);
  return byId >= LIMITS.loginPerId || byIp >= LIMITS.loginPerIp;
}
export async function signupLimited(ipKey) {
  const since = new Date(Date.now() - LIMITS.signupWindowMin * 60e3).toISOString();
  const rows = await rest(`auth_attempts?select=id&kind=eq.signup&key=eq.${encodeURIComponent(ipKey)}&at=gte.${since}&limit=100`);
  return rows.length >= LIMITS.signupPerIp;
}
export async function recordAttempt(kind, keys, ok) {
  await rest("auth_attempts", { method: "POST", prefer: "return=minimal", body: keys.map(key => ({ kind, key, ok })) });
  // Housekeeping now and then: attempts older than a day aren't needed for any limit.
  if (Math.random() < 0.05) await rest(`auth_attempts?at=lt.${new Date(Date.now() - 864e5).toISOString()}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
}
