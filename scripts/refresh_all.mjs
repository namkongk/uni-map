// Re-read every course page's fee and course details (start dates, open/closed, entry) and save them to the database (same as pressing Refresh on the map,
// but run from your computer — useful to fill the database the first time, or on a schedule).
//   npm run refresh-all            → all universities
//   npm run refresh-all -- "UCL"   → only universities whose name contains this text
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HERE, pool } from "./_rows.mjs";

// Load .env (SUPABASE_URL, SUPABASE_SECRET_KEY) the same way the dev server does.
try {
  for (const line of (await readFile(join(HERE, "..", ".env"), "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch {}
const { refreshUni, sourceUnis } = await import("../api/_lib/refresh-uni.js");
const { dbReady, saveResults } = await import("../api/_lib/db.js");
if (!dbReady()) { console.error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set in .env"); process.exit(1); }

const only = process.argv[2];
const unis = sourceUnis().filter(u => !only || u.toLowerCase().includes(only.toLowerCase()));
let saved = 0, changed = 0, errors = 0, closed = 0, failed = [];
await pool(unis, 4, async u => {
  try {
    const s = await saveResults(u, await refreshUni(u));
    saved += s.saved; changed += s.changed; errors += s.errors; closed += s.closed;
    console.log(`✓ ${u}: ${s.saved} fees saved (${s.changed} changed), ${s.errors} unreadable${s.closed ? `, ${s.closed} closed or removed` : ""}`);
  } catch (e) { failed.push(u); console.log(`✗ ${u}: ${e.message}`); }
});
const line = `${unis.length} universities · ${saved} fees saved (${changed} new or changed) · ${closed} courses closed or removed · ${errors} pages without a readable fee`;
console.log(`\nDone: ${line}${failed.length ? ` · database errors for: ${failed.join(", ")}` : ""}`);
if (process.env.GITHUB_STEP_SUMMARY) { const { appendFile } = await import("node:fs/promises"); await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Fee & course refresh\n${line}\n\n`); }
if (failed.length) process.exit(1);
