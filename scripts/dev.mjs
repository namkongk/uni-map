// Local dev server: serves the static site and runs api/*.js functions the same way Vercel does.
//   npm run dev  →  http://localhost:5173
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { HERE } from "./_rows.mjs";

const ROOT = join(HERE, ".."), PORT = +process.env.PORT || 5173;

// Load .env (KEY=value lines) so api/config.js can read local secrets without committing them.
try {
  for (const line of (await readFile(join(ROOT, ".env"), "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* no .env: the map falls back to OpenStreetMap */ }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const api = url.pathname.match(/^\/api\/([\w-]+)$/);
    if (api) {
      const mod = await import(join(ROOT, "api", api[1] + ".js"));
      const handler = mod[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const out = await handler(new Request(url, { method: req.method, headers: req.headers }));
      res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
      console.log(req.method, url.pathname + url.search, out.status);
      return;
    }
    let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || /[\\/](\.|api[\\/]|scripts[\\/])/.test(file.slice(ROOT.length))) { res.writeHead(404).end("Not found"); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
    console.error(e); res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`Uni Map → http://localhost:${PORT}`));
