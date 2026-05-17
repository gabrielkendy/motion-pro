# MotionVault — Plano de monetização

> **Premissa:** você já tem 7.906 templates `.mogrt` pagos e empacotados.
> O diferencial competitivo do MotionVault vs Motion Bro/AtomX *standalone* é
> o **modelo SaaS + acervo gigante já curado + interface unificada**.

## Preço sugerido (USD — vendas globais)

| Plano               | Preço     | Margem após Stripe (2.9% + $0.30) | Ciclo  |
|---------------------|-----------|-----------------------------------|--------|
| Free / Trial 7 dias | $0        | —                                 | —      |
| Monthly             | $19/mês   | ~$18,15                           | mensal |
| Yearly              | $149/ano  | ~$144,40 (~$12.04/mês equivalente)| anual  |
| Lifetime            | $399      | ~$387,33                          | único  |
| Team (5 seats)      | $89/mês   | ~$86,12                           | mensal |

Use `STRIPE_PRICE_*` no `.env` pra mapear o `priceId` ao plano. O sistema já
suporta promo codes (`allow_promotion_codes: true`) — útil pra Black Friday e
parcerias com influenciadores.

## Canais de aquisição (escalável mundialmente)

1. **YouTube** — Posicione como "Motion Bro / AtomX killer" em PT + EN + ES.
   Vídeos comparativos mostrando o painel unificado.
2. **Google Ads** keywords: `motion graphics premiere`, `mogrt pack`,
   `premiere pro templates`, `motion bro alternative`.
3. **Affiliate program** — comissão 30% recorrente via Stripe metadata. O
   campo `stripe_customer.metadata.ref` já pode armazenar o ID do afiliado.
4. **Bundles com cursos** — parceiros de edição de vídeo licenciam acesso a 6
   meses (plano `pro_all` manualmente emitido).
5. **Marketplace integrations** — listar na Adobe Exchange (precisa assinar a
   extensão com ZXPSignCmd e enviar para revisão).

## Estimativas conservadoras (ano 1)

| Cenário        | Clientes pagantes | MRR esperado | ARR |
|----------------|-------------------|--------------|-----|
| Pessimista     | 100               | ~$1.300      | $15.6K |
| Realista       | 600               | ~$9.000      | $108K  |
| Otimista       | 2.500             | ~$37.500     | $450K  |

Cálculo assume mix 60% monthly / 25% yearly / 15% lifetime e churn 4% a.m.

## Custos operacionais (estimados USD/mês)

| Item                                | Custo      |
|-------------------------------------|------------|
| API Node (Fly.io / Railway 2GB)     | $20        |
| Postgres gerenciado (Supabase free → Pro $25) | $25 |
| CDN (Cloudflare R2 + CDN free tier) | $0–$50     |
| Stripe                              | 2.9% + $0.30/tx |
| Domínio + e-mail (SendGrid free)    | $5         |
| **Total inicial**                   | **~$50/mês** |

A arquitetura escala horizontalmente: Postgres aguenta milhões de licenças,
o JWT é stateless, e o CDN absorve qualquer pico de download.

## Compliance e fiscal

- **VAT / IVA / GST**: ative *Stripe Tax* (5% extra do valor, mas calcula e
  recolhe automaticamente para 50+ países).
- **Reembolso**: política 14 dias (padrão UE Consumer Rights Directive).
- **LGPD/GDPR**: política de privacidade lista o que coletamos
  (email, fingerprint, IP no log de auditoria). Direito ao apagamento:
  `DELETE FROM users WHERE id=$1` (cascade nas dependências já está pronto).
- **Acordo de licença**: termo claro de uso pessoal vs. comercial (recomendo
  permitir uso comercial em todos os planos pagos — diferencial sobre
  concorrentes que restringem).
