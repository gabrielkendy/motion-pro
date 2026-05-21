-- 009_license_keys.sql
-- License key system (estilo Phantom Editor):
--   - Keys são geradas pelo admin (Gumroad-style)
--   - User cola key no plugin → ativa device → libera features por tier
--   - Multi-device por seat (max_devices controla)
--   - Deactivate libera seat pra outro device
-- Idempotente.

CREATE TABLE IF NOT EXISTS license_keys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash      text UNIQUE NOT NULL,             -- bcrypt da key (nunca armazenar plaintext)
    key_prefix    text NOT NULL,                    -- 'MIA-PRO-A1B2…' (8 primeiros pra mask UI)
    tier          text NOT NULL,                    -- 'free' | 'basic' | 'pro' | 'lifetime'
    products      text[] NOT NULL DEFAULT '{}',     -- ['motionpro','ia','legendas','bundle_all']
    max_devices   int NOT NULL DEFAULT 3,
    expires_at    timestamptz,                      -- null = lifetime
    revoked_at    timestamptz,
    revoke_reason text,
    notes         text,                             -- "Gumroad order #12345"
    customer_email text,                            -- opcional, pra suporte
    issued_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lk_prefix ON license_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_lk_tier ON license_keys(tier);
CREATE INDEX IF NOT EXISTS idx_lk_revoked ON license_keys(revoked_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS license_key_activations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key_id     uuid NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
    device_fingerprint text NOT NULL,
    device_name        text,
    device_os          text,
    ip_address         text,
    activated_at       timestamptz NOT NULL DEFAULT now(),
    deactivated_at     timestamptz,
    last_validation_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (license_key_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_lka_key ON license_key_activations(license_key_id);
CREATE INDEX IF NOT EXISTS idx_lka_active ON license_key_activations(deactivated_at) WHERE deactivated_at IS NULL;

-- Helper view: keys com contagem de devices ativos
CREATE OR REPLACE VIEW license_keys_with_usage AS
SELECT
    lk.*,
    COALESCE((SELECT COUNT(*) FROM license_key_activations
              WHERE license_key_id = lk.id AND deactivated_at IS NULL), 0) AS active_devices,
    COALESCE((SELECT COUNT(*) FROM license_key_activations
              WHERE license_key_id = lk.id), 0) AS total_activations
FROM license_keys lk;
