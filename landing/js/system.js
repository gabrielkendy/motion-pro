/* ════════════════════════════════════════════════════════════════
   Motion Titles · SYSTEM JS
   Auth modal, nav inteligente, scroll progress, reveal, WhatsApp FAB,
   toast, e helper de API. Compartilhado por TODAS as páginas.
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ---------- CONFIG ----------
  window.MV_API = window.MV_API || "https://motionpro.vercel.app";
  const TOKEN_KEY = "mv_session";
  const EMAIL_KEY = "mv_email";

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- HELPERS ----------
  window.MV = window.MV || {};

  window.MV.api = async function (path, body, headers = {}) {
    const r = await fetch(window.MV_API + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  };

  window.MV.token = () => localStorage.getItem(TOKEN_KEY);
  window.MV.email = () => localStorage.getItem(EMAIL_KEY);

  window.MV.toast = function (msg, type = '', ms = 3500) {
    let el = document.getElementById('mv-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mv-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast ' + type + ' show';
    clearTimeout(el._hideTm);
    el._hideTm = setTimeout(() => el.classList.remove('show'), ms);
  };

  window.MV.logout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    window.location.href = '/';
  };

  window.MV.checkout = async function (plan) {
    const token = window.MV.token();
    const savedEmail = window.MV.email();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(window.MV_API + '/v1/billing/checkout?plan=' + plan, {
      method: 'POST',
      headers,
      body: savedEmail ? JSON.stringify({ email: savedEmail }) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.error || 'checkout_failed');
    window.location.href = data.url;
  };

  // ---------- SCROLL: 1 listener único pra nav + progress + WhatsApp FAB ----------
  function initScroll() {
    const nav = document.querySelector('.nav');
    const bar = document.querySelector('.scroll-progress');
    const fab = document.querySelector('.wa-fab');
    if (!nav && !bar && !fab) return;

    let lastY = 0, ticking = false;
    function update() {
      const h = document.documentElement;
      const y = window.scrollY || h.scrollTop || 0;

      if (nav) {
        if (y > 50) nav.classList.add('scrolled'); else nav.classList.remove('scrolled');
        if (y > 200 && y > lastY + 4) nav.classList.add('hidden');
        else if (y < lastY - 4) nav.classList.remove('hidden');
      }
      if (bar) {
        const max = h.scrollHeight - h.clientHeight;
        const p = max > 0 ? (y / max) : 0;
        bar.style.width = (Math.max(0, Math.min(1, p)) * 100) + '%';
      }
      if (fab) {
        if (y > 400) fab.classList.add('show'); else fab.classList.remove('show');
      }
      lastY = y;
      ticking = false;
    }
    function onScroll() {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  // ---------- REVEAL ON SCROLL (skip se home tá usando GSAP) ----------
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (reduced) {
      els.forEach(el => el.classList.add('in'));
      return;
    }
    // Se o ScrollTrigger.batch da home já está rodando, pula
    if (window.__MV_GSAP_REVEAL__) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => io.observe(el));
  }

  // ---------- AUTH MODAL ----------
  function ensureModal() {
    if (document.getElementById('auth-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="auth-modal" class="modal" hidden>
  <div class="modal__overlay"></div>
  <div class="modal__card">
    <button class="modal__close" id="modal-close" aria-label="Fechar">×</button>
    <div class="modal__head">
      <span class="modal__tag" id="modal-tag">— CRIAR CONTA</span>
      <h2 id="modal-title">Comece sua assinatura</h2>
      <p id="modal-sub">Crie sua conta pra ir pro checkout. 7 dias trial sem cartão.</p>
    </div>
    <form id="auth-form" class="modal__form">
      <div class="form-row">
        <label for="auth-email">E-mail</label>
        <input type="email" id="auth-email" autocomplete="email" required>
      </div>
      <div class="form-row">
        <label for="auth-pass">Senha</label>
        <input type="password" id="auth-pass" autocomplete="new-password" minlength="8" required>
        <small>Mínimo 8 caracteres</small>
      </div>
      <div id="auth-error" class="modal__error" style="display:none"></div>
      <button type="submit" class="btn btn-primary btn-full btn-lg" id="auth-submit">
        Criar conta e continuar <span class="arrow">→</span>
      </button>
      <p class="modal__switch">
        <span data-switch="login">Já tem conta? <strong>Entrar</strong></span>
        <span data-switch="signup" hidden>Não tem conta? <strong>Criar agora</strong></span>
      </p>
      <p class="modal__forgot" id="forgot-link" hidden>
        <a href="/reset-password.html"><strong>Esqueci minha senha</strong></a>
      </p>
    </form>
  </div>
</div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  let modalMode = 'signup', pendingPlan = null;

  function openModal(mode = 'signup', plan = null) {
    ensureModal();
    modalMode = mode; pendingPlan = plan;
    const $ = (id) => document.getElementById(id);
    const titles = {
      signup: {
        tag: plan ? '— CRIAR CONTA · ' + (plan === 'yearly' ? 'ANUAL' : 'VITALÍCIO') : '— CRIAR CONTA',
        h2:  plan ? 'Falta pouco pro checkout' : 'Crie sua conta',
        sub: plan
          ? 'Crie sua conta em 10 segundos. Em seguida você vai pro pagamento seguro do Stripe.'
          : '7 dias de trial sem cartão. Cancele quando quiser.',
        cta: (plan ? 'Criar conta e ir pro checkout' : 'Criar conta') + ' <span class="arrow">→</span>'
      },
      login: {
        tag: plan ? '— ENTRAR · ' + (plan === 'yearly' ? 'ANUAL' : 'VITALÍCIO') : '— ENTRAR',
        h2:  'Entre na sua conta',
        sub: plan ? 'Já tem conta? Entre agora e siga pro checkout.' : 'Acesse com seu e-mail e senha.',
        cta: (plan ? 'Entrar e ir pro checkout' : 'Entrar') + ' <span class="arrow">→</span>'
      }
    };
    const t = titles[mode];
    $('modal-tag').textContent = t.tag;
    $('modal-title').textContent = t.h2;
    $('modal-sub').textContent = t.sub;
    $('auth-submit').innerHTML = t.cta;
    $('auth-pass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    document.querySelector('[data-switch="login"]').hidden  = mode !== 'signup';
    document.querySelector('[data-switch="signup"]').hidden = mode !== 'login';
    $('forgot-link').hidden = mode !== 'login';
    $('auth-error').style.display = 'none';
    $('auth-error').textContent = '';
    const savedEmail = window.MV.email();
    if (savedEmail && mode === 'login') $('auth-email').value = savedEmail;
    $('auth-modal').hidden = false;
    setTimeout(() => $('auth-email').focus(), 60);
  }

  function closeModal() {
    const m = document.getElementById('auth-modal');
    if (m) { m.hidden = true; const p = document.getElementById('auth-pass'); if (p) p.value = ''; }
  }

  function bindModal() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.closest('[data-action="login"]'))  { e.preventDefault(); openModal('login',  null); }
      if (t.closest('[data-action="signup"]')) { e.preventDefault(); openModal('signup', null); }
      if (t.closest('[data-buy]')) {
        e.preventDefault();
        const plan = t.closest('[data-buy]').dataset.buy;
        // Stripe checkout direto (sem signup obrigatório — backend cria conta via webhook)
        const btn = t.closest('[data-buy]');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Indo pra Stripe...';
        window.MV.checkout(plan).catch(err => {
          window.MV.toast('Erro ao iniciar checkout: ' + err.message, 'error');
          btn.disabled = false;
          btn.innerHTML = orig;
        });
      }
      if (t.id === 'modal-close' || t.classList.contains('modal__overlay')) closeModal();
      if (t.closest('[data-switch]')) {
        const next = t.closest('[data-switch]').dataset.switch;
        openModal(next, pendingPlan);
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.getElementById('auth-modal');
        if (m && !m.hidden) closeModal();
      }
    });
    document.addEventListener('submit', async (e) => {
      if (e.target.id !== 'auth-form') return;
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim().toLowerCase();
      const pass  = document.getElementById('auth-pass').value;
      const err   = document.getElementById('auth-error');
      const btn   = document.getElementById('auth-submit');
      const orig  = btn.innerHTML;
      err.style.display = 'none'; err.textContent = '';
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...';
      try {
        const path = modalMode === 'signup' ? '/v1/auth/signup' : '/v1/auth/login';
        const session = await window.MV.api(path, { email, password: pass });
        localStorage.setItem(TOKEN_KEY, session.session_token);
        localStorage.setItem(EMAIL_KEY, email);
        if (pendingPlan) {
          btn.innerHTML = '<span class="spinner"></span> Indo pra Stripe...';
          await window.MV.checkout(pendingPlan);
        } else {
          window.MV.toast('Conectado com sucesso!', 'success');
          closeModal();
          // Refresh é útil em páginas de conta
          if (typeof window.MV.onAuth === 'function') window.MV.onAuth(session);
        }
      } catch (e2) {
        const msgs = {
          email_taken: 'Esse e-mail já tem conta. Vou abrir a tela de login.',
          invalid_credentials: 'E-mail ou senha incorretos.',
          email_and_password_required: 'Preencha e-mail e senha (mín. 8 caracteres).',
          unknown_plan: 'Plano inválido. Recarregue a página.'
        };
        err.textContent = msgs[e2.message] || ('Erro: ' + e2.message);
        err.style.display = 'block';
        if (e2.message === 'email_taken') setTimeout(() => openModal('login', pendingPlan), 700);
      } finally {
        btn.disabled = false;
        if (btn.innerHTML.includes('spinner')) btn.innerHTML = orig;
      }
    });
  }

  // Permite a outras páginas dispararem o modal já com plano específico
  window.MV.openAuth = openModal;
  window.MV.closeAuth = closeModal;

  // ---------- HEADER/FOOTER INJETADOS ----------
  // Páginas internas declaram `<div data-include="header"></div>` e
  // `<div data-include="footer"></div>` e o system.js injeta o markup padrão.
  const HEADER_HTML = `
<header class="nav">
  <div class="container nav-inner">
    <a href="/" class="logo" aria-label="Motion Suite home">
      <span class="logo-dot"></span>Motion Suite
    </a>
    <nav aria-label="Principal">
      <ul class="nav-links">
        <li><a href="/titles/">Titles</a></li>
        <li><a href="/legendas/">Legendas</a></li>
        <li><a href="/ia/">IA</a></li>
        <li><a href="/#planos">Preços</a></li>
        <li><a href="/docs/">Docs</a></li>
      </ul>
    </nav>
    <div class="nav-right">
      <a href="/account.html" class="link-login" data-action="login">Entrar</a>
      <a href="/#planos" class="btn btn-primary">Quero a Suite</a>
    </div>
  </div>
</header>`;

  const FOOTER_HTML = `
<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="logo"><span class="logo-dot"></span>Motion Suite</div>
        <p class="footer-tag">Três plugins. Um Premiere. Sua edição inteira mais rápida. Construído por editor, pra editor.</p>
        <div class="footer-copy">© <span data-yr></span> · PacotesFX</div>
      </div>
      <div class="footer-col"><h5>Produtos</h5><ul>
        <li><a href="/titles/">Motion Titles</a></li>
        <li><a href="/legendas/">Motion Legendas</a></li>
        <li><a href="/ia/">Motion IA</a></li>
        <li><a href="/#planos">A Suite (combo)</a></li>
      </ul></div>
      <div class="footer-col"><h5>Recursos</h5><ul>
        <li><a href="/#produtos">Os três plugins</a></li>
        <li><a href="/#planos">Preços</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a href="/docs/">Docs</a></li>
      </ul></div>
      <div class="footer-col"><h5>Conta</h5><ul>
        <li><a href="/account.html">Entrar</a></li>
        <li><a href="/#planos">Assinar</a></li>
        <li><a href="/reset-password.html">Esqueci a senha</a></li>
      </ul></div>
      <div class="footer-col"><h5>Legal</h5><ul>
        <li><a href="/terms.html">Termos de uso</a></li>
        <li><a href="/privacy.html">Privacidade</a></li>
        <li><a href="/seguranca.html">Segurança</a></li>
        <li><a href="mailto:suporte@pacotesfx.com">suporte@pacotesfx.com</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>Brasil · Belo Horizonte</span>
      <span>v3.0 Motion Suite · <span data-yr></span></span>
    </div>
  </div>
</footer>
<a class="wa-fab"
   href="https://wa.me/5531997554040?text=Quero%20conhecer%20o%20MotionPro"
   target="_blank" rel="noopener noreferrer"
   aria-label="Falar no WhatsApp">
  <span class="wa-fab-label">
    <strong>Fala com a gente</strong>
    <small>31 99755-4040</small>
  </span>
  <span class="wa-fab-btn" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488"/></svg>
  </span>
</a>
<div class="scroll-progress" aria-hidden="true"></div>`;

  function injectIncludes() {
    document.querySelectorAll('[data-include="header"]').forEach(el => el.outerHTML = HEADER_HTML);
    document.querySelectorAll('[data-include="footer"]').forEach(el => el.outerHTML = FOOTER_HTML);
  }
  injectIncludes();

  // ---------- COOKIE BANNER LGPD ----------
  // Persistência via localStorage chave "mv_cookie_consent" = "accepted" | "declined".
  // Mostra após 1.2s se ainda não tem decisão. Expõe window.MV.hasCookieConsent().
  const COOKIE_KEY = "mv_cookie_consent";
  window.MV.hasCookieConsent = function () {
    return localStorage.getItem(COOKIE_KEY) === "accepted";
  };
  function initCookieBanner() {
    // Não injeta se a página já está marcada como sem banner (ex.: páginas internas legais)
    if (document.body.dataset.cookieBanner === "skip") return;
    if (localStorage.getItem(COOKIE_KEY)) return; // já decidiu

    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div class="cookie-banner" role="dialog" aria-live="polite" aria-label="Aviso de cookies">
  <button class="cookie-banner__close" data-cookie="close" aria-label="Fechar">×</button>
  <div class="cookie-banner__title">A gente usa cookies.</div>
  <p class="cookie-banner__text">
    Cookies essenciais pra login + analytics anônimo pra entender o que está funcionando. Nada de rastreamento de terceiros pesado.
    Veja a <a href="/privacy.html">Política de Privacidade</a> e os <a href="/terms.html">Termos</a>.
  </p>
  <div class="cookie-banner__actions">
    <button class="btn btn-primary" data-cookie="accept">Aceitar todos</button>
    <button class="btn btn-ghost" data-cookie="decline">Só essenciais</button>
  </div>
</div>`;
    const banner = wrap.firstElementChild;
    document.body.appendChild(banner);

    // Reveal com pequeno delay pra não brigar com hero animations
    setTimeout(() => banner.classList.add('show'), 1200);

    banner.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cookie]');
      if (!t) return;
      const action = t.dataset.cookie;
      if (action === 'accept') {
        localStorage.setItem(COOKIE_KEY, 'accepted');
      } else if (action === 'decline') {
        localStorage.setItem(COOKIE_KEY, 'declined');
      }
      // "close" não persiste — banner volta na próxima visita
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 600);
    });
  }

  // ---------- INIT ----------
  function init() {
    initScroll();
    initReveal();
    bindModal();
    initCookieBanner();
    // year footer
    document.querySelectorAll('[data-yr]').forEach(el => el.textContent = new Date().getFullYear());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
