-- 010_usage_oauth.sql
-- Sistema de créditos por uso + OAuth tokens (Google etc)
-- Idempotente.

-- Créditos por user/license_key
CREATE TABLE IF NOT EXISTS user_credits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
    license_key_id  uuid REFERENCES license_keys(id) ON DELETE CASCADE,
    credits         int NOT NULL DEFAULT 0,
    reset_at        timestamptz,                   -- pra planos com refresh mensal
    last_deduct_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_or_key CHECK (user_id IS NOT NULL OR license_key_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credits_key  ON user_credits(license_key_id);

-- Log de uso
CREATE TABLE IF NOT EXISTS usage_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    license_key_id  uuid REFERENCES license_keys(id) ON DELETE SET NULL,
    feature         text NOT NULL,                  -- ex: "caca-trechos"
    credits_used    int  NOT NULL DEFAULT 1,
    success         boolean NOT NULL DEFAULT true,
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user    ON usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_feature ON usage_log(feature);

-- OAuth tokens (Google etc)
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        text NOT NULL,                  -- 'google'
    provider_user_id text NOT NULL,
    email           text,
    name            text,
    avatar_url      text,
    access_token    text,                           -- encrypted
    refresh_token   text,                           -- encrypted
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_tokens(user_id);
