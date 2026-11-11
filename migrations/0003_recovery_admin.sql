-- Recovery codes (self-service password reset) and admin role
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0;
-- The first account becomes admin
UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);
