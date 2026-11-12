-- Multi-user: accounts, sessions, books (personal & shared), membership
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- sha256(token)
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📒',
  owner_id TEXT NOT NULL,
  invite_code TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_members (
  book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON book_members(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Existing rows keep book_id NULL until the first account adopts them.
ALTER TABLE categories ADD COLUMN book_id TEXT;
ALTER TABLE transactions ADD COLUMN book_id TEXT;
ALTER TABLE transactions ADD COLUMN created_by TEXT;
CREATE INDEX IF NOT EXISTS idx_cat_book ON categories(book_id);
CREATE INDEX IF NOT EXISTS idx_tx_book_date ON transactions(book_id, date);
