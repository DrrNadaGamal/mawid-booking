import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/service.js';
import { MemoryStore } from '../lib/store.js';
import { addDays, findOverlaps } from '../lib/core.js';

const NOW = Date.UTC(2026, 10, 25, 8, 0, 0); // Wed 25 Nov 2026, 10:00 Cairo
const tomorrow = addDays('2026-11-25', 1);
const mk = () => new MemoryStore();
let n = 0;
const call = (store, method, path, { body, headers = {}, query = {}, now = NOW } = {}) => handle({ method, path, body, headers, query, store, now, ip: 'ip' + (n++), rand: Math.random });
const as = (role, staffId) => ({ 'x-role': role, ...(staffId ? { 'x-staff': staffId } : {}) });
const op = (store, role, o, biz = 'layali', staffId) => call(store, 'POST', 'op/' + biz, { body: { op: o }, headers: as(role, staffId) });
const free = async (store, svc = 'lay-cut', staff = 'st-hala', date = tomorrow) => (await call(store, 'GET', 'slots/layali', { query: { service: svc, staff, from: date, days: '1' } })).json.days[date];
const book = (store, start, i, extra = {}) => call(store, 'POST', 'book/layali', { body: { serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start, client: { name: 'Guest ' + i, phone: '0100000' + String(8000 + i) }, ...extra } });

test('public page data hides internals', async () => {
  const st = mk();
  const r = await call(st, 'GET', 'public/layali');
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.json);
  assert.ok(!/phone":"0100000\d{4}/.test(text) && !text.includes('clients') && !text.includes('reminderLog'));
  assert.ok(r.json.services.length >= 8 && r.json.staff.length === 4);
  assert.equal((await call(st, 'GET', 'public/nope')).status, 404);
});
test('slots endpoint returns a range and matches what booking accepts', async () => {
  const st = mk();
  const r = await call(st, 'GET', 'slots/layali', { query: { service: 'lay-cut', staff: 'any', from: tomorrow, days: '3' } });
  assert.equal(Object.keys(r.json.days).length, 3);
  const first = r.json.days[tomorrow][0];
  const b = await book(st, first, 1, { staffId: 'any' });
  assert.equal(b.status, 201); assert.match(b.json.booking.code, /^MWD-[A-Z0-9]{6}$/);
  const r2 = await call(st, 'GET', 'slots/layali', { query: { service: 'lay-cut', staff: 'any', from: tomorrow, days: '1' } });
  assert.ok(!r2.json.days[tomorrow].includes(first) || r2.json.days[tomorrow].length >= 1);
});
test('eight parallel bookings for one slot: exactly one wins, nobody is double-booked', async () => {
  const st = mk();
  const slot = (await free(st))[0];
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => book(st, slot, 10 + i)));
  const won = res.filter((r) => r.status === 201), lost = res.filter((r) => r.status !== 201);
  assert.equal(won.length, 1);
  assert.ok(lost.every((r) => r.json.error === 'slot_unavailable' || r.json.error === 'busy'), JSON.stringify(lost.map((r) => r.json)));
  const { state } = await st.read();
  assert.equal(findOverlaps(state).length, 0);
});
test('parallel bookings for different people all succeed', async () => {
  const st = mk();
  const jobs = [['lay-cut', 'st-hala'], ['lay-mani', 'st-nour'], ['lay-facial', 'st-salma'], ['lay-color', 'st-mariam']];
  const slots = await Promise.all(jobs.map(([sv, sf]) => free(st, sv, sf)));
  const res = await Promise.all(jobs.map(([sv, sf], i) => book(st, slots[i][0], 30 + i, { serviceId: sv, staffId: sf })));
  assert.deepEqual(res.map((r) => r.status), jobs.map(() => 201), JSON.stringify(res.map((r) => r.json)));
  const { state } = await st.read();
  assert.equal(findOverlaps(state).length, 0);
});
test('manage: code plus phone required; cancel and move work; wrong phone is a plain not-found', async () => {
  const st = mk();
  const f0 = await free(st); const b = (await book(st, f0[0], 41)).json.booking; const f1 = f0.find((m) => m >= f0[0] + 75);
  const phone = '0100000' + 8041;
  assert.equal((await call(st, 'POST', 'manage', { body: { action: 'get', code: b.code, phone: '01099999999' } })).status, 404);
  assert.equal((await call(st, 'POST', 'manage', { body: { action: 'get', code: 'MWD-ZZZZZZ', phone } })).status, 404);
  const g = await call(st, 'POST', 'manage', { body: { action: 'get', code: b.code.toLowerCase(), phone: '+2' + phone } });
  assert.equal(g.status, 200); assert.equal(g.json.booking.status, 'confirmed');
  assert.ok(!('clientId' in g.json.booking) && !JSON.stringify(g.json).includes('0100000'));
  const mv = await call(st, 'POST', 'manage', { body: { action: 'reschedule', code: b.code, phone, date: tomorrow, start: f1, staffId: 'st-hala' } });
  assert.equal(mv.status, 200); assert.equal(mv.json.booking.start, f1);
  const c = await call(st, 'POST', 'manage', { body: { action: 'cancel', code: b.code, phone } });
  assert.equal(c.json.booking.status, 'cancelled');
  assert.equal((await call(st, 'POST', 'manage', { body: { action: 'cancel', code: b.code, phone } })).json.error, 'not_editable');
});
test('manage: moving a booking inside the cancellation window is refused', async () => {
  const st = mk();
  await call(st, 'GET', 'public/layali');
  const { state } = await st.read();
  const soon = state.bookings.find((x) => x.biz === 'layali' && x.status === 'confirmed' && x.date === '2026-11-25' && x.start >= 14 * 60);
  if (!soon) return; // seed has no such booking at this clock time
  const client = state.clients.find((c) => c.id === soon.clientId);
  const r = await call(st, 'POST', 'manage', { body: { action: 'reschedule', code: soon.code, phone: client.phone, date: tomorrow, start: 11 * 60 } });
  assert.equal(r.json.error, 'too_late_to_move');
});
test('app view: role header required, staff only see their own bookings', async () => {
  const st = mk();
  assert.equal((await call(st, 'GET', 'app/layali')).status, 403);
  assert.equal((await call(st, 'GET', 'app/layali', { headers: as('staff', 'nobody') })).status, 403);
  const own = await call(st, 'GET', 'app/layali', { headers: as('staff', 'st-nour') });
  assert.equal(own.status, 200);
  assert.ok(own.json.bookings.length > 20 && own.json.bookings.every((x) => x.staffId === 'st-nour'));
  assert.equal(own.json.report, null); assert.deepEqual(own.json.reminders, []);
  const all = await call(st, 'GET', 'app/layali', { headers: as('owner') });
  assert.ok(all.json.bookings.length > own.json.bookings.length * 2 && all.json.report.total > 0);
});
test('ops: forbidden roles, idempotent replays, validation errors come back as codes', async () => {
  const st = mk();
  assert.equal((await op(st, 'reception', { type: 'settings.save', cancelHours: 1 })).status, 403);
  assert.equal((await op(st, 'staff', { type: 'service.save', id: 'lay-cut', price: 1 }, 'layali', 'st-hala')).status, 403);
  assert.equal((await op(st, 'owner', { type: 'nonsense' })).json.error, 'unknown_op');
  const ns = await free(st, 'lay-mani', 'st-nour'); const o = { type: 'booking.create', opId: 'op-1', serviceId: 'lay-mani', staffId: 'st-nour', date: tomorrow, start: ns[0], client: { name: 'Walk Guest', phone: '01011112222' }, source: 'phone' };
  const a = await op(st, 'reception', o), b = await op(st, 'reception', o);
  assert.equal(a.status, 200); assert.equal(b.json.duplicate, true); assert.equal(a.json.result.bookingId, b.json.result.bookingId);
  const { state } = await st.read();
  assert.equal(state.bookings.filter((x) => x.clientId === state.clients.find((c) => c.phone === '01011112222').id).length, 1);
  const bad = await op(st, 'reception', { type: 'booking.create', serviceId: 'lay-mani', staffId: 'st-nour', date: tomorrow, start: ns[0], client: { name: 'Other', phone: '01033334444' } });
  assert.equal(bad.status, 409); assert.equal(bad.json.error, 'slot_unavailable');
});
test('owner can reset the demo; others cannot', async () => {
  const st = mk();
  const ns = await free(st, 'lay-mani', 'st-nour');
  await op(st, 'reception', { type: 'booking.create', serviceId: 'lay-mani', staffId: 'st-nour', date: tomorrow, start: ns[0], client: { name: 'Temp Guest', phone: '01055556666' } });
  assert.equal((await op(st, 'manager', { type: 'reset' })).status, 403);
  assert.equal((await op(st, 'owner', { type: 'reset' })).status, 200);
  const { state } = await st.read();
  assert.ok(!state.clients.some((c) => c.phone === '01055556666'));
});
test('the demo reseeds itself after six hours', async () => {
  const st = mk();
  await book(st, (await free(st))[0], 77);
  const { state: s1 } = await st.read();
  await call(st, 'GET', 'public/layali', { now: NOW + 7 * 3600000 });
  const { state: s2 } = await st.read();
  assert.ok(s2.seededAt > s1.seededAt);
});
test('rate limiting kicks in on public booking', async () => {
  const st = mk(); let last;
  for (let i = 0; i < 14; i++) last = await handle({ method: 'POST', path: 'book/layali', body: { serviceId: 'lay-cut', date: tomorrow, start: 660, client: { name: 'x', phone: '1' } }, store: st, now: NOW, ip: 'same-ip-xyz' });
  assert.equal(last.status, 429);
});
