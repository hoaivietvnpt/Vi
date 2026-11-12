-- Recovery codes removed: drop stored hashes
UPDATE users SET recovery_hash = NULL;

-- People an expense is for ("Chi cho") or an income comes from ("Thu từ")
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_people_book ON people(book_id);
ALTER TABLE transactions ADD COLUMN person_id TEXT;

-- Default people for every existing book
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Bố', '👨', 1 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Mẹ', '👩', 2 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Vợ/Chồng', '💞', 3 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Con', '👶', 4 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Anh', '🧔', 5 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Chị', '👩‍🦰', 6 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Em', '🧒', 7 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Ông bà', '👴', 8 FROM books;
INSERT INTO people (id, book_id, name, icon, sort) SELECT lower(hex(randomblob(16))), id, 'Bạn bè', '🤝', 9 FROM books;
