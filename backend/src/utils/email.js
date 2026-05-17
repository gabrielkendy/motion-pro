"use strict";
/**
 * Mailer leve. Usa Resend se RESEND_API_KEY estiver setado, senão fallback log.
 * Resend free tier: 3000 emails/mês, dominio padrão onboarding@resend.dev
 * (depois você configura motionvault.app via DNS).
 */
const FROM      = process.env.EMAIL_FROM || "MotionPro <onboarding@resend.dev>";
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
    © ${new Date().getFullYear()} MotionPro · uma marca PacotesFX<br>
    Se você não esperava este e-mail, ignore.
  </td></tr>
</table>`;

function welcomeEmail({ email, password, plan, downloadUrl, productName }) {
    const planName = plan === "lifetime" ? "Vitalício" : plan === "yearly" ? "Anual" : plan;
    const pName = productName || "MotionPro";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotionPro</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
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

    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px;margin-bottom:32px">
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
        text: `Bem-vindo ao ${pName}!\n\nSeu plano ${planName} está ativo.\n\nE-mail: ${email}\nSenha temporária: ${password}\n\nBaixe o plugin: ${downloadUrl}\n\nDepois abra o Premiere em Janela > Extensões > ${pName} e faça login.\n\nDúvidas: suporte@pacotesfx.com`
    });
}

function resetPasswordEmail({ email, resetUrl }) {
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotionPro</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Recuperação de senha
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Recebemos uma solicitação pra redefinir a senha da sua conta MotionPro. Clique no botão abaixo pra criar uma nova senha. <strong>O link expira em 1 hora.</strong>
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
        subject: "🔐 Recuperação de senha · MotionPro",
        html,
        text: `Pra redefinir sua senha, abra: ${resetUrl}\n\nLink válido por 1 hora. Se não foi você, ignore.`
    });
}

function paymentFailedEmail({ email, retryUrl }) {
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotionPro</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#dc2626;margin:0 0 18px;letter-spacing:-.5px">
      Tivemos problema com o pagamento
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      A cobrança da sua assinatura MotionPro não foi processada. Pode ser cartão expirado, sem limite, ou bloqueio do banco. Atualize seu método de pagamento pra continuar com acesso.
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
        subject: "⚠️ Pagamento da sua assinatura MotionPro falhou",
        html,
        text: `Não conseguimos processar o pagamento da sua assinatura. Atualize seu cartão em ${retryUrl || PUBLIC_URL + '/account.html'}`
    });
}

function verifyEmailMessage({ email, name, verifyUrl }) {
    const greet = name ? `Olá, ${name}!` : "Olá!";
    const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotionPro</title></head><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Confirme seu e-mail
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      ${greet} Bem-vindo ao MotionPro. Pra ativar seu trial de 14 dias e garantir que você receba comunicados importantes, confirme seu e-mail clicando no botão abaixo.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font:600 15px Inter,Arial,sans-serif">
      Confirmar meu e-mail →
    </a>
    <p style="color:#888;font:400 13px/1.6 Inter,Arial,sans-serif;margin:28px 0 0">
      O link é válido por 7 dias. Se você não criou conta no MotionPro, ignore este e-mail.
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
        subject: "✉️ Confirme seu e-mail · MotionPro",
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

module.exports = { sendEmail, welcomeEmail, resetPasswordEmail, paymentFailedEmail, verifyEmailMessage, trialReminderEmail, trialExpiredEmail };
