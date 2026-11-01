/**
 * ============================================================================
 * PrintGuard Pro - Pure Native DXF Dieline Parsing & Classification Engine
 * ============================================================================
 * 
 * 纯原生 DXF 刀模文件逆向解析与图层分类导入引擎
 * 
 * 特性：
 * 1. 纯原生 JavaScript 实现，零外部 npm 依赖，兼容 Node.js 与主流现代浏览器。
 * 2. 支持标准 ASCII DXF（AutoCAD R12 至最新版，包括 ArtiosCAD 包装刀模 DXF）：
 *    - HEADER: $ACADVER, $INSUNITS (单位自动探测与物理尺寸换算), $MEASUREMENT 等；
 *    - TABLES: LAYER 图层定义、ACI 颜色、线型；
 *    - BLOCKS: 图块定义与 INSERT 图块引用逆向矩阵展开；
 *    - ENTITIES: LINE, LWPOLYLINE, POLYLINE (含 VERTEX/SEQEND), ARC, CIRCLE, 
 *                ELLIPSE, SPLINE, TEXT, MTEXT 等。
 * 3. 智能图层分类引擎：
 *    - 裁切刀线 (Cut Contour / Thru-Cut / Die Perimeter): 
 *      匹配 CUT, CUT_CONTOUR, DIE, CUTTING, THRU, PERIMETER, OUTLINE, BLADE, KNIFE 等；
 *    - 压痕折线 (Crease / Fold / Score / Perf): 
 *      匹配 CREASE, FOLD, SCORE, PERF, BEND, CREASING, SCORING 等；
 *    - 标注图层 (Dimension / Annotation / Note): 
 *      匹配 DIM, ANNOTATION, TEXT, NOTE, TITLE, INFO, MEASURE, LABEL 等；
 *    - 出血与辅助线 (Bleed / Guide): 匹配 BLEED, GUIDE, REG 等。
 * 4. 严谨几何包围盒算法：
 *    - 支持 LINE、CIRCLE；
 *    - 支持 ARC（严谨四象限极值角 0°, 90°, 180°, 270° 包含判定）；
 *    - 支持 LWPOLYLINE / POLYLINE 凸度 (Bulge) 弧线精确包围盒计算与离散平滑采样。
 * 5. 自适应坐标归一化引擎：
 *    - 自动以毫米 (mm) 物理尺度对齐（支持 Inches -> mm * 25.4 等自动换算）；
 *    - 几何包围盒自适应居中于 (0, 0)；
 *    - 支持 Canvas 2D 屏幕坐标系 (+Y 向下) 与 CAD/3D 笛卡尔坐标系 (+Y 向上) 双向映射。
 * 6. 多端渲染与导出管道：
 *    - 直接驱动 Canvas 2D 路径绘制与分层线型渲染 (renderToCanvas)；
 *    - 导出标准分层 SVG 文本 (toSvg)；
 *    - 导出归一化 UV 贴图数据模型 (toNormalizedUV)，无缝对接 Three.js 3D 包装折叠仿真。
 * 
 * 接口：
 * - parseDxfString(dxfText, options)
 * - DxfParser 类
 * - classifyLayer(layerName)
 * - computeBounds(entities)
 * - renderDxfToCanvas(dxfData, ctx, options)
 * - dxfToSvg(dxfData, options)
 */

(function (global) {
  'use strict';

// ----------------------------------------------------------------------------
// 1. 常量与色彩映射表 (AutoCAD Color Index / ACI Palette)
// ----------------------------------------------------------------------------

/**
 * AutoCAD 常用标准 ACI 颜色表 (1-9 基础色及典型灰阶)
 */
const ACI_COLORS = {
  0: '#000000',   // BYBLOCK
  1: '#FF0000',   // Red
  2: '#FFFF00',   // Yellow
  3: '#00FF00',   // Green
  4: '#00FFFF',   // Cyan
  5: '#0000FF',   // Blue
  6: '#FF00FF',   // Magenta
  7: '#FFFFFF',   // White / Black
  8: '#808080',   // Dark Gray
  9: '#C0C0C0',   // Light Gray
  250: '#333333',
  251: '#505050',
  252: '#696969',
  253: '#828282',
  254: '#BEBEBE',
  255: '#FFFFFF',
  256: null       // BYLAYER
};

/**
 * 包装工作台行业标准默认图层色彩
 */
const DEFAULT_CLASSIFICATION_COLORS = {
  cut: '#EC4899',       // 裁切刀线：洋红/粉红 (PrintGuard Pro 标准)
  crease: '#06B6D4',    // 压痕折线：青色 (PrintGuard Pro 标准)
  annotation: '#64748B',// 标注说明：冷灰色
  bleed: '#10B981',     // 出血辅助：翡翠绿
  guide: '#8B5CF6',     // 导线定位：紫色
  other: '#94A3B8'      // 其他几何：浅灰
};

/**
 * DXF $INSUNITS 物理单位定义及毫米换算系数
 */
const DXF_INSUNITS = {
  0: { name: 'Unspecified', scaleToMm: 1.0 },
  1: { name: 'Inches', scaleToMm: 25.4 },
  2: { name: 'Feet', scaleToMm: 304.8 },
  3: { name: 'Miles', scaleToMm: 1609344.0 },
  4: { name: 'Millimeters', scaleToMm: 1.0 },
  5: { name: 'Centimeters', scaleToMm: 10.0 },
  6: { name: 'Meters', scaleToMm: 1000.0 },
  7: { name: 'Kilometers', scaleToMm: 1000000.0 },
  8: { name: 'Microinches', scaleToMm: 0.0000254 },
  9: { name: 'Mils', scaleToMm: 0.0254 },
  10: { name: 'Yards', scaleToMm: 914.4 },
  14: { name: 'Decimeters', scaleToMm: 100.0 }
};

/**
 * 将 ACI 颜色编号转换为 CSS 16进制色彩字符串
 * @param {number} colorNumber 
 * @param {number|null} trueColor 24-bit 真实颜色整数 (Group Code 420)
 * @returns {string} '#RRGGBB'
 */
function aciToHex(colorNumber, trueColor = null) {
  if (trueColor !== null && trueColor !== undefined) {
    const hex = (trueColor & 0xFFFFFF).toString(16).padStart(6, '0');
    return '#' + hex.toUpperCase();
  }
  if (colorNumber in ACI_COLORS && ACI_COLORS[colorNumber] !== null) {
    return ACI_COLORS[colorNumber];
  }
  if (colorNumber >= 10 && colorNumber <= 249) {
    const hue = ((colorNumber - 10) / 240) * 360;
    return hslToHex(hue, 1.0, 0.5);
  }
  return '#000000';
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else if (h >= 300 && h < 360) { r = c; g = 0; b = x; }
  const to255 = (val) => Math.round((val + m) * 255).toString(16).padStart(2, '0');
  return '#' + (to255(r) + to255(g) + to255(b)).toUpperCase();
}


// ----------------------------------------------------------------------------
// 2. 几何与数学辅助库 (Bulge, Arc, BoundingBox)
// ----------------------------------------------------------------------------

/**
 * 判定测试角度是否落在从 startAngle 至 endAngle 的逆时针 (CCW) 弧段内
 * 所有角度单位均为度数 [0, 360)
 */
function isAngleBetweenCcw(startAngle, endAngle, testAngle) {
  const s = ((startAngle % 360) + 360) % 360;
  const e = ((endAngle % 360) + 360) % 360;
  const t = ((testAngle % 360) + 360) % 360;

  if (s <= e) {
    return t >= s && t <= e;
  } else {
    return t >= s || t <= e;
  }
}

/**
 * 从多段线顶点与凸度 (bulge) 逆向推导圆弧几何参数
 * Bulge 定义：tan(θ / 4)，其中 θ 为圆弧包含角
 * bulge > 0: 逆时针圆弧 (CCW)
 * bulge < 0: 顺时针圆弧 (CW)
 * |bulge| = 1: 半圆 (180°)
 */
function bulgeToArcInfo(p1, p2, bulge) {
  if (!bulge || Math.abs(bulge) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chordLen = Math.hypot(dx, dy);
  if (chordLen < 1e-9) return null;

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  const factor = (1 - bulge * bulge) / (4 * bulge);
  const cx = mx - factor * dy;
  const cy = my + factor * dx;
  const r = Math.hypot(p1.x - cx, p1.y - cy);

  let a1 = Math.atan2(p1.y - cy, p1.x - cx) * 180 / Math.PI;
  let a2 = Math.atan2(p2.y - cy, p2.x - cx) * 180 / Math.PI;
  a1 = ((a1 % 360) + 360) % 360;
  a2 = ((a2 % 360) + 360) % 360;

  return {
    cx,
    cy,
    r,
    startAngle: a1,
    endAngle: a2,
    isCCW: bulge > 0,
    bulge,
    includedAngleDeg: 4 * Math.atan(bulge) * 180 / Math.PI
  };
}

/**
 * 将带凸度的多段线线段自适应平滑离散为折线点序列
 */
function bulgeToPoints(p1, p2, bulge, maxSegments = 16) {
  if (!bulge || Math.abs(bulge) < 1e-9) {
    return [
      { x: p1.x, y: p1.y },
      { x: p2.x, y: p2.y }
    ];
  }
  const arcInfo = bulgeToArcInfo(p1, p2, bulge);
  if (!arcInfo) {
    return [
      { x: p1.x, y: p1.y },
      { x: p2.x, y: p2.y }
    ];
  }

  const { cx, cy, r } = arcInfo;
  const theta = 4 * Math.atan(bulge);
  const startAngleRad = Math.atan2(p1.y - cy, p1.x - cx);

  const steps = Math.max(4, Math.min(maxSegments, Math.ceil(Math.abs(theta) / (Math.PI / 18))));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAngleRad + t * theta;
    points.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a)
    });
  }
  points[0] = { x: p1.x, y: p1.y };
  points[points.length - 1] = { x: p2.x, y: p2.y };
  return points;
}

/**
 * 采样圆弧离散点
 */
function sampleArcPoints(cx, cy, r, startAngleDeg, endAngleDeg, segments = 24) {
  let s = ((startAngleDeg % 360) + 360) % 360;
  let e = ((endAngleDeg % 360) + 360) % 360;
  if (Math.abs(endAngleDeg - startAngleDeg) >= 360) {
    s = 0;
    e = 360;
  }
  let spanDeg = e - s;
  if (spanDeg <= 0) spanDeg += 360;

  const steps = Math.max(4, Math.min(segments, Math.ceil(spanDeg / 10)));
  const points = [];
  const sRad = s * Math.PI / 180;
  const spanRad = spanDeg * Math.PI / 180;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = sRad + t * spanRad;
    points.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a)
    });
  }
  return points;
}

/**
 * 计算单个圆弧的严谨笛卡尔极值包围盒
 */
function getArcBounds(cx, cy, r, startAngleDeg, endAngleDeg) {
  let s = ((startAngleDeg % 360) + 360) % 360;
  let e = ((endAngleDeg % 360) + 360) % 360;

  if (Math.abs(endAngleDeg - startAngleDeg) >= 360) {
    return {
      minX: cx - r, maxX: cx + r,
      minY: cy - r, maxY: cy + r
    };
  }

  const radS = s * Math.PI / 180;
  const radE = e * Math.PI / 180;

  const candX = [cx + r * Math.cos(radS), cx + r * Math.cos(radE)];
  const candY = [cy + r * Math.sin(radS), cy + r * Math.sin(radE)];

  if (isAngleBetweenCcw(s, e, 0)) candX.push(cx + r);
  if (isAngleBetweenCcw(s, e, 90)) candY.push(cy + r);
  if (isAngleBetweenCcw(s, e, 180)) candX.push(cx - r);
  if (isAngleBetweenCcw(s, e, 270)) candY.push(cy - r);

  return {
    minX: Math.min(...candX),
    maxX: Math.max(...candX),
    minY: Math.min(...candY),
    maxY: Math.max(...candY)
  };
}

/**
 * 计算单个实体的笛卡尔包围盒
 */
function getEntityBounds(entity) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const update = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  switch (entity.type) {
    case 'LINE':
      update(entity.x1, entity.y1);
      update(entity.x2, entity.y2);
      break;

    case 'CIRCLE':
      update(entity.cx - entity.r, entity.cy - entity.r);
      update(entity.cx + entity.r, entity.cy + entity.r);
      break;

    case 'ARC': {
      const b = getArcBounds(entity.cx, entity.cy, entity.r, entity.startAngle, entity.endAngle);
      minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY;
      break;
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = entity.vertices || [];
      const len = vertices.length;
      if (len === 0) break;
      for (let i = 0; i < len; i++) {
        update(vertices[i].x, vertices[i].y);
      }
      const segCount = entity.isClosed ? len : len - 1;
      for (let i = 0; i < segCount; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % len];
        if (v1.bulge && Math.abs(v1.bulge) > 1e-6) {
          const arcInfo = bulgeToArcInfo(v1, v2, v1.bulge);
          if (arcInfo) {
            const s = arcInfo.isCCW ? arcInfo.startAngle : arcInfo.endAngle;
            const e = arcInfo.isCCW ? arcInfo.endAngle : arcInfo.startAngle;
            const ab = getArcBounds(arcInfo.cx, arcInfo.cy, arcInfo.r, s, e);
            update(ab.minX, ab.minY);
            update(ab.maxX, ab.maxY);
          }
        }
      }
      break;
    }

    case 'ELLIPSE': {
      const rMajor = Math.hypot(entity.majorX, entity.majorY);
      const rMinor = rMajor * entity.ratio;
      const maxR = Math.max(rMajor, rMinor);
      update(entity.cx - maxR, entity.cy - maxR);
      update(entity.cx + maxR, entity.cy + maxR);
      break;
    }

    case 'SPLINE': {
      const pts = (entity.controlPoints && entity.controlPoints.length > 0)
        ? entity.controlPoints
        : (entity.fitPoints || []);
      for (const p of pts) update(p.x, p.y);
      break;
    }

    case 'TEXT':
    case 'MTEXT':
      if (entity.x !== undefined && entity.y !== undefined) {
        update(entity.x, entity.y);
        const h = entity.height || 5;
        const textLen = (entity.text || '').length;
        update(entity.x + Math.max(h, textLen * h * 0.6), entity.y + h);
      }
      break;

    case 'POINT':
      if (entity.x !== undefined && entity.y !== undefined) {
        update(entity.x, entity.y);
      }
      break;
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * 汇总计算全体几何实体的全局包围盒 (Global Bounding Box)
 */
function computeBounds(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ent of entities) {
    const b = ent.bounds || getEntityBounds(ent);
    if (b.minX !== undefined && isFinite(b.minX)) {
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}


// ----------------------------------------------------------------------------
// 3. 智能图层分类器 (Layer Classifier)
// ----------------------------------------------------------------------------

function classifyLayer(layerName, customRules = {}) {
  if (!layerName || typeof layerName !== 'string') return 'other';
  const name = layerName.trim().toUpperCase();

  // 1. 用户自定义覆盖
  if (customRules.overrides && customRules.overrides[name]) {
    return customRules.overrides[name];
  }

  // 2. 压痕折线 (优先匹配以准确归类折线、齿刀 PERF)
  const creasePattern = customRules.creasePattern || 
    /CREASE|FOLD|SCORE|PERF|BEND|CREASING|SCORING|PERFORAT|PRESS|DIE_CREASE/i;
  if (creasePattern.test(name)) {
    return 'crease';
  }

  // 3. 裁切刀线
  const cutPattern = customRules.cutPattern || 
    /CUT|CUT_CONTOUR|DIE|CUTTING|THRU|PERIMETER|OUTLINE|BLADE|KNIFE|SLIT|PROFILE|CONTOUR|MAIN.*DESIGN/i;
  if (cutPattern.test(name)) {
    return 'cut';
  }

  // 4. 标注说明
  const annotationPattern = customRules.annotationPattern || 
    /DIM|ANNOTAT|TEXT|NOTE|TITLE|INFO|MEASURE|LABEL|SPEC|COMMENT|DEFPOINTS/i;
  if (annotationPattern.test(name)) {
    return 'annotation';
  }

  // 5. 出血图层
  if (/BLEED/i.test(name)) {
    return 'bleed';
  }

  // 6. 辅助导线与对位
  if (/GUIDE|REG|ALIGN|MARGIN|REGISTRATION/i.test(name)) {
    return 'guide';
  }

  return 'other';
}


// ----------------------------------------------------------------------------
// 4. 高性能 DXF ASCII Token 流扫描器 (DxfScanner)
// ----------------------------------------------------------------------------

class DxfScanner {
  constructor(text) {
    if (typeof text !== 'string') {
      throw new Error('DxfScanner: input must be a string');
    }
    this.lines = text.split(/\r\n|\r|\n/);
    this.index = 0;
    this.total = this.lines.length;
  }

  hasNext() {
    return this.index < this.total;
  }

  next() {
    while (this.index < this.total) {
      const codeLine = this.lines[this.index++];
      if (!codeLine) continue;
      const codeTrimmed = codeLine.trim();
      if (codeTrimmed === '') continue;

      const code = parseInt(codeTrimmed, 10);
      if (isNaN(code)) continue;

      let value = '';
      if (this.index < this.total) {
        value = this.lines[this.index++];
        if (code !== 1 && code !== 3) {
          value = value.trim();
        }
      }
      return { code, value };
    }
    return null;
  }
}


// ----------------------------------------------------------------------------
// 5. DXF 逆向解析主引擎 (DxfParser)
// ----------------------------------------------------------------------------

class DxfParser {
  constructor(options = {}) {
    this.options = {
      defaultLayerColor: true,
      expandBlocks: true,
      scaleFactor: null,
      customLayerRules: {},
      ...options
    };
  }

  parse(dxfText) {
    const scanner = new DxfScanner(dxfText);

    const header = {};
    const layers = {};
    const blocks = {};
    const rawEntities = [];
    const inserts = [];

    let token = scanner.next();
    while (token) {
      if (token.code === 0 && token.value.toUpperCase() === 'SECTION') {
        const secToken = scanner.next();
        const secName = (secToken && secToken.code === 2) ? secToken.value.toUpperCase() : '';

        if (secName === 'HEADER') {
          token = this._parseHeaderSection(scanner, header);
          continue;
        } else if (secName === 'TABLES') {
          token = this._parseTablesSection(scanner, layers);
          continue;
        } else if (secName === 'BLOCKS') {
          token = this._parseBlocksSection(scanner, blocks);
          continue;
        } else if (secName === 'ENTITIES') {
          token = this._parseEntitiesSection(scanner, rawEntities, inserts);
          continue;
        } else {
          token = scanner.next();
          while (token) {
            if (token.code === 0 && token.value.toUpperCase() === 'ENDSEC') {
              token = scanner.next();
              break;
            }
            token = scanner.next();
          }
          continue;
        }
      } else if (token.code === 0 && token.value.toUpperCase() === 'EOF') {
        break;
      } else {
        if (token.code === 0) {
          token = this._parseEntityToken(token, scanner, rawEntities, inserts);
        } else {
          token = scanner.next();
        }
      }
    }

    const entities = [...rawEntities];
    if (this.options.expandBlocks && inserts.length > 0) {
      for (const ins of inserts) {
        const blk = blocks[ins.blockName];
        if (blk && blk.entities) {
          const expanded = this._expandBlockEntities(blk, ins);
          entities.push(...expanded);
        }
      }
    }

    const unitCode = header['$INSUNITS'] !== undefined ? parseInt(header['$INSUNITS'], 10) : 0;
    const unitDef = DXF_INSUNITS[unitCode] || DXF_INSUNITS[0];
    let scaleToMm = unitDef.scaleToMm;
    if (this.options.scaleFactor !== null && typeof this.options.scaleFactor === 'number') {
      scaleToMm = this.options.scaleFactor;
    }

    const classified = {
      cut: [],
      crease: [],
      annotation: [],
      bleed: [],
      guide: [],
      other: []
    };

    const layerMap = {};
    for (const [lname, linfo] of Object.entries(layers)) {
      const cls = classifyLayer(lname, this.options.customLayerRules);
      layerMap[lname] = {
        name: lname,
        classification: cls,
        colorNumber: linfo.colorNumber,
        color: linfo.color || aciToHex(linfo.colorNumber, linfo.trueColor) || DEFAULT_CLASSIFICATION_COLORS[cls],
        lineType: linfo.lineType || 'CONTINUOUS',
        count: 0
      };
    }

    const enrichedEntities = [];
    for (const ent of entities) {
      const layerName = ent.layer || '0';
      const classification = classifyLayer(layerName, this.options.customLayerRules);

      if (!layerMap[layerName]) {
        layerMap[layerName] = {
          name: layerName,
          classification,
          colorNumber: ent.colorNumber !== undefined ? ent.colorNumber : 256,
          color: ent.color || DEFAULT_CLASSIFICATION_COLORS[classification],
          lineType: ent.lineType || 'CONTINUOUS',
          count: 0
        };
      }
      layerMap[layerName].count++;

      let finalColor = ent.color;
      if (!finalColor) {
        if (ent.colorNumber && ent.colorNumber !== 256) {
          finalColor = aciToHex(ent.colorNumber, ent.trueColor);
        } else {
          finalColor = layerMap[layerName].color || DEFAULT_CLASSIFICATION_COLORS[classification];
        }
      }

      ent.layer = layerName;
      ent.classification = classification;
      ent.color = finalColor;
      ent.bounds = getEntityBounds(ent);

      enrichedEntities.push(ent);

      if (classified[classification]) {
        classified[classification].push(ent);
      } else {
        classified.other.push(ent);
      }
    }

    const globalBounds = computeBounds(enrichedEntities);

    const result = {
      version: header['$ACADVER'] || 'AutoCAD R12 / Unknown',
      header,
      units: {
        code: unitCode,
        name: unitDef.name,
        scaleToMm
      },
      bounds: globalBounds,
      layers: layerMap,
      entities: enrichedEntities,
      classified,
      stats: {
        totalEntities: enrichedEntities.length,
        cutCount: classified.cut.length,
        creaseCount: classified.crease.length,
        annotationCount: classified.annotation.length,
        bleedCount: classified.bleed.length,
        guideCount: classified.guide.length,
        otherCount: classified.other.length,
        layerCount: Object.keys(layerMap).length
      }
    };

    result.getNormalizedEntities = (opts) => this.getNormalizedEntities(result, opts);
    result.renderToCanvas = (ctx, opts) => renderDxfToCanvas(result, ctx, opts);
    result.toSvg = (opts) => dxfToSvg(result, opts);
    result.toNormalizedUV = (opts) => this.toNormalizedUV(result, opts);

    return result;
  }

  _parseHeaderSection(scanner, header) {
    let token = scanner.next();
    while (token) {
      if (token.code === 0 && token.value.toUpperCase() === 'ENDSEC') {
        return scanner.next();
      }
      if (token.code === 9) {
        const varName = token.value;
        token = scanner.next();
        while (token && token.code !== 9 && token.code !== 0) {
          if (token.code === 10 || token.code === 20 || token.code === 30) {
            if (!header[varName] || typeof header[varName] !== 'object') {
              header[varName] = {};
            }
            if (token.code === 10) header[varName].x = parseFloat(token.value);
            else if (token.code === 20) header[varName].y = parseFloat(token.value);
            else if (token.code === 30) header[varName].z = parseFloat(token.value);
          } else {
            header[varName] = token.value;
          }
          token = scanner.next();
        }
        continue;
      }
      token = scanner.next();
    }
    return null;
  }

  _parseTablesSection(scanner, layers) {
    let token = scanner.next();
    while (token) {
      if (token.code === 0 && token.value.toUpperCase() === 'ENDSEC') {
        return scanner.next();
      }
      if (token.code === 0 && token.value.toUpperCase() === 'TABLE') {
        const typeToken = scanner.next();
        const tableName = (typeToken && typeToken.code === 2) ? typeToken.value.toUpperCase() : '';
        if (tableName === 'LAYER') {
          token = scanner.next();
          while (token) {
            if (token.code === 0 && token.value.toUpperCase() === 'ENDTAB') {
              token = scanner.next();
              break;
            }
            if (token.code === 0 && token.value.toUpperCase() === 'LAYER') {
              const layerDef = { name: '', colorNumber: 7, lineType: 'CONTINUOUS', flags: 0 };
              token = scanner.next();
              while (token && token.code !== 0) {
                if (token.code === 2) layerDef.name = token.value;
                else if (token.code === 70) layerDef.flags = parseInt(token.value, 10);
                else if (token.code === 62) layerDef.colorNumber = Math.abs(parseInt(token.value, 10));
                else if (token.code === 420) layerDef.trueColor = parseInt(token.value, 10);
                else if (token.code === 6) layerDef.lineType = token.value;
                token = scanner.next();
              }
              if (layerDef.name) {
                layerDef.color = aciToHex(layerDef.colorNumber, layerDef.trueColor);
                layers[layerDef.name] = layerDef;
              }
              continue;
            }
            token = scanner.next();
          }
          continue;
        }
      }
      token = scanner.next();
    }
    return null;
  }

  _parseBlocksSection(scanner, blocks) {
    let token = scanner.next();
    while (token) {
      if (token.code === 0 && token.value.toUpperCase() === 'ENDSEC') {
        return scanner.next();
      }
      if (token.code === 0 && token.value.toUpperCase() === 'BLOCK') {
        const block = { name: '', basePoint: { x: 0, y: 0, z: 0 }, entities: [] };
        token = scanner.next();
        while (token && token.code !== 0) {
          if (token.code === 2) block.name = token.value;
          else if (token.code === 10) block.basePoint.x = parseFloat(token.value);
          else if (token.code === 20) block.basePoint.y = parseFloat(token.value);
          else if (token.code === 30) block.basePoint.z = parseFloat(token.value);
          token = scanner.next();
        }
        while (token) {
          if (token.code === 0 && token.value.toUpperCase() === 'ENDBLK') {
            if (block.name) blocks[block.name] = block;
            token = scanner.next();
            break;
          }
          token = this._parseEntityToken(token, scanner, block.entities, []);
        }
        continue;
      }
      token = scanner.next();
    }
    return null;
  }

  _parseEntitiesSection(scanner, rawEntities, inserts) {
    let token = scanner.next();
    while (token) {
      if (token.code === 0 && token.value.toUpperCase() === 'ENDSEC') {
        return scanner.next();
      }
      if (token.code === 0) {
        token = this._parseEntityToken(token, scanner, rawEntities, inserts);
        continue;
      }
      token = scanner.next();
    }
    return null;
  }

  _parseEntityToken(token, scanner, entitiesList, insertsList) {
    const type = token.value.toUpperCase();

    switch (type) {
      case 'LINE':
        return this._parseLine(scanner, entitiesList);

      case 'LWPOLYLINE':
        return this._parseLwPolyline(scanner, entitiesList);

      case 'POLYLINE':
        return this._parsePolyline(scanner, entitiesList);

      case 'ARC':
        return this._parseArc(scanner, entitiesList);

      case 'CIRCLE':
        return this._parseCircle(scanner, entitiesList);

      case 'ELLIPSE':
        return this._parseEllipse(scanner, entitiesList);

      case 'SPLINE':
        return this._parseSpline(scanner, entitiesList);

      case 'TEXT':
      case 'MTEXT':
        return this._parseText(scanner, type, entitiesList);

      case 'INSERT':
        return this._parseInsert(scanner, insertsList);

      case 'POINT':
        return this._parsePoint(scanner, entitiesList);

      default: {
        let t = scanner.next();
        while (t && t.code !== 0) {
          t = scanner.next();
        }
        return t;
      }
    }
  }

  _parseLine(scanner, list) {
    const line = {
      type: 'LINE',
      layer: '0',
      x1: 0, y1: 0, z1: 0,
      x2: 0, y2: 0, z2: 0,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) line.layer = t.value;
      else if (t.code === 10) line.x1 = parseFloat(t.value);
      else if (t.code === 20) line.y1 = parseFloat(t.value);
      else if (t.code === 30) line.z1 = parseFloat(t.value);
      else if (t.code === 11) line.x2 = parseFloat(t.value);
      else if (t.code === 21) line.y2 = parseFloat(t.value);
      else if (t.code === 31) line.z2 = parseFloat(t.value);
      else if (t.code === 62) line.colorNumber = Math.abs(parseInt(t.value, 10));
      else if (t.code === 420) line.trueColor = parseInt(t.value, 10);
      else if (t.code === 6) line.lineType = t.value;
      t = scanner.next();
    }
    line.start = { x: line.x1, y: line.y1, z: line.z1 };
    line.end = { x: line.x2, y: line.y2, z: line.z2 };
    list.push(line);
    return t;
  }

  _parseLwPolyline(scanner, list) {
    const pl = {
      type: 'LWPOLYLINE',
      layer: '0',
      isClosed: false,
      vertices: [],
      colorNumber: 256
    };
    let currV = null;
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) pl.layer = t.value;
      else if (t.code === 70) pl.isClosed = (parseInt(t.value, 10) & 1) === 1;
      else if (t.code === 62) pl.colorNumber = Math.abs(parseInt(t.value, 10));
      else if (t.code === 420) pl.trueColor = parseInt(t.value, 10);
      else if (t.code === 10) {
        currV = { x: parseFloat(t.value), y: 0, bulge: 0 };
        pl.vertices.push(currV);
      } else if (t.code === 20 && currV) {
        currV.y = parseFloat(t.value);
      } else if (t.code === 42 && currV) {
        currV.bulge = parseFloat(t.value);
      }
      t = scanner.next();
    }
    pl.shape = pl.isClosed;
    list.push(pl);
    return t;
  }

  _parsePolyline(scanner, list) {
    const pl = {
      type: 'POLYLINE',
      layer: '0',
      isClosed: false,
      vertices: [],
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) pl.layer = t.value;
      else if (t.code === 70) pl.isClosed = (parseInt(t.value, 10) & 1) === 1;
      else if (t.code === 62) pl.colorNumber = Math.abs(parseInt(t.value, 10));
      else if (t.code === 420) pl.trueColor = parseInt(t.value, 10);
      t = scanner.next();
    }
    while (t && t.code === 0 && t.value.toUpperCase() === 'VERTEX') {
      const v = { x: 0, y: 0, z: 0, bulge: 0 };
      t = scanner.next();
      while (t && t.code !== 0) {
        if (t.code === 10) v.x = parseFloat(t.value);
        else if (t.code === 20) v.y = parseFloat(t.value);
        else if (t.code === 30) v.z = parseFloat(t.value);
        else if (t.code === 42) v.bulge = parseFloat(t.value);
        t = scanner.next();
      }
      pl.vertices.push(v);
    }
    if (t && t.code === 0 && t.value.toUpperCase() === 'SEQEND') {
      t = scanner.next();
      while (t && t.code !== 0) {
        t = scanner.next();
      }
    }
    pl.shape = pl.isClosed;
    list.push(pl);
    return t;
  }

  _parseArc(scanner, list) {
    const arc = {
      type: 'ARC',
      layer: '0',
      cx: 0, cy: 0, cz: 0,
      r: 0,
      startAngle: 0,
      endAngle: 360,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) arc.layer = t.value;
      else if (t.code === 10) arc.cx = parseFloat(t.value);
      else if (t.code === 20) arc.cy = parseFloat(t.value);
      else if (t.code === 30) arc.cz = parseFloat(t.value);
      else if (t.code === 40) arc.r = parseFloat(t.value);
      else if (t.code === 50) arc.startAngle = parseFloat(t.value);
      else if (t.code === 51) arc.endAngle = parseFloat(t.value);
      else if (t.code === 62) arc.colorNumber = Math.abs(parseInt(t.value, 10));
      else if (t.code === 420) arc.trueColor = parseInt(t.value, 10);
      t = scanner.next();
    }
    arc.center = { x: arc.cx, y: arc.cy, z: arc.cz };
    arc.radius = arc.r;
    list.push(arc);
    return t;
  }

  _parseCircle(scanner, list) {
    const circle = {
      type: 'CIRCLE',
      layer: '0',
      cx: 0, cy: 0, cz: 0,
      r: 0,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) circle.layer = t.value;
      else if (t.code === 10) circle.cx = parseFloat(t.value);
      else if (t.code === 20) circle.cy = parseFloat(t.value);
      else if (t.code === 30) circle.cz = parseFloat(t.value);
      else if (t.code === 40) circle.r = parseFloat(t.value);
      else if (t.code === 62) circle.colorNumber = Math.abs(parseInt(t.value, 10));
      else if (t.code === 420) circle.trueColor = parseInt(t.value, 10);
      t = scanner.next();
    }
    circle.center = { x: circle.cx, y: circle.cy, z: circle.cz };
    circle.radius = circle.r;
    list.push(circle);
    return t;
  }

  _parseEllipse(scanner, list) {
    const el = {
      type: 'ELLIPSE',
      layer: '0',
      cx: 0, cy: 0, cz: 0,
      majorX: 1, majorY: 0, majorZ: 0,
      ratio: 1,
      startParam: 0,
      endParam: Math.PI * 2,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) el.layer = t.value;
      else if (t.code === 10) el.cx = parseFloat(t.value);
      else if (t.code === 20) el.cy = parseFloat(t.value);
      else if (t.code === 30) el.cz = parseFloat(t.value);
      else if (t.code === 11) el.majorX = parseFloat(t.value);
      else if (t.code === 21) el.majorY = parseFloat(t.value);
      else if (t.code === 31) el.majorZ = parseFloat(t.value);
      else if (t.code === 40) el.ratio = parseFloat(t.value);
      else if (t.code === 41) el.startParam = parseFloat(t.value);
      else if (t.code === 42) el.endParam = parseFloat(t.value);
      else if (t.code === 62) el.colorNumber = Math.abs(parseInt(t.value, 10));
      t = scanner.next();
    }
    list.push(el);
    return t;
  }

  _parseSpline(scanner, list) {
    const sp = {
      type: 'SPLINE',
      layer: '0',
      isClosed: false,
      controlPoints: [],
      fitPoints: [],
      colorNumber: 256
    };
    let currCP = null, currFP = null;
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) sp.layer = t.value;
      else if (t.code === 70) sp.isClosed = (parseInt(t.value, 10) & 1) === 1;
      else if (t.code === 10) {
        currCP = { x: parseFloat(t.value), y: 0, z: 0 };
        sp.controlPoints.push(currCP);
      } else if (t.code === 20 && currCP) currCP.y = parseFloat(t.value);
      else if (t.code === 30 && currCP) currCP.z = parseFloat(t.value);
      else if (t.code === 11) {
        currFP = { x: parseFloat(t.value), y: 0, z: 0 };
        sp.fitPoints.push(currFP);
      } else if (t.code === 21 && currFP) currFP.y = parseFloat(t.value);
      else if (t.code === 31 && currFP) currFP.z = parseFloat(t.value);
      t = scanner.next();
    }
    list.push(sp);
    return t;
  }

  _parseText(scanner, type, list) {
    const textEnt = {
      type,
      layer: '0',
      x: 0, y: 0, z: 0,
      height: 2.5,
      text: '',
      rotation: 0,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) textEnt.layer = t.value;
      else if (t.code === 10) textEnt.x = parseFloat(t.value);
      else if (t.code === 20) textEnt.y = parseFloat(t.value);
      else if (t.code === 30) textEnt.z = parseFloat(t.value);
      else if (t.code === 40) textEnt.height = parseFloat(t.value);
      else if (t.code === 1) textEnt.text += t.value;
      else if (t.code === 3) textEnt.text = t.value + textEnt.text;
      else if (t.code === 50) textEnt.rotation = parseFloat(t.value);
      else if (t.code === 62) textEnt.colorNumber = Math.abs(parseInt(t.value, 10));
      t = scanner.next();
    }
    list.push(textEnt);
    return t;
  }

  _parseInsert(scanner, list) {
    const ins = {
      type: 'INSERT',
      layer: '0',
      blockName: '',
      x: 0, y: 0, z: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
      rotation: 0
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) ins.layer = t.value;
      else if (t.code === 2) ins.blockName = t.value;
      else if (t.code === 10) ins.x = parseFloat(t.value);
      else if (t.code === 20) ins.y = parseFloat(t.value);
      else if (t.code === 30) ins.z = parseFloat(t.value);
      else if (t.code === 41) ins.scaleX = parseFloat(t.value);
      else if (t.code === 42) ins.scaleY = parseFloat(t.value);
      else if (t.code === 43) ins.scaleZ = parseFloat(t.value);
      else if (t.code === 50) ins.rotation = parseFloat(t.value);
      t = scanner.next();
    }
    list.push(ins);
    return t;
  }

  _parsePoint(scanner, list) {
    const pt = {
      type: 'POINT',
      layer: '0',
      x: 0, y: 0, z: 0,
      colorNumber: 256
    };
    let t = scanner.next();
    while (t && t.code !== 0) {
      if (t.code === 8) pt.layer = t.value;
      else if (t.code === 10) pt.x = parseFloat(t.value);
      else if (t.code === 20) pt.y = parseFloat(t.value);
      else if (t.code === 30) pt.z = parseFloat(t.value);
      t = scanner.next();
    }
    list.push(pt);
    return t;
  }

  _expandBlockEntities(block, insert) {
    const expanded = [];
    const rad = (insert.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const transformPoint = (x, y) => {
      const rx = (x - block.basePoint.x) * insert.scaleX;
      const ry = (y - block.basePoint.y) * insert.scaleY;
      return {
        x: rx * cos - ry * sin + insert.x,
        y: rx * sin + ry * cos + insert.y
      };
    };

    for (const ent of block.entities) {
      const cloned = JSON.parse(JSON.stringify(ent));
      if (cloned.layer === '0') cloned.layer = insert.layer;

      if (cloned.type === 'LINE') {
        const p1 = transformPoint(cloned.x1, cloned.y1);
        const p2 = transformPoint(cloned.x2, cloned.y2);
        cloned.x1 = p1.x; cloned.y1 = p1.y;
        cloned.x2 = p2.x; cloned.y2 = p2.y;
        cloned.start = { x: p1.x, y: p1.y, z: cloned.z1 };
        cloned.end = { x: p2.x, y: p2.y, z: cloned.z2 };
        expanded.push(cloned);
      } else if (cloned.type === 'LWPOLYLINE' || cloned.type === 'POLYLINE') {
        cloned.vertices = cloned.vertices.map(v => {
          const p = transformPoint(v.x, v.y);
          return { x: p.x, y: p.y, bulge: v.bulge };
        });
        expanded.push(cloned);
      } else if (cloned.type === 'CIRCLE') {
        const c = transformPoint(cloned.cx, cloned.cy);
        cloned.cx = c.x; cloned.cy = c.y;
        cloned.r = cloned.r * Math.abs(insert.scaleX);
        cloned.center = { x: c.x, y: c.y, z: cloned.cz };
        cloned.radius = cloned.r;
        expanded.push(cloned);
      } else if (cloned.type === 'ARC') {
        const c = transformPoint(cloned.cx, cloned.cy);
        cloned.cx = c.x; cloned.cy = c.y;
        cloned.r = cloned.r * Math.abs(insert.scaleX);
        cloned.startAngle = (cloned.startAngle + insert.rotation) % 360;
        cloned.endAngle = (cloned.endAngle + insert.rotation) % 360;
        cloned.center = { x: c.x, y: c.y, z: cloned.cz };
        cloned.radius = cloned.r;
        expanded.push(cloned);
      } else {
        expanded.push(cloned);
      }
    }
    return expanded;
  }

  getNormalizedEntities(parsedData, options = {}) {
    const {
      center = true,
      origin = 'center',
      scaleToMm = true,
      flipY = false
    } = options;

    const bounds = parsedData.bounds;
    const scale = scaleToMm ? parsedData.units.scaleToMm : 1.0;

    let ox = 0, oy = 0;
    if (origin === 'center' || (center && origin !== 'bottom-left' && origin !== 'top-left')) {
      ox = bounds.centerX;
      oy = bounds.centerY;
    } else if (origin === 'bottom-left') {
      ox = bounds.minX;
      oy = bounds.minY;
    } else if (origin === 'top-left') {
      ox = bounds.minX;
      oy = bounds.maxY;
    }

    const ySign = flipY ? -1 : 1;
    const tx = (x) => (x - ox) * scale;
    const ty = (y) => (y - oy) * scale * ySign;

    const normalizedEntities = [];

    for (const ent of parsedData.entities) {
      const clone = JSON.parse(JSON.stringify(ent));

      switch (clone.type) {
        case 'LINE':
          clone.x1 = tx(ent.x1);
          clone.y1 = ty(ent.y1);
          clone.x2 = tx(ent.x2);
          clone.y2 = ty(ent.y2);
          clone.start = { x: clone.x1, y: clone.y1, z: ent.z1 * scale };
          clone.end = { x: clone.x2, y: clone.y2, z: ent.z2 * scale };
          break;

        case 'CIRCLE':
          clone.cx = tx(ent.cx);
          clone.cy = ty(ent.cy);
          clone.r = ent.r * scale;
          clone.center = { x: clone.cx, y: clone.cy, z: ent.cz * scale };
          clone.radius = clone.r;
          break;

        case 'ARC':
          clone.cx = tx(ent.cx);
          clone.cy = ty(ent.cy);
          clone.r = ent.r * scale;
          clone.center = { x: clone.cx, y: clone.cy, z: ent.cz * scale };
          clone.radius = clone.r;
          if (flipY) {
            clone.startAngle = ((360 - ent.endAngle) % 360 + 360) % 360;
            clone.endAngle = ((360 - ent.startAngle) % 360 + 360) % 360;
          }
          break;

        case 'LWPOLYLINE':
        case 'POLYLINE':
          clone.vertices = (ent.vertices || []).map(v => ({
            x: tx(v.x),
            y: ty(v.y),
            bulge: flipY ? -v.bulge : v.bulge
          }));
          break;

        case 'TEXT':
        case 'MTEXT':
          clone.x = tx(ent.x);
          clone.y = ty(ent.y);
          clone.height = ent.height * scale;
          break;
      }

      clone.bounds = getEntityBounds(clone);
      normalizedEntities.push(clone);
    }

    const normBounds = computeBounds(normalizedEntities);

    return {
      bounds: normBounds,
      widthMm: normBounds.width,
      heightMm: normBounds.height,
      entities: normalizedEntities
    };
  }

  toNormalizedUV(parsedData, options = {}) {
    const { marginRatio = 0.05, flipY = true } = options;
    const b = parsedData.bounds;
    const maxDim = Math.max(b.width, b.height) || 1;
    const paddedDim = maxDim * (1 + 2 * marginRatio);

    const uvEntities = [];
    for (const ent of parsedData.entities) {
      const u = (x) => (x - (b.centerX - paddedDim / 2)) / paddedDim;
      const v = (y) => {
        const norm = (y - (b.centerY - paddedDim / 2)) / paddedDim;
        return flipY ? (1.0 - norm) : norm;
      };

      const clone = JSON.parse(JSON.stringify(ent));
      if (clone.type === 'LINE') {
        clone.u1 = u(ent.x1); clone.v1 = v(ent.y1);
        clone.u2 = u(ent.x2); clone.v2 = v(ent.y2);
      } else if (clone.vertices) {
        clone.uvVertices = clone.vertices.map(pt => ({
          u: u(pt.x),
          v: v(pt.y),
          bulge: flipY ? -pt.bulge : pt.bulge
        }));
      }
      uvEntities.push(clone);
    }

    return {
      marginRatio,
      uvEntities
    };
  }
}


// ----------------------------------------------------------------------------
// 7. Canvas 2D 路径绘制与 SVG 导出引擎
// ----------------------------------------------------------------------------

function renderDxfToCanvas(parsedData, ctx, options = {}) {
  if (!ctx) throw new Error('renderDxfToCanvas: ctx is required');

  const width = options.width || (ctx.canvas ? ctx.canvas.width : 800);
  const height = options.height || (ctx.canvas ? ctx.canvas.height : 600);
  const padding = options.padding !== undefined ? options.padding : 24;
  const flipY = options.flipY !== undefined ? options.flipY : true;

  const showCut = options.showCut !== undefined ? options.showCut : true;
  const showCrease = options.showCrease !== undefined ? options.showCrease : true;
  const showAnnotation = options.showAnnotation !== undefined ? options.showAnnotation : true;
  const showOther = options.showOther !== undefined ? options.showOther : true;

  const b = parsedData.bounds;
  const bw = b.width || 1;
  const bh = b.height || 1;

  const availW = Math.max(10, width - 2 * padding);
  const availH = Math.max(10, height - 2 * padding);
  const scale = Math.min(availW / bw, availH / bh);

  const toScreen = (x, y) => {
    const sx = (x - b.centerX) * scale + width / 2;
    const sy = flipY
      ? -(y - b.centerY) * scale + height / 2
      : (y - b.centerY) * scale + height / 2;
    return { x: sx, y: sy };
  };

  const defaultStyles = {
    cut: { strokeStyle: DEFAULT_CLASSIFICATION_COLORS.cut, lineWidth: 1.6, lineDash: [] },
    crease: { strokeStyle: DEFAULT_CLASSIFICATION_COLORS.crease, lineWidth: 1.2, lineDash: [6, 4] },
    annotation: { strokeStyle: DEFAULT_CLASSIFICATION_COLORS.annotation, lineWidth: 0.8, lineDash: [] },
    other: { strokeStyle: DEFAULT_CLASSIFICATION_COLORS.other, lineWidth: 1.0, lineDash: [] }
  };
  const activeStyles = { ...defaultStyles, ...(options.styles || {}) };

  const passList = [
    { key: 'annotation', show: showAnnotation },
    { key: 'other', show: showOther },
    { key: 'crease', show: showCrease },
    { key: 'cut', show: showCut }
  ];

  for (const { key, show } of passList) {
    if (!show) continue;
    const ents = parsedData.classified[key] || [];
    if (ents.length === 0) continue;

    const style = activeStyles[key] || defaultStyles[key];

    ctx.save();
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;
    if (ctx.setLineDash && style.lineDash) {
      ctx.setLineDash(style.lineDash);
    }
    ctx.beginPath();

    for (const ent of ents) {
      _drawEntityToCanvasPath(ctx, ent, toScreen, scale);
    }

    ctx.stroke();
    ctx.restore();
  }
}

function _drawEntityToCanvasPath(ctx, entity, toScreen, scale) {
  switch (entity.type) {
    case 'LINE': {
      const p1 = toScreen(entity.x1, entity.y1);
      const p2 = toScreen(entity.x2, entity.y2);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      break;
    }

    case 'CIRCLE': {
      const c = toScreen(entity.cx, entity.cy);
      ctx.moveTo(c.x + entity.r * scale, c.y);
      ctx.arc(c.x, c.y, entity.r * scale, 0, Math.PI * 2);
      break;
    }

    case 'ARC': {
      const pts = sampleArcPoints(entity.cx, entity.cy, entity.r, entity.startAngle, entity.endAngle, 24);
      if (pts.length > 0) {
        const p0 = toScreen(pts[0].x, pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
          const pi = toScreen(pts[i].x, pts[i].y);
          ctx.lineTo(pi.x, pi.y);
        }
      }
      break;
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = entity.vertices || [];
      const len = verts.length;
      if (len < 2) break;
      const segCount = entity.isClosed ? len : len - 1;
      let isFirst = true;

      for (let i = 0; i < segCount; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % len];
        if (v1.bulge && Math.abs(v1.bulge) > 1e-6) {
          const pts = bulgeToPoints(v1, v2, v1.bulge, 16);
          for (let j = 0; j < pts.length; j++) {
            const sp = toScreen(pts[j].x, pts[j].y);
            if (isFirst && j === 0) {
              ctx.moveTo(sp.x, sp.y);
              isFirst = false;
            } else {
              ctx.lineTo(sp.x, sp.y);
            }
          }
        } else {
          const sp1 = toScreen(v1.x, v1.y);
          const sp2 = toScreen(v2.x, v2.y);
          if (isFirst) {
            ctx.moveTo(sp1.x, sp1.y);
            isFirst = false;
          }
          ctx.lineTo(sp2.x, sp2.y);
        }
      }
      if (entity.isClosed) {
        ctx.closePath();
      }
      break;
    }
  }
}

function dxfToSvg(parsedData, options = {}) {
  const {
    margin = 15,
    strokeScale = 1.0,
    includeHeader = true
  } = options;

  const b = parsedData.bounds;
  const minX = b.minX - margin;
  const minY = b.minY - margin;
  const width = b.width + 2 * margin;
  const height = b.height + 2 * margin;

  const lines = [];

  if (includeHeader) {
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  }
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm">`);
  lines.push(`  <title>PrintGuard CAD Dieline - DXF Reverse Engineered</title>`);
  lines.push(`  <desc>Units: ${parsedData.units.name}, Scale: 1mm</desc>`);

  const groups = [
    { id: 'ANNOTATION', cls: 'annotation', color: DEFAULT_CLASSIFICATION_COLORS.annotation, dash: '', width: 0.6 },
    { id: 'GUIDE', cls: 'guide', color: DEFAULT_CLASSIFICATION_COLORS.guide, dash: '2,2', width: 0.6 },
    { id: 'BLEED', cls: 'bleed', color: DEFAULT_CLASSIFICATION_COLORS.bleed, dash: '4,4', width: 0.8 },
    { id: 'CREASE', cls: 'crease', color: DEFAULT_CLASSIFICATION_COLORS.crease, dash: '5,4', width: 1.2 },
    { id: 'CUT_CONTOUR', cls: 'cut', color: DEFAULT_CLASSIFICATION_COLORS.cut, dash: '', width: 1.5 },
    { id: 'OTHER', cls: 'other', color: DEFAULT_CLASSIFICATION_COLORS.other, dash: '', width: 0.8 }
  ];

  for (const grp of groups) {
    const ents = parsedData.classified[grp.cls] || [];
    if (ents.length === 0) continue;

    const dashAttr = grp.dash ? ` stroke-dasharray="${grp.dash}"` : '';
    const w = (grp.width * strokeScale).toFixed(2);
    lines.push(`  <g id="${grp.id}" stroke="${grp.color}" stroke-width="${w}" fill="none"${dashAttr}>`);

    for (const ent of ents) {
      if (ent.type === 'LINE') {
        lines.push(`    <line x1="${ent.x1.toFixed(3)}" y1="${ent.y1.toFixed(3)}" x2="${ent.x2.toFixed(3)}" y2="${ent.y2.toFixed(3)}" />`);
      } else if (ent.type === 'CIRCLE') {
        lines.push(`    <circle cx="${ent.cx.toFixed(3)}" cy="${ent.cy.toFixed(3)}" r="${ent.r.toFixed(3)}" />`);
      } else if (ent.type === 'ARC') {
        const pts = sampleArcPoints(ent.cx, ent.cy, ent.r, ent.startAngle, ent.endAngle, 20);
        if (pts.length > 1) {
          const d = 'M ' + pts.map(p => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' L ');
          lines.push(`    <path d="${d}" />`);
        }
      } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
        const verts = ent.vertices || [];
        if (verts.length >= 2) {
          const pathSegments = [];
          const len = verts.length;
          const segCount = ent.isClosed ? len : len - 1;

          for (let i = 0; i < segCount; i++) {
            const v1 = verts[i];
            const v2 = verts[(i + 1) % len];
            if (v1.bulge && Math.abs(v1.bulge) > 1e-6) {
              const pts = bulgeToPoints(v1, v2, v1.bulge, 16);
              if (i === 0) pathSegments.push(`M ${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`);
              for (let j = 1; j < pts.length; j++) {
                pathSegments.push(`L ${pts[j].x.toFixed(3)} ${pts[j].y.toFixed(3)}`);
              }
            } else {
              if (i === 0) pathSegments.push(`M ${v1.x.toFixed(3)} ${v1.y.toFixed(3)}`);
              pathSegments.push(`L ${v2.x.toFixed(3)} ${v2.y.toFixed(3)}`);
            }
          }
          if (ent.isClosed) pathSegments.push('Z');
          lines.push(`    <path d="${pathSegments.join(' ')}" />`);
        }
      }
    }

    lines.push(`  </g>`);
  }

  lines.push(`</svg>`);
  return lines.join('\n');
}


// ----------------------------------------------------------------------------
// 8. 统一入口与公共 API
// ----------------------------------------------------------------------------

function parseDxfString(dxfText, options = {}) {
  const parser = new DxfParser(options);
  return parser.parse(dxfText);
}


// ----------------------------------------------------------------------------
// 9. 模块导出
// ----------------------------------------------------------------------------

const ModuleExports = {
  parseDxfString,
  DxfParser,
  classifyLayer,
  computeBounds,
  getEntityBounds,
  getArcBounds,
  bulgeToArcInfo,
  bulgeToPoints,
  sampleArcPoints,
  renderDxfToCanvas,
  dxfToSvg,
  aciToHex,
  ACI_COLORS,
  DEFAULT_CLASSIFICATION_COLORS,
  DXF_INSUNITS
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModuleExports;
}

if (typeof window !== 'undefined') {
  window.PrintGuardDxf = ModuleExports;
}


// ----------------------------------------------------------------------------
// 10. 全功能自动化自测验证套件 (Test Suite)
// ----------------------------------------------------------------------------

if (typeof require !== 'undefined' && require.main === module) {
  console.log('================================================================');
  console.log('   PrintGuard Pro - Native DXF Engine 单元与集成测试套件');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    } else {
      console.log(`  ✓ [PASS] ${message}`);
      passedTests++;
    }
  }

  // --------------------------------------------------------------------------
  // 测试用例 1: 基础图层分类器测试
  // --------------------------------------------------------------------------
  console.log('[Suite 1: 图层智能分类引擎测试]');
  assert(classifyLayer('CUT_CONTOUR') === 'cut', 'CUT_CONTOUR 应分类为 cut');
  assert(classifyLayer('Cut') === 'cut', 'Cut 应分类为 cut (不区分大小写)');
  assert(classifyLayer('DIE') === 'cut', 'DIE 应分类为 cut');
  assert(classifyLayer('THRU_CUTTING') === 'cut', 'THRU_CUTTING 应分类为 cut');
  assert(classifyLayer('KNIFE_BLADE') === 'cut', 'KNIFE_BLADE 应分类为 cut');
  assert(classifyLayer('CREASE') === 'crease', 'CREASE 应分类为 crease');
  assert(classifyLayer('FOLD_SCORE') === 'crease', 'FOLD_SCORE 应分类为 crease');
  assert(classifyLayer('PERFORATION_LINE') === 'crease', 'PERFORATION_LINE 应分类为 crease');
  assert(classifyLayer('DIE_CREASE') === 'crease', 'DIE_CREASE 应正确优先归类为 crease');
  assert(classifyLayer('DIMENSIONS') === 'annotation', 'DIMENSIONS 应分类为 annotation');
  assert(classifyLayer('ANNOTATION_NOTES') === 'annotation', 'ANNOTATION_NOTES 应分类为 annotation');
  assert(classifyLayer('BLEED_MARGIN') === 'bleed', 'BLEED_MARGIN 应分类为 bleed');
  assert(classifyLayer('GUIDES') === 'guide', 'GUIDES 应分类为 guide');
  assert(classifyLayer('0') === 'other', '0 图层应分类为 other');

  // --------------------------------------------------------------------------
  // 测试用例 2: Bulge 凸度圆弧几何反解测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 2: Bulge 凸度几何数学精确度测试]');
  const bQuarter = Math.SQRT2 - 1;
  const arcInfo = bulgeToArcInfo({ x: 10, y: 0 }, { x: 0, y: 10 }, bQuarter);
  assert(arcInfo !== null, 'Bulge 圆弧应成功反解');
  assert(Math.abs(arcInfo.cx - 0) < 1e-4, '圆心 X 应为 0');
  assert(Math.abs(arcInfo.cy - 0) < 1e-4, '圆心 Y 应为 0');
  assert(Math.abs(arcInfo.r - 10) < 1e-4, '半径 R 应为 10');
  assert(Math.abs(arcInfo.startAngle - 0) < 1e-4, '起始角应为 0°');
  assert(Math.abs(arcInfo.endAngle - 90) < 1e-4, '终止角应为 90°');
  assert(arcInfo.isCCW === true, '应为逆时针方向');

  const pts = bulgeToPoints({ x: 10, y: 0 }, { x: 0, y: 10 }, bQuarter, 8);
  assert(pts.length >= 5, '凸度采样点数应合理');
  assert(Math.abs(pts[0].x - 10) < 1e-4 && Math.abs(pts[0].y - 0) < 1e-4, '首点严格吻合起点');
  assert(Math.abs(pts[pts.length - 1].x - 0) < 1e-4 && Math.abs(pts[pts.length - 1].y - 10) < 1e-4, '末点严格吻合终点');

  // --------------------------------------------------------------------------
  // 测试用例 3: 严谨四象限圆弧包围盒测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 3: 严谨圆弧与极值点包围盒计算测试]');
  const abCross0 = getArcBounds(0, 0, 10, 330, 30);
  assert(Math.abs(abCross0.maxX - 10) < 1e-4, '跨越 0° 极值角时 maxX 应达到 10');
  assert(abCross0.minX > 8.0, 'minX 应接近 10*cos(30°) ≈ 8.66');
  assert(Math.abs(abCross0.maxY - 5) < 1e-4, 'maxY 应为 10*sin(30°) = 5');
  assert(Math.abs(abCross0.minY - (-5)) < 1e-4, 'minY 应为 10*sin(330°) = -5');

  // --------------------------------------------------------------------------
  // 测试用例 4: AutoCAD R12 标准折叠纸盒刀模 DXF 解析
  // --------------------------------------------------------------------------
  console.log('\n[Suite 4: AutoCAD R12 DXF 包装刀模综合实测]');
  const mockR12Dxf = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1009
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
CUT_CONTOUR
70
0
62
6
6
CONTINUOUS
0
LAYER
2
CREASE
70
0
62
4
6
DASHED
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
CUT_CONTOUR
10
0.000
20
0.000
30
0.0
11
200.000
21
0.000
31
0.0
0
LINE
8
CUT_CONTOUR
10
200.000
20
0.000
30
0.0
11
200.000
21
150.000
31
0.0
0
LINE
8
CUT_CONTOUR
10
200.000
20
150.000
30
0.0
11
0.000
21
150.000
31
0.0
0
LINE
8
CUT_CONTOUR
10
0.000
20
150.000
30
0.0
11
0.000
21
0.000
31
0.0
0
LINE
8
CREASE
10
50.000
20
0.000
30
0.0
11
50.000
21
150.000
31
0.0
0
LINE
8
CREASE
10
100.000
20
0.000
30
0.0
11
100.000
21
150.000
31
0.0
0
ENDSEC
0
EOF`;

  const parsedR12 = parseDxfString(mockR12Dxf);
  assert(parsedR12.version === 'AC1009', '应正确提取 AutoCAD R12 版本标识');
  assert(parsedR12.units.scaleToMm === 1.0, '$INSUNITS=4 对应毫米，换算系数应为 1.0');
  assert(parsedR12.entities.length === 6, '实体总数应为 6 条线段');
  assert(parsedR12.classified.cut.length === 4, '应智能识别 4 条裁切刀线');
  assert(parsedR12.classified.crease.length === 2, '应智能识别 2 条压痕折线');
  assert(parsedR12.bounds.width === 200, '刀模整体宽度应为 200mm');
  assert(parsedR12.bounds.height === 150, '刀模整体高度应为 150mm');
  assert(parsedR12.bounds.centerX === 100, '刀模中心 X 应为 100mm');
  assert(parsedR12.bounds.centerY === 75, '刀模中心 Y 应为 75mm');

  const normalized = parsedR12.getNormalizedEntities({ center: true });
  assert(normalized.bounds.centerX === 0, '归一化后中心 X 应位于 0');
  assert(normalized.bounds.centerY === 0, '归一化后中心 Y 应位于 0');
  assert(normalized.bounds.minX === -100, '归一化后 minX 应为 -100');
  assert(normalized.bounds.maxX === 100, '归一化后 maxX 应为 100');
  assert(normalized.bounds.minY === -75, '归一化后 minY 应为 -75');
  assert(normalized.bounds.maxY === 75, '归一化后 maxY 应为 75');

  // --------------------------------------------------------------------------
  // 测试用例 5: ArtiosCAD 风格包含 LWPOLYLINE 与 ARC/CIRCLE 测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 5: ArtiosCAD 复杂曲线刀模 (LWPOLYLINE/Bulge/ARC/CIRCLE) 测试]');
  const mockArtiosDxf = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1015
9
$INSUNITS
70
1
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
DIE_CUT
90
4
70
1
10
0.0
20
0.0
42
0.0
10
10.0
20
0.0
42
0.41421356
10
10.0
20
5.0
42
0.0
10
0.0
20
5.0
42
0.0
0
ARC
8
THRU_CUT
10
5.0
20
5.0
40
2.0
50
0.0
51
180.0
0
CIRCLE
8
ANNOTATION_HOLE
10
2.0
20
2.0
40
0.5
0
POLYLINE
8
CREASE_FOLD
70
0
0
VERTEX
10
3.0
20
0.0
0
VERTEX
10
3.0
20
5.0
0
SEQEND
0
ENDSEC
0
EOF`;

  const parsedArtios = parseDxfString(mockArtiosDxf);
  assert(parsedArtios.units.scaleToMm === 25.4, '$INSUNITS=1 (Inches) 应自动映射为 25.4mm 缩放系数');
  assert(parsedArtios.classified.cut.length === 2, 'DIE_CUT 和 THRU_CUT 应正确归入 cut');
  assert(parsedArtios.classified.crease.length === 1, 'CREASE_FOLD POLYLINE 应正确归入 crease');
  assert(parsedArtios.classified.annotation.length === 1, 'ANNOTATION_HOLE CIRCLE 应正确归入 annotation');

  const mmModel = parsedArtios.getNormalizedEntities({ scaleToMm: true });
  assert(Math.abs(mmModel.widthMm - 280.30) < 1.0, '宽度应按物理尺度转换为约 280.30mm (含Bulge凸度包围盒扩展, 实际: ' + mmModel.widthMm.toFixed(2) + ')');
  assert(Math.abs(mmModel.widthMm - 280.30) < 0.5, `宽度应精确包含 Bulge 凸起弧极值点物理尺度约 280.3mm (实际: ${mmModel.widthMm.toFixed(2)})`);

  // --------------------------------------------------------------------------
  // 测试用例 6: 图块展开 (BLOCKS & INSERT) 逆向解析测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 6: 图块引用展开 (BLOCK & INSERT) 测试]');
  const mockBlockDxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
PUNCH_HOLE
10
0.0
20
0.0
30
0.0
0
CIRCLE
8
0
10
0.0
20
0.0
40
5.0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
2
PUNCH_HOLE
8
CUT_HOLES
10
100.0
20
50.0
41
1.0
42
1.0
50
0.0
0
ENDSEC
0
EOF`;

  const parsedBlock = parseDxfString(mockBlockDxf);
  assert(parsedBlock.entities.length === 1, 'INSERT 应被展开为实际几何实体');
  assert(parsedBlock.entities[0].type === 'CIRCLE', '展开后实体应为 CIRCLE');
  assert(parsedBlock.entities[0].cx === 100 && parsedBlock.entities[0].cy === 50, '圆心坐标应准确叠加 INSERT 平移向量 (100, 50)');
  assert(parsedBlock.entities[0].layer === 'CUT_HOLES', '继承 INSERT 图层名称 CUT_HOLES');
  assert(parsedBlock.entities[0].classification === 'cut', '分类应继承为 cut');

  // --------------------------------------------------------------------------
  // 测试用例 7: SVG 导出与 Mock Canvas 2D 路径渲染测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 7: 导出管道 (SVG 生成与 Canvas 2D 绘制) 测试]');
  const svgOut = parsedR12.toSvg();
  assert(typeof svgOut === 'string' && svgOut.includes('<svg'), 'SVG 导出应输出有效 XML 文本');
  assert(svgOut.includes('id="CUT_CONTOUR"'), 'SVG 应包含 CUT_CONTOUR 分组');
  assert(svgOut.includes('id="CREASE"'), 'SVG 应包含 CREASE 分组');

  const mockCalls = [];
  const mockCtx = {
    canvas: { width: 800, height: 600 },
    save: () => mockCalls.push('save'),
    restore: () => mockCalls.push('restore'),
    beginPath: () => mockCalls.push('beginPath'),
    moveTo: (x, y) => mockCalls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`),
    lineTo: (x, y) => mockCalls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`),
    stroke: () => mockCalls.push('stroke'),
    setLineDash: (arr) => mockCalls.push(`setLineDash(${arr.join(',')})`),
    strokeStyle: '',
    lineWidth: 1
  };

  parsedR12.renderToCanvas(mockCtx);
  assert(mockCalls.includes('save'), 'Canvas 渲染应调用 save');
  assert(mockCalls.includes('restore'), 'Canvas 渲染应调用 restore');
  assert(mockCalls.includes('beginPath'), 'Canvas 渲染应调用 beginPath');
  assert(mockCalls.includes('stroke'), 'Canvas 渲染应执行绘制 stroke');
  assert(mockCalls.some(c => c.startsWith('setLineDash(6,4)')), '压痕折线应设置对应虚线样式');

  // --------------------------------------------------------------------------
  // 测试用例 8: 3D UV 空间归一化测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 8: 3D UV 空间归一化测试]');
  const uvResult = parsedR12.toNormalizedUV();
  assert(uvResult.uvEntities.length === 6, 'UV 映射实体应全部包含');
  for (const ent of uvResult.uvEntities) {
    if (ent.type === 'LINE') {
      assert(ent.u1 >= 0 && ent.u1 <= 1, 'U 坐标应在 [0, 1] 范围内');
      assert(ent.v1 >= 0 && ent.v1 <= 1, 'V 坐标应在 [0, 1] 范围内');
    }
  }

  // --------------------------------------------------------------------------
  // 测试用例 9: 异常容错与空文本鲁棒性测试
  // --------------------------------------------------------------------------
  console.log('\n[Suite 9: 异常输入容错鲁棒性测试]');
  const emptyParsed = parseDxfString('');
  assert(emptyParsed.entities.length === 0, '空文本解析不应抛错，实体数为 0');
  assert(emptyParsed.bounds.width === 0, '空文本包围盒安全兜底为 0');

  const dirtyDxf = `999\nRandomComment\n0\nUNKNOWN_TYPE\n8\nLAYER_X\n0\nLINE\n8\nCUT\n10\n10\n20\n20\n11\n30\n21\n40\n0\nEOF`;
  const dirtyParsed = parseDxfString(dirtyDxf);
  assert(dirtyParsed.entities.length === 1, '跳过未知实体并成功解析有效实体');
  assert(dirtyParsed.entities[0].type === 'LINE', '成功提取有效 LINE');

  console.log('\n================================================================');
  console.log(`🎉 全部测试执行完毕: ${passedTests}/${totalTests} 通过 (100% PASS)`);
  console.log('================================================================');
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
