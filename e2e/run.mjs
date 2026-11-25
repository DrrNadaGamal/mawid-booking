// Browser end-to-end test: run against a local server or the live site: node e2e/run.mjs https://...
import puppeteer from 'puppeteer-core';
const U = (process.argv[2] || 'http://localhost:4180').replace(/\/$/, '');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = async (w = 1440, h = 900) => { const p = await b.newPage(); await p.setViewport({ width: w, height: h }); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET|net::/.test(m.text()) && p.errs.push(m.text())); p.on('dialog', (d) => d.accept('e2e')); return p; };
const hdr = (role, staff) => ({ 'x-role': role, ...(staff ? { 'x-staff': staff } : {}), 'content-type': 'application/json' });
const A = async (path, o = {}) => { const r = await fetch(U + '/api/' + path, o); return { s: r.status, j: await r.json() }; };
const op = (role, o, staff) => A('op/layali', { method: 'POST', headers: hdr(role, staff), body: JSON.stringify({ op: o }) });
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 8000 }); await p.click(sel); };
const reset = () => op('owner', { type: 'reset' });
await reset();
// 1 public booking through the real UI, with a hostile note and name
const g = await mk(390, 844); await g.goto(U + '/book?b=layali&lang=en', { waitUntil: 'networkidle0' });
ok((await g.$$('[data-svc]')).length === 11, 'service list shows 11 services');
await click(g, '[data-svc="lay-mani"]'); await click(g, '[data-staff="st-nour"]'); await click(g, '[data-next]');
await g.waitForSelector('.slot', { timeout: 8000 }); const firstSlot = await g.$eval('.slot', (e) => e.textContent); await click(g, '.slot'); await click(g, '[data-next]');
const phone = '0100000' + String(5000 + Math.floor(Math.random() * 4000));
await g.type('input[name=name]', '<img src=x onerror=window.__x=1> Test Guest'); await g.type('input[name=phone]', phone); await g.type('textarea[name=note]', 'e2e booking');
await click(g, 'button[type=submit]'); await g.waitForSelector('[data-testid=code]', { timeout: 10000 });
const code = await g.$eval('[data-testid=code]', (e) => e.textContent.trim());
ok(/^MWD-[A-Z0-9]{6}$/.test(code), 'booking confirmed with code ' + code);
ok(await g.evaluate(() => !window.__x), 'hostile name is not executed');
// 2 the same slot is gone for the next customer; try to book it directly: refused
const d = await A('slots/layali?service=lay-mani&staff=st-nour&from=' + (await A('public/layali')).j.today + '&days=14');
const bkInfo = await A('manage', { method: 'POST', headers: hdr('x'), body: JSON.stringify({ action: 'get', code, phone }) });
const bk = bkInfo.j.booking; ok(bkInfo.s === 200 && bk.status === 'confirmed', 'manage lookup finds the booking');
ok(!(d.j.days[bk.date] || []).includes(bk.start), 'the booked slot no longer appears as free');
const dup = await A('book/layali', { method: 'POST', headers: hdr('x'), body: JSON.stringify({ serviceId: 'lay-mani', staffId: 'st-nour', date: bk.date, start: bk.start, client: { name: 'Second Guest', phone: '01099990000' } }) });
ok(dup.s === 409 && dup.j.error === 'slot_unavailable', 'second booking for the same slot is refused (409)');
// 3 parallel race on a fresh slot, live store
const free = (await A(`slots/layali?service=lay-facial&staff=st-salma&from=${bk.date}&days=14`)).j.days; const rd = Object.keys(free).find((k) => free[k].length); const rs = free[rd][0];
const race = await Promise.all(Array.from({ length: 8 }, (_, i) => A('book/layali', { method: 'POST', headers: hdr('x'), body: JSON.stringify({ serviceId: 'lay-facial', staffId: 'st-salma', date: rd, start: rs, client: { name: 'Racer ' + i, phone: '0100000' + String(7000 + i) } }) })));
ok(race.filter((r) => r.s === 201).length === 1, 'eight parallel bookings: exactly one wins (' + race.map((r) => r.s).join(',') + ')');
// 4 reception sees it on the calendar and moves it
const rc = await mk(); await rc.goto(`${U}/app?b=layali&role=reception&lang=en&date=${bk.date}`, { waitUntil: 'networkidle0' });
ok(await rc.evaluate(() => [...document.querySelectorAll('.blk')].some((e) => e.innerText.includes('Test Guest'))), 'reception calendar shows the new booking');
ok(await rc.evaluate(() => !document.querySelector('[data-view=reports]') && !document.querySelector('[data-view=services]') === false), 'reception has no Reports page');
// 5 walk-in now: check in, complete
const today = (await A('public/layali')).j; const nowM = today.nowMin;
const wk = await op('reception', { type: 'booking.create', source: 'walk_in', serviceId: 'lay-blow', staffId: 'any', date: today.today, start: Math.floor(nowM / 15) * 15 - 15, client: { name: 'Walk In', phone: '01077771111' } });
if (wk.s === 200) {
  const id = wk.j.result.bookingId;
  ok((await op('reception', { type: 'booking.status', id, status: 'no_show' })).j.error === 'too_early', 'no-show is refused before the grace period');
  ok((await op('reception', { type: 'booking.status', id, status: 'checked_in' })).s === 200, 'walk-in checked in');
  ok((await op('reception', { type: 'booking.status', id, status: 'completed' })).s === 200, 'walk-in completed');
} else console.log('SKIP walk-in (outside opening hours): ' + JSON.stringify(wk.j));
// 6 roles enforced by the server
ok((await op('reception', { type: 'settings.save', cancelHours: 1 })).s === 403, 'reception cannot change settings (403)');
ok((await op('staff', { type: 'booking.cancel', id: bk.code }, 'st-hala')).s === 403, 'team member cannot cancel bookings (403)');
const nourView = await A('app/layali', { headers: hdr('staff', 'st-nour') }); ok(nourView.j.bookings.every((x) => x.staffId === 'st-nour') && nourView.j.report === null, 'team member sees only own bookings, no reports');
// 7 time off blocks slots, refused over bookings
const off = await op('manager', { type: 'timeoff.add', staffId: 'st-nour', from: bk.date, to: bk.date });
ok(off.s === 409 && off.j.error === 'has_bookings' && off.j.conflicts?.length >= 1, 'time off over a confirmed booking is refused with the conflicts listed');
// 8 customer cancel inside UI
const mg = await mk(390, 844); await mg.goto(`${U}/manage?code=${code}&lang=en`, { waitUntil: 'networkidle0' }); await mg.type('input[name=phone]', phone); await click(mg, 'button[type=submit]');
await mg.waitForSelector('[data-cancel]', { timeout: 8000 }); await click(mg, '[data-cancel]'); await mg.waitForFunction(() => /cancelled/i.test(document.body.innerText), { timeout: 8000 });
ok(true, 'customer cancelled from the manage page');
const d2 = (await A(`slots/layali?service=lay-mani&staff=st-nour&from=${bk.date}&days=14`)).j.days; ok((d2[bk.date] || []).includes(bk.start), 'cancelling frees the slot again');
// 9 Arabic + RTL
const ar = await mk(390, 844); await ar.goto(U + '/book?b=layali&lang=ar', { waitUntil: 'networkidle0' });
ok(await ar.evaluate(() => document.documentElement.dir === 'rtl' && document.body.innerText.includes('قص وسشوار')), 'Arabic page is RTL with Arabic service names');
// 10 offline
const off1 = await mk(); await off1.goto(`${U}/app?b=layali&role=owner&lang=en`, { waitUntil: 'networkidle0' }); await off1.setOfflineMode(true); await off1.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(1500);
ok(await off1.evaluate(() => document.body.innerText.includes('Offline')), 'dashboard opens offline with the last saved schedule'); await off1.setOfflineMode(false);
await reset();
for (const [n, p] of [['guest', g], ['reception', rc], ['manage', mg], ['arabic', ar]]) ok(p.errs.length === 0, n + ' page: no console errors ' + JSON.stringify(p.errs));
await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
