/* config.js — central plugin configuration.
 * Carregado antes do app.js. Edite aqui pra apontar pro backend e ligar/desligar
 * o modo dev.
 */
window.MV_CONFIG = {
    // URL do backend MotionVault em produção (Vercel)
    apiBaseUrl: "https://motionpro.vercel.app",

    // Produto deste plugin dentro da Motion Suite.
    // Backend β unificou os prefixos: titles=MTI-, legendas=MTL-, ia=MIA-, suite=MTS-.
    productId:   "titles",
    productName: "Motion Titles",

    // Landing site (cross-sell + OAuth bridge + reset-password + pricing)
    landingUrl: "https://motionpro-lp.vercel.app",
    pricingUrl: "https://motionpro-lp.vercel.app/titles/#pricing",

    // Chave pública pra verificar licenças JWT legacy localmente (RS256) — opcional.
    // Sistema novo (license-keys MTI-/MTS-, Chunk 3) NÃO usa esta chave.
    licensePublicKey: "MV_PUB_KEY_PLACEHOLDER",

    // DEV MODE: true = libera tudo sem login (só pra desenvolvimento)
    //           false = exige conta + assinatura (produção)
    devMode: false,
    devPlan: "lifetime",
    devEmail: "dev@local"
};
