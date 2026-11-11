// Ví — API Worker (Cloudflare Workers + D1), multi-user with personal & shared books
import { serveStatic } from './static.js';

const COOKIE = 'vi_sid';
const SESSION_DAYS = 365;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();

const DEFAULT_CATS = [
  ['Ăn uống', '🍜', '#F97316', 'expense'],
  ['Cà phê', '☕', '#A16207', 'expense'],
  ['Di chuyển', '🛵', '#0EA5E9', 'expense'],
  ['Mua sắm', '🛍️', '#EC4899', 'expense'],
  ['Hoá đơn', '🧾', '#6366F1', 'expense'],
  ['Nhà cửa', '🏠', '#14B8A6', 'expense'],
  ['Sức khoẻ', '💊', '#EF4444', 'expense'],
  ['Giải trí', '🎬', '#8B5CF6', 'expense'],
  ['Giáo dục', '📚', '#2563EB', 'expense'],
  ['Gia đình', '👨‍👩‍👧', '#F59E0B', 'expense'],
  ['Quà tặng', '🎁', '#DB2777', 'expense'],
  ['Khác', '📦', '#64748B', 'expense'],
  ['Lương', '💼', '#16A34A', 'income'],
  ['Thưởng', '🏆', '#22C55E', 'income'],
  ['Kinh doanh', '📈', '#0D9488', 'income'],
  ['Đầu tư', '💹', '#059669', 'income'],
  ['Được cho', '🧧', '#E11D48', 'income'],
  ['Khác', '💰', '#65A30D', 'income'],
];

/* ---------------- helpers ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);
const now = () => Date.now();
const uuid = () => crypto.randomUUID();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${await pbkdf2(pw, salt, PBKDF2_ITER)}`;
}
async function verifyPassword(pw, stored) {
  const [alg, iter, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  return safeEqual(await pbkdf2(pw, fromB64url(salt), Number(iter)), hash);
}
const inviteCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => a[b % a.length]).join('');
};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 16 chars ≈ 80 bits, shown as XXXX-XXXX-XXXX-XXXX
const recoveryCode = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => CODE_ALPHABET[b % 32]).join('').match(/.{4}/g).join('-');
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecovery = (code) => sha256('recovery:' + normCode(code));
const tempPassword = () => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => a[b % a.length]).join('');
};
const cookie = (val, maxAge) => `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES = new Set(['expense', 'income']);
const cleanName = (s, max = 40) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);

function validateTx(b) {
  const amount = Math.round(Number(b.amount));
  if (!TYPES.has(b.type)) return 'Loại giao dịch không hợp lệ';
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e13) return 'Số tiền không hợp lệ';
  if (!b.category_id || typeof b.category_id !== 'string') return 'Thiếu danh mục';
  if (!DATE_RE.test(b.date || '')) return 'Ngày không hợp lệ';
  return null;
}

/* ---------------- sessions & rate limit ---------------- */
async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 864e5, now()).run();
  return cookie(token, SESSION_DAYS * 86400);
}
async function currentUser(req, env) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const sid = await sha256(m[1]);
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.is_admin, u.must_change_pw, (u.recovery_hash IS NOT NULL) AS has_recovery, s.id AS sid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(sid, now()).first();
  return row || null;
}
async function rateLimited(env, key, max = 8, windowMs = 15 * 60e3) {
  const row = await env.DB.prepare('SELECT count, reset_at FROM login_attempts WHERE key=?').bind(key).first();
  return row && row.reset_at > now() && row.count >= max;
}
async function recordFailure(env, key, windowMs = 15 * 60e3) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (key,count,reset_at) VALUES (?,1,?)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END`
  ).bind(key, now() + windowMs, now(), now()).run();
}

/* ---------------- books ---------------- */
function seedCategories(env, bookId) {
  const sortByType = { expense: 0, income: 0 };
  return DEFAULT_CATS.map(([name, icon, color, type]) =>
    env.DB.prepare('INSERT INTO categories (id,name,icon,color,type,sort,book_id) VALUES (?,?,?,?,?,?,?)')
      .bind(uuid(), name, icon, color, type, ++sortByType[type], bookId)
  );
}
async function createBook(env, userId, name, icon, { seed = true } = {}) {
  const id = uuid();
  const stmts = [
    env.DB.prepare('INSERT INTO books (id,name,icon,owner_id,invite_code,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, name, icon || '📒', userId, inviteCode(), now()),
    env.DB.prepare('INSERT INTO book_members (book_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(id, userId, 'owner', now()),
  ];
  if (seed) stmts.push(...seedCategories(env, id));
  await env.DB.batch(stmts);
  return id;
}
async function listBooks(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.name, b.icon, b.owner_id, m.role,
       CASE WHEN m.role = 'owner' THEN b.invite_code END AS invite_code,
       (SELECT COUNT(*) FROM book_members x WHERE x.book_id = b.id) AS members
     FROM book_members m JOIN books b ON b.id = m.book_id
     WHERE m.user_id = ? ORDER BY m.joined_at`
  ).bind(userId).all();
  return results;
}
const membership = (env, bookId, userId) =>
  env.DB.prepare('SELECT role FROM book_members WHERE book_id=? AND user_id=?').bind(bookId, userId).first();

/* ---------------- routes: auth ---------------- */
async function authRoutes(req, env, path) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';

  if (path === '/auth/register' && req.method === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const name = cleanName(b.name) || email.split('@')[0];
    const pw = String(b.password || '');
    if (!EMAIL_RE.test(email) || email.length > 120) return bad('Email không hợp lệ');
    if (pw.length < 6 || pw.length > 200) return bad('Mật khẩu cần ít nhất 6 ký tự');
    if (await rateLimited(env, 'reg:' + ip, 10, 60 * 60e3)) return bad('Thử lại sau ít phút', 429);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) return bad('Email này đã được đăng ký', 409);
    await recordFailure(env, 'reg:' + ip, 60 * 60e3); // counts registrations per IP

    const userId = uuid();
    const code = recoveryCode();
    const { n: before } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    await env.DB.prepare('INSERT INTO users (id,email,name,pw_hash,created_at,recovery_hash,is_admin) VALUES (?,?,?,?,?,?,?)')
      .bind(userId, email, name, await hashPassword(pw), now(), await hashRecovery(code), before === 0 ? 1 : 0).run();

    // First account adopts any data created before multi-user existed.
    const n = before + 1;
    const legacy = n === 1 && (await env.DB.prepare('SELECT 1 FROM categories WHERE book_id IS NULL LIMIT 1').first());
    const bookId = await createBook(env, userId, 'Sổ cá nhân', '📒', { seed: !legacy });
    if (legacy) {
      await env.DB.batch([
        env.DB.prepare('UPDATE categories SET book_id=? WHERE book_id IS NULL').bind(bookId),
        env.DB.prepare('UPDATE transactions SET book_id=?, created_by=? WHERE book_id IS NULL').bind(bookId, userId),
      ]);
    }
    return json({ ok: true, recovery_code: code }, 201, { 'set-cookie': await createSession(env, userId) });
  }

  if (path === '/auth/login' && req.method === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const key = 'login:' + email + ':' + ip;
    if (await rateLimited(env, key)) return bad('Sai quá nhiều lần, thử lại sau 15 phút', 429);
    const user = await env.DB.prepare('SELECT id, pw_hash FROM users WHERE email=?').bind(email).first();
    const ok = user ? await verifyPassword(String(b.password || ''), user.pw_hash) : (await hashPassword('x'), false);
    if (!ok) {
      await recordFailure(env, key);
      return bad('Email hoặc mật khẩu không đúng', 401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(key).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND expires_at < ?').bind(user.id, now()).run();
    return json({ ok: true }, 200, { 'set-cookie': await createSession(env, user.id) });
  }

  if (path === '/auth/recover' && req.method === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const key = 'recover:' + ip;
    if (await rateLimited(env, key, 6, 60 * 60e3)) return bad('Thử sai quá nhiều lần, hãy thử lại sau 1 giờ', 429);
    const pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 200) return bad('Mật khẩu mới cần ít nhất 6 ký tự');
    const user = await env.DB.prepare('SELECT id, recovery_hash FROM users WHERE email=?').bind(email).first();
    const ok = user?.recovery_hash && safeEqual(await hashRecovery(b.code), user.recovery_hash);
    if (!ok) {
      await recordFailure(env, key, 60 * 60e3);
      return bad('Email hoặc mã khôi phục không đúng', 401);
    }
    const code = recoveryCode(); // the used code is replaced
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash=?, recovery_hash=?, must_change_pw=0 WHERE id=?').bind(await hashPassword(pw), await hashRecovery(code), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
    ]);
    return json({ ok: true, recovery_code: code }, 200, { 'set-cookie': await createSession(env, user.id) });
  }

  if (path === '/auth/logout' && req.method === 'POST') {
    const u = await currentUser(req, env);
    if (u) await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(u.sid).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }
  return null;
}

/* ---------------- routes: account & books ---------------- */
async function accountRoutes(req, env, path, user) {
  const method = req.method;

  if (path === '/me' && method === 'GET') {
    return json({
      user: { id: user.id, email: user.email, name: user.name, is_admin: !!user.is_admin, must_change_pw: !!user.must_change_pw, has_recovery: !!user.has_recovery },
      books: await listBooks(env, user.id),
    });
  }
  if (path === '/me' && method === 'PUT') {
    const name = cleanName((await readJson(req)).name);
    if (!name) return bad('Tên không hợp lệ');
    await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name, user.id).run();
    return json({ ok: true, name });
  }
  if (path === '/me/password' && method === 'POST') {
    const b = await readJson(req);
    const row = await env.DB.prepare('SELECT pw_hash FROM users WHERE id=?').bind(user.id).first();
    if (!user.must_change_pw && !(await verifyPassword(String(b.current || ''), row.pw_hash))) return bad('Mật khẩu hiện tại không đúng', 403);
    const next = String(b.next || '');
    if (next.length < 6 || next.length > 200) return bad('Mật khẩu mới cần ít nhất 6 ký tự');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash=?, must_change_pw=0 WHERE id=?').bind(await hashPassword(next), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').bind(user.id, user.sid),
    ]);
    return json({ ok: true });
  }

  if (path === '/me/recovery' && method === 'POST') {
    const b = await readJson(req);
    const row = await env.DB.prepare('SELECT pw_hash FROM users WHERE id=?').bind(user.id).first();
    if (!(await verifyPassword(String(b.password || ''), row.pw_hash))) return bad('Mật khẩu không đúng', 403);
    const code = recoveryCode();
    await env.DB.prepare('UPDATE users SET recovery_hash=? WHERE id=?').bind(await hashRecovery(code), user.id).run();
    return json({ recovery_code: code });
  }

  // ---- admin ----
  if (path.startsWith('/admin/')) {
    if (!user.is_admin) return bad('Chỉ quản trị viên', 403);
    if (path === '/admin/users' && method === 'GET') {
      const q = '%' + (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase() + '%';
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.created_at, u.is_admin, (u.recovery_hash IS NOT NULL) AS has_recovery,
           (SELECT COUNT(*) FROM book_members m WHERE m.user_id = u.id) AS books,
           (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login
         FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ? ORDER BY u.created_at DESC LIMIT 200`
      ).bind(q, q).all();
      return json(results);
    }
    let am = path.match(/^\/admin\/users\/([\w-]+)\/reset$/);
    if (am && method === 'POST') {
      const target = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(am[1]).first();
      if (!target) return bad('Không tìm thấy', 404);
      const temp = tempPassword();
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET pw_hash=?, must_change_pw=1 WHERE id=?').bind(await hashPassword(temp), target.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').bind(target.id, user.sid),
      ]);
      return json({ temp_password: temp });
    }
    am = path.match(/^\/admin\/users\/([\w-]+)\/admin$/);
    if (am && method === 'POST') {
      const make = !!(await readJson(req)).is_admin;
      if (!make && am[1] === user.id) return bad('Không thể tự bỏ quyền quản trị của mình');
      await env.DB.prepare('UPDATE users SET is_admin=? WHERE id=?').bind(make ? 1 : 0, am[1]).run();
      return json({ ok: true });
    }
    return bad('Not found', 404);
  }

  if (path === '/books' && method === 'POST') {
    const b = await readJson(req);
    const name = cleanName(b.name);
    if (!name) return bad('Tên sổ không hợp lệ');
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_members WHERE user_id=?').bind(user.id).first();
    if (n >= 20) return bad('Tối đa 20 sổ');
    const id = await createBook(env, user.id, name, String(b.icon || '📒').slice(0, 8));
    return json((await listBooks(env, user.id)).find((x) => x.id === id), 201);
  }
  if (path === '/books/join' && method === 'POST') {
    const code = String((await readJson(req)).code || '').trim().toUpperCase();
    if (await rateLimited(env, 'join:' + user.id, 10)) return bad('Thử lại sau ít phút', 429);
    const book = code && (await env.DB.prepare('SELECT id FROM books WHERE invite_code=?').bind(code).first());
    if (!book) {
      await recordFailure(env, 'join:' + user.id);
      return bad('Mã mời không đúng hoặc đã hết hạn', 404);
    }
    await env.DB.prepare('INSERT OR IGNORE INTO book_members (book_id,user_id,role,joined_at) VALUES (?,?,?,?)')
      .bind(book.id, user.id, 'member', now()).run();
    return json((await listBooks(env, user.id)).find((x) => x.id === book.id));
  }
  return null;
}

/* ---------------- routes: inside a book ---------------- */
async function bookRoutes(req, env, url, bookId, sub, user, role) {
  const method = req.method;
  const DB = env.DB;
  const isOwner = role === 'owner';

  // --- book itself ---
  if (sub === '' && method === 'PUT') {
    if (!isOwner) return bad('Chỉ chủ sổ mới sửa được', 403);
    const b = await readJson(req);
    const name = cleanName(b.name);
    if (!name) return bad('Tên sổ không hợp lệ');
    await DB.prepare('UPDATE books SET name=?, icon=COALESCE(?,icon) WHERE id=?').bind(name, b.icon ? String(b.icon).slice(0, 8) : null, bookId).run();
    return json({ ok: true });
  }
  if (sub === '' && method === 'DELETE') {
    if (!isOwner) return bad('Chỉ chủ sổ mới xoá được', 403);
    const { n } = await DB.prepare('SELECT COUNT(*) AS n FROM book_members WHERE user_id=?').bind(user.id).first();
    if (n <= 1) return bad('Bạn cần giữ lại ít nhất một sổ');
    await DB.batch([
      DB.prepare('DELETE FROM transactions WHERE book_id=?').bind(bookId),
      DB.prepare('DELETE FROM categories WHERE book_id=?').bind(bookId),
      DB.prepare('DELETE FROM book_members WHERE book_id=?').bind(bookId),
      DB.prepare('DELETE FROM books WHERE id=?').bind(bookId),
    ]);
    return json({ ok: true });
  }
  if (sub === '/invite' && method === 'POST') {
    if (!isOwner) return bad('Chỉ chủ sổ mới tạo được mã mời', 403);
    const code = inviteCode();
    await DB.prepare('UPDATE books SET invite_code=? WHERE id=?').bind(code, bookId).run();
    return json({ invite_code: code });
  }
  if (sub === '/members' && method === 'GET') {
    const { results } = await DB.prepare(
      `SELECT u.id, u.name, ${isOwner ? 'u.email' : "'' AS email"}, m.role FROM book_members m JOIN users u ON u.id = m.user_id WHERE m.book_id=? ORDER BY m.joined_at`
    ).bind(bookId).all();
    return json(results);
  }
  let m = sub.match(/^\/members\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    const target = m[1];
    if (target !== user.id && !isOwner) return bad('Không có quyền', 403);
    if (target === user.id && isOwner) return bad('Chủ sổ không thể rời sổ — hãy xoá sổ');
    const { n } = await DB.prepare('SELECT COUNT(*) AS n FROM book_members WHERE user_id=?').bind(target).first();
    if (target === user.id && n <= 1) return bad('Bạn cần giữ lại ít nhất một sổ');
    await DB.prepare("DELETE FROM book_members WHERE book_id=? AND user_id=? AND role<>'owner'").bind(bookId, target).run();
    return json({ ok: true });
  }

  // --- categories ---
  if (sub === '/categories' && method === 'GET') {
    const { results } = await DB.prepare('SELECT * FROM categories WHERE book_id=? ORDER BY type, sort, name').bind(bookId).all();
    return json(results);
  }
  if (sub === '/categories' && method === 'POST') {
    const b = await readJson(req);
    const name = cleanName(b.name);
    if (!TYPES.has(b.type) || !name) return bad('Danh mục không hợp lệ');
    const id = uuid();
    const { max } = await DB.prepare('SELECT COALESCE(MAX(sort),0) AS max FROM categories WHERE book_id=? AND type=?').bind(bookId, b.type).first();
    await DB.prepare('INSERT INTO categories (id,name,icon,color,type,sort,book_id) VALUES (?,?,?,?,?,?,?)')
      .bind(id, name, String(b.icon || '🏷️').slice(0, 8), /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#64748B', b.type, max + 1, bookId).run();
    return json(await DB.prepare('SELECT * FROM categories WHERE id=?').bind(id).first(), 201);
  }
  m = sub.match(/^\/categories\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readJson(req);
    await DB.prepare('UPDATE categories SET name=COALESCE(?,name), icon=COALESCE(?,icon), color=COALESCE(?,color), archived=COALESCE(?,archived) WHERE id=? AND book_id=?')
      .bind(cleanName(b.name) || null, b.icon ? String(b.icon).slice(0, 8) : null, /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : null,
        b.archived == null ? null : b.archived ? 1 : 0, m[1], bookId).run();
    const row = await DB.prepare('SELECT * FROM categories WHERE id=? AND book_id=?').bind(m[1], bookId).first();
    return row ? json(row) : bad('Không tìm thấy', 404);
  }
  if (m && method === 'DELETE') {
    const used = await DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id=? AND book_id=?').bind(m[1], bookId).first();
    if (used.n > 0) await DB.prepare('UPDATE categories SET archived=1 WHERE id=? AND book_id=?').bind(m[1], bookId).run();
    else await DB.prepare('DELETE FROM categories WHERE id=? AND book_id=?').bind(m[1], bookId).run();
    return json({ ok: true, archived: used.n > 0 });
  }

  // --- transactions ---
  if (sub === '/transactions' && method === 'GET') {
    const from = url.searchParams.get('from') || '0000-01-01';
    const to = url.searchParams.get('to') || '9999-12-31';
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return bad('Khoảng ngày không hợp lệ');
    const { results } = await DB.prepare(
      'SELECT id,type,amount,category_id,note,date,created_at,updated_at,created_by FROM transactions WHERE book_id=? AND date BETWEEN ? AND ? ORDER BY date DESC, created_at DESC LIMIT 50000'
    ).bind(bookId, from, to).all();
    return json(results);
  }
  if (sub === '/transactions' && method === 'POST') {
    const b = await readJson(req);
    const err = validateTx(b);
    if (err) return bad(err);
    const id = typeof b.id === 'string' && /^[\w-]{8,64}$/.test(b.id) ? b.id : uuid();
    const t = now();
    await DB.prepare(
      'INSERT INTO transactions (id,type,amount,category_id,note,date,created_at,updated_at,book_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING'
    ).bind(id, b.type, Math.round(b.amount), b.category_id, String(b.note || '').slice(0, 200), b.date, t, t, bookId, user.id).run();
    const row = await DB.prepare('SELECT * FROM transactions WHERE id=? AND book_id=?').bind(id, bookId).first();
    return row ? json(row, 201) : bad('Trùng mã giao dịch', 409);
  }
  m = sub.match(/^\/transactions\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readJson(req);
    const err = validateTx(b);
    if (err) return bad(err);
    await DB.prepare('UPDATE transactions SET type=?, amount=?, category_id=?, note=?, date=?, updated_at=? WHERE id=? AND book_id=?')
      .bind(b.type, Math.round(b.amount), b.category_id, String(b.note || '').slice(0, 200), b.date, now(), m[1], bookId).run();
    const row = await DB.prepare('SELECT * FROM transactions WHERE id=? AND book_id=?').bind(m[1], bookId).first();
    return row ? json(row) : bad('Không tìm thấy', 404);
  }
  if (m && method === 'DELETE') {
    await DB.prepare('DELETE FROM transactions WHERE id=? AND book_id=?').bind(m[1], bookId).run();
    return json({ ok: true });
  }

  // --- import backup: categories matched by name+type, created if missing ---
  if (sub === '/import' && method === 'POST') {
    const b = await readJson(req);
    const rows = Array.isArray(b.transactions) ? b.transactions.slice(0, 20000) : [];
    const srcCats = new Map((Array.isArray(b.categories) ? b.categories : []).map((c) => [c.id, c]));
    const { results: mine } = await DB.prepare('SELECT id,name,type FROM categories WHERE book_id=?').bind(bookId).all();
    const mineIds = new Set(mine.map((c) => c.id));
    const byKey = new Map(mine.map((c) => [c.type + '|' + c.name.toLowerCase(), c.id]));
    const catMap = new Map();
    const stmts = [];
    const resolveCat = (srcId, type) => {
      if (mineIds.has(srcId)) return srcId;
      if (catMap.has(srcId)) return catMap.get(srcId);
      const src = srcCats.get(srcId);
      const name = cleanName(src?.name) || 'Khác';
      const key = type + '|' + name.toLowerCase();
      let id = byKey.get(key);
      if (!id) {
        id = uuid();
        byKey.set(key, id);
        stmts.push(DB.prepare('INSERT INTO categories (id,name,icon,color,type,sort,book_id) VALUES (?,?,?,?,?,?,?)')
          .bind(id, name, String(src?.icon || '🏷️').slice(0, 8), /^#[0-9a-f]{6}$/i.test(src?.color) ? src.color : '#64748B', type, 99, bookId));
      }
      catMap.set(srcId, id);
      return id;
    };
    let count = 0;
    const t = now();
    for (const r of rows) {
      if (validateTx(r)) continue;
      const cat = resolveCat(r.category_id, r.type);
      const id = typeof r.id === 'string' && /^[\w-]{8,64}$/.test(r.id) ? r.id : uuid();
      stmts.push(DB.prepare(
        'INSERT OR IGNORE INTO transactions (id,type,amount,category_id,note,date,created_at,updated_at,book_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).bind(id, r.type, Math.round(r.amount), cat, String(r.note || '').slice(0, 200), r.date, Number(r.created_at) || t, t, bookId, user.id));
      count++;
    }
    for (let i = 0; i < stmts.length; i += 100) await DB.batch(stmts.slice(i, i + 100));
    return json({ ok: true, imported: count });
  }

  return bad('Not found', 404);
}

/* ---------------- router ---------------- */
async function api(req, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const a = await authRoutes(req, env, path);
  if (a) return a;

  const user = await currentUser(req, env);
  if (!user) return bad('Chưa đăng nhập', 401);

  const r = await accountRoutes(req, env, path, user);
  if (r) return r;

  const m = path.match(/^\/books\/([\w-]+)(\/.*)?$/);
  if (m) {
    const mem = await membership(env, m[1], user.id);
    if (!mem) return bad('Không có quyền truy cập sổ này', 403);
    return bookRoutes(req, env, url, m[1], m[2] || '', user, mem.role);
  }
  return bad('Not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // CSRF guard: state-changing requests must come from our own origin
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) return bad('Forbidden', 403);
      }
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
