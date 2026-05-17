"use strict";
/**
 * Mailer leve. Usa Resend se RESEND_API_KEY estiver setado, senão fallback log.
 * Resend free tier: 3000 emails/mês, dominio padrão onboarding@resend.dev
 * (depois você configura motionvault.app via DNS).
 */
const FROM      = process.env.EMAIL_FROM || "MotionVault <onboarding@resend.dev>";
const RESEND    = process.env.RESEND_API_KEY;
const PUBLIC_URL = process.env.PUBLIC_URL || "https://motionpro-lp.vercel.app";

async function sendEmail({ to, subject, html, text }) {
    if (!RESEND) {
        console.warn("[email] RESEND_API_KEY not set — would have sent:", { to, subject });
        return { ok: false, skipped: true, reason: "no_api_key" };
    }
    try {
        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + RESEND,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ from: FROM, to, subject, html, text })
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
      Motion<span style="color:#2563EB">·</span>Vault
    </div>
  </td></tr>
</table>`;

const BRAND_FOOTER = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px;margin-top:32px">
  <tr><td align="center" style="color:#888;font:400 12px Inter,Arial,sans-serif">
    © ${new Date().getFullYear()} MotionVault · uma marca PacotesFX<br>
    Se você não esperava este e-mail, ignore.
  </td></tr>
</table>`;

function welcomeEmail({ email, password, plan, downloadUrl }) {
    const planName = plan === "lifetime" ? "Vitalício" : plan === "yearly" ? "Anual" : plan;
    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 28px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Bem-vindo ao MotionVault.
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
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">02 · Instale o plugin</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0 0 16px">
        Baixe o instalador, dê duplo clique e siga as instruções. Funciona em Windows e macOS, Premiere Pro CC 2019+.
      </p>
      <a href="${downloadUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font:600 14px Inter,Arial,sans-serif">
        Baixar o instalador →
      </a>
    </div>

    <div style="background:#f6f6f8;border:1px solid #e6e6ea;border-radius:8px;padding:20px">
      <div style="font:600 11px Inter,Arial,sans-serif;color:#2563EB;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">03 · Abra o Premiere e faça login</div>
      <p style="color:#444;font:400 14px/1.6 Inter,Arial,sans-serif;margin:0">
        Menu <strong>Janela → Extensões → MotionVault</strong>. Use o e-mail e a senha acima. Pronto, os 7.906 templates estão liberados.
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
        subject: "✅ Bem-vindo ao MotionVault · suas credenciais + download",
        html,
        text: `Bem-vindo ao MotionVault!\n\nSeu plano ${planName} está ativo.\n\nE-mail: ${email}\nSenha temporária: ${password}\n\nBaixe o plugin: ${downloadUrl}\n\nDepois abra o Premiere em Janela > Extensões > MotionVault e faça login.\n\nDúvidas: suporte@pacotesfx.com`
    });
}

function resetPasswordEmail({ email, resetUrl }) {
    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 26px Inter,Arial,sans-serif;color:#0a0a0a;margin:0 0 18px;letter-spacing:-.8px">
      Recuperação de senha
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      Recebemos uma solicitação pra redefinir a senha da sua conta MotionVault. Clique no botão abaixo pra criar uma nova senha. <strong>O link expira em 1 hora.</strong>
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
        subject: "🔐 Recuperação de senha · MotionVault",
        html,
        text: `Pra redefinir sua senha, abra: ${resetUrl}\n\nLink válido por 1 hora. Se não foi você, ignore.`
    });
}

function paymentFailedEmail({ email, retryUrl }) {
    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f8;font-family:Inter,Arial,sans-serif">
${BRAND_HEADER}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;max-width:560px;margin:0 auto">
  <tr><td style="padding:48px 40px 32px">
    <h1 style="font:800 24px Inter,Arial,sans-serif;color:#dc2626;margin:0 0 18px;letter-spacing:-.5px">
      Tivemos problema com o pagamento
    </h1>
    <p style="color:#444;font:400 15px/1.6 Inter,Arial,sans-serif;margin:0 0 24px">
      A cobrança da sua assinatura MotionVault não foi processada. Pode ser cartão expirado, sem limite, ou bloqueio do banco. Atualize seu método de pagamento pra continuar com acesso.
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
        subject: "⚠️ Pagamento da sua assinatura MotionVault falhou",
        html,
        text: `Não conseguimos processar o pagamento da sua assinatura. Atualize seu cartão em ${retryUrl || PUBLIC_URL + '/account.html'}`
    });
}

module.exports = { sendEmail, welcomeEmail, resetPasswordEmail, paymentFailedEmail };
