import { $, $$, api, esc, t, loc, toggleLang, topbar, registerSW } from './common.js';
async function render() {
  let list = []; try { list = (await api('businesses')).businesses; } catch {}
  $('#root').innerHTML = topbar() + `<main class="wrap"><section class="hero"><h1>${esc(t('hubTitle'))}</h1><p>${esc(t('hubSub'))}</p></section>
  <h2 class="mt">${esc(t('pickBiz'))}</h2><div class="tiles mt">${list.map((b) => `<a class="tile" style="background:${esc(b.color)}" href="/book?b=${esc(b.id)}"><h3>${esc(loc(b))}</h3><p>${esc(loc(b, 'tagline'))}</p><p class="small" style="margin-top:10px">${esc(t('tileBook'))}</p><span class="go">${esc(t('open'))} →</span></a>`).join('')}</div>
  <div class="tiles mt2"><a class="tile" style="background:#16302c" href="/app"><h3>${esc(t('tileApp'))}</h3><p>${esc(t('tileAppD'))}</p><span class="go">${esc(t('open'))} →</span></a><a class="tile" style="background:#8a5a1d" href="/manage"><h3>${esc(t('tileManage'))}</h3><p>${esc(t('tileManageD'))}</p><span class="go">${esc(t('open'))} →</span></a></div>
  <div class="grid mt2" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))"><section class="card"><h2>${esc(t('flow'))}</h2><ol><li>${esc(t('flow1'))}</li><li>${esc(t('flow2'))}</li><li>${esc(t('flow3'))}</li><li>${esc(t('flow4'))}</li></ol></section><section class="card"><h2>${esc(t('limitsTitle'))}</h2><ul><li>${esc(t('limit1'))}</li><li>${esc(t('limit2'))}</li><li>${esc(t('limit3'))}</li></ul></section></div></main>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-lang]')) { toggleLang(); render(); } });
render(); registerSW();
