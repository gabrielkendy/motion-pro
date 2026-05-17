# MotionVault

Extensão única para Adobe Premiere Pro que unifica todos os packs Motion Bro
(7.906 templates `.mogrt`) e o acervo AtomX em um único painel CEP, com
sistema completo de assinatura SaaS, validação online e proteção anti‑pirataria.

## Visão geral

```
+--------------------------------------+
|  Premiere Pro (CEP Panel)            |
|  +-------------------------------+   |
|  |  MotionVault UI               |   |  <-- HTML/JS/CSS
|  |  - Browser de categorias      |   |
|  |  - Preview de assets          |   |
|  |  - Drag/drop & duplo clique   |   |
|  +-------------------------------+   |
|         |                            |
|  +------v------+   +-------------+   |
|  | ExtendScript|   | License core|   |
|  | importer    |   | JWT+HWID    |   |
|  +-------------+   +------+------+   |
|                           |          |
+---------------------------|----------+
                            |
                            v
              +-------------+-------------+
              |  MotionVault Backend SaaS |
              |  Node + Postgres + Stripe |
              +---------------------------+
                            |
                            v
                      CDN (S3/CF)
                  arquivos .mogrt grandes
```

## Componentes

- **plugin/** — Extensão CEP que vai pra `%APPDATA%/Adobe/CEP/extensions/MotionVault`
- **backend/** — API Node.js que valida licenças, gerencia Stripe, serve catálogo
- **tools/** — Scripts de build: gera catálogo dos packs existentes, ofusca código, assina licenças
- **installers/** — Scripts de instalação Windows/Mac
- **docs/** — Documentação técnica, arquitetura, plano de monetização

## Quick start (dev)

```bash
# 1. Gera o catálogo unificado a partir dos seus 8 packs Motion Bro
cd MotionVault/tools
node catalog-builder.js

# 2. Sobe o backend local
cd ../backend
cp .env.example .env
docker-compose up -d

# 3. Instala a extensão no Premiere
cd ../installers/windows
install.bat
```

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/MONETIZATION.md](docs/MONETIZATION.md).
