/* ====================================================================
 * PrintGuard Pro · App Store — 本地持久化存储层
 * --------------------------------------------------------------------
 * 双后端：IndexedDB（file:// 协议不可用时降级 localStorage）。
 * 职责：状态序列化 / 自动保存（Proxy 脏标记 + 防抖落盘）/
 *       项目 CRUD / .printguard 工程文件导出导入。
 * 纯逻辑部分（序列化、代理、文件格式）可在 Node 中自测：node js/app-store.js
 * ==================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintGuardStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'printguard-pro';
  var DB_VERSION = 1;
  var STORE = 'projects';
  var LS_PROJECTS = 'pg.projects';
  var LS_AUTOSAVE = 'pg.autosave';
  var LS_AUTOSAVE_MIRROR = 'pg.autosave.mirror'; /* 同步镜像：防 beforeunload 时异步 IDB 写丢失 */
  var AUTOSAVE_ID = '__autosave__';
  var EXPORT_APP = 'PrintGuardPro';
  var EXPORT_VERSION = 1;

  /* 入快照的状态白名单（易变键、运行时缓存与瞬态 UI 模式一律排除） */
  var STATE_FIELDS = [
    'preset', 'isRgbFixed', 'isOverprintBlack', 'isTacFixed', 'isOutlined',
    'isGlueCleaned', 'bleedMm', 'misregistrationMm', 'trapMode', 'activePlate',
    'isPlateMonochrome', 'showTacHeatmap', 'layers',
    'zoom', 'pan', 'foldAngleDeg', 'barcode',
    'customImageName', 'customDxfName',
    '_artworkDataUrl', '_dxfRawText'
  ];

  /* Proxy 脏标记忽略键：高频鼠标状态与运行时缓存 */
  var VOLATILE_KEYS = {
    mouseMm: 1, isDragging: 1, dragStart: 1, highlightedFace: 1,
    customImage: 1, customSeparationCache: 1, defaultSeparationCache: 1
  };

  function pick(obj, keys) {
    var out = {};
    if (!obj) return out;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
  }

  /* ---- 序列化 / 反序列化（纯函数，Node 可测） ---- */
  function serializeState(state) {
    var snap = pick(state, STATE_FIELDS);
    snap.pan = state && state.pan ? { x: state.pan.x, y: state.pan.y } : { x: 0, y: 0 };
    snap.layers = state && state.layers ? {
      artwork: !!state.layers.artwork, cut: !!state.layers.cut,
      crease: !!state.layers.crease, dims: !!state.layers.dims
    } : { artwork: true, cut: true, crease: true, dims: true };
    snap.barcode = state && state.barcode ? {
      type: state.barcode.type, code: state.barcode.code, bwrMm: state.barcode.bwrMm
    } : null;
    return snap;
  }

  /* 返回可直接 Object.assign 到应用 state 的字段（不含附件；附件由应用侧重放导入）。
     嵌套对象深拷贝，避免 state 与已存快照记录共享引用而互相污染。 */
  function deserializeState(snap) {
    if (!snap || typeof snap !== 'object') return null;
    var out = pick(snap, STATE_FIELDS.filter(function (k) {
      return k !== '_artworkDataUrl' && k !== '_dxfRawText';
    }));
    out.pan = out.pan ? { x: out.pan.x, y: out.pan.y } : { x: 0, y: 0 };
    out.layers = out.layers ? {
      artwork: !!out.layers.artwork, cut: !!out.layers.cut,
      crease: !!out.layers.crease, dims: !!out.layers.dims
    } : { artwork: true, cut: true, crease: true, dims: true };
    out.barcode = out.barcode ? {
      type: out.barcode.type, code: out.barcode.code, bwrMm: out.barcode.bwrMm
    } : { type: 'EAN-13', code: '6901234567895', bwrMm: 0.025 };
    return out;
  }

  /* ---- 状态代理：写白名单键 → 触发脏标记；顶层赋值前 → 通知撤销栈拍 before 快照 ---- */
  /* 撤销栈排除键：附件/资产域（dataURL/DXF 原文/资产名）不入撤销快照——
     撤销只回滚参数状态，不回滚资产（内存取舍），恢复时保留当前资产 */
  var UNDO_EXCLUDED_KEYS = { _artworkDataUrl: 1, _dxfRawText: 1, customImageName: 1, customDxfName: 1 };
  function createStateProxy(rawState, onDirty, onBeforeChange) {
    if (typeof Proxy === 'undefined') return rawState;
    return new Proxy(rawState, {
      set: function (target, key, value) {
        var tracked = typeof key === 'string' && !VOLATILE_KEYS[key];
        if (tracked && target[key] !== value) {
          try { onBeforeChange && !UNDO_EXCLUDED_KEYS[key] && onBeforeChange(String(key)); } catch (e) { /* 回调异常不影响应用 */ }
        }
        target[key] = value;
        if (tracked) {
          try { onDirty && onDirty(String(key)); } catch (e) { /* 回调异常不影响应用 */ }
        }
        return true;
      }
    });
  }

  /* ---- 自动保存器：防抖 flush + beforeunload 兜底 ---- */
  function createAutosaver(opts) {
    opts = opts || {};
    var debounceMs = opts.debounceMs || 3000;
    var buildSnapshot = opts.buildSnapshot || function () { return null; };
    var onSaved = opts.onSaved || null;
    var timer = null;
    var lastError = null;

    function markDirty() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    }
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      var snap = buildSnapshot();
      if (!snap) return Promise.resolve(false);
      return saveAutosave(snap).then(function (ok) {
        if (onSaved) onSaved(ok, null);
        return ok;
      }).catch(function (err) {
        lastError = err;
        if (onSaved) onSaved(false, err);
        return false;
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', function () { if (timer) flush(); });
      window.addEventListener('pagehide', function () { if (timer) flush(); });
    }
    return { markDirty: markDirty, flush: flush, lastError: function () { return lastError; } };
  }

  /* ==================================================================
   * 撤销/重做栈（快照式，限深）
   * ------------------------------------------------------------------
   * 快照式取舍：getSnap 排除设计稿/DXF 附件大字段——撤销只回滚参数状态，
   * 不回滚"资产"（附件重放成本与内存占用过高，30 步 × 数 MB dataURL 会失控）。
   * 批合并：连续变更（滑杆拖动、多项开关）由宿主在首次变更前拍 before 快照，
   * 空闲阈值后提交为一步；undo/redo 回放经宿主 applySnap（内部抑制再次入栈）。
   * ================================================================== */
  function createUndoStack(opts) {
    var limit = opts && opts.limit || 30;
    var getSnap = opts && opts.getSnap || function () { return null; };
    var applySnap = opts && opts.applySnap || function () {};
    var idleMs = opts && opts.batchIdleMs || 900;
    var undoStack = [];
    var redoStack = [];
    var pendingBefore = null;
    var flushTimer = null;

    function push(before) {
      undoStack.push(before);
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0; /* 新操作分叉：清空重做分支 */
    }
    function beginBatch() {
      if (pendingBefore) return; /* 批已开启：同一批内 before 不变 */
      pendingBefore = getSnap();
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, idleMs);
    }
    function flush() {
      clearTimeout(flushTimer); flushTimer = null;
      if (pendingBefore) { push(pendingBefore); pendingBefore = null; }
    }
    function cancelBatch() {
      clearTimeout(flushTimer); flushTimer = null;
      pendingBefore = null;
    }
    function undo() {
      flush();
      if (!undoStack.length) return false;
      var snap = undoStack.pop();
      redoStack.push(getSnap());
      applySnap(snap);
      return true;
    }
    function redo() {
      if (!redoStack.length) return false;
      var snap = redoStack.pop();
      undoStack.push(getSnap());
      applySnap(snap);
      return true;
    }
    function reset() {
      undoStack.length = 0; redoStack.length = 0;
      cancelBatch();
    }
    return {
      beginBatch: beginBatch, flush: flush, cancelBatch: cancelBatch,
      undo: undo, redo: redo, reset: reset,
      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },
      depth: function () { return undoStack.length; }
    };
  }

  /* ==================================================================
   * 存储后端
   * ================================================================== */
  var _db = null;          /* IndexedDB 句柄 */
  var _backend = null;     /* 'indexeddb' | 'localstorage' | null（初始化前） */

  function backendName() { return _backend; }

  function init() {
    if (_readyPromise) return _readyPromise; /* 幂等：与 ready() 共享同一初始化 promise */
    _readyPromise = new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { _backend = _lsOk() ? 'localstorage' : null; return resolve(_backend); }
      var t = setTimeout(function () { /* 打开超时（file:// 下某些浏览器挂起） */
        if (_backend === null) { _backend = _lsOk() ? 'localstorage' : null; resolve(_backend); }
      }, 2500);
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var os = db.createObjectStore(STORE, { keyPath: 'id' });
            os.createIndex('updatedAt', 'updatedAt');
          }
        };
        req.onsuccess = function (e) {
          clearTimeout(t);
          _db = e.target.result;
          _backend = 'indexeddb';
          resolve('indexeddb');
        };
        req.onerror = req.onblocked = function () {
          clearTimeout(t);
          _backend = _lsOk() ? 'localstorage' : null;
          resolve(_backend);
        };
      } catch (err) {
        clearTimeout(t);
        _backend = _lsOk() ? 'localstorage' : null;
        resolve(_backend);
      }
    });
    return _readyPromise;
  }

  function _lsOk() {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem('pg.__probe', '1');
      localStorage.removeItem('pg.__probe');
      return true;
    } catch (e) { return false; }
  }

  function _tx(mode) { return _db.transaction(STORE, mode).objectStore(STORE); }

  var _readyPromise = null;
  /* 任何读写先等 init 完成：初始化窗口期（IndexedDB 打开中）到达的调用排队执行，
     而不是在 _backend 为 null 时静默丢失 */
  function ready() {
    if (!_readyPromise) _readyPromise = init();
    return _readyPromise;
  }

  function _req(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /* ---- localStorage 兜底实现 ---- */
  function _lsRead(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function _lsWrite(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; } /* 配额溢出 */
  }
  function _lsProjectList() { var a = _lsRead(LS_PROJECTS); return Array.isArray(a) ? a : []; }

  /* ---- CRUD ---- */
  function putRecord(rec) {
    return ready().then(function () {
      if (_backend === 'indexeddb') return _req(_tx('readwrite').put(rec)).then(function () { return true; });
      if (_backend === 'localstorage') {
        var isAuto = rec.id === AUTOSAVE_ID;
        if (isAuto) return Promise.resolve(_lsWrite(LS_AUTOSAVE, rec));
        var list = _lsProjectList().filter(function (r) { return r.id !== rec.id; });
        list.push(rec);
        /* 大附件超配额：去附件重试 */
        if (!_lsWrite(LS_PROJECTS, list)) {
          var lean = list.map(function (r) {
            if (r.id !== rec.id || !r.snapshot) return r;
            var s = Object.assign({}, r.snapshot);
            delete s._artworkDataUrl; delete s._dxfRawText; delete s.thumbnail;
            return Object.assign({}, r, { snapshot: s, attachmentsDropped: true });
          });
          return Promise.resolve(_lsWrite(LS_PROJECTS, lean));
        }
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });
  }

  function getRecord(id) {
    return ready().then(function () {
      if (_backend === 'indexeddb') return _req(_tx('readonly').get(id));
      if (_backend === 'localstorage') {
        if (id === AUTOSAVE_ID) return Promise.resolve(_lsRead(LS_AUTOSAVE));
        return Promise.resolve(_lsProjectList().find(function (r) { return r.id === id; }) || null);
      }
      return Promise.resolve(null);
    });
  }

  function deleteRecord(id) {
    return ready().then(function () {
      if (_backend === 'indexeddb') return _req(_tx('readwrite').delete(id)).then(function () { return true; });
      if (_backend === 'localstorage') {
        if (id === AUTOSAVE_ID) {
          /* 自动保存存于独立键，不走工程列表 */
          try { localStorage.removeItem(LS_AUTOSAVE); } catch (e) { /* 忽略 */ }
          try { localStorage.removeItem(LS_AUTOSAVE_MIRROR); } catch (e) { /* 忽略 */ }
          return Promise.resolve(true);
        }
        _lsWrite(LS_PROJECTS, _lsProjectList().filter(function (r) { return r.id !== id; }));
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });
  }

  function listRecords() {
    return ready().then(function () {
      if (_backend === 'indexeddb') {
        return _req(_tx('readonly').getAll()).then(function (rows) {
          return (rows || []).filter(function (r) { return r.id !== AUTOSAVE_ID; });
        });
      }
      if (_backend === 'localstorage') return Promise.resolve(_lsProjectList());
      return Promise.resolve([]);
    });
  }

  /* ---- 对外 API ---- */
  function saveAutosave(snapshot) {
    return ready().then(function () {
      /* IndexedDB 为主时同步写一份 localStorage 镜像：页面卸载阶段 IDB 异步写
         可能不落盘，同步写保证最近一次快照不丢；读取时两边取较新者。 */
      if (_backend === 'indexeddb') {
        try { localStorage.setItem(LS_AUTOSAVE_MIRROR, JSON.stringify({ id: AUTOSAVE_ID, name: '__autosave__', updatedAt: Date.now(), snapshot: snapshot })); } catch (e) { /* 配额溢出时放弃镜像 */ }
      }
      return putRecord({ id: AUTOSAVE_ID, name: '__autosave__', updatedAt: Date.now(), snapshot: snapshot });
    });
  }
  function getAutosave() {
    return ready().then(function () {
      return getRecord(AUTOSAVE_ID).then(function (rec) {
        var mirror = _lsRead(LS_AUTOSAVE_MIRROR);
        if (mirror && mirror.snapshot) {
          if (!rec || !rec.snapshot || (mirror.updatedAt || 0) > (rec.updatedAt || 0)) return mirror;
        }
        return rec;
      });
    });
  }
  function clearAutosave() {
    return ready().then(function () {
      try { localStorage.removeItem(LS_AUTOSAVE_MIRROR); } catch (e) { /* 忽略 */ }
      return deleteRecord(AUTOSAVE_ID);
    });
  }

  var _idCounter = 0;
  function newId() {
    /* 本地项目 ID（非加密用途）：优先平台随机源，退化到时间戳+会话计数器 */
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'p_' + crypto.randomUUID();
    } catch (e) { /* 忽略，走退化路径 */ }
    return 'p_' + Date.now().toString(36) + '_' + (++_idCounter).toString(36);
  }
  function saveProject(name, snapshot, existingId) {
    var rec = { id: existingId || newId(), name: name || '未命名工程', updatedAt: Date.now(), snapshot: snapshot };
    return putRecord(rec).then(function (ok) { return ok ? rec : null; });
  }
  function listProjects() {
    return listRecords().then(function (rows) {
      return rows.sort(function (a, b) { return b.updatedAt - a.updatedAt; })
        .map(function (r) {
          return { id: r.id, name: r.name, updatedAt: r.updatedAt, thumbnail: r.snapshot && r.snapshot.thumbnail || null };
        });
    });
  }
  function getProject(id) { return getRecord(id); }
  function deleteProject(id) { return deleteRecord(id); }
  function renameProject(id, name) {
    return getRecord(id).then(function (rec) {
      if (!rec) return false;
      rec.name = name;
      rec.updatedAt = Date.now();
      return putRecord(rec).then(function () { return true; });
    });
  }

  /* ---- .printguard 工程文件 ---- */
  function exportProjectFile(name, snapshot) {
    return JSON.stringify({
      app: EXPORT_APP, version: EXPORT_VERSION, savedAt: new Date().toISOString(),
      name: name || '未命名工程', snapshot: snapshot
    }, null, 2);
  }
  function parseProjectFile(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { error: '文件不是有效的 JSON：' + e.message }; }
    if (!data || data.app !== EXPORT_APP) return { error: '不是 PrintGuard Pro 工程文件（缺少应用标识）' };
    if (!data.snapshot || typeof data.snapshot !== 'object') return { error: '工程文件缺少状态快照' };
    return { name: data.name || '导入工程', savedAt: data.savedAt, snapshot: data.snapshot };
  }

  /* ---- 快照体积估算（提示用户是否含大附件） ---- */
  function snapshotBytes(snap) {
    try { return JSON.stringify(snap).length; } catch (e) { return 0; }
  }

  /* ==================================================================
   * Node 自测（纯逻辑部分）
   * ================================================================== */
  function _selfTest() {
    var pass = 0, fail = 0;
    function assert(cond, msg) {
      if (cond) { pass++; console.log('  ✓ ' + msg); }
      else { fail++; console.error('  ✗ ' + msg); }
    }
    console.log('PrintGuardStore 自测：');

    var raw = {
      preset: 'fefco0427', isRgbFixed: true, bleedMm: 5, misregistrationMm: 0.3,
      trapMode: 'heavy', activePlate: 'm', zoom: 2.5, pan: { x: 10, y: -4 },
      foldAngleDeg: 45, barcode: { type: 'Code128', code: 'ABC-001', bwrMm: 0.02 },
      layers: { artwork: false, cut: true, crease: false, dims: true },
      customImageName: 'art.png', customImage: { NONSERIALIZABLE: true },
      customSeparationCache: { big: 1 }, mouseMm: { x: 1, y: 2 },
      _artworkDataUrl: 'data:image/png;base64,XXXX', _dxfRawText: '0\nSECTION\n2\nENTITIES'
    };
    var snap = serializeState(raw);
    assert(snap.preset === 'fefco0427' && snap.isRgbFixed === true && snap.bleedMm === 5, 'serializeState 保留白名单标量');
    assert(snap.barcode.code === 'ABC-001' && snap.pan.x === 10 && snap.layers.artwork === false, 'serializeState 深拷贝嵌套对象');
    assert(snap._artworkDataUrl === 'data:image/png;base64,XXXX' && snap._dxfRawText.indexOf('SECTION') === 2, 'serializeState 携带附件原稿');
    assert(!('customImage' in snap) && !('customSeparationCache' in snap) && !('mouseMm' in snap), 'serializeState 剔除运行时对象与易变键');
    assert(!('showLoupe' in snap) && !('splitView' in snap) && !('pipMinimized' in snap), 'serializeState 剔除瞬态 UI 模式（恢复时无法重放 DOM 状态）');

    var restored = deserializeState(snap);
    assert(restored.preset === 'fefco0427' && restored.zoom === 2.5 && restored.barcode.type === 'Code128', 'deserializeState 还原白名单字段');
    assert(!('_artworkDataUrl' in restored) && !('_dxfRawText' in restored), 'deserializeState 不直接暴露附件键');
    restored.pan.x = 999; restored.layers.cut = false; restored.barcode.code = 'MUTATED';
    assert(snap.pan.x === 10 && snap.layers.cut === true && snap.barcode.code === 'ABC-001', 'deserializeState 深拷贝：修改还原值不污染原快照');
    assert(restored.barcode.bwrMm === 0.02, 'deserializeState barcode 三字段完整');

    /* Proxy 脏标记 */
    var dirty = [];
    var proxy = createStateProxy(raw, function (k) { dirty.push(k); });
    proxy.preset = 'rigid_box';
    proxy.mouseMm = { x: 9, y: 9 };
    proxy.customSeparationCache = { rebuilt: 1 };
    assert(dirty.join(',') === 'preset', 'createStateProxy 仅对非易变键触发脏标记');

    /* 工程文件往返 */
    var fileText = exportProjectFile('测试工程', snap);
    var parsed = parseProjectFile(fileText);
    assert(!parsed.error && parsed.name === '测试工程' && parsed.snapshot.preset === 'fefco0427', '工程文件导出→导入往返一致');
    assert(parseProjectFile('not json').error, 'parseProjectFile 拒绝非 JSON');
    assert(parseProjectFile(JSON.stringify({ app: 'Other', snapshot: {} })).error, 'parseProjectFile 拒绝外来应用标识');

    assert(snapshotBytes(snap) > 100, 'snapshotBytes 估算非零');

    /* ---- 撤销/重做栈（纯逻辑） ---- */
    var cur = { v: 1 };
    var ustack = createUndoStack({
      limit: 3,
      batchIdleMs: 10,
      getSnap: function () { return JSON.parse(JSON.stringify(cur)); },
      applySnap: function (s) { cur = JSON.parse(JSON.stringify(s)); }
    });
    ustack.beginBatch(); cur.v = 2; ustack.flush();
    ustack.beginBatch(); cur.v = 3; ustack.flush();
    ustack.beginBatch(); cur.v = 4; ustack.flush();
    assert(ustack.depth() === 3 && ustack.canUndo(), '撤销栈记录 3 步变更');
    assert(ustack.undo() && cur.v === 3, 'undo 回滚到上一步');
    assert(ustack.undo() && cur.v === 2 && ustack.canRedo(), '连续 undo 与重做可用性');
    assert(ustack.redo() && cur.v === 3, 'redo 重放被撤销的变更');
    ustack.beginBatch(); cur.v = 9; ustack.flush();
    assert(ustack.redo() === false, '新操作分叉后重做分支被清空');
    ustack.beginBatch(); cur.v = 10; ustack.flush();
    ustack.beginBatch(); cur.v = 11; ustack.flush();
    ustack.beginBatch(); cur.v = 12; ustack.flush();
    ustack.beginBatch(); cur.v = 13; ustack.flush();
    assert(ustack.depth() === 3 && ustack.undo() && cur.v === 12, '限深 3：最旧快照被挤出，undo 落到次新');
    var d0 = ustack.depth();
    ustack.beginBatch(); cur.v = 99; ustack.cancelBatch();
    assert(ustack.depth() === d0, 'cancelBatch 丢弃未提交批不产生撤销步');
    ustack.beginBatch(); cur.v = 50; ustack.flush(); /* before=99 的真实批 */
    assert(ustack.undo() && cur.v === 99, '后续批正常提交，undo 落回批前值');
    assert(ustack.redo() && cur.v === 50, 'redo 重放该批');
    ustack.reset();
    assert(!ustack.canUndo() && !ustack.canRedo(), 'reset 清空撤销/重做栈');

    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail > 0 && typeof process !== 'undefined') process.exit(1);
    return fail === 0;
  }

  return {
    STATE_FIELDS: STATE_FIELDS,
    serializeState: serializeState,
    deserializeState: deserializeState,
    createStateProxy: createStateProxy,
    createAutosaver: createAutosaver,
    createUndoStack: createUndoStack,
    init: init,
    backendName: backendName,
    saveAutosave: saveAutosave,
    getAutosave: getAutosave,
    clearAutosave: clearAutosave,
    saveProject: saveProject,
    listProjects: listProjects,
    getProject: getProject,
    deleteProject: deleteProject,
    renameProject: renameProject,
    exportProjectFile: exportProjectFile,
    parseProjectFile: parseProjectFile,
    snapshotBytes: snapshotBytes,
    _selfTest: _selfTest
  };
});

/* Node 直接运行时执行自测 */
if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  module.exports._selfTest();
  /* 异步补充：初始化完成前到达的调用应排队落盘，而不是在 _backend 为 null 时静默丢失 */
  var __lsMock = {};
  global.localStorage = {
    setItem: function (k, v) { __lsMock[k] = String(v); },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(__lsMock, k) ? __lsMock[k] : null; },
    removeItem: function (k) { delete __lsMock[k]; }
  };
  var Store = module.exports;
  Store.saveAutosave({ preset: 'fefco0427', foldAngleDeg: 45 }).then(function (written) {
    return Store.getAutosave().then(function (rec) {
      var ok = !!written && !!rec && !!rec.snapshot && rec.snapshot.preset === 'fefco0427';
      console.log((ok ? '  ✓ ' : '  ✗ ') + '初始化窗口期调用 saveAutosave 排队落盘（早期调用不丢失）');
      if (!ok) process.exit(1);
      return Store.clearAutosave().then(function () {
        console.log('  ✓ 存储层异步链路（save → get → clear）自测通过');
      });
    });
  }).catch(function (e) {
    console.error('  ✗ 存储层异步链路异常: ' + (e && e.message));
    process.exit(1);
  });
}
