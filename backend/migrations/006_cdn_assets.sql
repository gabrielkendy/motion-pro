-- 006_cdn_assets.sql
-- Hardening prep: add fields for CDN-served assets with integrity check.

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS sha256       text,
    ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'mogrt',  -- 'mogrt' | 'preview' | 'thumb'
    ADD COLUMN IF NOT EXISTS published    boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- product gating: which product (motionpro / legendas) the asset belongs to
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS product_id   text NOT NULL DEFAULT 'motionpro';

CREATE INDEX IF NOT EXISTS idx_assets_product   ON assets(product_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind      ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_published ON assets(published);

-- audit table: who downloaded what, when, from where
CREATE TABLE IF NOT EXISTS asset_download_log (
    id              bigserial PRIMARY KEY,
    user_id         text REFERENCES users(id) ON DELETE SET NULL,
    asset_id        text REFERENCES assets(id) ON DELETE SET NULL,
    fingerprint     text,
    ip              text,
    ua              text,
    ts              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_download_log_user ON asset_download_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_download_log_asset ON asset_download_log(asset_id, ts DESC);
