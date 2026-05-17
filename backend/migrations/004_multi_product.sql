-- Multi-product SaaS — suporte a múltiplos plugins na mesma infra
CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO products(id, name, description) VALUES
    ('motionpro',  'MotionPro',           '7.906 templates de motion graphics premium'),
    ('legendas',   'MotionPro Legendas',  'Plugin de títulos, lower thirds e legendas estilizadas'),
    ('bundle_all', 'Pacote Completo',     'MotionPro + Legendas — todos os plugins')
ON CONFLICT (id) DO NOTHING;

-- Subscription pertence a um produto específico
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS product_id TEXT REFERENCES products(id) DEFAULT 'motionpro';

CREATE INDEX IF NOT EXISTS idx_subs_user_product ON subscriptions(user_id, product_id, status);

-- Backfill: subs existentes pertencem ao MotionPro
UPDATE subscriptions SET product_id='motionpro' WHERE product_id IS NULL;

-- Tabela de pricing — substitui as env vars STRIPE_PRICE_*
CREATE TABLE IF NOT EXISTS product_prices (
    id              SERIAL PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id),
    plan            TEXT NOT NULL,            -- 'yearly' | 'lifetime'
    stripe_price_id TEXT NOT NULL UNIQUE,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'brl',
    is_active       BOOLEAN NOT NULL DEFAULT true
);

-- Seed inicial: prices do MotionPro (já existentes no Stripe)
INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents) VALUES
    ('motionpro', 'yearly',   'price_1TY6BHBBwmTfpkhYOkVzI0vE', 19900),
    ('motionpro', 'lifetime', 'price_1TY6BJBBwmTfpkhYNYYWFXUb', 49900)
ON CONFLICT (stripe_price_id) DO NOTHING;
-- Prices do Legendas e Bundle serão adicionados depois (Stripe bootstrap)
