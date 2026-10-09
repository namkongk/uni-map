/* Uni Map — profile button, its menu, the sign-in / profile / settings modals, and syncing of your inputs.
   • Accounts are a username + password, checked by this site's server (/api/account); the session is an HttpOnly cookie
     this script can't read.
   • Your inputs live in this browser (localStorage "ukmap-state" for the map, "ukmap-plan" for the budget planner); when
     signed in they're also saved to your account, so signing in elsewhere loads them.
   • "ukmap-account" only remembers who's signed in, for display. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEYS = { map: "ukmap-state", plan: "ukmap-plan" }, META = "ukmap-account";
const APPEARANCE = ["theme", "glassT", "glassBlur"];   // kept in this browser on sign-out

const store = window.localStorage;
const rawSet = Storage.prototype.setItem;
const getJSON = k => { try { return JSON.parse(store.getItem(k) || "null"); } catch (e) { return null; } };
const setJSON = (k, v) => { try { rawSet.call(store, k, JSON.stringify(v)); } catch (e) {} };   // without triggering a sync
let meta = getJSON(META) || {};
if (meta.id && !/^[0-9a-f-]{36}$/i.test(meta.id)) meta = {};   // from an older profile system
const saveMeta = () => setJSON(META, meta);
const signedIn = () => !!meta.id;

/* ---------------- this site's API (/api/account) ---------------- */
async function api(body) {
  const opts = body ? { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "unimap" }, body: JSON.stringify(body), credentials: "same-origin" }
                    : { credentials: "same-origin" };
  const r = await fetch("api/account", opts);
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error(j.error || (r.status === 404 ? "Profiles need the site's server (npm run dev or Vercel)." : "Something went wrong.")); err.status = r.status; throw err; }
  return j;
}

/* ---------------- inputs ↔ profile ---------------- */
const localData = () => ({ map: getJSON(KEYS.map) || {}, plan: getJSON(KEYS.plan) || undefined });
const hasSaved = d => !!(d && ((d.map && Object.keys(d.map).length) || d.plan));
// Put a profile's saved inputs into this browser (keeping this browser's appearance settings).
function applyData(data) {
  const cur = getJSON(KEYS.map) || {};
  if (data && data.map) setJSON(KEYS.map, { ...data.map, ...Object.fromEntries(APPEARANCE.filter(k => cur[k] != null).map(k => [k, cur[k]])) });
  if (data && data.plan) setJSON(KEYS.plan, data.plan);
}
const setUser = (u, extra = {}) => { meta = { ...meta, id: u.id, username: u.username, name: u.name, avatar: u.avatar || null, ...extra }; saveMeta(); };

let pushT = null, pushing = false;
// The pages save their state while starting up; those writes aren't your edits, so nothing is sent until the start-up
// check below has decided whether this browser or the profile has the newer inputs.
let ready = false;
function schedulePush() {
  if (!signedIn() || !ready) return;
  meta.dirty = true; saveMeta(); setStatus("Saving…");
  clearTimeout(pushT); pushT = setTimeout(push, 1500);
}
async function push(keepalive) {
  if (!signedIn() || pushing) return;
  pushing = true;
  try {
    if (keepalive) {
      fetch("api/account", { method: "POST", keepalive: true, credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "unimap" }, body: JSON.stringify({ action: "save", data: localData() }) });
      return;
    }
    const j = await api({ action: "save", data: localData() });
    meta.dirty = false; meta.syncedAt = j.updatedAt; saveMeta(); setStatus("Saved to your profile");
  } catch (e) {
    if (e.status === 401) { signOutLocal(false); syncButton(); setStatus(""); }
    else setStatus("Couldn't save — will retry");
  } finally { pushing = false; }
}
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (this === store && (k === KEYS.map || k === KEYS.plan)) schedulePush();
};
addEventListener("pagehide", () => { if (signedIn() && meta.dirty) push(true); });
function signOutLocal(clearInputs) {
  meta = {}; saveMeta();
  if (clearInputs) {   // shared computers: don't leave your inputs behind (appearance settings stay)
    const cur = getJSON(KEYS.map) || {};
    setJSON(KEYS.map, Object.fromEntries(APPEARANCE.filter(k => cur[k] != null).map(k => [k, cur[k]])));
    try { store.removeItem(KEYS.plan); } catch (e) {}
  }
}
// After signing in or creating an account: remember who it is, and load or save inputs as needed.
async function finishSignIn(j) {
  setUser(j.user, { syncedAt: j.updatedAt, dirty: false });
  if (!j.created && hasSaved(j.data)) { applyData(j.data); return { reload: true }; }
  if (!j.created) await push();   // an account with nothing saved yet: keep this browser's inputs
  return { reload: false };
}

/* ---------------- icons ---------------- */
const SVG = p => `<svg viewBox="0 0 20 20" aria-hidden="true">${p}</svg>`;
const I = {
  user: SVG(`<circle cx="10" cy="7.2" r="3.2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M3.8 16.6c.9-3 3.4-4.7 6.2-4.7s5.3 1.7 6.2 4.7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>`),
  in: SVG(`<path d="M8 4.5h6.5v11H8M11.5 10H3.5m3-3-3 3 3 3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  up: SVG(`<circle cx="8" cy="7" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M2.8 16c.8-2.7 2.8-4.2 5.2-4.2 1 0 1.9.2 2.7.7M15 11v6m-3-3h6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>`),
  out: SVG(`<path d="M12 4.5H5.5v11H12M8.5 10h8m-3-3 3 3-3 3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  set: SVG(`<path d="M4 6h7m4 0h1M4 14h1m4 0h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="6" r="2" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="7" cy="14" r="2" stroke="currentColor" stroke-width="1.7" fill="none"/>`),
  x: SVG(`<path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
  cam: SVG(`<path d="M3.5 7.2c0-.9.7-1.6 1.6-1.6h1.6l1.2-1.7h4.2l1.2 1.7h1.6c.9 0 1.6.7 1.6 1.6v6.6c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="10" cy="10.4" r="2.6" stroke="currentColor" stroke-width="1.6" fill="none"/>`),
};
// Photo or initial, never raw HTML from the profile.
const avatarHTML = (cls = "") => meta.avatar && /^https:\/\//.test(meta.avatar)
  ? `<img class="acct-avatar ${cls}" src="${esc(meta.avatar)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="acct-avatar ${cls}" aria-hidden="true">${esc((meta.name || "?").trim().charAt(0).toUpperCase())}</span>`;

/* ---------------- dialogs ---------------- */
const btn = $("settingsBtn"), settings = $("settings");
function makeDialog(id, title, inner) {
  const d = document.createElement("dialog");
  d.className = "acct-dlg glass"; d.id = id; d.setAttribute("aria-labelledby", id + "T");
  d.innerHTML = `<div class="acct-top"><h2 id="${id}T">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${I.x}</button></div><div class="acct-scroll">${inner}</div>`;
  document.body.appendChild(d);
  d.querySelector("[data-close]").addEventListener("click", () => d.close());
  d.addEventListener("click", e => { if (e.target === d) d.close(); });   // click on the backdrop
  d.addEventListener("close", () => btn.focus());
  return d;
}
const authDlg = makeDialog("authDlg", "Sign in", `<section class="acct-body" id="authBody" aria-live="polite"></section>`);
const profDlg = makeDialog("acctDlg", "Your profile", `<section class="acct-body" id="profBody" aria-live="polite"></section>`);
const setDlg = makeDialog("setDlg", "Settings", `<div id="setBody"></div>`);
if (settings) { settings.hidden = false; settings.classList.remove("glass"); settings.classList.add("settings-in"); settings.querySelector("h3")?.remove(); $("setBody").appendChild(settings); }

/* ---------------- the menu under the profile button ---------------- */
const menu = document.createElement("div");
menu.className = "acct-menu glass"; menu.id = "acctMenu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Profile and settings"); menu.hidden = true;
document.body.appendChild(menu);
btn.setAttribute("aria-label", "Profile and settings"); btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-controls", "acctMenu"); btn.setAttribute("aria-expanded", "false");
function renderMenu() {
  const item = (act, icon, label) => `<button type="button" role="menuitem" data-act="${act}">${icon}<span>${label}</span></button>`;
  menu.innerHTML = (signedIn()
    ? `<div class="am-who">${avatarHTML("sm")}<div><b>${esc(meta.name)}</b><span>@${esc(meta.username)}</span></div></div>` + item("profile", I.user, "My profile") + item("signout", I.out, "Sign out")
    : `<p class="am-note">Save your data and use it anywhere. No email — just a username &amp; password.</p>` + item("signin", I.in, "Sign in") + item("signup", I.up, "Create account"))
    + `<div class="am-sep" aria-hidden="true"></div>` + item("settings", I.set, "Settings");
}
function setMenu(open) {
  menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  renderMenu();
  const r = btn.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--uiz")) || 1;   // the menu is zoomed with the rest of the interface
  menu.style.top = (r.bottom + 10) / z + "px"; menu.style.right = Math.max(8, innerWidth - r.right) / z + "px";
  menu.querySelector("button")?.focus();
}
btn.addEventListener("click", e => { e.stopPropagation(); setMenu(menu.hidden); });
document.addEventListener("pointerdown", e => { if (!menu.hidden && !e.target.closest("#acctMenu, #settingsBtn")) setMenu(false); });
addEventListener("resize", () => { if (!menu.hidden) setMenu(false); });
menu.addEventListener("keydown", e => {
  const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  else if (e.key === "Escape") { e.preventDefault(); setMenu(false); btn.focus(); }
  else if (e.key === "Tab") setMenu(false);
});
menu.addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  setMenu(false);
  const act = b.dataset.act;
  if (act === "settings") { setDlg.showModal(); setDlg.querySelector("button, input")?.focus(); }
  else if (act === "signout") signOut();
  else if (act === "profile") openProfile();
  else openAuth(act);
});
function syncButton() {
  document.documentElement.classList.toggle("signed-in", signedIn());   // hides the "sign in to save" prompts
  btn.innerHTML = signedIn() ? avatarHTML("btn") : I.user;
  btn.classList.toggle("signed-in", signedIn());
  btn.title = signedIn() ? `Signed in as ${meta.name} (@${meta.username})` : "Profile & settings";
}

// "Sign in" prompts on the pages: <button data-signin="signup|signin">
document.addEventListener("click", e => { const b = e.target.closest("[data-signin]"); if (b && !signedIn()) { e.preventDefault(); openAuth(b.dataset.signin === "signin" ? "signin" : "signup"); } });

/* ---------------- shared form bits ---------------- */
const pwField = (id, label, auto) => `<label class="acct-f"><span>${label}</span><span class="pw"><input id="${id}" type="password" autocomplete="${auto}" minlength="8" maxlength="128" required>
  <button type="button" class="pw-eye" data-for="${id}" aria-label="Show password" aria-pressed="false">Show</button></span></label>`;
const field = (id, label, attrs) => `<label class="acct-f"><span>${label}</span><input id="${id}" ${attrs}></label>`;
function wire(root) {
  root.querySelectorAll(".pw-eye").forEach(b => b.addEventListener("click", () => { const i = $(b.dataset.for), show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide password" : "Show password"); }));
}
const msg = (id, t, ok) => { const el = $(id); if (el) { el.textContent = t; el.className = "acct-msg " + (ok ? "ok" : "err"); } };
const busy = (form, on) => form.querySelectorAll("button, input").forEach(x => x.disabled = on);
const pwProblem = pw => pw.length < 8 ? "Use at least 8 characters for the password." : pw.length > 128 ? "Use at most 128 characters." : "";
const userField = (id, label, auto, value = "") => `<label class="acct-f"><span>${label}</span><span class="at"><b>@</b><input id="${id}" autocomplete="${auto}" maxlength="20" required spellcheck="false" autocapitalize="off" value="${esc(value)}"></span></label>`;
const USER_RE = /^[a-z][a-z0-9_.]{2,19}$/;

/* ---------------- sign in / create account ---------------- */
let authView = "signin";
const AUTH_TITLE = { signin: "Sign in", signup: "Create account", done: "You're signed in" };
function openAuth(v) { authView = v; renderAuth(); if (!authDlg.open) authDlg.showModal(); authDlg.querySelector("input")?.focus(); }
function renderAuth(info = "") {
  $("authDlgT").textContent = AUTH_TITLE[authView];
  const body = $("authBody"), v = authView;
  if (v === "done") body.innerHTML = `<p class="acct-lead">${info}</p><button type="button" class="btn-primary" id="authOk">Continue</button>`;
  else body.innerHTML = `<p class="acct-lead">Save your shortlist, filters and budget plan, and open them on any device. <b>No email needed</b> — just a username and password.</p>
      <div class="acct-tabs" role="tablist"><button type="button" role="tab" aria-selected="${v === "signin"}" data-v="signin">Sign in</button><button type="button" role="tab" aria-selected="${v === "signup"}" data-v="signup">Create account</button></div>
      ${v === "signin" ? `<form class="acct-form" id="authForm" novalidate>
          ${userField("aUser", "Username", "username")}
          ${pwField("aPw", "Password", "current-password")}
          <button type="submit" class="btn-primary">Sign in</button></form>`
        : `<form class="acct-form" id="authForm" novalidate>
          ${userField("aUser", "Username <i>(3–20 letters, digits, _ or .)</i>", "username")}<small class="acct-hint" id="aUserHint"></small>
          ${pwField("aPw", "Password <i>(at least 8 characters)</i>", "new-password")}
          ${pwField("aPw2", "Confirm password", "new-password")}
          <button type="submit" class="btn-primary">Create account</button>
          <p class="acct-warn"><b>Forgotten passwords can't be recovered</b> — keep it safe.</p>
          <p class="acct-hint">Your current inputs move to the new account.</p></form>`}
      <p class="acct-msg" id="authMsg" role="status"></p>`;
  wire(body);
  body.querySelectorAll(".acct-tabs button").forEach(b => b.addEventListener("click", () => openAuth(b.dataset.v)));
  $("authOk")?.addEventListener("click", () => authDlg.close());
  if ($("aUser")) {
    let t;
    $("aUser").addEventListener("input", e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); if (v === "signup") { clearTimeout(t); t = setTimeout(checkUsername, 450); } });
  }
  $("authForm")?.addEventListener("submit", v === "signin" ? doSignIn : doSignUp);
}
async function checkUsername() {
  const u = $("aUser")?.value || "", hint = $("aUserHint"); if (!hint) return true;
  if (!USER_RE.test(u)) { hint.textContent = u ? "3–20 characters, starting with a letter." : ""; hint.className = "acct-hint"; return false; }
  try { const j = await api({ action: "username", username: u }); hint.textContent = j.available ? `@${u} is available` : `@${u} is taken`; hint.className = "acct-hint " + (j.available ? "ok" : "err"); return j.available; }
  catch (e) { hint.textContent = ""; return true; }
}
async function doSignIn(e) {
  e.preventDefault(); const f = e.currentTarget;
  const username = $("aUser").value, pw = $("aPw").value;
  if (!username) return msg("authMsg", "Enter your username.");
  if (!pw) return msg("authMsg", "Enter your password.");
  busy(f, true); msg("authMsg", "Signing in…", true);
  try {
    const r = await finishSignIn(await api({ action: "login", username, password: pw }));
    if (r.reload) { location.reload(); return; }
    syncButton(); authDlg.close();
  } catch (err) { msg("authMsg", err.message); busy(f, false); $("aPw").select(); }
}
async function doSignUp(e) {
  e.preventDefault(); const f = e.currentTarget;
  const username = $("aUser").value, pw = $("aPw").value, pw2 = $("aPw2").value;
  if (!USER_RE.test(username)) return msg("authMsg", "Username: 3–20 letters, digits, _ or ., starting with a letter.");
  const p = pwProblem(pw); if (p) return msg("authMsg", p);
  if (pw !== pw2) return msg("authMsg", "The two passwords don't match.");
  busy(f, true); msg("authMsg", "Creating your account…", true);
  try {
    await finishSignIn(await api({ action: "signup", username, password: pw, data: localData() }));
    syncButton(); authView = "done"; renderAuth(`Welcome, <b>@${esc(username)}</b>! Add a name and photo in <b>My profile</b>.`);
    $("authOk").focus();
  } catch (err) { msg("authMsg", err.message); busy(f, false); }
}

/* ---------------- your profile: photo, name, username, password, delete ---------------- */
let lastStatus = "";
function setStatus(t) { lastStatus = t; const el = $("acctStatus"); if (el) el.textContent = t; }
function openProfile() { renderProfile(); if (!profDlg.open) profDlg.showModal(); }
function renderProfile() {
  const body = $("profBody");
  body.innerHTML = `<div class="acct-photo">${avatarHTML("lg")}
      <div class="acct-photo-btns"><label class="btn-plain sm" for="pFile">${I.cam}<span>${meta.avatar ? "Change photo" : "Add photo"}</span></label>
        <input type="file" id="pFile" accept="image/jpeg,image/png,image/webp" hidden>
        ${meta.avatar ? `<button type="button" class="link-btn small danger" id="pPhotoRm">Remove photo</button>` : ""}
        <span class="acct-hint">JPEG, PNG or WebP.</span></div></div>
    <form class="acct-form" id="pForm" novalidate>
      ${field("pName", "Name", `autocomplete="name" maxlength="60" required value="${esc(meta.name)}"`)}
      ${userField("pUser", "Username", "username", meta.username)}
      <button type="submit" class="btn-primary">Save changes</button></form>
    <p class="acct-msg" id="pMsg" role="status"></p>
    <p class="acct-sync"><span class="dot" aria-hidden="true"></span><span id="acctStatus">${esc(lastStatus || (meta.dirty ? "Saving…" : "Your inputs are saved to this profile"))}</span></p>
    <p class="acct-note">Your inputs and budget plan save as you go.</p>
    <div class="acct-actions"><button type="button" class="btn-plain ghost" id="pPwBtn" aria-expanded="false">Change password</button>
      <button type="button" class="btn-plain ghost danger" id="pDelBtn" aria-expanded="false">Delete profile</button></div>
    <form class="acct-form" id="pPwForm" hidden>${pwField("pPwCur", "Current password", "current-password")}${pwField("pPwNew", "New password <i>(at least 8 characters)</i>", "new-password")}
      <button type="submit" class="btn-primary">Change password</button></form>
    <form class="acct-form" id="pDelForm" hidden><p class="acct-warn">Permanently deletes your account and saved data.</p>${pwField("pDelPw", "Password", "current-password")}
      <button type="submit" class="btn-primary danger">Delete my account</button></form>
    <p class="acct-msg" id="pMsg2" role="status"></p>`;
  wire(body);
  $("pUser").addEventListener("input", e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""); });
  $("pForm").addEventListener("submit", saveProfile);
  $("pFile").addEventListener("change", uploadPhoto);
  $("pPhotoRm")?.addEventListener("click", removePhoto);
  const toggle = (b, f) => $(b).addEventListener("click", () => { const el = $(f), o = el.hidden; ["pPwForm", "pDelForm"].forEach(x => $(x).hidden = true); el.hidden = !o; $(b).setAttribute("aria-expanded", String(o)); if (o) el.querySelector("input").focus(); });
  toggle("pPwBtn", "pPwForm"); toggle("pDelBtn", "pDelForm");
  $("pPwForm").addEventListener("submit", changePassword);
  $("pDelForm").addEventListener("submit", deleteProfile);
}
async function saveProfile(e) {
  e.preventDefault(); const f = e.currentTarget;
  const name = $("pName").value.trim(), username = $("pUser").value;
  if (!name) return msg("pMsg", "Enter your name.");
  if (!USER_RE.test(username)) return msg("pMsg", "Usernames are 3–20 letters, digits, _ or ., starting with a letter.");
  busy(f, true);
  try { const j = await api({ action: "profile", name, username }); setUser(j.user); syncButton(); renderProfile(); msg("pMsg", "Saved.", true); }
  catch (err) { msg("pMsg", err.message); busy(f, false); }
}
// Resize to a 256 px square in the browser (also drops any hidden photo metadata), then upload.
async function uploadPhoto(e) {
  const file = e.target.files[0]; if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return msg("pMsg", "Use a JPEG, PNG or WebP image.");
  if (file.size > 15e6) return msg("pMsg", "That image is too large.");
  msg("pMsg", "Uploading…", true);
  try {
    const img = await createImageBitmap(file);
    const c = document.createElement("canvas"), S = 256; c.width = c.height = S;
    const side = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
    let mime = "image/webp", url = c.toDataURL(mime, 0.85);
    if (!url.startsWith("data:image/webp")) { mime = "image/jpeg"; url = c.toDataURL(mime, 0.85); }
    const j = await api({ action: "photo", mime, image: url.split(",")[1] });
    setUser(j.user); syncButton(); renderProfile(); msg("pMsg", "Photo updated.", true);
  } catch (err) { msg("pMsg", err.message || "Couldn't read that image."); }
}
async function removePhoto() {
  try { const j = await api({ action: "photo-remove" }); setUser(j.user); syncButton(); renderProfile(); msg("pMsg", "Photo removed.", true); }
  catch (err) { msg("pMsg", err.message); }
}
async function changePassword(e) {
  e.preventDefault(); const f = e.currentTarget;
  const p = pwProblem($("pPwNew").value); if (p) return msg("pMsg2", p);
  busy(f, true);
  try { await api({ action: "password", current: $("pPwCur").value, next: $("pPwNew").value }); f.reset(); f.hidden = true; msg("pMsg2", "Password changed. Your other browsers have been signed out.", true); }
  catch (err) { msg("pMsg2", err.message); }
  busy(f, false);
}
async function deleteProfile(e) {
  e.preventDefault(); const f = e.currentTarget;
  busy(f, true);
  try { await api({ action: "delete", password: $("pDelPw").value }); signOutLocal(true); location.reload(); }
  catch (err) { msg("pMsg2", err.message); busy(f, false); }
}
async function signOut() {
  if (meta.dirty) await push();
  try { await api({ action: "logout" }); } catch (e) {}
  signOutLocal(true); location.reload();
}

/* ---------------- on load ---------------- */
syncButton();
(async () => {
  let j; try { j = await api(); } catch (e) { ready = true; return; }   // offline / no server: keep working locally
  if (!j.user) { if (signedIn()) { signOutLocal(false); syncButton(); } ready = true; return; }
  const switched = meta.id !== j.user.id;
  const newer = j.updatedAt && (!meta.syncedAt || j.updatedAt > meta.syncedAt);
  setUser(j.user);
  if ((switched || (newer && !meta.dirty)) && hasSaved(j.data) && !sessionStorage.getItem("ukmap-synced")) {
    // Saved on another device since this browser last synced: load it (once per tab, to avoid loops).
    meta.syncedAt = j.updatedAt; meta.dirty = false; saveMeta(); applyData(j.data);
    sessionStorage.setItem("ukmap-synced", "1"); location.reload(); return;
  }
  syncButton(); ready = true;
  if (meta.dirty) push();
})();
})();
