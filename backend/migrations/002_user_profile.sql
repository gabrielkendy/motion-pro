-- Profile + verificação de email/telefone
ALTER TABLE users ADD COLUMN IF NOT EXISTS name              TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_optin   BOOLEAN NOT NULL DEFAULT TRUE;

-- Indexes pra busca
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(email_verified, created_at DESC);
