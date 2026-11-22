/* ====================================================================
 * PrintGuard Pro · App Ingest — 外部导入管线 / Illustrator 插件草稿消费
 * --------------------------------------------------------------------
 * 由 index.html 在 initPersistence 内注入依赖调用 init({...})：
 *   { state, applySnapshot, showToast }
 * 职责：
 *   1. 连接本地 ingest 服务（server.py），列出/拉取插件推送的草稿
 *   2. 应用草稿：dxf → _dxfRawText（applySnapshot 重放 handleDxfStringImport）
 *                artworkDataUrl → _artworkDataUrl（applySnapshot 重放 Image）
 *                checks → 面板内预检提示（色彩模式/转曲/尺寸）
 *   3. 手动导入 ingest JSON 文件（无服务器场景）
 * 本文件只负责渲染与交互，不持有业务状态。
 * ==================================================================== */
(function (root) {
  'use strict';

  var deps = null;
  var lastApplied = null;   /* 最近一次应用的草稿摘要（渲染用，不持久化） */
  var serverOnline = false;

  /* 同源直连；file:// 打开时回退到约定端口（server.py 已开 CORS *） */
  var API_BASE = (location.protocol === 'http:' || location.protocol === 'https:')
    ? '' : 'http://127.0.0.1:8787';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  /* ------------------------------------------------------------------
   * 服务连接与草稿获取
   * ------------------------------------------------------------------ */
  function fetchJson(path, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 2500) : null;
    return fetch(API_BASE + path, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function ping() {
    return fetchJson('/api/ping').then(function (r) {
      serverOnline = !!(r && r.ok);
      return serverOnline;
    }).catch(function () {
      serverOnline = false;
      return false;
    });
  }

  function listDrafts() {
    return fetchJson('/api/drafts').then(function (r) { return (r && r.drafts) || []; });
  }

  function getDraft(id) {
    return fetchJson('/api/draft/' + encodeURIComponent(id), 8000);
  }

  /* ------------------------------------------------------------------
   * 草稿 → 工作台应用（复用 applySnapshot 的附件重放机制）
   * ------------------------------------------------------------------ */
  function draftToSnapshot(draft) {
    var snap = {};
    var doc = draft.doc || {};
    if (draft.dxf) {
      snap.preset = 'custom_dxf';
      snap._dxfRawText = String(draft.dxf);
      snap.customDxfName = (doc.name || 'illustrator') + '_dieline.dxf';
    }
    if (draft.artworkDataUrl) {
      snap._artworkDataUrl = String(draft.artworkDataUrl);
      snap.customImageName = (doc.name || 'illustrator') + '.png';
    }
    return snap;
  }

  function buildCheckRows(draft) {
    var doc = draft.doc || {};
    var checks = draft.checks || {};
    var rows = [];
    if (doc.widthMm && doc.heightMm) {
      rows.push({ ok: true, text: '画板尺寸 ' + doc.widthMm + ' × ' + doc.heightMm + ' mm（' + (doc.colorSpace || '?') + '）' });
    }
    if (String(doc.colorSpace || '').toUpperCase() === 'RGB') {
      rows.push({ ok: false, text: '文档为 RGB 色彩模式，印刷前需转 CMYK' });
    }
    var live = Number(checks.liveTextCount || 0);
    if (live > 0) {
      rows.push({ ok: false, text: '检出 ' + live + ' 处活动文字未转曲（字体：' +
        ((checks.fonts && checks.fonts.slice(0, 3).join('、')) || '未知') + '）' });
    } else if (checks.fonts && checks.fonts.length === 0 && checks.liveTextCount === 0) {
      rows.push({ ok: true, text: '无活动文字（已全部转曲）' });
    }
    if (checks.spotSwatches && checks.spotSwatches.length) {
      rows.push({ ok: true, text: '专色：' + checks.spotSwatches.slice(0, 4).join('、') });
    }
    var dieline = checks.dielineLayers || {};
    if (dieline.cut && dieline.cut.length) {
      rows.push({ ok: true, text: '刀线图层：' + dieline.cut.join('、') });
    } else {
      rows.push({ ok: false, text: '未检出刀线图层（CUT/DIE 命名），3D 折叠不可用' });
    }
    if (dieline.crease && dieline.crease.length) {
      rows.push({ ok: true, text: '折线图层：' + dieline.crease.join('、') });
    }
    return rows;
  }

  function applyDraft(draft) {
    if (!deps || !draft) return Promise.resolve(false);
    var snap = draftToSnapshot(draft);
    if (!snap._dxfRawText && !snap._artworkDataUrl) {
      deps.showToast('草稿不含刀线或图稿，无内容可应用', 'warning');
      return Promise.resolve(false);
    }
    deps.applySnapshot(snap, true); /* 外部导入：撤销栈断点重置 */
    lastApplied = { id: draft.id, doc: draft.doc || {}, checks: draft.checks || {}, appliedAt: Date.now() };
    renderIngestSummary();
    deps.showToast('已应用外部草稿「' + ((draft.doc && draft.doc.name) || draft.id) + '」', 'success');
    return Promise.resolve(true);
  }

  function applyDraftById(id) {
    var p = (String(id) === 'latest')
      ? listDrafts().then(function (drafts) {
          if (!drafts.length) throw new Error('服务上暂无草稿');
          return getDraft(drafts[0].id);
        })
      : getDraft(id);
    return p.then(applyDraft).catch(function (err) {
      deps.showToast('拉取草稿失败：' + err.message, 'error');
    });
  }

  /* ------------------------------------------------------------------
   * 面板渲染
   * ------------------------------------------------------------------ */
  function renderServerStatus() {
    var badge = el('ingestServerBadge');
    if (!badge) return;
    badge.textContent = serverOnline ? '服务已连接' : '服务未连接（脚本/手动模式）';
    badge.style.color = serverOnline ? '#0f766e' : '#94a3b8';
  }

  function renderIngestSummary() {
    var box = el('ingestSummary');
    if (!box) return;
    if (!lastApplied) {
      box.innerHTML = '<div class="text-[10px] text-slate-500 leading-relaxed">尚无外部导入。在 Illustrator 中运行' +
        '「PrintGuard 提取」脚本，或从下方草稿列表应用；也可导入 ingest JSON 文件。</div>';
      return;
    }
    var rows = buildCheckRows({ doc: lastApplied.doc, checks: lastApplied.checks });
    box.innerHTML =
      '<div class="text-[10px] text-slate-400 font-mono mb-1">' + escapeHtml(lastApplied.doc.name || lastApplied.id) +
      ' · ' + escapeHtml(fmtTime(lastApplied.appliedAt)) + '</div>' +
      rows.map(function (r) {
        return '<div class="flex items-start gap-1.5 text-[10px] leading-relaxed">' +
          '<span class="' + (r.ok ? 'text-emerald-600' : 'text-amber-600') + ' shrink-0">' + (r.ok ? '✓' : '!') + '</span>' +
          '<span class="' + (r.ok ? 'text-slate-600' : 'text-amber-700') + '">' + escapeHtml(r.text) + '</span></div>';
      }).join('');
  }

  function renderDraftList(drafts) {
    var listEl = el('ingestDraftList');
    if (!listEl) return;
    if (!drafts.length) {
      listEl.innerHTML = '<div class="text-center py-4 text-slate-500 text-[10px] leading-relaxed">' +
        '暂无外部草稿。在 Illustrator 中运行「PrintGuard 提取」脚本，' +
        '草稿将出现在这里。</div>';
      return;
    }
    listEl.innerHTML = drafts.slice(0, 12).map(function (d) {
      var flags = [];
      if (d.hasDxf) flags.push('刀线');
      if (d.hasArtwork) flags.push('图稿');
      if (d.liveTextCount > 0) flags.push('<span class="text-amber-600">文字' + d.liveTextCount + '</span>');
      return '<div class="glass-card p-2 mb-2" data-did="' + escapeHtml(d.id) + '">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<div class="text-[11px] font-semibold text-slate-800 truncate">' + escapeHtml(d.name || d.id) + '</div>' +
            '<div class="text-[9px] text-slate-500 mt-0.5 font-mono">' + escapeHtml(fmtTime(d.createdAt)) +
              ' · ' + escapeHtml(d.colorSpace || '?') +
              (d.widthMm ? ' · ' + d.widthMm + '×' + d.heightMm + 'mm' : '') +
              (flags.length ? ' · ' + flags.join('/') : '') + '</div>' +
          '</div>' +
          '<button data-act="apply" class="glass-btn-primary text-[10px] px-2 py-0.5 font-medium shrink-0">应用</button>' +
        '</div></div>';
    }).join('');
  }

  function refreshDrafts() {
    var listEl = el('ingestDraftList');
    if (listEl && !serverOnline) {
      listEl.innerHTML = '<div class="text-center py-4 text-slate-400 text-[10px]">ingest 服务未连接 —' +
        ' 启动 python server.py 后刷新，或使用下方手动导入。</div>';
      return;
    }
    listDrafts().then(renderDraftList).catch(function () {
      serverOnline = false;
      renderServerStatus();
    });
  }

  /* ------------------------------------------------------------------
   * 手动导入 ingest JSON（无服务器场景）
   * ------------------------------------------------------------------ */
  function importIngestFile(file) {
    if (!deps || !file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var draft = JSON.parse(String(reader.result));
        if (!draft || draft.app !== 'PrintGuardIngest') throw new Error('不是 PrintGuardIngest 草稿');
        if (!draft.id) draft.id = 'manual-' + Date.now();
        applyDraft(draft);
      } catch (err) {
        deps.showToast('导入失败：' + err.message, 'info', 4000);
      }
    };
    reader.onerror = function () { deps.showToast('文件读取失败', 'info'); };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------
   * 初始化（index.html initPersistence 内调用）
   * ------------------------------------------------------------------ */
  function init(injected) {
    deps = injected;

    var refreshBtn = el('ingestRefreshBtn');
    if (refreshBtn && !refreshBtn._pgWired) {
      refreshBtn.addEventListener('click', function () {
        ping().then(function () {
          renderServerStatus();
          refreshDrafts();
        });
      });
      refreshBtn._pgWired = true;
    }
    var listEl = el('ingestDraftList');
    if (listEl && !listEl._pgWired) {
      listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-act="apply"]');
        if (!btn) return;
        var card = btn.closest('[data-did]');
        if (card) applyDraftById(card.getAttribute('data-did'));
      });
      listEl._pgWired = true;
    }
    var importBtn = el('ingestImportBtn');
    var importInput = el('ingestImportFile');
    if (importBtn && importInput && !importBtn._pgWired) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function () {
        if (importInput.files && importInput.files[0]) importIngestFile(importInput.files[0]);
        importInput.value = '';
      });
      importBtn._pgWired = true;
    }

    renderIngestSummary();
    ping().then(function () {
      renderServerStatus();
      refreshDrafts();
    });
  }

  root.PrintGuardAppIngest = {
    init: init,
    ping: ping,
    listDrafts: listDrafts,
    applyDraftById: applyDraftById,
    applyDraft: applyDraft,
    refreshDrafts: refreshDrafts,
    isServerOnline: function () { return serverOnline; }
  };
})(typeof self !== 'undefined' ? self : this);
