/* config.js — central plugin configuration.
 * Carregado antes do app.js. Edite aqui pra apontar pro backend e ligar/desligar
 * o modo dev.
 */
window.MV_CONFIG = {
    // URL do backend MotionVault em produção (Vercel)
    apiBaseUrl: "https://motionpro.vercel.app",

    // Chave pública pra verificar licenças JWT localmente (RS256) — opcional
    // Quando usando HS256 (dev), deixe placeholder; verificação completa é via backend
    licensePublicKey: "MV_PUB_KEY_PLACEHOLDER",

    // DEV MODE: true = libera tudo sem login (só pra desenvolvimento)
    //           false = exige conta + assinatura (produção)
    devMode: false,
    devPlan: "lifetime",
    devEmail: "dev@local"
};
