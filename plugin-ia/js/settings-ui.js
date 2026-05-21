/* settings-ui.js — aba CONFIG no plugin Motion IA
 * Sincroniza com backend /v1/me/ai-settings/* via Bearer session_token.
 */
(function () {
    "use strict";
    var API = (window.MV_CONFIG && window.MV_CONFIG.apiBaseUrl) || "https://motionpro.vercel.app";

    function $(id) { return document.getElementById(id); }
    function token() {
        return localStorage.getItem("mv_session") || localStorage.getItem("mia_session_token") || "";
    }
    function showStatus(el, msg, kind) {
        if (!el) return;
        var color = kind === "ok" ? "#10b981" : kind === "err" ? "#ef4444" : kind === "warn" ? "#f59e0b" : "#8590a8";
        el.style.color = color;
        el.textContent = msg;
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

    async function validateAll(payload) {
        var t = token();
        if (!t) throw new Error("not_logged_in");
        var r = await fetch(API + "/v1/me/ai-settings/validate", {
            method: "POST",
            headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
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

    function populateUI(s) {
        if (!s) return;
        if (s.anthropic_key_set && s.anthropic_key_mask) {
            $("set-anthropic-key").placeholder = "Já configurado: " + s.anthropic_key_mask;
        }
        if (s.model) $("set-model").value = s.model;
        if (s.max_tokens) $("set-max-tokens").value = s.max_tokens;
        if (s.motor_url) $("set-motor-url").value = s.motor_url;
        if (typeof s.motor_enabled === "boolean") $("set-motor-enabled").checked = s.motor_enabled;
        if (s.mcp_url) $("set-mcp-url").value = s.mcp_url;
        if (typeof s.mcp_enabled === "boolean") $("set-mcp-enabled").checked = s.mcp_enabled;
    }

    function gather() {
        var payload = {
            model: $("set-model").value,
            max_tokens: parseInt($("set-max-tokens").value, 10) || 4096,
            motor_url: $("set-motor-url").value.trim() || null,
            motor_enabled: $("set-motor-enabled").checked,
            mcp_url: $("set-mcp-url").value.trim() || null,
            mcp_enabled: $("set-mcp-enabled").checked
        };
        var k = $("set-anthropic-key").value.trim();
        if (k) payload.anthropic_key = k;
        return payload;
    }

    function bind() {
        // Toggle show key
        $("set-key-show").onclick = function () {
            var i = $("set-anthropic-key");
            i.type = i.type === "password" ? "text" : "password";
        };

        // Save
        $("set-save").onclick = async function () {
            var btn = $("set-save");
            var status = $("set-result");
            var keyStatus = $("set-key-status");
            // Validação front: se digitou key, tem que começar com sk-ant-
            var keyRaw = $("set-anthropic-key").value.trim();
            if (keyRaw && !keyRaw.startsWith("sk-ant-")) {
                showStatus(keyStatus, "❌ Key inválida — deve começar com 'sk-ant-'. Você colou outra coisa?", "err");
                return;
            }
            btn.disabled = true; btn.textContent = "Salvando…";
            try {
                var payload = gather();
                var r = await saveSettings(payload);
                showStatus(status, "✓ Salvo: " + (r.updated_fields || []).join(", "), "ok");
                if (payload.anthropic_key) {
                    showStatus(keyStatus, "Key salva. Limpando do campo por segurança.", "ok");
                    $("set-anthropic-key").value = "";
                }
                // Recarrega pra atualizar mask
                var s = await loadSettings();
                if (s) populateUI(s);
                if (window.Agent && window.Agent.clearKeyCache) window.Agent.clearKeyCache();
            } catch (e) {
                showStatus(status, "❌ " + e.message, "err");
            } finally {
                btn.disabled = false; btn.textContent = "💾 Salvar tudo";
            }
        };

        // Test
        $("set-test").onclick = async function () {
            var btn = $("set-test");
            var status = $("set-result");
            btn.disabled = true; btn.textContent = "Testando…";
            showStatus(status, "Testando Anthropic + motor + mcp…", "info");
            try {
                var payload = {
                    model: $("set-model").value,
                    motor_url: $("set-motor-url").value.trim() || null,
                    mcp_url: $("set-mcp-url").value.trim() || null
                };
                var k = $("set-anthropic-key").value.trim();
                if (k) payload.anthropic_key = k;
                var r = await validateAll(payload);
                var lines = [];
                lines.push((r.anthropic.ok ? "✓" : "✗") + " Anthropic: " + (r.anthropic.ok ? ("OK · modelo " + r.anthropic.model) : r.anthropic.error));
                if (r.motor.tested) lines.push((r.motor.ok ? "✓" : "✗") + " Motor: " + (r.motor.ok ? "OK" : r.motor.error));
                else lines.push("○ Motor: não testado (sem URL)");
                if (r.mcp.tested) lines.push((r.mcp.ok ? "✓" : "✗") + " MCP: " + (r.mcp.ok ? "OK" : r.mcp.error));
                else lines.push("○ MCP: não testado (sem URL)");
                status.innerHTML = lines.join("<br>");
                status.style.color = r.anthropic.ok ? "#10b981" : "#ef4444";
            } catch (e) {
                showStatus(status, "❌ " + e.message, "err");
            } finally {
                btn.disabled = false; btn.textContent = "🧪 Testar conexões";
            }
        };

        // Reset
        $("set-reset").onclick = async function () {
            if (!confirm("Apagar TODA a config? (API key, modelo, motor, MCP). Você terá que reconfigurar.")) return;
            try {
                await resetSettings();
                $("set-anthropic-key").value = "";
                $("set-anthropic-key").placeholder = "sk-ant-…";
                $("set-motor-url").value = "";
                $("set-motor-enabled").checked = false;
                $("set-mcp-url").value = "";
                $("set-mcp-enabled").checked = false;
                $("set-model").value = "claude-sonnet-4-6";
                $("set-max-tokens").value = 4096;
                showStatus($("set-result"), "✓ Reset feito.", "ok");
                if (window.Agent && window.Agent.clearKeyCache) window.Agent.clearKeyCache();
            } catch (e) {
                showStatus($("set-result"), "❌ " + e.message, "err");
            }
        };
    }

    // Init quando tab CONFIG abrir pela primeira vez
    var initialized = false;
    async function initIfNeeded() {
        if (initialized) return;
        initialized = true;
        bind();
        var s = await loadSettings();
        if (s) populateUI(s);
    }

    // Expor pra app.js disparar
    window.SettingsUI = {
        init: initIfNeeded,
        reload: async function () {
            var s = await loadSettings();
            if (s) populateUI(s);
            return s;
        }
    };
})();
