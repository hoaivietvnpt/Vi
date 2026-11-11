'use strict';
/* ====================== Ví – thu chi hằng ngày ====================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LS = {
  get(k, d) { try { const v = localStorage.getItem('vi2:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vi2:' + k, JSON.stringify(v)); } catch {} },
  clear() { try { Object.keys(localStorage).filter((k) => k.startsWith('vi')).forEach((k) => localStorage.removeItem(k)); } catch {} },
};

const sheet = document.getElementById('sheet');
const state = {
  user: LS.get('user', null),
  books: LS.get('books', []),
  bookId: LS.get('bookId', null),
  members: [],
  txs: [],
  cats: [],
  people: [],
  listPerson: null,
  personType: 'expense',
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
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { const e = new Error(data.error || 'Hết phiên đăng nhập'); e.auth = true; e.status = 401; throw e; }
  if (!res.ok) { const e = new Error(data.error || 'Lỗi'); e.status = res.status; throw e; }
  return data;
}

function persist() {
  LS.set('outbox', state.outbox);
  if (!state.bookId) return;
  LS.set('txs:' + state.bookId, state.txs); LS.set('cats:' + state.bookId, state.cats); LS.set('members:' + state.bookId, state.members); LS.set('people:' + state.bookId, state.people);
}
function loadCache() {
  state.txs = LS.get('txs:' + state.bookId, []);
  state.cats = LS.get('cats:' + state.bookId, []);
  state.people = LS.get('people:' + state.bookId, []);
  state.members = LS.get('members:' + state.bookId, []);
}
const bp = (p) => `/books/${state.bookId}${p}`;
const curBook = () => state.books.find((b) => b.id === state.bookId);
const isShared = () => (curBook()?.members || 0) > 1;

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
  const bookId = state.bookId;
  const [cats, txs, members, people] = await Promise.all([api(bp('/categories')), api(bp('/transactions')), api(bp('/members')), api(bp('/people'))]);
  if (bookId !== state.bookId) return; // switched meanwhile
  state.cats = cats; state.members = members; state.people = people;
  // keep pending local creates that the server doesn't have yet
  const mine = state.outbox.filter((o) => o.path.startsWith(bp('/transactions')));
  const pendingIds = new Set(mine.filter((o) => o.method !== 'DELETE').map((o) => o.body?.id || o.path.split('/').pop()));
  const deleted = new Set(mine.filter((o) => o.method === 'DELETE').map((o) => o.path.split('/').pop()));
  const server = new Map(txs.map((t) => [t.id, t]));
  for (const t of state.txs) if (pendingIds.has(t.id)) server.set(t.id, t);
  state.txs = [...server.values()].filter((t) => !deleted.has(t.id));
  sortTxs(); persist();
}
const sortTxs = () => state.txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created_at || 0) - (a.created_at || 0)));
const personById = (id) => state.people.find((p) => p.id === id) || null;
const personPhrase = (t) => { const p = t.person_id && personById(t.person_id); return p ? `${p.icon} ${t.type === 'income' ? 'từ' : 'cho'} ${p.name}` : ''; };
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
  const b = curBook();
  $$('.book-pill').forEach((el) => { el.querySelector('.bp-ic').textContent = b?.icon || '📒'; el.querySelector('.bp-name').textContent = b?.name || 'Sổ'; });
  if (state.tab === 'home') renderHome();
  if (state.tab === 'list') renderList();
  if (state.tab === 'report') renderReport();
  if (state.tab === 'settings') renderSettings();
  if (sheet.classList.contains('open')) { renderCatGrid(); renderPeople(); }
}

/* ---------- transaction row ---------- */
function txRow(t) {
  const c = catById(t.category_id);
  const who = isShared() && t.created_by ? memberName(t.created_by) : '';
  const sub = [who && `<span class="tx-who">${esc(who)}</span>`, personPhrase(t) && esc(personPhrase(t)), t.note && esc(t.note)].filter(Boolean).join(' · ');
  return `<button class="tx" data-id="${esc(t.id)}">
    <span class="tx-ic" style="background:${c.color}1f">${esc(c.icon)}</span>
    <span class="tx-main"><span class="tx-cat">${esc(c.name)}</span>${sub ? `<span class="tx-note">${sub}</span>` : ''}</span>
    <span class="tx-amt ${t.type === 'income' ? 'inc' : ''}">${signed(t.amount, t.type)}</span>
  </button>`;
}
function memberName(id) {
  if (id === state.user?.id) return 'Bạn';
  return state.members.find((m) => m.id === id)?.name || 'Thành viên cũ';
}
const initials = (name) => (name || '?').trim().split(/\s+/).slice(-1)[0].slice(0, 1).toUpperCase();
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
  if (state.listPerson) list = list.filter((t) => t.person_id === state.listPerson);
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.note + ' ' + catById(t.category_id).name + ' ' + (personById(t.person_id)?.name || '')).toLowerCase().includes(q));

  const ac = $('#activeCat');
  const chips = [];
  if (state.listCat) { const c = catById(state.listCat); chips.push(`<span>${esc(c.icon)} ${esc(c.name)} <button data-clear="cat" aria-label="Bỏ lọc">✕</button></span>`); }
  if (state.listPerson) { const p = personById(state.listPerson); chips.push(`<span>${esc(p?.icon || '')} ${esc(p?.name || '')} <button data-clear="person" aria-label="Bỏ lọc">✕</button></span>`); }
  ac.hidden = !chips.length;
  ac.innerHTML = chips.join('');

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

  // by person (Chi cho / Thu từ)
  const ptype = state.personType;
  $$('#personType button').forEach((b) => b.classList.toggle('on', b.dataset.t === ptype));
  const byP = new Map(); let untagged = 0;
  for (const t of list) {
    if (t.type !== ptype) continue;
    if (t.person_id && personById(t.person_id)) byP.set(t.person_id, (byP.get(t.person_id) || 0) + t.amount);
    else untagged += t.amount;
  }
  const prow = [...byP.entries()].map(([id, v]) => { const p = personById(id); return { c: { ...p, color: pColor(p) }, v }; }).sort((a, b) => b.v - a.v);
  const ptTotal = prow.reduce((a, r) => a + r.v, 0);
  $('#personDonutWrap').hidden = !prow.length;
  if (prow.length) donut($('#personDonut'), prow, ptTotal, ptype === 'expense' ? 'Chi cho người thân' : 'Thu từ người thân');
  $('#personBreakdown').innerHTML = prow.length
    ? prow.map((r) => {
        const pc = (r.v / ptTotal) * 100;
        return `<button class="cat-row" data-person="${esc(r.c.id)}">
        <span class="ic" style="background:${r.c.color}22">${esc(r.c.icon)}</span>
        <span class="nm">${esc(r.c.name)} <small>${pc < 1 ? '<1' : Math.round(pc)}%</small></span>
        <span class="am">${nf.format(r.v)}</span>
        <span class="bar"><i style="width:${Math.max(pc, 1.5)}%;background:${r.c.color}"></i></span>
      </button>`;
      }).join('') + (untagged ? `<div class="cat-row untagged"><span class="ic" style="background:var(--surface-2)">👤</span><span class="nm">Không ghi người <small>(của bạn)</small></span><span class="am">${nf.format(untagged)}</span></div>` : '')
    : emptyBox(`Chưa có khoản ${ptype === 'expense' ? 'chi cho' : 'thu từ'} người thân trong kỳ này.<br><small>Chọn người ở mục “${ptype === 'expense' ? 'Chi cho ai?' : 'Thu từ ai?'}” khi nhập giao dịch.</small>`);

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

  // per member (shared books)
  $('#memberCard').hidden = !isShared();
  if (isShared()) {
    const by = new Map();
    for (const t of list) {
      const k = t.created_by || '';
      const o = by.get(k) || { inc: 0, exp: 0 };
      o[t.type === 'income' ? 'inc' : 'exp'] += t.amount; by.set(k, o);
    }
    const mrows = [...by.entries()].sort((a, b) => b[1].exp - a[1].exp);
    const maxE = Math.max(1, ...mrows.map(([, v]) => v.exp));
    $('#memberBreakdown').innerHTML = mrows.length ? mrows.map(([id, v]) => `<div class="cat-row">
        <span class="ic avatar">${esc(initials(memberName(id)))}</span>
        <span class="nm">${esc(memberName(id))} <small>${v.inc ? 'thu ' + compact(v.inc) : ''}</small></span>
        <span class="am">${nf.format(v.exp)}</span>
        <span class="bar"><i style="width:${Math.max((v.exp / maxE) * 100, 1.5)}%;background:var(--exp)"></i></span>
      </div>`).join('') : emptyBox('Chưa có dữ liệu trong kỳ này.');
  }

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

const form = { id: null, type: 'expense', expr: '', cat: null, person: null, date: ymd(new Date()), note: '' };

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
const pColor = (p) => (p && /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#64748B');
function renderPeople() {
  $('#personLabel').textContent = form.type === 'income' ? 'Thu từ ai?' : 'Chi cho ai?';
  const ppl = state.people.filter((p) => !p.archived || p.id === form.person);
  // most used (for this type) first, then the saved order
  const usage = new Map();
  for (const t of state.txs.slice(0, 500)) if (t.type === form.type && t.person_id) usage.set(t.person_id, (usage.get(t.person_id) || 0) + 1);
  ppl.sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || a.sort - b.sort);
  $('#personChips').innerHTML = ppl.map((p) => `<button class="${p.id === form.person ? 'on' : ''}" data-person="${esc(p.id)}" style="--pc:${pColor(p)}">${esc(p.icon)} ${esc(p.name)}</button>`).join('')
    + '<button class="add" data-person-add>＋ Thêm</button>';
}
async function quickAddPerson() {
  const p = await personDialog();
  if (p?.id) { form.person = p.id; renderPeople(); }
}
function renderDate() {
  const today = ymd(new Date()), yest = ymd(addDays(new Date(), -1));
  $$('#dateChips button').forEach((b) => b.classList.toggle('on', ymd(addDays(new Date(), +b.dataset.d)) === form.date));
  const other = form.date !== today && form.date !== yest;
  $('.date-pick').classList.toggle('on', other);
  $('#datePickLabel').textContent = other ? '📅 ' + form.date.split('-').reverse().join('/') : '📅 Ngày khác';
  $('#dateInput').value = form.date;
}
const lastKey = (what, type) => `last:${state.bookId}:${what}:${type}`;
function setType(type) {
  form.type = type;
  sheet.dataset.type = type;
  $$('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  // new entries default to the last choices made for this book & type
  form.cat = LS.get(lastKey('cat', type), null);
  if (!form.id) {
    const p = LS.get(lastKey('person', type), null);
    form.person = p && state.people.some((x) => x.id === p && !x.archived) ? p : null;
  }
  renderCatGrid(); renderPeople();
}
function openSheet(tx) {
  form.id = tx?.id || null;
  form.expr = tx ? String(tx.amount) : '';
  form.note = tx?.note || '';
  form.date = tx?.date || ymd(new Date());
  setType(tx?.type || LS.get('last:' + state.bookId + ':type', 'expense'));
  if (tx) { form.cat = tx.category_id; form.person = tx.person_id || null; renderCatGrid(); renderPeople(); }
  $('#noteInput').value = form.note;
  $('#sheetDelete').hidden = !tx;
  $('#sheetSpacer').hidden = !!tx;
  renderAmount(); renderDate();
  $('#sheetBackdrop').hidden = false;
  requestAnimationFrame(() => { $('#sheetBackdrop').classList.add('show'); sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); });
  $('#catGrid').scrollLeft = 0;
  const on = $('#personChips .on'); $('#personChips').scrollLeft = on ? on.offsetLeft - 60 : 0;
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
  const body = { type: form.type, amount, category_id: form.cat, person_id: form.person, note: $('#noteInput').value.trim(), date: form.date };
  if (!form.id) {
    LS.set('last:' + state.bookId + ':type', form.type);
    LS.set(lastKey('cat', form.type), form.cat);
    LS.set(lastKey('person', form.type), form.person);
  }
  if (form.id) {
    const t = state.txs.find((x) => x.id === form.id);
    Object.assign(t, body, { updated_at: Date.now() });
    queue('PUT', bp('/transactions/' + form.id), body);
    toast('Đã cập nhật');
  } else {
    const t = { id: uuid(), ...body, created_at: Date.now(), updated_at: Date.now() };
    state.txs.push(t);
    queue('POST', bp('/transactions'), t);
    toast(`Đã lưu ${body.type === 'income' ? '+' : '−'}${money(amount)}`);
  }
  sortTxs(); persist(); render();
  closeSheet();
}
function removeTx() {
  if (!form.id || !confirm('Xoá giao dịch này?')) return;
  state.txs = state.txs.filter((x) => x.id !== form.id);
  queue('DELETE', bp('/transactions/' + form.id));
  persist(); render(); closeSheet(); toast('Đã xoá');
}

/* ---------- SETTINGS ---------- */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0EA5E9', '#14B8A6', '#A16207', '#64748B'];
function renderSettings() {
  renderPeopleManage();
  const u = state.user || {};
  $('#accAvatar').textContent = initials(u.name);
  $('#accName').textContent = u.name || '';
  $('#accEmail').textContent = u.email || '';
  const wasHidden = $('#adminCard').hidden;
  $('#adminCard').hidden = !u.is_admin;
  if (u.is_admin && wasHidden) loadAdminUsers();
  const b = curBook() || {};
  const owner = b.role === 'owner';
  $('#bookIcon').textContent = b.icon || '📒';
  $('#bookName').textContent = b.name || '';
  $('#bookMeta').textContent = `${b.members || 1} thành viên · ${owner ? 'Bạn là chủ sổ' : 'Thành viên'}`;
  $('#inviteBox').hidden = !owner;
  $('#inviteCode').textContent = b.invite_code || '';
  $('#memberList').innerHTML = (b.members || 1) > 1 ? state.members.map((m) => `<div class="member">
      <span class="avatar">${esc(initials(m.name))}</span>
      <div class="acc-main"><b>${esc(m.name)}${m.id === u.id ? ' (bạn)' : ''}</b><span class="role">${m.role === 'owner' ? 'Chủ sổ' : 'Thành viên'}${m.email ? ' · ' + esc(m.email) : ''}</span></div>
      ${owner && m.role !== 'owner' ? `<button class="rm" data-rm="${esc(m.id)}">Xoá</button>` : ''}
    </div>`).join('') : '';
  $('#renameBookBtn').hidden = !owner;
  $('#deleteBookBtn').hidden = !owner || state.books.length < 2;
  $('#leaveBookBtn').hidden = owner;

  $$('#catType button').forEach((b) => b.classList.toggle('on', b.dataset.t === state.catType));
  const cats = state.cats.filter((c) => c.type === state.catType && !c.archived);
  $('#catManage').innerHTML = cats.map((c) => `<button class="cat-item" data-cat="${esc(c.id)}"><span class="ic" style="background:${c.color}22">${esc(c.icon)}</span><span class="nm">${esc(c.name)}</span><span class="chev">›</span></button>`).join('');
}
function renderPeopleManage() {
  const ppl = state.people.filter((p) => !p.archived);
  $('#peopleManage').innerHTML = ppl.map((p) => `<button class="cat-item" data-pid="${esc(p.id)}"><span class="ic" style="background:${pColor(p)}26">${esc(p.icon)}</span><span class="nm">${esc(p.name)}</span><span class="sw" style="background:${pColor(p)}"></span><span class="chev">›</span></button>`).join('')
    || '<p class="muted small">Chưa có ai.</p>';
}
const PEOPLE_PALETTE = ['#2a78d6', '#e87ba4', '#e34948', '#eda100', '#008300', '#eb6834', '#1baf7a', '#A16207', '#6250d6', '#0EA5E9', '#14B8A6', '#64748B'];
async function personDialog(person) {
  const used = new Set(state.people.filter((p) => !p.archived && p !== person).map((p) => pColor(p).toLowerCase()));
  let color = person ? pColor(person) : PEOPLE_PALETTE.find((c) => !used.has(c.toLowerCase())) || PEOPLE_PALETTE[0];
  const r = await modal({
    title: person ? 'Sửa người thân' : 'Thêm người thân',
    body: `<div class="dlg-row">${field('pIcon', '', person?.icon || '🙂', 'text', 'maxlength="4" style="width:56px;flex:none;text-align:center;font-size:22px"')}${field('pName', 'Tên, vd: Bố, Mẹ, chị Hoa…', person?.name || '', 'text', 'maxlength="30"')}</div>
      <div class="swatches" id="pSwatches">${PEOPLE_PALETTE.map((c) => `<button type="button" style="background:${c}" data-c="${c}" class="${c.toLowerCase() === color.toLowerCase() ? 'on' : ''}" aria-label="Màu ${c}"></button>`).join('')}</div>`,
    onOpen: () => { $('#pSwatches').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; $$('#pSwatches button').forEach((x) => x.classList.toggle('on', x === b)); }; },
    actions: [
      ...(person ? [{ label: 'Xoá', cls: 'ghost danger', run: () => 'delete' }] : []),
      { label: 'Huỷ' },
      { label: 'Lưu', cls: 'primary', run: async () => {
        const name = $('#pName').value.trim(); if (!name) { $('#pName').focus(); return false; }
        const body = { name, icon: $('#pIcon').value.trim() || '🙂', color };
        if (person) { Object.assign(person, await api(bp('/people/' + person.id), { method: 'PUT', body })); return person; }
        const p = await api(bp('/people'), { method: 'POST', body }); state.people.push(p); return p;
      } },
    ],
  });
  if (r === 'delete') {
    if (!confirm(`Xoá "${person.name}" khỏi danh sách? Giao dịch cũ vẫn được giữ.`)) return null;
    try {
      const res = await api(bp('/people/' + person.id), { method: 'DELETE' });
      if (res.archived) person.archived = 1; else state.people = state.people.filter((p) => p !== person);
    } catch (e) { toast(e.message); }
  }
  persist(); render();
  return r && r !== 'delete' ? r : null;
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
    if (editingCat.id) { const r = await api(bp('/categories/' + editingCat.id), { method: 'PUT', body }); Object.assign(editingCat, r); }
    else state.cats.push(await api(bp('/categories'), { method: 'POST', body }));
    persist(); closeCatDialog(); render(); toast('Đã lưu danh mục');
  } catch (e) { toast(e.auth ? 'Hết phiên đăng nhập' : 'Cần kết nối mạng để sửa danh mục'); }
}
async function deleteCat() {
  if (!confirm(`Xoá danh mục "${editingCat.name}"? Giao dịch cũ vẫn được giữ.`)) return;
  try {
    await api(bp('/categories/' + editingCat.id), { method: 'DELETE' });
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
  const lines = ['Ngày,Loại,Danh mục,Chi cho / Thu từ,Số tiền,Ghi chú'];
  for (const t of [...state.txs].reverse()) lines.push([t.date, t.type === 'income' ? 'Thu' : 'Chi', q(catById(t.category_id).name), q(personById(t.person_id)?.name || ''), t.amount, q(t.note || '')].join(','));
  download(`vi-thu-chi-${ymd(new Date())}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
}
function exportJson() {
  download(`vi-backup-${ymd(new Date())}.json`, JSON.stringify({ version: 2, book: curBook()?.name, exported_at: new Date().toISOString(), categories: state.cats, people: state.people, transactions: state.txs }, null, 1), 'application/json');
}
async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const txs = Array.isArray(data) ? data : data.transactions;
    if (!Array.isArray(txs)) throw new Error();
    if (!confirm(`Nhập ${txs.length} giao dịch? (Giao dịch trùng sẽ được bỏ qua)`)) return;
    const r = await api(bp('/import'), { method: 'POST', body: { transactions: txs, categories: data.categories || [], people: data.people || [] } });
    await loadAll(); render(); toast(`Đã nhập ${r.imported} giao dịch`);
  } catch (e) { toast(e.auth ? 'Hết phiên đăng nhập' : 'File không hợp lệ hoặc mất mạng'); }
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900);
}

/* ---------- modal ---------- */
function modal({ title, body = '', actions = [], stack = false, onOpen, locked = false }) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalErr').textContent = '';
    const acts = $('#modalActions');
    acts.className = 'dlg-actions' + (stack ? ' stack' : '');
    acts.innerHTML = actions.map((a, i) => `<button class="btn ${a.cls || 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('');
    const close = (v) => { $('#modal').hidden = true; $('#modalBackdrop').hidden = true; resolve(v); };
    acts.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const a = actions[+b.dataset.i];
      if (!a.run) return close(null);
      b.disabled = true;
      try { const v = await a.run(); if (v !== false) close(v ?? true); }
      catch (err) { $('#modalErr').textContent = err.status ? err.message : 'Không kết nối được máy chủ'; }
      finally { b.disabled = false; }
    };
    $('#modalBody').onclick = (e) => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); };
    $('#modalBackdrop').onclick = () => { if (!locked) close(null); };
    $('#modal').hidden = false; $('#modalBackdrop').hidden = false; $('#modalBackdrop').classList.add('show');
    onOpen?.();
    const f = $('#modalBody input'); if (f) setTimeout(() => f.focus(), 50);
    $('#modalBody').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); acts.querySelector('.primary')?.click(); } };
  });
}
const field = (id, ph, val = '', type = 'text', extra = '') => `<input class="modal-field" id="${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(val)}" ${extra} />`;

/* ---------- books ---------- */
async function switchBook(id) {
  if (id === state.bookId) return;
  state.bookId = id; LS.set('bookId', id);
  loadCache(); state.listCat = null; state.listPerson = null; render();
  try { await loadAll(); render(); } catch (e) { if (e.auth) showLogin(); }
}
async function refreshMe() {
  const me = await api('/me');
  state.user = me.user; state.books = me.books;
  LS.set('user', me.user); LS.set('books', me.books);
  if (!state.books.some((b) => b.id === state.bookId)) { state.bookId = state.books[0]?.id || null; LS.set('bookId', state.bookId); loadCache(); }
}
async function openBookSwitcher() {
  const list = state.books.map((b) => `<button class="book-opt" data-pick="${esc(b.id)}">
      <span class="book-ic">${esc(b.icon)}</span>
      <span class="acc-main"><b>${esc(b.name)}</b><span class="muted small">${b.members > 1 ? b.members + ' thành viên' : 'Cá nhân'}${b.role === 'owner' ? '' : ' · được mời'}</span></span>
      ${b.id === state.bookId ? '<span class="check">✓</span>' : ''}</button>`).join('');
  const r = await modal({
    title: 'Chọn sổ', body: `<div class="book-opts">${list}</div>`, stack: true,
    actions: [
      { label: '＋ Tạo sổ mới', run: () => 'new' },
      { label: '🔗 Tham gia bằng mã mời', run: () => 'join' },
      { label: 'Đóng' },
    ],
  });
  if (r === 'new') return createBookDialog();
  if (r === 'join') return joinDialog();
  if (r && r !== true) switchBook(r);
}
async function createBookDialog() {
  const b = await modal({
    title: 'Tạo sổ mới',
    body: `<div class="dlg-row">${field('nbIcon', '', '👪', 'text', 'maxlength="4" style="width:56px;flex:none;text-align:center;font-size:22px"')}${field('nbName', 'Tên sổ, vd: Gia đình', '', 'text', 'maxlength="40"')}</div>
      <p class="muted small">Sau khi tạo, gửi mã mời cho người thân để cùng ghi chép.</p>`,
    actions: [{ label: 'Huỷ' }, { label: 'Tạo sổ', cls: 'primary', run: async () => {
      const name = $('#nbName').value.trim(); if (!name) { $('#nbName').focus(); return false; }
      return api('/books', { method: 'POST', body: { name, icon: $('#nbIcon').value.trim() || '📒' } });
    } }],
  });
  if (b && b.id) { state.books.push(b); LS.set('books', state.books); await switchBook(b.id); toast('Đã tạo sổ ' + b.name); }
}
async function joinDialog(code = '') {
  const b = await modal({
    title: 'Tham gia sổ chung',
    body: field('joinCode', 'Mã mời 8 ký tự', code, 'text', 'maxlength="8" autocapitalize="characters" autocomplete="off" class="modal-field code"').replace('class="modal-field"', ''),
    actions: [{ label: 'Huỷ' }, { label: 'Tham gia', cls: 'primary', run: () => api('/books/join', { method: 'POST', body: { code: $('#joinCode').value } }) }],
  });
  if (b && b.id) { await refreshMe(); await switchBook(b.id); render(); toast('Đã tham gia ' + b.name); }
}
async function shareInvite() {
  const b = curBook(); if (!b?.invite_code) return;
  const url = `${location.origin}/?join=${b.invite_code}`;
  const text = `Tham gia sổ "${b.name}" trên Ví: ${url} (mã ${b.invite_code})`;
  try {
    if (navigator.share) await navigator.share({ title: 'Ví – mời tham gia sổ', text, url });
    else { await navigator.clipboard.writeText(text); toast('Đã sao chép link mời'); }
  } catch {}
}

/* ---------- secrets & password ---------- */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Đã sao chép'); }
  catch { toast('Hãy chạm giữ để sao chép'); }
}
function showSecret({ title, intro, secret, shareText, doneLabel = 'Tôi đã lưu' }) {
  const acts = [{ label: 'Sao chép', run: async () => { await copyText(secret); return false; } }];
  if (navigator.share) acts.push({ label: 'Chia sẻ / Lưu', run: async () => { try { await navigator.share({ text: shareText }); } catch {} return false; } });
  acts.push({ label: doneLabel, cls: 'primary', run: () => true });
  return modal({ title, locked: true, body: `<p class="code-help">${intro}</p><div class="code-box">${esc(secret)}</div>`, actions: acts });
}
function forgotPassword() {
  modal({
    title: 'Quên mật khẩu',
    body: '<p class="code-help">Hãy liên hệ <b>quản trị viên</b> để được cấp mật khẩu tạm. Khi đăng nhập bằng mật khẩu tạm, bạn sẽ được yêu cầu đặt mật khẩu mới.</p>',
    actions: [{ label: 'Đã hiểu', cls: 'primary', run: () => true }],
  });
}
async function forceNewPassword() {
  await modal({
    title: 'Đặt mật khẩu mới', locked: true,
    body: '<p class="code-help">Bạn đang dùng mật khẩu tạm do quản trị viên cấp. Hãy đặt mật khẩu mới để tiếp tục.</p>' + field('fpPw', 'Mật khẩu mới (ít nhất 6 ký tự)', '', 'password', 'autocomplete="new-password"'),
    actions: [{ label: 'Lưu mật khẩu', cls: 'primary', run: async () => {
      await api('/me/password', { method: 'POST', body: { next: $('#fpPw').value } });
      state.user.must_change_pw = false; LS.set('user', state.user);
    } }],
  });
  toast('Đã đổi mật khẩu');
}

/* ---------- admin ---------- */
let adminUsers = [];
let adminT;
async function loadAdminUsers() {
  if (!state.user?.is_admin) return;
  try {
    adminUsers = await api('/admin/users?q=' + encodeURIComponent($('#adminSearch').value));
    renderAdminUsers();
  } catch (e) { $('#adminUsers').innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}
function renderAdminUsers() {
  $('#adminCount').textContent = adminUsers.length + ' người dùng';
  $('#adminUsers').innerHTML = adminUsers.map((u) => `<button class="admin-user" data-uid="${esc(u.id)}">
      <span class="avatar">${esc(initials(u.name))}</span>
      <span class="acc-main"><b>${esc(u.name)}${u.is_admin ? '<span class="badge">Admin</span>' : ''}</b><span class="muted small">${esc(u.email)}</span></span>
      <span class="chev">›</span></button>`).join('') || '<p class="muted small">Không tìm thấy.</p>';
}
const fmtTime = (t) => (t ? new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—');
async function openAdminUser(id) {
  const u = adminUsers.find((x) => x.id === id); if (!u) return;
  const self = u.id === state.user.id;
  const r = await modal({
    title: u.name,
    body: `<div class="kv"><span>Email</span><b>${esc(u.email)}</b><span>Đăng ký</span><b>${fmtTime(u.created_at)}</b>
      <span>Đăng nhập gần nhất</span><b>${fmtTime(u.last_login)}</b><span>Số sổ</span><b>${u.books}</b>
      <span>Vai trò</span><b>${u.is_admin ? 'Quản trị viên' : 'Người dùng'}</b></div>`,
    stack: true,
    actions: [
      { label: '🔑 Đặt lại mật khẩu', run: () => 'reset' },
      ...(self ? [] : [{ label: u.is_admin ? 'Bỏ quyền quản trị' : 'Cấp quyền quản trị', run: () => 'admin' }]),
      { label: 'Đóng' },
    ],
  });
  if (r === 'reset') {
    if (!confirm(`Đặt lại mật khẩu cho ${u.email}? Họ sẽ bị đăng xuất khỏi mọi thiết bị.`)) return;
    try {
      const { temp_password } = await api(`/admin/users/${u.id}/reset`, { method: 'POST' });
      await showSecret({
        title: 'Mật khẩu tạm',
        intro: `Gửi mật khẩu này cho <b>${esc(u.name)}</b>. Khi đăng nhập bằng <b>${esc(u.email)}</b>, họ sẽ được yêu cầu đặt mật khẩu mới.`,
        secret: temp_password,
        shareText: `Mật khẩu tạm để đăng nhập Ví (https://vi.nhv.me) với email ${u.email}: ${temp_password}\nSau khi đăng nhập, bạn sẽ được yêu cầu đặt mật khẩu mới.`,
        doneLabel: 'Xong',
      });
    } catch (e) { toast(e.message); }
  }
  if (r === 'admin') {
    try { await api(`/admin/users/${u.id}/admin`, { method: 'POST', body: { is_admin: !u.is_admin } }); await loadAdminUsers(); toast('Đã cập nhật quyền'); }
    catch (e) { toast(e.message); }
  }
}

/* ---------- auth ---------- */
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $$('#authTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#authName').hidden = m !== 'register';
  $('#authSubmit').textContent = m === 'register' ? 'Tạo tài khoản' : 'Đăng nhập';
  $('#pw').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#pw').placeholder = m === 'register' ? 'Mật khẩu (ít nhất 6 ký tự)' : 'Mật khẩu';
  $('#loginErr').textContent = '';
}
function showLogin() {
  $('#login').hidden = false; $('#main').hidden = true; $('#tabbar').hidden = true;
  $('#joinHint').hidden = !LS.get('pendingJoin', null);
  setTimeout(() => $('#authEmail').focus(), 50);
}
function showApp() { $('#login').hidden = true; $('#main').hidden = false; $('#tabbar').hidden = false; render(); }
async function logout() {
  if (!confirm('Đăng xuất khỏi thiết bị này?')) return;
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  LS.clear(); location.replace('/');
}

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
  $('#activeCat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    if (b.dataset.clear === 'cat') state.listCat = null; else state.listPerson = null;
    renderList();
  });

  // report
  $('#reportMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.repMode = b.dataset.m; state.repAnchor = new Date(); renderReport(); });
  $$('[data-rep-nav]').forEach((b) => b.addEventListener('click', () => { shiftAnchor(+b.dataset.repNav); renderReport(); }));
  $('#donutType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.donutType = b.dataset.t; renderReport(); });
  $('#personType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.personType = b.dataset.t; renderReport(); });
  $('#personBreakdown').addEventListener('click', (e) => {
    const r = e.target.closest('[data-person]'); if (!r) return;
    const [from] = repRange();
    state.listPerson = r.dataset.person; state.listCat = null; state.listFilter = state.personType;
    state.listMonth = monthStart(state.repMode === 'year' ? new Date() : from);
    $$('#listFilter button').forEach((x) => x.classList.toggle('on', x.dataset.f === state.listFilter));
    go('list');
  });
  $('#catBreakdown').addEventListener('click', (e) => {
    const r = e.target.closest('[data-cat]'); if (!r) return;
    const [from] = repRange();
    state.listCat = r.dataset.cat; state.listPerson = null; state.listFilter = 'all'; state.listMonth = monthStart(state.repMode === 'year' ? new Date() : from);
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
  $('#personChips').addEventListener('click', (e) => {
    if (e.target.closest('[data-person-add]')) return quickAddPerson();
    const b = e.target.closest('[data-person]'); if (!b) return; haptic();
    form.person = form.person === b.dataset.person ? null : b.dataset.person;
    $$('#personChips [data-person]').forEach((x) => x.classList.toggle('on', x.dataset.person === form.person));
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
  $('#addPersonBtn').addEventListener('click', () => personDialog());
  $('#peopleManage').addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) personDialog(state.people.find((p) => p.id === b.dataset.pid)); });
  $('#swatches').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; editingCat.color = b.dataset.c; $$('#swatches button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#catCancel').addEventListener('click', closeCatDialog);
  $('#dlgBackdrop').addEventListener('click', closeCatDialog);
  $('#catSave').addEventListener('click', saveCat);
  $('#catDelete').addEventListener('click', deleteCat);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#exportJson').addEventListener('click', exportJson);
  $('#importJson').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
  $('#logoutBtn').addEventListener('click', logout);
  $('#forgotBtn').addEventListener('click', forgotPassword);
  $('#adminSearch').addEventListener('input', () => { clearTimeout(adminT); adminT = setTimeout(loadAdminUsers, 250); });
  $('#adminUsers').addEventListener('click', (e) => { const b = e.target.closest('[data-uid]'); if (b) openAdminUser(b.dataset.uid); });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-book-switch]')) { haptic(); openBookSwitcher(); } });
  $('#shareInvite').addEventListener('click', shareInvite);
  $('#regenInvite').addEventListener('click', async () => {
    if (!confirm('Tạo mã mời mới? Mã cũ sẽ không dùng được nữa.')) return;
    try { const r = await api(bp('/invite'), { method: 'POST' }); curBook().invite_code = r.invite_code; LS.set('books', state.books); renderSettings(); }
    catch (e) { toast(e.message); }
  });
  $('#memberList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const m = state.members.find((x) => x.id === b.dataset.rm);
    if (!confirm(`Xoá ${m?.name || 'thành viên'} khỏi sổ? Giao dịch họ đã nhập vẫn được giữ.`)) return;
    try { await api(bp('/members/' + b.dataset.rm), { method: 'DELETE' }); await refreshMe(); await loadAll(); render(); }
    catch (err) { toast(err.message); }
  });
  $('#renameBookBtn').addEventListener('click', async () => {
    const b = curBook();
    const ok = await modal({
      title: 'Đổi tên sổ',
      body: `<div class="dlg-row">${field('rbIcon', '', b.icon, 'text', 'maxlength="4" style="width:56px;flex:none;text-align:center;font-size:22px"')}${field('rbName', 'Tên sổ', b.name, 'text', 'maxlength="40"')}</div>`,
      actions: [{ label: 'Huỷ' }, { label: 'Lưu', cls: 'primary', run: async () => {
        const name = $('#rbName').value.trim(); if (!name) return false;
        await api(bp(''), { method: 'PUT', body: { name, icon: $('#rbIcon').value.trim() } });
        Object.assign(b, { name, icon: $('#rbIcon').value.trim() || b.icon });
      } }],
    });
    if (ok) { LS.set('books', state.books); render(); }
  });
  $('#leaveBookBtn').addEventListener('click', async () => {
    const b = curBook();
    if (!confirm(`Rời sổ "${b.name}"? Bạn sẽ không xem được sổ này nữa.`)) return;
    try {
      await api(bp('/members/' + state.user.id), { method: 'DELETE' });
      state.bookId = null; await refreshMe(); loadCache(); await loadAll(); render(); toast('Đã rời sổ');
    } catch (err) { toast(err.message); }
  });
  $('#deleteBookBtn').addEventListener('click', async () => {
    const b = curBook();
    const typed = prompt(`Xoá vĩnh viễn sổ "${b.name}" và toàn bộ giao dịch của nó?\nGõ tên sổ để xác nhận:`);
    if (typed == null) return;
    if (typed.trim() !== b.name) return toast('Tên sổ không khớp');
    try {
      await api(bp(''), { method: 'DELETE' });
      state.bookId = null; await refreshMe(); loadCache(); await loadAll(); render(); toast('Đã xoá sổ');
    } catch (err) { toast(err.message); }
  });
  $('#editNameBtn').addEventListener('click', async () => {
    const ok = await modal({
      title: 'Tên hiển thị', body: field('nmInput', 'Tên của bạn', state.user.name, 'text', 'maxlength="40"'),
      actions: [{ label: 'Huỷ' }, { label: 'Lưu', cls: 'primary', run: async () => {
        const r = await api('/me', { method: 'PUT', body: { name: $('#nmInput').value } }); state.user.name = r.name;
      } }],
    });
    if (ok) { LS.set('user', state.user); await loadAll().catch(() => {}); render(); }
  });
  $('#changePwBtn').addEventListener('click', () => modal({
    title: 'Đổi mật khẩu',
    body: field('pwCur', 'Mật khẩu hiện tại', '', 'password', 'autocomplete="current-password"') + field('pwNew', 'Mật khẩu mới (ít nhất 6 ký tự)', '', 'password', 'autocomplete="new-password"'),
    actions: [{ label: 'Huỷ' }, { label: 'Đổi', cls: 'primary', run: async () => {
      await api('/me/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
      toast('Đã đổi mật khẩu · các thiết bị khác đã bị đăng xuất');
    } }],
  }));

  // auth
  $('#authTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.mode); });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    const btn = $('#authSubmit'); btn.disabled = true;
    try {
      const body = { email: $('#authEmail').value, password: $('#pw').value, name: $('#authName').value };
      await api(authMode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body });
      $('#pw').value = '';
      LS.set('outbox', []); state.outbox = [];
      await boot();
    } catch (err) {
      $('#loginErr').textContent = err.status ? err.message : 'Không kết nối được máy chủ';
    } finally { btn.disabled = false; }
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
    await refreshMe();
    if (!state.bookId) throw new Error('no book');
    loadCache();
    await flush();
    await loadAll(); lastRefresh = Date.now();
    showApp();
    if (state.user.must_change_pw) await forceNewPassword();
    const code = LS.get('pendingJoin', null);
    if (code) { LS.set('pendingJoin', null); joinDialog(code); }
  } catch (e) {
    if (e.auth) return showLogin();
    if (state.user && state.bookId && state.cats.length) { showApp(); toast('Đang ngoại tuyến – dữ liệu sẽ đồng bộ sau'); }
    else showLogin();
  }
}

(() => {
  const q = new URLSearchParams(location.search);
  const code = q.get('join');
  if (code) { LS.set('pendingJoin', code.toUpperCase().slice(0, 8)); history.replaceState(null, '', '/'); }
})();
try { Object.keys(localStorage).filter((k) => k.startsWith('vi:')).forEach((k) => localStorage.removeItem(k)); } catch {}
bind();
updateSync();
if (state.user && state.bookId) { loadCache(); if (state.cats.length) showApp(); }
boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
