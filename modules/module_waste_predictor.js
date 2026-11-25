/* ====================================================================
 * PrintGuard Pro · Waste Predictor — CIP3 墨区延伸损耗预测与 EMA 偏差学习
 * --------------------------------------------------------------------
 * 职责（P1-#5：PrintGuard 墨区估算的延伸）：
 *   1. 基于 CIP3/PPF 墨区覆盖（平均总墨量、TAC 峰值、墨区不均匀度）+
 *      工单复杂度（印数、色数、承印材质、印后工艺），输出「预估损耗率区间」
 *      （low / mid / high %）与损耗印张数拆解；
 *   2. 历史工单回填实际损耗后，计算并展示「预估 vs 实际」偏差（单笔偏差、
 *      MAE、区间命中率），并按与 color-workshop 同构的 EMA 机制
 *      （α = 0.35，截幅 ±6.0%，满 2 单启用）自动校准后续工单预估偏置。
 *
 * 边界声明：
 *   本模型为印前工程估算区间（建议非承诺），用于排产备料与工艺风险评估；
 *   实际工厂落地需结合机台实测历史工单持续回填校准。
 *
 * 零外部依赖，浏览器与 Node 双端可运行。
 * 自测：node module_waste_predictor.js
 * ==================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintGuardWastePredictor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 与 color-workshop/app/services/compensation.py 同构的 EMA 超参 */
  var EMA_ALPHA = 0.35;
  var EMA_MIN_N = 2;
  var EMA_BIAS_CAP_PCT = 6.0;
  var MAX_HISTORY = 50;
  var STORAGE_KEY = 'printguard.wasteHistory.v1';

  /* 印后工艺复杂度增量表（调机过版张数 + 运行损耗率 %） */
  var POSTPRESS_CATALOG = Object.freeze({
    die_cut: { label: '模切压痕', makereadySheets: 35, runningPct: 0.8 },
    gluing: { label: '自动糊盒', makereadySheets: 30, runningPct: 0.7 },
    lamination: { label: '覆膜（光/哑膜）', makereadySheets: 40, runningPct: 0.9 },
    spot_uv: { label: '局部 UV 上光', makereadySheets: 45, runningPct: 1.0 },
    foil_stamping: { label: '烫金 / 烫银', makereadySheets: 50, runningPct: 1.2 },
    emboss: { label: '击凸 / 压凹', makereadySheets: 35, runningPct: 0.8 }
  });

  /* 承印材质损耗系数 */
  var SUBSTRATE_FACTORS = Object.freeze({
    fbb: { label: '白卡纸 (FBB)', factor: 1.0 },
    matte: { label: '哑粉/铜版纸', factor: 1.05 },
    kraft: { label: '牛皮/瓦楞纸', factor: 1.15 },
    metallic: { label: '镭射银卡/金箔', factor: 1.30 }
  });

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round2(v) {
    return Math.round(Number(v || 0) * 100) / 100;
  }

  /* ------------------------------------------------------------------
   * 从 InkZoneEstimator 输出的 profile 提取墨区特征
   * ------------------------------------------------------------------ */
  function extractInkMetrics(inkProfile) {
    var p = inkProfile || {};
    var avg = p.avgCoverage || { c: 15, m: 12, y: 10, k: 18 };
    var totalAvg = (Number(avg.c) || 0) + (Number(avg.m) || 0) + (Number(avg.y) || 0) + (Number(avg.k) || 0);
    var peakTac = typeof p.peakTac === 'number' && isFinite(p.peakTac) ? p.peakTac : totalAvg * 2.2;

    var zones = Array.isArray(p.zones) ? p.zones : [];
    var zoneTacs = zones
      .map(function (z) {
        if (typeof z.tacAvg === 'number' && isFinite(z.tacAvg)) return z.tacAvg;
        return (Number(z.c) || 0) + (Number(z.m) || 0) + (Number(z.y) || 0) + (Number(z.k) || 0);
      })
      .filter(function (v) { return isFinite(v); });

    var std = 0;
    if (zoneTacs.length >= 2) {
      var mean = zoneTacs.reduce(function (a, b) { return a + b; }, 0) / zoneTacs.length;
      var variance = zoneTacs.reduce(function (acc, v) {
        var d = v - mean;
        return acc + d * d;
      }, 0) / zoneTacs.length;
      std = Math.sqrt(variance);
    }

    var imbalanceLevel = std >= 25 ? 'high' : (std >= 12 ? 'normal' : 'low');
    return {
      avgTotalCoveragePct: round2(totalAvg),
      peakTacPct: round2(peakTac),
      zoneTacStdPct: round2(std),
      imbalanceLevel: imbalanceLevel,
      numZones: zones.length || Number(p.numZones || 0)
    };
  }

  /* ------------------------------------------------------------------
   * 核心损耗率区间预估（CIP3 墨区 + 工单复杂度 + 可选 EMA 偏置）
   * ------------------------------------------------------------------ */
  function predictWaste(input, emaState) {
    var cfg = input || {};
    var runImpressions = Math.max(100, Math.round(Number(cfg.runImpressions) || 10000));
    var colorCount = clamp(Math.round(Number(cfg.colorCount) || 4), 1, 10);
    var substrateKey = SUBSTRATE_FACTORS[cfg.substrate] ? cfg.substrate : 'fbb';
    var subInfo = SUBSTRATE_FACTORS[substrateKey];
    var postpressList = Array.isArray(cfg.postpress) ? cfg.postpress : ['die_cut', 'gluing'];

    var inkMetrics = extractInkMetrics(cfg.inkProfile);

    // 1. 印刷主工序调机过版纸 + 运行基线（4 色胶印基准 120 张调机，每增 1 色 +45 张）
    var extraColors = Math.max(0, colorCount - 4);
    var printMakeready = 120 + extraColors * 45;
    var printRunningPct = 1.6 + extraColors * 0.35;

    // 2. CIP3 墨区复杂度增量（覆盖率过重 / TAC 峰值超 280% / 墨区分布极度不均）
    var heavyCoverageExcess = Math.max(0, inkMetrics.avgTotalCoveragePct - 120) / 100.0;
    var highTacExcess = Math.max(0, inkMetrics.peakTacPct - 280) / 100.0;
    var imbalanceExcess = Math.max(0, inkMetrics.zoneTacStdPct - 10) / 20.0;

    var inkMakeready = Math.round(heavyCoverageExcess * 45 + highTacExcess * 55 + imbalanceExcess * 30);
    var inkRunningPct = heavyCoverageExcess * 0.65 + highTacExcess * 1.15 + imbalanceExcess * 0.45;

    // 3. 印后工艺复杂度累加（去重）
    var seenPp = {};
    var postpressMakeready = 0;
    var postpressRunningPct = 0;
    var appliedPostpress = [];
    for (var i = 0; i < postpressList.length; i++) {
      var key = String(postpressList[i] || '');
      if (seenPp[key] || !POSTPRESS_CATALOG[key]) continue;
      seenPp[key] = true;
      var spec = POSTPRESS_CATALOG[key];
      postpressMakeready += spec.makereadySheets;
      postpressRunningPct += spec.runningPct;
      appliedPostpress.push({ id: key, label: spec.label });
    }

    // 4. 合并调机与运行损耗率，并乘以承印材质系数
    var totalMakereadySheets = Math.round((printMakeready + inkMakeready + postpressMakeready) * subInfo.factor);
    var makereadyRatePct = (totalMakereadySheets / runImpressions) * 100.0;
    var runningTotalPct = (printRunningPct + inkRunningPct + postpressRunningPct) * subInfo.factor;
    var baselineMid = clamp(makereadyRatePct + runningTotalPct, 1.0, 45.0);

    // 5. 不确定度半宽（印后工序越多/墨区越不均/无历史样本 → 区间越宽；EMA 样本充足则适度收敛）
    var ema = emaState || createEmptyHistory();
    var emaN = Number(ema.n || 0);
    var emaApplied = emaN >= EMA_MIN_N;
    var emaBiasPct = emaApplied ? clamp(Number(ema.emaBiasPct || 0), -EMA_BIAS_CAP_PCT, EMA_BIAS_CAP_PCT) : 0.0;

    var baseUncertaintyRatio = 0.16 + appliedPostpress.length * 0.015 + (inkMetrics.imbalanceLevel === 'high' ? 0.04 : 0);
    var calibratedFactor = emaApplied ? Math.max(0.70, 1.0 - Math.min(emaN, 10) * 0.03) : 1.0;
    var halfWidth = Math.max(0.6, baselineMid * baseUncertaintyRatio * calibratedFactor);

    var baseLow = clamp(baselineMid - halfWidth, 0.8, 45.0);
    var baseHigh = clamp(baselineMid + halfWidth, baseLow + 0.5, 50.0);

    var finalMid = clamp(baselineMid + emaBiasPct, 1.0, 45.0);
    var finalLow = clamp(finalMid - halfWidth, 0.8, finalMid);
    var finalHigh = clamp(finalMid + halfWidth, finalMid, 50.0);

    return {
      runImpressions: runImpressions,
      colorCount: colorCount,
      substrate: substrateKey,
      substrateLabel: subInfo.label,
      postpress: appliedPostpress,
      inkMetrics: inkMetrics,
      baselineRatePct: {
        low: round2(baseLow),
        mid: round2(baselineMid),
        high: round2(baseHigh)
      },
      predictedRatePct: {
        low: round2(finalLow),
        mid: round2(finalMid),
        high: round2(finalHigh)
      },
      predictedWasteSheets: {
        low: Math.round(runImpressions * finalLow / 100.0),
        mid: Math.round(runImpressions * finalMid / 100.0),
        high: Math.round(runImpressions * finalHigh / 100.0)
      },
      breakdown: {
        makereadySheets: totalMakereadySheets,
        makereadyRatePct: round2(makereadyRatePct),
        runningBaseRatePct: round2(printRunningPct * subInfo.factor),
        inkComplexityRatePct: round2(inkRunningPct * subInfo.factor),
        postpressRatePct: round2(postpressRunningPct * subInfo.factor),
        substrateFactor: subInfo.factor,
        emaBiasPct: round2(emaBiasPct),
        emaApplied: emaApplied,
        emaSamples: emaN
      },
      disclaimer: '工程估算区间（建议非承诺，基于 CIP3 墨区分布 + 工单复杂度）；回填实际损耗满 ' + EMA_MIN_N + ' 单后自动启用 EMA（α=' + EMA_ALPHA + '）偏置校准。'
    };
  }

  /* ------------------------------------------------------------------
   * 历史工单回填实际损耗 + 同构 EMA 学习状态机（纯函数）
   * ------------------------------------------------------------------ */
  function createEmptyHistory() {
    return {
      version: 1,
      alpha: EMA_ALPHA,
      minN: EMA_MIN_N,
      biasCapPct: EMA_BIAS_CAP_PCT,
      n: 0,
      emaBiasPct: 0.0,
      updatedAt: null,
      records: []
    };
  }

  function recordActualWaste(historyState, entry) {
    var prev = (historyState && typeof historyState === 'object') ? historyState : createEmptyHistory();
    var e = entry || {};
    var actual = Number(e.actualRatePct);
    var predMid = Number(e.predictedMidPct);
    var predLow = typeof e.predictedLowPct === 'number' ? Number(e.predictedLowPct) : predMid;
    var predHigh = typeof e.predictedHighPct === 'number' ? Number(e.predictedHighPct) : predMid;
    if (!isFinite(actual) || actual < 0 || actual > 80) {
      throw new RangeError('实际损耗率 actualRatePct 必须为 0 ~ 80 之间的有限数值');
    }
    if (!isFinite(predMid) || predMid < 0) {
      throw new RangeError('预估中值 predictedMidPct 必须为非负有限数值');
    }

    // 偏差定义：实际 - 预估（正值表示原模型低估了损耗，需要正向补偏）
    var deviationPct = round2(actual - predMid);
    var absErrorPct = round2(Math.abs(deviationPct));
    var withinRange = actual >= predLow - 1e-6 && actual <= predHigh + 1e-6;

    // 基准残差（用于 EMA 学习的为相对 baseline 的偏差，若未传 baselineMidPct 则退回 predictedMidPct）
    var baselineMid = (typeof e.baselineMidPct === 'number' && isFinite(e.baselineMidPct))
      ? Number(e.baselineMidPct)
      : predMid;
    var learnDelta = clamp(actual - baselineMid, -EMA_BIAS_CAP_PCT, EMA_BIAS_CAP_PCT);
    var oldBias = Number(prev.emaBiasPct || 0);
    var nextBias = clamp((1.0 - EMA_ALPHA) * oldBias + EMA_ALPHA * learnDelta, -EMA_BIAS_CAP_PCT, EMA_BIAS_CAP_PCT);
    var nextN = Number(prev.n || 0) + 1;
    var nowIso = e.recordedAt || new Date().toISOString();

    var rec = {
      id: e.id || ('w_' + Date.now() + '_' + nextN),
      jobNo: String(e.jobNo || ('JOB-' + String(nextN).padStart(3, '0'))).trim(),
      jobName: String(e.jobName || '').trim(),
      runImpressions: Math.round(Number(e.runImpressions) || 0),
      colorCount: Math.round(Number(e.colorCount) || 4),
      substrate: String(e.substrate || 'fbb'),
      postpress: Array.isArray(e.postpress) ? e.postpress.slice() : [],
      baselineMidPct: round2(baselineMid),
      predictedLowPct: round2(predLow),
      predictedMidPct: round2(predMid),
      predictedHighPct: round2(predHigh),
      actualRatePct: round2(actual),
      deviationPct: deviationPct,
      absErrorPct: absErrorPct,
      withinRange: withinRange,
      emaBiasAfterPct: round2(nextBias),
      note: String(e.note || '').trim(),
      recordedAt: nowIso
    };

    var records = (Array.isArray(prev.records) ? prev.records.slice() : []).concat([rec]);
    if (records.length > MAX_HISTORY) {
      records = records.slice(records.length - MAX_HISTORY);
    }

    return {
      version: 1,
      alpha: EMA_ALPHA,
      minN: EMA_MIN_N,
      biasCapPct: EMA_BIAS_CAP_PCT,
      n: nextN,
      emaBiasPct: round2(nextBias),
      updatedAt: nowIso,
      records: records
    };
  }

  function summarizeDeviation(historyState) {
    var st = historyState || createEmptyHistory();
    var recs = Array.isArray(st.records) ? st.records : [];
    var count = recs.length;
    var emaN = Number(st.n || count);
    var emaBiasPct = round2(Number(st.emaBiasPct || 0));
    var emaApplied = emaN >= EMA_MIN_N;

    if (!count) {
      return {
        count: 0,
        emaSamples: emaN,
        emaApplied: false,
        emaBiasPct: 0.0,
        maePct: null,
        meanBiasPct: null,
        rangeHitRatePct: null,
        trend: 'insufficient_data',
        trendLabel: '暂无回填工单'
      };
    }

    var sumAbs = 0;
    var sumSigned = 0;
    var hits = 0;
    for (var i = 0; i < count; i++) {
      sumAbs += Number(recs[i].absErrorPct || 0);
      sumSigned += Number(recs[i].deviationPct || 0);
      if (recs[i].withinRange) hits++;
    }
    var mae = round2(sumAbs / count);
    var meanBias = round2(sumSigned / count);
    var hitRate = round2((hits / count) * 100.0);

    // 简单收敛趋势判断：近 3 笔 MAE 与前序相比是否收敛
    var trend = 'insufficient_data';
    var trendLabel = '样本积累中（需 ≥4 单评估趋势）';
    if (count >= 4) {
      var split = Math.floor(count / 2);
      var earlyMae = recs.slice(0, split).reduce(function (a, r) { return a + Number(r.absErrorPct || 0); }, 0) / split;
      var lateMae = recs.slice(split).reduce(function (a, r) { return a + Number(r.absErrorPct || 0); }, 0) / (count - split);
      if (lateMae < earlyMae - 0.25) {
        trend = 'improving';
        trendLabel = '偏差收敛（EMA 校准见效）';
      } else if (lateMae > earlyMae + 0.5) {
        trend = 'drifting';
        trendLabel = '偏差放大（建议复核机台/纸张参数）';
      } else {
        trend = 'stable';
        trendLabel = '偏差稳定';
      }
    }

    return {
      count: count,
      emaSamples: emaN,
      emaApplied: emaApplied,
      emaBiasPct: emaBiasPct,
      maePct: mae,
      meanBiasPct: meanBias,
      rangeHitRatePct: hitRate,
      trend: trend,
      trendLabel: trendLabel
    };
  }

  /* ------------------------------------------------------------------
   * 浏览器持久化辅助（Node 环境下安全降级为空状态）
   * ------------------------------------------------------------------ */
  function loadHistory() {
    try {
      if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
            return parsed;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return createEmptyHistory();
  }

  function saveHistory(state) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (e) { /* ignore */ }
    return state;
  }

  function clearHistory() {
    var empty = createEmptyHistory();
    saveHistory(empty);
    return empty;
  }

  var api = {
    EMA_ALPHA: EMA_ALPHA,
    EMA_MIN_N: EMA_MIN_N,
    EMA_BIAS_CAP_PCT: EMA_BIAS_CAP_PCT,
    POSTPRESS_CATALOG: POSTPRESS_CATALOG,
    SUBSTRATE_FACTORS: SUBSTRATE_FACTORS,
    extractInkMetrics: extractInkMetrics,
    predictWaste: predictWaste,
    createEmptyHistory: createEmptyHistory,
    recordActualWaste: recordActualWaste,
    summarizeDeviation: summarizeDeviation,
    loadHistory: loadHistory,
    saveHistory: saveHistory,
    clearHistory: clearHistory
  };

  /* ==================================================================
   * 内置 Node 自动化自测（执行：node module_waste_predictor.js）
   * ================================================================== */
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    (function runSelfTests() {
      var passed = 0;
      var failed = 0;
      function assert(name, cond, detail) {
        if (cond) { passed++; console.log('  ✓ ' + name); }
        else { failed++; console.error('  ✗ ' + name + (detail ? ' :: ' + detail : '')); }
      }

      console.log('============================================================');
      console.log(' PrintGuard Pro · Waste Predictor 损耗预测与 EMA 学习自测');
      console.log('============================================================');

      var lightProfile = {
        numZones: 32,
        peakTac: 180,
        avgCoverage: { c: 12, m: 10, y: 8, k: 15 },
        zones: Array.from({ length: 32 }, function (_, i) { return { zoneIndex: i + 1, tacAvg: 45 + (i % 3) }; })
      };
      var heavyProfile = {
        numZones: 32,
        peakTac: 345,
        avgCoverage: { c: 60, m: 55, y: 50, k: 45 },
        zones: Array.from({ length: 32 }, function (_, i) { return { zoneIndex: i + 1, tacAvg: i < 16 ? 260 : 40 }; })
      };

      var pLight = predictWaste({
        inkProfile: lightProfile,
        runImpressions: 10000,
        colorCount: 4,
        substrate: 'fbb',
        postpress: ['die_cut']
      });
      var pHeavy = predictWaste({
        inkProfile: heavyProfile,
        runImpressions: 10000,
        colorCount: 6,
        substrate: 'metallic',
        postpress: ['die_cut', 'gluing', 'foil_stamping', 'spot_uv']
      });

      assert('1. 预估区间满足 low < mid < high 且张数与百分比一致',
        pLight.predictedRatePct.low < pLight.predictedRatePct.mid &&
        pLight.predictedRatePct.mid < pLight.predictedRatePct.high &&
        pLight.predictedWasteSheets.mid === Math.round(10000 * pLight.predictedRatePct.mid / 100));

      assert('2. 高墨量不均 + 6色 + 银卡 + 复杂印后损耗显著高于普通4色白卡单',
        pHeavy.predictedRatePct.mid > pLight.predictedRatePct.mid + 5.0 &&
        pHeavy.inkMetrics.imbalanceLevel === 'high',
        'light=' + pLight.predictedRatePct.mid + '% heavy=' + pHeavy.predictedRatePct.mid + '%');

      var pShort = predictWaste({
        inkProfile: lightProfile,
        runImpressions: 1000,
        colorCount: 4,
        substrate: 'fbb',
        postpress: ['die_cut']
      });
      assert('3. 短版（1000印）因调机过版纸摊薄效应，损耗率高于长版（10000印）',
        pShort.predictedRatePct.mid > pLight.predictedRatePct.mid + 5.0,
        'short=' + pShort.predictedRatePct.mid + '% long=' + pLight.predictedRatePct.mid + '%');

      // 4. EMA 回填机制（α=0.35, minN=2, cap=±6%）
      var hist = createEmptyHistory();
      // 第 1 单：未满 MIN_N=2，不启用偏置
      hist = recordActualWaste(hist, {
        jobNo: 'J-001',
        baselineMidPct: pLight.baselineRatePct.mid,
        predictedLowPct: pLight.predictedRatePct.low,
        predictedMidPct: pLight.predictedRatePct.mid,
        predictedHighPct: pLight.predictedRatePct.high,
        actualRatePct: pLight.baselineRatePct.mid + 2.0,
        runImpressions: 10000
      });
      var predAfter1 = predictWaste({
        inkProfile: lightProfile,
        runImpressions: 10000,
        colorCount: 4,
        substrate: 'fbb',
        postpress: ['die_cut']
      }, hist);
      assert('4. 仅回填 1 单时满足 MIN_N=2 门禁：不应用 EMA 偏置但保留偏差记录',
        hist.n === 1 && predAfter1.breakdown.emaApplied === false &&
        predAfter1.breakdown.emaBiasPct === 0 &&
        hist.records[0].deviationPct === 2.0);

      // 第 2 单：达到 MIN_N=2，启用 EMA 偏置，且新预估自动上调
      hist = recordActualWaste(hist, {
        jobNo: 'J-002',
        baselineMidPct: pLight.baselineRatePct.mid,
        predictedLowPct: predAfter1.predictedRatePct.low,
        predictedMidPct: predAfter1.predictedRatePct.mid,
        predictedHighPct: predAfter1.predictedRatePct.high,
        actualRatePct: pLight.baselineRatePct.mid + 2.0,
        runImpressions: 10000
      });
      var predAfter2 = predictWaste({
        inkProfile: lightProfile,
        runImpressions: 10000,
        colorCount: 4,
        substrate: 'fbb',
        postpress: ['die_cut']
      }, hist);
      // 期望偏置：r1 = 0.35*2 = 0.70；r2 = 0.65*0.70 + 0.35*2 = 1.155 → round2 = 1.16
      assert('5. 回填满 2 单后启用 EMA（α=0.35）偏置校准且数值精确',
        predAfter2.breakdown.emaApplied === true &&
        Math.abs(predAfter2.breakdown.emaBiasPct - 1.16) < 0.02 &&
        predAfter2.predictedRatePct.mid > pLight.baselineRatePct.mid + 1.0,
        'emaBias=' + predAfter2.breakdown.emaBiasPct);

      // 6. 极端异常单截幅保护（±6.0%）
      var capHist = createEmptyHistory();
      for (var k = 0; k < 12; k++) {
        capHist = recordActualWaste(capHist, {
          jobNo: 'EXT-' + k,
          baselineMidPct: 5.0,
          predictedLowPct: 4.0,
          predictedMidPct: 5.0,
          predictedHighPct: 6.0,
          actualRatePct: 35.0
        });
      }
      assert('6. 连续极端异常工单受 ±6.0% 截幅保护不发散',
        capHist.emaBiasPct <= EMA_BIAS_CAP_PCT && capHist.emaBiasPct >= 5.5,
        'emaBias=' + capHist.emaBiasPct);

      // 7. 偏差统计摘要与收敛趋势判定
      var trendHist = createEmptyHistory();
      var devSeq = [3.0, 2.5, 0.8, 0.4];
      for (var m = 0; m < devSeq.length; m++) {
        trendHist = recordActualWaste(trendHist, {
          jobNo: 'TR-' + m,
          baselineMidPct: 6.0,
          predictedLowPct: 5.0,
          predictedMidPct: 6.0,
          predictedHighPct: 7.0,
          actualRatePct: 6.0 + devSeq[m]
        });
      }
      var sum = summarizeDeviation(trendHist);
      assert('7. 历史偏差统计（MAE / 均值 / 区间命中率 / 收敛趋势）计算正确',
        sum.count === 4 && sum.maePct === 1.68 && sum.rangeHitRatePct === 50 && sum.trend === 'improving',
        JSON.stringify(sum));

      // 8. 非法输入校验
      var threw = false;
      try { recordActualWaste(hist, { actualRatePct: -5, predictedMidPct: 6 }); }
      catch (err) { threw = err instanceof RangeError; }
      assert('8. 负数/非法实际损耗率抛出 RangeError 防脏数据污染', threw);

      console.log('============================================================');
      console.log(' Waste Predictor 自测: ' + passed + ' 通过, ' + failed + ' 失败');
      console.log('============================================================');
      process.exit(failed ? 1 : 0);
    })();
  }

  return api;
});
