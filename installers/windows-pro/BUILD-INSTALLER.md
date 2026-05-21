# 🛠️ Como gerar o instalador .exe profissional

Este script Inno Setup gera um **Motion Titles-Setup-1.0.1.exe** que faz instalação completa em 1 clique (estilo Adobe, Office, etc).

---

## Passo 1 · Instalar Inno Setup (uma vez só)

1. Baixa grátis em: https://jrsoftware.org/isdl.php
2. Roda o instalador (~3MB)
3. Marca a opção **"Inno Setup Preprocessor"**

---

## Passo 2 · Gerar o icon.ico

Inno Setup precisa de um ícone `.ico`. Você pode:

**Opção A — usar online (1 min):**
1. Vai em https://convertio.co/png-ico/
2. Faz upload de um PNG quadrado (256×256) com a logo "M·V"
3. Baixa o `.ico` e coloca como `installers/windows-pro/icon.ico`

**Opção B — sem ícone (placeholder):**
- Comenta a linha `SetupIconFile=icon.ico` no arquivo `Motion Titles.iss`
- Comenta também `Source: "icon.ico"...` na seção `[Files]`

---

## Passo 3 · Compilar

1. Dá duplo-clique em `Motion Titles.iss` → abre no Inno Setup Compiler
2. Menu **Build → Compile** (F9)
3. Aguarda ~30 segundos
4. Vai gerar:
   ```
   installers/windows-pro/output/Motion Titles-Setup-1.0.1.exe
   ```

Esse `.exe` é o seu instalador FINAL.

---

## Passo 4 · Hospedar pra download

O `.exe` provavelmente vai ter uns 60-100MB (por causa dos templates). Tem 3 opções:

### Opção A — GitHub Releases (gratuito, 2GB por arquivo)
1. https://github.com/gabrielkendy/motion-pro/releases/new
2. Tag: `v1.0.1`
3. Faz upload do `.exe`
4. URL fica tipo `https://github.com/gabrielkendy/motion-pro/releases/download/v1.0.1/Motion Titles-Setup-1.0.1.exe`
5. Atualiza `landing/download.html` com essa URL

### Opção B — Cloudflare R2 (gratuito até 10GB, 1 milhão req/mês)
- Cria conta em https://dash.cloudflare.com
- Cria bucket "motionvault-installers"
- Faz upload do .exe
- URL pública: `https://pub-XXXX.r2.dev/Motion Titles-Setup-1.0.1.exe`

### Opção C — Vercel Blob (pago após 1GB)
- Não recomendado pra arquivos grandes

---

## Passo 5 · Atualizar landing

No arquivo `landing/download.html`, troca os `href="#"` dos botões pelos links reais do instalador.

---

## Validação

Antes de publicar, **testa em outro PC** (ou VM):
1. Roda o `.exe`
2. Aceita os termos
3. Instala
4. Abre Premiere → Janela → Extensões → Motion Titles deve aparecer
5. Login com conta de teste deve funcionar
6. Vai em "Adicionar/Remover Programas" → Motion Titles → Desinstalar → deve sumir limpo

---

## 🆘 Problemas comuns

**"Plugin não aparece no Premiere":**
- O instalador habilita `PlayerDebugMode=1` no registry. Confere se foi setado em `HKCU\Software\Adobe\CSXS.9` até `CSXS.12`.

**"Antivírus reclama do .exe":**
- É normal pra instaladores não-assinados. Pra assinar (~R$ 500/ano), compra certificado code-signing em https://sectigo.com ou DigiCert.

**Plugin > 100MB:**
- O bundle inclui `plugin/thumbs/` (57MB) e `plugin/catalog/` (7.4MB). Pra reduzir, exclui essas pastas e força download depois do primeiro login (assim o instalador fica pequeno).
