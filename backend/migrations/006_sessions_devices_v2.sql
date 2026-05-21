-- 006_sessions_devices_v2.sql
-- Adiciona tracking de IP/UA/geo nos devices + tabela sessions (kill-from-dashboard).
-- Idempotente: roda múltiplas vezes sem erro.

-- ---------- devices: novos campos ----------
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_ip       text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_ua       text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS first_ip      text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS country       text;   -- ISO2 (BR, US, …)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS region        text;   -- SP, CA, …
ALTER TABLE devices ADD COLUMN IF NOT EXISTS city          text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_name       text;   -- Windows, macOS
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hostname      text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_at    timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_by    uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE INDEX IF NOT EXISTS idx_dev_last_seen ON devices(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_dev_country   ON devices(country);

-- ---------- sessions: novo (pra kill granular) ----------
CREATE TABLE IF NOT EXISTS sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
    token_hash      text NOT NULL,                 -- sha256 do JWT pra revogação O(1)
    issued_at       timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_ip         text,
    last_ua         text,
    country         text,
    revoked         boolean NOT NULL DEFAULT false,
    revoked_at      timestamptz,
    revoked_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    revoke_reason   text
);
CREATE INDEX IF NOT EXISTS idx_sess_user      ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_token     ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sess_active    ON sessions(user_id, revoked) WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_sess_last_seen ON sessions(last_seen_at DESC);

-- ---------- oauth_accounts: vincula google/github ao user ----------
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        text NOT NULL,                 -- 'google' | 'github' | 'magic'
    provider_uid    text NOT NULL,                 -- google sub / github id
    email           text,
    name            text,
    avatar_url      text,
    linked_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

-- ---------- magic_links: passwordless ----------
CREATE TABLE IF NOT EXISTS magic_links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL,
    token_hash      text NOT NULL UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    consumed_at     timestamptz,
    request_ip      text,
    request_ua      text
);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_exp   ON magic_links(expires_at);

-- ---------- new_device_alerts: dedup pra não enviar email 2x ----------
CREATE TABLE IF NOT EXISTS new_device_alerts (
    id              bigserial PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

COMMIT;
