/* ====================================================================
 * PrintGuard Pro · App UI — 项目管理面板 / 自动保存接线 / 恢复提示
 * --------------------------------------------------------------------
 * 由 index.html 内联脚本在 load 时调用 PrintGuardAppUI.init({...}) 注入依赖：
 *   { state, applySnapshot, makeThumbnail, redrawAll, showToast, Store }
 * 本文件只负责渲染与交互，不持有业务状态。
 * ==================================================================== */
(function (root) {
  'use strict';

  var deps = null;

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

  function fmtBytes(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  function el(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------
   * 项目列表渲染
   * ------------------------------------------------------------------ */
  function refreshProjectList() {
    var listEl = el('projectList');
    if (!listEl || !deps) return;
    var backendLabel = {
      indexeddb: 'IndexedDB 本地库',
      localstorage: 'localStorage 兜底（大附件可能省略）',
      'null': '存储不可用（隐私模式？）'
    }[String(deps.Store.backendName())];
    var badge = el('projectStorageBadge');
    if (badge) badge.textContent = backendLabel;

    deps.Store.listProjects().then(function (projects) {
      if (!projects.length) {
        listEl.innerHTML =
          '<div class="text-center py-8 text-slate-500 text-xs leading-relaxed">' +
          '<div class="mx-auto mb-2 w-10 h-10 rounded-full glass-pill flex items-center justify-center">📦</div>' +
          '暂无已保存工程<br>调好参数后点「保存当前为工程」</div>';
        return;
      }
      listEl.innerHTML = projects.map(function (p) {
        var thumb = p.thumbnail
          ? '<img src="' + escapeHtml(p.thumbnail) + '" alt="缩略图" class="w-full h-full object-cover">'
          : '<div class="w-full h-full flex items-center justify-center text-slate-400 text-lg">🖨️</div>';
        return '' +
          '<div class="glass-card p-2.5 mb-2.5" data-pid="' + escapeHtml(p.id) + '">' +
            '<div class="flex gap-2.5">' +
              '<div class="w-16 h-16 rounded-lg overflow-hidden border border-slate-900/10 bg-slate-900/5 shrink-0">' + thumb + '</div>' +
              '<div class="flex-1 min-w-0">' +
                '<div class="text-xs font-semibold text-slate-800 truncate" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</div>' +
                '<div class="text-[10px] text-slate-500 mt-0.5">' + escapeHtml(fmtTime(p.updatedAt)) + '</div>' +
                '<div class="flex flex-wrap gap-1 mt-1.5">' +
                  '<button data-act="load" class="glass-btn text-[10px] px-2 py-0.5 font-medium">载入</button>' +
                  '<button data-act="export" class="glass-btn text-[10px] px-2 py-0.5">导出</button>' +
                  '<button data-act="rename" class="glass-btn text-[10px] px-2 py-0.5">重命名</button>' +
                  '<button data-act="delete" class="glass-btn text-[10px] px-2 py-0.5 text-rose-600">删除</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('');
    });
  }

  function findPid(target) {
    var card = target.closest('[data-pid]');
    return card ? card.getAttribute('data-pid') : null;
  }

  function onListClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn || !deps) return;
    var pid = findPid(btn);
    if (!pid) return;
    var act = btn.getAttribute('data-act');
    if (act === 'load') {
      deps.Store.getProject(pid).then(function (rec) {
        if (!rec) { deps.showToast('工程记录已不存在', 'info'); refreshProjectList(); return; }
        deps.applySnapshot(rec.snapshot, true); /* 外部加载：撤销栈断点重置 */
        deps.showToast('已载入工程「' + rec.name + '」', 'success');
        deps.Store.clearAutosave();
      });
    } else if (act === 'export') {
      deps.Store.getProject(pid).then(function (rec) {
        if (!rec) return;
        var text = deps.Store.exportProjectFile(rec.name, rec.snapshot);
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = rec.name.replace(/[\\/:*?"<>|]/g, '_') + '.printguard';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        deps.showToast('已导出 ' + rec.name + '.printguard（' + fmtBytes(text.length) + '）', 'success');
      });
    } else if (act === 'rename') {
      deps.Store.getProject(pid).then(function (rec) {
        if (!rec) return;
        var name = window.prompt('新的工程名称：', rec.name);
        if (name && name.trim()) {
          deps.Store.renameProject(pid, name.trim()).then(function () {
            deps.showToast('已重命名', 'success');
            refreshProjectList();
          });
        }
      });
    } else if (act === 'delete') {
      deps.Store.getProject(pid).then(function (rec) {
        if (!rec) return;
        if (window.confirm('确认删除工程「' + rec.name + '」？此操作不可恢复。')) {
          deps.Store.deleteProject(pid).then(function () {
            deps.showToast('已删除「' + rec.name + '」', 'info');
            refreshProjectList();
          });
        }
      });
    }
  }

  /* ------------------------------------------------------------------
   * 保存当前工作区为工程
   * ------------------------------------------------------------------ */
  function saveCurrentAsProject() {
    if (!deps) return;
    var input = el('projectNameInput');
    var now = new Date();
    var fallback = '工作台 ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' +
      ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    var name = (input && input.value || '').trim() || fallback;
    var snap = deps.makeSnapshot();
    snap.name = name;
    deps.Store.saveProject(name, snap).then(function (rec) {
      if (!rec) { deps.showToast('保存失败：本地存储不可用或配额已满', 'info', 4000); return; }
      if (input) input.value = '';
      deps.showToast('已保存工程「' + name + '」', 'success');
      refreshProjectList();
    });
  }

  /* ------------------------------------------------------------------
   * 导入 .printguard 工程文件
   * ------------------------------------------------------------------ */
  function importProjectFile(file) {
    if (!deps || !file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = deps.Store.parseProjectFile(String(reader.result));
      if (parsed.error) { deps.showToast('导入失败：' + parsed.error, 'info', 4000); return; }
      deps.applySnapshot(parsed.snapshot, true); /* 外部加载：撤销栈断点重置 */
      deps.showToast('已导入工程「' + parsed.name + '」', 'success');
      deps.Store.clearAutosave();
    };
    reader.onerror = function () { deps.showToast('文件读取失败', 'info'); };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------
   * 恢复提示横幅（玻璃浮层，含动作按钮）
   * ------------------------------------------------------------------ */
  function promptRestore() {
    if (!deps) return;
    deps.Store.getAutosave().then(function (rec) {
      if (!rec || !rec.snapshot) return;
      var hasContent = rec.snapshot._artworkDataUrl || rec.snapshot._dxfRawText ||
        rec.snapshot.isRgbFixed || rec.snapshot.preset !== 'reverse_tuck' || rec.snapshot.foldAngleDeg !== 90;
      if (!hasContent) return; /* 纯初始状态不打扰 */

      var banner = document.createElement('div');
      banner.className = 'glass-toast anim-scale-in';
      banner.style.cssText = 'position:fixed;top:112px;left:50%;transform:translateX(-50%);z-index:60;' +
        'display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:12px;';
      banner.innerHTML =
        '<span class="text-slate-700">检测到上次工作区（' + escapeHtml(fmtTime(rec.updatedAt)) + '）</span>' +
        '<button id="pgRestoreBtn" class="glass-btn-primary text-xs px-3 py-1 font-medium">恢复</button>' +
        '<button id="pgDismissBtn" class="glass-btn text-xs px-3 py-1">忽略</button>';
      document.body.appendChild(banner);
      var remove = function () { if (banner.parentNode) banner.parentNode.removeChild(banner); };
      el('pgRestoreBtn').addEventListener('click', function () {
        remove();
        deps.applySnapshot(rec.snapshot, true); /* 外部加载：撤销栈断点重置 */
        deps.showToast('已恢复上次工作区', 'success');
      });
      el('pgDismissBtn').addEventListener('click', function () {
        remove();
        deps.Store.clearAutosave();
      });
      setTimeout(remove, 60000); /* 1 分钟后自动消失 */
    });
  }

  /* ------------------------------------------------------------------
   * 初始化入口（index.html load 时调用）
   * ------------------------------------------------------------------ */
  function init(injected) {
    deps = injected;
    deps.Store.init().then(function () {
      /* 面板事件（只绑一次） */
      var listEl = el('projectList');
      if (listEl && !listEl._pgWired) {
        listEl.addEventListener('click', onListClick);
        listEl._pgWired = true;
      }
      var saveBtn = el('saveProjectBtn');
      if (saveBtn && !saveBtn._pgWired) {
        saveBtn.addEventListener('click', saveCurrentAsProject);
        saveBtn._pgWired = true;
      }
      var nameInput = el('projectNameInput');
      if (nameInput && !nameInput._pgWired) {
        nameInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); saveCurrentAsProject(); }
        });
        nameInput._pgWired = true;
      }
      var importBtn = el('importProjectBtn');
      var importInput = el('importProjectFile');
      if (importBtn && importInput && !importBtn._pgWired) {
        importBtn.addEventListener('click', function () { importInput.click(); });
        importInput.addEventListener('change', function () {
          if (importInput.files && importInput.files[0]) importProjectFile(importInput.files[0]);
          importInput.value = '';
        });
        importBtn._pgWired = true;
      }
      refreshProjectList();
      promptRestore();
    });
  }

  root.PrintGuardAppUI = {
    init: init,
    refreshProjectList: refreshProjectList,
    saveCurrentAsProject: saveCurrentAsProject
  };
})(typeof self !== 'undefined' ? self : this);
