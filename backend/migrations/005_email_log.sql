-- Log de emails transacionais enviados (evita duplicação)
CREATE TABLE IF NOT EXISTS email_log (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    kind          TEXT NOT NULL,            -- 'trial_d3' | 'trial_d1' | 'trial_expired' | 'welcome' | 'reset' | etc
    context_key   TEXT,                     -- ex: subscription_id (pra trial reminders) — evita mandar 2x
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resend_id     TEXT,
    UNIQUE(user_id, kind, context_key)
);

CREATE INDEX IF NOT EXISTS idx_email_log_sent ON email_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_kind ON email_log(kind, sent_at DESC);
