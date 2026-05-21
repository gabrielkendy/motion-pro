-- 007_user_blocking_lifetime.sql
-- Adiciona colunas usadas pelos endpoints admin de bloqueio + master accounts.
-- Idempotente: roda múltiplas vezes sem erro.

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at      timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by      uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_until  timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin        boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_blocked  ON users(blocked_at)    WHERE blocked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_admin    ON users(is_admin)      WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_users_lifetime ON users(lifetime_until) WHERE lifetime_until IS NOT NULL;
