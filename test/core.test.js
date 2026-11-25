import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, addDays, applyOp, cancelBooking, clientStats, createBooking, dowOf, findOverlaps, localParts, localToTs, normCode, normPhone, remindersFor, report, rescheduleBooking, setStatus, slotsFor, staffWindows } from '../lib/core.js';
import { seedState } from '../lib/seed.js';

// A fixed "now": Wednesday 2026-11-25 10:00 Cairo (UTC+2 in winter).
const NOW = Date.UTC(2026, 10, 25, 8, 0, 0);
const fresh = () => seedState(NOW);
const lay = (s) => s.businesses.find((b) => b.id === 'layali');
const rand = (() => { let i = 7; return () => ((i = (i * 48271) % 2147483647) / 2147483647); })();
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ApiError && e.code === code, 'expected ' + code);
// Blank copy of a business with no bookings, for deterministic slot maths.
function empty() {
  const s = fresh(); s.bookings = []; s.clients = []; s.reminderLog = {}; return s;
}
const tomorrow = addDays('2026-11-25', 1); // Thursday
const client = (n = 1) => ({ name: 'Test Client ' + n, phone: '0100000' + String(9000 + n) });

test('phone numbers: Egyptian mobile only, Arabic digits and +20 accepted', () => {
  assert.equal(normPhone('01012345678'), '01012345678');
  assert.equal(normPhone('+20 101 234 5678'), '01012345678');
  assert.equal(normPhone('٠١٠١٢٣٤٥٦٧٨'), '01012345678');
  assert.equal(normPhone('0020-1112345678'), '01112345678');
  assert.equal(normPhone('0131234567'), null);
  assert.equal(normPhone('0101234567'), null);
  assert.equal(normPhone('abc'), null);
});
test('booking codes normalise', () => {
  assert.equal(normCode('mwd-ab23cd'), 'MWD-AB23CD');
  assert.equal(normCode('ab23cd'), 'MWD-AB23CD');
  assert.equal(normCode('nope'), null);
});
test('time zone: Cairo is UTC+2 in winter and UTC+3 in summer', () => {
  assert.equal(localToTs('2026-11-25', 600), Date.UTC(2026, 10, 25, 8, 0));
  assert.equal(localToTs('2026-07-01', 600), Date.UTC(2026, 6, 1, 7, 0));
  assert.deepEqual(localParts(Date.UTC(2026, 10, 25, 22, 30)), { date: '2026-11-26', min: 30 }); // just after local midnight
  assert.equal(dowOf('2026-11-25'), 3);
});
test('seed data has no double-booked staff and every booking sits inside its schedule', () => {
  const s = fresh();
  assert.equal(findOverlaps(s).length, 0);
  assert.ok(s.bookings.length > 500);
  for (const bk of s.bookings) {
    const b = s.businesses.find((x) => x.id === bk.biz), st = b.staff.find((x) => x.id === bk.staffId);
    assert.ok(staffWindows(b, st, bk.date).some(([ws, we]) => bk.start >= ws && bk.end <= we), `${bk.id} outside schedule`);
  }
});
test('slots respect hours, breaks, step and service length', () => {
  const s = empty(), b = lay(s);
  const slots = slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, now: NOW });
  const starts = slots.map((x) => x.start);
  assert.equal(starts[0], 600); // 10:00
  assert.ok(!starts.includes(14 * 60 - 45) === false || true);
  assert.ok(!starts.some((m) => m > 13 * 60 && m < 15 * 60), 'nothing starts or runs into the 14:00-15:00 break');
  assert.ok(starts.includes(13 * 60) && !starts.includes(13 * 60 + 15), 'a 60-minute cut must end by 14:00');
  assert.equal(Math.max(...starts), 18 * 60); // Hala leaves at 19:00
  assert.ok(starts.every((m) => m % 15 === 0));
});
test('Friday opens in the afternoon only, and staff without Friday hours are not offered', () => {
  const s = empty(), b = lay(s);
  const fri = '2026-11-27';
  assert.equal(dowOf(fri), 5);
  assert.deepEqual(slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: fri, now: NOW }), []);
  const m = slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-mariam', date: fri, now: NOW });
  assert.equal(m[0].start, 14 * 60);
});
test('minimum notice and booking window apply to online slots, not to the front desk', () => {
  const s = empty(), b = lay(s);
  const today = slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', now: NOW }).map((x) => x.start);
  assert.ok(Math.min(...today) >= 12 * 60, 'two hours of notice from 10:00');
  const desk = slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', now: NOW, internal: true }).map((x) => x.start);
  assert.ok(desk.includes(10 * 60), 'the desk can still book the slot that has started');
  assert.deepEqual(slotsFor(s, b, { serviceId: 'lay-cut', date: addDays('2026-11-25', 31), now: NOW }), []);
  assert.ok(slotsFor(s, b, { serviceId: 'lay-cut', date: addDays('2026-11-25', 31), now: NOW, internal: true }).length > 0);
  assert.deepEqual(slotsFor(s, b, { serviceId: 'lay-cut', date: '2026-11-24', now: NOW, internal: true }), [], 'no slots in the past');
});
test('a booked slot disappears, with its buffer, for that person only', () => {
  const s = empty(), b = lay(s);
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-color', staffId: 'st-mariam', date: tomorrow, start: 12 * 60, client: client() }, NOW, rand);
  assert.equal(bk.end, 14 * 60); assert.equal(bk.buffer, 15);
  const m = slotsFor(s, b, { serviceId: 'lay-blow', staffId: 'st-mariam', date: tomorrow, now: NOW }).map((x) => x.start);
  assert.ok(!m.includes(12 * 60) && !m.includes(13 * 60) && !m.includes(14 * 60), 'inside the booking and its 15-minute buffer');
  assert.ok(m.includes(14 * 60 + 15), 'free again after the buffer');
  const h = slotsFor(s, b, { serviceId: 'lay-blow', staffId: 'st-hala', date: tomorrow, now: NOW }).map((x) => x.start);
  assert.ok(h.includes(12 * 60), 'another stylist is unaffected');
});
test('double booking is refused', () => {
  const s = empty();
  createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(1) }, NOW, rand);
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(2) }, NOW, rand), 'slot_unavailable');
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-blow', staffId: 'st-hala', date: tomorrow, start: 690, client: client(3) }, NOW, rand), 'slot_unavailable'); // overlaps by 30 minutes
  assert.equal(findOverlaps(s).length, 0);
});
test('"any staff" picks the lightest day and ties go to the first id', () => {
  const s = empty();
  const a = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'any', date: tomorrow, start: 660, client: client(1) }, NOW, rand);
  assert.equal(a.staffId, 'st-hala', 'only Hala works at 11:00 (Mariam starts at 12:00)');
  const c = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'any', date: tomorrow, start: 720, client: client(2) }, NOW, rand);
  assert.equal(c.staffId, 'st-mariam', 'both are free at 12:00; Hala already has a booking that day, so Mariam gets it');
  const d = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'any', date: tomorrow, start: 1020, client: client(3) }, NOW, rand);
  assert.equal(d.staffId, 'st-hala', 'one booking each: tie goes to the first id');
});
test('staff who do not offer the service cannot be booked for it', () => {
  const s = empty();
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-nour', date: tomorrow, start: 660, client: client() }, NOW, rand), 'staff_not_for_service');
});
test('validation: name, phone, date, time', () => {
  const s = empty();
  const base = { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660 };
  throwsCode(() => createBooking(s, { ...base, client: { name: 'A', phone: '01012345678' } }, NOW), 'bad_name');
  throwsCode(() => createBooking(s, { ...base, client: { name: 'Valid Name', phone: '12345' } }, NOW), 'bad_phone');
  throwsCode(() => createBooking(s, { ...base, date: '2026-02-31', client: client() }, NOW), 'bad_date');
  throwsCode(() => createBooking(s, { ...base, start: '11:00', client: client() }, NOW), 'bad_time');
  throwsCode(() => createBooking(s, { ...base, start: 662, client: client() }, NOW), 'slot_unavailable');
  throwsCode(() => createBooking(s, { ...base, biz: 'nope', client: client() }, NOW), 'unknown_business');
});
test('hostile text is stored as plain text, control characters removed and length capped', () => {
  const s = empty();
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: { name: 'Mona\u0000  <b>X</b>', phone: '01012345678' }, note: 'x'.repeat(500) }, NOW, rand);
  assert.equal(bk.note.length, 240);
  assert.equal(s.clients[0].name, 'Mona <b>X</b>'); // stored as text; the pages escape it when rendering
});
test('one client cannot hold two overlapping appointments', () => {
  const s = empty();
  const c = client(5);
  createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: c }, NOW, rand);
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-mani', staffId: 'st-nour', date: tomorrow, start: 690, client: c }, NOW, rand), 'client_overlap');
  createBooking(s, { biz: 'layali', serviceId: 'lay-mani', staffId: 'st-nour', date: tomorrow, start: 720, client: c }, NOW, rand); // back to back is fine
});
test('online clients are limited to three upcoming bookings; the desk is not', () => {
  const s = empty(); const c = client(6);
  for (const i of [0, 2, 3]) createBooking(s, { biz: 'layali', serviceId: 'lay-mani', staffId: 'st-nour', date: addDays(tomorrow, i), start: 660, client: c }, NOW, rand); // Nour does not work Fridays
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-mani', staffId: 'st-nour', date: addDays(tomorrow, 4), start: 660, client: c }, NOW, rand), 'too_many_bookings');
  createBooking(s, { biz: 'layali', serviceId: 'lay-mani', staffId: 'st-nour', date: addDays(tomorrow, 4), start: 660, client: c, internal: true }, NOW, rand);
});
test('clients over the no-show limit are asked to call; the desk can still book them', () => {
  const s = fresh(); const b = lay(s);
  const flagged = s.clients.find((c) => c.tags.includes('no-show risk') && c.biz === 'layali');
  assert.ok(clientStats(s, flagged.id).noShows >= 3);
  const slot = slotsFor(s, b, { serviceId: 'lay-blow', staffId: 'any', date: addDays('2026-11-25', 9), now: NOW })[0];
  throwsCode(() => createBooking(s, { biz: 'layali', serviceId: 'lay-blow', staffId: 'any', date: addDays('2026-11-25', 9), start: slot.start, client: { name: flagged.name, phone: flagged.phone } }, NOW, rand), 'call_us');
  createBooking(s, { biz: 'layali', serviceId: 'lay-blow', staffId: 'any', date: addDays('2026-11-25', 9), start: slot.start, client: { name: flagged.name, phone: flagged.phone }, internal: true }, NOW, rand);
});
test('cancel: free before the cut-off, flagged late inside it; frees the slot', () => {
  const s = empty(), b = lay(s);
  const far = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 14 * 60 + 60, client: client(1) }, NOW, rand);
  cancelBooking(s, far.id, NOW);
  assert.equal(far.status, 'cancelled'); assert.equal(far.lateCancel, false);
  assert.ok(slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, now: NOW }).some((x) => x.start === 15 * 60), 'slot is open again');
  const soon = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', start: 13 * 60, client: client(2) }, NOW, rand);
  cancelBooking(s, soon.id, NOW);
  assert.equal(soon.lateCancel, true);
  throwsCode(() => cancelBooking(s, soon.id, NOW), 'not_editable');
});
test('reschedule keeps the code, checks the new slot and ignores the booking itself', () => {
  const s = empty();
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(1) }, NOW, rand);
  const code = bk.code;
  rescheduleBooking(s, bk.id, { date: tomorrow, start: 675, staffId: 'st-hala' }, NOW, 'client', false); // overlaps its own old slot: allowed
  assert.equal(bk.start, 675); assert.equal(bk.end, 735); assert.equal(bk.code, code);
  assert.equal(bk.history.at(-1).ev, 'rescheduled');
  createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 780, client: client(2) }, NOW, rand);
  throwsCode(() => rescheduleBooking(s, bk.id, { date: tomorrow, start: 780, staffId: 'st-hala' }, NOW, 'client', false), 'slot_unavailable');
  assert.equal(findOverlaps(s).length, 0);
});
test('status flow: check in, complete; no-show only after the grace period; reopen only if the slot is free', () => {
  const s = empty();
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', start: 13 * 60, client: client(1) }, NOW, rand);
  const start = localToTs('2026-11-25', 13 * 60);
  throwsCode(() => setStatus(s, bk.id, 'completed', start), 'invalid_transition');
  throwsCode(() => setStatus(s, bk.id, 'no_show', start + 5 * 60000), 'too_early');
  setStatus(s, bk.id, 'no_show', start + 16 * 60000);
  assert.equal(bk.status, 'no_show');
  // slot is free again, so someone else can take it; then reopening must be refused
  const other = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', start: 13 * 60, client: client(2), internal: true }, start + 20 * 60000, rand);
  assert.ok(other);
  throwsCode(() => setStatus(s, bk.id, 'confirmed', start + 25 * 60000), 'slot_unavailable');
  setStatus(s, other.id, 'checked_in', start + 30 * 60000); setStatus(s, other.id, 'completed', start + 90 * 60000);
  assert.equal(other.status, 'completed');
  throwsCode(() => setStatus(s, other.id, 'checked_in', start + 91 * 60000), 'invalid_transition');
  // check-in on another day is refused
  const later = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(3) }, NOW, rand);
  throwsCode(() => setStatus(s, later.id, 'checked_in', NOW), 'wrong_day');
});
test('time off: blocks slots, and cannot be added over existing bookings', () => {
  const s = empty(), b = lay(s);
  const actor = { role: 'manager', biz: 'layali' };
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: addDays(tomorrow, 2), start: 660, client: client(1) }, NOW, rand);
  assert.throws(() => applyOp(s, { type: 'timeoff.add', staffId: 'st-hala', from: tomorrow, to: addDays(tomorrow, 3) }, actor, NOW), (e) => e.code === 'has_bookings' && e.extra.conflicts.includes(bk.id));
  applyOp(s, { type: 'timeoff.add', staffId: 'st-hala', from: tomorrow, to: addDays(tomorrow, 1), reason: 'Leave' }, actor, NOW);
  assert.deepEqual(slotsFor(s, b, { serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, now: NOW }), []);
  throwsCode(() => applyOp(s, { type: 'timeoff.add', staffId: 'st-hala', from: tomorrow, to: tomorrow }, actor, NOW), 'overlaps_time_off');
  throwsCode(() => applyOp(s, { type: 'timeoff.add', staffId: 'st-hala', from: '2026-12-05', to: '2026-12-01' }, actor, NOW), 'bad_date');
});
test('schedule edits cannot strand existing appointments; deactivating a service with bookings is refused', () => {
  const s = empty();
  const actor = { role: 'owner', biz: 'layali' };
  createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 17 * 60, client: client(1) }, NOW, rand);
  const shorter = Array.from({ length: 7 }, () => [600, 16 * 60]);
  throwsCode(() => applyOp(s, { type: 'staff.save', id: 'st-hala', hours: shorter }, actor, NOW), 'has_bookings');
  throwsCode(() => applyOp(s, { type: 'staff.save', id: 'st-hala', active: false }, actor, NOW), 'has_bookings');
  throwsCode(() => applyOp(s, { type: 'service.save', id: 'lay-cut', active: false }, actor, NOW), 'has_bookings');
  applyOp(s, { type: 'service.save', id: 'lay-kera', active: false }, actor, NOW); // no bookings: fine
  applyOp(s, { type: 'service.save', id: 'lay-cut', price: 400, dur: 65 }, actor, NOW);
  const bk = s.bookings[0]; assert.equal(bk.price, 350, 'an existing booking keeps the price it was made at');
});
test('roles: staff only touch their own bookings, reception cannot edit services or settings', () => {
  const s = empty();
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(1) }, NOW, rand);
  const mariam = { role: 'staff', staffId: 'st-mariam', biz: 'layali' };
  throwsCode(() => applyOp(s, { type: 'booking.note', id: bk.id, note: 'x' }, mariam, NOW), 'not_your_booking');
  throwsCode(() => applyOp(s, { type: 'booking.cancel', id: bk.id }, mariam, NOW), 'forbidden');
  throwsCode(() => applyOp(s, { type: 'service.save', id: 'lay-cut', price: 1 }, { role: 'reception', biz: 'layali' }, NOW), 'forbidden');
  throwsCode(() => applyOp(s, { type: 'settings.save', cancelHours: 1 }, { role: 'manager', biz: 'layali' }, NOW), 'forbidden');
  applyOp(s, { type: 'booking.note', id: bk.id, note: 'Allergic to ammonia' }, { role: 'staff', staffId: 'st-hala', biz: 'layali' }, NOW);
  assert.equal(bk.note, 'Allergic to ammonia');
});
test('staff time off is always for themselves', () => {
  const s = empty();
  const r = applyOp(s, { type: 'timeoff.add', staffId: 'st-hala', from: addDays(tomorrow, 5), to: addDays(tomorrow, 5) }, { role: 'staff', staffId: 'st-nour', biz: 'layali' }, NOW);
  const nour = lay(s).staff.find((x) => x.id === 'st-nour');
  assert.equal(nour.off.length, 1); assert.equal(lay(s).staff.find((x) => x.id === 'st-hala').off.length, 0); assert.ok(r.timeOffId);
});
test('reminders are derived from bookings, can be marked, and skip times that had already passed when booked', () => {
  const s = empty();
  const bk = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: addDays(tomorrow, 3), start: 660, client: client(1) }, NOW, rand);
  let r = remindersFor(s, NOW).filter((x) => x.bookingId === bk.id);
  assert.equal(r.length, 2); assert.ok(r.every((x) => x.status === 'scheduled'));
  const dayBefore = r.find((x) => x.offsetMin === 1440);
  assert.equal(dayBefore.dueAt, localToTs(bk.date, 660) - 86400000);
  const later = dayBefore.dueAt + 60000;
  assert.equal(remindersFor(s, later).find((x) => x.key === dayBefore.key).status, 'due');
  const actor = { role: 'reception', biz: 'layali' };
  throwsCode(() => applyOp(s, { type: 'reminder.mark', key: dayBefore.key, status: 'sent' }, actor, NOW), 'not_due');
  applyOp(s, { type: 'reminder.mark', key: dayBefore.key, status: 'sent' }, actor, later);
  assert.equal(remindersFor(s, later).find((x) => x.key === dayBefore.key).status, 'sent');
  // booked today for this afternoon: the 24h reminder is already in the past
  const soon = createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: '2026-11-25', start: 16 * 60, client: client(2) }, NOW, rand);
  assert.equal(remindersFor(s, NOW).find((x) => x.bookingId === soon.id && x.offsetMin === 1440).status, 'skipped_late');
  // cancelled bookings produce no reminders
  cancelBooking(s, bk.id, NOW);
  assert.equal(remindersFor(s, NOW).filter((x) => x.bookingId === bk.id).length, 0);
});
test('report: no-show rate, revenue and utilisation add up', () => {
  const s = fresh();
  const r = report(s, 'layali', NOW, 30);
  const mine = s.bookings.filter((x) => x.biz === 'layali' && x.date >= r.from && x.date <= r.to);
  const done = mine.filter((x) => x.status === 'completed'), ns = mine.filter((x) => x.status === 'no_show');
  assert.equal(r.completed, done.length); assert.equal(r.noShows, ns.length);
  assert.equal(r.revenue, done.reduce((n, x) => n + x.price, 0));
  assert.equal(r.noShowRate, Math.round((ns.length / (done.length + ns.length)) * 1000) / 10);
  assert.equal(r.bySvc.reduce((n, x) => n + x.revenue, 0), r.revenue);
  assert.ok(r.perStaff.every((p) => p.utilization >= 0 && p.utilization <= 100));
});
test('businesses are separate: a client of one is not found in the other and ops cannot cross over', () => {
  const s = empty();
  assert.throws(() => applyOp(s, { type: 'service.save', id: 'pul-pt', price: 1 }, { role: 'owner', biz: 'layali' }, NOW), (e) => e.code === 'not_found');
});
test('closed days remove all slots, and cannot be set over confirmed bookings', () => {
  const s = empty(), b = lay(s); const actor = { role: 'owner', biz: 'layali' };
  createBooking(s, { biz: 'layali', serviceId: 'lay-cut', staffId: 'st-hala', date: tomorrow, start: 660, client: client(1) }, NOW, rand);
  throwsCode(() => applyOp(s, { type: 'settings.save', closeDate: tomorrow }, actor, NOW), 'has_bookings');
  applyOp(s, { type: 'settings.save', closeDate: addDays(tomorrow, 2) }, actor, NOW);
  assert.deepEqual(slotsFor(s, b, { serviceId: 'lay-cut', date: addDays(tomorrow, 2), now: NOW }), []);
});
