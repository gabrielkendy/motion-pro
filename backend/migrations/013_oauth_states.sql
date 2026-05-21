-- 013_oauth_states.sql · 2026-05-21
-- Sprint Motion Suite Ultra Pro · AGENTE β · backlog A4
--
-- Persiste state OAuth no banco em vez de Map in-memory. Em serverless
-- (Vercel) cada cold start cria nova instância — Map zerava entre o
-- /start e o /callback, causando "invalid_state" intermitente.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS oauth_states (
    state       TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,                     -- 'google' | 'github'
    return_to   TEXT NOT NULL,
    plugin      TEXT,                              -- 'titles'|'legendas'|'ia'|'suite'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ                        -- marca single-use depois do callback
);

-- GC + lookup performance
CREATE INDEX IF NOT EXISTS idx_oauth_states_exp
    ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_unconsumed
    ON oauth_states(state)
    WHERE consumed_at IS NULL;

COMMENT ON TABLE oauth_states IS
    'Estado anti-CSRF do OAuth — persistido (serverless-safe). TTL ~10min, single-use.';

-- ROLLBACK manual:
--   DROP INDEX IF EXISTS idx_oauth_states_unconsumed, idx_oauth_states_exp;
--   DROP TABLE IF EXISTS oauth_states;
