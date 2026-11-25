import { $, $$, api, ApiErr, esc, t, loc, toggleLang, topbar, registerSW, money, nf, fmtTime, fmtDate, fmtDay, addDays, errText, icsFor, initials, lang } from './common.js';
const biz = new URLSearchParams(location.search).get('b') || 'layali';
const S = { data: null, step: 1, svc: null, staff: 'any', date: null, start: null, days: {}, name: '', phone: '', note: '', err: '', busy: false, done: null, offline: false, loadingDays: false };
const CK = 'mawid_pub_' + biz;
async function load() {
  try { S.data = await api('public/' + biz); localStorage.setItem(CK, JSON.stringify(S.data)); S.offline = false; }
  catch (e) { const c = localStorage.getItem(CK); if (c) { S.data = JSON.parse(c); S.offline = true; } else S.err = errText(e.code); }
  render();
}
const svcStaff = () => S.data.staff.filter((s) => S.svc.staff.includes(s.id));
async function loadDays() {
  S.loadingDays = true; S.days = {}; render();
  try { S.days = (await api(`slots/${biz}?service=${S.svc.id}&staff=${S.staff}&from=${S.data.today}&days=14`)).days; } catch (e) { S.err = errText(e.code); }
  S.loadingDays = false;
  if (!S.date || !(S.days[S.date] || []).length) S.date = Object.keys(S.days).find((d) => S.days[d].length) || S.data.today;
  S.start = null; render();
}
function colorOf(id) { return S.data.staff.find((s) => s.id === id)?.color || S.data.color; }
function summary() {
  if (!S.svc) return '';
  const st = S.staff === 'any' ? t('anyone') : loc(S.data.staff.find((s) => s.id === S.staff));
  return `<aside class="card sum" aria-label="${esc(t('summary'))}"><h2>${esc(t('summary'))}</h2><dl><dt>${esc(t('sService'))}</dt><dd>${esc(loc(S.svc))}</dd><dt>${esc(t('sPerson'))}</dt><dd>${esc(S.step >= 2 ? st : '-')}</dd><dt>${esc(t('sWhen'))}</dt><dd>${S.start != null ? esc(fmtDate(S.date, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmtTime(S.start)) : '-'}</dd><dt>${esc(t('sWhere'))}</dt><dd>${esc(loc(S.data, 'address'))}</dd></dl><div class="tot"><span>${esc(t('total'))}</span><span>${esc(money(S.svc.price))}</span></div><p class="hint">${esc(t('payAt'))}</p><p class="hint">${esc(t('policy', { h: nf(S.data.policy.cancelHours) }))}</p></aside>`;
}
function stepsBar() { return `<div class="steps">${[1, 2, 3, 4].map((i) => `<span class="step ${S.step === i ? 'on' : ''}">${i}. ${esc(t('st' + i))}</span>`).join('')}</div>`; }
function body() {
  const d = S.data;
  if (S.done) return doneView();
  if (S.step === 1) {
    const cats = Object.keys(d.cats);
    return `<h2>${esc(t('chooseService'))}</h2>` + cats.map((c) => { const L = d.services.filter((s) => s.cat === c); return L.length ? `<div class="cat-h">${esc(d.cats[c][lang === 'ar' ? 1 : 0])}</div>` + L.map((s) => `<button class="opt ${S.svc?.id === s.id ? 'sel' : ''}" data-svc="${esc(s.id)}" type="button"><span style="flex:1"><span class="t">${esc(loc(s))}</span><br><span class="d">${esc(loc(s, 'desc'))} · ${nf(s.dur)} ${esc(t('min'))}</span></span><span class="pr">${esc(money(s.price))}</span></button>`).join('') : ''; }).join('');
  }
  if (S.step === 2) return `<h2>${esc(t('choosePerson'))}</h2><button class="opt ${S.staff === 'any' ? 'sel' : ''}" data-staff="any" type="button"><span class="av" style="background:${esc(d.color)}">★</span><span style="flex:1"><span class="t">${esc(t('anyone'))}</span><br><span class="d">${esc(t('anyoneD'))}</span></span></button>` + svcStaff().map((s) => `<button class="opt ${S.staff === s.id ? 'sel' : ''}" data-staff="${esc(s.id)}" type="button"><span class="av" style="background:${esc(s.color)}">${esc(initials(loc(s)))}</span><span style="flex:1"><span class="t">${esc(loc(s))}</span><br><span class="d">${esc(loc(s, 'title'))}</span></span></button>`).join('') + `<div class="row mt"><button class="btn ghost" data-back type="button">${esc(t('back'))}</button><button class="btn" data-next type="button">${esc(t('next'))}</button></div>`;
  if (S.step === 3) {
    const dates = Object.keys(S.days); const slots = S.days[S.date] || [];
    return `<h2>${esc(t('chooseTime'))}</h2>${S.loadingDays ? `<p class="muted">${esc(t('loading'))}</p>` : `<div class="days" role="listbox">${dates.map((x) => { const f = fmtDay(x); const n = (S.days[x] || []).length; return `<button class="day ${S.date === x ? 'sel' : ''}" data-day="${x}" ${n ? '' : 'disabled'} type="button"><small>${esc(f.wd)}</small><b>${esc(f.d)}</b><small>${esc(f.m)}</small></button>`; }).join('')}</div>
    ${dates.every((x) => !S.days[x].length) ? `<p class="banner">${esc(t('noDaysAny'))}</p>` : `<h3 class="mt">${esc(t('times'))} · ${esc(fmtDate(S.date))}</h3>${slots.length ? `<div class="slots mt">${slots.map((m) => `<button class="slot ${S.start === m ? 'sel' : ''}" data-slot="${m}" type="button">${esc(fmtTime(m))}</button>`).join('')}</div>` : `<p class="muted">${esc(t('noTimes'))}</p>`}`}`}<div class="row mt"><button class="btn ghost" data-back type="button">${esc(t('back'))}</button><button class="btn" data-next type="button" ${S.start == null ? 'disabled' : ''}>${esc(t('next'))}</button></div>`;
  }
  return `<h2>${esc(t('st4'))}</h2><form id="f" novalidate><label class="f"><span>${esc(t('yourName'))}</span><input name="name" autocomplete="name" value="${esc(S.name)}" maxlength="60" required></label><label class="f"><span>${esc(t('yourPhone'))}</span><input name="phone" inputmode="tel" autocomplete="tel" value="${esc(S.phone)}" placeholder="010 1234 5678" required><span class="hint">${esc(t('phoneHint'))}</span></label><label class="f"><span>${esc(t('note'))}</span><textarea name="note" maxlength="240">${esc(S.note)}</textarea></label>${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ''}<div class="row"><button class="btn ghost" data-back type="button">${esc(t('back'))}</button><button class="btn" style="flex:1" type="submit" ${S.busy ? 'disabled' : ''}>${esc(t('confirmBook'))}</button></div></form>`;
}
function doneView() {
  const b = S.done;
  return `<div style="text-align:center"><div class="ok-mark" aria-hidden="true">✓</div><h2>${esc(t('booked'))}</h2><p class="muted">${esc(t('bookedD'))}</p><p><span class="small muted">${esc(t('yourCode'))}</span><br><span class="codebox" data-testid="code">${esc(b.code)}</span></p><p><b>${esc(loc(b.service))}</b> · ${esc(loc(b.staff))}<br>${esc(fmtDate(b.date))}, ${esc(fmtTime(b.start))}<br>${esc(loc(b.bizName))}</p><div class="row" style="justify-content:center"><button class="btn ghost" data-ics type="button">${esc(t('addCal'))}</button><a class="btn" href="/manage?code=${esc(b.code)}">${esc(t('manageIt'))}</a><a class="btn ghost" href="/book?b=${esc(biz)}">${esc(t('bookAnother'))}</a></div><p class="hint mt">${esc(t('reminderNote'))}</p></div>`;
}
function render() {
  const d = S.data;
  const bar = topbar();
  if (!d) { $('#root').innerHTML = bar + `<main class="wrap mt"><p class="banner bad">${esc(S.err || t('loading'))}</p></main>`; return; }
  document.body.style.setProperty('--b', d.color); document.title = loc(d) + ' | Mawid';
  $('#root').innerHTML = bar + `<div class="bk-head"><div class="wrap"><h1>${esc(loc(d))}</h1><p>${esc(loc(d, 'tagline'))} · ${esc(loc(d, 'address'))}</p></div></div><main class="wrap bk-main">${S.done ? '' : stepsBar()}${S.offline ? `<p class="banner" style="margin-bottom:12px">${esc(t('offlineBook'))}</p>` : ''}<div class="${S.done ? '' : 'bk-grid'}"><section class="card">${body()}</section>${S.done ? '' : summary()}</div><p class="hint" style="text-align:center;margin-top:18px">${esc(t('demo'))}</p></main>`;
}
document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-svc],[data-staff],[data-day],[data-slot],[data-back],[data-next],[data-lang],[data-ics]'); if (!c) return;
  if (c.dataset.lang !== undefined) { toggleLang(); return render(); }
  if (c.dataset.svc) { S.svc = S.data.services.find((s) => s.id === c.dataset.svc); S.staff = 'any'; S.step = 2; S.date = null; S.start = null; S.err = ''; return render(); }
  if (c.dataset.staff) { S.staff = c.dataset.staff; return render(); }
  if (c.dataset.day) { S.date = c.dataset.day; S.start = null; return render(); }
  if (c.dataset.slot) { S.start = Number(c.dataset.slot); return render(); }
  if (c.dataset.back !== undefined) { S.step = Math.max(1, S.step - 1); S.err = ''; return render(); }
  if (c.dataset.next !== undefined) { if (S.step === 2) { S.step = 3; return loadDays(); } S.step = 4; return render(); }
  if (c.dataset.ics !== undefined) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([icsFor(S.done)], { type: 'text/calendar' })); a.download = 'mawid-booking.ics'; a.click(); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'f') return; e.preventDefault();
  const f = new FormData(e.target); S.name = f.get('name'); S.phone = f.get('phone'); S.note = f.get('note'); S.err = ''; S.busy = true; render();
  try { const r = await api('book/' + biz, { method: 'POST', body: { serviceId: S.svc.id, staffId: S.staff, date: S.date, start: S.start, client: { name: S.name, phone: S.phone }, note: S.note } }); S.done = r.booking; }
  catch (er) { S.err = errText(er.code); if (er.code === 'slot_unavailable') { S.step = 3; S.busy = false; await loadDays(); S.err = errText(er.code); } }
  S.busy = false; render();
});
load(); registerSW();
