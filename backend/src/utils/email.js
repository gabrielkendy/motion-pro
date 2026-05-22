"use strict";
/**
 * Mailer leve. Usa Resend se RESEND_API_KEY estiver setado, senão fallback log.
 * Resend free tier: 3000 emails/mês, dominio padrão onboarding@resend.dev
 * (depois você configura motionvault.app via DNS).
 */
const FROM      = process.env.EMAIL_FROM || "Motion Titles <onboarding@resend.dev>";
const RESEND    = process.env.RESEND_API_KEY;
const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

async function sendEmail({ to, subject, html, text }) {
    if (!RESEND) {
        console.warn("[email] RESEND_API_KEY not set — would have sent:", { to, subject });
        return { ok: false, skipped: true, reason: "no_api_key" };
    }
    try {
        // Garante HTML completo com charset UTF-8 declarado
        const fullHtml = html.includes("<!DOCTYPE")
            ? html
            : `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;

        const body = JSON.stringify({
            from: FROM,
            to,
            subject,
            html: fullHtml,
            text,
            headers: {
                "Content-Type": "text/html; charset=UTF-8"
            }
        });

        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + RESEND,
                "Content-Type": "application/json; charset=utf-8"
            },
            body: Buffer.from(body, "utf8")    // força bytes UTF-8 no wire
        });
        const data = await r.json();
        if (!r.ok) {
            console.error("[email] Resend error", data);
            return { ok: false, error: data?.message || "send_failed" };
        }
        return { ok: true, id: data.id };
    } catch (e) {
        console.error("[email] crash", e);
        return { ok: false, error: e.message };
    }
}

// ====== TEMPLATES ======
const BRAND_HEADER = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0">
  <tr><td align="center">
    <div style="font:800 22px Inter,Arial,sans-serif;color:#fff;letter-spacing:-.5px">
      Motion<span style="color:#2563EB">·</span>Pro
    </div>
  </td></tr>
</table>`;

const BRAND_FOOTER = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px;margin-top:32px">
  <tr><td align="center" style="color:#888;font:400 12px Inter,Arial,sans-serif">
    © ${new Date().getFullYear()} Motion Titles · uma marca PacotesFX<br>
    Se você não esperava este e-mail, ignore.
  </td></tr>
</table>`;

function welcomeEmail({ email, password, plan, downloadUrl, productName, licenseKey, miaLicenseKey }) {
    const planName = plan === "lifetime" ? "Vitalício" : plan === "yearly" ? "Anual" : plan;
    const pName = productName || "Motion Titles";
    // M2: nome canônico é `licenseKey`. `miaLicenseKey` aceito como alias
    // legacy (callers antigos) até deprecation completa.
    const keyPlain = licenseKey || miaLicenseKey || null;
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Titles</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 28px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Bem-vindo ao ${pName}.
    </h1>
    <p style="color:#444;font:400 16px/1.6 Inter,Arial,sans-serif;margin:0 0 28px">
      Sua assinatura <strong>${planName}</strong> está ativa. Tudo pronto pra começar:
    </p>

    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">01 · Suas credenciais</div>
      <div style="font:500 14px/1.8 Inter,Arial,sans-serif;color:#0a0a0a">
        <strong>E-mail:</strong> ${email}<br>
        <strong>Senha temporária:</strong> <code style="background:#fff;padding:4px 10px;border-radius:4px;border:1px solid #e6e6ea;color:#2563EB;font-family:ui-monospace,Menlo,Consolas,monospace">${password}</code>
      </div>
      <p style="font:400 12px Inter,Arial,sans-serif;color:#888;margin:14px 0 0">
        Recomendamos trocar essa senha após o primeiro login.
      </p>
    </div>

    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">02 · Baixe e instale o plugin</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">
        Recomendamos a versão <strong>.ZIP</strong>: você extrai, dá duplo-clique em <code style="background:#fff;padding:2px 5px;border-radius:3px;font-size:13px">INSTALAR.bat</code> e pronto. <strong>Sem aviso do Windows.</strong>
      </p>
      <a href="${downloadUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
        Ir pra página de download →
      </a>
      <p style="color:#666;font:400 12px Inter,Arial,sans-serif;margin:14px 0 0">
        Premiere Pro CC 2019+, Windows 10/11. Versão macOS em breve.
      </p>
    </div>

    ${keyPlain ? `
    <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #2563EB;border-radius:8px;padding:24px;margin-bottom:24px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">🔑 Sua chave de licença ${pName}</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 14px">
        Use essa chave em <strong>⚙ Config → Ativar Licença</strong> dentro do ${pName}${keyPlain.startsWith("MTS-") ? " (vale pros 3 plugins do bundle)" : ""}:
      </p>
      <div style="background:#fff;padding:18px;border-radius:6px;border:1px solid #bfdbfe;text-align:center">
        <code style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;font-weight:700;color:#2563EB;letter-spacing:1px">${keyPlain}</code>
      </div>
      <p style="color:#666;font:400 12px Inter,Arial,sans-serif;margin:14px 0 0">
        ⚠️ Guarde essa chave em local seguro. Ela é única e libera todas as features do seu tier.
      </p>
    </div>` : ""}

    ${process.env.TUTORIAL_VIDEO_URL ? `
    <div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1px solid #fed7aa;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#c2410c;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">🎬 Tutorial em 3 minutos</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">
        Tem dúvida na instalação ou no primeiro uso? Vídeo curto mostrando tudo:
      </p>
      <a href="${process.env.TUTORIAL_VIDEO_URL}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
        ▶ Assistir tutorial →
      </a>
    </div>` : ""}

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px;margin-bottom:32px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">📖 Manual completo</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">
        Documentação oficial — instalação, primeira vez, fluxos práticos e troubleshooting.
      </p>
      <a href="https://motionpro-lp.vercel.app/docs/" style="display:inline-block;background:#2563EB;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
        📚 Acessar manuais →
      </a>
    </div>

    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">03 · Abra o Premiere e faça login</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0">
        Menu <strong>Janela → Extensões → ${pName}</strong>. Use o e-mail e a senha acima. Pronto, está liberado.
      </p>
    </div>

    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:32px 0 0;text-align:center">
      Dúvidas? Responda este e-mail ou escreva pra <a href="mailto:suporte@pacotesfx.com" style="color:#2563EB">suporte@pacotesfx.com</a>.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `✅ Bem-vindo ao ${pName} · suas credenciais + download`,
        html,
        text: `Bem-vindo ao ${pName}!\n\nSeu plano ${planName} está ativo.\n\nE-mail: ${email}\nSenha temporária: ${password}${keyPlain ? `\n\nChave ${pName}: ${keyPlain}` : ""}\n\nBaixe o plugin: ${downloadUrl}\n\nDepois abra o Premiere em Janela > Extensões > ${pName} e faça login.\n\nDúvidas: suporte@pacotesfx.com`
    });
}

function resetPasswordEmail({ email, resetUrl }) {
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Titles</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Recuperação de senha
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Recebemos uma solicitação pra redefinir a senha da sua conta Motion Titles. Clique no botão abaixo pra criar uma nova senha. <strong>O link expira em 1 hora.</strong>
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 15px Inter,Arial,sans-serif">
      Redefinir minha senha →
    </a>
    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:32px 0 0">
      Se você não solicitou, ignore este e-mail. Sua senha atual continua válida.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: "🔐 Recuperação de senha · Motion Titles",
        html,
        text: `Pra redefinir sua senha, abra: ${resetUrl}\n\nLink válido por 1 hora. Se não foi você, ignore.`
    });
}

function paymentFailedEmail({ email, retryUrl }) {
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Titles</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#dc2626;margin:0 0 18px;letter-spacing:-.5px">
      Tivemos problema com o pagamento
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      A cobrança da sua assinatura Motion Titles não foi processada. Pode ser cartão expirado, sem limite, ou bloqueio do banco. Atualize seu método de pagamento pra continuar com acesso.
    </p>
    <a href="${retryUrl || PUBLIC_URL + '/account.html'}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
      Atualizar pagamento →
    </a>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: "⚠️ Pagamento da sua assinatura Motion Titles falhou",
        html,
        text: `Não conseguimos processar o pagamento da sua assinatura. Atualize seu cartão em ${retryUrl || PUBLIC_URL + '/account.html'}`
    });
}

/**
 * Email enviado quando a license_key do user é AUTO-REVOGADA porque a
 * subscription Stripe foi cancelada OU o dunning esgotou (3-4 retries).
 * Diferente do paymentFailedEmail (que só alerta) — aqui o acesso JÁ caiu.
 */
function subscriptionSuspendedEmail({ email, productName, retryUrl }) {
    const pName = productName || "Motion Suite";
    const url = retryUrl || (PUBLIC_URL + "/account.html");
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pName}</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#dc2626;margin:0 0 18px;letter-spacing:-.5px">
      Sua licença ${pName} foi suspensa
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">
      Sua assinatura foi cancelada (ou o cartão falhou repetidas vezes) e suspendemos o acesso ao plugin. Não se preocupe: seu histórico e dados ficam preservados.
    </p>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Pra reativar agora mesmo, atualize seu método de pagamento ou contrate um novo plano:
    </p>
    <a href="${url}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
      Reativar acesso →
    </a>
    <p style="color:#888;font:400 13px Inter,Arial,sans-serif;margin:24px 0 0">
      Dúvidas? Responda este e-mail ou escreva pra <a href="mailto:suporte@pacotesfx.com" style="color:#2563EB">suporte@pacotesfx.com</a>.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `🚫 Sua licença ${pName} foi suspensa`,
        html,
        text: `Sua licença ${pName} foi suspensa porque a assinatura foi cancelada ou o pagamento falhou. Reative em ${url}`
    });
}

/**
 * Email enviado pelo cron diário quando uma license_key expira por
 * tempo (expires_at < now) — independente de Stripe webhook.
 */
function licenseExpiredEmail({ email, name, productName, pricingUrl }) {
    const pName = productName || "Motion Suite";
    const greet = name ? `Olá ${name},` : "Olá,";
    const url = pricingUrl || (PUBLIC_URL + "/#pricing");
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pName}</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.5px">
      Sua licença ${pName} expirou
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">${greet}</p>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Sua licença atingiu a data de expiração e o acesso ao plugin foi pausado. Renove em segundos pra retomar de onde parou — seus dados e configurações ficam preservados.
    </p>
    <a href="${url}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
      Renovar agora →
    </a>
    <p style="color:#888;font:400 13px Inter,Arial,sans-serif;margin:24px 0 0">
      Dúvidas? Responda este e-mail ou escreva pra <a href="mailto:suporte@pacotesfx.com" style="color:#2563EB">suporte@pacotesfx.com</a>.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `Sua licença ${pName} expirou — renove em 1 clique`,
        html,
        text: `Sua licença ${pName} expirou. Renove em ${url}`
    });
}

function verifyEmailMessage({ email, name, verifyUrl }) {
    const greet = name ? `Olá, ${name}!` : "Olá!";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Titles</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Confirme seu e-mail
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      ${greet} Bem-vindo ao Motion Titles. Pra ativar seu trial de 7 dias e garantir que você receba comunicados importantes, confirme seu e-mail clicando no botão abaixo.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 15px Inter,Arial,sans-serif">
      Confirmar meu e-mail →
    </a>
    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:28px 0 0">
      O link é válido por 7 dias. Se você não criou conta no Motion Titles, ignore este e-mail.
    </p>
    <p style="color:#888;font:400 12px/1.5 Inter,Arial,sans-serif;margin:18px 0 0;word-break:break-all">
      Se o botão não funcionar, cole no navegador:<br><span style="color:#2563EB">${verifyUrl}</span>
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: "✉️ Confirme seu e-mail · Motion Titles",
        html,
        text: `${greet} Confirme seu e-mail abrindo: ${verifyUrl}\n\nVálido por 7 dias.`
    });
}

function trialReminderEmail({ email, name, productName, daysLeft, pricingUrl }) {
    const greet = name ? `Olá, ${name.split(" ")[0]}!` : "Olá!";
    const urgency = daysLeft <= 1
        ? { color: "#dc2626", label: "ÚLTIMAS HORAS" }
        : daysLeft <= 3
        ? { color: "#ea580c", label: `${daysLeft} DIAS RESTANTES` }
        : { color: "#2563EB", label: `${daysLeft} DIAS RESTANTES` };
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <div style="display:inline-block;background:${urgency.color};color:#fff;padding:6px 12px;border-radius:99px;font:700 11px Inter,Arial,sans-serif;letter-spacing:1.5px;margin-bottom:18px">⏰ ${urgency.label}</div>
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      ${greet} Seu trial do <span style="color:#2563EB">${productName}</span> está acabando.
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Faltam <strong>${daysLeft} dia${daysLeft === 1 ? "" : "s"}</strong> pra seu acesso encerrar. Continue usando todos os títulos premium sem interrupção — escolha um plano e siga editando:
    </p>
    <a href="${pricingUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 15px Inter,Arial,sans-serif">
      Assinar agora →
    </a>
    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:24px 0 0">
      Cancele em 1 clique no portal do cliente. Sem fidelidade.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: daysLeft <= 1
            ? `⏰ Última chance: trial do ${productName} acaba hoje`
            : `⏰ Faltam ${daysLeft} dias do trial do ${productName}`,
        html,
        text: `${greet} Seu trial do ${productName} acaba em ${daysLeft} dia(s). Assine pra continuar: ${pricingUrl}`
    });
}

function trialExpiredEmail({ email, name, productName, pricingUrl }) {
    const greet = name ? `Olá, ${name.split(" ")[0]}!` : "Olá!";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      ${greet} Seu trial do <span style="color:#2563EB">${productName}</span> expirou.
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Esperamos que você tenha curtido testar. Quando quiser voltar, é só assinar — seus favoritos e configurações ficam guardados na sua conta.
    </p>
    <a href="${pricingUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 15px Inter,Arial,sans-serif">
      Ver planos →
    </a>
    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:24px 0 0">
      Suporte: <a href="mailto:suporte@pacotesfx.com" style="color:#2563EB">suporte@pacotesfx.com</a>
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `Seu trial do ${productName} terminou — volte quando quiser`,
        html,
        text: `${greet} Trial do ${productName} terminou. Volte quando quiser: ${pricingUrl}`
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// novos templates 2026-05-18

function newDeviceLoginEmail({ email, name, productName, deviceLabel, ip, country, city, ua, when, manageUrl }) {
    const pName = productName || "Motion Titles";
    const greet = name ? `Olá, ${name}!` : "Olá!";
    const loc = [city, country].filter(Boolean).join(", ") || "localização desconhecida";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 14px;letter-spacing:-.5px">
      🔐 Novo dispositivo conectado
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 22px">
      ${greet} Detectamos um login novo na sua conta ${pName}.
    </p>
    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="font:500 13px/1.9 Inter,Arial,sans-serif;color:#0a0a0a">
        <strong>Dispositivo:</strong> ${deviceLabel || "—"}<br>
        <strong>Local:</strong> ${loc}<br>
        <strong>IP:</strong> ${ip || "—"}<br>
        <strong>Quando:</strong> ${when || new Date().toISOString()}<br>
        <strong>Browser/Sistema:</strong> <span style="font-size:11px;color:#666">${(ua || "—").slice(0,80)}</span>
      </div>
    </div>
    <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 18px">
      <strong>Foi você?</strong> Pode ignorar este e-mail.<br>
      <strong>Não reconhece?</strong> Revogue acesso imediatamente:
    </p>
    <a href="${manageUrl}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
      Revogar este dispositivo →
    </a>
    <p style="color:#888;font:400 12px Inter,Arial,sans-serif;margin:24px 0 0">
      Se não foi você, sua senha pode estar comprometida. Troque ela em <a href="${manageUrl}" style="color:#2563EB">${manageUrl}</a>.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `🔐 Novo dispositivo conectado ao ${pName}`,
        html,
        text: `${greet} Novo login: ${deviceLabel} em ${loc} (IP ${ip}). Se não foi você, revogue em ${manageUrl}`
    });
}

function paymentSuccessEmail({ email, name, productName, plan, amount, invoiceUrl, manageUrl }) {
    const pName = productName || "Motion Titles";
    const greet = name ? `Olá, ${name}!` : "Olá!";
    const planName = plan === "lifetime" ? "Vitalício" : plan === "yearly" ? "Anual" : plan;
    const amountStr = typeof amount === "number" ? `R$ ${amount.toFixed(2).replace(".", ",")}` : "—";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 28px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 14px;letter-spacing:-.7px">
      ✅ Pagamento confirmado
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 22px">
      ${greet} Tudo certo com sua assinatura do <strong>${pName}</strong>.
    </p>
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="font:500 14px/1.8 Inter,Arial,sans-serif;color:#0a0a0a">
        <strong>Plano:</strong> ${planName}<br>
        <strong>Valor:</strong> ${amountStr}<br>
        ${invoiceUrl ? `<a href="${invoiceUrl}" style="color:#1d4ed8;text-decoration:underline;font-size:13px">Ver nota fiscal →</a>` : ""}
      </div>
    </div>
    <a href="${manageUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
      Gerenciar minha assinatura →
    </a>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `✅ Pagamento confirmado · ${pName}`,
        html,
        text: `${greet} Pagamento ${amountStr} ${pName} ${planName} confirmado.`
    });
}

function magicLinkEmail({ email, magicUrl, ip, expires_in_min }) {
    const minutes = expires_in_min || 15;
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 14px">🔑 Entre com 1 clique</h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 22px">
      Clique no botão abaixo pra entrar. Link válido por <strong>${minutes} minutos</strong>.
    </p>
    <a href="${magicUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:16px 28px;border-radius:6px;text-decoration:none;font:700 15px Inter,Arial,sans-serif;margin-bottom:24px">
      Entrar agora →
    </a>
    <p style="color:#888;font:400 12px Inter,Arial,sans-serif;margin:24px 0 0">
      Se não foi você que pediu, ignore este e-mail (IP: ${ip || "?"}).<br>
      Link não funciona após ${minutes}min ou se outro link mais recente for solicitado.
    </p>
  </td></tr>
</table>
${BRAND_FOOTER}
</body></html>`;
    return sendEmail({
        to: email,
        subject: `🔑 Seu link de acesso Motion Titles`,
        html,
        text: `Entre em ${minutes} min: ${magicUrl}`
    });
}

module.exports = {
    sendEmail, welcomeEmail, resetPasswordEmail, paymentFailedEmail,
    verifyEmailMessage, trialReminderEmail, trialExpiredEmail,
    newDeviceLoginEmail, paymentSuccessEmail, magicLinkEmail,
    subscriptionSuspendedEmail, licenseExpiredEmail,
};
