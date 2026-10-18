#!/usr/bin/env node
// Local preview of built events, served the way the live site serves static files.
//   node scripts/build.mjs vagabond2026 && node scripts/serve.mjs   → http://localhost:8787/vagabond2026/
// Like production: /<slug> → 301 /<slug>/, /<dir>/index.html → 307 /<dir>/, and every file revalidates
// (Cache-Control: public, max-age=0, must-revalidate, with an ETag).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './validate.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
};

// _headers, as Cloudflare reads it: a path line (\`*\` matches the rest), then indented "Name: value" lines.
function headerRules(root) {
  const file = path.join(root, '_headers');
  if (!fs.existsSync(file)) return [];
  const rules = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rules.push({ re: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), headers: [] }); continue; }
    const m = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (m && rules.length) rules.at(-1).headers.push([m[1].toLowerCase(), m[2]]);
  }
  return rules;
}

export function serve({ root = path.join(ROOT, 'dist'), port = 8787, log = false } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const redirect = (code, to) => { res.writeHead(code, { location: to + url.search }); res.end(); };
    if (rel.endsWith('/index.html')) return redirect(307, rel.slice(0, -'index.html'.length));
    let target = file;
    let st = fs.existsSync(target) ? fs.statSync(target) : null;
    if (st?.isDirectory()) {
      if (!rel.endsWith('/')) return redirect(301, rel + '/');
      target = path.join(target, 'index.html');
      st = fs.existsSync(target) ? fs.statSync(target) : null;
    }
    if (log) console.log(req.method, rel, st ? 200 : 404);
    if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    const headers = { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate', etag };
    for (const r of headerRules(root)) if (r.re.test(rel)) for (const [k, v] of r.headers) headers[k] = v;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    resolve({ url: `http://localhost:${p}`, port: p, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8787;
  const s = await serve({ port, log: true });
  console.log(`serving dist/ at ${s.url}/  (Ctrl-C to stop)`);
}
