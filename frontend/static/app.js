// ============================================================
// ferradura · SPA sem framework. Rotas por hash (#/tela/id) para o botão
// voltar do celular funcionar; cada tela é um fragmento static/pages/*.html
// e a lógica dela fica em `pages` abaixo. API autenticada pelo JWT do
// /auth/token guardado na sessão.
// ============================================================
const $ = (id) => document.getElementById(id);
const view = $('screen');
let timer;       // auto-refresh da tela ativa
let onLeave;     // limpeza da tela ativa (ex.: destruir o mapa)
let renders = 0; // cada navegação invalida os awaits da tela anterior
let trackersCache; // listar rastreadores chama o Google: 1x por sessão

// ---------- API ----------
async function api(path, { json, ...opts } = {}) {
  if (json) {
    opts.body = JSON.stringify(json);
    opts.headers = { 'Content-Type': 'application/json' };
  }
  opts.headers = { ...opts.headers, Authorization: `Bearer ${sessionStorage.getItem('token')}` };
  const res = await fetch(path, opts);
  if (res.status === 401) {
    sessionStorage.removeItem('token');
    if (!location.hash.startsWith('#/login')) go(`#/login?next=${encodeURIComponent(location.hash)}`);
    throw new Error('Faça login');
  }
  const body = await res.json().catch(() => null); // 204 e erros sem JSON
  if (!res.ok) {
    const d = body?.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((e) => e.msg).join('; ') : res.statusText);
  }
  return body;
}

const loadTrackers = () => (trackersCache ??= api('api/v1/findhub/trackers')
  .then((r) => r.trackers)
  .catch((e) => { trackersCache = null; throw e; }));

// ---------- helpers de UI ----------
function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message !== 'Faça login') toast(e.reason?.message ?? String(e.reason), 6000);
});

const num = (x, digits = 2) => x.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const kg1 = (x) => x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hora = (ts) => new Date(ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const novos = (n) => `${n} ${n === 1 ? 'ponto novo' : 'pontos novos'}`;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

function option(value, text, selected = false) {
  const o = document.createElement('md-select-option');
  o.value = String(value);
  if (selected) o.setAttribute('selected', '');
  const headline = document.createElement('div');
  headline.slot = 'headline';
  headline.textContent = text;
  o.append(headline);
  return o;
}

// O md-select não relê opções trocadas depois de renderizado: o menu interno
// só as enxerga no slotchange (próximo ciclo) e aí reset() aplica a opção
// marcada com `selected`.
async function fillSelect(select, options) {
  select.replaceChildren(...options);
  await new Promise((r) => setTimeout(r));
  select.reset();
}

function listItem(title, sub, action) {
  const row = document.createElement('div');
  row.className = 'list-item';
  const text = document.createElement('div');
  if (title) {
    const b = document.createElement('b');
    b.textContent = title;
    text.append(b);
  }
  const s = document.createElement('span');
  s.className = 'muted';
  s.textContent = sub;
  text.append(s);
  row.append(text);
  if (action) row.append(action);
  return row;
}

function linkButton(label, href) {
  const b = document.createElement('md-text-button');
  b.textContent = label;
  b.setAttribute('href', href);
  return b;
}

// Segmented button: marca o `.seg` com data-v === value.
function segmented(el, value, onChange) {
  const set = (v) => el.querySelectorAll('.seg').forEach((s) => s.setAttribute('aria-selected', String(s.dataset.v === v)));
  el.onclick = (e) => {
    const s = e.target.closest('.seg');
    if (!s) return;
    set(s.dataset.v);
    onChange?.(s.dataset.v);
  };
  set(value);
  return { set, get: () => el.querySelector('[aria-selected="true"]')?.dataset.v };
}

function bar({ title = '', back = null, actions = [] }) {
  $('appbar').hidden = false;
  $('title').textContent = title;
  $('back').hidden = !back;
  if (back) $('back').setAttribute('href', back);
  $('actions').replaceChildren(...actions.map(([icon, label, onClick]) => {
    const b = document.createElement('md-icon-button');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }));
}

const SHOE = '<svg width="52" height="52" viewBox="0 0 38 38" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M11 6.5C8 9 6.5 13 6.5 18c0 8 5.6 13.5 12.5 13.5S31.5 26 31.5 18c0-5-1.5-9-4.5-11.5"/></svg>';
const GRADS = ['#2f2622', '#2b2a24', '#2f2320', '#262a26', '#262a2e', '#2a2622'];
const subtitle = (h) => h.breed || (h.weight_kg ? `${num(h.weight_kg, 0)} kg` : 'Raça não informada');
const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const SHIFTS = {
  M: { name: 'Manhã', bg: '#E9A48C', fg: '#3a1207', time: '06:30' },
  T: { name: 'Tarde', bg: '#C6462F', fg: '#ffffff', time: '13:00' },
  N: { name: 'Noite', bg: '#6E2A1E', fg: '#F3D9D1', time: '20:00' },
};
const STATUS_COLOR = { ok: 'var(--status-ok)', warn: 'var(--status-warn)', crit: 'var(--status-crit)' };

function horseCard(h) {
  const a = document.createElement('a');
  a.className = 'card card--tap horse-card';
  a.href = `#/cavalo/${h.id}`;
  a.innerHTML = `<div class="horse-card__hero">${SHOE}<span class="horse-card__initial"></span></div>
    <div class="horse-card__body"><div class="horse-card__name"></div><div class="horse-card__sub muted"></div></div>`;
  a.querySelector('.horse-card__hero').style.background = `linear-gradient(140deg, ${GRADS[h.id % GRADS.length]}, #141518)`;
  a.querySelector('.horse-card__initial').textContent = h.name[0].toUpperCase();
  a.querySelector('.horse-card__name').textContent = h.name;
  a.querySelector('.horse-card__sub').textContent = subtitle(h);
  return a;
}

// Próxima refeição do plano semanal (weekday 0 = segunda, como na API).
function nextMeal(meals) {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const m of meals) {
    const [hh, mm] = m.time.split(':').map(Number);
    let mins = ((m.weekday - today + 7) % 7) * 1440 + hh * 60 + mm - nowMin;
    if (mins < 0) mins += 7 * 1440;
    if (!best || mins < best.mins) best = { ...m, mins };
  }
  if (!best) return null;
  const d = Math.floor(best.mins / 1440);
  const h = Math.floor((best.mins % 1440) / 60);
  const min = String(best.mins % 60).padStart(2, '0');
  best.label = d ? `${DAYS[best.weekday].toLowerCase()}, em ${d}d ${h}h` : `em ${h}h ${min}min`;
  return best;
}

function locSummary(horse, latest) {
  if (!horse.tag_id) return ['Sem tag', 'Nenhuma tag vinculada'];
  if (!latest) return ['Sem posição', 'Aguardando a rede Find Hub'];
  const fence = latest.inside_fence == null ? 'Sem cerca' : latest.inside_fence ? 'Dentro da cerca' : 'Fora da cerca';
  return [fence, `Atualizado ${ago(latest.ts)}`];
}

function pinIcon(name, sub) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = '<div class="pin__label"><b></b><span></span></div><span class="material-symbols-outlined">location_on</span>';
  el.querySelector('b').textContent = name;
  el.querySelector('.pin__label span').textContent = sub;
  return L.divIcon({ html: el, className: '', iconSize: [0, 0], iconAnchor: [0, 0] });
}

function logout() {
  sessionStorage.removeItem('token');
  trackersCache = null;
  go('#/login');
}

// ---------- alertas ----------
async function refreshAlerts() {
  const { alerts } = await api('api/v1/alerts/');
  $('bell').classList.toggle('has-alerts', alerts.length > 0);
  $('alertsList').replaceChildren(...(alerts.length ? alerts.map((a) => {
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `<span class="dot"></span><div style="flex:1;min-width:0"><div class="title"></div><div class="desc"></div><div class="time"></div></div>
      <span class="material-symbols-outlined muted" style="font-size:18px">chevron_right</span>`;
    item.querySelector('.dot').style.background = STATUS_COLOR[a.status];
    item.querySelector('.title').textContent = a.name;
    item.querySelector('.desc').textContent = a.desc;
    item.querySelector('.time').textContent = a.ts ? ago(a.ts) : '';
    item.onclick = () => go(a.to === 'google' ? '#/google' : `#/${a.to}/${a.horse_id}`);
    return item;
  }) : [listItem('', 'Nenhum alerta.')]));
}
function openAlerts() {
  $('alertsDrawer').classList.add('open');
  $('alertsScrim').classList.add('open');
  refreshAlerts();
}
function closeAlerts() {
  $('alertsDrawer').classList.remove('open');
  $('alertsScrim').classList.remove('open');
}
$('bell').addEventListener('click', openAlerts);
$('alertsScrim').addEventListener('click', closeAlerts);
$('alertsClose').addEventListener('click', closeAlerts);

// ---------- telas ----------
const pages = {
  login({ params }) {
    const form = $('loginForm');
    let busy = false;
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const body = new URLSearchParams({ username: $('user').value, password: $('pass').value });
        const res = await fetch('auth/token', { method: 'POST', body });
        if (!res.ok) {
          $('loginError').textContent = res.status === 401 ? 'Usuário ou senha inválidos' : `Erro ${res.status}`;
          return;
        }
        sessionStorage.setItem('token', (await res.json()).access_token);
        const next = params.get('next');
        if (next && !next.startsWith('#/login')) go(next);
        else start();
      } finally {
        busy = false;
      }
    });
  },

  async plantel({ params }) {
    bar({
      title: 'Plantel',
      actions: [['bluetooth_searching', 'Conta Google', () => go('#/google')], ['logout', 'Sair', logout]],
    });
    const [{ horses }, status] = await Promise.all([api('api/v1/horses/'), api('api/v1/findhub/status')]);
    $('googleBanner').hidden = status.logged_in;
    const cards = horses.map(horseCard);
    $('grid').replaceChildren(...cards);
    $('empty').hidden = horses.length > 0;
    $('search').addEventListener('input', () => {
      const q = norm($('search').value);
      cards.forEach((c, i) => { c.hidden = !norm(horses[i].name).includes(q); });
    });

    // --- cadastro ---
    const dlg = $('cadDialog');
    const tag = $('cadTag');
    const clone = $('cadClone');
    const defaultClone = horses.length ? String(horses[0].id) : 'manual';
    const cloneValue = () => clone.value || defaultClone;
    const updClone = (v = cloneValue()) => {
      const manual = v === 'manual';
      $('manualPanel').hidden = !manual;
      $('cloneSummary').hidden = manual;
      if (!manual) $('cloneName').textContent = horses.find((h) => String(h.id) === v)?.name ?? '';
    };
    clone.addEventListener('change', () => updClone());
    $('cadRaio').addEventListener('input', () => { $('cadRaioVal').textContent = `${$('cadRaio').value} m`; });

    async function open(preTag = '', preName = '') {
      $('cadNome').value = preName;
      $('cadNome').error = false;
      $('cadRaca').value = '';
      $('cadPeso').value = '';
      await fillSelect(clone, [
        ...horses.map((h) => option(h.id, h.name, String(h.id) === defaultClone)),
        option('manual', 'Definir manualmente', defaultClone === 'manual'),
      ]);
      updClone(defaultClone);
      await fillSelect(tag, [option('', status.logged_in ? 'Carregando tags…' : 'Sem tag (conecte a conta Google)', true)]);
      dlg.show();
      if (!status.logged_in) return;
      try {
        const trackers = await loadTrackers();
        const used = new Map(horses.filter((h) => h.tag_id).map((h) => [h.tag_id, h.name]));
        await fillSelect(tag, [option('', 'Sem tag', !preTag), ...trackers.map((t) =>
          option(t.id, used.has(t.id) ? `${t.name} (já em ${used.get(t.id)})` : t.name, t.id === preTag))]);
      } catch (e) {
        await fillSelect(tag, [option('', 'Sem tag', true)]);
        toast(`Não deu para listar as tags: ${e.message}`);
      }
    }

    $('fabCad').addEventListener('click', () => open());
    $('cadCancel').addEventListener('click', () => dlg.close());
    $('cadOk').addEventListener('click', async () => {
      const name = $('cadNome').value.trim();
      if (!name) {
        $('cadNome').error = true;
        $('cadNome').errorText = 'Informe o nome';
        return;
      }
      const manual = cloneValue() === 'manual';
      const body = {
        name,
        breed: $('cadRaca').value.trim() || null,
        weight_kg: Number($('cadPeso').value) || null,
        tag_id: tag.value || null,
      };
      if (manual) body.fence_radius_m = Number($('cadRaio').value);
      const horse = await api(`api/v1/horses/${manual ? '' : `?clone_from=${cloneValue()}`}`, { method: 'POST', json: body });
      dlg.close();
      go(`#/cavalo/${horse.id}`);
    });

    if (params.get('tag')) open(params.get('tag'), params.get('name') ?? '');
  },

  async cavalo({ horse }) {
    bar({
      title: horse.name,
      back: '#/plantel',
      actions: [['delete', 'Remover cavalo', async () => {
        if (!confirm(`Remover "${horse.name}" com todo o trajeto e o plano de nutrição?`)) return;
        await api(`api/v1/horses/${horse.id}`, { method: 'DELETE' });
        go('#/plantel');
      }]],
    });
    $('hInitial').textContent = horse.name[0].toUpperCase();
    $('hName').textContent = horse.name;
    $('hBreed').textContent = horse.breed || 'Raça não informada';
    $('hWeight').textContent = horse.weight_kg ? `${num(horse.weight_kg, 0)} kg` : '';
    for (const [id, page] of [['cLoc', 'localizacao'], ['cBio', 'biometria'], ['cAtiv', 'atividade'], ['cNutri', 'nutricao']]) {
      $(id).href = `#/${page}/${horse.id}`;
    }
    const [latest, { meals }] = await Promise.all([
      api(`api/v1/horses/${horse.id}/positions/latest`).catch(() => null),
      api(`api/v1/horses/${horse.id}/meals`),
    ]);
    const [main, sub] = locSummary(horse, latest);
    $('locMain').textContent = main;
    $('locMain').style.color = latest?.inside_fence === false ? 'var(--status-crit)' : '';
    $('locSub').textContent = sub;
    const next = nextMeal(meals);
    $('nutriMain').textContent = next ? next.time : '—';
    $('nutriSub').textContent = next ? `Próxima ${next.label}` : 'Sem plano de nutrição';
  },

  async localizacao({ horse, alive }) {
    bar({
      title: 'Localização',
      back: `#/cavalo/${horse.id}`,
      actions: horse.tag_id ? [['refresh', 'Consultar tag agora', pollNow]] : [],
    });
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim();
    const map = L.map('map', { zoomControl: false }).setView([-15.8, -47.9], 4);
    L.control.zoom({ position: 'topright' }).addTo(map); // à esquerda fica o segmentado
    onLeave = () => map.remove();
    // OSM escurecido por CSS (.map .leaflet-tile-pane). crossOrigin: o
    // fastapi-guard manda COEP require-corp; em modo CORS os tiles do OSM
    // (Access-Control-Allow-Origin: *) passam.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    const fence = L.circle([0, 0], { radius: 1, color: '#C6462F', weight: 2, opacity: 0.5, fillOpacity: 0.07, dashArray: '7 7' });
    const status = await api('api/v1/findhub/status');
    let days = 0;
    let fitted = false;
    let editing = false;

    const since = () => {
      if (days) return Math.floor(Date.now() / 1000) - days * 86400;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return Math.floor(d / 1000);
    };

    function showFence() {
      if (horse.fence_lat != null && horse.fence_radius_m != null) {
        fence.setLatLng([horse.fence_lat, horse.fence_lon]).setRadius(horse.fence_radius_m).addTo(map);
      } else {
        fence.remove();
      }
    }

    async function draw() {
      const [track, latest] = await Promise.all([
        api(`api/v1/horses/${horse.id}/positions?from=${since()}`),
        api(`api/v1/horses/${horse.id}/positions/latest`).catch(() => null),
      ]);
      if (!alive()) return;
      layer.clearLayers();
      const pts = track.positions.map((p) => [p.lat, p.lon]);
      L.polyline(pts, { color: cor, weight: 3, dashArray: '2 8', lineCap: 'round' }).addTo(layer);
      for (const p of track.positions) {
        L.circleMarker([p.lat, p.lon], { radius: 3, color: cor, weight: 1, fillOpacity: 0.8 })
          .bindTooltip(`${hora(p.ts)} · ±${Math.round(p.accuracy)} m`).addTo(layer);
      }
      if (latest) {
        L.circle([latest.lat, latest.lon], { radius: latest.accuracy, color: cor, weight: 1, opacity: 0.6, fillOpacity: 0.08, interactive: false }).addTo(layer);
        L.marker([latest.lat, latest.lon], {
          icon: pinIcon(horse.name, `±${Math.round(latest.accuracy)} m · ${ago(latest.ts)}`),
          interactive: false,
          keyboard: false,
        }).addTo(layer);
      }
      if (!editing) showFence();
      const n = track.positions.length;
      $('statDist').textContent = `${num(track.distance_m / 1000)} km · ${n} ${n === 1 ? 'ponto' : 'pontos'}`;

      let msg = '';
      if (!horse.tag_id) {
        msg = '<b>Sem tag de localização</b><span class="muted">Cadastre um cavalo com uma tag do Find Hub.</span>';
      } else if (horse.tag_id !== 'demo' && !status.logged_in) {
        msg = '<b>Conta Google não conectada</b><span class="muted">A tag não está sendo consultada. <a href="#/google">Conectar</a></span>';
      } else if (!pts.length) {
        const last = latest ? `Última posição: ${hora(latest.ts)}.` : 'Aguardando um Android passar perto da tag.';
        msg = `<b>Nenhuma posição neste período</b><span class="muted">${last}</span>`;
      }
      $('notice').hidden = !msg;
      $('notice').innerHTML = msg && `<span class="material-symbols-outlined">info</span><div>${msg}</div>`;

      if (!fitted && !editing) {
        const bounds = L.latLngBounds(pts);
        if (latest) bounds.extend([latest.lat, latest.lon]);
        if (map.hasLayer(fence)) bounds.extend(fence.getBounds());
        if (bounds.isValid()) {
          map.fitBounds(bounds.pad(0.25), { maxZoom: 18 });
          fitted = true;
        }
      }
    }

    async function pollNow() {
      const r = await api(`api/v1/horses/${horse.id}/poll`, { method: 'POST' });
      if (r.error) throw new Error(`Consulta falhou: ${r.error}`);
      toast(novos(r.saved));
      await draw();
    }

    segmented($('range'), '0', (v) => {
      days = Number(v);
      fitted = false;
      draw();
    });

    // --- editar cerca: o centro acompanha o centro do mapa ---
    const slider = $('rslider');
    const setRadius = (r) => {
      fence.setRadius(Number(r));
      $('fenceRadius').textContent = `${r} m`;
    };
    const follow = () => fence.setLatLng(map.getCenter());
    function edit(on) {
      editing = on;
      for (const id of ['fenceEdit', 'fenceBanner', 'crosshair']) $(id).hidden = !on;
      for (const id of ['fenceFab', 'legend']) $(id).hidden = on;
      fence.setStyle(on ? { dashArray: null, opacity: 1, fillOpacity: 0.14 } : { dashArray: '7 7', opacity: 0.5, fillOpacity: 0.07 });
      if (on) map.on('move', follow);
      else map.off('move', follow);
    }
    $('fenceStart').addEventListener('click', () => {
      const r = horse.fence_radius_m ?? 150;
      slider.value = r;
      setRadius(r);
      edit(true);
      fence.setLatLng(map.getCenter()).addTo(map);
      if (horse.fence_lat != null) map.panTo([horse.fence_lat, horse.fence_lon]);
    });
    slider.addEventListener('input', () => setRadius(slider.value));
    $('fenceCancel').addEventListener('click', () => {
      edit(false);
      showFence();
    });
    $('fenceSave').addEventListener('click', async () => {
      const c = map.getCenter();
      Object.assign(horse, await api(`api/v1/horses/${horse.id}`, {
        method: 'PATCH',
        json: { fence_lat: c.lat, fence_lon: c.lng, fence_radius_m: Number(slider.value) },
      }));
      edit(false);
      toast('Cerca virtual salva');
      await draw();
    });

    await draw();
    timer = setInterval(() => editing || draw(), 60_000); // o poller grava a cada ~10 min
  },

  async biometria({ horse }) {
    bar({ title: 'Biometria', back: `#/cavalo/${horse.id}` });
    const today = Date.now();
    await fillSelect($('day'), Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today - i * 86_400_000);
      const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' }).split('-')[0];
      return option(i, `${weekday[0].toUpperCase()}${weekday.slice(1)} · ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`, i === 0);
    }));
  },

  atividade({ horse }) {
    bar({ title: 'Atividade', back: `#/cavalo/${horse.id}` });
  },

  async nutricao({ horse }) {
    bar({ title: 'Nutrição', back: `#/cavalo/${horse.id}` });
    const url = `api/v1/horses/${horse.id}/meals`;
    let { meals } = await api(url);
    $('mealTime').previousElementSibling.addEventListener('click', () => $('mealTime').showPicker?.());
    const dlg = $('mealDialog');
    let cur; // célula aberta no diálogo: { weekday, shift }
    const shiftSeg = segmented($('shiftSeg'), 'M', (v) => {
      cur.shift = v;
      $('mealTime').value = SHIFTS[v].time;
    });
    const recSeg = segmented($('recSeg'), 'nunca');
    const find = (weekday, shift) => meals.find((m) => m.weekday === weekday && m.shift === shift);

    function renderCal() {
      $('calendar').replaceChildren(...Object.entries(SHIFTS).map(([shift, t]) => {
        const row = document.createElement('div');
        row.className = 'cal-row';
        const label = document.createElement('div');
        label.className = 'cal-turno';
        label.textContent = shift;
        row.append(label, ...DAYS.map((day, weekday) => {
          const m = find(weekday, shift);
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = m ? 'meal' : 'meal meal--empty';
          cell.setAttribute('aria-label', `${day}, ${t.name}: ${m ? `${m.time}, ${kg1(m.kg)} kg` : 'sem refeição'}`);
          if (m) {
            cell.style.background = t.bg;
            cell.style.color = t.fg;
            cell.innerHTML = `<span class="t">${m.time}</span><span class="k">${kg1(m.kg)}kg</span>`;
          } else {
            cell.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">add</span>';
          }
          cell.addEventListener('click', () => open(weekday, shift, false));
          return cell;
        }));
        return row;
      }));
    }

    function recompute() {
      const sum = ['sx', 'sy', 'sz'].reduce((a, id) => a + Number($(id).value), 0);
      $('sumChip').textContent = `Soma ${sum}%`;
      $('sumChip').className = `sum-chip ${sum === 100 ? 'sum-chip--ok' : 'sum-chip--bad'}`;
      $('mealSave').disabled = sum !== 100;
    }

    function open(weekday, shift, fromFab) {
      const m = find(weekday, shift);
      cur = { weekday, shift };
      $('mealTitle').textContent = `Refeição · ${DAYS[weekday]}`;
      $('mealTime').value = m?.time ?? SHIFTS[shift].time;
      $('sx').value = m?.x ?? 40;
      $('sy').value = m?.y ?? 35;
      $('sz').value = m?.z ?? 25;
      $('mealKg').value = String(m?.kg ?? 3);
      $('shiftBox').hidden = !fromFab; // na célula o turno já está definido
      shiftSeg.set(shift);
      recSeg.set(fromFab ? 'diario' : 'nunca');
      $('mealDelete').hidden = !m;
      recompute();
      dlg.show();
    }

    for (const id of ['sx', 'sy', 'sz']) {
      $(id).addEventListener('input', recompute);
      $(id).addEventListener('change', recompute);
    }
    $('fabMeal').addEventListener('click', () => {
      const now = new Date();
      const h = now.getHours();
      open((now.getDay() + 6) % 7, h < 11 ? 'M' : h < 17 ? 'T' : 'N', true);
    });
    $('mealSave').addEventListener('click', async () => {
      const time = $('mealTime').value;
      const kg = Number($('mealKg').value);
      if (!time || !(kg > 0)) {
        toast('Informe o horário e a quantidade');
        return;
      }
      const rec = recSeg.get();
      const weekdays = rec === 'diario' ? [0, 1, 2, 3, 4, 5, 6] : rec === 'uteis' ? [0, 1, 2, 3, 4] : [cur.weekday];
      ({ meals } = await api(url, {
        method: 'PUT',
        json: { weekdays, shift: cur.shift, time, kg, x: Number($('sx').value), y: Number($('sy').value), z: Number($('sz').value) },
      }));
      dlg.close();
      renderCal();
      toast('Refeição salva');
    });
    $('mealDelete').addEventListener('click', async () => {
      await api(`${url}/${cur.weekday}/${cur.shift}`, { method: 'DELETE' });
      meals = meals.filter((m) => !(m.weekday === cur.weekday && m.shift === cur.shift));
      dlg.close();
      renderCal();
    });

    renderCal();
  },

  async google({ alive }) {
    bar({ title: 'Conta Google', back: '#/plantel' });
    const { horses } = await api('api/v1/horses/');
    const nameOf = (id) => horses.find((h) => h.id === Number(id))?.name ?? `Cavalo #${id}`;
    let trackersShown = false;
    const icon = (el, ok) => {
      el.textContent = ok ? 'check_circle' : 'radio_button_unchecked';
      el.classList.toggle('done', ok);
      el.classList.toggle('todo', !ok);
    };

    async function showTrackers() {
      trackersShown = true;
      $('trackers').replaceChildren(listItem('', 'Carregando…'));
      try {
        const trackers = await loadTrackers();
        const used = new Map(horses.filter((h) => h.tag_id).map((h) => [h.tag_id, h]));
        $('trackers').replaceChildren(...(trackers.length ? trackers.map((t) => {
          const h = used.get(t.id);
          return h
            ? listItem(t.name, `Vinculada a ${h.name}`, linkButton('Ver no mapa', `#/localizacao/${h.id}`))
            : listItem(t.name, 'Sem cavalo', linkButton('Cadastrar cavalo', `#/plantel?${new URLSearchParams({ tag: t.id, name: t.name })}`));
        }) : [listItem('', 'Nenhum rastreador na conta. A tag aparece no app Encontre Meu Dispositivo?')]));
      } catch (e) {
        trackersShown = false;
        $('trackers').replaceChildren(listItem('', `Erro ao listar: ${e.message}`));
      }
    }

    async function refresh() {
      const s = await api('api/v1/findhub/status');
      if (!alive()) return;
      icon($('stRepoIcon'), s.repo);
      $('stRepo').textContent = s.repo ? `Baixada do GitHub · commit ${s.commit}` : `Será baixada do GitHub (commit ${s.commit}) ao conectar`;
      icon($('stLoginIcon'), s.logged_in);
      $('stLogin').textContent = s.logged_in ? `Conectada: ${s.email}` : 'Não conectada';
      $('stRunning').hidden = !s.running;
      $('stStep').textContent = s.step;
      $('stError').hidden = !s.error;
      $('stError').textContent = s.error;
      $('connect').hidden = s.logged_in;
      $('connect').disabled = s.running;
      const polls = Object.entries(s.poll);
      $('polls').replaceChildren(...(polls.length
        ? polls.map(([id, p]) => listItem(nameOf(id), `${hora(p.at)} · ${p.error ? `ERRO ${p.error}` : novos(p.saved)}`))
        : [listItem('', 'Nenhuma consulta ainda.')]));
      if (!s.logged_in) $('trackers').replaceChildren(listItem('', 'Conecte a conta para listar.'));
      else if (!trackersShown) showTrackers();
      clearTimeout(timer);
      if (s.running) timer = setTimeout(refresh, 3000); // acompanha as etapas do Chrome
    }

    $('connect').addEventListener('click', async () => {
      await api('api/v1/findhub/login', { method: 'POST' });
      refresh();
    });
    $('upload').addEventListener('click', () => $('secrets').click());
    $('secrets').addEventListener('change', async (e) => {
      const body = new FormData();
      body.append('file', e.target.files[0]);
      e.target.value = '';
      await api('api/v1/findhub/secrets', { method: 'POST', body });
      trackersCache = null;
      toast('secrets.json instalado');
      refresh();
    });
    await refresh();
  },
};

// ---------- roteador ----------
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Sem conta Google conectada, o fluxo começa por ela.
async function start() {
  if (!sessionStorage.getItem('token')) return go('#/login');
  const { logged_in } = await api('api/v1/findhub/status');
  go(logged_in ? '#/plantel' : '#/google');
}

async function render() {
  const n = ++renders;
  const alive = () => n === renders;
  clearInterval(timer);
  onLeave?.();
  onLeave = null;
  closeAlerts();

  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page, id] = path.split('/');
  if (!pages[page]) return start();
  if (page !== 'login' && !sessionStorage.getItem('token')) return go('#/login');

  let html;
  let horse = null;
  try {
    [html, horse] = await Promise.all([
      fetch(`static/pages/${page}.html`).then((r) => r.text()),
      id ? api(`api/v1/horses/${id}`) : null,
    ]);
  } catch (e) {
    if (e.message !== 'Faça login') {
      toast(e.message);
      go('#/plantel');
    }
    return;
  }
  if (!alive()) return;
  view.className = page === 'localizacao' ? 'screen screen--full' : 'screen';
  view.innerHTML = html;
  view.scrollTop = 0;
  $('appbar').hidden = page === 'login';
  await pages[page]({ horse, alive, params: new URLSearchParams(query) });
  if (page !== 'login' && alive()) refreshAlerts();
}

window.addEventListener('hashchange', render);
render();
