/* ====================================================================
 * PrintGuard Pro · Preflight Explainer — 预检报告「人话解释层」与处置分级引擎
 * --------------------------------------------------------------------
 * 职责（纯逻辑，零外部依赖，浏览器与 Node 双端可运行）：
 *   1. 为每条印前预检结论（ΔE 超标、TAC 超限、静区不足、未转曲、RGB、
 *      纯黑镂空、糊盒粘口油墨、专色刀线、出血不足等）生成三段式通俗解释：
 *        「这是什么问题 → 不改印出来会怎样 → 建议怎么改」
 *   2. 严格区分两类处置权限（对齐智能印厂自动修正安全分级原则）：
 *        - safe_auto_fix          ：可安全自动修正（不改变客户视觉设计意图）
 *        - human_confirm_required ：必须人工/客户确认（涉及偏色/版面/文字内容改动）
 *   3. 默认采用本地规则模板引擎（零 LLM API 依赖、离线毫秒级可跑），
 *      同时预留可插拔 LLM Provider 适配接口（registerLlmProvider /
 *      explainReportAsync / createOpenAICompatibleProvider），
 *      且强制守护「LLM 仅可润色文案，严禁篡改 status / actionTier / autoFixable」。
 *
 * 自测：node module_preflight_explainer.js
 * ==================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintGuardExplainer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = '1.0';
  var BUILTIN_PROVIDER = 'builtin-rules-v1';

  /* 处置分级枚举 */
  var ACTION_TIER = Object.freeze({
    SAFE_AUTO_FIX: 'safe_auto_fix',
    HUMAN_CONFIRM: 'human_confirm_required',
    NONE: 'none'
  });

  var ACTION_TIER_LABEL = Object.freeze({
    safe_auto_fix: '可安全自动修正',
    human_confirm_required: '必须人工/客户确认',
    none: '已通过（无需修正）'
  });

  /* ------------------------------------------------------------------
   * 规则元数据表：固化每项检查的安全分级（不会被 LLM 输出覆盖）
   * ------------------------------------------------------------------ */
  var RULE_META = Object.freeze({
    rgb_color_space: {
      title: '色彩空间模式 (RGB/CMYK)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: 'fixRgbBtn'
    },
    overprint_black: {
      title: '纯黑文字叠印直压 (K100 Overprint)',
      defaultTier: ACTION_TIER.SAFE_AUTO_FIX,
      fixActionId: 'toggleOverprintBtn'
    },
    tac_limit: {
      title: '最大总墨量限制 (TAC / TIC)',
      defaultTier: ACTION_TIER.SAFE_AUTO_FIX,
      fixActionId: 'fixTacBtn'
    },
    fonts_outlined: {
      title: '字体转曲完整性 (Outlined Fonts)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: 'fixOutlineBtn'
    },
    glue_tab: {
      title: '糊盒粘口除墨 (Glue Tab)',
      defaultTier: ACTION_TIER.SAFE_AUTO_FIX,
      fixActionId: 'fixGlueBtn'
    },
    cut_contour: {
      title: '专色刀模线属性 (CutContour)',
      defaultTier: ACTION_TIER.SAFE_AUTO_FIX,
      fixActionId: null
    },
    delta_e: {
      title: 'CIEDE2000 色差评测 (ΔE₀₀)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: null
    },
    barcode_quiet_zone: {
      title: '工业条码静区与 BWR 补偿 (GS1)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: null
    },
    bleed: {
      title: '成品出血位 (Bleed)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: null
    },
    dieline_layers: {
      title: '刀线/折线图层规范 (Dieline)',
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: null
    }
  });

  /* 当前已注册的可选 LLM 适配器（默认 null，离线走规则模板） */
  var registeredLlmProvider = null;

  function fmtNum(val, digits) {
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return val.toFixed(digits == null ? 2 : digits);
  }

  function buildSummarySentence(what, impact, suggestion) {
    return '【问题】' + what + ' → 【不改后果】' + impact + ' → 【建议】' + suggestion;
  }

  function normalizeStatus(raw) {
    var s = String(raw || '').toUpperCase();
    if (s === 'PASS' || s === 'WARN' || s === 'FAIL' || s === 'SKIP') return s;
    return 'WARN';
  }

  /* ------------------------------------------------------------------
   * 单条预检结论的规则模板解释器
   * ------------------------------------------------------------------ */
  function explainItem(finding) {
    var f = finding || {};
    var id = String(f.id || 'unknown');
    var status = normalizeStatus(f.status);
    var meta = RULE_META[id] || {
      title: f.title || id,
      defaultTier: ACTION_TIER.HUMAN_CONFIRM,
      fixActionId: null
    };
    var title = f.title || meta.title;
    var details = f.details || {};
    var measured = f.measured != null ? String(f.measured) : '';
    var threshold = f.threshold != null ? String(f.threshold) : '';

    var what = '';
    var impact = '';
    var suggestion = '';
    var actionTier = status === 'PASS' ? ACTION_TIER.NONE : meta.defaultTier;

    if (id === 'rgb_color_space') {
      if (status === 'PASS') {
        what = '图稿已全部处于 CMYK 印刷色彩空间，未发现 RGB 图片或对象';
        impact = '不会发生因 RGB 临时转色引发的意外色偏';
        suggestion = '保持当前 CMYK 文件与目标工艺 ICC 一致即可直接进入下一步';
      } else {
        var rgbCount = Number(details.rgbCount || 1);
        what = '文件里还有 ' + rgbCount + ' 处 RGB 屏幕色图稿，没有转成印刷用的 CMYK 四色';
        impact = '印刷机只能用 CMYK 油墨印，直接出片会被强制转换，鲜亮的蓝、绿、橙色会明显发暗发灰，整批货偏色';
        suggestion = '先由印前按目标工艺 ICC（如 ISO Coated v2 / Fogra39）转为 CMYK 并打样给客户确认颜色，不可静默替客户改色';
      }
    } else if (id === 'overprint_black') {
      if (status === 'PASS') {
        what = '纯黑（K100）小字与条码已设为叠印直压，直接压印在底色之上';
        impact = '高速印刷轻微走纸时也不会在黑字边缘露出白色缝隙';
        suggestion = '无需调整，保持纯黑叠印设置即可';
      } else {
        var koCount = Number(details.knockoutCount || 16);
        what = '纯黑小字和条码现在是「镂空掏底」（检出约 ' + koCount + ' 处），会把下面的彩色底版挖空';
        impact = '印刷机套印只要偏差 0.1~0.2mm，黑字和条码边缘就会出现一圈刺眼白边（露白），小字发虚难读';
        suggestion = '可直接由系统一键开启「K100 纯黑直压（Overprint）」，不改变画面外观即可消除露白风险';
      }
    } else if (id === 'tac_limit') {
      var peak = typeof details.tacPeakPercent === 'number' ? details.tacPeakPercent : null;
      var limit = typeof details.tacLimitPercent === 'number' ? details.tacLimitPercent : (details.isTacFixed ? 280 : 340);
      if (status === 'SKIP') {
        what = '当前画布受跨域安全限制，未能实测像素级总墨量（TAC）';
        impact = '无法自动确认暗部是否叠墨过厚，存在潜在背面粘脏和干燥缓慢风险';
        suggestion = '请通过本地服务（python server.py）打开同源图稿复测，或用 Acrobat/RIP 输出预览核查总墨量是否 ≤ 300%';
        actionTier = ACTION_TIER.HUMAN_CONFIRM;
      } else if (status === 'PASS') {
        what = '实测最大总墨量' + (peak != null ? '为 ' + Math.round(peak) + '%' : '受控') + '，处于当前限额 ' + Math.round(limit) + '% 以内';
        impact = '油墨干燥速度与纸张承载力正常，不易出现背面蹭脏或糊版';
        suggestion = details.isTacFixed
          ? '已应用 UCR 控墨（≤280%），可直接制版'
          : '当前未超默认限额；若用轻涂/高吸墨或高速双面印，建议再启用 UCR 压到 280% 以下更稳妥';
      } else {
        what = '暗部区域的四色叠加总墨量（TAC）达到 ' + (peak != null ? Math.round(peak) + '%' : '超限值') + '，超过了纸张安全上限 ' + Math.round(limit) + '%';
        impact = '油墨太厚干不透，收纸堆叠时会把背面蹭脏（背粘）、拖花，甚至把相邻印张粘连报废';
        suggestion = '可直接由系统一键应用「UCR/GCR 控墨」把总墨量平滑压回 280% 安全线，暗部视觉基本不变';
      }
    } else if (id === 'fonts_outlined') {
      if (status === 'PASS') {
        what = '文档内所有文字已转为纯矢量轮廓（转曲），不依赖外部字库文件';
        impact = '发排到任何制版机（RIP）都不会出现缺字、替字或换行错位';
        suggestion = '无需修改，可安全进入制版流程';
      } else {
        var liveCount = Number(details.liveTextCount || 4);
        var fontHint = (Array.isArray(details.fonts) && details.fonts.length)
          ? '（涉及字体：' + details.fonts.slice(0, 3).join('、') + '）'
          : '';
        what = '文档里还有 ' + liveCount + ' 处未转曲的活动文字' + fontHint + '，依赖本机字体库才能正常显示';
        impact = '送到印厂制版系统如果缺这套字体，文字会被强行替换成宋体/默认字体，导致排版跑位、标点错乱甚至乱码报废';
        suggestion = '必须退回设计师/客户在装有原字体的电脑上核对无错别字后执行「文字转曲」或完整嵌入字体，不可在缺字环境下自动转曲';
      }
    } else if (id === 'glue_tab') {
      if (status === 'PASS') {
        what = details.glueFree
          ? '当前盒型为免胶自锁结构，无粘口除墨风险'
          : '15mm 糊盒粘胶位已完成脱墨留白，纸纤维裸露可充分吃胶';
        impact = '后道自动糊盒机上胶牢固，运输和堆码不易开胶崩盒';
        suggestion = '无需修改，保持粘口净空即可';
      } else {
        what = '纸盒 15mm 糊盒粘胶位上还留着底色油墨或光油涂层';
        impact = '热熔胶/白乳胶粘在光滑油墨层上抓不牢，成品装箱或遇冷热变化极易开胶、崩盒退货';
        suggestion = '粘口在盒内不可见，可直接由系统一键「粘口脱墨留白」，不影响外观设计';
      }
    } else if (id === 'cut_contour') {
      if (status === 'PASS') {
        what = '刀模线图层（CutContour）命名规范且已绑定叠印专色属性';
        impact = '制版时可正确分离给模切刀版，不会误印到彩盒成品表面';
        suggestion = '保持专色刀线独立图层与叠印属性即可';
      } else {
        what = '刀模线属性未正确设为独立叠印专色';
        impact = '刀线可能直接印在彩盒图案上，或把下方图案镂空留出一条白线';
        suggestion = '由印前把刀线统一规范为 CutContour 专色并设为强制叠印（Overprint），出片前核对分色预览';
      }
    } else if (id === 'delta_e') {
      var de = typeof details.deltaE === 'number' ? details.deltaE : null;
      if (status === 'SKIP') {
        what = '画布跨域受限或色差引擎未就绪，本次未能实测 ΔE₀₀ 色差峰值';
        impact = '缺少客观色差数值依据，无法提前发现超色域偏色';
        suggestion = '请通过同源本地服务重新加载图稿执行实测，或在实体打样后用分光光度计复测';
        actionTier = ACTION_TIER.HUMAN_CONFIRM;
      } else if (status === 'PASS') {
        what = '实测最大色差 ΔE₀₀ = ' + (de != null ? fmtNum(de, 2) : '≤1.50') + '，符合 ISO 12647-2 优秀印刷标准（≤ 1.50）';
        impact = '人眼几乎看不出与标准参考色的差异，印刷还原度高';
        suggestion = '色差合格，按当前工艺参数正常打样/上机即可';
      } else if (status === 'WARN') {
        what = '实测最大色差 ΔE₀₀ = ' + (de != null ? fmtNum(de, 2) : '1.5~2.5') + '，处于商业允收临界区间（1.50 ~ 2.50）';
        impact = '普通场景可接受，但对品牌主色或严苛客户可能会察觉轻微偏色';
        suggestion = '必须让客户或质检主管看打样确认是否接受该偏差；若为核心品牌色，建议微调分色配方或改走专色';
      } else {
        what = '实测最大色差 ΔE₀₀ = ' + (de != null ? fmtNum(de, 2) : '>2.50') + '，已超过工业允收红线（> 2.50）';
        impact = '印出来的成品肉眼就能明显看出偏色、发灰或色相跑偏，极易触发客户拒收返工';
        suggestion = '必须暂停制版并与客户确认：调整原稿超色域颜色、改用 Pantone 专色，或经客户书面签样确认接受现色域还原';
      }
    } else if (id === 'barcode_quiet_zone') {
      var actualMm = typeof details.actualMm === 'number' ? details.actualMm : null;
      var minMm = typeof details.minRequiredMm === 'number' ? details.minRequiredMm : 2.54;
      var shortfallMm = typeof details.shortfallMm === 'number' ? details.shortfallMm : null;
      if (status === 'SKIP') {
        what = '条码引擎未就绪，未能完成 GS1 静区与 BWR 核验';
        impact = '无法确认条码能否被商超/物流扫码枪稳定识别';
        suggestion = '请确认条码参数有效后重新体检，或用专业条码检测仪复核';
        actionTier = ACTION_TIER.HUMAN_CONFIRM;
      } else if (status === 'PASS') {
        what = '条码左右空白静区' + (actualMm != null ? '（' + fmtNum(actualMm, 2) + 'mm ≥ ' + fmtNum(minMm, 2) + 'mm）' : '') + '与 BWR 条宽补偿均符合 GS1 规范';
        impact = '印刷油墨轻微扩网后条码仍保持清晰对比度，商超与仓储扫码顺畅';
        suggestion = '保持当前条码静区与 BWR 参数，切勿在后续改稿时把图文贴近条码两侧';
      } else {
        what = '条码两侧的空白保护区（静区）不够宽' + (shortfallMm != null ? '，还差 ' + fmtNum(shortfallMm, 2) + 'mm' : '（低于 GS1 最低 ' + fmtNum(minMm, 2) + 'mm 要求）');
        impact = '扫码枪找不到条码起止边界，入库、收银或快递分拣时频繁扫不出，可能被商超整批拒收或罚款';
        suggestion = '必须退回设计师/客户调整版面：移开条码周边图文或按规范微调条码缩放，把左右静区留足 ≥ ' + fmtNum(minMm, 2) + 'mm（涉及版面构图，不可自动裁图）';
      }
    } else if (id === 'bleed') {
      var bleedMm = typeof details.bleedMm === 'number' ? details.bleedMm : 0;
      if (status === 'PASS') {
        what = '四周出血已留足 ' + fmtNum(bleedMm, 1) + 'mm（≥ 3.0mm 标准）';
        impact = '模切或裁切产生 ±0.5mm 机械公差时也不会露白边';
        suggestion = '出血合规，无需改动';
      } else {
        what = '成品边缘出血只有 ' + fmtNum(bleedMm, 1) + 'mm，不足包装印刷通用的 3.0mm 安全线';
        impact = '模切刀轻微偏移就会在盒边切出一道难看的白边，影响成品档次';
        suggestion = '必须由设计师把底色和边缘背景向外延展补足至 3.0mm 并经客户确认，避免简单拉伸变形';
      }
    } else if (id === 'dieline_layers') {
      if (status === 'PASS') {
        what = '刀线（CUT）与压痕折线（CREASE）图层结构完整可识别';
        impact = '可正常对接 3D 折叠打样与模切刀版制作';
        suggestion = '保持图层命名规范即可';
      } else {
        what = '文件中未找到规范命名的刀线或压痕折线图层（如 CUT / CREASE）';
        impact = '3D 折叠无法按真实盒型展开，发给刀模厂也容易把刀线和压痕混淆切错';
        suggestion = '必须由结构工程师或设计师在原稿中明确分出 CUT（裁切）与 CREASE（压痕）独立图层后重新导出';
      }
    } else {
      what = f.what || (title + ' 检测到状态异常（' + status + '）');
      impact = f.impact || '直接上机可能引发印品质量瑕疵或返工风险';
      suggestion = f.suggestion || '请由印前工程师复核具体参数并与客户确认处理方案';
    }

    var autoFixable = (status !== 'PASS' && status !== 'SKIP' && actionTier === ACTION_TIER.SAFE_AUTO_FIX);
    var actionTierLabel = status === 'PASS'
      ? ACTION_TIER_LABEL.none
      : (status === 'SKIP' ? '已跳过（需人工复核环境）' : (ACTION_TIER_LABEL[actionTier] || ACTION_TIER_LABEL.human_confirm_required));

    return {
      id: id,
      title: title,
      status: status,
      measured: measured,
      threshold: threshold,
      actionTier: actionTier,
      actionTierLabel: actionTierLabel,
      autoFixable: autoFixable,
      fixActionId: autoFixable ? meta.fixActionId : null,
      what: what,
      impact: impact,
      suggestion: suggestion,
      summary: buildSummarySentence(what, impact, suggestion),
      source: 'rule_template',
      provider: BUILTIN_PROVIDER
    };
  }

  /* ------------------------------------------------------------------
   * 从工作台实时审计上下文组装 8 项标准预检 findings（并支持可选 bleed）
   * ------------------------------------------------------------------ */
  function buildFindingsFromContext(ctx) {
    var c = ctx || {};
    var findings = [];

    // 1. RGB 色彩空间
    findings.push({
      id: 'rgb_color_space',
      title: '1. 色彩空间模式 (Color Space)',
      threshold: 'CMYK Fogra39 / 无 RGB',
      measured: c.isRgbFixed ? '纯 CMYK 资产' : '检测到 RGB 图像资产',
      status: c.isRgbFixed ? 'PASS' : 'FAIL',
      details: { rgbCount: c.rgbCount || 1 }
    });

    // 2. 纯黑叠印直压
    findings.push({
      id: 'overprint_black',
      title: '2. 纯黑文字叠印直压 (Overprint K100)',
      threshold: 'K100 强制 Overprint',
      measured: c.isOverprintBlack ? '100% 叠印直压绑定' : '检测到镂空掏色',
      status: c.isOverprintBlack ? 'PASS' : 'WARN',
      details: { knockoutCount: c.knockoutCount || 16 }
    });

    // 3. 总墨量限制 TAC
    var tacStatus = 'SKIP';
    var tacMeasured = 'N/A（画布跨域受限）';
    var tacPeakPercent = null;
    var tacLimitPercent = c.isTacFixed ? 280 : 340;
    if (c.tacAudit && typeof c.tacAudit.tacPeak === 'number') {
      tacPeakPercent = c.tacAudit.tacPeak * 100;
      tacLimitPercent = (typeof c.tacAudit.tacLimit === 'number' ? c.tacAudit.tacLimit : (c.isTacFixed ? 2.8 : 3.4)) * 100;
      var over = tacPeakPercent > tacLimitPercent;
      tacStatus = over ? 'FAIL' : 'PASS';
      tacMeasured = '峰值 ' + Math.round(tacPeakPercent) + '% / 限额 ' + Math.round(tacLimitPercent) + '%';
    }
    findings.push({
      id: 'tac_limit',
      title: '3. 最大总墨量限制 (TAC / TIC)',
      threshold: c.isTacFixed ? '≤ 280% (UCR 控墨后)' : '≤ 340% (默认分色)',
      measured: tacMeasured,
      status: tacStatus,
      details: {
        isTacFixed: !!c.isTacFixed,
        tacPeakPercent: tacPeakPercent,
        tacLimitPercent: tacLimitPercent
      }
    });

    // 4. 字体转曲
    findings.push({
      id: 'fonts_outlined',
      title: '4. 字体转曲完整性 (Outlined Fonts)',
      threshold: '0 活动文字 / 纯矢量轮廓',
      measured: c.isOutlined ? '全文档文字已转曲' : '存在 ' + (c.liveTextCount || 4) + ' 处活动文本',
      status: c.isOutlined ? 'PASS' : 'FAIL',
      details: {
        liveTextCount: c.liveTextCount || 4,
        fonts: Array.isArray(c.fonts) ? c.fonts : []
      }
    });

    // 5. 糊盒粘口除墨
    var glueFree = c.preset === 'fefco0427';
    var gluePass = glueFree || !!c.isGlueCleaned;
    findings.push({
      id: 'glue_tab',
      title: '5. 糊盒粘口除墨 (Glue Tab Knockout)',
      threshold: '粘胶位 15mm 0% 墨量',
      measured: glueFree ? '免胶自锁盒型' : (c.isGlueCleaned ? '100% 洁净脱墨' : '残留背景油墨'),
      status: gluePass ? 'PASS' : 'FAIL',
      details: { glueFree: glueFree }
    });

    // 6. 专色刀模线
    var cutPass = c.cutContourValid !== false;
    findings.push({
      id: 'cut_contour',
      title: '6. 专色刀模线属性 (CutContour Spot)',
      threshold: '专色命名规范 + 强制叠印',
      measured: cutPass ? '命名标准: CutContour' : '刀线专色/叠印属性异常',
      status: cutPass ? 'PASS' : 'WARN',
      details: {}
    });

    // 7. CIEDE2000 色差
    var deStatus = 'SKIP';
    var deMeasured = 'ΔE₀₀ N/A（画布跨域受限）';
    var deVal = null;
    if (c.deltaEAudit && typeof c.deltaEAudit.deltaE === 'number') {
      deVal = c.deltaEAudit.deltaE;
      deStatus = deVal <= 1.5 ? 'PASS' : (deVal <= 2.5 ? 'WARN' : 'FAIL');
      deMeasured = 'ΔE₀₀ ' + deVal.toFixed(2);
    }
    findings.push({
      id: 'delta_e',
      title: '7. CIEDE2000 色差评测 (Colorimetry ΔE₀₀)',
      threshold: 'ΔE₀₀ ≤ 1.50 (ISO 12647-2)',
      measured: deMeasured,
      status: deStatus,
      details: { deltaE: deVal }
    });

    // 8. GS1 条码静区与 BWR
    var qzStatus = 'SKIP';
    var qzMeasured = '静区 N/A';
    var qzDetails = { bwrMm: c.bwrMm };
    if (c.quietZoneAudit && c.quietZoneAudit.left) {
      var left = c.quietZoneAudit.left;
      qzStatus = c.quietZoneAudit.compliant ? 'PASS' : 'WARN';
      qzMeasured = c.quietZoneAudit.compliant
        ? '静区 ' + left.actualMm.toFixed(2) + 'mm ≥ ' + left.minRequiredMm.toFixed(2) + 'mm'
        : '静区亏缺 ' + left.shortfallMm.toFixed(2) + 'mm';
      qzDetails.actualMm = left.actualMm;
      qzDetails.minRequiredMm = left.minRequiredMm;
      qzDetails.shortfallMm = left.shortfallMm;
    }
    findings.push({
      id: 'barcode_quiet_zone',
      title: '8. 工业条码与 BWR 墨水补偿 (GS1 & BWR)',
      threshold: 'GS1 静区 ≥ 2.54mm | BWR 补偿受控',
      measured: qzMeasured,
      status: qzStatus,
      details: qzDetails
    });

    // 可选 9：出血检查（当显式开启 includeBleed 且 bleedMm < 3 时纳入解释清单）
    if (c.includeBleed && typeof c.bleedMm === 'number') {
      findings.push({
        id: 'bleed',
        title: '9. 成品出血位 (Bleed)',
        threshold: '四周出血 ≥ 3.0mm',
        measured: '当前出血 ' + c.bleedMm.toFixed(1) + 'mm',
        status: c.bleedMm >= 3.0 ? 'PASS' : 'WARN',
        details: { bleedMm: c.bleedMm }
      });
    }

    return findings;
  }

  /* ------------------------------------------------------------------
   * 汇总整份预检报告的通俗解释 + 双级处置分桶
   * ------------------------------------------------------------------ */
  function explainReport(auditContextOrFindings) {
    var findings = Array.isArray(auditContextOrFindings)
      ? auditContextOrFindings
      : buildFindingsFromContext(auditContextOrFindings);

    var items = findings.map(explainItem);
    var safeAutoFix = [];
    var humanConfirmRequired = [];
    var passedOrSkipped = [];
    var counts = {
      total: items.length,
      pass: 0,
      warn: 0,
      fail: 0,
      skip: 0,
      safeAutoFix: 0,
      humanConfirmRequired: 0
    };

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.status === 'PASS') counts.pass++;
      else if (it.status === 'WARN') counts.warn++;
      else if (it.status === 'FAIL') counts.fail++;
      else counts.skip++;

      if (it.status === 'PASS' || it.status === 'SKIP') {
        passedOrSkipped.push(it);
      } else if (it.actionTier === ACTION_TIER.SAFE_AUTO_FIX) {
        safeAutoFix.push(it);
        counts.safeAutoFix++;
      } else {
        humanConfirmRequired.push(it);
        counts.humanConfirmRequired++;
      }
    }

    var summaryText = '';
    if (counts.fail === 0 && counts.warn === 0) {
      summaryText = counts.skip > 0
        ? '已检测项目全部通过，另有 ' + counts.skip + ' 项因环境限制跳过，请在本地同源环境下补测后再放行制版。'
        : '所有印前检查项均已通过，颜色、墨量、文字、粘口与条码全部达标，可以直接安排出片上机。';
    } else {
      var parts = [];
      parts.push('本次体检共发现 ' + (counts.fail + counts.warn) + ' 项待处理问题（阻断 ' + counts.fail + ' 项、警示 ' + counts.warn + ' 项）。');
      if (counts.safeAutoFix > 0) {
        parts.push('其中 ' + counts.safeAutoFix + ' 项属于「可安全自动修正」（如纯黑直压/UCR 控墨/粘口脱墨），系统可直接代劳且不改设计外观；');
      }
      if (counts.humanConfirmRequired > 0) {
        parts.push('另有 ' + counts.humanConfirmRequired + ' 项属于「必须人工/客户确认」（涉及颜色观感、活字转曲或条码版面），严禁静默改稿，请发给设计师或客户确认后再放行。');
      }
      summaryText = parts.join('');
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      source: 'rule_template',
      provider: BUILTIN_PROVIDER,
      summaryText: summaryText,
      counts: counts,
      buckets: {
        safe_auto_fix: safeAutoFix,
        human_confirm_required: humanConfirmRequired,
        passed_or_skipped: passedOrSkipped
      },
      items: items
    };
  }

  /* ------------------------------------------------------------------
   * 面向外部 Illustrator 桥接草稿（app-ingest.js）的人话解释辅助
   * ------------------------------------------------------------------ */
  function explainIngestDraft(draft) {
    var d = draft || {};
    var doc = d.doc || {};
    var checks = d.checks || {};
    var findings = [];
    if (String(doc.colorSpace || '').toUpperCase() === 'RGB') {
      findings.push({
        id: 'rgb_color_space',
        status: 'FAIL',
        measured: 'AI 文档色彩模式为 RGB',
        threshold: 'CMYK',
        details: { rgbCount: 1 }
      });
    }
    var live = Number(checks.liveTextCount || 0);
    if (live > 0) {
      findings.push({
        id: 'fonts_outlined',
        status: 'FAIL',
        measured: live + ' 处活动文字未转曲',
        threshold: '0 活动文字',
        details: { liveTextCount: live, fonts: checks.fonts || [] }
      });
    }
    var dieline = checks.dielineLayers || {};
    if (!dieline.cut || !dieline.cut.length) {
      findings.push({
        id: 'dieline_layers',
        status: 'WARN',
        measured: '未识别到 CUT/DIE 刀线图层',
        threshold: '含 CUT/CREASE 图层',
        details: {}
      });
    }
    return explainReport(findings);
  }

  /* ------------------------------------------------------------------
   * 面向客户/业务员的纯文本通俗清单导出（一键复制发微信/邮件）
   * ------------------------------------------------------------------ */
  function formatPlainTextReport(explainedReport) {
    var rep = explainedReport || explainReport([]);
    var lines = [];
    lines.push('【PrintGuard Pro 印前体检通俗说明】');
    lines.push(rep.summaryText);

    if (rep.buckets.human_confirm_required.length) {
      lines.push('');
      lines.push('一、必须人工/客户确认（' + rep.buckets.human_confirm_required.length + ' 项，系统不会自动改稿）：');
      rep.buckets.human_confirm_required.forEach(function (it, idx) {
        lines.push((idx + 1) + '. ' + it.title + ' [' + it.status + ']');
        lines.push('   - 是什么问题：' + it.what);
        lines.push('   - 不改会怎样：' + it.impact);
        lines.push('   - 建议怎么改：' + it.suggestion);
      });
    }

    if (rep.buckets.safe_auto_fix.length) {
      lines.push('');
      lines.push('二、可安全自动修正（' + rep.buckets.safe_auto_fix.length + ' 项，印前可一键代修）：');
      rep.buckets.safe_auto_fix.forEach(function (it, idx) {
        lines.push((idx + 1) + '. ' + it.title + ' [' + it.status + ']');
        lines.push('   - 是什么问题：' + it.what);
        lines.push('   - 不改会怎样：' + it.impact);
        lines.push('   - 建议怎么改：' + it.suggestion);
      });
    }

    if (!rep.buckets.human_confirm_required.length && !rep.buckets.safe_auto_fix.length) {
      lines.push('');
      lines.push('全部关键印前项已达标，无待整改问题。');
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------
   * 序列化为机读 JSON 导出结构（snake_case，对齐 downloadJsonBtn 既有风格）
   * ------------------------------------------------------------------ */
  function toJsonExportPayload(explainedReport) {
    var rep = explainedReport || explainReport([]);
    return {
      schema_version: rep.schemaVersion,
      source: rep.source,
      provider: rep.provider,
      ...(rep.fallbackReason ? { fallback_reason: rep.fallbackReason } : {}),
      summary_text: rep.summaryText,
      counts: {
        total: rep.counts.total,
        pass: rep.counts.pass,
        warn: rep.counts.warn,
        fail: rep.counts.fail,
        skip: rep.counts.skip,
        safe_auto_fix: rep.counts.safeAutoFix,
        human_confirm_required: rep.counts.humanConfirmRequired
      },
      items: rep.items.map(function (it) {
        return {
          id: it.id,
          title: it.title,
          status: it.status,
          measured: it.measured,
          threshold: it.threshold,
          action_tier: it.actionTier,
          action_tier_label: it.actionTierLabel,
          auto_fixable: it.autoFixable,
          what: it.what,
          impact: it.impact,
          suggestion: it.suggestion,
          summary: it.summary,
          source: it.source
        };
      })
    };
  }

  /* ==================================================================
   * 预留 LLM 接口替换层（默认不启用，离线规则引擎 100% 独立可用）
   * ================================================================== */

  function registerLlmProvider(provider) {
    if (!provider || typeof provider.explainReport !== 'function') {
      throw new TypeError('LLM provider 必须提供 async explainReport({ auditContext, ruleReport, promptPayload }) 方法');
    }
    registeredLlmProvider = provider;
    return provider;
  }

  function getLlmProvider() {
    return registeredLlmProvider;
  }

  function clearLlmProvider() {
    registeredLlmProvider = null;
  }

  function buildLlmPromptPayload(auditContext, ruleReport) {
    var rep = ruleReport || explainReport(auditContext);
    return {
      system: [
        '你是包装印刷厂的资深印前工程师，负责把冷冰冰的预检结果翻译成设计师和客户一眼看懂的大白话。',
        '每条解释必须包含三个字段：what（这是什么问题）、impact（不改印出来会怎样）、suggestion（建议怎么改）。',
        '严格约束：不得修改任何条目的 status、actionTier（safe_auto_fix / human_confirm_required）与实测数值，仅输出合法 JSON：',
        '{"summaryText":"...","items":[{"id":"...","what":"...","impact":"...","suggestion":"..."}]}'
      ].join('\n'),
      user: JSON.stringify({
        summary: rep.summaryText,
        items: rep.items.map(function (it) {
          return {
            id: it.id,
            title: it.title,
            status: it.status,
            measured: it.measured,
            threshold: it.threshold,
            actionTier: it.actionTier,
            ruleBaseline: { what: it.what, impact: it.impact, suggestion: it.suggestion }
          };
        })
      }, null, 2)
    };
  }

  function mergeLlmOverlay(ruleReport, llmResult, providerName) {
    if (!llmResult || typeof llmResult !== 'object') {
      throw new Error('LLM 返回结果不是有效对象');
    }
    var byId = {};
    if (Array.isArray(llmResult.items)) {
      for (var i = 0; i < llmResult.items.length; i++) {
        var row = llmResult.items[i];
        if (row && typeof row.id === 'string') byId[row.id] = row;
      }
    }
    var mergedItems = ruleReport.items.map(function (base) {
      var patch = byId[base.id];
      if (!patch) return Object.assign({}, base);
      var what = (typeof patch.what === 'string' && patch.what.trim()) ? patch.what.trim() : base.what;
      var impact = (typeof patch.impact === 'string' && patch.impact.trim()) ? patch.impact.trim() : base.impact;
      var suggestion = (typeof patch.suggestion === 'string' && patch.suggestion.trim()) ? patch.suggestion.trim() : base.suggestion;
      // 强制保留规则引擎的权威门禁字段（status / actionTier / autoFixable / fixActionId）
      return Object.assign({}, base, {
        what: what,
        impact: impact,
        suggestion: suggestion,
        summary: (typeof patch.summary === 'string' && patch.summary.trim())
          ? patch.summary.trim()
          : buildSummarySentence(what, impact, suggestion),
        source: 'llm',
        provider: providerName
      });
    });

    var safeAutoFix = [];
    var humanConfirmRequired = [];
    var passedOrSkipped = [];
    for (var j = 0; j < mergedItems.length; j++) {
      var it = mergedItems[j];
      if (it.status === 'PASS' || it.status === 'SKIP') passedOrSkipped.push(it);
      else if (it.actionTier === ACTION_TIER.SAFE_AUTO_FIX) safeAutoFix.push(it);
      else humanConfirmRequired.push(it);
    }

    return Object.assign({}, ruleReport, {
      source: 'llm',
      provider: providerName,
      summaryText: (typeof llmResult.summaryText === 'string' && llmResult.summaryText.trim())
        ? llmResult.summaryText.trim()
        : ruleReport.summaryText,
      buckets: {
        safe_auto_fix: safeAutoFix,
        human_confirm_required: humanConfirmRequired,
        passed_or_skipped: passedOrSkipped
      },
      items: mergedItems
    });
  }

  function explainReportAsync(auditContextOrFindings, options) {
    var opts = options || {};
    var ruleReport = explainReport(auditContextOrFindings);
    var provider = opts.llmProvider || registeredLlmProvider;
    if (!provider || opts.useLlm === false) {
      return Promise.resolve(ruleReport);
    }

    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000;
    var promptPayload = buildLlmPromptPayload(auditContextOrFindings, ruleReport);
    var providerName = String(provider.name || 'custom-llm');

    var callPromise = Promise.resolve().then(function () {
      return provider.explainReport({
        auditContext: auditContextOrFindings,
        ruleReport: ruleReport,
        promptPayload: promptPayload
      });
    });

    var raced = timeoutMs > 0
      ? Promise.race([
          callPromise,
          new Promise(function (_, reject) {
            var timer = setTimeout(function () {
              reject(new Error('LLM 解释超时（>' + timeoutMs + 'ms）'));
            }, timeoutMs);
            if (timer && typeof timer.unref === 'function') timer.unref();
          })
        ])
      : callPromise;

    return raced
      .then(function (llmResult) {
        return mergeLlmOverlay(ruleReport, llmResult, providerName);
      })
      .catch(function (err) {
        return Object.assign({}, ruleReport, {
          source: 'rule_template_fallback',
          provider: BUILTIN_PROVIDER,
          fallbackReason: String((err && err.message) || err || 'LLM 调用失败')
        });
      });
  }

  /**
   * 预留的标准 OpenAI-Compatible 适配器工厂（兼容 OpenAI / DeepSeek / 通义 / 本地 Ollama）。
   * 仅在业务方显式配置并注册时生效，默认不发任何网络请求。
   */
  function createOpenAICompatibleProvider(config) {
    var cfg = config || {};
    if (!cfg.endpoint || !cfg.model) {
      throw new Error('createOpenAICompatibleProvider 需要提供 endpoint 与 model');
    }
    var fetchFn = cfg.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      throw new Error('当前运行环境缺少 fetch 实现，请通过 config.fetch 注入');
    }
    return {
      name: cfg.name || ('openai-compat:' + cfg.model),
      explainReport: function (ctx) {
        var headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
        if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
        return fetchFn(cfg.endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: cfg.model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: ctx.promptPayload.system },
              { role: 'user', content: ctx.promptPayload.user }
            ]
          })
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function (json) {
          var content = json && json.choices && json.choices[0] &&
            json.choices[0].message && json.choices[0].message.content;
          if (!content) throw new Error('LLM 响应缺少 choices[0].message.content');
          return JSON.parse(content);
        });
      }
    };
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    BUILTIN_PROVIDER: BUILTIN_PROVIDER,
    ACTION_TIER: ACTION_TIER,
    ACTION_TIER_LABEL: ACTION_TIER_LABEL,
    RULE_META: RULE_META,
    explainItem: explainItem,
    buildFindingsFromContext: buildFindingsFromContext,
    explainReport: explainReport,
    explainReportAsync: explainReportAsync,
    explainIngestDraft: explainIngestDraft,
    formatPlainTextReport: formatPlainTextReport,
    toJsonExportPayload: toJsonExportPayload,
    buildLlmPromptPayload: buildLlmPromptPayload,
    registerLlmProvider: registerLlmProvider,
    getLlmProvider: getLlmProvider,
    clearLlmProvider: clearLlmProvider,
    createOpenAICompatibleProvider: createOpenAICompatibleProvider
  };

  /* ==================================================================
   * 内置 Node 自动化自测（执行：node module_preflight_explainer.js）
   * ================================================================== */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    (async function runSelfTests() {
      var passed = 0;
      var failed = 0;
      function assert(name, cond, detail) {
        if (cond) {
          passed++;
          console.log('  ✓ ' + name);
        } else {
          failed++;
          console.error('  ✗ ' + name + (detail ? ' :: ' + detail : ''));
        }
      }

      console.log('============================================================');
      console.log(' PrintGuard Pro · Preflight Explainer 人话解释层自测');
      console.log('============================================================');

      // 1. 全缺陷上下文：检查四类核心告警（ΔE 超标、TAC 超限、静区不足、未转曲）+ RGB/直压/粘口
      var defectCtx = {
        preset: 'rtc',
        isRgbFixed: false,
        isOverprintBlack: false,
        isTacFixed: false,
        isOutlined: false,
        isGlueCleaned: false,
        tacAudit: { tacPeak: 3.52, tacLimit: 3.40 },
        deltaEAudit: { deltaE: 3.85 },
        quietZoneAudit: {
          compliant: false,
          left: { actualMm: 1.60, minRequiredMm: 2.54, shortfallMm: 0.94 }
        },
        bwrMm: 0.025,
        liveTextCount: 5,
        fonts: ['SourceHanSans-Bold', 'Helvetica']
      };
      var rep = explainReport(defectCtx);

      assert('1. 生成完整 8 项预检解释且默认离线规则来源',
        rep.items.length === 8 && rep.source === 'rule_template' && rep.provider === BUILTIN_PROVIDER,
        'len=' + rep.items.length + ', src=' + rep.source);

      assert('2. 每条解释均包含 what/impact/suggestion/summary 三段式人话',
        rep.items.every(function (it) {
          return it.what.length >= 8 && it.impact.length >= 8 && it.suggestion.length >= 8 &&
            it.summary.indexOf('【问题】') >= 0 && it.summary.indexOf('【不改后果】') >= 0 &&
            it.summary.indexOf('【建议】') >= 0;
        }));

      var byId = {};
      rep.items.forEach(function (it) { byId[it.id] = it; });

      assert('3. ΔE 超标划归「必须人工/客户确认」且包含实测值 3.85',
        byId.delta_e.status === 'FAIL' &&
        byId.delta_e.actionTier === ACTION_TIER.HUMAN_CONFIRM &&
        byId.delta_e.autoFixable === false &&
        byId.delta_e.what.indexOf('3.85') >= 0);

      assert('4. TAC 超限划归「可安全自动修正」且关联 fixTacBtn',
        byId.tac_limit.status === 'FAIL' &&
        byId.tac_limit.actionTier === ACTION_TIER.SAFE_AUTO_FIX &&
        byId.tac_limit.autoFixable === true &&
        byId.tac_limit.fixActionId === 'fixTacBtn' &&
        byId.tac_limit.what.indexOf('352%') >= 0);

      assert('5. 条码静区不足划归「必须人工/客户确认」且提示亏缺 0.94mm',
        byId.barcode_quiet_zone.status === 'WARN' &&
        byId.barcode_quiet_zone.actionTier === ACTION_TIER.HUMAN_CONFIRM &&
        byId.barcode_quiet_zone.autoFixable === false &&
        byId.barcode_quiet_zone.what.indexOf('0.94mm') >= 0);

      assert('6. 未转曲活字划归「必须人工/客户确认」且列出字体名',
        byId.fonts_outlined.status === 'FAIL' &&
        byId.fonts_outlined.actionTier === ACTION_TIER.HUMAN_CONFIRM &&
        byId.fonts_outlined.autoFixable === false &&
        byId.fonts_outlined.what.indexOf('SourceHanSans-Bold') >= 0);

      assert('7. 纯黑镂空与糊盒粘口划归「可安全自动修正」，RGB 划归「必须人工/客户确认」',
        byId.overprint_black.actionTier === ACTION_TIER.SAFE_AUTO_FIX &&
        byId.glue_tab.actionTier === ACTION_TIER.SAFE_AUTO_FIX &&
        byId.rgb_color_space.actionTier === ACTION_TIER.HUMAN_CONFIRM);

      assert('8. 双级分桶计数准确（安全自动 3 项，人工确认 4 项，通过 1 项）',
        rep.counts.safeAutoFix === 3 &&
        rep.counts.humanConfirmRequired === 4 &&
        rep.counts.pass === 1 &&
        rep.buckets.safe_auto_fix.length === 3 &&
        rep.buckets.human_confirm_required.length === 4,
        JSON.stringify(rep.counts));

      // 2. 全合规上下文：零待处理项
      var cleanCtx = {
        preset: 'fefco0427',
        isRgbFixed: true,
        isOverprintBlack: true,
        isTacFixed: true,
        isOutlined: true,
        isGlueCleaned: false, // 免胶自锁盒型无需脱墨也应 PASS
        tacAudit: { tacPeak: 2.00, tacLimit: 2.80 },
        deltaEAudit: { deltaE: 0.92 },
        quietZoneAudit: {
          compliant: true,
          left: { actualMm: 3.63, minRequiredMm: 2.54, shortfallMm: 0 }
        },
        bwrMm: 0.025
      };
      var cleanRep = explainReport(cleanCtx);
      assert('9. 全合规上下文（含 FEFCO 0427 免胶盒）全部 PASS 且零待整改项',
        cleanRep.counts.pass === 8 && cleanRep.counts.safeAutoFix === 0 && cleanRep.counts.humanConfirmRequired === 0);

      // 3. 机读 JSON 导出结构与纯文本客户清单
      var exported = toJsonExportPayload(rep);
      var plain = formatPlainTextReport(rep);
      assert('10. 机读 JSON 导出字段完整且纯文本含双分级标题',
        exported.schema_version === SCHEMA_VERSION &&
        exported.counts.safe_auto_fix === 3 &&
        exported.counts.human_confirm_required === 4 &&
        exported.items.length === 8 &&
        plain.indexOf('必须人工/客户确认') >= 0 &&
        plain.indexOf('可安全自动修正') >= 0);

      // 4. LLM 接口热替换：允许改写人话文案，但强制阻止 LLM 篡改门禁分级/状态
      registerLlmProvider({
        name: 'mock-llm-v1',
        explainReport: async function () {
          return {
            summaryText: '【AI 摘要】有 4 个高风险点需客户拍板，3 个工艺项可一键代修。',
            items: [
              {
                id: 'delta_e',
                status: 'PASS',               // 恶意/幻觉尝试篡改 status
                actionTier: 'safe_auto_fix',  // 恶意/幻觉尝试降级门禁
                what: 'AI 解释：当前主色色差达到 3.85，已超出印刷容差。',
                impact: 'AI 解释：印出来大概率发灰偏色被客户拒收。',
                suggestion: 'AI 解释：请先打专色或让客户签样确认。'
              }
            ]
          };
        }
      });
      var llmRep = await explainReportAsync(defectCtx);
      var llmDe = llmRep.items.find(function (x) { return x.id === 'delta_e'; });
      assert('11. LLM 适配器成功替换人话文案且严格防篡改门禁分级',
        llmRep.source === 'llm' &&
        llmRep.provider === 'mock-llm-v1' &&
        llmDe.what.indexOf('AI 解释') === 0 &&
        llmDe.status === 'FAIL' &&
        llmDe.actionTier === ACTION_TIER.HUMAN_CONFIRM &&
        llmDe.autoFixable === false);

      // 5. LLM 异常/失败自动优雅回退到规则模板，永不阻断预检
      registerLlmProvider({
        name: 'broken-llm',
        explainReport: async function () {
          throw new Error('API 503 unavailable');
        }
      });
      var fbRep = await explainReportAsync(defectCtx);
      clearLlmProvider();
      assert('12. LLM 异常时自动优雅回退规则模板并保留 fallbackReason',
        fbRep.source === 'rule_template_fallback' &&
        fbRep.fallbackReason.indexOf('503') >= 0 &&
        fbRep.items.length === 8);

      // 6. Illustrator 外部草稿解释
      var ingestRep = explainIngestDraft({
        doc: { colorSpace: 'RGB' },
        checks: { liveTextCount: 3, fonts: ['PingFangSC'], dielineLayers: { cut: [] } }
      });
      assert('13. Illustrator 外部导入草稿生成 RGB/未转曲/缺刀线三项人工确认解释',
        ingestRep.items.length === 3 && ingestRep.counts.humanConfirmRequired === 3);

      console.log('============================================================');
      console.log(' Preflight Explainer 自测: ' + passed + ' 通过, ' + failed + ' 失败');
      console.log('============================================================');
      process.exit(failed ? 1 : 0);
    })();
  }

  return api;
});
