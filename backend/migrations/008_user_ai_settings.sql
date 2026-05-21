-- 008_user_ai_settings.sql
-- Tabela pra config IA por usuário (Motion IA plugin):
--   - Anthropic API key (cripto via PG_AI_KEY_SECRET, fallback plain)
--   - Modelo escolhido (sonnet/opus/haiku)
--   - URL do motor local opcional (VIDEO-PRO-IA)
--   - MCP toggle
--   - Skills habilitadas
-- Idempotente.

CREATE TABLE IF NOT EXISTS user_ai_settings (
    user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    anthropic_key_enc text,                            -- key (encrypted ou plaintext dependendo do secret)
    anthropic_key_set boolean NOT NULL DEFAULT false,  -- true se já configurou alguma vez
    model             text NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_tokens        int  NOT NULL DEFAULT 4096,
    motor_url         text,                            -- ex: http://localhost:3333
    motor_enabled     boolean NOT NULL DEFAULT false,
    mcp_enabled       boolean NOT NULL DEFAULT false,
    mcp_url           text,                            -- ex: http://localhost:3001
    skills_enabled    jsonb  NOT NULL DEFAULT '{}'::jsonb,
    custom_system     text,                            -- system prompt customizado opcional
    updated_at        timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uas_updated ON user_ai_settings(updated_at DESC);
