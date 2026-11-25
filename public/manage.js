import { $, api, esc, t, loc, toggleLang, topbar, registerSW, money, nf, fmtTime, fmtDate, fmtDay, errText } from './common.js';
const qp = new URLSearchParams(location.search);
const S = { code: qp.get('code') || '', phone: '', b: null, err: '', msg: '', move: false, days: {}, date: null, start: null, offline: false };
const CK = 'mawid_last_booking';
const lookup = async () => {
  S.err = ''; S.msg = '';
  try { S.b = (await api('manage', { method: 'POST', body: { action: 'get', code: S.code, phone: S.phone } })).booking; S.offline = false; localStorage.setItem(CK, JSON.stringify({ b: S.b, phone: S.phone })); }
  catch (e) { if (e.code === 'network') { const c = JSON.parse(localStorage.getItem(CK) || 'null'); if (c && c.b.code === S.code.toUpperCase()) { S.b = c.b; S.offline = true; } else S.err = errText('network'); } else S.err = errText(e.code); }
  render();
};
const loadDays = async () => {
  const b = S.b; const pub = await api('public/' + b.biz);
  const svc = pub.services.find((s) => s.id === b.service.id);
  S.days = (await api(`slots/${b.biz}?service=${svc.id}&staff=any&from=${pub.today}&days=14`)).days;
  S.date = Object.keys(S.days).find((d) => S.days[d].length) || null; S.start = null; render();
};
function render() {
  const b = S.b;
  let main;
  if (!b) main = `<form id="f" novalidate><label class="f"><span>${esc(t('code'))}</span><input name="code" value="${esc(S.code)}" placeholder="MWD-XXXXXX" autocapitalize="characters" required></label><label class="f"><span>${esc(t('yourPhone'))}</span><input name="phone" inputmode="tel" value="${esc(S.phone)}" required></label>${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ''}<button class="btn lg" type="submit">${esc(t('find'))}</button></form>`;
  else {
    const active = b.status === 'confirmed';
    main = `${S.offline ? `<p class="banner">${esc(t('offlineSaved'))}</p>` : ''}${S.msg ? `<p class="banner ok" role="status">${esc(S.msg)}</p>` : ''}<div class="row"><span class="codebox">${esc(b.code)}</span><span class="chip ${esc(b.status)}">${esc(t('s_' + b.status))}</span></div><p><b>${esc(loc(b.service))}</b> · ${esc(loc(b.staff))}<br>${esc(fmtDate(b.date))}, ${esc(fmtTime(b.start))} - ${esc(fmtTime(b.end))}<br>${esc(loc(b.bizName))} · ${esc(loc(b, 'address'))}<br><b>${esc(money(b.price))}</b></p>
    ${active && !S.offline ? (S.move ? moveView() : `<p class="hint">${esc(b.freeCancel ? t('cancelFree') : t('cancelLate', { h: nf(b.cancelHours) }))}</p><div class="row">${b.canReschedule ? `<button class="btn" data-move type="button">${esc(t('moveBooking'))}</button>` : ''}<button class="btn red" data-cancel type="button">${esc(t('cancelBooking'))}</button></div>${b.canReschedule ? '' : `<p class="hint">${esc(t('moveLocked', { h: nf(b.cancelHours) }))}</p>`}`) : ''}${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ''}`;
  }
  $('#root').innerHTML = topbar() + `<main class="wrap mt2" style="max-width:640px"><section class="card"><h1 style="font-size:23px">${esc(t('manageTitle'))}</h1>${b ? '' : `<p class="muted">${esc(t('manageSub'))}</p>`}${main}</section></main>`;
}
function moveView() {
  const dates = Object.keys(S.days);
  return `<h3 class="mt">${esc(t('newTime'))}</h3><div class="days">${dates.map((x) => { const f = fmtDay(x); return `<button class="day ${S.date === x ? 'sel' : ''}" data-day="${x}" ${S.days[x].length ? '' : 'disabled'} type="button"><small>${esc(f.wd)}</small><b>${esc(f.d)}</b><small>${esc(f.m)}</small></button>`; }).join('')}</div><div class="slots">${(S.days[S.date] || []).map((m) => `<button class="slot ${S.start === m ? 'sel' : ''}" data-slot="${m}" type="button">${esc(fmtTime(m))}</button>`).join('')}</div><div class="row mt"><button class="btn ghost" data-nomove type="button">${esc(t('back'))}</button><button class="btn" data-savemove type="button" ${S.start == null ? 'disabled' : ''}>${esc(t('saveMove'))}</button></div>`;
}
document.addEventListener('submit', (e) => { if (e.target.id !== 'f') return; e.preventDefault(); const f = new FormData(e.target); S.code = f.get('code'); S.phone = f.get('phone'); lookup(); });
document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-lang],[data-move],[data-cancel],[data-nomove],[data-day],[data-slot],[data-savemove]'); if (!c) return;
  if (c.dataset.lang !== undefined) { toggleLang(); return render(); }
  const call = async (body, msg) => { try { S.b = (await api('manage', { method: 'POST', body: { code: S.b.code, phone: S.phone, ...body } })).booking; S.msg = msg; S.err = ''; S.move = false; } catch (er) { S.err = errText(er.code); } render(); };
  if (c.dataset.move !== undefined) { S.move = true; return loadDays(); }
  if (c.dataset.nomove !== undefined) { S.move = false; return render(); }
  if (c.dataset.day) { S.date = c.dataset.day; S.start = null; return render(); }
  if (c.dataset.slot) { S.start = Number(c.dataset.slot); return render(); }
  if (c.dataset.savemove !== undefined) return call({ action: 'reschedule', date: S.date, start: S.start }, t('moved'));
  if (c.dataset.cancel !== undefined) { if (confirm(t('cancelAsk'))) return call({ action: 'cancel' }, t('cancelledOk')); }
});
render(); registerSW();
