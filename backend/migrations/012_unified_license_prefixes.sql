-- 012_unified_license_prefixes.sql · 2026-05-21
-- Sprint Motion Suite Ultra Pro · AGENTE β
--
-- Unifica o sistema de license keys + product catalog pros 3 plugins:
--   MTI-XXXX → Motion Titles
--   MTL-XXXX → Motion Legendas
--   MIA-XXXX → Motion IA   (já existia)
--   MTS-XXXX → Bundle Motion Suite (Titles + Legendas + IA)
--
-- Idempotente. Retrocompat: ids antigos ('Motion Titles', 'legendas',
-- 'bundle_all') permanecem como alias — apenas registros recentes
-- (>= 2026-05-01) são backfillados pros canônicos.

-- ============================================================
-- 1) license_keys: generated column de prefixo curto (MTI/MTL/MIA/MTS)
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'license_keys' AND column_name = 'key_prefix_type'
    ) THEN
        ALTER TABLE license_keys
            ADD COLUMN key_prefix_type TEXT
            GENERATED ALWAYS AS (UPPER(substring(key_prefix FROM 1 FOR 3))) STORED;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_license_keys_prefix_type
    ON license_keys(key_prefix_type);

-- ============================================================
-- 2) products: ids canônicos (kebab-case curto)
--    Os ids antigos ficam como alias pra retrocompat.
-- ============================================================
INSERT INTO products(id, name, description, is_active) VALUES
    ('titles',   'Motion Titles',   '7.906+ templates de motion graphics premium', true),
    ('legendas', 'Motion Legendas', 'Plugin de títulos, lower thirds e legendas estilizadas', true),
    ('ia',       'Motion IA',       'Agente Claude/Gemini integrado ao Premiere Pro', true),
    ('suite',    'Motion Suite',    'Bundle completo: Titles + Legendas + IA', true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

-- ============================================================
-- 3) products: tabela de aliases pra mapear ids antigos → canônicos.
--    Webhook novo escreve no canônico; leitura pode aceitar ambos
--    via JOIN/coalesce.
-- ============================================================
CREATE TABLE IF NOT EXISTS product_aliases (
    alias        TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_aliases(alias, canonical_id) VALUES
    ('Motion Titles', 'titles'),
    ('motionpro',     'titles'),
    ('motion_titles', 'titles'),
    ('legendas',      'legendas'),
    ('motion_legendas', 'legendas'),
    ('ia',            'ia'),
    ('motionia',      'ia'),
    ('motion_ia',     'ia'),
    ('bundle_all',    'suite'),
    ('suite',         'suite'),
    ('motion_suite',  'suite')
ON CONFLICT (alias) DO UPDATE SET canonical_id = EXCLUDED.canonical_id;

-- Helper function: resolve alias → canônico. Retorna o input se já for canônico.
CREATE OR REPLACE FUNCTION resolve_product_id(p_input TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT canonical_id FROM product_aliases WHERE alias = p_input),
        p_input
    );
$$;

-- ============================================================
-- 4) Backfill: subscriptions recentes (>= 2026-05-01) ganham product_id
--    canônico. Histórico fica como está até cleanup futuro.
-- ============================================================
UPDATE subscriptions s
   SET product_id = resolve_product_id(s.product_id)
 WHERE s.started_at >= '2026-05-01'::timestamptz
   AND s.product_id IS NOT NULL
   AND s.product_id IN (SELECT alias FROM product_aliases WHERE alias <> canonical_id);

-- ============================================================
-- 5) product_prices: registros do bundle Motion Suite
--    Lê env vars via current_setting('app.stripe_price_suite_*')
--    seguindo o padrão da migration 011.
-- ============================================================
DO $$
DECLARE
    suite_yearly   TEXT := current_setting('app.stripe_price_suite_yearly',   true);
    suite_lifetime TEXT := current_setting('app.stripe_price_suite_lifetime', true);
BEGIN
    IF suite_yearly IS NOT NULL AND suite_yearly <> '' THEN
        INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
        VALUES ('suite', 'yearly', suite_yearly, 79900, 'brl', true)
        ON CONFLICT (stripe_price_id) DO UPDATE
            SET product_id = 'suite', plan = 'yearly', amount_cents = 79900, is_active = true;
    END IF;

    IF suite_lifetime IS NOT NULL AND suite_lifetime <> '' THEN
        INSERT INTO product_prices(product_id, plan, stripe_price_id, amount_cents, currency, is_active)
        VALUES ('suite', 'lifetime', suite_lifetime, 149900, 'brl', true)
        ON CONFLICT (stripe_price_id) DO UPDATE
            SET product_id = 'suite', plan = 'lifetime', amount_cents = 149900, is_active = true;
    END IF;
END $$;

-- ============================================================
-- 6) View user_active_products: consolida licenses ativas +
--    subscriptions ativas → array de produtos canônicos por user.
--    Source-of-truth pro endpoint GET /v1/me/products.
-- ============================================================
CREATE OR REPLACE VIEW user_active_products AS
WITH
-- 6a) Produtos vindos de license_keys (chave foi emitida com customer_email)
license_products AS (
    SELECT
        u.id AS user_id,
        resolve_product_id(p) AS product_id,
        'license'::text AS source,
        lk.tier,
        lk.expires_at,
        lk.key_prefix,
        lk.created_at AS granted_at
    FROM license_keys lk
    JOIN users u ON LOWER(u.email) = LOWER(lk.customer_email)
    CROSS JOIN LATERAL unnest(lk.products) AS p
    WHERE lk.revoked_at IS NULL
      AND (lk.expires_at IS NULL OR lk.expires_at > now())
      AND lk.customer_email IS NOT NULL
),
-- 6b) Produtos vindos de subscriptions ativas
sub_products AS (
    SELECT
        s.user_id,
        resolve_product_id(s.product_id) AS product_id,
        'subscription'::text AS source,
        s.plan AS tier,
        s.current_period_end AS expires_at,
        NULL::text AS key_prefix,
        s.started_at AS granted_at
    FROM subscriptions s
    WHERE s.status IN ('active', 'trialing')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
),
-- 6c) Bundle "suite" expande pros 3 produtos individuais
expanded AS (
    SELECT user_id, product_id, source, tier, expires_at, key_prefix, granted_at
      FROM license_products
     WHERE product_id <> 'suite'
    UNION ALL
    SELECT user_id, sub_p AS product_id, source, tier, expires_at, key_prefix, granted_at
      FROM license_products,
           LATERAL (VALUES ('titles'), ('legendas'), ('ia')) AS s(sub_p)
     WHERE product_id = 'suite'
    UNION ALL
    SELECT user_id, product_id, source, tier, expires_at, key_prefix, granted_at
      FROM sub_products
     WHERE product_id <> 'suite'
    UNION ALL
    SELECT user_id, sub_p AS product_id, source, tier, expires_at, key_prefix, granted_at
      FROM sub_products,
           LATERAL (VALUES ('titles'), ('legendas'), ('ia')) AS s(sub_p)
     WHERE product_id = 'suite'
)
SELECT DISTINCT ON (user_id, product_id)
    user_id,
    product_id,
    source,
    tier,
    expires_at,
    key_prefix,
    granted_at
  FROM expanded
 ORDER BY user_id, product_id,
          -- Prioriza license sobre subscription, e expiração mais distante
          CASE source WHEN 'license' THEN 0 ELSE 1 END,
          expires_at DESC NULLS FIRST;

-- ============================================================
-- 7) Índices funcionais LOWER(email) — /v1/me/products é chamado no
--    boot de TODOS os plugins CEP, precisa ser <50ms. A view faz
--    JOIN case-insensitive entre users.email e license_keys.customer_email.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_lower_email
    ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_lk_lower_email
    ON license_keys (LOWER(customer_email))
    WHERE customer_email IS NOT NULL;

-- ============================================================
-- 8) Dedup por Stripe session_id — protege contra duplo-issuance se
--    Stripe re-disparar checkout.session.completed com event.id novo
--    (retry manual no Dashboard, por exemplo).
--    Unique index parcial: só registros stripe-auto, pra não conflitar
--    com chaves admin/manuais que podem ter notes arbitrários.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_lk_stripe_auto_unique
    ON license_keys (notes)
    WHERE notes LIKE 'stripe-auto-%';

-- ============================================================
-- 9) Comentários documentando a tabela license_keys (operacional)
-- ============================================================
COMMENT ON COLUMN license_keys.key_prefix_type IS
    'Prefixo curto da key (MTI/MTL/MIA/MTS). Gerado automaticamente.';
COMMENT ON COLUMN license_keys.products IS
    'Array de product_ids canônicos (titles/legendas/ia). Chaves MTS- contêm os 3.';

-- NB: sem COMMIT; explícito — node-pg roda autocommit por statement.
-- ROLLBACK manual (se necessário):
--   DROP VIEW IF EXISTS user_active_products;
--   DROP INDEX IF EXISTS idx_lk_stripe_auto_unique, idx_lk_lower_email,
--                        idx_users_lower_email, idx_license_keys_prefix_type;
--   DROP FUNCTION IF EXISTS resolve_product_id(TEXT);
--   DROP TABLE IF EXISTS product_aliases;
--   ALTER TABLE license_keys DROP COLUMN IF EXISTS key_prefix_type;
--   DELETE FROM products WHERE id IN ('titles','legendas','ia','suite');
--   DELETE FROM product_prices WHERE product_id='suite';
