-- 011_ia_product_prices.sql · 2026-05-20
-- Cadastra os Stripe price_ids do Motion IA na tabela product_prices.
-- IMPORTANTE: substitua os STRIPE_PRICE_ID_IA_YEARLY e STRIPE_PRICE_ID_IA_LIFETIME
-- pelos prices reais criados no Stripe Dashboard. Os placeholders aqui são
-- pra documentação — rodar `vercel env pull` ou setar manualmente no Neon.

-- Setup recomendado no Stripe:
--   1. Crie um produto "Motion IA" no Stripe Dashboard
--   2. Adicione 2 prices:
--      - Anual: R$ 299/ano (recurring)
--      - Lifetime: R$ 699 (one-time)
--   3. Copie os price_id (price_XXXX) e rode INSERT abaixo via SQL ou via:
--      psql $DATABASE_URL -c "INSERT INTO product_prices ..."

-- Placeholder: se essas envs estiverem setadas, pode usar
DO $$
DECLARE
    yearly_price_id TEXT := current_setting('app.stripe_price_ia_yearly', true);
    lifetime_price_id TEXT := current_setting('app.stripe_price_ia_lifetime', true);
BEGIN
    -- Yearly
    IF yearly_price_id IS NOT NULL AND yearly_price_id <> '' THEN
        INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
        VALUES ('ia', 'yearly', yearly_price_id, 29900, 'brl', true)
        ON CONFLICT (stripe_price_id) DO UPDATE
            SET product_id='ia', plan='yearly', amount_cents=29900, is_active=true;
    END IF;
    -- Lifetime
    IF lifetime_price_id IS NOT NULL AND lifetime_price_id <> '' THEN
        INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
        VALUES ('ia', 'lifetime', lifetime_price_id, 69900, 'brl', true)
        ON CONFLICT (stripe_price_id) DO UPDATE
            SET product_id='ia', plan='lifetime', amount_cents=69900, is_active=true;
    END IF;
END $$;
