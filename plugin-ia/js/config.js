/* Motion IA · config */
window.MV_CONFIG = {
    // MotionVault backend (auth + licenciamento)
    apiBaseUrl: "https://motionpro.vercel.app",
    productId: "ia",
    productName: "Motion IA",
    landingUrl: "https://motionpro-lp.vercel.app",
    pricingUrl: "https://motionpro-lp.vercel.app/ia/#pricing",
    devMode: false,

    // Motor IA local — Next.js do VIDEO-PRO-IA rodando em localhost
    videoEditorUrl: "http://localhost:3333",
    // adb-proxy-socket: ponte Next.js ↔ UXP plugin no Premiere
    adbProxyUrl: "http://localhost:3001",

    // Launchers (chamados automaticamente quando offline)
    videoEditorStartScript: "C:\\Users\\Gabriel\\Downloads\\VIDEO-PRO-IA\\start-videopro.cmd",
    videoEditorStopScript:  "C:\\Users\\Gabriel\\Downloads\\VIDEO-PRO-IA\\stop-videopro.cmd",
    adbProxyStartScript:    "C:\\Users\\Gabriel\\Downloads\\VIDEO-PRO-IA\\premiere-plugin\\client\\start-adb-proxy.vbs",

    // Auto-conectar tudo no boot (sem precisar clicar)
    autoConnect: true
};
