// Mawid core: pure business rules. No I/O, no clock: every function that needs "now" receives it.
// Times are business-local wall clock: a booking has a local `date` (YYYY-MM-DD) and `start`/`end` in minutes after midnight.
// Absolute timestamps are derived with the IANA zone of the business (Africa/Cairo), so daylight saving is handled by Intl.

export const TZ = 'Africa/Cairo';
export const STATUSES = ['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'];
export const ACTIVE = new Set(['confirmed', 'checked_in', 'completed']); // statuses that occupy the calendar
export const SOURCES = ['online', 'phone', 'walk_in'];
export const ROLES = ['owner', 'manager', 'reception', 'staff'];
export const LIMITS = { maxFutureOnline: 3, maxNote: 240, maxName: 60 };

export class ApiError extends Error {
  constructor(code, status = 400, extra = {}) { super(code); this.code = code; this.status = status; this.extra = extra; }
}
const fail = (code, status, extra) => { throw new ApiError(code, status, extra); };

// ---------------------------------------------------------------- text and phone
export const clean = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
// Egyptian mobile numbers only (010, 011, 012, 015). Accepts Arabic digits, spaces, dashes, +20 and 0020.
export function normPhone(v) {
  let s = String(v ?? '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[\s\-().]/g, '');
  if (s.startsWith('+20')) s = '0' + s.slice(3); else if (s.startsWith('0020')) s = '0' + s.slice(4); else if (s.startsWith('20') && s.length === 12) s = '0' + s.slice(2);
  return /^01[0125]\d{8}$/.test(s) ? s : null;
}
export const maskPhone = (p) => (p ? p.slice(0, 4) + ' *** ' + p.slice(-3) : '');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(rand = Math.random) { let s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]; return 'MWD-' + s; }
export const normCode = (v) => { const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const c = s.startsWith('MWD') ? s.slice(3) : s; return c.length === 6 ? 'MWD-' + c : null; };

// ---------------------------------------------------------------- time
const fmts = new Map();
function dtf(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  return fmts.get(tz);
}
function rawParts(ts, tz) { const o = {}; for (const p of dtf(tz).formatToParts(new Date(ts))) o[p.type] = p.value; return o; }
export const dowOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
export function localParts(ts, tz = TZ) { const p = rawParts(ts, tz); return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) }; }
function tzOffsetMs(ts, tz) { const p = rawParts(ts, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000; }
export function localToTs(date, min, tz = TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, min);
  const ts = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(ts, tz);
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- lookups
export const bizById = (state, id) => state.businesses.find((b) => b.id === id) || fail('unknown_business', 404);
export const svcOf = (b, id) => b.services.find((s) => s.id === id);
export const staffOf = (b, id) => b.staff.find((s) => s.id === id);
const bookingsOf = (state, biz) => state.bookings.filter((x) => x.biz === biz);

// ---------------------------------------------------------------- availability
// The windows in which a staff member can take appointments on a date: business hours, intersected with the personal
// schedule, minus breaks, closed days and time off.
export function staffWindows(b, st, date) {
  if ((b.closed || []).includes(date)) return [];
  const dow = dowOf(date), bh = b.hours[dow], sh = st.hours[dow];
  if (!bh || !sh) return [];
  if ((st.off || []).some((o) => date >= o.from && date <= o.to)) return [];
  let wins = [[Math.max(bh[0], sh[0]), Math.min(bh[1], sh[1])]].filter((w) => w[0] < w[1]);
  for (const [bs, be] of st.breaks || []) {
    wins = wins.flatMap(([s, e]) => {
      if (be <= s || bs >= e) return [[s, e]];
      const out = []; if (bs > s) out.push([s, bs]); if (be < e) out.push([be, e]); return out;
    });
  }
  return wins;
}
// A booking occupies [start, end + buffer). Two bookings of one person must not overlap on that interval.
export function isFree(bookings, staffId, date, s, e, buffer, ignoreId) {
  return !bookings.some((x) => x.staffId === staffId && x.date === date && ACTIVE.has(x.status) && x.id !== ignoreId && s < x.end + (x.buffer || 0) && x.start < e + buffer);
}
export const fits = (b, st, date, s, e) => staffWindows(b, st, date).some(([ws, we]) => s >= ws && e <= we);

export function slotsFor(state, b, { serviceId, staffId = 'any', date, now, internal = false, ignoreId = null }) {
  const svc = svcOf(b, serviceId);
  if (!svc || !svc.active || !isDate(date)) return [];
  const today = localParts(now, b.tz).date;
  if (date < today) return [];
  if (!internal && date > addDays(today, b.settings.windowDays)) return [];
  const eligible = b.staff.filter((s) => s.active && svc.staff.includes(s.id) && (staffId === 'any' || s.id === staffId));
  const all = bookingsOf(state, b.id);
  const step = b.settings.step;
  const map = new Map();
  for (const st of eligible) {
    for (const [ws, we] of staffWindows(b, st, date)) {
      for (let s = Math.ceil(ws / step) * step; s + svc.dur <= we; s += step) {
        const startTs = localToTs(date, s, b.tz);
        if (internal ? startTs + svc.dur * 60000 <= now : startTs < now + b.settings.minNotice * 60000) continue;
        if (!isFree(all, st.id, date, s, s + svc.dur, svc.buffer, ignoreId)) continue;
        if (!map.has(s)) map.set(s, []);
        map.get(s).push(st.id);
      }
    }
  }
  return [...map].sort((a, c) => a[0] - c[0]).map(([start, staffIds]) => ({ start, staffIds }));
}
export function slotsRange(state, b, q, days) {
  const out = {};
  for (let i = 0; i < days; i++) { const d = addDays(q.from, i); out[d] = slotsFor(state, b, { ...q, date: d }).map((s) => s.start); }
  return out;
}
// "Any staff": give the slot to the free person with the lightest day, then the first by id.
function pickStaff(state, b, date, staffIds) {
  const load = (id) => state.bookings.filter((x) => x.biz === b.id && x.staffId === id && x.date === date && ACTIVE.has(x.status)).length;
  return [...staffIds].sort((a, c) => load(a) - load(c) || (a < c ? -1 : 1))[0];
}

// ---------------------------------------------------------------- clients
export function clientStats(state, clientId) {
  const mine = state.bookings.filter((x) => x.clientId === clientId);
  const c = (s) => mine.filter((x) => x.status === s).length;
  const done = mine.filter((x) => x.status === 'completed');
  const upcoming = mine.filter((x) => x.status === 'confirmed').sort((a, d) => (a.date + hm(a.start) < d.date + hm(d.start) ? -1 : 1))[0];
  return { visits: done.length, noShows: c('no_show'), cancels: c('cancelled'), lateCancels: mine.filter((x) => x.status === 'cancelled' && x.lateCancel).length, spent: done.reduce((n, x) => n + x.price, 0), lastVisit: done.map((x) => x.date).sort().pop() || null, next: upcoming ? { id: upcoming.id, date: upcoming.date, start: upcoming.start } : null };
}
export const isBlocked = (state, b, client) => clientStats(state, client.id).noShows >= b.settings.noShowLimit;

// ---------------------------------------------------------------- creating and moving bookings
let idCounter = 0;
const nextId = (state, p) => { state.seq[p] = (state.seq[p] || 0) + 1; return p + state.seq[p]; };

function clientOverlap(state, clientId, date, s, e, ignoreId) {
  return state.bookings.some((x) => x.clientId === clientId && x.id !== ignoreId && x.date === date && ['confirmed', 'checked_in'].includes(x.status) && s < x.end && x.start < e);
}
function validateSlot(state, b, { serviceId, staffId, date, start, now, internal, ignoreId }) {
  const svc = svcOf(b, serviceId);
  if (!svc || !svc.active) fail('unknown_service', 404);
  if (staffId !== 'any') { const st = staffOf(b, staffId); if (!st || !st.active || !svc.staff.includes(staffId)) fail('staff_not_for_service', 409); }
  if (!isDate(date)) fail('bad_date');
  if (!Number.isInteger(start)) fail('bad_time');
  const slot = slotsFor(state, b, { serviceId, staffId, date, now, internal, ignoreId }).find((x) => x.start === start);
  if (!slot) fail('slot_unavailable', 409);
  return { svc, staffId: staffId === 'any' ? pickStaff(state, b, date, slot.staffIds) : staffId };
}

export function createBooking(state, input, now, rand = Math.random) {
  const b = bizById(state, input.biz);
  const internal = !!input.internal;
  const source = internal ? (input.source === 'walk_in' ? 'walk_in' : 'phone') : 'online';
  const name = clean(input.client?.name, LIMITS.maxName);
  if (name.length < 2) fail('bad_name');
  const phone = normPhone(input.client?.phone);
  if (!phone) fail('bad_phone');
  const note = clean(input.note, LIMITS.maxNote);
  const { svc, staffId } = validateSlot(state, b, { serviceId: input.serviceId, staffId: input.staffId || 'any', date: input.date, start: input.start, now, internal });
  let client = state.clients.find((c) => c.biz === b.id && c.phone === phone);
  if (client && !internal && isBlocked(state, b, client)) fail('call_us', 403);
  if (!internal) {
    const future = state.bookings.filter((x) => x.biz === b.id && x.status === 'confirmed' && x.source === 'online' && client && x.clientId === client.id && localToTs(x.date, x.start, b.tz) > now).length;
    if (future >= LIMITS.maxFutureOnline) fail('too_many_bookings', 409);
  }
  if (!client) { client = { id: nextId(state, 'c'), biz: b.id, name, phone, notes: '', tags: [], created: now }; state.clients.push(client); }
  if (clientOverlap(state, client.id, input.date, input.start, input.start + svc.dur)) fail('client_overlap', 409);
  let code; do code = makeCode(rand); while (state.bookings.some((x) => x.code === code));
  const bk = { id: nextId(state, 'b'), code, biz: b.id, serviceId: svc.id, staffId, clientId: client.id, date: input.date, start: input.start, end: input.start + svc.dur, buffer: svc.buffer, price: svc.price, status: 'confirmed', source, note, createdAt: now, lateCancel: false, history: [{ t: now, ev: 'created', by: input.by || (internal ? 'staff' : 'client') }] };
  state.bookings.push(bk);
  return bk;
}

export function rescheduleBooking(state, id, to, now, by = 'staff', internal = true) {
  const bk = state.bookings.find((x) => x.id === id) || fail('not_found', 404);
  const b = bizById(state, bk.biz);
  if (bk.status !== 'confirmed') fail('not_editable', 409);
  const { staffId } = validateSlot(state, b, { serviceId: bk.serviceId, staffId: to.staffId || 'any', date: to.date, start: to.start, now, internal, ignoreId: bk.id });
  if (clientOverlap(state, bk.clientId, to.date, to.start, to.start + (bk.end - bk.start), bk.id)) fail('client_overlap', 409);
  const from = { date: bk.date, start: bk.start, staffId: bk.staffId };
  const dur = bk.end - bk.start;
  Object.assign(bk, { date: to.date, start: to.start, end: to.start + dur, staffId });
  bk.history.push({ t: now, ev: 'rescheduled', by, from, to: { date: bk.date, start: bk.start, staffId } });
  return bk;
}

export const startTsOf = (state, bk) => localToTs(bk.date, bk.start, bizById(state, bk.biz).tz);
export const endTsOf = (state, bk) => localToTs(bk.date, bk.end, bizById(state, bk.biz).tz);
export const isLateCancel = (state, bk, now) => { const b = bizById(state, bk.biz); return startTsOf(state, bk) - now < b.settings.cancelHours * 3600000; };

export function cancelBooking(state, id, now, { by = 'staff', reason = '' } = {}) {
  const bk = state.bookings.find((x) => x.id === id) || fail('not_found', 404);
  if (bk.status !== 'confirmed') fail('not_editable', 409);
  if (endTsOf(state, bk) <= now) fail('already_past', 409);
  bk.lateCancel = isLateCancel(state, bk, now);
  bk.status = 'cancelled';
  bk.history.push({ t: now, ev: 'cancelled', by, reason: clean(reason, 120), late: bk.lateCancel });
  return bk;
}

const NEXT = { confirmed: ['checked_in', 'no_show'], checked_in: ['completed'], no_show: ['confirmed'] };
export function setStatus(state, id, status, now, by = 'staff') {
  const bk = state.bookings.find((x) => x.id === id) || fail('not_found', 404);
  const b = bizById(state, bk.biz);
  if (!(NEXT[bk.status] || []).includes(status)) fail('invalid_transition', 409);
  const s = startTsOf(state, bk), e = endTsOf(state, bk);
  if (status === 'checked_in' && (now >= e || localParts(now, b.tz).date !== bk.date)) fail('wrong_day', 409);
  if (status === 'no_show' && now < s + b.settings.graceMin * 60000) fail('too_early', 409, { graceMin: b.settings.graceMin });
  if (status === 'confirmed') { // reopening a wrongly marked no-show: only if the slot is still free
    const others = bookingsOf(state, bk.biz);
    if (!isFree(others, bk.staffId, bk.date, bk.start, bk.end, bk.buffer, bk.id)) fail('slot_unavailable', 409);
  }
  bk.status = status;
  bk.history.push({ t: now, ev: status, by });
  return bk;
}

// ---------------------------------------------------------------- reminders (derived from bookings, plus a small log)
export function remindersFor(state, now) {
  const out = [];
  for (const bk of state.bookings) {
    if (bk.status !== 'confirmed') continue;
    const b = bizById(state, bk.biz);
    const s = startTsOf(state, bk);
    if (s < now - 3600000) continue;
    for (const off of b.settings.reminders) {
      const dueAt = s - off * 60000;
      const key = bk.id + ':' + off;
      const log = state.reminderLog[key];
      let status;
      if (log) status = log.status;
      else if (dueAt < bk.createdAt) status = 'skipped_late'; // booked after the reminder time had passed
      else status = dueAt <= now ? 'due' : 'scheduled';
      out.push({ key, bookingId: bk.id, biz: bk.biz, kind: off >= 1440 ? 'day_before' : 'hours_before', offsetMin: off, dueAt, status, at: log?.at || null });
    }
  }
  return out.sort((a, c) => a.dueAt - c.dueAt);
}

// ---------------------------------------------------------------- reports
export function report(state, bizId, now, days = 30) {
  const b = bizById(state, bizId);
  const today = localParts(now, b.tz).date;
  const from = addDays(today, -(days - 1));
  const inRange = state.bookings.filter((x) => x.biz === bizId && x.date >= from && x.date <= today);
  const cnt = (s) => inRange.filter((x) => x.status === s).length;
  const completed = inRange.filter((x) => x.status === 'completed');
  const settled = cnt('completed') + cnt('no_show');
  const upcoming = state.bookings.filter((x) => x.biz === bizId && x.status === 'confirmed' && (x.date > today || (x.date === today && endTsOf(state, x) > now)));
  const perStaff = b.staff.filter((s) => s.active).map((st) => {
    let avail = 0;
    for (let i = 0; i < days; i++) avail += staffWindows(b, st, addDays(from, i)).reduce((n, [s, e]) => n + (e - s), 0);
    const booked = inRange.filter((x) => x.staffId === st.id && ['completed', 'checked_in', 'confirmed'].includes(x.status)).reduce((n, x) => n + (x.end - x.start), 0);
    return { staffId: st.id, bookedMin: booked, availMin: avail, utilization: avail ? Math.round((booked / avail) * 100) : 0, revenue: completed.filter((x) => x.staffId === st.id).reduce((n, x) => n + x.price, 0), noShows: inRange.filter((x) => x.staffId === st.id && x.status === 'no_show').length };
  });
  const bySvc = b.services.map((s) => ({ serviceId: s.id, count: completed.filter((x) => x.serviceId === s.id).length, revenue: completed.filter((x) => x.serviceId === s.id).reduce((n, x) => n + x.price, 0) })).filter((x) => x.count).sort((a, c) => c.revenue - a.revenue);
  const byDow = Array.from({ length: 7 }, (_, d) => inRange.filter((x) => dowOf(x.date) === d && ACTIVE.has(x.status)).length);
  const daily = []; for (let i = 0; i < days; i++) { const d = addDays(from, i); daily.push({ date: d, revenue: completed.filter((x) => x.date === d).reduce((n, x) => n + x.price, 0) }); }
  return { from, to: today, days, total: inRange.length, completed: cnt('completed'), noShows: cnt('no_show'), cancelled: cnt('cancelled'), lateCancels: inRange.filter((x) => x.lateCancel).length, noShowRate: settled ? Math.round((cnt('no_show') / settled) * 1000) / 10 : 0, revenue: completed.reduce((n, x) => n + x.price, 0), lostToNoShow: inRange.filter((x) => x.status === 'no_show').reduce((n, x) => n + x.price, 0), upcomingCount: upcoming.length, upcomingValue: upcoming.reduce((n, x) => n + x.price, 0), onlineShare: inRange.length ? Math.round((inRange.filter((x) => x.source === 'online').length / inRange.length) * 100) : 0, perStaff, bySvc, byDow, daily };
}

// ---------------------------------------------------------------- roles
const R = (...r) => new Set(r);
export const PERMS = {
  'booking.create': R('owner', 'manager', 'reception'), 'booking.reschedule': R('owner', 'manager', 'reception'), 'booking.cancel': R('owner', 'manager', 'reception'),
  'booking.status': R('owner', 'manager', 'reception', 'staff'), 'booking.note': R('owner', 'manager', 'reception', 'staff'),
  'client.save': R('owner', 'manager', 'reception'), 'service.save': R('owner', 'manager'), 'staff.save': R('owner', 'manager'),
  'timeoff.add': R('owner', 'manager', 'staff'), 'timeoff.remove': R('owner', 'manager', 'staff'),
  'settings.save': R('owner'), 'reminder.mark': R('owner', 'manager', 'reception'), 'reminder.runDue': R('owner', 'manager', 'reception'), reset: R('owner'),
};

// ---------------------------------------------------------------- admin operations
function conflictsWith(state, b, staffId, nowTs, pred) {
  return state.bookings.filter((x) => x.biz === b.id && x.staffId === staffId && x.status === 'confirmed' && endTsOf(state, x) > nowTs && pred(x));
}
const cleanHours = (h) => Array.from({ length: 7 }, (_, i) => { const v = h?.[i]; if (!v) return null; const s = clamp(Math.round(num(v[0], 0)), 0, 1439), e = clamp(Math.round(num(v[1], 0)), 1, 1440); return s < e ? [s, e] : null; });

export function applyOp(state, op, actor, now, rand = Math.random) {
  const type = op?.type;
  if (!type || !(type in PERMS)) fail('unknown_op');
  if (!PERMS[type].has(actor.role)) fail('forbidden', 403);
  const b = bizById(state, actor.biz);
  const by = actor.role + (actor.staffId ? ':' + actor.staffId : '');
  const own = (bk) => { if (actor.role === 'staff' && bk.staffId !== actor.staffId) fail('not_your_booking', 403); };
  const mine = (id) => { const bk = state.bookings.find((x) => x.id === id && x.biz === b.id) || fail('not_found', 404); own(bk); return bk; };

  switch (type) {
    case 'booking.create': {
      const bk = createBooking(state, { biz: b.id, serviceId: op.serviceId, staffId: op.staffId || 'any', date: op.date, start: op.start, client: op.client, note: op.note, internal: true, source: op.source, by }, now, rand);
      return { bookingId: bk.id, code: bk.code };
    }
    case 'booking.reschedule': mine(op.id); rescheduleBooking(state, op.id, { date: op.date, start: op.start, staffId: op.staffId || 'any' }, now, by, true); return { bookingId: op.id };
    case 'booking.cancel': mine(op.id); cancelBooking(state, op.id, now, { by, reason: op.reason }); return { bookingId: op.id };
    case 'booking.status': mine(op.id); setStatus(state, op.id, op.status, now, by); return { bookingId: op.id };
    case 'booking.note': { const bk = mine(op.id); bk.note = clean(op.note, LIMITS.maxNote); bk.history.push({ t: now, ev: 'note', by }); return { bookingId: bk.id }; }
    case 'client.save': {
      const c = state.clients.find((x) => x.id === op.id && x.biz === b.id) || fail('not_found', 404);
      if (op.name !== undefined) { const n = clean(op.name, LIMITS.maxName); if (n.length < 2) fail('bad_name'); c.name = n; }
      if (op.phone !== undefined) { const p = normPhone(op.phone); if (!p) fail('bad_phone'); if (state.clients.some((x) => x.biz === b.id && x.id !== c.id && x.phone === p)) fail('phone_in_use', 409); c.phone = p; }
      if (op.notes !== undefined) c.notes = clean(op.notes, 400);
      if (op.tags !== undefined) c.tags = [...new Set((Array.isArray(op.tags) ? op.tags : String(op.tags).split(',')).map((t) => clean(t, 20)).filter(Boolean))].slice(0, 6);
      return { clientId: c.id };
    }
    case 'service.save': {
      let s = op.id ? svcOf(b, op.id) : null;
      if (op.id && !s) fail('not_found', 404);
      const nameEn = clean(op.name?.en, 60), nameAr = clean(op.name?.ar, 60);
      if (!s) { if (!nameEn || !nameAr) fail('bad_name'); s = { id: nextId(state, 's'), cat: clean(op.cat, 20) || 'general', name: { en: nameEn, ar: nameAr }, desc: { en: '', ar: '' }, dur: 30, buffer: 0, price: 0, active: true, staff: [] }; b.services.push(s); }
      if (nameEn) s.name.en = nameEn; if (nameAr) s.name.ar = nameAr;
      if (op.desc) { s.desc.en = clean(op.desc.en, 160); s.desc.ar = clean(op.desc.ar, 160); }
      if (op.dur !== undefined) { const d = Math.round(num(op.dur, 0) / 5) * 5; if (d < 10 || d > 300) fail('bad_duration'); s.dur = d; }
      if (op.buffer !== undefined) s.buffer = clamp(Math.round(num(op.buffer, 0) / 5) * 5, 0, 60);
      if (op.price !== undefined) { const p = num(op.price, -1); if (p < 0 || p > 100000) fail('bad_price'); s.price = Math.round(p * 100) / 100; }
      if (op.staff) { const ids = [...new Set(op.staff.filter((id) => staffOf(b, id)))]; if (!ids.length && s.active) fail('need_staff'); s.staff = ids; }
      if (op.active !== undefined) {
        const want = !!op.active;
        if (!want && state.bookings.some((x) => x.biz === b.id && x.serviceId === s.id && x.status === 'confirmed' && endTsOf(state, x) > now)) fail('has_bookings', 409);
        s.active = want;
      }
      return { serviceId: s.id };
    }
    case 'staff.save': {
      const st = staffOf(b, op.id) || fail('not_found', 404);
      const newHours = op.hours ? cleanHours(op.hours) : st.hours;
      const newBreaks = op.breaks ? op.breaks.map(([s, e]) => [clamp(Math.round(num(s)), 0, 1439), clamp(Math.round(num(e)), 1, 1440)]).filter(([s, e]) => s < e).slice(0, 3) : st.breaks;
      const trial = { ...st, hours: newHours, breaks: newBreaks, active: op.active === undefined ? st.active : !!op.active };
      // Changing hours, breaks or deactivating must not strand appointments that already exist.
      const stranded = conflictsWith(state, b, st.id, now, (x) => !trial.active || !fits(b, trial, x.date, x.start, x.end));
      if (stranded.length) fail('has_bookings', 409, { conflicts: stranded.map((x) => x.id) });
      st.hours = newHours; st.breaks = newBreaks; st.active = trial.active;
      if (op.title) { st.title = { en: clean(op.title.en, 50) || st.title.en, ar: clean(op.title.ar, 50) || st.title.ar }; }
      return { staffId: st.id };
    }
    case 'timeoff.add': {
      const staffId = actor.role === 'staff' ? actor.staffId : op.staffId;
      const st = staffOf(b, staffId) || fail('not_found', 404);
      if (!isDate(op.from) || !isDate(op.to) || op.to < op.from) fail('bad_date');
      if (daysBetween(op.from, op.to) > 60) fail('too_long');
      if (op.to < localParts(now, b.tz).date) fail('in_the_past');
      if ((st.off || []).some((o) => op.from <= o.to && op.to >= o.from)) fail('overlaps_time_off', 409);
      const hit = conflictsWith(state, b, st.id, now, (x) => x.date >= op.from && x.date <= op.to);
      if (hit.length) fail('has_bookings', 409, { conflicts: hit.map((x) => x.id) });
      const o = { id: nextId(state, 'o'), from: op.from, to: op.to, reason: clean(op.reason, 60) };
      (st.off ||= []).push(o);
      return { timeOffId: o.id };
    }
    case 'timeoff.remove': {
      for (const st of b.staff) {
        const i = (st.off || []).findIndex((o) => o.id === op.id);
        if (i >= 0) { if (actor.role === 'staff' && st.id !== actor.staffId) fail('forbidden', 403); st.off.splice(i, 1); return { removed: op.id }; }
      }
      fail('not_found', 404);
      break;
    }
    case 'settings.save': {
      const s = b.settings;
      if (op.step !== undefined) { const v = num(op.step); if (![5, 10, 15, 20, 30, 60].includes(v)) fail('bad_step'); s.step = v; }
      if (op.minNotice !== undefined) s.minNotice = clamp(Math.round(num(op.minNotice)), 0, 4320);
      if (op.windowDays !== undefined) s.windowDays = clamp(Math.round(num(op.windowDays)), 1, 90);
      if (op.cancelHours !== undefined) s.cancelHours = clamp(Math.round(num(op.cancelHours)), 0, 168);
      if (op.noShowLimit !== undefined) s.noShowLimit = clamp(Math.round(num(op.noShowLimit)), 1, 10);
      if (op.graceMin !== undefined) s.graceMin = clamp(Math.round(num(op.graceMin)), 0, 120);
      if (op.hours) {
        const h = cleanHours(op.hours);
        const stranded = state.bookings.filter((x) => x.biz === b.id && x.status === 'confirmed' && endTsOf(state, x) > now && !(h[dowOf(x.date)] && x.start >= h[dowOf(x.date)][0] && x.end <= h[dowOf(x.date)][1]));
        if (stranded.length) fail('has_bookings', 409, { conflicts: stranded.map((x) => x.id) });
        b.hours = h;
      }
      if (op.closeDate) {
        if (!isDate(op.closeDate)) fail('bad_date');
        if (state.bookings.some((x) => x.biz === b.id && x.date === op.closeDate && x.status === 'confirmed')) fail('has_bookings', 409);
        b.closed = [...new Set([...(b.closed || []), op.closeDate])].sort();
      }
      if (op.openDate) b.closed = (b.closed || []).filter((d) => d !== op.openDate);
      return { settings: b.settings };
    }
    case 'reminder.mark': {
      const r = remindersFor(state, now).find((x) => x.key === op.key && x.biz === b.id) || fail('not_found', 404);
      if (!['sent', 'skipped'].includes(op.status)) fail('bad_status');
      if (r.status === 'scheduled' && op.status === 'sent') fail('not_due', 409);
      state.reminderLog[op.key] = { status: op.status, at: now };
      return { key: op.key };
    }
    case 'reminder.runDue': {
      let n = 0;
      for (const r of remindersFor(state, now)) if (r.biz === b.id && r.status === 'due') { state.reminderLog[r.key] = { status: 'sent', at: now }; n++; }
      return { marked: n };
    }
    case 'reset': return { reset: true };
  }
  fail('unknown_op');
}

// Invariant used by tests and the seed: no two active bookings of one staff member overlap, every booking fits the schedule.
export function findOverlaps(state) {
  const bad = [];
  const act = state.bookings.filter((x) => ACTIVE.has(x.status));
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const a = act[i], c = act[j];
    if (a.biz === c.biz && a.staffId === c.staffId && a.date === c.date && a.start < c.end + (c.buffer || 0) && c.start < a.end + (a.buffer || 0)) bad.push([a.id, c.id]);
  }
  return bad;
}
