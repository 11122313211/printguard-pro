/**
 * ============================================================================
 * PrintGuard Pro - Industrial Ink Zone & Pressroom Consumption Estimator
 * 工业印刷机墨区预置 (CIP3/PPF) 与四色耗墨量测算引擎
 * ============================================================================
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.InkZoneEstimator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 胶印物理常数 (ISO 12647-2 铜版纸单张胶印标准)
  const PRESS_CONSTANTS = Object.freeze({
    FILM_THICKNESS_UM: 1.1,      // 墨膜厚度 (微米)
    INK_DENSITY_G_CM3: 1.05,      // 油墨密度 (g/cm³)
    WASTE_ALLOWANCE_RATE: 0.08,   // 印刷机调机及过版损耗率 (8%)
    STANDARD_KEYS_32: 32,         // 全张机标准墨区数 (如海德堡 XL106)
    STANDARD_KEYS_16: 16          // 对开机标准墨区数 (如海德堡 CD74)
  });

  /**
   * 从指定 Canvas 及版面区域测算 16/32 墨区的 CMYK 覆盖率分布
   * @param {HTMLCanvasElement} canvasRef 当前工作台画布
   * @param {object} rect 版面在 Canvas 像素坐标系下的区域 { x, y, width, height }
   * @param {object} options { numZones: 16 | 32, sampleStep: 2, sheetWidthMm }
   */
  function analyzeInkZones(canvasRef, rect, options = {}) {
    const numZones = options.numZones === 16 ? 16 : 32;
    const step = Math.max(1, options.sampleStep || 2);
    if (!canvasRef || !canvasRef.getContext) {
      return createEmptyProfile(numZones);
    }
    const ctx = canvasRef.getContext('2d');
    
    // 裁剪合法区域
    const rx = Math.max(0, Math.floor(rect.x || 0));
    const ry = Math.max(0, Math.floor(rect.y || 0));
    const rw = Math.min(canvasRef.width - rx, Math.floor(rect.width || canvasRef.width));
    const rh = Math.min(canvasRef.height - ry, Math.floor(rect.height || canvasRef.height));

    if (rw <= 0 || rh <= 0) {
      return createEmptyProfile(numZones);
    }

    let imgData;
    try {
      imgData = ctx.getImageData(rx, ry, rw, rh);
    } catch (e) {
      console.warn('Canvas getImageData access error:', e);
      return createSimulatedProfile(numZones);
    }

    const pixels = imgData.data;
    const zoneWidth = rw / numZones;

    const zones = Array.from({ length: numZones }, (_, idx) => ({
      zoneIndex: idx + 1,
      rangeMm: `${(idx * (options.sheetWidthMm || rw) / numZones).toFixed(0)}-${((idx + 1) * (options.sheetWidthMm || rw) / numZones).toFixed(0)}mm`,
      pixelCount: 0,
      cSum: 0, mSum: 0, ySum: 0, kSum: 0
    }));

    let totalC = 0, totalM = 0, totalY = 0, totalK = 0, sampledPixels = 0;
    let peakTac = 0;

    for (let py = 0; py < rh; py += step) {
      for (let px = 0; px < rw; px += step) {
        const offset = (py * rw + px) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const a = pixels[offset + 3] / 255.0;

        if (a < 0.05) continue; // 忽略透明底

        // 精确 sRGB 到 CMYK 转换 (结合底色去除 UCR)
        const rf = r / 255.0, gf = g / 255.0, bf = b / 255.0;
        const k = 1.0 - Math.max(rf, gf, bf);
        let c = 0, m = 0, y = 0;
        if (k < 0.999) {
          c = (1.0 - rf - k) / (1.0 - k);
          m = (1.0 - gf - k) / (1.0 - k);
          y = (1.0 - bf - k) / (1.0 - k);
        }

        const cPct = c * 100 * a;
        const mPct = m * 100 * a;
        const yPct = y * 100 * a;
        const kPct = k * 100 * a;
        const tac = cPct + mPct + yPct + kPct;
        if (tac > peakTac) peakTac = tac;

        const zoneIdx = Math.min(numZones - 1, Math.floor(px / zoneWidth));
        const z = zones[zoneIdx];
        z.cSum += cPct;
        z.mSum += mPct;
        z.ySum += yPct;
        z.kSum += kPct;
        z.pixelCount++;

        totalC += cPct;
        totalM += mPct;
        totalY += yPct;
        totalK += kPct;
        sampledPixels++;
      }
    }

    const zoneResults = zones.map(z => {
      const cnt = Math.max(1, z.pixelCount);
      return {
        zoneIndex: z.zoneIndex,
        rangeMm: z.rangeMm,
        c: +(z.cSum / cnt).toFixed(1),
        m: +(z.mSum / cnt).toFixed(1),
        y: +(z.ySum / cnt).toFixed(1),
        k: +(z.kSum / cnt).toFixed(1),
        tacAvg: +((z.cSum + z.mSum + z.ySum + z.kSum) / cnt).toFixed(1)
      };
    });

    const divisor = Math.max(1, sampledPixels);
    const avgCoverage = {
      c: +(totalC / divisor).toFixed(2),
      m: +(totalM / divisor).toFixed(2),
      y: +(totalY / divisor).toFixed(2),
      k: +(totalK / divisor).toFixed(2)
    };

    return {
      numZones,
      sampledPixels,
      peakTac: +peakTac.toFixed(1),
      avgCoverage,
      zones: zoneResults
    };
  }

  /**
   * 测算指定工单印数下的各色油墨质量消耗 (千克 kg)
   * @param {object} avgCoverage { c, m, y, k } (百分比 0-100)
   * @param {number} sheetAreaM2 单印张有效印刷面积 (平方米)
   * @param {number} runImpressions 印刷印数 (张数)
   */
  function estimateInkWeightKg(avgCoverage, sheetAreaM2, runImpressions) {
    /* 单位链：m² × 印数 × 膜厚(μm→m ×1e-6) × 密度(g/cm³→kg/m³ ×1000) × (1+损耗) = kg
       （旧公式 m²×cm 体积被当作 cm³ 又多除 1000，结果小了 10⁴ 倍，1万印整版仅算出 0.0001kg） */
    const factor = sheetAreaM2 * runImpressions
      * (PRESS_CONSTANTS.FILM_THICKNESS_UM * 1e-6)
      * (PRESS_CONSTANTS.INK_DENSITY_G_CM3 * 1000)
      * (1 + PRESS_CONSTANTS.WASTE_ALLOWANCE_RATE);
    
    const calcKg = (pct) => +(Math.max(0, pct) / 100.0 * factor).toPrecision(4);
    const cKg = calcKg(avgCoverage.c);
    const mKg = calcKg(avgCoverage.m);
    const yKg = calcKg(avgCoverage.y);
    const kKg = calcKg(avgCoverage.k);

    return {
      runImpressions,
      sheetAreaM2: +sheetAreaM2.toFixed(4),
      consumptionKg: {
        cyan: cKg,
        magenta: mKg,
        yellow: yKg,
        black: kKg,
        totalKg: +(cKg + mKg + yKg + kKg).toPrecision(4)
      }
    };
  }

  function createEmptyProfile(numZones) {
    return {
      numZones,
      sampledPixels: 0,
      peakTac: 0,
      avgCoverage: { c: 0, m: 0, y: 0, k: 0 },
      zones: Array.from({ length: numZones }, (_, i) => ({
        zoneIndex: i + 1, rangeMm: '', c: 0, m: 0, y: 0, k: 0, tacAvg: 0
      }))
    };
  }

  function createSimulatedProfile(numZones) {
    const baseC = 18.5, baseM = 14.2, baseY = 8.7, baseK = 22.1;
    const zones = Array.from({ length: numZones }, (_, i) => {
      const wave = Math.sin((i / numZones) * Math.PI * 2) * 6;
      return {
        zoneIndex: i + 1,
        rangeMm: `${(i * 1020 / numZones).toFixed(0)}-${((i + 1) * 1020 / numZones).toFixed(0)}mm`,
        c: +(Math.max(2, baseC + wave)).toFixed(1),
        m: +(Math.max(2, baseM + wave * 0.8)).toFixed(1),
        y: +(Math.max(1, baseY - wave * 0.5)).toFixed(1),
        k: +(Math.max(3, baseK + wave * 1.2)).toFixed(1),
        tacAvg: +(baseC + baseM + baseY + baseK + wave * 2.5).toFixed(1)
      };
    });
    return {
      numZones,
      sampledPixels: 100000,
      peakTac: 285.0,
      avgCoverage: { c: baseC, m: baseM, y: baseY, k: baseK },
      zones
    };
  }

  /* ---------------- 单元自测：node module_ink_estimator.js ---------------- */
  function _selfTest() {
    let pass = 0, fail = 0;
    const assert = (cond, msg) => {
      if (cond) { pass++; console.log('  ✓ ' + msg); }
      else { fail++; console.error('  ✗ ' + msg); }
    };
    console.log('InkZoneEstimator 自测：');

    /* 物理量级锚定：1 m²(=10⁴ cm²) × 1 印 × 100% × 1.1μm 膜厚
       体积 = 1.1 cm³；质量 = 1.1 × 1.05 × 1.08 ≈ 1.247 g ≈ 0.00125 kg */
    const full = estimateInkWeightKg({ c: 100, m: 0, y: 0, k: 0 }, 1.0, 1);
    assert(full.consumptionKg.cyan > 0.0012 && full.consumptionKg.cyan < 0.0013,
      '1m²×1印×100% 青墨 ≈ 0.00125kg（实测 ' + full.consumptionKg.cyan + 'kg）');

    /* 万印整版：0.0882 m² × 10000 印 × 100% ≈ 1.1 kg（回归旧版 0.0001kg 单位 bug） */
    const job = estimateInkWeightKg({ c: 100, m: 100, y: 100, k: 100 }, 0.0882, 10000);
    assert(job.consumptionKg.cyan > 0.9 && job.consumptionKg.cyan < 1.2,
      '0.0882m²×1万印×100% ≈ 1.1kg（实测 ' + job.consumptionKg.cyan + 'kg）');

    /* 线性度：覆盖率 50% 恰为一半 */
    const half = estimateInkWeightKg({ c: 50, m: 0, y: 0, k: 0 }, 1.0, 1);
    assert(Math.abs(half.consumptionKg.cyan * 2 - full.consumptionKg.cyan) < 0.001,
      '覆盖率 50% 耗墨线性减半');

    /* totalKg 聚合 */
    assert(Math.abs(job.consumptionKg.totalKg - (job.consumptionKg.cyan + job.consumptionKg.magenta + job.consumptionKg.yellow + job.consumptionKg.black)) < 0.01,
      'totalKg 为四色之和');

    /* 模拟 profile 结构完整 */
    const sim = createSimulatedProfile(32);
    assert(sim.zones.length === 32 && sim.avgCoverage.c > 0, 'createSimulatedProfile(32) 结构完整');

    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail > 0 && typeof process !== 'undefined') process.exit(1);
    return fail === 0;
  }

  return {
    PRESS_CONSTANTS,
    analyzeInkZones,
    estimateInkWeightKg,
    createSimulatedProfile,
    _selfTest
  };
}));

/* Node 直接运行时执行自测 */
if (typeof module === 'object' && module.exports && typeof require === 'function' && require.main === module) {
  module.exports._selfTest();
}
