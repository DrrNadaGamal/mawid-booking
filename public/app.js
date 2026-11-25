import { $, $$, api, esc, t, loc, locAr, lang, toggleLang, topbar, registerSW, money, nf, fmtTime, fmtRange, fmtDate, fmtDay, fmtStamp, addDays, dowOf, hmStr, parseHm, errText, getRole, setRole, toast, initials } from './common.js';

const qp = new URLSearchParams(location.search);
const S = { biz: qp.get('b') || 'layali', role: null, d: null, view: 'cal', date: null, mode: 'day', weekStaff: null, showCancelled: false, modal: null, drawer: null, offline: false, q: '', f: { when: 'upcoming', status: '', staff: '' }, rem: null, err: '', conflicts: null, queue: [] };
const ICON = { cal: '<path d="M3.5 5h17v15h-17zM8 3v4M16 3v4M3.5 10h17"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 7M18 14.5c2.2.6 3.5 2.4 3.5 5.5"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>', team: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>', bell: '<path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15zM10 21h4"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>' };
const ico = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const NAV = [['cal', 'navCal', 'cal', 'owner,manager,reception,staff'], ['bookings', 'navBookings', 'list', 'owner,manager,reception,staff'], ['clients', 'navClients', 'users', 'owner,manager,reception,staff'], ['services', 'navServices', 'tag', 'owner,manager,reception'], ['team', 'navTeam', 'team', 'owner,manager,reception,staff'], ['reminders', 'navReminders', 'bell', 'owner,manager,reception'], ['reports', 'navReports', 'chart', 'owner,manager'], ['settings', 'navSettings', 'gear', 'owner,manager,reception']];
const can = (...r) => r.includes(S.role.role);
const B = () => S.d.business;
const svc = (id) => B().services.find((s) => s.id === id);
const stf = (id) => B().staff.find((s) => s.id === id);
const cl = (id) => S.d.clients.find((c) => c.id === id);
const cName = (c) => (c ? locAr(c) : '?');
const rolesHdr = () => S.role;

// ---------------------------------------------------------------- data
async function load(keep) {
  try { S.d = await api('app/' + S.biz, { role: rolesHdr() }); S.offline = false; try { localStorage.setItem('mawid_app_' + S.biz + S.role.role + (S.role.staffId || ''), JSON.stringify(S.d)); } catch {} await flush(); }
  catch (e) {
    if (e.code === 'network') { const c = localStorage.getItem('mawid_app_' + S.biz + S.role.role + (S.role.staffId || '')); if (c) { S.d = JSON.parse(c); S.offline = true; } else S.err = errText('network'); }
    else S.err = errText(e.code);
  }
  if (S.d && !S.date) S.date = S.d.today;
  if (S.d && !S.weekStaff) S.weekStaff = S.role.staffId || B().staff.find((s) => s.active)?.id;
  if (!keep) S.modal = null;
  render();
}
async function op(o, { ok, queueable } = {}) {
  o.opId = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  try { const r = await api('op/' + S.biz, { method: 'POST', body: { op: o }, role: rolesHdr() }); if (ok) toast(ok); S.err = ''; await load(false); return r.result; }
  catch (e) {
    if (e.code === 'network' && queueable) { S.queue.push(o); localStorage.setItem('mawid_q', JSON.stringify(S.queue)); toast(t('queued', { n: nf(S.queue.length) })); render(); return null; }
    S.err = errText(e.code); S.conflicts = e.extra?.conflicts || null; toast(S.err, true); render(); throw e;
  }
}
async function flush() {
  S.queue = JSON.parse(localStorage.getItem('mawid_q') || '[]'); if (!S.queue.length) return;
  const left = []; let done = 0;
  for (const o of S.queue) { try { await api('op/' + S.biz, { method: 'POST', body: { op: o }, role: rolesHdr() }); done++; } catch (e) { if (e.code === 'network') left.push(o); else toast(errText(e.code), true); } }
  S.queue = left; localStorage.setItem('mawid_q', JSON.stringify(left)); if (done) { toast(t('synced')); S.d = await api('app/' + S.biz, { role: rolesHdr() }); }
}
window.addEventListener('online', () => load(true));
window.addEventListener('offline', () => { S.offline = true; render(); });

// ---------------------------------------------------------------- shell
function render() {
  if (!S.role) return picker();
  if (!S.d) { $('#root').innerHTML = topbar() + `<main class="wrap mt">${S.err ? `<p class="banner bad">${esc(S.err)}</p>` : `<p>${esc(t('loading'))}</p>`}</main>`; return; }
  const b = B(); const view = S.view;
  const staffName = S.role.staffId ? ' · ' + loc(stf(S.role.staffId)) : '';
  const extra = `<span class="pill"><span class="dot" style="background:${esc(b.color)}"></span>${esc(loc(b))}</span><span class="pill">${esc(roleLabel())}${esc(staffName)}</span><button class="btn ghost sm" data-switch type="button">${esc(t('switchRole'))}</button>`;
  $('#root').innerHTML = topbar(extra) + `<div class="app"><nav class="side" aria-label="Sections">${NAV.filter((n) => n[3].split(',').includes(S.role.role)).map(([k, l, i]) => `<a href="#/${k}" data-view="${k}" ${view === k ? 'aria-current="page"' : ''}>${ico(i)}${esc(t(l))}</a>`).join('')}</nav><main class="content" id="main">${S.offline ? `<p class="banner" style="margin-bottom:12px">${esc(t('offlineApp'))}</p>` : ''}${S.queue.length ? `<p class="banner" style="margin-bottom:12px">${esc(t('queued', { n: nf(S.queue.length) }))}</p>` : ''}${VIEWS[view]()}</main></div>${S.drawer ? drawer() : ''}${S.modal ? S.modal() : ''}`;
  const sc = $('.cal'); if (sc && S.view === 'cal' && !S._scrolled) { sc.scrollTop = Math.max(0, (nowMin() - calStart() - 90) * PPM); S._scrolled = true; }
}
const roleLabel = () => ({ owner: t('roleOwner'), manager: t('roleManager'), reception: t('roleReception'), staff: t('roleStaff') }[S.role.role]);
function picker() {
  const L = ['owner', 'manager', 'reception', 'staff'];
  const names = { owner: ['roleOwner', 'roleOwnerD'], manager: ['roleManager', 'roleManagerD'], reception: ['roleReception', 'roleReceptionD'], staff: ['roleStaff', 'roleStaffD'] };
  $('#root').innerHTML = topbar() + `<main class="wrap mt2" style="max-width:640px"><h1 style="font-size:26px">${esc(t('pickRole'))}</h1><p class="muted">${esc(t('pickRoleSub'))}</p><div class="pick mt">${['layali', 'pulse'].map((x) => `<button data-biz="${x}" class="${S.biz === x ? 'sel' : ''}" type="button">${x === 'layali' ? 'Layali Beauty Lounge' : 'Pulse Training Studio'}</button>`).join('')}</div><div class="mt">${L.map((r) => `<button class="rolecard" data-role="${r}" type="button"><span><b>${esc(t(names[r][0]))}</b><span class="muted">${esc(t(names[r][1]))}</span></span></button>`).join('')}</div>${S.pickStaff ? `<h2 class="mt">${esc(t('pickPerson'))}</h2><div class="pick mt">${S.pickStaff.map((s) => `<button data-staffpick="${esc(s.id)}" type="button">${esc(loc(s))} · ${esc(loc(s, 'title'))}</button>`).join('')}</div>` : ''}</main>`;
}

// ---------------------------------------------------------------- calendar
const PPM = 1.15;
const dayHours = (date) => { const h = B().hours[dowOf(date)]; return h; };
const calStart = () => Math.floor(Math.min(...B().hours.filter(Boolean).map((h) => h[0])) / 60) * 60;
const calEnd = () => Math.ceil(Math.max(...B().hours.filter(Boolean).map((h) => h[1])) / 60) * 60;
const nowMin = () => S.d.nowMin;
function windows(st, date) {
  const b = B(); if ((b.closed || []).includes(date)) return [];
  const dow = dowOf(date), bh = b.hours[dow], sh = st.hours[dow]; if (!bh || !sh || (st.off || []).some((o) => date >= o.from && date <= o.to)) return [];
  let w = [[Math.max(bh[0], sh[0]), Math.min(bh[1], sh[1])]].filter((x) => x[0] < x[1]);
  for (const [bs, be] of st.breaks || []) w = w.flatMap(([s, e]) => (be <= s || bs >= e ? [[s, e]] : [...(bs > s ? [[s, bs]] : []), ...(be < e ? [[be, e]] : [])]));
  return w;
}
function offBlocks(st, date) {
  const gs = calStart(), ge = calEnd(); const w = windows(st, date); const out = []; let c = gs;
  const label = (st.off || []).some((o) => date >= o.from && date <= o.to) ? t('off') : (B().closed || []).includes(date) ? t('closed') : !w.length ? t('off') : '';
  if (!w.length) return `<div class="off" style="top:0;height:${(ge - gs) * PPM}px"><em>${esc(label)}</em></div>`;
  for (const [s, e] of w) { if (s > c) out.push([c, s]); c = e; } if (c < ge) out.push([c, ge]);
  return out.map(([s, e]) => `<div class="off" style="top:${(s - gs) * PPM}px;height:${(e - s) * PPM}px"></div>`).join('');
}
function block(bk) {
  const s = stf(bk.staffId), c = cl(bk.clientId), v = svc(bk.serviceId); const gs = calStart();
  const h = Math.max(26, (bk.end - bk.start) * PPM - 2);
  return `<button class="blk ${bk.status}" data-bk="${esc(bk.id)}" style="top:${(bk.start - gs) * PPM}px;height:${h}px;--b:${esc(s?.color || '#2c6bb3')};--c:${esc(tint(s?.color))}" type="button"><b>${esc(fmtTime(bk.start))} ${esc(cName(c))}</b><span>${esc(loc(v))}</span></button>`;
}
const tint = (hex) => { if (!hex) return '#dfeaf8'; const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const m = (x) => Math.round(x + (255 - x) * 0.82); return `rgb(${m(r)},${m(g)},${m(b)})`; };
function calView() {
  const d = S.date; const gs = calStart(), ge = calEnd(); const H = (ge - gs) * PPM;
  const bks = S.d.bookings.filter((x) => (S.showCancelled || x.status !== 'cancelled'));
  const week = S.mode === 'week';
  const cols = week ? [0, 1, 2, 3, 4, 5, 6].map((i) => { const mon = addDays(d, -((dowOf(d) + 1) % 7)); return { date: addDays(mon, i), st: stf(S.weekStaff) }; }) : B().staff.filter((s) => s.active && (!S.role.staffId || s.id === S.role.staffId)).map((s) => ({ date: d, st: s }));
  const lines = []; for (let m = gs; m < ge; m += 30) lines.push(`<div class="hl ${m % 60 === 0 ? 'h' : ''}" style="top:${(m - gs) * PPM}px"></div>`);
  const axis = []; for (let m = gs; m < ge; m += 60) axis.push(`<span style="top:${(m - gs) * PPM + 8}px">${esc(fmtTime(m))}</span>`);
  const tpl = `64px repeat(${cols.length},minmax(150px,1fr))`;
  const f = fmtDay(d);
  const stpick = week && !S.role.staffId ? `<select data-weekstaff aria-label="${esc(t('person'))}" style="width:auto">${B().staff.filter((s) => s.active).map((s) => `<option value="${esc(s.id)}" ${s.id === S.weekStaff ? 'selected' : ''}>${esc(loc(s))}</option>`).join('')}</select>` : '';
  return `<div class="row" style="margin-bottom:12px"><button class="btn ghost sm" data-today type="button">${esc(t('today'))}</button><button class="btn ghost sm" data-step="-1" aria-label="${esc(t('prev'))}" type="button">${lang === 'ar' ? '›' : '‹'}</button><button class="btn ghost sm" data-step="1" aria-label="${esc(t('nxt'))}" type="button">${lang === 'ar' ? '‹' : '›'}</button><b style="font-size:17px">${esc(fmtDate(d))}</b><span class="sp"></span>${stpick}<span class="tabs"><button data-mode="day" aria-pressed="${!week}" type="button">${esc(t('day'))}</button><button data-mode="week" aria-pressed="${week}" type="button">${esc(t('week'))}</button></span><label class="row small" style="margin:0"><input type="checkbox" data-showc ${S.showCancelled ? 'checked' : ''}> ${esc(t('showCancelled'))}</label>${can('owner', 'manager', 'reception') ? `<button class="btn" data-new type="button">+ ${esc(t('newBooking'))}</button>` : ''}</div>
  <div class="cal"><div class="cal-in"><div class="cal-head" style="grid-template-columns:${tpl}"><div></div>${cols.map((c) => `<div>${week ? `<b>${esc(fmtDay(c.date).wd)} ${esc(fmtDay(c.date).d)}</b>` : `<span class="dot" style="background:${esc(c.st.color)}"></span><span>${esc(loc(c.st))}<br><small class="muted">${esc(loc(c.st, 'title'))}</small></span>`}</div>`).join('')}</div>
  <div class="cal-body" style="grid-template-columns:${tpl};height:${H}px"><div class="axis">${axis.join('')}</div>${cols.map((c) => `<div class="col" data-col="${esc(c.st.id)}" data-date="${c.date}">${lines.join('')}${offBlocks(c.st, c.date)}${bks.filter((x) => x.staffId === c.st.id && x.date === c.date).map(block).join('')}${c.date === S.d.today ? `<div class="nowline" style="top:${(nowMin() - gs) * PPM}px"></div>` : ''}</div>`).join('')}</div></div></div>`;
}

// ---------------------------------------------------------------- drawer and modals
function drawer() {
  const bk = S.d.bookings.find((x) => x.id === S.drawer); if (!bk) return '';
  const c = cl(bk.clientId), v = svc(bk.serviceId), s = stf(bk.staffId);
  const st = bk.status; const R = can('owner', 'manager', 'reception');
  const hist = bk.history.map((h) => `<li><b>${esc(t('h_' + h.ev))}</b>${h.ev === 'rescheduled' ? ` ${esc(t('from'))} ${esc(fmtDate(h.from.date, { day: 'numeric', month: 'short' }))} ${esc(fmtTime(h.from.start))}` : ''}${h.late ? ` (${esc(t('late'))})` : ''} <span class="muted">${esc(fmtStamp(h.t))} · ${esc(String(h.by).split(':')[0])}</span></li>`).join('');
  return `<aside class="drawer" role="dialog" aria-label="Booking"><div class="row"><h2 style="font-size:19px">${esc(cName(c))}</h2><span class="chip ${esc(st)}">${esc(t('s_' + st))}</span><span class="sp"></span><button class="btn ghost sm" data-closedrawer type="button">${esc(t('close'))}</button></div>
  <p class="muted small" style="margin:4px 0 12px">${esc(bk.code)} · ${esc(t('src_' + bk.source))}</p><dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0"><dt class="muted">${esc(t('service'))}</dt><dd style="margin:0"><b>${esc(loc(v))}</b></dd><dt class="muted">${esc(t('person'))}</dt><dd style="margin:0">${esc(loc(s))}</dd><dt class="muted">${esc(t('time'))}</dt><dd style="margin:0">${esc(fmtDate(bk.date))}<br>${esc(fmtRange(bk.start, bk.end))}</dd><dt class="muted">${esc(t('price'))}</dt><dd style="margin:0">${esc(money(bk.price))}</dd><dt class="muted">${esc(t('phone'))}</dt><dd style="margin:0" dir="ltr">${esc(c?.phone)}</dd></dl>
  ${c ? `<p class="mt">${c.tags.map((x) => `<span class="chip ${x === 'no-show risk' ? 'warn' : ''}">${esc(x === 'no-show risk' ? t('riskTag') : x)}</span>`).join(' ')} ${c.stats.noShows ? `<span class="chip warn">${esc(t('noShowsN', { n: nf(c.stats.noShows) }))}</span>` : ''}</p>${c.notes ? `<p class="small">${esc(c.notes)}</p>` : ''}` : ''}
  <label class="f mt"><span>${esc(t('notes'))}</span><textarea id="bnote" maxlength="240">${esc(bk.note)}</textarea></label><button class="btn ghost sm" data-savenote="${esc(bk.id)}" type="button">${esc(t('save'))}</button>
  <div class="row mt">${st === 'confirmed' ? `<button class="btn green" data-st="checked_in" data-id="${esc(bk.id)}" type="button">${esc(t('checkIn'))}</button><button class="btn ghost" data-st="no_show" data-id="${esc(bk.id)}" type="button">${esc(t('noShow'))}</button>` : ''}${st === 'checked_in' ? `<button class="btn green" data-st="completed" data-id="${esc(bk.id)}" type="button">${esc(t('complete'))}</button>` : ''}${st === 'no_show' && R ? `<button class="btn ghost" data-st="confirmed" data-id="${esc(bk.id)}" type="button">${esc(t('reopen'))}</button>` : ''}${st === 'confirmed' && R ? `<button class="btn ghost" data-resched="${esc(bk.id)}" type="button">${esc(t('reschedule'))}</button><button class="btn red" data-cancelbk="${esc(bk.id)}" type="button">${esc(t('cancel'))}</button>` : ''}</div>${st === 'confirmed' ? `<p class="hint">${esc(t('graceHint', { m: nf(B().settings.graceMin) }))}</p>` : ''}
  <h3 class="mt2">${esc(t('history'))}</h3><ul class="timeline mt">${hist}</ul></aside>`;
}
const modal = (title, inner, acts, wide) => `<div class="scrim" data-scrim><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${inner}${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ''}<div class="acts"><button class="btn ghost" data-closemodal type="button">${esc(t('close'))}</button>${acts}</div></div></div>`;

const NB = { svc: null, staff: 'any', date: null, slots: [], start: null, name: '', phone: '', note: '', source: 'phone', found: null, ignore: null, mode: 'new', id: null };
async function slotsFor() {
  if (!NB.svc || !NB.date) return; try { const r = await api(`slots-app/${S.biz}?service=${NB.svc}&staff=${NB.staff}&from=${NB.date}&days=1${NB.ignore ? '&ignore=' + NB.ignore : ''}`, { role: rolesHdr() }); NB.slots = r.days[NB.date] || []; } catch { NB.slots = []; }
  if (!NB.slots.includes(NB.start)) NB.start = null; render();
}
function newModal() {
  const b = B(); const mv = NB.mode === 'move';
  const staffOpts = NB.svc ? b.staff.filter((s) => s.active && svc(NB.svc).staff.includes(s.id)) : [];
  return () => modal(mv ? t('moveTitle') : t('newTitle'), `${mv ? '' : `<div class="cols2"><label class="f"><span>${esc(t('phone'))}</span><input id="nb-phone" inputmode="tel" value="${esc(NB.phone)}" placeholder="010 1234 5678"></label><label class="f"><span>${esc(t('client'))}</span><input id="nb-name" value="${esc(NB.name)}" maxlength="60"></label></div>${NB.found ? `<p class="small">${NB.found.blocked ? `<span class="chip warn">${esc(t('blockedHint'))}</span>` : `<span class="chip ok">${esc(t('existingClient'))}</span>`} ${NB.found.stats.noShows ? esc(t('noShowsN', { n: nf(NB.found.stats.noShows) })) : ''}</p>` : ''}`}
  <div class="cols2">${mv ? '' : `<label class="f"><span>${esc(t('service'))}</span><select id="nb-svc"><option value="">-</option>${b.services.filter((s) => s.active).map((s) => `<option value="${esc(s.id)}" ${NB.svc === s.id ? 'selected' : ''}>${esc(loc(s))} · ${esc(money(s.price))}</option>`).join('')}</select></label>`}<label class="f"><span>${esc(t('person'))}</span><select id="nb-staff"><option value="any">${esc(t('anyStaff'))}</option>${staffOpts.map((s) => `<option value="${esc(s.id)}" ${NB.staff === s.id ? 'selected' : ''}>${esc(loc(s))}</option>`).join('')}</select></label></div>
  <div class="cols2"><label class="f"><span>${esc(t('chooseDate'))}</span><input id="nb-date" type="date" value="${esc(NB.date)}"></label>${mv ? '' : `<label class="f"><span>${esc(t('source'))}</span><select id="nb-src"><option value="phone" ${NB.source === 'phone' ? 'selected' : ''}>${esc(t('phoneCall'))}</option><option value="walk_in" ${NB.source === 'walk_in' ? 'selected' : ''}>${esc(t('walkIn'))}</option></select></label>`}</div>
  <p><b>${esc(t('pickSlot'))}</b></p>${NB.slots.length ? `<div class="slots">${NB.slots.map((m) => `<button class="slot ${NB.start === m ? 'sel' : ''}" data-nbslot="${m}" type="button">${esc(fmtTime(m))}</button>`).join('')}</div>` : `<p class="muted">${esc(t('noSlots'))}</p>`}${mv ? '' : `<label class="f mt"><span>${esc(t('notes'))}</span><input id="nb-note" value="${esc(NB.note)}" maxlength="240"></label>`}`, `<button class="btn" data-nbsave type="button" ${NB.start == null ? 'disabled' : ''}>${esc(mv ? t('confirmMove') : t('saveBooking'))}</button>`);
}
function openNew(pre = {}) { Object.assign(NB, { svc: null, staff: 'any', date: S.date, slots: [], start: null, name: '', phone: '', note: '', source: 'phone', found: null, ignore: null, mode: 'new', id: null }, pre); S.err = ''; S.modal = newModal(); render(); if (NB.svc) slotsFor(); }

// ---------------------------------------------------------------- other views
const chip = (s) => `<span class="chip ${esc(s)}">${esc(t('s_' + s))}</span>`;
function bookingsView() {
  const q = S.q.toLowerCase(), f = S.f, today = S.d.today;
  let L = S.d.bookings.filter((x) => (f.when === 'upcoming' ? x.date >= today && x.status !== 'cancelled' : f.when === 'today' ? x.date === today : f.when === 'past' ? x.date < today : true) && (!f.status || x.status === f.status) && (!f.staff || x.staffId === f.staff));
  if (q) L = L.filter((x) => { const c = cl(x.clientId); return (c?.name + ' ' + (c?.nameAr || '') + ' ' + c?.phone + ' ' + x.code).toLowerCase().includes(q); });
  L.sort((a, b) => (a.date + hmStr(a.start) < b.date + hmStr(b.start) ? -1 : 1) * (f.when === 'past' ? -1 : 1));
  const total = L.length; L = L.slice(0, 120);
  return `<h1>${esc(t('navBookings'))}</h1><div class="filters"><label><span class="small">${esc(t('search'))}</span><input data-q value="${esc(S.q)}" placeholder="${esc(t('search'))}"></label><label><span class="small">${esc(t('date'))}</span><select data-f="when">${[['upcoming', 'upcoming'], ['today', 'todayOnly'], ['past', 'past'], ['all', 'all']].map(([v, k]) => `<option value="${v}" ${f.when === v ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select></label><label><span class="small">${esc(t('status'))}</span><select data-f="status"><option value="">${esc(t('all'))}</option>${['confirmed', 'checked_in', 'completed', 'no_show', 'cancelled'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${esc(t('s_' + s))}</option>`).join('')}</select></label>${S.role.staffId ? '' : `<label><span class="small">${esc(t('person'))}</span><select data-f="staff"><option value="">${esc(t('all'))}</option>${B().staff.map((s) => `<option value="${esc(s.id)}" ${f.staff === s.id ? 'selected' : ''}>${esc(loc(s))}</option>`).join('')}</select></label>`}</div>
  <div class="tw"><table class="t"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('client'))}</th><th>${esc(t('service'))}</th><th>${esc(t('person'))}</th><th>${esc(t('status'))}</th><th>${esc(t('source'))}</th><th>${esc(t('price'))}</th></tr></thead><tbody>${L.map((x) => `<tr data-open="${esc(x.id)}"><td>${esc(fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }))}<br><span class="muted small">${esc(fmtRange(x.start, x.end))}</span></td><td>${esc(cName(cl(x.clientId)))}<br><span class="muted small">${esc(x.code)}</span></td><td>${esc(loc(svc(x.serviceId)))}</td><td>${esc(loc(stf(x.staffId)))}</td><td>${chip(x.status)}</td><td>${esc(t('src_' + x.source))}</td><td>${esc(money(x.price))}</td></tr>`).join('')}</tbody></table></div><p class="hint">${nf(Math.min(total, 120))} / ${nf(total)}</p>`;
}
function clientsView() {
  const q = S.q.toLowerCase(); let L = S.d.clients.filter((c) => !q || (c.name + c.nameAr + c.phone).toLowerCase().includes(q)).sort((a, b) => b.stats.visits - a.stats.visits);
  return `<h1>${esc(t('navClients'))}</h1><div class="filters"><label><span class="small">${esc(t('search'))}</span><input data-q value="${esc(S.q)}"></label></div><div class="tw"><table class="t"><thead><tr><th>${esc(t('client'))}</th><th>${esc(t('phone'))}</th><th>${esc(t('visits'))}</th><th>${esc(t('noShows'))}</th><th>${esc(t('lastVisit'))}</th><th>${esc(t('nextVisit'))}</th><th>${esc(t('spent'))}</th></tr></thead><tbody>${L.map((c) => `<tr data-client="${esc(c.id)}" data-open="x"><td><b>${esc(cName(c))}</b> ${c.tags.map((x) => `<span class="chip ${x === 'no-show risk' ? 'warn' : ''}">${esc(x === 'no-show risk' ? t('riskTag') : x)}</span>`).join(' ')}</td><td dir="ltr">${esc(c.phone)}</td><td>${nf(c.stats.visits)}</td><td>${c.stats.noShows ? `<span class="chip warn">${nf(c.stats.noShows)}</span>` : '0'}</td><td>${c.stats.lastVisit ? esc(fmtDate(c.stats.lastVisit, { day: 'numeric', month: 'short' })) : esc(t('never'))}</td><td>${c.stats.next ? esc(fmtDate(c.stats.next.date, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(c.stats.next.start)) : '-'}</td><td>${esc(money(c.stats.spent))}</td></tr>`).join('')}</tbody></table></div>`;
}
function clientModal(id) {
  const c = cl(id); const mine = S.d.bookings.filter((x) => x.clientId === id).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  return () => modal(cName(c), `<p dir="ltr" class="muted">${esc(c.phone)}</p><label class="f"><span>${esc(t('notes'))}</span><textarea id="cl-notes" maxlength="400">${esc(c.notes)}</textarea></label><label class="f"><span>${esc(t('tags'))}</span><input id="cl-tags" value="${esc(c.tags.join(', '))}"></label><h3>${esc(t('clientHistory'))}</h3><div class="tw mt"><table class="t"><tbody>${mine.map((x) => `<tr><td>${esc(fmtDate(x.date, { day: 'numeric', month: 'short' }))}</td><td>${esc(loc(svc(x.serviceId)))}</td><td>${chip(x.status)}</td></tr>`).join('')}</tbody></table></div>`, can('owner', 'manager', 'reception') ? `<button class="btn" data-savecl="${esc(id)}" type="button">${esc(t('save'))}</button><button class="btn accent" data-bookcl="${esc(id)}" type="button">${esc(t('book'))}</button>` : '', true);
}
function servicesView() {
  const b = B();
  return `<div class="row"><h1>${esc(t('navServices'))}</h1><span class="sp"></span><button class="btn" data-addsvc type="button">+ ${esc(t('addService'))}</button></div><div class="tw"><table class="t"><thead><tr><th>${esc(t('service'))}</th><th>${esc(t('dur'))}</th><th>${esc(t('price'))}</th><th>${esc(t('staffFor'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>${b.services.map((s) => `<tr><td><b>${esc(loc(s))}</b><br><span class="muted small">${esc(loc(s, 'desc'))}</span></td><td>${nf(s.dur)} ${esc(t('min'))}${s.buffer ? `<br><span class="muted small">+${nf(s.buffer)}</span>` : ''}</td><td>${esc(money(s.price))}</td><td>${s.staff.map((id) => `<span class="chip">${esc(loc(stf(id)))}</span>`).join(' ')}</td><td><span class="chip ${s.active ? 'ok' : ''}">${esc(s.active ? t('active') : t('inactive'))}</span></td><td><button class="btn ghost sm" data-editsvc="${esc(s.id)}" type="button">${esc(t('edit'))}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function svcModal(id) {
  const s = id ? svc(id) : { id: '', name: { en: '', ar: '' }, cat: Object.keys(B().cats)[0], dur: 30, buffer: 0, price: 0, staff: [], active: true };
  return () => modal(id ? loc(s) : t('addService'), `<div class="cols2"><label class="f"><span>${esc(t('nameEn'))}</span><input id="sv-en" value="${esc(s.name.en)}" maxlength="60"></label><label class="f"><span>${esc(t('nameAr'))}</span><input id="sv-ar" value="${esc(s.name.ar)}" maxlength="60" dir="rtl"></label></div><div class="cols3"><label class="f"><span>${esc(t('durMin'))}</span><input id="sv-dur" type="number" step="5" value="${s.dur}"></label><label class="f"><span>${esc(t('buffer'))}</span><input id="sv-buf" type="number" step="5" value="${s.buffer}"></label><label class="f"><span>${esc(t('priceEgp'))}</span><input id="sv-price" type="number" value="${s.price}"></label></div>${id ? '' : `<label class="f"><span>${esc(t('category'))}</span><select id="sv-cat">${Object.keys(B().cats).map((c) => `<option value="${c}">${esc(B().cats[c][lang === 'ar' ? 1 : 0])}</option>`).join('')}</select></label>`}<p><b>${esc(t('staffFor'))}</b></p><div class="pick" id="sv-staff">${B().staff.filter((x) => x.active).map((x) => `<button type="button" data-svstaff="${esc(x.id)}" class="${s.staff.includes(x.id) ? 'sel' : ''}">${esc(loc(x))}</button>`).join('')}</div>${id ? `<label class="f mt"><span><input id="sv-active" type="checkbox" ${s.active ? 'checked' : ''}> ${esc(t('active'))}</span></label>` : ''}`, `<button class="btn" data-savesvc="${esc(id || '')}" type="button">${esc(t('save'))}</button>`);
}
function teamView() {
  const b = B(); const L = b.staff.filter((s) => !S.role.staffId || s.id === S.role.staffId);
  const today = S.d.today; const R = can('owner', 'manager');
  return `<h1>${esc(t('navTeam'))}</h1><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${L.map((s) => `<section class="card"><div class="row"><span class="av" style="background:${esc(s.color)};width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800">${esc(initials(loc(s)))}</span><div><h3>${esc(loc(s))}</h3><span class="muted small">${esc(loc(s, 'title'))}</span></div></div>
  <h3 class="mt">${esc(t('weekly'))}</h3><div class="mt" data-sched="${esc(s.id)}">${[6, 0, 1, 2, 3, 4, 5].map((d) => { const h = s.hours[d]; return `<div class="sched"><span>${esc(t('days')[d])}</span><input type="time" data-h="${d}-0" value="${h ? hmStr(h[0]) : ''}" ${R ? '' : 'disabled'}><input type="time" data-h="${d}-1" value="${h ? hmStr(h[1]) : ''}" ${R ? '' : 'disabled'}><span class="muted small">${h ? '' : esc(t('dayOff'))}</span></div>`; }).join('')}<div class="sched"><span>${esc(t('breakLabel'))}</span><input type="time" data-b="0" value="${s.breaks[0] ? hmStr(s.breaks[0][0]) : ''}" ${R ? '' : 'disabled'}><input type="time" data-b="1" value="${s.breaks[0] ? hmStr(s.breaks[0][1]) : ''}" ${R ? '' : 'disabled'}><span></span></div></div>${R ? `<button class="btn ghost sm" data-savesched="${esc(s.id)}" type="button">${esc(t('saveSchedule'))}</button>` : ''}
  <h3 class="mt">${esc(t('timeOff'))}</h3>${(s.off || []).length ? (s.off || []).map((o) => `<div class="row small" style="margin:4px 0"><span class="chip">${esc(fmtDate(o.from, { day: 'numeric', month: 'short' }))} - ${esc(fmtDate(o.to, { day: 'numeric', month: 'short' }))}</span><span>${esc(o.reason)}</span><span class="sp"></span>${R || S.role.staffId === s.id ? `<button class="btn ghost sm" data-rmoff="${esc(o.id)}" type="button">${esc(t('remove'))}</button>` : ''}</div>`).join('') : `<p class="muted small">${esc(t('noTimeOff'))}</p>`}
  ${R || S.role.staffId === s.id ? `<div class="cols3 mt" data-off="${esc(s.id)}"><label class="f"><span>${esc(t('fromDate'))}</span><input type="date" data-of="from" min="${today}"></label><label class="f"><span>${esc(t('toDate'))}</span><input type="date" data-of="to" min="${today}"></label><label class="f"><span>${esc(t('reason'))}</span><input data-of="reason" maxlength="60"></label></div><button class="btn sm" data-addoff="${esc(s.id)}" type="button">${esc(t('addTimeOff'))}</button>` : ''}
  ${S.conflicts && S.conflictFor === s.id ? `<div class="banner bad mt"><b>${esc(t('conflictsTitle'))}</b><br>${S.conflicts.map((id) => { const x = S.d.bookings.find((y) => y.id === id); return x ? `<a href="#" data-open="${esc(id)}">${esc(fmtDate(x.date, { day: 'numeric', month: 'short' }))} ${esc(fmtTime(x.start))} · ${esc(cName(cl(x.clientId)))}</a>` : ''; }).join('<br>')}</div>` : ''}</section>`).join('')}</div>`;
}
function remindersView() {
  const L = S.d.reminders.filter((r) => r.status !== 'sent' || r.at > S.d.now - 86400000).slice(0, 80);
  const due = S.d.reminders.filter((r) => r.status === 'due').length;
  return `<div class="row"><h1>${esc(t('remTitle'))}</h1><span class="sp"></span><button class="btn" data-rundue type="button" ${due ? '' : 'disabled'}>${esc(t('runDue'))} (${nf(due)})</button></div><p class="banner" style="margin-bottom:12px">${esc(t('remNote'))}</p><div class="tw"><table class="t"><thead><tr><th>${esc(t('dueAt'))}</th><th>${esc(t('client'))}</th><th>${esc(t('service'))}</th><th></th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>${L.map((r) => { const bk = S.d.bookings.find((x) => x.id === r.bookingId); if (!bk) return ''; return `<tr><td>${esc(fmtStamp(r.dueAt))}</td><td>${esc(cName(cl(bk.clientId)))}</td><td>${esc(loc(svc(bk.serviceId)))}<br><span class="muted small">${esc(fmtDate(bk.date, { day: 'numeric', month: 'short' }))} ${esc(fmtTime(bk.start))}</span></td><td>${esc(t('r_' + r.kind))}</td><td><span class="chip ${esc(r.status)}">${esc(t('r_' + r.status))}</span></td><td>${r.status === 'due' ? `<button class="btn sm" data-remmark="${esc(r.key)}" data-s="sent" type="button">${esc(t('markSent'))}</button> <button class="btn ghost sm" data-remmark="${esc(r.key)}" data-s="skipped" type="button">${esc(t('skip'))}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function reportsView() {
  const r = S.d.report; const mx = Math.max(1, ...r.daily.map((x) => x.revenue)); const mw = Math.max(1, ...r.byDow);
  return `<h1>${esc(t('navReports'))} <span class="muted small">${esc(t('rep30'))}</span></h1><div class="kpis"><div class="kpi"><span>${esc(t('revenue'))}</span><b>${esc(money(r.revenue))}</b><small>${esc(t('revenueD'))}</small></div><div class="kpi"><span>${esc(t('completedN'))}</span><b>${nf(r.completed)}</b></div><div class="kpi"><span>${esc(t('noShowRate'))}</span><b>${nf(r.noShowRate, 1)}%</b><small>${esc(t('lostRev', { v: money(r.lostToNoShow) }))}</small></div><div class="kpi"><span>${esc(t('cancelledN'))}</span><b>${nf(r.cancelled)}</b><small>${esc(t('lateN', { n: nf(r.lateCancels) }))}</small></div><div class="kpi"><span>${esc(t('upcomingValue'))}</span><b>${esc(money(r.upcomingValue))}</b><small>${esc(t('upcomingN', { n: nf(r.upcomingCount) }))}</small></div><div class="kpi"><span>${esc(t('onlineShare'))}</span><b>${nf(r.onlineShare)}%</b></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><section class="card"><h2>${esc(t('dailyRev'))}</h2><div class="bars" role="img" aria-label="${esc(t('dailyRev'))}">${r.daily.map((x) => `<i title="${esc(x.date)}: ${esc(money(x.revenue))}" style="height:${Math.max(2, (x.revenue / mx) * 100)}%"></i>`).join('')}</div></section>
  <section class="card"><h2>${esc(t('utilization'))}</h2>${r.perStaff.map((p) => `<div style="margin-bottom:10px"><div class="row small"><b>${esc(loc(stf(p.staffId)))}</b><span class="sp"></span>${nf(p.utilization)}% · ${esc(money(p.revenue))}${p.noShows ? ` · ${esc(t('noShowsN', { n: nf(p.noShows) }))}` : ''}</div><div class="bar"><i style="width:${p.utilization}%;background:${esc(stf(p.staffId)?.color)}"></i></div></div>`).join('')}</section>
  <section class="card"><h2>${esc(t('topServices'))}</h2>${r.bySvc.slice(0, 6).map((x) => `<div class="row small" style="margin-bottom:6px"><span>${esc(loc(svc(x.serviceId)))}</span><span class="sp"></span><b>${esc(money(x.revenue))}</b><span class="muted">${nf(x.count)}×</span></div>`).join('')}</section>
  <section class="card"><h2>${esc(t('byWeekday'))}</h2>${[6, 0, 1, 2, 3, 4, 5].map((d) => `<div class="row small" style="margin-bottom:5px"><span style="width:80px">${esc(t('days')[d])}</span><div class="bar" style="flex:1"><i style="width:${(r.byDow[d] / mw) * 100}%"></i></div><b>${nf(r.byDow[d])}</b></div>`).join('')}</section></div>`;
}
function settingsView() {
  const b = B(), s = b.settings; const O = can('owner');
  const num = (k, l) => `<label class="f"><span>${esc(t(l))}</span><input type="number" data-set="${k}" value="${s[k]}" ${O ? '' : 'disabled'}></label>`;
  return `<h1>${esc(t('navSettings'))}</h1><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))"><section class="card"><h2>${esc(t('rules'))}</h2><label class="f"><span>${esc(t('stepL'))}</span><select data-set="step" ${O ? '' : 'disabled'}>${[5, 10, 15, 20, 30, 60].map((v) => `<option ${s.step === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${num('minNotice', 'minNoticeL')}${num('windowDays', 'windowL')}${num('cancelHours', 'cancelL')}${num('noShowLimit', 'noShowL')}${num('graceMin', 'graceL')}${O ? `<button class="btn" data-saveset type="button">${esc(t('save'))}</button>` : ''}</section>
  <section class="card"><h2>${esc(t('setHours'))}</h2>${[6, 0, 1, 2, 3, 4, 5].map((d) => { const h = b.hours[d]; return `<div class="sched"><span>${esc(t('days')[d])}</span><input type="time" data-bh="${d}-0" value="${h ? hmStr(h[0]) : ''}" ${O ? '' : 'disabled'}><input type="time" data-bh="${d}-1" value="${h ? hmStr(h[1]) : ''}" ${O ? '' : 'disabled'}><span></span></div>`; }).join('')}${O ? `<button class="btn" data-savehours type="button">${esc(t('save'))}</button>` : ''}
  <h3 class="mt2">${esc(t('closedDays'))}</h3>${(b.closed || []).map((d) => `<div class="row small" style="margin:4px 0"><span class="chip">${esc(fmtDate(d))}</span>${O ? `<button class="btn ghost sm" data-opendate="${d}" type="button">${esc(t('reopenDate'))}</button>` : ''}</div>`).join('')}${O ? `<div class="row mt"><input type="date" id="closedate" style="width:auto" min="${S.d.today}"><button class="btn ghost sm" data-closedate type="button">${esc(t('addClosed'))}</button></div>` : ''}</section>
  <section class="card"><h2>${esc(t('limitsApp'))}</h2><ul><li>${esc(t('la1'))}</li><li>${esc(t('la2'))}</li><li>${esc(t('la3'))}</li><li>${esc(t('la4'))}</li></ul>${O ? `<h3 class="mt">${esc(t('resetTitle'))}</h3><p class="hint">${esc(t('resetD'))}</p><button class="btn red" data-reset type="button">${esc(t('resetTitle'))}</button>` : ''}</section></div>`;
}
const VIEWS = { cal: calView, bookings: bookingsView, clients: clientsView, services: servicesView, team: teamView, reminders: remindersView, reports: reportsView, settings: settingsView };

// ---------------------------------------------------------------- events
const val = (sel) => $(sel)?.value;
document.addEventListener('input', async (e) => {
  const el = e.target;
  if (el.matches('[data-q]')) { S.q = el.value; const p = el.selectionStart; render(); const n = $('[data-q]'); n.focus(); n.setSelectionRange(p, p); }
  if (el.id === 'nb-phone') { NB.phone = el.value; const digits = el.value.replace(/\D/g, ''); const f = S.d.clients.find((c) => digits.length >= 10 && c.phone === digits.replace(/^20/, '0')); if (f && NB.found?.id !== f.id) { NB.found = f; NB.name = f.name; S.modal = newModal(); render(); } }
  if (el.id === 'nb-name') NB.name = el.value; if (el.id === 'nb-note') NB.note = el.value;
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-f]')) { S.f[el.dataset.f] = el.value; render(); }
  if (el.matches('[data-weekstaff]')) { S.weekStaff = el.value; render(); }
  if (el.matches('[data-showc]')) { S.showCancelled = el.checked; render(); }
  if (el.id === 'nb-svc') { NB.svc = el.value; NB.staff = 'any'; NB.start = null; S.modal = newModal(); render(); slotsFor(); }
  if (el.id === 'nb-staff') { NB.staff = el.value; slotsFor(); }
  if (el.id === 'nb-date') { NB.date = el.value; slotsFor(); }
  if (el.id === 'nb-src') NB.source = el.value;
});
document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-lang],[data-switch],[data-biz],[data-role],[data-staffpick],[data-view],[data-today],[data-step],[data-mode],[data-new],[data-bk],[data-open],[data-closedrawer],[data-closemodal],[data-scrim],[data-st],[data-savenote],[data-resched],[data-cancelbk],[data-nbslot],[data-nbsave],[data-client],[data-savecl],[data-bookcl],[data-addsvc],[data-editsvc],[data-svstaff],[data-savesvc],[data-savesched],[data-addoff],[data-rmoff],[data-rundue],[data-remmark],[data-saveset],[data-savehours],[data-closedate],[data-opendate],[data-reset],[data-col]');
  if (!c) return; const D = c.dataset;
  const guard = async (fn) => { try { await fn(); } catch {} };
  if (D.scrim !== undefined && e.target !== c) return;
  if (D.lang !== undefined) { toggleLang(); return render(); }
  if (D.switch !== undefined) { setRole(null); S.role = null; S.d = null; S.pickStaff = null; return render(); }
  if (D.biz) { S.biz = D.biz; S.pickStaff = null; return render(); }
  if (D.role) { if (D.role === 'staff') { const p = await api('public/' + S.biz); S.pickStaff = p.staff; return render(); } S.role = { role: D.role }; setRole(S.role); S.d = null; return load(); }
  if (D.staffpick) { S.role = { role: 'staff', staffId: D.staffpick }; setRole(S.role); S.view = 'cal'; S.d = null; S.pickStaff = null; return load(); }
  if (D.view) { e.preventDefault(); S.view = D.view; S.q = ''; S.drawer = null; S._scrolled = false; return render(); }
  if (D.today !== undefined) { S.date = S.d.today; return render(); }
  if (D.step) { S.date = addDays(S.date, Number(D.step) * (S.mode === 'week' ? 7 : 1)); return render(); }
  if (D.mode) { S.mode = D.mode; return render(); }
  if (D.new !== undefined) return openNew();
  if (D.col && !e.target.closest('.blk')) { if (!can('owner', 'manager', 'reception')) return; const r = c.getBoundingClientRect(); const y = e.clientY - r.top; const m = Math.floor((calStart() + y / PPM) / 15) * 15; return openNew({ staff: D.col, date: c.dataset.date, hint: m }); }
  if (D.bk) { S.drawer = D.bk; return render(); }
  if (D.open && D.open !== 'x') { e.preventDefault(); S.drawer = D.open; return render(); }
  if (D.client) { S.modal = clientModal(D.client); return render(); }
  if (D.closedrawer !== undefined) { S.drawer = null; return render(); }
  if (D.closemodal !== undefined || D.scrim !== undefined) { S.modal = null; S.err = ''; return render(); }
  if (D.st) return guard(() => op({ type: 'booking.status', id: D.id, status: D.st }, { ok: t('saved'), queueable: D.st === 'checked_in' || D.st === 'completed' }));
  if (D.savenote) return guard(() => op({ type: 'booking.note', id: D.savenote, note: val('#bnote') }, { ok: t('saved'), queueable: true }));
  if (D.cancelbk) { const reason = prompt(t('cancelReason') + ' (' + t('cancelAsk') + ')', ''); if (reason === null) return; S.drawer = null; return guard(() => op({ type: 'booking.cancel', id: D.cancelbk, reason }, { ok: t('saved') })); }
  if (D.resched) { const bk = S.d.bookings.find((x) => x.id === D.resched); Object.assign(NB, { svc: bk.serviceId, staff: 'any', date: bk.date, slots: [], start: null, ignore: bk.id, mode: 'move', id: bk.id }); S.modal = newModal(); S.err = ''; render(); return slotsFor(); }
  if (D.nbslot) { NB.start = Number(D.nbslot); S.modal = newModal(); return render(); }
  if (D.nbsave !== undefined) {
    if (NB.mode === 'move') return guard(() => op({ type: 'booking.reschedule', id: NB.id, date: NB.date, start: NB.start, staffId: NB.staff }, { ok: t('saved') }).then(() => { S.drawer = null; }));
    return guard(async () => { const r = await op({ type: 'booking.create', serviceId: NB.svc, staffId: NB.staff, date: NB.date, start: NB.start, client: { name: NB.name, phone: NB.phone }, note: NB.note, source: NB.source }, { ok: t('saved') }); if (r) { S.date = NB.date; S.view = 'cal'; render(); } });
  }
  if (D.savecl) return guard(() => op({ type: 'client.save', id: D.savecl, notes: val('#cl-notes'), tags: val('#cl-tags') }, { ok: t('saved') }));
  if (D.bookcl) { const k = cl(D.bookcl); return openNew({ name: k.name, phone: k.phone, found: k }); }
  if (D.addsvc !== undefined) { SV.staff = []; S.modal = svcModal(null); S.err = ''; return render(); }
  if (D.editsvc) { SV.staff = [...svc(D.editsvc).staff]; S.modal = svcModal(D.editsvc); S.err = ''; return render(); }
  if (D.svstaff) { SV.staff = SV.staff.includes(D.svstaff) ? SV.staff.filter((x) => x !== D.svstaff) : [...SV.staff, D.svstaff]; c.classList.toggle('sel'); return; }
  if (D.savesvc !== undefined) { const o = { type: 'service.save', name: { en: val('#sv-en'), ar: val('#sv-ar') }, dur: val('#sv-dur'), buffer: val('#sv-buf'), price: val('#sv-price'), staff: SV.staff }; if (D.savesvc) { o.id = D.savesvc; o.active = $('#sv-active').checked; } else o.cat = val('#sv-cat'); return guard(() => op(o, { ok: t('saved') })); }
  if (D.savesched) { const root = $(`[data-sched="${D.savesched}"]`); const hours = Array.from({ length: 7 }, (_, d) => { const a = parseHm($(`[data-h="${d}-0"]`, root).value), b2 = parseHm($(`[data-h="${d}-1"]`, root).value); return a != null && b2 != null && a < b2 ? [a, b2] : null; }); const b0 = parseHm($('[data-b="0"]', root).value), b1 = parseHm($('[data-b="1"]', root).value); S.conflictFor = D.savesched; S.conflicts = null; return guard(() => op({ type: 'staff.save', id: D.savesched, hours, breaks: b0 != null && b1 != null ? [[b0, b1]] : [] }, { ok: t('saved') })); }
  if (D.addoff) { const root = $(`[data-off="${D.addoff}"]`); S.conflictFor = D.addoff; S.conflicts = null; return guard(() => op({ type: 'timeoff.add', staffId: D.addoff, from: $('[data-of=from]', root).value, to: $('[data-of=to]', root).value || $('[data-of=from]', root).value, reason: $('[data-of=reason]', root).value }, { ok: t('saved') })); }
  if (D.rmoff) return guard(() => op({ type: 'timeoff.remove', id: D.rmoff }, { ok: t('saved') }));
  if (D.rundue !== undefined) return guard(() => op({ type: 'reminder.runDue' }, { ok: t('saved') }));
  if (D.remmark) return guard(() => op({ type: 'reminder.mark', key: D.remmark, status: D.s }, { ok: t('saved') }));
  if (D.saveset !== undefined) { const o = { type: 'settings.save' }; $$('[data-set]').forEach((i) => { o[i.dataset.set] = i.value; }); return guard(() => op(o, { ok: t('saved') })); }
  if (D.savehours !== undefined) { const hours = Array.from({ length: 7 }, (_, d) => { const a = parseHm($(`[data-bh="${d}-0"]`).value), b2 = parseHm($(`[data-bh="${d}-1"]`).value); return a != null && b2 != null && a < b2 ? [a, b2] : null; }); return guard(() => op({ type: 'settings.save', hours }, { ok: t('saved') })); }
  if (D.closedate !== undefined) return guard(() => op({ type: 'settings.save', closeDate: val('#closedate') }, { ok: t('saved') }));
  if (D.opendate) return guard(() => op({ type: 'settings.save', openDate: D.opendate }, { ok: t('saved') }));
  if (D.reset !== undefined) { if (confirm(t('resetAsk'))) return guard(() => op({ type: 'reset' }, { ok: t('saved') })); }
});
const SV = { staff: [] };
// new-booking click on an empty calendar cell sets a start hint; apply it once slots load
const origSlots = slotsFor;
window.addEventListener('hashchange', () => { const v = location.hash.replace('#/', ''); if (VIEWS[v]) { S.view = v; render(); } });
(async function init() {
  const r = qp.get('role'); const saved = getRole();
  if (r) S.role = { role: r, staffId: qp.get('staff') || undefined }; else if (saved) S.role = saved;
  if (qp.get('view')) S.view = qp.get('view');
  if (qp.get('mode')) S.mode = qp.get('mode');
  if (qp.get('date')) S.date = qp.get('date');
  S.queue = JSON.parse(localStorage.getItem('mawid_q') || '[]');
  if (S.role) { setRole(S.role); await load(); } else render();
  registerSW();
})();
