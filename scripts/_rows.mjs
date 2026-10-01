// Read/write helpers for scripts/masters_rows.json + scripts/universities.json (keeps the one-key-per-line format).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROWS_FILE = join(HERE, "masters_rows.json");
export const CACHE = join(HERE, ".cache");

export const loadRows = () => JSON.parse(readFileSync(ROWS_FILE, "utf8"));
export const loadUnis = () => JSON.parse(readFileSync(join(HERE, "universities.json"), "utf8"));

const ascii = s => s.replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
export function saveRows(rows) {
  const body = rows.map(r => "{\n" + Object.entries(r).map(([k, v]) => `${JSON.stringify(k)}: ${ascii(JSON.stringify(v))}`).join(",\n") + "\n}").join(",\n");
  writeFileSync(ROWS_FILE, "[\n" + body + "\n]\n");
}

export function cached(name, fn) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const f = join(CACHE, name.replace(/[^a-z0-9.-]+/gi, "_") + ".json");
  if (existsSync(f)) return Promise.resolve(JSON.parse(readFileSync(f, "utf8")));
  return fn().then(v => { if (!Array.isArray(v) || v.length) writeFileSync(f, JSON.stringify(v)); return v; });
}

/** Run fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
