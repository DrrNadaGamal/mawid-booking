import { ApiError, ROLES, applyOp, bizById, cancelBooking, clientStats, createBooking, endTsOf, isBlocked, isDate, isLateCancel, localParts, maskPhone, normCode, normPhone, remindersFor, report, rescheduleBooking, slotsRange, startTsOf, staffOf, svcOf, addDays } from './core.js';
import { loadState, mutate } from './store.js';
import { seedState } from './seed.js';

const ok = (json, status = 200) => ({ status, json });
const bad = (error, status = 400, extra = {}) => ({ status, json: { error, ...extra } });

const hits = new Map(); // per-instance, best effort
export function rateLimited(key, now, max, windowMs = 60000) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function publicBiz(state, b, now) {
  return {
    id: b.id, type: b.type, name: b.name, tagline: b.tagline, address: b.address, phone: b.phone, color: b.color, hours: b.hours, closed: b.closed, cats: b.cats, tz: b.tz, now,
    today: localParts(now, b.tz).date, nowMin: localParts(now, b.tz).min,
    policy: { minNotice: b.settings.minNotice, windowDays: b.settings.windowDays, cancelHours: b.settings.cancelHours },
    services: b.services.filter((s) => s.active).map((s) => ({ id: s.id, cat: s.cat, name: s.name, desc: s.desc, dur: s.dur, price: s.price, staff: s.staff.filter((id) => staffOf(b, id)?.active) })),
    staff: b.staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, title: s.title, color: s.color })),
  };
}
function publicBooking(state, bk, now) {
  const b = bizById(state, bk.biz); const svc = svcOf(b, bk.serviceId); const st = staffOf(b, bk.staffId);
  const future = bk.status === 'confirmed' && endTsOf(state, bk) > now;
  return {
    code: bk.code, status: bk.status, biz: b.id, bizName: b.name, address: b.address, phone: b.phone, service: svc ? { id: svc.id, name: svc.name, dur: svc.dur } : null, staff: st ? { id: st.id, name: st.name } : null,
    date: bk.date, start: bk.start, end: bk.end, startTs: startTsOf(state, bk), price: bk.price, clientName: state.clients.find((c) => c.id === bk.clientId)?.name || '',
    cancelHours: b.settings.cancelHours, canCancel: future, canReschedule: future && !isLateCancel(state, bk, now), freeCancel: future && !isLateCancel(state, bk, now), lateCancel: !!bk.lateCancel,
  };
}

function actorFrom(headers, state, bizId) {
  const role = headers['x-role'];
  if (!ROLES.includes(role)) return null;
  const b = bizById(state, bizId);
  let staffId = null;
  if (role === 'staff') { staffId = headers['x-staff']; if (!staffOf(b, staffId)) return null; }
  return { role, staffId, biz: b.id };
}

function appView(state, b, actor, now) {
  const today = localParts(now, b.tz).date;
  let bookings = state.bookings.filter((x) => x.biz === b.id && x.date >= addDays(today, -35));
  if (actor.role === 'staff') bookings = bookings.filter((x) => x.staffId === actor.staffId);
  const clientIds = new Set(bookings.map((x) => x.clientId));
  let clients = state.clients.filter((c) => c.biz === b.id);
  if (actor.role === 'staff') clients = clients.filter((c) => clientIds.has(c.id));
  const full = actor.role !== 'staff';
  return {
    role: actor.role, staffId: actor.staffId, now, today, nowMin: localParts(now, b.tz).min, version: state.version,
    business: { ...b, services: b.services, staff: b.staff },
    bookings,
    clients: clients.map((c) => ({ ...c, stats: clientStats(state, c.id), blocked: isBlocked(state, b, c) })),
    reminders: full ? remindersFor(state, now).filter((r) => r.biz === b.id) : [],
    report: full ? report(state, b.id, now, 30) : null,
  };
}

export async function handle({ method, path, query = {}, body, headers = {}, ip = 'x', store, now = Date.now(), rand = Math.random }) {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [a, b1] = parts;
  body = body && typeof body === 'object' ? body : {};
  try {
    if (method === 'GET' && a === 'health') return ok({ ok: true, time: now });

    if (method === 'GET' && a === 'businesses') {
      const { state } = await loadState(store, now);
      return ok({ businesses: state.businesses.map((b) => ({ id: b.id, type: b.type, name: b.name, tagline: b.tagline, color: b.color, address: b.address })), now });
    }
    if (method === 'GET' && a === 'public' && b1) {
      const { state } = await loadState(store, now);
      return ok(publicBiz(state, bizById(state, b1), now));
    }
    if (method === 'GET' && a === 'slots' && b1) {
      if (rateLimited('slots:' + ip, now, 120)) return bad('rate_limited', 429);
      const { state } = await loadState(store, now);
      const b = bizById(state, b1);
      const from = isDate(query.from) ? query.from : localParts(now, b.tz).date;
      const days = Math.min(14, Math.max(1, Number(query.days) || 1));
      return ok({ from, days: slotsRange(state, b, { serviceId: query.service, staffId: query.staff || 'any', from, now }, days) });
    }
    if (method === 'POST' && a === 'book' && b1) {
      if (rateLimited('book:' + ip, now, 12)) return bad('rate_limited', 429);
      const r = await mutate(store, now, (state) => {
        try {
          const bk = createBooking(state, { biz: b1, serviceId: body.serviceId, staffId: body.staffId || 'any', date: body.date, start: Number(body.start), client: body.client, note: body.note, internal: false }, now, rand);
          return { ok: true, booking: publicBooking(state, bk, now) };
        } catch (e) { if (e instanceof ApiError) return { noWrite: true, error: e.code, status: e.status, extra: e.extra }; throw e; }
      });
      if (r.error) return bad(r.error, r.status || 400, r.extra);
      return ok({ booking: r.booking }, 201);
    }
    if (method === 'POST' && a === 'manage') {
      if (rateLimited('manage:' + ip, now, 30)) return bad('rate_limited', 429);
      const code = normCode(body.code), phone = normPhone(body.phone);
      if (!code || !phone) return bad('not_found', 404);
      const r = await mutate(store, now, (state) => {
        const bk = state.bookings.find((x) => x.code === code);
        const client = bk && state.clients.find((c) => c.id === bk.clientId);
        if (!bk || !client || client.phone !== phone) return { noWrite: true, error: 'not_found', status: 404 };
        try {
          if (body.action === 'get') return { noWrite: true, booking: publicBooking(state, bk, now) };
          if (body.action === 'cancel') { cancelBooking(state, bk.id, now, { by: 'client', reason: 'cancelled by client' }); return { ok: true, booking: publicBooking(state, bk, now) }; }
          if (body.action === 'reschedule') {
            if (isLateCancel(state, bk, now)) return { noWrite: true, error: 'too_late_to_move', status: 409 };
            rescheduleBooking(state, bk.id, { date: body.date, start: Number(body.start), staffId: body.staffId || 'any' }, now, 'client', false);
            return { ok: true, booking: publicBooking(state, bk, now) };
          }
          return { noWrite: true, error: 'unknown_action', status: 400 };
        } catch (e) { if (e instanceof ApiError) return { noWrite: true, error: e.code, status: e.status, extra: e.extra }; throw e; }
      });
      if (r.error) return bad(r.error, r.status || 400, r.extra);
      return ok({ booking: r.booking });
    }

    // ----- staff side: role is sent as a header (demo role picker, not authentication)
    if (method === 'GET' && a === 'app' && b1) {
      const { state } = await loadState(store, now);
      const actor = actorFrom(headers, state, b1);
      if (!actor) return bad('forbidden', 403);
      return ok(appView(state, bizById(state, b1), actor, now));
    }
    if (method === 'GET' && a === 'slots-app' && b1) {
      const { state } = await loadState(store, now);
      const actor = actorFrom(headers, state, b1);
      if (!actor || actor.role === 'staff') return bad('forbidden', 403);
      const b = bizById(state, b1);
      const from = isDate(query.from) ? query.from : localParts(now, b.tz).date;
      const days = Math.min(14, Math.max(1, Number(query.days) || 1));
      const ignoreId = query.ignore || null;
      return ok({ from, days: slotsRange(state, b, { serviceId: query.service, staffId: query.staff || 'any', from, now, internal: true, ignoreId }, days) });
    }
    if (method === 'POST' && a === 'op' && b1) {
      const op = body.op || {};
      if (JSON.stringify(op).length > 20000) return bad('too_large', 413);
      const r = await mutate(store, now, async (state) => {
        const actor = actorFrom(headers, state, b1);
        if (!actor) return { noWrite: true, error: 'forbidden', status: 403 };
        if (op.opId) { const seen = state.ops.find((o) => o.id === op.opId); if (seen) return { noWrite: true, result: seen.result, duplicate: true }; }
        try {
          if (op.type === 'reset') {
            if (actor.role !== 'owner') return { noWrite: true, error: 'forbidden', status: 403 };
            return { replace: seedState(now), result: { reset: true } };
          }
          const result = applyOp(state, op, actor, now, rand);
          if (op.opId) { state.ops.push({ id: String(op.opId).slice(0, 60), result }); if (state.ops.length > 300) state.ops.splice(0, state.ops.length - 300); }
          return { result };
        } catch (e) { if (e instanceof ApiError) return { noWrite: true, error: e.code, status: e.status, extra: e.extra }; throw e; }
      });
      if (r.error) return bad(r.error, r.status || 400, r.extra);
      return ok({ result: r.result, duplicate: !!r.duplicate });
    }
    return bad('not_found', 404);
  } catch (e) {
    if (e instanceof ApiError) return bad(e.code, e.status, e.extra);
    console.error(e);
    return bad('server_error', 500);
  }
}
