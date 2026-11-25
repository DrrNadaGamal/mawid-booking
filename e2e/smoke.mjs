import puppeteer from 'puppeteer-core';
const U = process.argv[2] || 'http://localhost:4180';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
for (const u of ['/', '/book?b=layali', '/manage', '/app?b=layali&role=owner', '/app?b=layali&role=owner&view=reports', '/app?b=layali&role=owner&view=team', '/app?b=layali&role=reception&view=bookings']) { await p.goto(U + u, { waitUntil: 'networkidle0' }); await p.screenshot({ path: '/tmp/s_' + u.replace(/[^a-z]/gi, '_') + '.png' }); }
console.log(JSON.stringify(errs)); await b.close();
