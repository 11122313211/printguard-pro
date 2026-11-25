/* ====================================================================
 * PrintGuard Pro · Color Workshop Bridge — 跨项目工艺护照门禁与专色色域桥接
 * --------------------------------------------------------------------
 * 职责（P0-#2：打通 printguard-pro ↔ color-workshop）：
 *   1. 拉取 color-workshop 工艺列表与工艺护照指纹（ICC SHA-256 / passport_hash）；
 *   2. 给 PrintGuard 导出的机读 JSON 预检报告附加 process_passport 与 spot_colors，
 *      并直接提交至 color-workshop 的 POST /api/files/preflight 消费与门禁校验；
 *   3. 自动将 Illustrator 桥接提取的专色清单提交至 POST /api/files/spot-check，
 *      查明每个专色是否在当前工艺色域内、最优四色模拟 ΔE₀₀ 是多少。
 *
 * 零外部依赖，浏览器与 Node 双端可运行。
 * 自测：node module_workshop_bridge.js
 * ==================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintGuardWorkshopBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_WORKSHOP_URL = 'http://127.0.0.1:8765';
  var STORAGE_KEY = 'printguard.workshopUrl';

  function normalizeBaseUrl(url) {
    var raw = String(url || '').trim() || DEFAULT_WORKSHOP_URL;
    return raw.replace(/\/+$/, '');
  }

  function loadWorkshopUrl() {
    try {
      if (typeof localStorage !== 'undefined') {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved && /^https?:\/\//i.test(saved.trim())) return normalizeBaseUrl(saved);
      }
    } catch (e) { /* 隐私模式或 Node 环境忽略 */ }
    return DEFAULT_WORKSHOP_URL;
  }

  function saveWorkshopUrl(url) {
    var norm = normalizeBaseUrl(url);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, norm);
    } catch (e) { /* ignore */ }
    return norm;
  }

  function resolveFetch(opts) {
    var fn = (opts && opts.fetch) || (typeof fetch === 'function' ? fetch : null);
    if (!fn) throw new Error('当前运行环境缺少 fetch 实现，请通过 options.fetch 注入');
    return fn;
  }

  function requestJson(baseUrl, path, init, opts) {
    var fetchFn = resolveFetch(opts);
    var timeoutMs = (opts && typeof opts.timeoutMs === 'number') ? opts.timeoutMs : 5000;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = (ctrl && timeoutMs > 0)
      ? setTimeout(function () { ctrl.abort(); }, timeoutMs)
      : null;
    if (timer && typeof timer.unref === 'function') timer.unref();

    var reqInit = Object.assign({}, init || {});
    if (ctrl) reqInit.signal = ctrl.signal;

    return fetchFn(normalizeBaseUrl(baseUrl) + path, reqInit)
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var detail = body && (body.detail && (body.detail.message || body.detail)) || ('HTTP ' + res.status);
            var err = new Error(String(detail));
            err.status = res.status;
            err.body = body;
            throw err;
          }
          return body;
        });
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  /**
   * 从 Illustrator 桥接草稿提取专色列表：
   * 优先采用含 Lab/CMYK/RGB 色值的 checks.spotColorDetails，缺省时兼容 checks.spotSwatches 名称数组。
   */
  function extractSpotListFromDraft(draft) {
    var checks = (draft && draft.checks) || {};
    var details = Array.isArray(checks.spotColorDetails) ? checks.spotColorDetails : [];
    var names = Array.isArray(checks.spotSwatches) ? checks.spotSwatches : [];
    var out = [];
    var seen = {};
    for (var i = 0; i < details.length; i++) {
      var item = details[i];
      if (!item || !item.name) continue;
      var key = String(item.name).trim();
      if (!key || seen[key]) continue;
      seen[key] = true;
      var entry = { name: key };
      if (Array.isArray(item.lab) && item.lab.length === 3) entry.lab = item.lab;
      if (Array.isArray(item.cmyk) && item.cmyk.length === 4) entry.cmyk = item.cmyk;
      if (Array.isArray(item.rgb) && item.rgb.length === 3) entry.rgb = item.rgb;
      if (item.hex) entry.hex = item.hex;
      out.push(entry);
    }
    for (var j = 0; j < names.length; j++) {
      var n = String(names[j] || '').trim();
      if (!n || seen[n]) continue;
      seen[n] = true;
      out.push({ name: n });
    }
    return out;
  }

  /**
   * 给 PrintGuard 导出的机读 JSON 报告附加 process_passport 指纹与专色清单，
   * 使该报告文件可直接被 color-workshop 预检端点消费并执行工艺护照门禁校验。
   */
  function attachPassportMetadata(reportJson, binding) {
    var base = Object.assign({}, reportJson || {});
    var b = binding || {};
    if (b.processId || b.passportHash || b.iccSha256) {
      base.process_passport = {
        process_id: String(b.processId || ''),
        process_name: String(b.processName || ''),
        passport_id: String(b.passportId || ''),
        passport_version: b.passportVersion != null ? b.passportVersion : null,
        passport_hash: String(b.passportHash || ''),
        icc_sha256: String(b.iccSha256 || ''),
        workshop_url: normalizeBaseUrl(b.workshopUrl || DEFAULT_WORKSHOP_URL)
      };
    }
    if (Array.isArray(b.spotColors) && b.spotColors.length) {
      base.spot_colors = b.spotColors;
    }
    return base;
  }

  function pingWorkshop(baseUrl, opts) {
    return requestJson(baseUrl, '/api/health', { method: 'GET' }, opts)
      .then(function (data) { return { online: true, data: data }; })
      .catch(function (err) { return { online: false, error: err.message }; });
  }

  function fetchProcesses(baseUrl, opts) {
    return requestJson(baseUrl, '/api/processes', { method: 'GET' }, opts);
  }

  function fetchPassport(baseUrl, processId, opts) {
    return requestJson(
      baseUrl,
      '/api/processes/' + encodeURIComponent(processId) + '/passport',
      { method: 'GET' },
      opts
    ).catch(function (err) {
      if (err && err.status === 404) return null;
      throw err;
    });
  }

  /**
   * 将 PrintGuard 机读预检报告直接提交给 color-workshop 的 POST /api/files/preflight 消费，
   * 执行工艺护照指纹校验与专色色域查询。
   */
  function submitPreflightToWorkshop(baseUrl, printguardReport, binding, opts) {
    var b = binding || {};
    var payload = {
      printguard_report: attachPassportMetadata(printguardReport, b),
      filename: String(b.filename || ('PrintGuard_' + ((printguardReport && printguardReport.box_preset) || 'job') + '.json')),
      process_id: String(b.processId || ''),
      passport_hash: String(b.passportHash || ''),
      expected_icc_sha256: String(b.iccSha256 || ''),
      spot_tolerance: typeof b.spotTolerance === 'number' ? b.spotTolerance : 2.0
    };
    if (Array.isArray(b.spotColors) && b.spotColors.length) {
      payload.spot_colors = b.spotColors;
    }
    return requestJson(
      baseUrl,
      '/api/files/preflight',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      opts
    );
  }

  /**
   * 将 Illustrator 提取的专色清单提交给 color-workshop POST /api/files/spot-check，
   * 查询每个专色是否在当前工艺色域内与真实 ΔE₀₀。
   */
  function checkSpotColorsInWorkshop(baseUrl, processId, spots, opts) {
    var tolerance = (opts && typeof opts.tolerance === 'number') ? opts.tolerance : 2.0;
    return requestJson(
      baseUrl,
      '/api/files/spot-check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          process_id: String(processId || ''),
          spots: Array.isArray(spots) ? spots : [],
          tolerance: tolerance
        })
      },
      opts
    );
  }

  var api = {
    DEFAULT_WORKSHOP_URL: DEFAULT_WORKSHOP_URL,
    normalizeBaseUrl: normalizeBaseUrl,
    loadWorkshopUrl: loadWorkshopUrl,
    saveWorkshopUrl: saveWorkshopUrl,
    extractSpotListFromDraft: extractSpotListFromDraft,
    attachPassportMetadata: attachPassportMetadata,
    pingWorkshop: pingWorkshop,
    fetchProcesses: fetchProcesses,
    fetchPassport: fetchPassport,
    submitPreflightToWorkshop: submitPreflightToWorkshop,
    checkSpotColorsInWorkshop: checkSpotColorsInWorkshop
  };

  /* ==================================================================
   * 内置 Node 自动化自测（执行：node module_workshop_bridge.js）
   * ================================================================== */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    (async function runSelfTests() {
      var passed = 0;
      var failed = 0;
      function assert(name, cond, detail) {
        if (cond) { passed++; console.log('  ✓ ' + name); }
        else { failed++; console.error('  ✗ ' + name + (detail ? ' :: ' + detail : '')); }
      }

      console.log('============================================================');
      console.log(' PrintGuard Pro · Color Workshop Bridge 自测');
      console.log('============================================================');

      assert('1. normalizeBaseUrl 去除尾斜杠并支持默认地址',
        normalizeBaseUrl('http://127.0.0.1:8765///') === 'http://127.0.0.1:8765' &&
        normalizeBaseUrl('') === DEFAULT_WORKSHOP_URL);

      var spots = extractSpotListFromDraft({
        checks: {
          spotSwatches: ['PANTONE 485 C', 'CutContour'],
          spotColorDetails: [{ name: 'PANTONE 485 C', lab: [48.0, 68.0, 56.0] }]
        }
      });
      assert('2. extractSpotListFromDraft 优先保留详细色值并合并去重名称列表',
        spots.length === 2 &&
        spots[0].name === 'PANTONE 485 C' && Array.isArray(spots[0].lab) &&
        spots[1].name === 'CutContour');

      var enriched = attachPassportMetadata(
        { application: 'PrintGuard Pro Prepress Workstation', preflight_audit: { rgb_cleared: true } },
        { processId: 'p1', passportHash: 'abcd1234', iccSha256: 'deadbeef00112233', spotColors: spots }
      );
      assert('3. attachPassportMetadata 正确注入 process_passport 与 spot_colors',
        enriched.process_passport.process_id === 'p1' &&
        enriched.process_passport.passport_hash === 'abcd1234' &&
        enriched.process_passport.icc_sha256 === 'deadbeef00112233' &&
        enriched.spot_colors.length === 2);

      var capturedCalls = [];
      var mockFetch = async function (url, init) {
        capturedCalls.push({ url: url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
        if (url.endsWith('/api/files/preflight')) {
          return {
            ok: true,
            status: 200,
            json: async function () {
              return { format: 'PrintGuard-JSON', status: 'pass', passport_gate: { allowed: true, verdict: 'verified' } };
            }
          };
        }
        if (url.endsWith('/api/files/spot-check')) {
          return {
            ok: true,
            status: 200,
            json: async function () {
              return { verdict: 'warning', summary: { total: 2, in_gamut: 1, technical: 1, out_of_gamut: 0 }, items: [] };
            }
          };
        }
        return { ok: false, status: 404, json: async function () { return { detail: 'not found' }; } };
      };

      var pfRes = await submitPreflightToWorkshop(
        'http://127.0.0.1:8765',
        { preflight_audit: { rgb_cleared: true } },
        { processId: 'proc_1', passportHash: 'hash_1', iccSha256: 'icc_1', spotColors: spots },
        { fetch: mockFetch }
      );
      assert('4. submitPreflightToWorkshop 发送标准请求并解析工艺护照门禁结论',
        pfRes.passport_gate.allowed === true &&
        capturedCalls[0].url === 'http://127.0.0.1:8765/api/files/preflight' &&
        capturedCalls[0].body.process_id === 'proc_1' &&
        capturedCalls[0].body.passport_hash === 'hash_1');

      var scRes = await checkSpotColorsInWorkshop(
        'http://127.0.0.1:8765',
        'proc_1',
        spots,
        { fetch: mockFetch, tolerance: 2.0 }
      );
      assert('5. checkSpotColorsInWorkshop 发送专色清单至 /api/files/spot-check',
        scRes.summary.total === 2 &&
        capturedCalls[1].url === 'http://127.0.0.1:8765/api/files/spot-check' &&
        capturedCalls[1].body.spots.length === 2);

      var offline = await pingWorkshop('http://127.0.0.1:1', {
        fetch: async function () { throw new Error('ECONNREFUSED'); }
      });
      assert('6. pingWorkshop 在服务离线时优雅返回 online=false 不抛异常',
        offline.online === false && offline.error.indexOf('ECONNREFUSED') >= 0);

      console.log('============================================================');
      console.log(' Workshop Bridge 自测: ' + passed + ' 通过, ' + failed + ' 失败');
      console.log('============================================================');
      process.exit(failed ? 1 : 0);
    })();
  }

  return api;
});
