/* CSInterface — Adobe CEP bridge (minimal, official subset)
 * Provides communication between the panel HTML/JS and the host (Premiere Pro).
 * Based on Adobe CEP/CEP-Resources (BSD-licensed), trimmed to what MotionVault uses.
 */
function CSInterface() {
    this.hostEnvironment = this.getHostEnvironment();
}
CSInterface.prototype.getHostEnvironment = function () {
    if (typeof __adobe_cep__ === "undefined") return null;
    try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); }
    catch (e) { return null; }
};
CSInterface.prototype.evalScript = function (script, callback) {
    if (typeof callback !== "function") callback = function () {};
    if (typeof __adobe_cep__ === "undefined") {
        return callback("__not_in_cep__");
    }
    window.__adobe_cep__.evalScript(script, callback);
};
CSInterface.prototype.getSystemPath = function (pathType) {
    if (typeof __adobe_cep__ === "undefined") return "";
    var raw = window.__adobe_cep__.getSystemPath(pathType);
    // CEP retorna URI file:///C:/path no Windows e file:///path no Mac.
    // fs.existsSync e path.join exigem path local. Faz a conversão.
    if (typeof raw !== "string") return raw;
    var p = decodeURI(raw);
    if (p.indexOf("file:///") === 0) {
        // Windows: file:///C:/Users/... → C:/Users/...
        // Mac:     file:///Users/...    → /Users/...
        var stripped = p.substring(8);
        // Se começa com letra:/ é Windows. Senão prepende /
        p = (/^[A-Za-z]:\//.test(stripped)) ? stripped : ("/" + stripped);
    } else if (p.indexOf("file://") === 0) {
        p = p.substring(7);
    }
    return p;
};
CSInterface.prototype.getExtensionID = function () {
    if (typeof __adobe_cep__ === "undefined") return "dev";
    return window.__adobe_cep__.getExtensionId();
};
CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    if (typeof cep !== "undefined") cep.util.openURLInDefaultBrowser(url);
    else window.open(url, "_blank");
};
CSInterface.prototype.addEventListener = function (type, listener) {
    if (typeof __adobe_cep__ === "undefined") return;
    window.__adobe_cep__.addEventListener(type, listener, null);
};
CSInterface.prototype.dispatchEvent = function (event) {
    if (typeof __adobe_cep__ === "undefined") return;
    window.__adobe_cep__.dispatchEvent(event);
};
CSInterface.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension"
};
