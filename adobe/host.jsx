/* ====================================================================
 * PrintGuard 提取 · Adobe Illustrator → PrintGuard Pro 工作台 桥接脚本
 * --------------------------------------------------------------------
 * 版本：1.0（阶段1 · 文件>脚本 菜单运行；阶段2 CEP 面板经 evalScript 复用）
 * 兼容：Illustrator 2023-2026（ExtendScript / ES3 语法，无 ES5+ 特性）
 *
 * 功能：
 *   1. 提取当前文档：名称 / 色彩模式 / 画板尺寸(mm) / 图层清单 /
 *      活动文字数与字体清单（转曲检查）/ 专色色板
 *   2. 按图层名分类刀线（CUT/DIE/THRU/PERIMETER/刀线 → CUT 层；
 *      CREASE/FOLD/SCORE/PERF/压痕 → CREASE 层），扁平化贝塞尔后
 *      合成 mm 单位 DXF 字符串（工作台零改动复用其 DXF 解析器）
 *   3. 导出活动画板 PNG 图稿并转 base64 dataURL
 *   4. 组装 PrintGuardIngest 草稿 JSON，写入 ingest drop 目录
 *      （server.py 监视入库），并调起浏览器打开工作台
 *
 * 安装：本文件拷入
 *   <Illustrator 安装目录>\Presets\zh_CN\Scripts\（或 en_US\Scripts\）
 * 重启 Illustrator 后出现在 文件 > 脚本 > PrintGuard 提取
 *
 * 配置：工作台不在 E:\包装印刷工作台 时，修改 CFG.DROP_DIR / CFG.SERVER_URL
 * ==================================================================== */

(function PrintGuardExtract() {

  var CFG = {
    DROP_DIR:    'E:/包装印刷工作台/ingest_drop',   /* server.py 的 ingest_drop 目录 */
    SERVER_URL:  'http://127.0.0.1:8787',           /* 工作台地址（须与 server.py 端口一致） */
    PNG_PPI:     100,                               /* 图稿导出分辨率 */
    PNG_MAX_B64: 10 * 1024 * 1024,                  /* base64 超过 10MB 放弃图稿 */
    MAX_POINTS:  30000,                             /* 刀线采样点总量保险丝 */
    MAX_TEXT_SCAN: 300,                             /* 字体扫描文本框上限 */
    BEZIER_STEPS: 10                                /* 贝塞尔扁平化分段数 */
  };

  var PT2MM = 25.4 / 72;

  /* ---------------------------------------------------------------
   * 基础工具（ES3）
   * --------------------------------------------------------------- */
  function mm(pt) { return Math.round(pt * PT2MM * 1000) / 1000; }

  function jsonEsc(s) {
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), code = s.charCodeAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 32) {
        var h = code.toString(16);
        while (h.length < 4) h = '0' + h;
        out += '\\u' + h;
      } else out += c;
    }
    return out;
  }

  function jstr(v) { return '"' + jsonEsc(v) + '"'; }
  function jnum(v) { return (typeof v === 'number' && isFinite(v)) ? String(v) : 'null'; }
  function inArray(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true;
    return false;
  }

  /* ExtendScript 无内置 base64：二进制串 → base64 */
  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Encode(bin) {
    var out = '', i = 0;
    while (i < bin.length) {
      var b0 = bin.charCodeAt(i++) & 0xFF;
      var b1 = i < bin.length ? bin.charCodeAt(i++) & 0xFF : NaN;
      var b2 = i < bin.length ? bin.charCodeAt(i++) & 0xFF : NaN;
      out += B64CHARS.charAt(b0 >> 2);
      out += B64CHARS.charAt(((b0 & 3) << 4) | (isNaN(b1) ? 0 : (b1 >> 4)));
      out += isNaN(b1) ? '=' : B64CHARS.charAt(((b1 & 15) << 2) | (isNaN(b2) ? 0 : (b2 >> 6)));
      out += isNaN(b2) ? '=' : B64CHARS.charAt(b2 & 63);
    }
    return out;
  }

  /* ---------------------------------------------------------------
   * 图层语义分类（与工作台 module_dxf_parser 的命名约定对齐）
   * --------------------------------------------------------------- */
  var CUT_RE = /(cut|cut_?contour|die|thru|perimeter|刀线|刀模|裁切)/i;
  var CREASE_RE = /(crease|fold|score|perf|压痕|折线|折痕)/i;

  function classifyLayerName(name) {
    var n = String(name || '');
    if (CREASE_RE.test(n)) return 'crease';
    if (CUT_RE.test(n)) return 'cut';
    return null;
  }

  /* ---------------------------------------------------------------
   * 路径收集：递归图层/编组/复合路径，扁平化贝塞尔，
   * 坐标 pt→mm 并翻转 Y（解析器按包围盒归心，绝对原点无关紧要）
   * --------------------------------------------------------------- */
  function handleIsAnchor(h) {
    /* Illustrator 角点常以 [0,0] 表示无手柄；按锚点处理 */
    return (Math.abs(h[0]) < 0.001 && Math.abs(h[1]) < 0.001);
  }

  function Sink(topPt, budget) {
    this.top = topPt;
    this.paths = [];
    this.truncated = false;
    this.budget = budget;
  }

  Sink.prototype.push = function (xPt, yPt) {
    if (this.budget <= 0) { this.truncated = true; return; }
    this.paths[this.paths.length - 1].pts.push([mm(xPt), mm(this.top - yPt)]);
    this.budget--;
  };

  function flattenCubic(sink, p0, c1, c2, p1) {
    var steps = CFG.BEZIER_STEPS;
    for (var i = 1; i <= steps; i++) {
      var t = i / steps, mt = 1 - t;
      var x = mt * mt * mt * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p1[0];
      var y = mt * mt * mt * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p1[1];
      sink.push(x, y);
    }
  }

  function collectPathItem(sink, pathItem) {
    if (pathItem.guides) return;
    var n = pathItem.pathPoints.length;
    if (n < 2) return;
    sink.paths.push({ pts: [], closed: !!pathItem.closed });
    var pts = pathItem.pathPoints;
    var p0 = pts[0].anchor;
    sink.push(p0[0], p0[1]);
    for (var i = 0; i < n - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var straight = handleIsAnchor(a.rightDirection) && handleIsAnchor(b.leftDirection);
      if (straight) {
        sink.push(b.anchor[0], b.anchor[1]);
      } else {
        var c1 = handleIsAnchor(a.rightDirection) ? a.anchor : a.rightDirection;
        var c2 = handleIsAnchor(b.leftDirection) ? b.anchor : b.leftDirection;
        flattenCubic(sink, a.anchor, c1, c2, b.anchor);
      }
    }
    if (pathItem.closed && pts.length > 2) {
      var last = pts[n - 1], first = pts[0];
      if (handleIsAnchor(last.rightDirection) && handleIsAnchor(first.leftDirection)) {
        sink.push(first.anchor[0], first.anchor[1]);
      } else {
        var cl1 = handleIsAnchor(last.rightDirection) ? last.anchor : last.rightDirection;
        var cl2 = handleIsAnchor(first.leftDirection) ? first.anchor : first.leftDirection;
        flattenCubic(sink, last.anchor, cl1, cl2, first.anchor);
      }
      sink.paths[sink.paths.length - 1].closed = true;
    }
    if (sink.paths[sink.paths.length - 1].pts.length < 2) sink.paths.pop();
  }

  function walkContainer(sink, container) {
    var i;
    for (i = 0; i < container.pathItems.length; i++) collectPathItem(sink, container.pathItems[i]);
    for (i = 0; i < container.compoundPathItems.length; i++) {
      var cp = container.compoundPathItems[i].pathItems;
      for (var j = 0; j < cp.length; j++) collectPathItem(sink, cp[j]);
    }
    for (i = 0; i < container.groupItems.length; i++) walkContainer(sink, container.groupItems[i]);
    if (container.typename === 'Layer') {
      for (i = 0; i < container.layers.length; i++) walkContainer(sink, container.layers[i]);
    }
  }

  function collectDieline(doc) {
    var rect = doc.artboards[0].artboardRect; /* [left, top, right, bottom]，y 向上 */
    var result = { cutPaths: [], creasePaths: [], cutLayers: [], creaseLayers: [], truncated: false };
    for (var i = 0; i < doc.layers.length; i++) {
      var kind = classifyLayerName(doc.layers[i].name);
      if (!kind) continue;
      if (kind === 'cut') result.cutLayers.push(doc.layers[i].name);
      else result.creaseLayers.push(doc.layers[i].name);
      var sink = new Sink(rect[1], CFG.MAX_POINTS);
      walkContainer(sink, doc.layers[i]);
      var target = (kind === 'cut') ? result.cutPaths : result.creasePaths;
      for (var p = 0; p < sink.paths.length; p++) target.push(sink.paths[p]);
      result.truncated = result.truncated || sink.truncated;
    }
    return result;
  }

  /* ---------------------------------------------------------------
   * 合成 DXF（mm 单位；图层 CUT / CREASE 与解析器分类正则对齐）
   * --------------------------------------------------------------- */
  function dxfEntity(path, layerName, out) {
    var pts = path.pts;
    if (pts.length < 2) return;
    out.push('0\nLWPOLYLINE\n8\n' + layerName + '\n90\n' + pts.length + '\n70\n' + (path.closed ? 1 : 0));
    for (var i = 0; i < pts.length; i++) {
      out.push('10\n' + pts[i][0] + '\n20\n' + pts[i][1]);
    }
  }

  function buildDxf(collected) {
    var out = [];
    out.push('0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC');
    out.push('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2');
    out.push('0\nLAYER\n2\nCUT\n70\n0\n62\n1\n6\nCONTINUOUS');
    out.push('0\nLAYER\n2\nCREASE\n70\n0\n62\n3\n6\nCONTINUOUS');
    out.push('0\nENDTAB\n0\nENDSEC');
    out.push('0\nSECTION\n2\nENTITIES');
    var i;
    for (i = 0; i < collected.cutPaths.length; i++) dxfEntity(collected.cutPaths[i], 'CUT', out);
    for (i = 0; i < collected.creasePaths.length; i++) dxfEntity(collected.creasePaths[i], 'CREASE', out);
    out.push('0\nENDSEC\n0\nEOF');
    return out.join('\n');
  }

  /* ---------------------------------------------------------------
   * 文档信息提取
   * --------------------------------------------------------------- */
  function collectDocInfo(doc) {
    var info = {
      name: doc.name || '未命名文档',
      colorSpace: (doc.documentColorSpace === DocumentColorSpace.RGB) ? 'RGB' : 'CMYK',
      widthMm: mm(doc.width),
      heightMm: mm(doc.height),
      artboards: doc.artboards.length,
      layers: []
    };
    for (var i = 0; i < doc.layers.length; i++) info.layers.push(doc.layers[i].name);

    /* 活动文字与字体清单（转曲检查） */
    var liveText = 0, fonts = {};
    var scanned = Math.min(doc.textFrames.length, CFG.MAX_TEXT_SCAN);
    for (var t = 0; t < scanned; t++) {
      try {
        var tf = doc.textFrames[t];
        if (tf.contents && tf.contents.length) {
          liveText++;
          var fn = '';
          try { fn = tf.textRange.characterAttributes.textFont.postScriptName || ''; } catch (eFont) { fn = ''; }
          if (fn) fonts[fn] = 1;
        }
      } catch (eTf) { /* 跳过异常文本框 */ }
    }
    var fontList = [];
    for (var f in fonts) if (fonts.hasOwnProperty(f)) fontList.push(f);
    info.liveTextTotal = doc.textFrames.length;
    info.liveTextCount = liveText;
    info.fonts = fontList.slice(0, 12);

    /* 专色色板（保持 spotSwatches 名称数组兼容，并新增 spotColorDetails 供色彩工坊查色域/ΔE） */
    var spots = [];
    var spotDetails = [];
    try {
      for (var s = 0; s < doc.swatches.length && spots.length < 16; s++) {
        if (doc.swatches[s].color && doc.swatches[s].color.typename === 'SpotColor') {
          var sName = doc.swatches[s].name;
          spots.push(sName);
          var detail = { name: sName };
          try {
            var sc = doc.swatches[s].color.spot && doc.swatches[s].color.spot.color;
            if (sc) {
              if (sc.typename === 'LabColor') {
                detail.lab = [Math.round(sc.l * 100) / 100, Math.round(sc.a * 100) / 100, Math.round(sc.b * 100) / 100];
              } else if (sc.typename === 'CMYKColor') {
                detail.cmyk = [Math.round(sc.cyan * 10) / 10, Math.round(sc.magenta * 10) / 10, Math.round(sc.yellow * 10) / 10, Math.round(sc.black * 10) / 10];
              } else if (sc.typename === 'RGBColor') {
                detail.rgb = [Math.round(sc.red), Math.round(sc.green), Math.round(sc.blue)];
              }
            }
          } catch (eSpotVal) { /* 单个专色内部色值读取失败不阻断 */ }
          spotDetails.push(detail);
        }
      }
    } catch (eSw) { /* 色板读取失败不致命 */ }
    info.spotSwatches = spots;
    info.spotColorDetails = spotDetails;
    return info;
  }

  /* ---------------------------------------------------------------
   * 图稿 PNG 导出 + base64
   * --------------------------------------------------------------- */
  function exportArtworkPng(doc, outFile) {
    var opts = new ExportOptionsPNG24();
    opts.resolution = CFG.PNG_PPI;
    opts.artBoardClipping = true;
    opts.transparency = true;
    opts.antiAliasing = true;
    doc.exportFile(outFile, ExportType.PNG24, opts);
    return outFile;
  }

  function readFileBinary(file) {
    file.encoding = 'BINARY';
    file.open('r');
    var bin = file.read();
    file.close();
    return bin;
  }

  /* ---------------------------------------------------------------
   * 草稿 JSON 组装（手写序列化，ExtendScript 无 JSON 对象）
   * --------------------------------------------------------------- */
  function joinMap(arr, fn) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(fn(arr[i]));
    return out.join(',');
  }

  function buildDraft(info, collected, dxfString, artworkDataUrl) {
    var parts = [];
    parts.push('"app":"PrintGuardIngest"');
    parts.push('"version":1');
    parts.push('"source":"illustrator-script"');
    parts.push('"createdAt":' + (new Date()).getTime());
    parts.push('"id":"ai-' + (new Date()).getTime() + '"');
    parts.push('"doc":{' +
      '"name":' + jstr(info.name) + ',' +
      '"colorSpace":' + jstr(info.colorSpace) + ',' +
      '"widthMm":' + jnum(info.widthMm) + ',' +
      '"heightMm":' + jnum(info.heightMm) + ',' +
      '"artboards":' + info.artboards + ',' +
      '"layers":[' + joinMap(info.layers, jstr) + ']}');
    function jnumArr(arr) {
      return '[' + joinMap(arr, jnum) + ']';
    }
    function jspotDetail(d) {
      var segs = ['"name":' + jstr(d.name)];
      if (d.lab) segs.push('"lab":' + jnumArr(d.lab));
      if (d.cmyk) segs.push('"cmyk":' + jnumArr(d.cmyk));
      if (d.rgb) segs.push('"rgb":' + jnumArr(d.rgb));
      return '{' + segs.join(',') + '}';
    }
    parts.push('"checks":{' +
      '"liveTextCount":' + info.liveTextCount + ',' +
      '"liveTextTotal":' + info.liveTextTotal + ',' +
      '"fonts":[' + joinMap(info.fonts, jstr) + '],' +
      '"spotSwatches":[' + joinMap(info.spotSwatches, jstr) + '],' +
      '"spotColorDetails":[' + joinMap(info.spotColorDetails || [], jspotDetail) + '],' +
      '"dielineLayers":{"cut":[' + joinMap(collected.cutLayers, jstr) +
      '],"crease":[' + joinMap(collected.creaseLayers, jstr) + ']},' +
      '"truncated":' + (collected.truncated ? 'true' : 'false') + '}');
    if (dxfString) parts.push('"dxf":' + jstr(dxfString));
    if (artworkDataUrl) parts.push('"artworkDataUrl":' + jstr(artworkDataUrl));
    return '{' + parts.join(',') + '}';
  }

  /* ---------------------------------------------------------------
   * drop 目录写入 + 打开工作台
   * --------------------------------------------------------------- */
  function resolveDropDir() {
    var f = new Folder(CFG.DROP_DIR);
    if (f.exists) return f;
    var fallback = new Folder(Folder.temp + '/printguard_ingest_drop');
    if (!fallback.exists) fallback.create();
    return fallback;
  }

  function writeDraft(draftJson) {
    var dir = resolveDropDir();
    var file = new File(dir.fsName + '/printguard_' + (new Date()).getTime() + '.json');
    file.encoding = 'UTF-8';
    file.open('w');
    file.write(draftJson);
    file.close();
    return file;
  }

  function openWorkbench() {
    try {
      var urlFile = new File(Folder.temp + '/printguard_open.url');
      urlFile.encoding = 'UTF-8';
      urlFile.open('w');
      urlFile.write('[InternetShortcut]\r\nURL=' + CFG.SERVER_URL + '/index.html#ingest=latest\r\n');
      urlFile.close();
      urlFile.execute();
      return true;
    } catch (eOpen) {
      return false;
    }
  }

  /* ---------------------------------------------------------------
   * 提取主流程
   * --------------------------------------------------------------- */
  function extractCore(includeDieline, includeArtwork) {
    /* 返回 { file, dxf, artworkUrl, cutCount, creaseCount }；异常向上抛 */
    var doc = app.activeDocument;
    var info = collectDocInfo(doc);
    var collected = collectDieline(doc);
    var dxfString = includeDieline ? buildDxf(collected) : '';

    var artworkDataUrl = '';
    if (includeArtwork) {
      var tmp = new File(Folder.temp + '/printguard_extract.png');
      try {
        exportArtworkPng(doc, tmp);
        var b64 = base64Encode(readFileBinary(tmp));
        if (b64.length <= CFG.PNG_MAX_B64) artworkDataUrl = 'data:image/png;base64,' + b64;
      } catch (eArt) {
        artworkDataUrl = '';
      } finally {
        try { tmp.remove(); } catch (eRm) { }
      }
    }

    var draft = buildDraft(info, collected, dxfString, artworkDataUrl);
    var file = writeDraft(draft);
    return {
      file: file.fsName,
      dxf: dxfString,
      artworkUrl: artworkDataUrl,
      cutCount: collected.cutPaths.length,
      creaseCount: collected.creasePaths.length,
      liveText: info.liveTextCount
    };
  }

  function summarizeResult(r, openAfterSend) {
    var msg = '草稿已写入：\n' + r.file +
      '\n\n刀线 DXF：' + (r.dxf ? '已包含（CUT ' + r.cutCount + ' 条 / CREASE ' + r.creaseCount + ' 条）' : '未包含') +
      '\n图稿 PNG：' + (r.artworkUrl ? '已包含（' + Math.round(r.artworkUrl.length / 1024) + ' KB）' : '未包含');
    if (openAfterSend) {
      if (openWorkbench()) {
        msg += '\n\n已调起浏览器，工作台将自动应用最新草稿。';
      } else {
        msg += '\n\n未能自动打开浏览器，请手动访问：\n' + CFG.SERVER_URL + '/index.html#ingest=latest';
      }
    }
    return msg;
  }

  function runExtract(includeDieline, includeArtwork, openAfterSend) {
    var r = extractCore(includeDieline, includeArtwork);
    alert(summarizeResult(r, openAfterSend));
  }

  /* ---------------------------------------------------------------
   * ScriptUI 对话框入口
   * --------------------------------------------------------------- */
  function mainDialog() {
    if (!app.documents.length) {
      alert('PrintGuard 提取：当前没有打开的文档。');
      return;
    }
    var doc = app.activeDocument;
    var info = collectDocInfo(doc);
    var collected = collectDieline(doc);
    var cutCount = collected.cutPaths.length;
    var creaseCount = collected.creasePaths.length;

    var choice = { action: 'cancel', dieline: true, artwork: true, open: false };

    var dlg = new dialog('PrintGuard 提取 → 印前工作台');
    dlg.orientation = 'column';
    dlg.alignChildren = ['fill', 'top'];
    dlg.spacing = 8;
    dlg.margins = 16;

    dlg.add('statictext', undefined, '文档：' + info.name);
    dlg.add('statictext', undefined, '尺寸：' + info.widthMm + ' × ' + info.heightMm + ' mm · ' +
      info.colorSpace + ' · ' + info.artboards + ' 画板');
    dlg.add('statictext', undefined, '活动文字：' + info.liveTextCount + ' 处' +
      (info.liveTextCount > 0 ? '（未转曲，印刷前需处理）' : '（已全部转曲）'));
    dlg.add('statictext', undefined, '刀线：CUT ' + cutCount + ' 条 / CREASE ' + creaseCount + ' 条' +
      ((cutCount + creaseCount === 0) ? '（未检出刀线命名图层！）' : ''));
    if (collected.truncated) dlg.add('statictext', undefined, '⚠ 刀线点数超限，已截断采样');

    var cbDieline = dlg.add('checkbox', undefined, '包含刀线 DXF');
    cbDieline.value = (cutCount > 0);
    cbDieline.enabled = (cutCount > 0);
    var cbArtwork = dlg.add('checkbox', undefined, '包含图稿 PNG');
    cbArtwork.value = true;

    var grp = dlg.add('group');
    grp.alignment = 'right';
    grp.add('button', undefined, '取消', { name: 'cancel' }).onClick = function () { dlg.close(); };
    grp.add('button', undefined, '仅导出草稿').onClick = function () {
      choice.action = 'send';
      choice.open = false;
      choice.dieline = cbDieline.value;
      choice.artwork = cbArtwork.value;
      dlg.close();
    };
    grp.add('button', undefined, '发送并打开工作台', { name: 'ok' }).onClick = function () {
      choice.action = 'send';
      choice.open = true;
      choice.dieline = cbDieline.value;
      choice.artwork = cbArtwork.value;
      dlg.close();
    };

    dlg.show();
    if (choice.action === 'send') {
      runExtract(choice.dieline, choice.artwork, choice.open);
    }
  }

  /* ---------------------------------------------------------------
   * 对外桥接：本文件作为库被加载（Script 菜单入口脚本 evalFile 本文件后
   * 调 openDialog；CEP 面板经 ScriptPath 自动加载后调 extractAndSendSilent）
   * --------------------------------------------------------------- */
  this.PrintGuardBridge = {
    version: '1.0',
    openDialog: function () {
      try {
        mainDialog();
      } catch (eDlg) {
        alert('PrintGuard 提取出错：' + (eDlg && eDlg.message ? eDlg.message : eDlg));
      }
    },
    /* CEP 静默提取：落盘草稿，返回 JSON 摘要字符串（不弹窗） */
    extractAndSendSilent: function (includeDieline, includeArtwork) {
      try {
        var r = extractCore(includeDieline !== false, includeArtwork !== false);
        return JSON.stringify({
          ok: true, file: r.file,
          dxf: !!r.dxf, artwork: !!r.artworkUrl,
          cutCount: r.cutCount, creaseCount: r.creaseCount, liveText: r.liveText
        });
      } catch (eSilent) {
        return JSON.stringify({ ok: false, error: String(eSilent && eSilent.message ? eSilent.message : eSilent) });
      }
    }
  };
})();
