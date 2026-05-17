# 🔐 Como ELIMINAR o aviso do Windows SmartScreen

## ⚡ TL;DR

**O Windows SmartScreen só desaparece COMPLETAMENTE com certificado digital de code-signing.** Sem isso, mesmo apps legítimos disparam o aviso "O Windows protegeu o computador".

Tipos de certificado:

| Tipo | Custo/ano | Efeito | Pra quem |
|---|---|---|---|
| 🟡 **OV** (Organization Validated) | R$ 800-1.500 | Reduz aviso após semanas/meses (precisa ganhar reputação) | MVP, baixo orçamento |
| 🟢 **EV** (Extended Validation) | R$ 2.000-3.500 | **Aviso some no 1º download** | Recomendado pra venda |

---

## 💎 Recomendação: certificado EV (zera o aviso desde o dia 1)

### Por que EV é melhor:
- ✅ Windows reconhece **na 1ª execução** → zero aviso
- ✅ SmartScreen confia automaticamente
- ✅ Mostra "Verified Publisher: PacotesFX" no UAC
- ✅ Antivírus também passam a confiar
- ❌ Requer empresa CNPJ
- ❌ Vem em token USB físico (precisa do token no PC pra assinar)

### Onde comprar EV (Brasil/internacional):

| Vendedor | Preço aprox | Notas |
|---|---|---|
| **SSL.com EV** | $349/ano (~R$ 1.750) | Mais barato com boa reputação |
| **Sectigo EV** | $399/ano (~R$ 2.000) | Tradicional, suporte BR |
| **DigiCert EV** | $599/ano (~R$ 3.000) | Premium, validação em ~3 dias |
| **K Software EV** (revendedor) | $269/ano (~R$ 1.350) | Cheapest EV verificado |

**Onde NÃO comprar:** evita revendedores desconhecidos. Procura "EV Code Signing Certificate" em fornecedores listados pela Microsoft: https://learn.microsoft.com/en-us/windows-hardware/drivers/dashboard/get-a-code-signing-certificate

---

## 🟡 Alternativa de baixo custo: certificado OV

Se quiser começar barato e migrar pra EV depois:

| Vendedor | Preço aprox |
|---|---|
| **K Software OV** | $84/ano (~R$ 420) |
| **Sectigo OV** | $179/ano (~R$ 900) |
| **DigiCert OV** | $474/ano (~R$ 2.400) |

⚠️ **Problema do OV:** O aviso continua aparecendo nas primeiras instalações até o Windows acumular "reputação" do seu certificado (geralmente entre **500 a 3.000 downloads**). Pode levar **semanas ou meses** pra parar de aparecer.

Pra MotionPro vendendo R$ 199/199 = 1 conversão paga o cert em uma venda. Vale a pena começar com OV.

---

## 🚀 Como assinar o instalador depois de comprar

### 1. Você recebe o certificado:
- **EV:** vem em USB token físico (entregue por correio)
- **OV:** arquivo `.pfx` por email + senha

### 2. Instala o SignTool (já vem com Windows SDK):
```powershell
# Baixa Windows SDK do site da Microsoft (gratuito)
# https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/
```

### 3. Edita o `MotionVault.iss` (já tem o slot pronto):
Descomenta a linha:
```ini
SignTool=signtool sign /f $qC:\caminho\cert.pfx$q /p $qSUA_SENHA$q /tr http://timestamp.digicert.com /td sha256 /fd sha256 /d $qMotionPro Installer$q /du $qhttps://motionpro-lp.vercel.app$q $f
SignedUninstaller=yes
```

### 4. Inno Setup compila JÁ assinado:
- F9 → o `.exe` sai assinado automaticamente
- Verificação: clica com botão direito no `.exe` → Propriedades → **Assinaturas digitais** → deve mostrar "PacotesFX" como signatário válido

### 5. Sobe no GitHub Release igual antes

---

## 🛡️ Enquanto não tem certificado (mitigações que JÁ fizemos)

Implementado no MotionPro v1.0.3:

1. ✅ **VersionInfo completo** (Publisher, Copyright, Description, Product) — Windows reconhece como app sério
2. ✅ **AppId fixo** entre versões — SmartScreen rastreia reputação cumulativa
3. ✅ **AppMutex** único — Windows identifica como mesma identidade
4. ✅ **AppPublisher visível** ("PacotesFX") em UAC e propriedades
5. ✅ **Unblock-File** automático após instalação (remove Mark-of-the-Web)
6. ✅ **Página /seguranca.html** com hashes SHA-256 + VirusTotal + código aberto
7. ✅ **TouchDate** consistente — Windows não confunde com versão modificada
8. ✅ **MinVersion 10.0** — só roda em Win10+ (mais seguro)
9. ✅ **Logs do instalador** habilitados pra diagnóstico

Resultado: o aviso **ainda aparece**, mas:
- Cliente vê "Publisher: PacotesFX" (com certificado seria "Verified Publisher")
- Click 1x em "Mais informações" → "Executar assim mesmo" e nunca mais aparece naquele PC
- Conforme downloads forem acumulando, o SmartScreen pode começar a confiar (no OV/EV ficaria imediato)

---

## 🆚 Comparação: com vs sem certificado

| Cenário | Sem certificado (hoje) | Com EV (depois) |
|---|---|---|
| 1ª execução do .exe | "Windows protegeu o computador" → 2 cliques | Instala direto, zero aviso |
| Detalhes do .exe | "Publisher: Desconhecido" | "Publisher: PacotesFX (Verified)" |
| Antivírus | Pode marcar falso positivo | Confiança automática |
| Conversion rate estimada | ~70% (30% desistem do install) | ~95% |
| Investimento | R$ 0 | R$ 1.500-3.500/ano |

**Math simples:** se o EV custa R$ 2.000/ano e melhora conversão de 70% pra 95%, basta 10-15 vendas extras/ano pra se pagar.

---

## 📋 Próximos passos sugeridos

### Curto prazo (já feito):
- ✅ Metadados completos no instalador
- ✅ Página de segurança com hashes
- ✅ Documentação explicando pro cliente

### Médio prazo (1-3 meses):
- 🟡 Comprar certificado **OV K Software** ($84/ano) pra começar a construir reputação
- 🟡 Migrar pra EV assim que tiver as primeiras vendas

### Longo prazo (6+ meses):
- 🟢 Atualizar pra **certificado EV** quando MRR justificar

---

## 🆘 Submissão direta pra Microsoft SmartScreen (gratuito)

Sem comprar certificado, você pode **submeter o .exe direto pra Microsoft analisar e adicionar à whitelist**:

1. Abre: https://www.microsoft.com/en-us/wdsi/filesubmission
2. Login com conta Microsoft
3. **File type:** Not malware (false positive)
4. **Detection name:** SmartScreen warning on unsigned installer
5. Faz upload do `.exe`
6. Submit
7. Microsoft analisa em 1-3 dias úteis
8. Se aprovado, adiciona o hash do .exe à whitelist global → para de avisar

⚠️ **Caveat:** vale só pra ESSE hash específico. Toda nova versão precisa nova submissão.

Vou fazer isso pro `MotionPro-Setup-1.0.2.exe` agora pra ver se Microsoft adiciona à whitelist sem custar nada.

---

## 📞 Contatos úteis

- **Microsoft SmartScreen Submit:** https://www.microsoft.com/en-us/wdsi/filesubmission
- **K Software (cheap certs):** https://codesigning.ksoftware.net/
- **SSL.com (EV bom preço):** https://www.ssl.com/certificates/ev-code-signing/
- **Sectigo (tradicional):** https://www.sectigo.com/ssl-certificates-tls/code-signing
