// Local server: same API as the Vercel function, state in memory. For development, tests and screenshots.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { handle } from './lib/service.js'; import { MemoryStore } from './lib/store.js';
const store = new MemoryStore();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PORT = process.env.PORT || 4180;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
      let body = {}; try { body = JSON.parse(b || '{}'); } catch {}
      const r = await handle({ method: req.method, path: u.pathname.slice(5), query: Object.fromEntries(u.searchParams), body, headers: req.headers, ip: 'local', store });
      res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(r.json));
    }); return;
  }
  let f = path.join('public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!path.resolve(f).startsWith(path.resolve('public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT));
