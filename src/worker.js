// Ví — API Worker (Cloudflare Workers + D1)
import { serveStatic } from './static.js';
const COOKIE = 'vi_session';
const SESSION_DAYS = 365;
const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const secretOf = (env) => (env.SESSION_SECRET || '') + '|' + (env.APP_PASSWORD || '');

async function makeToken(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${await hmac(secretOf(env), String(exp))}`;
}

async function isAuthed(req, env) {
  if (!env.APP_PASSWORD) return true; // no password configured → open
  const m = (req.headers.get('cookie') || '').match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secretOf(env), exp));
}

const cookie = (val, maxAge) =>
  `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(['expense', 'income']);

function validateTx(b) {
  const amount = Math.round(Number(b.amount));
  if (!TYPES.has(b.type)) return 'Loại giao dịch không hợp lệ';
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e13) return 'Số tiền không hợp lệ';
  if (!b.category_id || typeof b.category_id !== 'string') return 'Thiếu danh mục';
  if (!DATE_RE.test(b.date || '')) return 'Ngày không hợp lệ';
  return null;
}

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

async function api(req, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  if (path === '/login' && method === 'POST') {
    const { password } = await readJson(req);
    if (!env.APP_PASSWORD) return json({ ok: true });
    if (typeof password !== 'string' || !safeEqual(await hmac('pw', password), await hmac('pw', env.APP_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 600));
      return bad('Sai mật khẩu', 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie(await makeToken(env), SESSION_DAYS * 86400) });
  }
  if (path === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }

  if (!(await isAuthed(req, env))) return bad('Chưa đăng nhập', 401);

  if (path === '/me') return json({ ok: true, protected: !!env.APP_PASSWORD });

  // ---------- Categories ----------
  if (path === '/categories' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY type, sort, name').all();
    return json(results);
  }
  if (path === '/categories' && method === 'POST') {
    const b = await readJson(req);
    if (!TYPES.has(b.type) || !b.name?.trim()) return bad('Danh mục không hợp lệ');
    const id = crypto.randomUUID();
    const { max } = (await env.DB.prepare('SELECT COALESCE(MAX(sort),0) AS max FROM categories WHERE type=?').bind(b.type).first()) || { max: 0 };
    await env.DB.prepare('INSERT INTO categories (id,name,icon,color,type,sort) VALUES (?,?,?,?,?,?)')
      .bind(id, b.name.trim().slice(0, 40), (b.icon || '🏷️').slice(0, 8), b.color || '#64748B', b.type, max + 1).run();
    return json(await env.DB.prepare('SELECT * FROM categories WHERE id=?').bind(id).first(), 201);
  }
  let m = path.match(/^\/categories\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readJson(req);
    await env.DB.prepare('UPDATE categories SET name=COALESCE(?,name), icon=COALESCE(?,icon), color=COALESCE(?,color), archived=COALESCE(?,archived) WHERE id=?')
      .bind(b.name?.trim()?.slice(0, 40) ?? null, b.icon ?? null, b.color ?? null, b.archived == null ? null : b.archived ? 1 : 0, m[1]).run();
    return json(await env.DB.prepare('SELECT * FROM categories WHERE id=?').bind(m[1]).first());
  }
  if (m && method === 'DELETE') {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id=?').bind(m[1]).first();
    if (used.n > 0) await env.DB.prepare('UPDATE categories SET archived=1 WHERE id=?').bind(m[1]).run();
    else await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(m[1]).run();
    return json({ ok: true, archived: used.n > 0 });
  }

  // ---------- Transactions ----------
  if (path === '/transactions' && method === 'GET') {
    const from = url.searchParams.get('from') || '0000-01-01';
    const to = url.searchParams.get('to') || '9999-12-31';
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return bad('Khoảng ngày không hợp lệ');
    const { results } = await env.DB.prepare(
      'SELECT * FROM transactions WHERE date BETWEEN ? AND ? ORDER BY date DESC, created_at DESC LIMIT 20000'
    ).bind(from, to).all();
    return json(results);
  }
  if (path === '/transactions' && method === 'POST') {
    const b = await readJson(req);
    const err = validateTx(b);
    if (err) return bad(err);
    const now = Date.now();
    const id = typeof b.id === 'string' && /^[\w-]{8,64}$/.test(b.id) ? b.id : crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO transactions (id,type,amount,category_id,note,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING'
    ).bind(id, b.type, Math.round(b.amount), b.category_id, String(b.note || '').slice(0, 200), b.date, now, now).run();
    return json(await env.DB.prepare('SELECT * FROM transactions WHERE id=?').bind(id).first(), 201);
  }
  m = path.match(/^\/transactions\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readJson(req);
    const err = validateTx(b);
    if (err) return bad(err);
    await env.DB.prepare('UPDATE transactions SET type=?, amount=?, category_id=?, note=?, date=?, updated_at=? WHERE id=?')
      .bind(b.type, Math.round(b.amount), b.category_id, String(b.note || '').slice(0, 200), b.date, Date.now(), m[1]).run();
    const row = await env.DB.prepare('SELECT * FROM transactions WHERE id=?').bind(m[1]).first();
    return row ? json(row) : bad('Không tìm thấy', 404);
  }
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM transactions WHERE id=?').bind(m[1]).run();
    return json({ ok: true });
  }

  // ---------- Import (bulk) ----------
  if (path === '/import' && method === 'POST') {
    const b = await readJson(req);
    const rows = Array.isArray(b.transactions) ? b.transactions : [];
    const now = Date.now();
    const stmts = [];
    for (const t of rows.slice(0, 5000)) {
      if (validateTx(t)) continue;
      stmts.push(env.DB.prepare(
        'INSERT OR IGNORE INTO transactions (id,type,amount,category_id,note,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(t.id || crypto.randomUUID(), t.type, Math.round(t.amount), t.category_id, String(t.note || '').slice(0, 200), t.date, t.created_at || now, now));
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    return json({ ok: true, imported: stmts.length });
  }

  return bad('Not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, url);
      } catch (e) {
        console.error(e);
        return bad('Lỗi máy chủ', 500);
      }
    }
    return serveStatic(url, req);
  },
};
