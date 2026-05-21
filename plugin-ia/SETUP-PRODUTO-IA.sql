-- ════════════════════════════════════════════════════════════════
-- SETUP-PRODUTO-IA.sql
--
-- Rode ESTE script UMA VEZ no banco Neon (production) pra ativar o
-- produto "ia" no MotionVault. É um INSERT puro — não muda schema, não
-- mexe em sub existente de ninguém.
--
-- Como rodar:
--   1. Abra https://console.neon.tech/ → seu projeto → SQL Editor
--   2. Cole este arquivo inteiro
--   3. Run
--   4. Verifique com:  SELECT * FROM products;
--
-- Depois disso:
--   • Plugin CEP Motion IA consegue criar trial 7d automaticamente
--   • Dashboard admin mostra o produto IA nos selects
--   • /v1/license/issue?product_id=ia funciona
-- ════════════════════════════════════════════════════════════════

INSERT INTO products(id, name, description) VALUES
    ('ia', 'Motion IA', 'Agente IA dentro do Premiere: Whisper + FFmpeg + Remotion + Anthropic local')
ON CONFLICT (id) DO NOTHING;

-- (opcional) Atualiza descrição do bundle pra refletir os 3 produtos
UPDATE products
   SET description = 'Motion Titles + Motion Legendas + Motion IA — todos os plugins, um único pagamento'
 WHERE id = 'bundle_all';

-- Confirma:
SELECT id, name, description, is_active, created_at FROM products ORDER BY created_at;
