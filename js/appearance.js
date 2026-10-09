/* Appearance settings (theme, window transparency, blur) for pages other than the map.
   Reads and writes the same saved keys as the map page (localStorage "ukmap-state"), so both stay in sync. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const KEY = "ukmap-state", DEF = { theme: "auto", glassT: 45, glassBlur: 22 };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
let A = { ...DEF, ...(({ theme, glassT, glassBlur }) => Object.fromEntries(Object.entries({ theme, glassT, glassBlur }).filter(([, v]) => v != null)))(load()) };

// Merge into the saved state rather than replacing it, so the map page's filters and jobs are kept.
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), theme: A.theme, glassT: A.glassT, glassBlur: A.glassBlur })); } catch (e) {} }

function fillRanges() {
  document.querySelectorAll('input[type="range"]').forEach(r => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100 || 0) + "%"));
}
// Transparency 0 → nearly solid windows (tint .94); 100 → almost clear (tint .08). Same formula as the map page.
function apply() {
  const root = document.documentElement, t = Math.min(100, Math.max(0, +A.glassT)), b = Math.min(40, Math.max(0, +A.glassBlur));
  root.style.setProperty("--glass-a", (0.94 - t / 100 * 0.86).toFixed(3));
  root.style.setProperty("--glass-blur", b + "px");
  if (A.theme === "auto") delete root.dataset.theme; else root.dataset.theme = A.theme;
  $("themeSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === A.theme)));
  $("glassT").value = t; $("glassTv").textContent = t + "%";
  $("glassBlur").value = b; $("glassBlurv").textContent = b ? b + " px" : "Off";
  fillRanges();
}
$("themeSeg").querySelectorAll("button").forEach(x => x.addEventListener("click", () => { A.theme = x.dataset.v; save(); apply(); }));
$("glassT").addEventListener("input", e => { A.glassT = +e.target.value; save(); apply(); });
$("glassBlur").addEventListener("input", e => { A.glassBlur = +e.target.value; save(); apply(); });
$("glassReset").addEventListener("click", () => { A = { ...DEF }; save(); apply(); });

// The settings button opens the profile & settings modal (js/account.js), which holds these controls.
// Changed on the map page in another tab → follow it here.
addEventListener("storage", e => { if (e.key === KEY) { const s = load(); ["theme", "glassT", "glassBlur"].forEach(k => { if (s[k] != null) A[k] = s[k]; }); apply(); } });
apply();
})();
