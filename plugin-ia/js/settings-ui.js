/* settings-ui.js — Motion IA v4
 * aba CONFIG no plugin Motion IA · refatorada pra Gemini Flash
 *
 * Em v4 a Gemini key fica em localStorage (gerenciada por GeminiClient).
 * Backend ainda armazena: model, max_tokens, motor_url, mcp_url, custom_system.
 *
 * NOTA: o handler primário de salvar/testar agora vive em app.js (#set-save,
 * #set-test) porque ele lida com Gemini/Pexels/etc tudo junto. Esse arquivo
 * só faz: carregar settings do backend ao abrir Config + expor reload pra UI.
 */
(function () {
    "use strict";
    var API = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";

    function $(id) { return document.getElementById(id); }
    function token() {
        return localStorage.getItem("mv_session") || localStorage.getItem("mia_session_token") || "";
    }

    async function loadSettings() {
        var t = token();
        if (!t) return null;
        try {
            var r = await fetch(API + "/v1/me/ai-settings", { headers: { "Authorization": "Bearer " + t } });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) { return null; }
    }

    async function saveSettings(payload) {
        var t = token();
        if (!t) throw new Error("not_logged_in");
        var r = await fetch(API + "/v1/me/ai-settings", {
            method: "PUT",
            headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!r.ok) {
            var txt = await r.text();
            throw new Error("save_" + r.status + ": " + txt);
        }
        return await r.json();
    }

    async function resetSettings() {
        var t = token();
        var r = await fetch(API + "/v1/me/ai-settings/reset", {
            method: "POST",
            headers: { "Authorization": "Bearer " + t }
        });
        return await r.json();
    }

    // Aplica settings do backend nos campos UI (model, max_tokens, motor, mcp).
    // Gemini key NÃO vem daqui — ela tá no localStorage (campo set-gemini-key
    // já tem placeholder atualizado por app.js quando GeminiClient.hasKey()).
    function populateUI(s) {
        if (!s) return;
        if (s.model) {
            var modelEl = $("set-model");
            if (modelEl) modelEl.value = s.model;
        }
        if (s.max_tokens) {
            var mt = $("set-max-tokens");
            if (mt) mt.value = s.max_tokens;
        }
        var motorUrl = $("set-motor-url");
        if (motorUrl && s.motor_url) motorUrl.value = s.motor_url;
        var motorEnabled = $("set-motor-enabled");
        if (motorEnabled && typeof s.motor_enabled === "boolean") motorEnabled.checked = s.motor_enabled;
        var mcpUrl = $("set-mcp-url");
        if (mcpUrl && s.mcp_url) mcpUrl.value = s.mcp_url;
        var mcpEnabled = $("set-mcp-enabled");
        if (mcpEnabled && typeof s.mcp_enabled === "boolean") mcpEnabled.checked = s.mcp_enabled;
    }

    // Init quando tab CONFIG abrir pela primeira vez
    var initialized = false;
    async function initIfNeeded() {
        if (initialized) return;
        initialized = true;
        var s = await loadSettings();
        if (s) populateUI(s);
    }

    // Expor pra app.js disparar
    window.SettingsUI = {
        init:    initIfNeeded,
        reload:  async function () {
            var s = await loadSettings();
            if (s) populateUI(s);
            return s;
        },
        save:    saveSettings,   // app.js usa pra salvar model/max_tokens/motor/mcp
        reset:   resetSettings
    };
})();
