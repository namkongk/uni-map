/* Uni Map — profile button + modal (sign in / create a profile / appearance) and syncing of your inputs.
   Your inputs live in this browser (localStorage "ukmap-state" for the map, "ukmap-plan" for the budget planner); when
   you're signed in they're also saved to your profile, and signing in on another browser loads them there.
   The session is an HttpOnly cookie this script can't read; "ukmap-account" only remembers who's signed in for display. */
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
const saveMeta = () => setJSON(META, meta);
const signedIn = () => !!meta.id;

/* ---------------- talking to /api/account ---------------- */
async function api(body) {
  const opts = body ? { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "unimap" }, body: JSON.stringify(body), credentials: "same-origin" }
                    : { credentials: "same-origin" };
  const r = await fetch("api/account", opts);
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error(j.error || (r.status === 404 ? "Profiles need the site's server (npm run dev or Vercel)." : "Something went wrong.")); err.status = r.status; throw err; }
  return j;
}
const localData = () => ({ map: getJSON(KEYS.map) || {}, plan: getJSON(KEYS.plan) || undefined });
// Put a profile's saved inputs into this browser (keeping this browser's appearance settings).
function applyData(data) {
  const cur = getJSON(KEYS.map) || {};
  if (data && data.map) setJSON(KEYS.map, { ...data.map, ...Object.fromEntries(APPEARANCE.filter(k => cur[k] != null).map(k => [k, cur[k]])) });
  if (data && data.plan) setJSON(KEYS.plan, data.plan);
}

/* ---------------- syncing: any change to your inputs is saved to your profile shortly after ---------------- */
let pushT = null, pushing = false;
// The pages save their state while starting up; those writes aren't your edits, so nothing is sent until the start-up
// check below has decided whether this browser or the profile has the newer inputs.
let ready = false, changedDuringStartup = false;
function schedulePush() {
  if (!signedIn()) return;
  if (!ready) { changedDuringStartup = true; return; }
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
    if (e.status === 401) { signOutLocal(false); setStatus(""); toast("You've been signed out — sign in again to keep saving."); }
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

/* ---------------- the profile button and modal ---------------- */
const btn = $("settingsBtn"), settings = $("settings");
const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7.2" r="3.2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M3.8 16.6c.9-3 3.4-4.7 6.2-4.7s5.3 1.7 6.2 4.7" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>`;
const dlg = document.createElement("dialog");
dlg.className = "acct-dlg glass"; dlg.id = "acctDlg"; dlg.setAttribute("aria-labelledby", "acctTitle");
dlg.innerHTML = `<div class="acct-top"><h2 id="acctTitle">Profile</h2>
    <button type="button" class="icon-btn" id="acctClose" aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button></div>
  <div class="acct-scroll"><section class="acct-body" id="acctBody" aria-live="polite"></section>
  <div class="acct-sep" aria-hidden="true"></div><div id="acctAppearance"></div></div>`;
document.body.appendChild(dlg);
if (settings) { settings.hidden = false; settings.classList.remove("glass"); settings.classList.add("settings-in"); $("acctAppearance").appendChild(settings); }
btn.setAttribute("aria-label", "Profile and settings"); btn.setAttribute("aria-haspopup", "dialog"); btn.removeAttribute("aria-controls");
function syncButton() {
  btn.innerHTML = signedIn() ? `<span class="acct-initial" aria-hidden="true">${esc((meta.name || "?").trim().charAt(0).toUpperCase())}</span>` : ICON;
  btn.classList.toggle("signed-in", signedIn());
  btn.title = signedIn() ? `Signed in as ${meta.name} — profile & settings` : "Profile & settings";
}
btn.addEventListener("click", e => { e.stopPropagation(); open(); });
$("acctClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });   // click on the backdrop
dlg.addEventListener("close", () => { btn.focus(); if (view === "newid") { view = "in"; } });
function open() { render(); dlg.showModal(); dlg.querySelector("input, .acct-tabs button[aria-selected='true']")?.focus(); }

let view = "signin", lastStatus = "";
const statusEl = () => $("acctStatus");
function setStatus(t) { lastStatus = t; const el = statusEl(); if (el) el.textContent = t; }
function toast(t) { const el = $("acctMsg"); if (el) { el.textContent = t; el.className = "acct-msg"; } }
const fmtId = id => String(id).replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
const pwField = (id, label, auto) => `<label class="acct-f"><span>${label}</span><span class="pw"><input id="${id}" type="password" autocomplete="${auto}" minlength="8" maxlength="128" required>
  <button type="button" class="pw-eye" data-for="${id}" aria-label="Show password" aria-pressed="false">Show</button></span></label>`;

function render() {
  const body = $("acctBody");
  if (view === "newid") {
    body.innerHTML = `<div class="acct-newid"><p class="acct-lead">Your profile is ready, ${esc(meta.name)}.</p>
      <p class="acct-k">Your ID</p><div class="acct-id"><b id="acctIdTxt">${fmtId(meta.id)}</b><button type="button" class="btn-plain sm" id="acctCopy">Copy</button></div>
      <p class="acct-warn"><b>Save this ID now.</b> You need it with your password to sign in on any device. There's no email on the profile, so a lost ID or password can't be recovered.</p>
      <button type="button" class="btn-primary" id="acctDone">I've saved it</button></div>`;
    $("acctCopy").addEventListener("click", copyId); $("acctDone").addEventListener("click", () => { view = "in"; render(); });
    return;
  }
  if (signedIn()) {
    body.innerHTML = `<div class="acct-in"><div class="acct-who"><span class="acct-avatar" aria-hidden="true">${esc(meta.name.charAt(0).toUpperCase())}</span>
        <div><b>${esc(meta.name)}</b><span class="acct-sub">ID <span class="mono">${fmtId(meta.id)}</span> <button type="button" class="link-btn" id="acctCopy">Copy</button></span></div></div>
      <p class="acct-sync"><span class="dot" aria-hidden="true"></span><span id="acctStatus">${esc(lastStatus || (meta.dirty ? "Saving…" : "Your inputs are saved to this profile"))}</span></p>
      <p class="acct-note">Map filters, jobs, grade, currency and your budget planner are saved as you go, and load wherever you sign in.</p>
      <div class="acct-actions"><button type="button" class="btn-plain" id="acctOut">Sign out</button>
        <button type="button" class="btn-plain ghost" id="acctPwBtn" aria-expanded="false">Change password</button>
        <button type="button" class="btn-plain ghost danger" id="acctDelBtn" aria-expanded="false">Delete profile</button></div>
      <form class="acct-form" id="acctPwForm" hidden>${pwField("acctPwCur", "Current password", "current-password")}${pwField("acctPwNew", "New password", "new-password")}
        <button type="submit" class="btn-primary">Change password</button><p class="acct-hint">Other browsers signed in to this profile will be signed out.</p></form>
      <form class="acct-form" id="acctDelForm" hidden><p class="acct-warn">This permanently deletes your profile and everything saved with it.</p>${pwField("acctDelPw", "Password", "current-password")}
        <button type="submit" class="btn-primary danger">Delete my profile</button></form>
      <p class="acct-msg" id="acctMsg" role="status"></p></div>`;
    $("acctCopy").addEventListener("click", copyId);
    $("acctOut").addEventListener("click", signOut);
    const toggle = (b, f) => $(b).addEventListener("click", () => { const el = $(f), o = el.hidden; ["acctPwForm", "acctDelForm"].forEach(x => $(x).hidden = true); el.hidden = !o; $(b).setAttribute("aria-expanded", String(o)); if (o) el.querySelector("input").focus(); });
    toggle("acctPwBtn", "acctPwForm"); toggle("acctDelBtn", "acctDelForm");
    $("acctPwForm").addEventListener("submit", changePassword);
    $("acctDelForm").addEventListener("submit", deleteProfile);
  } else {
    const signin = view === "signin";
    body.innerHTML = `<p class="acct-lead">Save your inputs and budget plan, and pick them up on any device.</p>
      <div class="acct-tabs" role="tablist"><button type="button" role="tab" aria-selected="${signin}" data-v="signin">Sign in</button><button type="button" role="tab" aria-selected="${!signin}" data-v="signup">Create profile</button></div>
      ${signin ? `<form class="acct-form" id="acctForm" novalidate>
          <label class="acct-f"><span>Your 12-digit ID</span><input id="acctId" inputmode="numeric" autocomplete="username" placeholder="1234 5678 9012" maxlength="14" required></label>
          ${pwField("acctPw", "Password", "current-password")}
          <button type="submit" class="btn-primary">Sign in</button></form>`
        : `<form class="acct-form" id="acctForm" novalidate>
          <label class="acct-f"><span>Name</span><input id="acctName" autocomplete="name" maxlength="60" required placeholder="e.g. Nam"></label>
          ${pwField("acctPw", "Password <i>(at least 8 characters)</i>", "new-password")}
          ${pwField("acctPw2", "Confirm password", "new-password")}
          <button type="submit" class="btn-primary">Create profile</button>
          <p class="acct-hint">You'll get a 12-digit ID to sign in with. Your current inputs are saved to the new profile.</p></form>`}
      <p class="acct-msg" id="acctMsg" role="status"></p>`;
    body.querySelectorAll(".acct-tabs button").forEach(b => b.addEventListener("click", () => { view = b.dataset.v; render(); body.querySelector("input")?.focus(); }));
    $("acctForm").addEventListener("submit", signin ? signIn : signUp);
    if (signin) $("acctId").addEventListener("input", e => { const d = e.target.value.replace(/\D/g, "").slice(0, 12); e.target.value = d.replace(/(\d{4})(?=\d)/g, "$1 "); });
  }
  body.querySelectorAll(".pw-eye").forEach(b => b.addEventListener("click", () => { const i = $(b.dataset.for), show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide password" : "Show password"); }));
}
function msg(t, ok) { const el = $("acctMsg"); if (el) { el.textContent = t; el.className = "acct-msg " + (ok ? "ok" : "err"); } }
function busy(form, on) { form.querySelectorAll("button, input").forEach(x => x.disabled = on); }
async function copyId() { try { await navigator.clipboard.writeText(meta.id); toast("ID copied"); const b = $("acctCopy"); if (b) { b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1500); } } catch (e) { toast("Select the ID and copy it"); } }

async function signIn(e) {
  e.preventDefault(); const f = e.currentTarget;
  const id = $("acctId").value.replace(/\D/g, ""), pw = $("acctPw").value;
  if (id.length !== 12) return msg("Enter your 12-digit ID.");
  if (!pw) return msg("Enter your password.");
  busy(f, true); msg("Signing in…", true);
  try {
    const j = await api({ action: "login", id, password: pw });
    const hasSaved = j.data && (j.data.map && Object.keys(j.data.map).length || j.data.plan);
    meta = { id: j.user.id, name: j.user.name, syncedAt: j.updatedAt, dirty: false };
    if (hasSaved) { applyData(j.data); saveMeta(); location.reload(); return; }
    saveMeta(); await push(); syncButton(); render();      // empty profile: keep what's in this browser and save it there
  } catch (err) { msg(err.message); busy(f, false); $("acctPw").select(); }
}
async function signUp(e) {
  e.preventDefault(); const f = e.currentTarget;
  const name = $("acctName").value.trim(), pw = $("acctPw").value, pw2 = $("acctPw2").value;
  if (!name) return msg("Enter your name.");
  if (pw.length < 8) return msg("Use at least 8 characters for the password.");
  if (pw !== pw2) return msg("The two passwords don't match.");
  busy(f, true); msg("Creating your profile…", true);
  try {
    const j = await api({ action: "signup", name, password: pw, data: localData() });
    meta = { id: j.user.id, name: j.user.name, syncedAt: new Date().toISOString(), dirty: false }; saveMeta();
    view = "newid"; syncButton(); render(); $("acctDone").focus();
  } catch (err) { msg(err.message); busy(f, false); }
}
async function signOut() {
  if (meta.dirty) await push();
  try { await api({ action: "logout" }); } catch (e) {}
  signOutLocal(true); location.reload();
}
async function changePassword(e) {
  e.preventDefault(); const f = e.currentTarget;
  busy(f, true);
  try { await api({ action: "password", current: $("acctPwCur").value, next: $("acctPwNew").value }); f.reset(); f.hidden = true; msg("Password changed. Other browsers have been signed out.", true); }
  catch (err) { msg(err.message); }
  busy(f, false);
}
async function deleteProfile(e) {
  e.preventDefault(); const f = e.currentTarget;
  busy(f, true);
  try { await api({ action: "delete", password: $("acctDelPw").value }); signOutLocal(true); location.reload(); }
  catch (err) { msg(err.message); busy(f, false); }
}

/* ---------------- on load: who's signed in, and are this browser's inputs up to date? ---------------- */
syncButton();
(async () => {
  let j; try { j = await api(); } catch (e) { ready = true; return; }   // offline / no server: keep working locally
  if (!j.user) { if (signedIn()) { signOutLocal(false); syncButton(); } ready = true; return; }
  const switched = meta.id !== j.user.id;
  const newer = j.updatedAt && (!meta.syncedAt || j.updatedAt > meta.syncedAt);
  meta.id = j.user.id; meta.name = j.user.name;
  if ((switched || (newer && !meta.dirty)) && j.data && Object.keys(j.data).length && !sessionStorage.getItem("ukmap-synced")) {
    // Saved on another device since this browser last synced: load it (once per tab, to avoid loops).
    meta.syncedAt = j.updatedAt; meta.dirty = false; saveMeta(); applyData(j.data);
    sessionStorage.setItem("ukmap-synced", "1"); location.reload(); return;
  }
  saveMeta(); syncButton(); ready = true;
  if (meta.dirty) push();
})();
})();
