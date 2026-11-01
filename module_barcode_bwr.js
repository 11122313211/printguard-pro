/**
 * ============================================================================
 * PrintGuard Pro - Industrial Barcode & BWR (Bar Width Reduction) Engine
 * 包装印刷工业条码生成与印前条宽补偿算法核心模块
 * 
 * Features:
 *  1. Zero External Dependencies / Zero Build Step (Pure Vanilla JS / UMD)
 *  2. EAN-13 (Commodity Retail Barcode) with Modulo 10 Weighting 3/1 Checksum & L/G/R Tables
 *  3. Code 128 / GS1-128 (Logistics & Traceability) Code Set B with Modulo 103 Checksum & FNC1
 *  4. High-Precision Prepress BWR (Bar Width Reduction) Algorithm with Exact Pitch Invariance
 *  5. GS1 Quiet Zone Compliance Preflight Audit (ISO/IEC 15420 & GS1 General Specs)
 *  6. Dual-Mode Rendering: Canvas 2D & Standalone Scalable Vector SVG
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BarcodeBwrEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. EAN-13 SPECIFICATION CONSTANTS & TABLES
  // --------------------------------------------------------------------------

  /**
   * EAN-13 First Digit Parity Selection Table for Left 6 Digits (Digits 2 to 7).
   * L = Odd Parity, G = Even Parity (Reverse R).
   */
  const EAN13_PARITY_TABLE = [
    ['L', 'L', 'L', 'L', 'L', 'L'], // 0
    ['L', 'L', 'G', 'L', 'G', 'G'], // 1
    ['L', 'L', 'G', 'G', 'L', 'G'], // 2
    ['L', 'L', 'G', 'G', 'G', 'L'], // 3
    ['L', 'G', 'L', 'L', 'G', 'G'], // 4
    ['L', 'G', 'G', 'L', 'L', 'G'], // 5
    ['L', 'G', 'G', 'G', 'L', 'L'], // 6
    ['L', 'G', 'L', 'G', 'L', 'G'], // 7
    ['L', 'G', 'L', 'G', 'G', 'L'], // 8
    ['L', 'G', 'G', 'L', 'G', 'L']  // 9
  ];

  /**
   * EAN-13 Left-hand Odd Parity (L-Code): 7 modules per digit.
   * Format: alternating spaces and bars ('0' = space, '1' = bar).
   */
  const EAN13_L_PATTERNS = [
    '0001101', // 0
    '0011001', // 1
    '0010011', // 2
    '0111101', // 3
    '0100011', // 4
    '0110001', // 5
    '0101111', // 6
    '0111011', // 7
    '0110111', // 8
    '0001011'  // 9
  ];

  /**
   * Derive R-Code (Right-hand Even Parity): Bitwise NOT of L-Code.
   * Derive G-Code (Left-hand Even Parity): Reverse of R-Code.
   */
  const EAN13_R_PATTERNS = EAN13_L_PATTERNS.map(pattern =>
    pattern.split('').map(b => (b === '1' ? '0' : '1')).join('')
  );

  const EAN13_G_PATTERNS = EAN13_R_PATTERNS.map(pattern =>
    pattern.split('').reverse().join('')
  );

  const EAN13_GUARD_START  = '101';    // 3 modules: Bar, Space, Bar
  const EAN13_GUARD_CENTER = '01010';  // 5 modules: Space, Bar, Space, Bar, Space
  const EAN13_GUARD_STOP   = '101';    // 3 modules: Bar, Space, Bar

  // --------------------------------------------------------------------------
  // 2. CODE 128 / GS1-128 SPECIFICATION CONSTANTS & TABLES
  // --------------------------------------------------------------------------

  /**
   * Code 128 Bar/Space width sequences (values 0 to 106).
   * Values 0..105 have 6 elements totaling 11 modules.
   * Value 106 (STOP) has 7 elements totaling 13 modules.
   */
  const CODE128_WIDTHS = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", // 40-49
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", // 50-59
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", // 60-69
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", // 70-79
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", // 80-89
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", // 90-99
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112"                                // 100-106
  ];

  const CODE128_FNC1    = 102;
  const CODE128_START_A = 103;
  const CODE128_START_B = 104;
  const CODE128_START_C = 105;
  const CODE128_STOP    = 106;

  /**
   * Convert Code 128 width sequence to binary string ('1' for bar, '0' for space).
   * @param {string} widthStr 
   * @returns {string}
   */
  function widthsToBinary(widthStr) {
    let bin = '';
    for (let i = 0; i < widthStr.length; i++) {
      const len = parseInt(widthStr[i], 10);
      bin += (i % 2 === 0 ? '1' : '0').repeat(len);
    }
    return bin;
  }

  // --------------------------------------------------------------------------
  // 3. EAN-13 CHECKSUM & ENCODING ALGORITHMS
  // --------------------------------------------------------------------------

  /**
   * Calculate Modulo 10 Check Digit (Weighting 3/1) for EAN-13.
   * Standard algorithm:
   *  Odd positions (0, 2, 4, 6, 8, 10 - 0-indexed) weight 1.
   *  Even positions (1, 3, 5, 7, 9, 11 - 0-indexed) weight 3.
   * @param {string|number} input 12-digit numeric string
   * @returns {number} Check digit (0-9)
   */
  function calculateEan13Checksum(input) {
    const str = String(input).trim();
    if (!/^\d{12}$/.test(str)) {
      throw new Error(`[EAN-13 Checksum Error] 必须提供 12 位纯数字进行校验码计算，接收到: "${input}"`);
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(str[i], 10);
      sum += (i % 2 === 0) ? digit * 1 : digit * 3;
    }
    const remainder = sum % 10;
    return (remainder === 0) ? 0 : 10 - remainder;
  }

  /**
   * Verify if a 13-digit EAN-13 barcode has a valid checksum.
   * @param {string|number} input 
   * @returns {boolean}
   */
  function validateEan13(input) {
    const str = String(input).trim();
    if (!/^\d{13}$/.test(str)) return false;
    const computedCheck = calculateEan13Checksum(str.slice(0, 12));
    return parseInt(str[12], 10) === computedCheck;
  }

  /**
   * Encode EAN-13 data into module runs.
   * @param {string|number} rawInput 12 or 13 digits
   * @param {object} [options]
   * @returns {object} Encoded EAN-13 structure
   */
  function encodeEan13(rawInput, options = {}) {
    let str = String(rawInput).trim();
    if (/^\d{12}$/.test(str)) {
      const check = calculateEan13Checksum(str);
      str = str + check;
    } else if (/^\d{13}$/.test(str)) {
      const expectedCheck = calculateEan13Checksum(str.slice(0, 12));
      const actualCheck = parseInt(str[12], 10);
      if (expectedCheck !== actualCheck) {
        if (options.autoFixChecksum !== false) {
          str = str.slice(0, 12) + expectedCheck;
        } else {
          throw new Error(`[EAN-13 Checksum Mismatch] 提供的校验码为 ${actualCheck}，但标准算法计算结果为 ${expectedCheck}`);
        }
      }
    } else {
      throw new Error(`[EAN-13 Error] 输入数据必须为 12 或 13 位纯数字，接收到: "${rawInput}"`);
    }

    const firstDigit = parseInt(str[0], 10);
    const leftDigits = str.slice(1, 7);
    const rightDigits = str.slice(7, 13);
    const parityRule = EAN13_PARITY_TABLE[firstDigit];

    let binaryData = '';

    // 1. Start Guard (3 modules)
    binaryData += EAN13_GUARD_START;

    // 2. Left 6 Digits (6 x 7 = 42 modules)
    for (let i = 0; i < 6; i++) {
      const digit = parseInt(leftDigits[i], 10);
      const encType = parityRule[i];
      const pattern = (encType === 'L') ? EAN13_L_PATTERNS[digit] : EAN13_G_PATTERNS[digit];
      binaryData += pattern;
    }

    // 3. Center Guard (5 modules)
    binaryData += EAN13_GUARD_CENTER;

    // 4. Right 6 Digits (6 x 7 = 42 modules)
    for (let i = 0; i < 6; i++) {
      const digit = parseInt(rightDigits[i], 10);
      binaryData += EAN13_R_PATTERNS[digit];
    }

    // 5. Stop Guard (3 modules)
    binaryData += EAN13_GUARD_STOP;

    // Total modules: 3 + 42 + 5 + 42 + 3 = 95
    if (binaryData.length !== 95) {
      throw new Error(`[EAN-13 Internal Error] 编码总模块数异常: ${binaryData.length} (期望 95)`);
    }

    // Identify guard bar modules for height extension
    // Guard bar intervals in 95-module data:
    // [0, 2] (Start), [45, 49] (Center), [92, 94] (Stop)
    const isGuardModule = (index) => {
      return (index >= 0 && index <= 2) ||
             (index >= 45 && index <= 49) ||
             (index >= 92 && index <= 94);
    };

    // Parse binary string into discrete bar and space runs
    const runs = [];
    let curBit = binaryData[0];
    let curCount = 0;
    let runStartIndex = 0;

    for (let i = 0; i < binaryData.length; i++) {
      const bit = binaryData[i];
      if (bit === curBit) {
        curCount++;
      } else {
        runs.push({
          type: curBit === '1' ? 'bar' : 'space',
          modules: curCount,
          startIndex: runStartIndex,
          isGuard: curBit === '1' && isGuardModule(runStartIndex)
        });
        curBit = bit;
        curCount = 1;
        runStartIndex = i;
      }
    }
    if (curCount > 0) {
      runs.push({
        type: curBit === '1' ? 'bar' : 'space',
        modules: curCount,
        startIndex: runStartIndex,
        isGuard: curBit === '1' && isGuardModule(runStartIndex)
      });
    }

    return {
      symbology: 'EAN-13',
      text: str,
      firstDigit,
      leftDigits,
      rightDigits,
      checksum: parseInt(str[12], 10),
      dataModulesCount: 95,
      binaryData,
      runs
    };
  }

  // --------------------------------------------------------------------------
  // 4. CODE 128 / GS1-128 CHECKSUM & ENCODING ALGORITHMS
  // --------------------------------------------------------------------------

  /**
   * Calculate Modulo 103 Checksum for Code 128.
   * Checksum = (StartValue + Sum(i * Value_i)) % 103
   * @param {number} startCode e.g. CODE128_START_B (104)
   * @param {number[]} dataCodes Array of character codes (0..102)
   * @returns {number} Checksum value (0..102)
   */
  function calculateCode128Checksum(startCode, dataCodes) {
    let sum = startCode;
    for (let i = 0; i < dataCodes.length; i++) {
      sum += (i + 1) * dataCodes[i];
    }
    return sum % 103;
  }

  /**
   * Map ASCII character in Code Set B to Code 128 value.
   * Code Set B covers ASCII 32 (' ') to 127 (DEL).
   * @param {string} char Single character
   * @returns {number} Value 0..95
   */
  function charToCode128B(char) {
    const code = char.charCodeAt(0);
    if (code >= 32 && code <= 126) {
      return code - 32;
    }
    if (code === 127) {
      return 95; // DEL
    }
    throw new Error(`[Code 128 Set B Error] 字符 "${char}" (ASCII ${code}) 超出 Code Set B 可编码范围 (32..127)`);
  }

  /**
   * Encode Code 128 / GS1-128 (Code Set B).
   * @param {string} text Data text to encode
   * @param {object} [options]
   * @param {boolean} [options.isGs1=false] If true, automatically prepends FNC1
   * @returns {object} Encoded Code 128 structure
   */
  function encodeCode128(text, options = {}) {
    const isGs1 = Boolean(options.isGs1 || options.type === 'gs1-128' || options.symbology === 'gs1-128');
    let displayText = String(text).trim();
    let cleanText = displayText;

    // Handle GS1 Application Identifiers parentheses in HRI (e.g. "(01)06912345678901")
    if (isGs1 && /\(\d+\)/.test(cleanText)) {
      cleanText = cleanText.replace(/[()]/g, '');
    }

    const startCode = CODE128_START_B;
    const dataCodes = [];

    // Prepend FNC1 for GS1-128
    if (isGs1) {
      dataCodes.push(CODE128_FNC1);
    }

    // Convert text characters to Code Set B values
    for (let i = 0; i < cleanText.length; i++) {
      // Support explicit escaped FNC1: "^FNC1" or "[FNC1]"
      if (cleanText.slice(i, i + 5) === '^FNC1' || cleanText.slice(i, i + 6) === '[FNC1]') {
        dataCodes.push(CODE128_FNC1);
        i += (cleanText[i] === '^' ? 4 : 5);
        continue;
      }
      dataCodes.push(charToCode128B(cleanText[i]));
    }

    // Calculate Checksum (Modulo 103)
    const checksum = calculateCode128Checksum(startCode, dataCodes);

    // Full symbol sequence: Start, Data..., Checksum, Stop
    const allSymbols = [startCode, ...dataCodes, checksum, CODE128_STOP];

    let binaryData = '';
    const runs = [];
    let currentModuleOffset = 0;

    for (let sIdx = 0; sIdx < allSymbols.length; sIdx++) {
      const symbolVal = allSymbols[sIdx];
      const widthPattern = CODE128_WIDTHS[symbolVal];
      const binPattern = widthsToBinary(widthPattern);
      binaryData += binPattern;

      // Extract runs directly from standard width pattern
      for (let wIdx = 0; wIdx < widthPattern.length; wIdx++) {
        const runModules = parseInt(widthPattern[wIdx], 10);
        runs.push({
          type: (wIdx % 2 === 0) ? 'bar' : 'space',
          modules: runModules,
          startIndex: currentModuleOffset,
          isGuard: false // Code 128 bars maintain uniform height
        });
        currentModuleOffset += runModules;
      }
    }

    return {
      symbology: isGs1 ? 'GS1-128' : 'Code 128',
      text: cleanText,
      displayText,
      isGs1,
      startCode,
      dataCodes,
      checksum,
      stopCode: CODE128_STOP,
      allSymbols,
      dataModulesCount: binaryData.length,
      binaryData,
      runs
    };
  }

  // --------------------------------------------------------------------------
  // 5. INDUSTRIAL PREPRESS BAR WIDTH REDUCTION (BWR) ALGORITHM
  // --------------------------------------------------------------------------

  /**
   * High-Precision Prepress BWR (Bar Width Reduction) Engine.
   * 
   * Packaging Printing Principle:
   *  During flexographic, gravure, or offset printing, printing ink squeezes
   *  and diffuses outward into substrate fibers (Dot Gain / 墨晕渗透扩散).
   *  To produce the exact target barcode bar width on final printed materials,
   *  prepress plate-making must apply BWR compensation:
   *    - Each physical Bar shrinks inward by bwrAmount:
   *        Bar_Plate_Width = Bar_Nominal_Width - BWR
   *    - Each physical Space expands outward by bwrAmount:
   *        Space_Plate_Width = Space_Nominal_Width + BWR
   *    - Geometric center of each bar is 100% strictly invariant:
   *        Center_Plate = Center_Nominal
   *    - Adjacent Bar + Space pitch remains identical:
   *        (W - BWR) + (S + BWR) = W + S
   * 
   * @param {object[]} runs Array of runs from encoding stage
   * @param {object} options
   * @param {number} options.moduleWidth Nominal module width in output units (pixels or mm)
   * @param {number} [options.moduleWidthMm=0.330] Standard physical module width in mm
   * @param {number} [options.bwrMm=0] Bar Width Reduction in millimeters (e.g. 0.025)
   * @param {number} [options.bwrPx] Direct Bar Width Reduction in output units
   * @param {number} [options.startX=0] Starting X coordinate
   * @param {number} [options.startY=0] Starting Y coordinate
   * @param {number} [options.barHeight=80] Nominal data bar height
   * @param {number} [options.guardBarExtraHeight=10] Extra height for EAN-13 guard bars
   * @returns {object} Geometric compensation layout
   */
  function applyBwr(runs, options = {}) {
    const moduleWidth = options.moduleWidth || 2;
    const moduleWidthMm = options.moduleWidthMm || 0.330;
    const startX = options.startX || 0;
    const startY = options.startY || 0;
    const barHeight = options.barHeight || 80;
    const guardBarExtraHeight = options.guardBarExtraHeight || 10;

    // Resolve BWR in rendering coordinate units (px)
    let bwrUnit = 0;
    if (typeof options.bwrPx === 'number') {
      bwrUnit = options.bwrPx;
    } else if (typeof options.bwrMm === 'number' && options.bwrMm > 0) {
      // Scale: 1mm = (moduleWidth / moduleWidthMm) units
      bwrUnit = options.bwrMm * (moduleWidth / moduleWidthMm);
    }

    if (bwrUnit < 0) {
      throw new Error(`[BWR Algorithm Error] 条宽补偿量不能为负数，接收到: ${bwrUnit}`);
    }

    // Safety Audit: BWR cannot exceed minimum bar module width, or 1-module bars will vanish
    const minNominalBarWidth = moduleWidth;
    if (bwrUnit >= minNominalBarWidth) {
      const maxAllowedMm = (minNominalBarWidth * moduleWidthMm / moduleWidth) * 0.95;
      throw new Error(`[BWR Prepress Warning] 设定的 BWR 补偿量 (${bwrUnit.toFixed(3)} units / ${(options.bwrMm || 0).toFixed(3)}mm) 过大，已超过单模块最小条宽 (${minNominalBarWidth.toFixed(3)} units)！安全上限为 ${maxAllowedMm.toFixed(3)}mm`);
    }

    const halfBwr = bwrUnit / 2;
    let nominalX = startX;
    const bars = [];
    const spaces = [];
    const elements = [];

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const nominalWidth = run.modules * moduleWidth;

      if (run.type === 'bar') {
        // Physical Bar: shrinks inward symmetrically by halfBwr on both sides
        const compensatedX = nominalX + halfBwr;
        const compensatedWidth = nominalWidth - bwrUnit;
        const h = run.isGuard ? (barHeight + guardBarExtraHeight) : barHeight;

        const barGeom = {
          type: 'bar',
          nominalX,
          nominalWidth,
          nominalCenter: nominalX + nominalWidth / 2,
          x: compensatedX,
          width: compensatedWidth,
          center: compensatedX + compensatedWidth / 2,
          y: startY,
          height: h,
          modules: run.modules,
          isGuard: Boolean(run.isGuard),
          bwrApplied: bwrUnit
        };

        bars.push(barGeom);
        elements.push(barGeom);
      } else {
        // Physical Space: expands outward symmetrically by halfBwr on both sides
        const compensatedX = nominalX - halfBwr;
        const compensatedWidth = nominalWidth + bwrUnit;

        const spaceGeom = {
          type: 'space',
          nominalX,
          nominalWidth,
          nominalCenter: nominalX + nominalWidth / 2,
          x: compensatedX,
          width: compensatedWidth,
          center: compensatedX + compensatedWidth / 2,
          y: startY,
          height: barHeight,
          modules: run.modules,
          bwrApplied: bwrUnit
        };

        spaces.push(spaceGeom);
        elements.push(spaceGeom);
      }

      nominalX += nominalWidth;
    }

    const totalNominalWidth = nominalX - startX;

    return {
      moduleWidth,
      moduleWidthMm,
      bwrUnit,
      bwrMm: options.bwrMm || (bwrUnit * moduleWidthMm / moduleWidth),
      totalNominalWidth,
      startX,
      endX: nominalX,
      bars,
      spaces,
      elements
    };
  }

  /**
   * Verify BWR mathematical invariance:
   *  1. Every bar's width is strictly reduced by bwrUnit.
   *  2. Every space's width is strictly enlarged by bwrUnit.
   *  3. Bar geometric centers are strictly invariant (delta < 1e-9).
   *  4. Total cycle pitch of bar + space is perfectly preserved.
   * @param {object} bwrResult Output of applyBwr
   * @returns {object} Invariance verification report
   */
  function verifyBwrInvariance(bwrResult) {
    const { bars, spaces, bwrUnit } = bwrResult;
    let maxCenterDeviation = 0;
    let widthCheckPassed = true;

    for (const bar of bars) {
      const centerDev = Math.abs(bar.center - bar.nominalCenter);
      if (centerDev > maxCenterDeviation) maxCenterDeviation = centerDev;
      const expectedWidth = bar.nominalWidth - bwrUnit;
      if (Math.abs(bar.width - expectedWidth) > 1e-9) {
        widthCheckPassed = false;
      }
    }

    for (const space of spaces) {
      const expectedWidth = space.nominalWidth + bwrUnit;
      if (Math.abs(space.width - expectedWidth) > 1e-9) {
        widthCheckPassed = false;
      }
    }

    const isCenterInvariant = maxCenterDeviation < 1e-9;
    const isPitchInvariant = widthCheckPassed && isCenterInvariant;

    return {
      isPitchInvariant,
      isCenterInvariant,
      widthCheckPassed,
      maxCenterDeviation,
      bwrUnit,
      barsCount: bars.length,
      spacesCount: spaces.length
    };
  }

  // --------------------------------------------------------------------------
  // 6. GS1 QUIET ZONE COMPLIANCE AUDIT ALGORITHM
  // --------------------------------------------------------------------------

  /**
   * Audit GS1 Barcode Quiet Zone (空白静区) Compliance according to
   * GS1 General Specifications & ISO/IEC 15420.
   * 
   * Standards:
   *  - EAN-13:
   *      Left Quiet Zone: >= 11 modules (at SC2 standard 100%: 3.63mm)
   *      Right Quiet Zone: >= 7 modules (at SC2 standard 100%: 2.31mm)
   *  - GS1-128 / Code 128:
   *      Left & Right Quiet Zones: >= max(10 * moduleWidthMm, 2.54mm)
   * 
   * @param {object} params
   * @param {string} [params.symbology='EAN-13'] 'EAN-13' | 'Code 128' | 'GS1-128'
   * @param {number} [params.moduleWidthMm=0.330] Module width in mm
   * @param {number} [params.leftQuietZoneModules] Provided left quiet zone in module count
   * @param {number} [params.rightQuietZoneModules] Provided right quiet zone in module count
   * @param {number} [params.leftQuietZoneMm] Provided left quiet zone in mm
   * @param {number} [params.rightQuietZoneMm] Provided right quiet zone in mm
   * @returns {object} Detailed audit diagnostic report
   */
  function checkQuietZoneCompliance(params = {}) {
    const symbology = String(params.symbology || params.type || 'EAN-13').toUpperCase();
    const moduleWidthMm = params.moduleWidthMm || (symbology.includes('128') ? 0.254 : 0.330);

    // Compute actual mm and modules for left and right quiet zones
    let actualLeftMm = 0;
    let actualLeftModules = 0;
    if (typeof params.leftQuietZoneMm === 'number') {
      actualLeftMm = params.leftQuietZoneMm;
      actualLeftModules = actualLeftMm / moduleWidthMm;
    } else if (typeof params.leftQuietZoneModules === 'number') {
      actualLeftModules = params.leftQuietZoneModules;
      actualLeftMm = actualLeftModules * moduleWidthMm;
    }

    let actualRightMm = 0;
    let actualRightModules = 0;
    if (typeof params.rightQuietZoneMm === 'number') {
      actualRightMm = params.rightQuietZoneMm;
      actualRightModules = actualRightMm / moduleWidthMm;
    } else if (typeof params.rightQuietZoneModules === 'number') {
      actualRightModules = params.rightQuietZoneModules;
      actualRightMm = actualRightModules * moduleWidthMm;
    }

    let minLeftModules = 10;
    let minLeftMm = 2.54;
    let minRightModules = 10;
    let minRightMm = 2.54;

    if (symbology.includes('EAN') || symbology.includes('13')) {
      // EAN-13 GS1 standard: Left 11 modules, Right 7 modules
      minLeftModules = 11;
      minLeftMm = 11 * moduleWidthMm;
      minRightModules = 7;
      minRightMm = 7 * moduleWidthMm;
    } else {
      // Code 128 / GS1-128 GS1 standard: at least 10 modules and >= 2.54mm (0.10 in)
      minLeftModules = 10;
      minLeftMm = Math.max(10 * moduleWidthMm, 2.54);
      minRightModules = 10;
      minRightMm = Math.max(10 * moduleWidthMm, 2.54);
    }

    const tolerance = 1e-4;
    const leftOk = actualLeftMm >= (minLeftMm - tolerance);
    const rightOk = actualRightMm >= (minRightMm - tolerance);
    const compliant = leftOk && rightOk;

    const leftShortfallMm = leftOk ? 0 : +(minLeftMm - actualLeftMm).toFixed(3);
    const rightShortfallMm = rightOk ? 0 : +(minRightMm - actualRightMm).toFixed(3);

    const issues = [];
    if (!leftOk) {
      issues.push(`左侧静区不足: 当前 ${actualLeftMm.toFixed(2)}mm (${actualLeftModules.toFixed(1)} 模块)，GS1 标准要求 >= ${minLeftMm.toFixed(2)}mm (${minLeftModules} 模块)，亏缺 ${leftShortfallMm}mm`);
    }
    if (!rightOk) {
      issues.push(`右侧静区不足: 当前 ${actualRightMm.toFixed(2)}mm (${actualRightModules.toFixed(1)} 模块)，GS1 标准要求 >= ${minRightMm.toFixed(2)}mm (${minRightModules} 模块)，亏缺 ${rightShortfallMm}mm`);
    }

    const reportMessage = compliant
      ? `[GS1 静区合规] 左侧 ${actualLeftMm.toFixed(2)}mm (>= ${minLeftMm.toFixed(2)}mm)，右侧 ${actualRightMm.toFixed(2)}mm (>= ${minRightMm.toFixed(2)}mm)。符合包装印刷预检标准。`
      : `[GS1 静区警报] 未通过静区合规检查: ${issues.join('; ')}。印刷制版时激光或CCD条码枪可能无法正确定界！`;

    return {
      compliant,
      symbology,
      moduleWidthMm,
      left: {
        actualMm: +actualLeftMm.toFixed(3),
        actualModules: +actualLeftModules.toFixed(1),
        minRequiredMm: +minLeftMm.toFixed(3),
        minRequiredModules: minLeftModules,
        compliant: leftOk,
        shortfallMm: leftShortfallMm
      },
      right: {
        actualMm: +actualRightMm.toFixed(3),
        actualModules: +actualRightModules.toFixed(1),
        minRequiredMm: +minRightMm.toFixed(3),
        minRequiredModules: minRightModules,
        compliant: rightOk,
        shortfallMm: rightShortfallMm
      },
      issues,
      reportMessage
    };
  }

  // --------------------------------------------------------------------------
  // 7. UNIFIED BARCODE GENERATION CORE
  // --------------------------------------------------------------------------

  /**
   * Universal Barcode Generator & Prepress Layout Compiler.
   * Handles encoding, quiet zone sizing, and BWR bar geometry calculation.
   * 
   * @param {object} options
   * @returns {object} Compiled barcode prepress model
   */
  function compileBarcodeModel(options = {}) {
    const rawType = String(options.type || options.symbology || 'ean13').toLowerCase();
    const isEan13 = rawType.includes('ean') || rawType.includes('13');
    const isGs1_128 = rawType.includes('gs1') || Boolean(options.isGs1);

    const moduleWidth = options.moduleWidth || 2; // Default 2 px per module
    const moduleWidthMm = options.moduleWidthMm || (isEan13 ? 0.330 : 0.254);
    const barHeight = options.barHeight || (isEan13 ? 75 : 80);
    const guardBarExtraHeight = isEan13 ? (options.guardBarExtraHeight || 10) : 0;
    const showText = options.showText !== false;
    const textHeight = showText ? (options.textHeight || 18) : 0;

    // Default standard quiet zone modules
    const defaultLeftQz = isEan13 ? 11 : 10;
    const defaultRightQz = isEan13 ? 7 : 10;

    const leftQuietZoneModules = (typeof options.leftQuietZoneModules === 'number')
      ? options.leftQuietZoneModules
      : (typeof options.leftQuietZoneMm === 'number' ? options.leftQuietZoneMm / moduleWidthMm : defaultLeftQz);

    const rightQuietZoneModules = (typeof options.rightQuietZoneModules === 'number')
      ? options.rightQuietZoneModules
      : (typeof options.rightQuietZoneMm === 'number' ? options.rightQuietZoneMm / moduleWidthMm : defaultRightQz);

    const leftQuietZoneWidth = leftQuietZoneModules * moduleWidth;
    const rightQuietZoneWidth = rightQuietZoneModules * moduleWidth;

    // Run GS1 Quiet Zone Compliance Check
    const quietZoneAudit = checkQuietZoneCompliance({
      symbology: isEan13 ? 'EAN-13' : (isGs1_128 ? 'GS1-128' : 'Code 128'),
      moduleWidthMm,
      leftQuietZoneModules,
      rightQuietZoneModules
    });

    // Encode symbology
    let encoded;
    if (isEan13) {
      encoded = encodeEan13(options.text || '690123456789', options);
    } else {
      encoded = encodeCode128(options.text || 'PrintGuard-2026', {
        ...options,
        isGs1: isGs1_128
      });
    }

    // Apply BWR Algorithm
    const barcodeStartX = leftQuietZoneWidth;
    const bwrLayout = applyBwr(encoded.runs, {
      moduleWidth,
      moduleWidthMm,
      bwrMm: options.bwrMm || 0,
      bwrPx: options.bwrPx,
      startX: barcodeStartX,
      startY: options.topPadding || 8,
      barHeight,
      guardBarExtraHeight
    });

    // Invariance Verification
    const invarianceReport = verifyBwrInvariance(bwrLayout);

    // Compute Canvas/SVG Viewport Dimensions
    const totalDataWidth = bwrLayout.totalNominalWidth;
    const totalWidth = leftQuietZoneWidth + totalDataWidth + rightQuietZoneWidth;
    const maxBarHeight = barHeight + guardBarExtraHeight;
    const totalHeight = (options.topPadding || 8) + maxBarHeight + textHeight + (options.bottomPadding || 8);

    return {
      isEan13,
      isGs1_128,
      symbology: encoded.symbology,
      text: encoded.text,
      displayText: encoded.displayText || encoded.text,
      encoded,
      bwrLayout,
      invarianceReport,
      quietZoneAudit,
      dimensions: {
        totalWidth,
        totalHeight,
        leftQuietZoneWidth,
        rightQuietZoneWidth,
        totalDataWidth,
        moduleWidth,
        moduleWidthMm,
        barHeight,
        guardBarExtraHeight,
        textHeight,
        topPadding: options.topPadding || 8,
        bottomPadding: options.bottomPadding || 8
      }
    };
  }

  // --------------------------------------------------------------------------
  // 8. CANVAS 2D RENDERING ENGINE
  // --------------------------------------------------------------------------

  /**
   * Render Barcode with BWR directly to an HTML5 Canvas 2D Context.
   * Supports standard HTMLCanvasElement, CanvasRenderingContext2D, or Node Mock Context.
   * 
   * @param {HTMLCanvasElement|CanvasRenderingContext2D|object} canvasOrCtx 
   * @param {object} options Barcode generation options
   * @returns {object} Render result metadata
   */
  function renderBarcodeToCanvas(canvasOrCtx, options = {}) {
    let ctx = canvasOrCtx;
    let canvas = null;

    if (canvasOrCtx && typeof canvasOrCtx.getContext === 'function') {
      canvas = canvasOrCtx;
      ctx = canvas.getContext('2d');
    }

    const model = compileBarcodeModel(options);
    const { dimensions, bwrLayout, encoded, isEan13, quietZoneAudit } = model;
    const { totalWidth, totalHeight, barHeight, guardBarExtraHeight, leftQuietZoneWidth, topPadding } = dimensions;

    // Auto-resize canvas ONLY if a Canvas DOM element was passed AND autoResizeCanvas is explicitly true
    if (canvas && options.autoResizeCanvas === true) {
      canvas.width = Math.ceil(totalWidth);
      canvas.height = Math.ceil(totalHeight);
    }

    // 1. Background fill
    const bgColor = options.backgroundColor !== undefined ? options.backgroundColor : '#FFFFFF';
    if (bgColor && bgColor !== 'transparent' && bgColor !== 'none') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, totalWidth, totalHeight);
    }

    // 2. Render Bars with BWR compensation
    const barColor = options.barColor || '#000000';
    ctx.fillStyle = barColor;

    for (let i = 0; i < bwrLayout.bars.length; i++) {
      const bar = bwrLayout.bars[i];
      // Use exact subpixel coordinates for precision
      ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    }

    // 3. Human Readable Interpretation (HRI) Typography
    const showText = options.showText !== false;
    if (showText) {
      const textColor = options.textColor || '#000000';
      const fontSize = options.fontSize || 13;
      const fontFamily = options.fontFamily || "'JetBrains Mono', 'OCRB', 'Courier New', monospace";
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textBaseline = 'top';

      if (isEan13) {
        // EAN-13 Standard Packaging Layout:
        //  - First digit (prefix) sits in the left quiet zone before Start Guard
        //  - Left 6 digits sit centered under left data bars (between Start & Center guards)
        //  - Right 6 digits sit centered under right data bars (between Center & Stop guards)
        //  - Optional quiet zone '>' sits after Stop Guard
        const textY = topPadding + barHeight + 2;

        // Digit 1 (prefix)
        ctx.textAlign = 'right';
        ctx.fillText(encoded.firstDigit, leftQuietZoneWidth - 3, textY);

        // Digits 2..7 (Left group, 42 modules wide: from module 3 to 45)
        const leftGroupCenterX = leftQuietZoneWidth + (3 + 21) * dimensions.moduleWidth;
        ctx.textAlign = 'center';
        ctx.fillText(encoded.leftDigits, leftGroupCenterX, textY);

        // Digits 8..13 (Right group, 42 modules wide: from module 50 to 92)
        const rightGroupCenterX = leftQuietZoneWidth + (50 + 21) * dimensions.moduleWidth;
        ctx.fillText(encoded.rightDigits, rightGroupCenterX, textY);

        // Right Quiet Zone Indicator '>'
        if (options.showQuietZoneIndicator !== false) {
          ctx.textAlign = 'left';
          const rightIndicatorX = leftQuietZoneWidth + (95 * dimensions.moduleWidth) + 3;
          ctx.fillText('>', rightIndicatorX, textY);
        }
      } else {
        // Code 128 / GS1-128: Centered typography beneath bars
        const textY = topPadding + barHeight + 4;
        const barcodeCenterX = leftQuietZoneWidth + dimensions.totalDataWidth / 2;
        ctx.textAlign = 'center';
        ctx.fillText(model.displayText, barcodeCenterX, textY);
      }
    }

    return {
      model,
      width: totalWidth,
      height: totalHeight,
      bwrMm: bwrLayout.bwrMm,
      bwrUnit: bwrLayout.bwrUnit,
      barsCount: bwrLayout.bars.length,
      quietZoneAudit
    };
  }

  // --------------------------------------------------------------------------
  // 9. HIGH-PRECISION SVG VECTOR GENERATOR
  // --------------------------------------------------------------------------

  /**
   * Generate Scalable Vector SVG Barcode with Prepress BWR Rectangles.
   * Zero DOM dependency - outputs pure standalone SVG string.
   * Can be directly exported to Kongsberg / ArtiosCAD / Illustrator.
   * 
   * @param {object} options Barcode generation options
   * @returns {string} Standalone SVG markup string
   */
  function generateBarcodeSvg(options = {}) {
    const model = compileBarcodeModel(options);
    const { dimensions, bwrLayout, encoded, isEan13, quietZoneAudit } = model;
    const { totalWidth, totalHeight, barHeight, leftQuietZoneWidth, topPadding } = dimensions;

    const bgColor = options.backgroundColor !== undefined ? options.backgroundColor : '#FFFFFF';
    const barColor = options.barColor || '#000000';
    const textColor = options.textColor || '#000000';
    const fontSize = options.fontSize || 13;
    const fontFamily = options.fontFamily || "'JetBrains Mono', 'OCRB', 'Courier New', monospace";
    const showText = options.showText !== false;

    let svgParts = [];

    // Root SVG tag with prepress audit metadata in data attributes
    const standalone = options.standalone !== false;
    if (standalone) {
      svgParts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `viewBox="0 0 ${totalWidth.toFixed(3)} ${totalHeight.toFixed(3)}" ` +
        `width="${totalWidth.toFixed(3)}" height="${totalHeight.toFixed(3)}" ` +
        `data-generator="PrintGuard-Barcode-BWR-Engine" ` +
        `data-symbology="${model.symbology}" ` +
        `data-code="${encoded.text}" ` +
        `data-bwr-mm="${bwrLayout.bwrMm.toFixed(4)}" ` +
        `data-bwr-px="${bwrLayout.bwrUnit.toFixed(4)}" ` +
        `data-quiet-zone-compliant="${quietZoneAudit.compliant}">`
      );
    } else {
      svgParts.push(`<g id="barcode-group">`);
    }

    // 1. Background Rect
    if (bgColor && bgColor !== 'transparent' && bgColor !== 'none') {
      svgParts.push(
        `  <rect width="${totalWidth.toFixed(3)}" height="${totalHeight.toFixed(3)}" fill="${bgColor}" />`
      );
    }

    // 2. Bar Elements with Inward BWR Contraction
    svgParts.push(`  <g id="bars" fill="${barColor}">`);
    for (let i = 0; i < bwrLayout.bars.length; i++) {
      const bar = bwrLayout.bars[i];
      svgParts.push(
        `    <rect x="${bar.x.toFixed(4)}" y="${bar.y.toFixed(4)}" ` +
        `width="${bar.width.toFixed(4)}" height="${bar.height.toFixed(4)}" ` +
        `${bar.isGuard ? 'data-guard="true"' : ''} />`
      );
    }
    svgParts.push(`  </g>`);

    // 3. Human Readable Text (HRI)
    if (showText) {
      svgParts.push(
        `  <g id="hri-text" fill="${textColor}" font-family="${fontFamily}" font-size="${fontSize}" dominant-baseline="hanging">`
      );
      const textY = (topPadding + barHeight + 3).toFixed(3);

      if (isEan13) {
        // Digit 1 (prefix)
        const prefixX = (leftQuietZoneWidth - 4).toFixed(3);
        svgParts.push(`    <text x="${prefixX}" y="${textY}" text-anchor="end">${encoded.firstDigit}</text>`);

        // Left 6 digits
        const leftGroupCenterX = (leftQuietZoneWidth + 24 * dimensions.moduleWidth).toFixed(3);
        svgParts.push(`    <text x="${leftGroupCenterX}" y="${textY}" text-anchor="middle">${encoded.leftDigits}</text>`);

        // Right 6 digits
        const rightGroupCenterX = (leftQuietZoneWidth + 71 * dimensions.moduleWidth).toFixed(3);
        svgParts.push(`    <text x="${rightGroupCenterX}" y="${textY}" text-anchor="middle">${encoded.rightDigits}</text>`);

        // Right indicator
        if (options.showQuietZoneIndicator !== false) {
          const rightIndicatorX = (leftQuietZoneWidth + 95 * dimensions.moduleWidth + 3).toFixed(3);
          svgParts.push(`    <text x="${rightIndicatorX}" y="${textY}" text-anchor="start">&gt;</text>`);
        }
      } else {
        const centerX = (leftQuietZoneWidth + dimensions.totalDataWidth / 2).toFixed(3);
        svgParts.push(`    <text x="${centerX}" y="${textY}" text-anchor="middle">${model.displayText}</text>`);
      }
      svgParts.push(`  </g>`);
    }

    if (standalone) {
      svgParts.push(`</svg>`);
    } else {
      svgParts.push(`</g>`);
    }

    return svgParts.join('\n');
  }

  // --------------------------------------------------------------------------
  // 10. PUBLIC ENGINE API
  // --------------------------------------------------------------------------

  return {
    version: '1.0.0-industrial',
    // Checksum & Encoding API
    calculateEan13Checksum,
    validateEan13,
    encodeEan13,
    calculateCode128Checksum,
    charToCode128B,
    encodeCode128,
    // Prepress BWR API
    applyBwr,
    verifyBwrInvariance,
    // GS1 Quiet Zone Compliance Audit API
    checkQuietZoneCompliance,
    // Universal Prepress Model Compiler
    compileBarcodeModel,
    // Rendering & Export API
    renderBarcodeToCanvas,
    generateBarcodeSvg,
    // Internal Constants (Exported for calibration)
    CONSTANTS: {
      EAN13_PARITY_TABLE,
      EAN13_L_PATTERNS,
      EAN13_G_PATTERNS,
      EAN13_R_PATTERNS,
      CODE128_WIDTHS,
      CODE128_FNC1,
      CODE128_START_A,
      CODE128_START_B,
      CODE128_START_C,
      CODE128_STOP
    }
  };
}));

// ============================================================================
// 11. EMBEDDED UNIT TEST SUITE (Node.js Direct Execution)
// ============================================================================
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const engine = module.exports;

  console.log('\n================================================================');
  console.log(' PrintGuard Pro - 工业条码与印前 BWR 补偿算法 单元测试套件');
  console.log(' Engine Version:', engine.version);
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName}`);
      passedTests++;
    } else {
      console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${details ? '--> ' + details : ''}`);
      failedTests++;
    }
  }

  function assertThrows(fn, testName) {
    try {
      fn();
      console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} (期望抛出异常但未抛出)`);
      failedTests++;
    } catch (e) {
      console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName} [捕获到预期异常: ${e.message.slice(0, 45)}...]`);
      passedTests++;
    }
  }

  // --- Suite 1: EAN-13 Modulo 10 Checksum & Parity ---
  console.log('\x1b[36m[SUITE 1]\x1b[0m EAN-13 零售商品码算法测试');
  {
    // Test 1.1: Standard checksum calculation
    assert(engine.calculateEan13Checksum('690123456789') === 2, 'EAN-13 校验码计算 (690123456789 -> 2)');
    assert(engine.calculateEan13Checksum('400638133393') === 1, 'EAN-13 校验码计算 (400638133393 -> 1)');
    assert(engine.calculateEan13Checksum('590123412345') === 7, 'EAN-13 校验码计算 (590123412345 -> 7)');

    // Test 1.2: Checksum validation
    assert(engine.validateEan13('6901234567892') === true, 'EAN-13 验证有效 13 位代码');
    assert(engine.validateEan13('6901234567895') === false, 'EAN-13 识别篡改校验码代码');

    // Test 1.3: Encode structure
    const eanEncoded = engine.encodeEan13('690123456789');
    assert(eanEncoded.text === '6901234567892', 'EAN-13 自动补全第 13 位校验码');
    assert(eanEncoded.dataModulesCount === 95, 'EAN-13 标准数据模块长度必须为 95 模块');
    assert(eanEncoded.binaryData.startsWith('101'), 'EAN-13 起始符为 101');
    assert(eanEncoded.binaryData.slice(45, 50) === '01010', 'EAN-13 中间分隔符为 01010');
    assert(eanEncoded.binaryData.endsWith('101'), 'EAN-13 终止符为 101');

    // Test 1.4: Guard bar flag tracking
    const guardBars = eanEncoded.runs.filter(r => r.type === 'bar' && r.isGuard);
    assert(guardBars.length === 6, 'EAN-13 必须包含 6 根长护线条 (Start 2根, Center 2根, Stop 2根)');
  }

  // --- Suite 2: Code 128 / GS1-128 Modulo 103 Checksum & FNC1 ---
  console.log('\n\x1b[36m[SUITE 2]\x1b[0m Code 128 / GS1-128 物流与追溯码测试');
  {
    // Test 2.1: Modulo 103 checksum known test vector
    // Text "CODE" in Code Set B: Start B (104), 'C' (35), 'O' (47), 'D' (36), 'E' (37)
    // Checksum = (104 + 1*35 + 2*47 + 3*36 + 4*37) % 103 = (104 + 35 + 94 + 108 + 148) % 103 = 489 % 103 = 77
    const c128Code = engine.encodeCode128('CODE');
    assert(c128Code.checksum === 77, 'Code 128 Modulo 103 校验码已知向量测试 ("CODE" -> 77)');
    assert(c128Code.startCode === 104, 'Code 128 Set B 起始码必须为 104');
    assert(c128Code.stopCode === 106, 'Code 128 终止码必须为 106');

    // Test 2.2: GS1-128 Mode FNC1 insertion
    const gs1Code = engine.encodeCode128('(01)06912345678901', { isGs1: true });
    assert(gs1Code.symbology === 'GS1-128', 'GS1-128 模式标记正确');
    assert(gs1Code.dataCodes[0] === 102, 'GS1-128 起始后首字符必须为 FNC1 (102)');
    assert(!gs1Code.text.includes('('), 'GS1-128 内部编码已安全剥离括号保留纯数据');

    // Test 2.3: Widths pattern integrity
    const allSumsCorrect = engine.CONSTANTS.CODE128_WIDTHS.every((w, idx) => {
      const sum = w.split('').reduce((a, b) => a + parseInt(b, 10), 0);
      return idx === 106 ? sum === 13 : sum === 11;
    });
    assert(allSumsCorrect, 'Code 128 107 个符号宽度之和完全符合标准 (0..105 均为 11 模块, 106 为 13 模块)');
  }

  // --- Suite 3: Prepress BWR (Bar Width Reduction) Engine ---
  console.log('\n\x1b[36m[SUITE 3]\x1b[0m 印前条宽补偿 (BWR) 与节距守恒性测试');
  {
    const eanEncoded = engine.encodeEan13('690123456789');

    // Test 3.1: Zero BWR (bwr = 0)
    const bwr0 = engine.applyBwr(eanEncoded.runs, { moduleWidth: 2, bwrMm: 0 });
    const inv0 = engine.verifyBwrInvariance(bwr0);
    assert(inv0.isPitchInvariant, 'BWR=0 节距与条宽完全守恒');

    // Test 3.2: Industrial standard BWR (0.025mm)
    const bwrMm = 0.025;
    const moduleWidthMm = 0.330;
    const moduleWidthPx = 3;
    const expectedBwrPx = bwrMm * (moduleWidthPx / moduleWidthMm);

    const bwrComp = engine.applyBwr(eanEncoded.runs, {
      moduleWidth: moduleWidthPx,
      moduleWidthMm: moduleWidthMm,
      bwrMm: bwrMm
    });

    const invComp = engine.verifyBwrInvariance(bwrComp);
    assert(invComp.isPitchInvariant, 'BWR 0.025mm 节距守恒性验证 (Pitch Invariance 100% 保持)');
    assert(invComp.isCenterInvariant, 'BWR 0.025mm 条线几何中心点绝对不偏移 (Center Invariance < 1e-9)');

    // Test 3.3: Inspect bar contraction
    const sampleBar = bwrComp.bars[0];
    const expectedWidth = sampleBar.nominalWidth - expectedBwrPx;
    assert(Math.abs(sampleBar.width - expectedWidth) < 1e-9, `每个黑条均匀内缩: ${sampleBar.nominalWidth}px -> ${sampleBar.width.toFixed(4)}px (-${expectedBwrPx.toFixed(4)}px)`);

    // Test 3.4: Inspect space expansion
    const sampleSpace = bwrComp.spaces[0];
    const expectedSpaceWidth = sampleSpace.nominalWidth + expectedBwrPx;
    assert(Math.abs(sampleSpace.width - expectedSpaceWidth) < 1e-9, `每个白空均匀放宽: ${sampleSpace.nominalWidth}px -> ${sampleSpace.width.toFixed(4)}px (+${expectedBwrPx.toFixed(4)}px)`);

    // Test 3.5: Negative BWR check
    assertThrows(() => {
      engine.applyBwr(eanEncoded.runs, { moduleWidth: 2, bwrPx: -0.5 });
    }, '负数 BWR 参数安全阻断拦截');

    // Test 3.6: Excessive BWR check
    assertThrows(() => {
      engine.applyBwr(eanEncoded.runs, { moduleWidth: 2, bwrPx: 2.5 });
    }, '过大 BWR 参数 (超过单模块宽) 安全阻断拦截');
  }

  // --- Suite 4: GS1 Quiet Zone Compliance Audit ---
  console.log('\n\x1b[36m[SUITE 4]\x1b[0m GS1 条码静区 (Quiet Zone) 合规检查算法测试');
  {
    // Test 4.1: Compliant EAN-13 (Left 11 modules, Right 7 modules at 0.33mm)
    const eanPass = engine.checkQuietZoneCompliance({
      symbology: 'EAN-13',
      moduleWidthMm: 0.330,
      leftQuietZoneModules: 11,
      rightQuietZoneModules: 7
    });
    assert(eanPass.compliant === true, 'EAN-13 标准静区通过合规预检 (左 11 模块 / 右 7 模块)');
    assert(eanPass.left.actualMm === 3.63, 'EAN-13 左侧标准静区计算: 3.63mm');
    assert(eanPass.right.actualMm === 2.31, 'EAN-13 右侧标准静区计算: 2.31mm');

    // Test 4.2: Deficient EAN-13 (Left only 6 modules)
    const eanFail = engine.checkQuietZoneCompliance({
      symbology: 'EAN-13',
      moduleWidthMm: 0.330,
      leftQuietZoneModules: 6,
      rightQuietZoneModules: 7
    });
    assert(eanFail.compliant === false, 'EAN-13 左侧静区不足拦截 (当前 6 模块 < 11 模块)');
    assert(eanFail.left.shortfallMm > 0, `准确指出左侧静区亏缺毫米数: ${eanFail.left.shortfallMm}mm`);

    // Test 4.3: GS1-128 Quiet Zone standard (>= max(10 * X, 2.54mm))
    const gs1Pass = engine.checkQuietZoneCompliance({
      symbology: 'GS1-128',
      moduleWidthMm: 0.300,
      leftQuietZoneMm: 3.2,
      rightQuietZoneMm: 3.2
    });
    assert(gs1Pass.compliant === true, 'GS1-128 双侧 3.2mm 满足 >= 3.0mm (10X) 且 >= 2.54mm');

    const gs1Fail = engine.checkQuietZoneCompliance({
      symbology: 'GS1-128',
      moduleWidthMm: 0.200,
      leftQuietZoneMm: 2.1, // Less than 2.54mm!
      rightQuietZoneMm: 3.0
    });
    assert(gs1Fail.compliant === false, 'GS1-128 左侧 2.1mm 低于工业绝对下限 2.54mm 判定违规');
  }

  // --- Suite 5: Standalone SVG Vector Generation ---
  console.log('\n\x1b[36m[SUITE 5]\x1b[0m SVG 矢量条码导出测试');
  {
    const svgEan = engine.generateBarcodeSvg({
      type: 'ean13',
      text: '690123456789',
      bwrMm: 0.025,
      moduleWidth: 2
    });

    assert(svgEan.startsWith('<svg') && svgEan.endsWith('</svg>'), '生成独立合规的 SVG 根标签');
    assert(svgEan.includes('data-generator="PrintGuard-Barcode-BWR-Engine"'), '嵌入 PrintGuard 工业引擎元数据');
    assert(svgEan.includes('data-bwr-mm="0.0250"'), '嵌入 BWR 印前条宽补偿参数属性');
    assert(svgEan.includes('<text') && svgEan.includes('690123'), '包含 HRI 矢量数字文本');

    const svgC128 = engine.generateBarcodeSvg({
      type: 'gs1-128',
      text: '(01)06912345678901',
      bwrMm: 0.030
    });
    assert(svgC128.includes('data-symbology="GS1-128"'), '生成 GS1-128 矢量 SVG 标志');
  }

  // --- Suite 6: Canvas 2D Rendering Engine (Mock Context) ---
  console.log('\n\x1b[36m[SUITE 6]\x1b[0m Canvas 2D 绘制引擎 (Mock Context) 测试');
  {
    // High-fidelity Mock Canvas 2D Context
    const fillRectCalls = [];
    const fillTextCalls = [];
    const mockCtx = {
      fillStyle: '#000000',
      font: '',
      textAlign: '',
      textBaseline: '',
      fillRect: function (x, y, w, h) {
        fillRectCalls.push({ x, y, w, h, fillStyle: this.fillStyle });
      },
      fillText: function (text, x, y) {
        fillTextCalls.push({ text, x, y, fillStyle: this.fillStyle, font: this.font });
      }
    };

    const renderResult = engine.renderBarcodeToCanvas(mockCtx, {
      type: 'ean13',
      text: '690123456789',
      bwrMm: 0.025,
      moduleWidth: 2,
      backgroundColor: '#FFFFFF',
      barColor: '#000000'
    });

    assert(renderResult.barsCount > 20, `Canvas 2D 成功绘制 ${renderResult.barsCount} 根补偿条线`);
    assert(fillRectCalls.length === 1 + renderResult.barsCount, '绘制包含 1 次背景填充 + N 次条线绘制');
    assert(fillTextCalls.length >= 3, '绘制包含 EAN-13 分块 HRI 文本 (前缀、左段、右段、提示符)');

    // Verify guard bars extra height rendered to canvas
    const sampleGuardBar = renderResult.model.bwrLayout.bars.find(b => b.isGuard);
    const sampleDataBar = renderResult.model.bwrLayout.bars.find(b => !b.isGuard);
    assert(sampleGuardBar.height > sampleDataBar.height, `EAN-13 护线条绘制高度 (${sampleGuardBar.height}px) 高于数据条 (${sampleDataBar.height}px)`);
  }

  // --- Summary ---
  console.log('\n================================================================');
  console.log(` 测试运行完成: \x1b[32m${passedTests} 通过\x1b[0m, \x1b[31m${failedTests} 失败\x1b[0m (总计 ${passedTests + failedTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
