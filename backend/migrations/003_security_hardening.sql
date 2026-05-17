-- Idempotência do webhook Stripe (previne processar mesmo evento 2x)
CREATE TABLE IF NOT EXISTS stripe_events_seen (
    event_id    TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_seen_at ON stripe_events_seen(seen_at DESC);

-- Optional: tabela de session revocation pra invalidar JWTs antes do TTL
CREATE TABLE IF NOT EXISTS revoked_sessions (
    jti         TEXT PRIMARY KEY,
    user_id     UUID,
    revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason      TEXT
);
