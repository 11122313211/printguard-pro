/* ====================================================================
 * PrintGuard CEP 面板 · 最小 CSInterface 兼容层
 * 仅封装 evalScript / 打开浏览器两个能力，避免携带完整官方库。
 * ==================================================================== */
function CSInterface() { }

CSInterface.prototype.evalScript = function (script, callback) {
  var cb = callback || function () { };
  try {
    if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
      window.__adobe_cep__.evalScript(script, cb);
    } else {
      cb('ERR_NO_CEP_RUNTIME');
    }
  } catch (e) {
    cb('ERR:' + (e && e.message ? e.message : e));
  }
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
  try {
    if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
      window.cep.util.openURLInDefaultBrowser(url);
    } else if (window.__adobe_cep__ && window.__adobe_cep__.openURLInDefaultBrowser) {
      window.__adobe_cep__.openURLInDefaultBrowser(url);
    }
  } catch (e) { /* 打开失败由面板内文案兜底 */ }
};
