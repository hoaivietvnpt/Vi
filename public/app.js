'use strict';
/* ====================== Ví – thu chi hằng ngày ====================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LS = {
  get(k, d) { try { const v = localStorage.getItem('vi:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vi:' + k, JSON.stringify(v)); } catch {} },
};

const sheet = document.getElementById('sheet');
const state = {
  txs: LS.get('txs', []),
  cats: LS.get('cats', []),
  outbox: LS.get('outbox', []),
  tab: 'home',
  listMonth: monthStart(new Date()),
  listFilter: 'all',
  listCat: null,
  search: '',
  repMode: 'month',
  repAnchor: new Date(),
  donutType: 'expense',
  catType: 'expense',
};

/* ---------- formatting ---------- */
const nf = new Intl.NumberFormat('vi-VN');
const money = (n) => nf.format(Math.round(n)) + ' ₫';
const signed = (n, type) => (type === 'income' ? '+' : '−') + nf.format(n);
function compact(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e9) return s + trim(a / 1e9) + ' tỷ';
  if (a >= 1e6) return s + trim(a / 1e6) + 'tr';
  if (a >= 1e3) return s + trim(a / 1e3) + 'k';
  return s + a;
}
const trim = (x) => (x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100).toString().replace('.', ',');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const monthLabel = (d) => `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
function dayLabel(s) {
  const d = parseYmd(s), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 864e5);
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  if (diff === 0) return 'Hôm nay · ' + base;
  if (diff === 1) return 'Hôm qua · ' + base;
  const names = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return `${names[d.getDay()]} · ${base}${d.getFullYear() !== t.getFullYear() ? '/' + d.getFullYear() : ''}`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* Vietnamese number in words (for amount confirmation) */
function readVnd(n) {
  if (!n) return '';
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const parts = [];
  let i = 0;
  while (n > 0 && i < 6) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(nf.format(chunk) + (units[i % 4] ? ' ' + units[i % 4] : '') + (i >= 4 ? ' tỷ' : ''));
    n = Math.floor(n / 1000); i++;
  }
  return parts.join(' ') + ' đồng';
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Lỗi'); e.status = res.status; throw e; }
  return data;
}

function persist() { LS.set('txs', state.txs); LS.set('cats', state.cats); LS.set('outbox', state.outbox); }

let flushing = false;
async function flush() {
  if (flushing || !state.outbox.length || !navigator.onLine) return updateSync();
  flushing = true;
  try {
    while (state.outbox.length) {
      const op = state.outbox[0];
      try {
        await api(op.path, { method: op.method, body: op.body });
      } catch (e) {
        if (e.auth) { showLogin(); break; }
        if (e.status && e.status >= 400 && e.status < 500) { /* invalid → drop */ }
        else break; // network error → retry later
      }
      state.outbox.shift();
      persist();
    }
  } finally { flushing = false; updateSync(); }
}
function queue(method, path, body) {
  // collapse ops on the same entity
  state.outbox.push({ method, path, body });
  persist(); updateSync(); flush();
}
function updateSync() { $('#syncBadge').hidden = !state.outbox.length; }

async function loadAll() {
  const [cats, txs] = await Promise.all([api('/categories'), api('/transactions')]);
  state.cats = cats;
  // keep pending local creates that the server doesn't have yet
  const pendingIds = new Set(state.outbox.filter((o) => o.method !== 'DELETE').map((o) => o.body?.id).filter(Boolean));
  const deleted = new Set(state.outbox.filter((o) => o.method === 'DELETE').map((o) => o.path.split('/').pop()));
  const server = new Map(txs.map((t) => [t.id, t]));
  for (const t of state.txs) if (pendingIds.has(t.id)) server.set(t.id, t);
  state.txs = [...server.values()].filter((t) => !deleted.has(t.id));
  sortTxs(); persist();
}
const sortTxs = () => state.txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created_at || 0) - (a.created_at || 0)));
const catById = (id) => state.cats.find((c) => c.id === id) || { id, name: 'Khác', icon: '📦', color: '#8a8984', type: 'expense' };

/* ---------- aggregation ---------- */
function inRange(from, to) { const f = ymd(from), t = ymd(to); return state.txs.filter((x) => x.date >= f && x.date <= t); }
function sum(list, type) { return list.reduce((s, x) => (x.type === type ? s + x.amount : s), 0); }

/* ---------- UI: navigation ---------- */
function go(tab) {
  state.tab = tab;
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
  $$('.tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
  render();
}
function render() {
  if (state.tab === 'home') renderHome();
  if (state.tab === 'list') renderList();
  if (state.tab === 'report') renderReport();
  if (state.tab === 'settings') renderSettings();
  if (sheet.classList.contains('open')) renderCatGrid();
}

/* ---------- transaction row ---------- */
function txRow(t) {
  const c = catById(t.category_id);
  return `<button class="tx" data-id="${esc(t.id)}">
    <span class="tx-ic" style="background:${c.color}1f">${esc(c.icon)}</span>
    <span class="tx-main"><span class="tx-cat">${esc(c.name)}</span>${t.note ? `<span class="tx-note">${esc(t.note)}</span>` : ''}</span>
    <span class="tx-amt ${t.type === 'income' ? 'inc' : ''}">${signed(t.amount, t.type)}</span>
  </button>`;
}
const emptyBox = (msg) => `<div class="empty"><span class="big">🌱</span>${msg}</div>`;

/* ---------- HOME ---------- */
function renderHome() {
  const now = new Date();
  $('#homeDate').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const ms = monthStart(now), me = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const list = inRange(ms, me);
  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  $('#homeMonthLabel').textContent = monthLabel(now);
  $('#homeBalance').textContent = (inc - exp < 0 ? '−' : '') + money(Math.abs(inc - exp));
  $('#homeIncome').textContent = money(inc);
  $('#homeExpense').textContent = money(exp);
  $('#todaySpent').textContent = money(sum(inRange(now, now), 'expense'));
  $('#avgSpent').textContent = money(exp / now.getDate());

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    const l = inRange(d, d);
    days.push({ label: i === 0 ? 'Nay' : WD[d.getDay()], title: dayLabel(ymd(d)), exp: sum(l, 'expense'), inc: sum(l, 'income') });
  }
  $('#weekTotal').textContent = 'Tổng ' + money(days.reduce((s, d) => s + d.exp, 0));
  barChart($('#weekChart'), days, { series: ['exp'], height: 140, highlightLast: true });

  const recent = state.txs.slice(0, 6);
  $('#recentList').innerHTML = recent.length ? recent.map(txRow).join('') : emptyBox('Chưa có giao dịch nào.<br>Bấm <b>＋</b> để ghi khoản đầu tiên.');
}

/* ---------- LIST ---------- */
function renderList() {
  const ms = state.listMonth, me = new Date(ms.getFullYear(), ms.getMonth() + 1, 0);
  $('#listMonthLabel').textContent = monthLabel(ms);
  let list = inRange(ms, me);
  if (state.listFilter !== 'all') list = list.filter((t) => t.type === state.listFilter);
  if (state.listCat) list = list.filter((t) => t.category_id === state.listCat);
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.note + ' ' + catById(t.category_id).name).toLowerCase().includes(q));

  const ac = $('#activeCat');
  if (state.listCat) {
    const c = catById(state.listCat);
    ac.hidden = false;
    ac.innerHTML = `${esc(c.icon)} ${esc(c.name)} <button aria-label="Bỏ lọc">✕</button>`;
  } else ac.hidden = true;

  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  $('#listSummary').innerHTML = `<span>${list.length} giao dịch</span><span>Thu <b class="inc-t">${nf.format(inc)}</b></span><span>Chi <b class="exp-t">${nf.format(exp)}</b></span>`;

  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  let html = '';
  for (const [date, items] of groups) {
    const de = sum(items, 'expense'), di = sum(items, 'income');
    const tot = [di ? `<span class="inc-t">+${nf.format(di)}</span>` : '', de ? `−${nf.format(de)}` : ''].filter(Boolean).join(' · ');
    html += `<div class="day-group"><div class="day-head"><span>${dayLabel(date)}</span><span class="day-total">${tot}</span></div>${items.map(txRow).join('')}</div>`;
  }
  $('#txList').innerHTML = html || `<div class="card">${emptyBox('Không có giao dịch trong kỳ này.')}</div>`;
}

/* ---------- REPORT ---------- */
function repRange(anchor = state.repAnchor, mode = state.repMode) {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (mode === 'week') { const dow = (a.getDay() + 6) % 7; const f = addDays(a, -dow); return [f, addDays(f, 6)]; }
  if (mode === 'month') return [monthStart(a), new Date(a.getFullYear(), a.getMonth() + 1, 0)];
  return [new Date(a.getFullYear(), 0, 1), new Date(a.getFullYear(), 11, 31)];
}
function shiftAnchor(n) {
  const a = state.repAnchor;
  if (state.repMode === 'week') state.repAnchor = addDays(a, 7 * n);
  else if (state.repMode === 'month') state.repAnchor = new Date(a.getFullYear(), a.getMonth() + n, 1);
  else state.repAnchor = new Date(a.getFullYear() + n, 0, 1);
}
function pctDelta(cur, prev) {
  if (!prev) return cur ? 'mới' : '—';
  const p = Math.round(((cur - prev) / prev) * 100);
  return (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '') + Math.abs(p) + '% kỳ trước';
}

function renderReport() {
  const [from, to] = repRange();
  const mode = state.repMode;
  $('#repLabel').textContent =
    mode === 'week' ? `${pad(from.getDate())}/${pad(from.getMonth() + 1)} – ${pad(to.getDate())}/${pad(to.getMonth() + 1)}/${to.getFullYear()}`
    : mode === 'month' ? monthLabel(from) : 'Năm ' + from.getFullYear();
  $$('#reportMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));

  const list = inRange(from, to);
  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  const prevAnchor = mode === 'week' ? addDays(from, -7) : mode === 'month' ? addMonths(from, -1) : new Date(from.getFullYear() - 1, 0, 1);
  const [pf, pt] = repRange(prevAnchor, mode);
  const plist = inRange(pf, pt);
  $('#repIncome').textContent = compact(inc);
  $('#repExpense').textContent = compact(exp);
  $('#repNet').textContent = compact(inc - exp);
  $('#repIncomeDelta').textContent = pctDelta(inc, sum(plist, 'income'));
  $('#repExpenseDelta').textContent = pctDelta(exp, sum(plist, 'expense'));
  $('#repSave').textContent = inc ? `Tiết kiệm ${Math.max(0, Math.round(((inc - exp) / inc) * 100))}%` : '';

  // donut by category
  const dt = state.donutType;
  $$('#donutType button').forEach((b) => b.classList.toggle('on', b.dataset.t === dt));
  const byCat = new Map();
  for (const t of list) if (t.type === dt) byCat.set(t.category_id, (byCat.get(t.category_id) || 0) + t.amount);
  const rows = [...byCat.entries()].map(([id, v]) => ({ c: catById(id), v })).sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, r) => s + r.v, 0);
  donut($('#donut'), rows, total, dt === 'expense' ? 'Tổng chi' : 'Tổng thu');
  $('#catBreakdown').innerHTML = rows.length
    ? rows.map((r) => {
        const p = total ? (r.v / total) * 100 : 0;
        return `<button class="cat-row" data-cat="${esc(r.c.id)}">
          <span class="ic" style="background:${r.c.color}1f">${esc(r.c.icon)}</span>
          <span class="nm">${esc(r.c.name)} <small>${p < 1 ? '<1' : Math.round(p)}%</small></span>
          <span class="am">${nf.format(r.v)}</span>
          <span class="bar"><i style="width:${Math.max(p, 1.5)}%;background:${r.c.color}"></i></span>
        </button>`;
      }).join('')
    : emptyBox('Chưa có dữ liệu trong kỳ này.');

  // flow chart
  let buckets = [];
  if (mode === 'year') {
    $('#flowTitle').textContent = 'Dòng tiền theo tháng';
    for (let m = 0; m < 12; m++) {
      const f = new Date(from.getFullYear(), m, 1), l = inRange(f, new Date(from.getFullYear(), m + 1, 0));
      buckets.push({ label: 'T' + (m + 1), title: monthLabel(f), inc: sum(l, 'income'), exp: sum(l, 'expense') });
    }
  } else {
    $('#flowTitle').textContent = 'Dòng tiền theo ngày';
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      const l = inRange(d, d);
      buckets.push({ label: mode === 'week' ? WD[d.getDay()] : String(d.getDate()), title: dayLabel(ymd(d)), inc: sum(l, 'income'), exp: sum(l, 'expense') });
    }
  }
  barChart($('#flowChart'), buckets, { series: ['inc', 'exp'], height: 190, labelEvery: mode === 'month' ? 5 : 1 });

  // trend 6 months ending at anchor month
  const end = monthStart(mode === 'year' ? (from.getFullYear() === new Date().getFullYear() ? new Date() : new Date(from.getFullYear(), 11, 1)) : to);
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const f = addMonths(end, -i), l = inRange(f, new Date(f.getFullYear(), f.getMonth() + 1, 0));
    trend.push({ label: 'T' + (f.getMonth() + 1), title: monthLabel(f), inc: sum(l, 'income'), exp: sum(l, 'expense') });
  }
  barChart($('#trendChart'), trend, { series: ['inc', 'exp'], height: 190 });

  // facts
  const exps = list.filter((t) => t.type === 'expense');
  const biggest = exps.reduce((m, t) => (!m || t.amount > m.amount ? t : m), null);
  const nDays = Math.max(1, Math.min(Math.round((to - from) / 864e5) + 1, Math.round((new Date() - from) / 864e5) + 1));
  const dayTotals = new Map();
  for (const t of exps) dayTotals.set(t.date, (dayTotals.get(t.date) || 0) + t.amount);
  const topDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const facts = [
    ['Chi trung bình / ngày', money(exp / nDays)],
    ['Số giao dịch', nf.format(list.length)],
    ['Khoản chi lớn nhất', biggest ? `${money(biggest.amount)}<br><small class="muted">${esc(catById(biggest.category_id).name)}${biggest.note ? ' · ' + esc(biggest.note) : ''}</small>` : '—'],
    ['Ngày chi nhiều nhất', topDay ? `${money(topDay[1])}<br><small class="muted">${dayLabel(topDay[0])}</small>` : '—'],
    ['Danh mục chi nhiều nhất', rows.length && dt === 'expense' ? `${esc(rows[0].c.icon)} ${esc(rows[0].c.name)}` : (() => {
      const m = new Map(); for (const t of exps) m.set(t.category_id, (m.get(t.category_id) || 0) + t.amount);
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? `${esc(catById(top[0]).icon)} ${esc(catById(top[0]).name)}` : '—';
    })()],
  ];
  $('#facts').innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
}

/* ---------- charts ---------- */
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x - r.width / 2, top = y - r.height - 12;
  left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
  if (top < 8) top = y + 16;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
const hideTip = () => { tip.hidden = true; $$('.chart .hl.on').forEach((e) => e.classList.remove('on')); };
document.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.chart')) hideTip(); });

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function barChart(el, data, { series, height = 160, labelEvery = 1, highlightLast = false }) {
  const W = Math.max(280, el.clientWidth || 320), H = height;
  const padL = 34, padR = 4, padT = 8, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s]))));
  const n = data.length, slot = iw / n;
  const gap = series.length > 1 ? 2 : 0;
  const groupW = Math.min(slot * (n > 20 ? 0.8 : 0.62), series.length > 1 ? 30 : 26);
  const bw = (groupW - gap * (series.length - 1)) / series.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ cột">`;
  for (let i = 0; i <= 3; i++) {
    const y = padT + ih - (ih * i) / 3;
    s += `<line class="grid-l" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    s += `<text x="${padL - 6}" y="${y + 3.5}" text-anchor="end">${i ? compact((max * i) / 3) : '0'}</text>`;
  }
  data.forEach((d, i) => {
    const x0 = padL + i * slot;
    s += `<rect class="bar-hit" data-i="${i}" x="${x0}" y="${padT}" width="${slot}" height="${ih + padB}"/>`;
    s += `<rect class="hl" x="${x0 + 1}" y="${padT}" width="${slot - 2}" height="${ih}" rx="6"/>`;
    const gx = x0 + (slot - groupW) / 2;
    series.forEach((k, j) => {
      const v = d[k]; if (!v) return;
      const h = Math.max(2, (v / max) * ih), x = gx + j * (bw + gap), y = padT + ih - h, r = Math.min(4, bw / 2, h);
      const op = highlightLast && i !== n - 1 ? ' style="opacity:.55"' : '';
      // rounded top, square baseline
      s += `<path class="bar-${k}"${op} d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z"/>`;
    });
    if (i % labelEvery === 0 || i === n - 1) s += `<text x="${x0 + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  s += `<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" stroke="var(--line)"/></svg>`;
  el.innerHTML = s;
  const names = { inc: 'Thu', exp: 'Chi' };
  el.onpointerover = el.onpointerdown = (e) => {
    const hit = e.target.closest('.bar-hit'); if (!hit) return;
    const d = data[+hit.dataset.i];
    $$('.hl.on', el).forEach((x) => x.classList.remove('on'));
    hit.nextElementSibling.classList.add('on');
    const r = hit.getBoundingClientRect();
    showTip(`<div class="tt-h">${esc(d.title)}</div>` + series.map((k) => `<div class="tt-r"><span><i class="sw ${k}"></i>${names[k]}</span><b>${nf.format(d[k])}</b></div>`).join(''), r.left + r.width / 2, r.top + 10);
  };
  el.onpointerleave = (e) => { if (e.pointerType === 'mouse') hideTip(); };
}

function donut(el, rows, total, label) {
  const R = 80, C = 2 * Math.PI * R, SW = 22, gapLen = rows.length > 1 ? 3 : 0;
  let off = 0, arcs = '';
  // fold tail into "Khác" visually if >8 slices
  const shown = rows.length > 8 ? [...rows.slice(0, 7), { c: { id: '_other', name: 'Khác', icon: '…', color: '#a3a29c' }, v: rows.slice(7).reduce((s, r) => s + r.v, 0) }] : rows;
  shown.forEach((r, i) => {
    const len = total ? (r.v / total) * C : 0;
    const vis = Math.max(0, len - gapLen);
    arcs += `<circle class="seg-arc" data-i="${i}" cx="100" cy="100" r="${R}" fill="none" stroke="${r.c.color}" stroke-width="${SW}" stroke-dasharray="${vis} ${C - vis}" stroke-dashoffset="${-off}"/>`;
    off += len;
  });
  el.innerHTML = `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="${SW}"/>${arcs}</svg>
    <div class="donut-center"><span class="muted">${label}</span><b>${compact(total)}</b></div>`;
  const center = $('.donut-center', el);
  el.onpointerover = el.onpointerdown = (e) => {
    const a = e.target.closest('.seg-arc');
    $$('.seg-arc', el).forEach((x) => { x.style.opacity = a && x !== a ? '.35' : '1'; });
    if (!a) return;
    const r = shown[+a.dataset.i];
    center.innerHTML = `<span class="muted">${esc(r.c.icon)} ${esc(r.c.name)}</span><b>${compact(r.v)}</b><span class="muted">${Math.round((r.v / total) * 100)}%</span>`;
  };
  el.onpointerleave = () => {
    $$('.seg-arc', el).forEach((x) => (x.style.opacity = '1'));
    center.innerHTML = `<span class="muted">${label}</span><b>${compact(total)}</b>`;
  };
}

/* ---------- ADD / EDIT SHEET ---------- */

const form = { id: null, type: 'expense', expr: '', cat: null, date: ymd(new Date()), note: '' };

function evalExpr(expr) {
  const tokens = expr.match(/\d+|[+-]/g) || [];
  let total = 0, sign = 1;
  for (const t of tokens) {
    if (t === '+') sign = 1; else if (t === '-') sign = -1; else total += sign * Number(t);
  }
  return Math.max(0, total);
}
function renderAmount() {
  const e = form.expr;
  const pretty = e ? e.replace(/\d+/g, (d) => nf.format(Number(d))).replace(/\+/g, ' + ').replace(/-/g, ' − ') : '0';
  $('#amountText').textContent = pretty;
  const hasOp = /[+-]/.test(e);
  const v = evalExpr(e);
  $('#amountWords').innerHTML = hasOp ? `= <b>${money(v)}</b>` : v ? esc(readVnd(v)) : '&nbsp;';
  $('#saveBtn').textContent = hasOp ? '=' : 'Lưu';
  // shrink font for long numbers
  const len = pretty.length;
  $('#amountDisplay').style.fontSize = len > 16 ? '28px' : len > 11 ? '36px' : '';
}
function renderCatGrid() {
  const cats = state.cats.filter((c) => c.type === form.type && (!c.archived || c.id === form.cat));
  // most-used first
  const usage = new Map();
  for (const t of state.txs.slice(0, 400)) if (t.type === form.type) usage.set(t.category_id, (usage.get(t.category_id) || 0) + 1);
  cats.sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || a.sort - b.sort);
  if (!form.cat || !cats.some((c) => c.id === form.cat)) form.cat = cats[0]?.id || null;
  $('#catGrid').innerHTML = cats.map((c) => `<button class="cat-btn ${c.id === form.cat ? 'on' : ''}" data-cat="${esc(c.id)}"><span class="e" style="background:${c.color}22">${esc(c.icon)}</span><span>${esc(c.name)}</span></button>`).join('');
}
function renderDate() {
  const today = ymd(new Date()), yest = ymd(addDays(new Date(), -1));
  $$('#dateChips button').forEach((b) => b.classList.toggle('on', ymd(addDays(new Date(), +b.dataset.d)) === form.date));
  const other = form.date !== today && form.date !== yest;
  $('.date-pick').classList.toggle('on', other);
  $('#datePickLabel').textContent = other ? '📅 ' + form.date.split('-').reverse().join('/') : '📅 Ngày khác';
  $('#dateInput').value = form.date;
}
function setType(type) {
  form.type = type;
  sheet.dataset.type = type;
  $$('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  form.cat = LS.get('lastCat:' + type, null);
  renderCatGrid();
}
function openSheet(tx) {
  form.id = tx?.id || null;
  form.expr = tx ? String(tx.amount) : '';
  form.note = tx?.note || '';
  form.date = tx?.date || ymd(new Date());
  setType(tx?.type || LS.get('lastType', 'expense'));
  if (tx) { form.cat = tx.category_id; renderCatGrid(); }
  $('#noteInput').value = form.note;
  $('#sheetDelete').hidden = !tx;
  $('#sheetSpacer').hidden = !!tx;
  renderAmount(); renderDate();
  $('#sheetBackdrop').hidden = false;
  requestAnimationFrame(() => { $('#sheetBackdrop').classList.add('show'); sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); });
  $('#catGrid').scrollLeft = 0;
  history.pushState({ sheet: 1 }, '');
}
function closeSheet(fromPop) {
  if (!sheet.classList.contains('open')) return;
  sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true');
  $('#sheetBackdrop').classList.remove('show');
  setTimeout(() => ($('#sheetBackdrop').hidden = true), 250);
  document.activeElement?.blur?.();
  if (!fromPop && history.state?.sheet) history.back();
}
window.addEventListener('popstate', () => closeSheet(true));

function pressKey(k) {
  haptic();
  let e = form.expr;
  if (k === 'back') e = e.slice(0, -1);
  else if (k === 'C') e = '';
  else if (k === '+' || k === '-') { if (!e) return; e = /[+-]$/.test(e) ? e.slice(0, -1) + k : e + k; }
  else if (k === 'save') return save();
  else {
    const last = (e.match(/\d+$/) || [''])[0];
    if (last.length >= 13) return;
    if (last === '0' || (!last && (k === '000' || k === '0'))) { if (k === '0' || k === '000') return; e = e.slice(0, e.length - last.length); }
    e += k;
  }
  form.expr = e; renderAmount();
}

function save(keepOpen = false) {
  if (/[+-]/.test(form.expr)) { const v = evalExpr(form.expr); form.expr = v ? String(v) : ''; renderAmount(); return; }
  const amount = evalExpr(form.expr);
  if (!amount) { const d = $('#amountDisplay'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); haptic(30); return; }
  if (!form.cat) return toast('Hãy chọn danh mục');
  const body = { type: form.type, amount, category_id: form.cat, note: $('#noteInput').value.trim(), date: form.date };
  LS.set('lastType', form.type); LS.set('lastCat:' + form.type, form.cat);
  if (form.id) {
    const t = state.txs.find((x) => x.id === form.id);
    Object.assign(t, body, { updated_at: Date.now() });
    queue('PUT', '/transactions/' + form.id, body);
    toast('Đã cập nhật');
  } else {
    const t = { id: uuid(), ...body, created_at: Date.now(), updated_at: Date.now() };
    state.txs.push(t);
    queue('POST', '/transactions', t);
    toast(`Đã lưu ${body.type === 'income' ? '+' : '−'}${money(amount)}`);
  }
  sortTxs(); persist(); render();
  closeSheet();
}
function removeTx() {
  if (!form.id || !confirm('Xoá giao dịch này?')) return;
  state.txs = state.txs.filter((x) => x.id !== form.id);
  queue('DELETE', '/transactions/' + form.id);
  persist(); render(); closeSheet(); toast('Đã xoá');
}

/* ---------- SETTINGS ---------- */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0EA5E9', '#14B8A6', '#A16207', '#64748B'];
function renderSettings() {
  $$('#catType button').forEach((b) => b.classList.toggle('on', b.dataset.t === state.catType));
  const cats = state.cats.filter((c) => c.type === state.catType && !c.archived);
  $('#catManage').innerHTML = cats.map((c) => `<button class="cat-item" data-cat="${esc(c.id)}"><span class="ic" style="background:${c.color}22">${esc(c.icon)}</span><span class="nm">${esc(c.name)}</span><span class="chev">›</span></button>`).join('');
}
let editingCat = null;
function openCatDialog(cat) {
  editingCat = cat || { type: state.catType, icon: '🏷️', color: PALETTE[0], name: '' };
  $('#catDlgTitle').textContent = cat ? 'Sửa danh mục' : 'Danh mục mới';
  $('#catIcon').value = editingCat.icon; $('#catName').value = editingCat.name;
  $('#catDelete').hidden = !cat;
  $('#swatches').innerHTML = PALETTE.map((c) => `<button style="background:${c}" data-c="${c}" class="${c.toLowerCase() === editingCat.color.toLowerCase() ? 'on' : ''}" aria-label="${c}"></button>`).join('');
  $('#catDialog').hidden = false; $('#dlgBackdrop').hidden = false; $('#dlgBackdrop').classList.add('show');
}
function closeCatDialog() { $('#catDialog').hidden = true; $('#dlgBackdrop').hidden = true; }
async function saveCat() {
  const name = $('#catName').value.trim(); if (!name) return $('#catName').focus();
  const body = { name, icon: $('#catIcon').value.trim() || '🏷️', color: editingCat.color, type: editingCat.type };
  try {
    if (editingCat.id) { const r = await api('/categories/' + editingCat.id, { method: 'PUT', body }); Object.assign(editingCat, r); }
    else state.cats.push(await api('/categories', { method: 'POST', body }));
    persist(); closeCatDialog(); render(); toast('Đã lưu danh mục');
  } catch (e) { toast(e.auth ? 'Hết phiên đăng nhập' : 'Cần kết nối mạng để sửa danh mục'); }
}
async function deleteCat() {
  if (!confirm(`Xoá danh mục "${editingCat.name}"? Giao dịch cũ vẫn được giữ.`)) return;
  try {
    await api('/categories/' + editingCat.id, { method: 'DELETE' });
    const used = state.txs.some((t) => t.category_id === editingCat.id);
    if (used) editingCat.archived = 1; else state.cats = state.cats.filter((c) => c.id !== editingCat.id);
    persist(); closeCatDialog(); render();
  } catch { toast('Cần kết nối mạng'); }
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ['Ngày,Loại,Danh mục,Số tiền,Ghi chú'];
  for (const t of [...state.txs].reverse()) lines.push([t.date, t.type === 'income' ? 'Thu' : 'Chi', q(catById(t.category_id).name), t.amount, q(t.note || '')].join(','));
  download(`vi-thu-chi-${ymd(new Date())}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
}
function exportJson() {
  download(`vi-backup-${ymd(new Date())}.json`, JSON.stringify({ version: 1, exported_at: new Date().toISOString(), categories: state.cats, transactions: state.txs }, null, 1), 'application/json');
}
async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const txs = Array.isArray(data) ? data : data.transactions;
    if (!Array.isArray(txs)) throw new Error();
    if (!confirm(`Nhập ${txs.length} giao dịch? (Giao dịch trùng sẽ được bỏ qua)`)) return;
    const r = await api('/import', { method: 'POST', body: { transactions: txs } });
    await loadAll(); render(); toast(`Đã nhập ${r.imported} giao dịch`);
  } catch (e) { toast(e.auth ? 'Hết phiên đăng nhập' : 'File không hợp lệ hoặc mất mạng'); }
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900);
}

/* ---------- auth ---------- */
function showLogin() {
  $('#login').hidden = false; $('#main').hidden = true; $('#tabbar').hidden = true;
  setTimeout(() => $('#pw').focus(), 50);
}
function showApp() { $('#login').hidden = true; $('#main').hidden = false; $('#tabbar').hidden = false; render(); }

/* ---------- events ---------- */
function bind() {
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (b) { haptic(); go(b.dataset.tab); }
  });
  $('#fab').addEventListener('click', () => { haptic(12); openSheet(); });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto);
    const tx = e.target.closest('.tx[data-id]');
    if (tx) { const t = state.txs.find((x) => x.id === tx.dataset.id); if (t) openSheet(t); }
  });

  // list
  $$('[data-list-nav]').forEach((b) => b.addEventListener('click', () => { state.listMonth = addMonths(state.listMonth, +b.dataset.listNav); renderList(); }));
  $('#listMonthLabel').addEventListener('click', () => { state.listMonth = monthStart(new Date()); renderList(); });
  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
  $('#listFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.listFilter = b.dataset.f; $$('#listFilter button').forEach((x) => x.classList.toggle('on', x === b)); renderList();
  });
  $('#activeCat').addEventListener('click', (e) => { if (e.target.closest('button')) { state.listCat = null; renderList(); } });

  // report
  $('#reportMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.repMode = b.dataset.m; state.repAnchor = new Date(); renderReport(); });
  $$('[data-rep-nav]').forEach((b) => b.addEventListener('click', () => { shiftAnchor(+b.dataset.repNav); renderReport(); }));
  $('#donutType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.donutType = b.dataset.t; renderReport(); });
  $('#catBreakdown').addEventListener('click', (e) => {
    const r = e.target.closest('[data-cat]'); if (!r) return;
    const [from] = repRange();
    state.listCat = r.dataset.cat; state.listFilter = 'all'; state.listMonth = monthStart(state.repMode === 'year' ? new Date() : from);
    $$('#listFilter button').forEach((x) => x.classList.toggle('on', x.dataset.f === 'all'));
    go('list');
  });

  // sheet
  $('#keypad').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pressKey(b.dataset.k || b.textContent.trim()); });
  $('#typeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { haptic(); setType(b.dataset.type); } });
  $('#catGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.cat-btn'); if (!b) return; haptic();
    form.cat = b.dataset.cat; $$('.cat-btn').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#dateChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { form.date = ymd(addDays(new Date(), +b.dataset.d)); renderDate(); } });
  $('#dateInput').addEventListener('change', (e) => { if (e.target.value) { form.date = e.target.value; renderDate(); } });
  $('#noteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('#sheetCancel').addEventListener('click', () => closeSheet());
  $('#sheetBackdrop').addEventListener('click', () => closeSheet());
  $('#sheetDelete').addEventListener('click', removeTx);
  // physical keyboard support (desktop)
  document.addEventListener('keydown', (e) => {
    if (!sheet.classList.contains('open') || e.target === $('#noteInput')) return;
    if (/^[0-9]$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('back');
    else if (e.key === '+' || e.key === '-') pressKey(e.key);
    else if (e.key === 'Enter') pressKey('save');
    else if (e.key === 'Escape') closeSheet();
  });
  // swipe down to close
  let sy = null;
  $('.grabber').parentElement.addEventListener('touchstart', (e) => { if (sheet.scrollTop <= 0 && e.target.closest('.grabber, .sheet-top, .amount-display')) sy = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => { if (sy == null) return; const dy = e.touches[0].clientY - sy; if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (sy == null) return; const dy = e.changedTouches[0].clientY - sy; sy = null;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 110) closeSheet();
  });

  // settings
  $('#catType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.catType = b.dataset.t; renderSettings(); } });
  $('#catManage').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) openCatDialog(state.cats.find((c) => c.id === b.dataset.cat)); });
  $('#addCatBtn').addEventListener('click', () => openCatDialog());
  $('#swatches').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; editingCat.color = b.dataset.c; $$('#swatches button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#catCancel').addEventListener('click', closeCatDialog);
  $('#dlgBackdrop').addEventListener('click', closeCatDialog);
  $('#catSave').addEventListener('click', saveCat);
  $('#catDelete').addEventListener('click', deleteCat);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#exportJson').addEventListener('click', exportJson);
  $('#importJson').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
  $('#logoutBtn').addEventListener('click', async () => {
    if (!confirm('Đăng xuất khỏi thiết bị này?')) return;
    await api('/logout', { method: 'POST' }).catch(() => {});
    localStorage.clear(); location.reload();
  });

  // login
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: $('#pw').value } });
      $('#pw').value = '';
      await boot();
    } catch (err) { $('#loginErr').textContent = err.status === 401 ? 'Sai mật khẩu' : 'Không kết nối được máy chủ'; }
  });

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); refresh(); } });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
}

let lastRefresh = 0;
async function refresh() {
  if (Date.now() - lastRefresh < 15000 || state.outbox.length) return;
  lastRefresh = Date.now();
  try { await loadAll(); render(); } catch (e) { if (e.auth) showLogin(); }
}

async function boot() {
  try {
    const me = await api('/me');
    $('#logoutCard').hidden = !me.protected;
    await flush();
    await loadAll(); lastRefresh = Date.now();
    showApp();
  } catch (e) {
    if (e.auth) return showLogin();
    // offline: use cache
    if (state.cats.length) { showApp(); toast('Đang ngoại tuyến – dữ liệu sẽ đồng bộ sau'); }
    else showLogin();
  }
}

bind();
updateSync();
if (state.cats.length) showApp();
boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
