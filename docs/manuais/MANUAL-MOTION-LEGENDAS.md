# Manual do Motion Legendas

> Plugin oficial do Adobe Premiere Pro pra aplicar legendas animadas em massa.
> Parte da família **MotionPro** by PacotesFX.

---

## Sumário

1. [Instalação](#1-instalação)
2. [Primeiro acesso (login + trial)](#2-primeiro-acesso)
3. [Visão geral do plugin](#3-visão-geral)
4. [As 5 abas](#4-as-5-abas)
   - 4.1 Templates
   - 4.2 Criar
   - 4.3 Importar
   - 4.4 Editar
   - 4.5 SFX
5. [Fluxos práticos (3 cenários)](#5-fluxos-práticos)
6. [Modos especiais](#6-modos-especiais)
7. [SFX (efeitos sonoros)](#7-sfx)
8. [Assinatura e planos](#8-assinatura-e-planos)
9. [Resolução de problemas](#9-resolução-de-problemas)
10. [Suporte](#10-suporte)

---

## 1. Instalação

### Pré-requisitos

- Windows 10 ou 11
- Adobe Premiere Pro **CC 2019 ou superior**
- Conexão com internet (pra login e validação de licença)

### Passo a passo (5 minutos)

#### 1.1 Baixe o instalador

No e-mail de boas-vindas que você recebeu ao criar a conta, clique em **"Baixar plugin"** ou acesse:

```
https://motionpro-lp.vercel.app/legendas/download
```

Você vai baixar um arquivo chamado **`MotionPro-Legendas-X.Y.Z.zip`** (~18 MB).

#### 1.2 Extraia o ZIP

Clique com o botão direito no arquivo → **Extrair tudo…** → escolha a Área de Trabalho.

Vai abrir uma pasta com 3 arquivos:

```
📂 MotionPro-Legendas-1.1.1/
   ├── INSTALAR.bat          ← clica aqui
   ├── DESINSTALAR.bat
   └── LEIA-ME.html
```

#### 1.3 Feche o Premiere Pro

Se estiver aberto, feche tudo antes (`Arquivo → Sair`). Se deixar aberto, o instalador avisa e pede pra fechar.

#### 1.4 Duplo-clique em `INSTALAR.bat`

Vai abrir uma janela preta de terminal por uns 30 segundos. É **normal**, não é vírus.

> 💡 Se o Windows perguntar "Você confiou neste app?", clique em **Mais informações → Executar mesmo assim**. Isso acontece porque o instalador é um script aberto (você consegue ver o conteúdo), não um executável fechado.

#### 1.5 Aguarde "✅ INSTALADO"

O script vai:
- Copiar **549 templates** de legenda (motion graphics) pra pasta do plugin
- Configurar o registro do Windows pra liberar plugins não-assinados (necessário pra CEP Adobe)

Ao final, ele pergunta se quer abrir o Premiere. Digite **`S`** e Enter.

#### 1.6 No Premiere

`Janela → Extensões → Motion Legendas`

Vai aparecer o painel à direita. Pronto pra usar.

---

## 2. Primeiro acesso

### Tela de login (área azul)

Quando o plugin abre pela primeira vez, aparece a tela de login:

```
   Motion Legendas
   by PacotesFX

   [ Email             ]
   [ Senha             ]

   [ Esqueci minha senha ]
   [ Criar conta · 7 dias grátis ]

   [        ENTRAR        ]
```

**Já tem conta?** Login com email + senha.
**Primeira vez?** Clica em **"Criar conta · 7 dias grátis"** → preenche nome + email + telefone (opcional) + senha → ganha trial automático de **7 dias** sem cartão.

### Esqueci a senha

Clica em **"Esqueci minha senha"** → digita email → recebe link no email (válido 1h) → define senha nova.

### Confirmar email

Após o signup, você recebe um email de boas-vindas com:
- Suas credenciais (email + senha temporária se foi gerada)
- Link pra confirmar o email (recomendado mas não obrigatório)
- Tutorial de uso (link pra esse manual)

> 🔒 **O plugin LEMBRA do seu login.** Mesmo fechando o Premiere ou reiniciando o PC, você não precisa logar de novo. Só desloga se clicar manualmente em "Sair" ou se sua senha for alterada.

---

## 3. Visão geral

Quando você entra, vê uma barra superior com:

```
🅻 Motion Legendas              [🟢 status]  [🩺 diagnóstico]
─────────────────────────────────────────────────────────
[📚 Templates]  [✍️ Criar]  [📥 Importar]  [📝 Editar]  [🔊 SFX]
```

### Fluxo geral

```
   Você tem o áudio do vídeo
              │
              ▼
   ┌──────────────────────────────┐
   │  1️⃣  Criar OU Importar legendas │
   └──────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────┐
   │  2️⃣  Revisar (aba Editar)       │
   └──────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────┐
   │  3️⃣  Aplicar na Timeline        │
   └──────────────────────────────┘
              │
              ▼
   ✅ Legendas animadas no vídeo
```

---

## 4. As 5 abas

### 4.1 📚 Templates

Biblioteca com **549 templates** organizados em 10 categorias:

| Categoria | Quantidade |
|---|---|
| Simple Titles | 50 |
| Fashion Titles | 24 |
| Urban Titles | 15 |
| Glitch Titles | 30 |
| Huge Titles | 80 |
| Minimal Titles | 60 |
| Wedding Titles | 70 |
| Elegant Titles | 70 |
| Corporate Titles | 50 |
| Lower Thirds | 100 |

**Como usar:**
- Clica numa pílula de categoria (ex: "Glitch") pra filtrar
- Clica num template no grid pra ver preview maior
- Clica em **⚡ APLICAR** pra aplicar o template selecionado no clip ativo da timeline

Cada template suporta de **1 a 7 palavras** por legenda — o plugin escolhe automaticamente o template mais apropriado pra cada legenda quando você usa Distribuição Inteligente.

---

### 4.2 ✍️ Criar

Pra quando você **não tem SRT**. Cole o roteiro inteiro e o plugin gera as legendas alinhadas aos templates disponíveis.

**Passos:**

1. Cole ou digite o roteiro completo no textarea
2. Define onde começa na timeline:
   - Digite manualmente (ex: `00:00:05,000`)
   - OU clica em **↺ CTI** pra usar a posição atual do playhead
3. Clica em **⚡ Criar legendas**
4. O plugin gera o SRT cortado nas quebras ideais (pontos finais e pausas naturais)
5. Vai automaticamente pra aba **Editar** pra revisão

**Dica:** use pontuação natural. **Pontos finais marcam quebras obrigatórias**, vírgulas e pontos de exclamação ajudam o plugin a quebrar onde faz sentido.

---

### 4.3 📥 Importar

Pra quando você **já tem SRT** ou já gerou captions no Premiere.

#### Opção A: arquivo SRT externo

Clica em **📂 Carregar SRT** → escolhe arquivo `.srt` → plugin lê e vai pra aba Editar.

#### Opção B: Captions nativas do Premiere

Se você usou a função **"Texto → Criar legendas → Transcrever sequência"** do Premiere, clica em **🎬 Importar do Premiere**. O plugin lê direto a transcrição da sequência ativa.

> ⚠️ Pra essa opção funcionar, a sequência precisa estar ativa (selecionada) e ter captions geradas.

---

### 4.4 📝 Editar

A aba principal de revisão. Aqui você vê todas as legendas em formato de tabela:

```
┌──┬─────────────┬───────────────────┬────────────┐
│☑ │  Tempo      │  Texto            │  Template  │
├──┼─────────────┼───────────────────┼────────────┤
│☑ │ 0:01 → 0:03 │ Bem-vindo ao      │ Glitch 03  │
│  │             │ canal             │            │
├──┼─────────────┼───────────────────┼────────────┤
│☑ │ 0:03 → 0:06 │ Hoje eu vou       │ Simple 12  │
│  │             │ mostrar           │            │
└──┴─────────────┴───────────────────┴────────────┘
```

**Ações disponíveis:**

| Ação | O que faz |
|---|---|
| **⚡ Distribuição Inteligente** | Re-distribui os templates automaticamente baseado no número de palavras de cada legenda |
| **✓ Selecionar tudo / Limpar** | Marca/desmarca todas as legendas pra aplicar em massa |
| **🔄 Trocar template em massa** | Selecionou várias? troca o template de todas em 1 clique |
| **✏️ Editar inline** | Clica no texto pra editar diretamente |
| **🎨 Trocar template individual** | Clica no nome do template pra escolher outro |

#### Configurações de corte (na própria aba)

- **Duração mínima**: legendas muito curtas (< X segundos) são juntadas com a seguinte
- **Gap entre legendas**: espaço de silêncio mínimo entre uma e outra
- **Modo 1 palavra**: ativa o modo viral (cada palavra = 1 clip separado)

#### Aplicar

Quando estiver tudo ajustado, clica em:

**⚡ APLICAR NA TIMELINE**

O plugin cria todos os clips animados na track de vídeo escolhida, com o timing correto. Em ~30 segundos pra vídeos de 5 minutos.

---

### 4.5 🔊 SFX

Aba de efeitos sonoros pra dar mais impacto às legendas (estilo Submagic, TikTok).

**O que vem incluído:**
- 10 SFX sintéticos shipados: click, pop, camera shutter, whoosh, impact, typing, etc.

**Adicionar seus SFX:**

Cole seus arquivos `.mp3`/`.wav`/`.ogg`/`.m4a` em:

```
%APPDATA%\Adobe\CEP\extensions\com.motionpro.legendas\packs\sfx\<categoria>\
```

O plugin escaneia essa pasta automaticamente. Crie subpastas (ex: `transitions/`, `swoosh/`, `bass/`) pra organizar.

**Aplicar SFX:**

- **⚡ No CTI**: aplica 1 SFX na posição atual do playhead
- **🎬 Em todas legendas**: aplica 1 SFX no início de cada legenda da última track de vídeo (ideal pra dar "tchic" em cada palavra do modo 1-palavra)

---

## 5. Fluxos práticos

### Cenário 1: já tenho SRT pronto (mais comum)

```
1. Aba Importar
2. 📂 Carregar SRT  →  escolhe o arquivo .srt
3. Aba Editar (vai automaticamente)
4. (opcional) ⚡ Distribuição Inteligente  →  escolhe templates apropriados
5. (opcional) revisa textos e templates individuais
6. ⚡ APLICAR NA TIMELINE
```

### Cenário 2: tenho só o áudio/vídeo (zero roteiro)

```
1. No Premiere: Texto → Criar legendas → Transcrever sequência
   (espere o Premiere transcrever)
2. No plugin: Aba Importar
3. 🎬 Importar do Premiere
4. Aba Editar (vai automaticamente)
5. ⚡ Distribuição Inteligente
6. Revisa o texto (a transcrição automática às vezes erra)
7. ⚡ APLICAR NA TIMELINE
```

### Cenário 3: já escrevi o roteiro à mão

```
1. Aba Criar
2. Cola o roteiro completo no textarea
3. ↺ CTI (usa posição atual) ou digita tempo de início
4. ⚡ Criar legendas
5. Aba Editar (vai automaticamente)
6. (opcional) ajusta timing nas legendas
7. ⚡ APLICAR NA TIMELINE
```

---

## 6. Modos especiais

### 6.1 🎯 1 palavra por legenda (modo viral)

Ative no painel de config (aba Editar → "Modo 1 palavra"). Cada palavra do roteiro vira **1 clip separado** com template de 1 palavra.

**Quando usar:** vídeos TikTok/Reels/Shorts onde cada palavra precisa "pular" individualmente na tela.

**⚠️ ATENÇÃO no export:** vídeos longos com modo 1-palavra geram 100+ clips MOGRT. Pode estourar GPU no render. **SEMPRE use Pre-render Preview antes de exportar** (próximo tópico).

### 6.2 Multi-palavra (padrão)

Plugin escolhe templates de 2/3/4+ palavras automaticamente. Cada legenda vira **1 clip único**. Mais leve no export.

### 6.3 🎬 Pre-render Preview

Botão **🎬 Renderizar preview** aparece automaticamente após aplicar **≥ 50 legendas**.

**O que faz:** "queima" as legendas em um único arquivo de vídeo H.264, substituindo os 100+ clips MOGRT. Resultado: vídeo final exporta em 1/10 do tempo + zero risco de crash.

**Trade-off:** depois do pre-render, você não consegue mais editar legendas individuais sem refazer. Use só quando estiver finalizando o vídeo.

### 6.4 📦 Nesting automático

Botão **📦 Aninhar clips** agrupa todas as legendas em **1 sequência aninhada**. Vantagem: organiza a timeline, deixa mais fácil de mover/posicionar. Não substitui o render, só agrupa.

---

## 7. SFX completo

### Categorias sugeridas

| Pasta | Uso |
|---|---|
| `click/` | "tchic" entre palavras |
| `pop/` | "plop" estouros |
| `whoosh/` | passagens entre cenas |
| `impact/` | "bum" momentos fortes |
| `typing/` | máquina de escrever |
| `transition/` | swoosh longo entre seções |

### Onde achar SFX grátis

- **Pixabay Sound Effects** (licença grátis comercial)
- **YouTube Audio Library**
- **Zapsplat** (free com conta)

Baixe `.mp3` ou `.wav`, joga na pasta `packs/sfx/` do plugin e pronto.

---

## 8. Assinatura e planos

### Trial gratuito

7 dias automáticos no signup, **sem cartão**. Depois disso, o plugin entra em modo bloqueado:
- Você ainda consegue logar e ver o painel
- **Não consegue aplicar legendas** até renovar
- Aparece um banner azul "Renovar plano"

### Planos disponíveis

| Plano | Valor | Renovação |
|---|---|---|
| **Anual** | R$ 199 | 1× por ano |
| **Vitalício** | R$ 499 | pagamento único |

### Como renovar

1. Clica no banner "Renovar plano" OU em "Assinar"
2. Abre a página de pagamento no navegador
3. Paga via Pix, cartão ou boleto (Stripe)
4. **Volta pro plugin** — em até 1 minuto o paywall some sozinho (heartbeat detecta o pagamento)

### Cancelar

1. Acessa `https://motionpro.vercel.app/account` (link no email de confirmação)
2. Login
3. Cancelar assinatura
4. Continua usando até o fim do período pago

---

## 9. Resolução de problemas

### "O plugin não aparece em Janela → Extensões"

**Causa**: instalador não conseguiu liberar plugins não-assinados no registro.

**Solução**:
1. Feche o Premiere
2. Rode `INSTALAR.bat` de novo (como administrador se possível)
3. Reabra o Premiere

### "Tela preta no plugin"

**Causa**: cache antigo do CEP travando versão velha.

**Solução**:
1. Feche o Premiere
2. Apaga a pasta `%LOCALAPPDATA%\Temp\cep_cache`
3. Reabre o Premiere

### "Erro: device_limit_reached"

Você tem mais de **2 dispositivos ativos** (limite do trial/anual) ou **3 dispositivos** (vitalício).

**Solução**: revoga um dispositivo antigo no dashboard online (`https://motionpro.vercel.app/account/devices`) e tenta de novo.

### "Premiere crasha no export"

**Causa**: muitos MOGRTs ativos simultaneamente (modo 1-palavra).

**Solução**: rode **🎬 Renderizar preview** antes de exportar.

### "Não consigo aplicar — aparece banner azul de renovar"

Sua assinatura ou trial venceu. Renove no botão "Assinar" e em 1 minuto volta ao normal.

### "Templates não aparecem na grid"

**Causa**: pasta `packs/` não foi copiada na instalação.

**Solução**:
1. Verifica se existem arquivos `.mogrt` em `%APPDATA%\Adobe\CEP\extensions\com.motionpro.legendas\packs\`
2. Se vazio, rode `INSTALAR.bat` de novo

### "🩺 Diagnóstico Premiere" — quando usar

Botão no canto superior do plugin. Roda checks automáticos:
- Plugin tá conectado ao Premiere? ✓
- Tem sequência ativa? ✓
- Track de vídeo disponível? ✓
- Caminho dos templates OK? ✓

Use sempre que algo "não funciona" antes de pedir suporte.

---

## 10. Suporte

- **Email**: suporte@pacotesfx.com
- **Tempo de resposta**: 24h em dias úteis
- **WhatsApp**: (consulte no site)
- **Site**: https://motionpro-lp.vercel.app

Ao entrar em contato, envia junto:
- Seu email cadastrado
- Print do erro (se aparecer)
- Saída do botão **🩺 Diagnóstico Premiere** (copia o texto)

---

## Anexo: atalhos úteis

| Ação | Atalho |
|---|---|
| Aplicar template no clip ativo | clica num template + ⚡ APLICAR |
| Pegar posição atual da timeline | ↺ CTI (na aba Criar) |
| Selecionar todas legendas | ✓ Selecionar tudo (aba Editar) |
| Trocar template de várias legendas | seleciona + 🔄 Trocar em massa |

---

**Versão deste manual:** 1.0 · 2026-05-19
**Compatível com:** Motion Legendas 3.1.3+
