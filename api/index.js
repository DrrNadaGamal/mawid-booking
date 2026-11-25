import { handle } from '../lib/service.js';
import { makeStore } from '../lib/store.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.searchParams.get('r') ?? url.pathname.replace(/^\/api\/?/, '');
    const query = Object.fromEntries(url.searchParams); delete query.r;
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const r = await handle({ method: req.method, path, query, body, headers: req.headers, ip, store: makeStore() });
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).json(r.json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
}
