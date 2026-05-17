-- MotionVault initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text UNIQUE NOT NULL,
    password_hash   text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    stripe_customer text,
    is_admin        boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan            text NOT NULL,             -- 'monthly','yearly','lifetime','pro_all'
    status          text NOT NULL,             -- 'active','past_due','canceled','trialing'
    stripe_sub_id   text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    current_period_end timestamptz,
    cancel_at       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint     text NOT NULL,
    label           text,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_seen       timestamptz NOT NULL DEFAULT now(),
    revoked         boolean NOT NULL DEFAULT false,
    UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_dev_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS license_audit (
    id              bigserial PRIMARY KEY,
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    device_id       uuid REFERENCES devices(id) ON DELETE SET NULL,
    action          text NOT NULL,             -- 'issue','heartbeat','revoke','tamper'
    detail          jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version         text NOT NULL,
    content         jsonb NOT NULL,
    published_at    timestamptz NOT NULL DEFAULT now(),
    is_active       boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS assets (
    id              text PRIMARY KEY,           -- stable id from catalog
    pack_id         text NOT NULL,
    name            text NOT NULL,
    cdn_key         text NOT NULL,              -- path on CDN/S3
    size_bytes      bigint,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_pack ON assets(pack_id);
