/**
 * ============================================================================
 * PrintGuard Pro - 2D CAD Digital Caliper & Die-Cutting Kerf Engineering Engine
 * 交互式数显电子卡尺与模切刀缝/压痕工艺计算引擎
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PrintGuardCaliperEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 1. 统一物理尺度转换因子计算器 (消除不同盒型间的 Magic Numbers 比例失真)
  function getScaleFactor(presetName) {
    if (presetName === 'fefco0427' || presetName === 'rigid_box' || presetName === 'custom_dxf') {
      return 1.0; // 现代参数化模块与 DXF 均以严格 1:1 mm 物理尺寸设计
    }
    // 早期管式盒型设计基准 (1mm ≈ 1/0.65 px)
    return 0.65;
  }

  // 2. 模切刀缝与压痕深度理论工程计算器
  const DieCuttingKerfEngine = {
    BLADE_SPECS: {
      '1.5pt': { pt: 1.5, mm: 0.53, desc: '1.5pt (0.53mm) 极细刀线 - 标签/超薄卡纸' },
      '2.0pt': { pt: 2.0, mm: 0.71, desc: '2.0pt (0.71mm) 标准模切刀 - 经典纸盒与E瓦楞' },
      '3.0pt': { pt: 3.0, mm: 1.07, desc: '3.0pt (1.07mm) 重型压痕线 - B/C瓦楞防爆线' },
      '4.0pt': { pt: 4.0, mm: 1.42, desc: '4.0pt (1.42mm) 工业特重线 - 蜂窝板/五层瓦楞' }
    },

    /**
     * 计算模切刀缝补偿与压痕模规格
     * @param {object} params
     * @param {number} params.caliperMm - 纸张/纸板厚度 (mm)
     * @param {string} params.bladePtKey - '2.0pt' | '3.0pt' 等
     * @param {string} params.materialType - 'cardboard' (卡纸) | 'corrugated' (瓦楞) | 'greyboard' (灰板)
     * @param {number} [params.laserBeamMm=0.20] - 激光聚焦光斑直径 (mm)
     */
    calculateSpecs(params) {
      const caliper = parseFloat(params.caliperMm) || 0.45;
      const bladeKey = params.bladePtKey || '2.0pt';
      const blade = this.BLADE_SPECS[bladeKey] || this.BLADE_SPECS['2.0pt'];
      const matType = params.materialType || 'cardboard';
      const laserBeam = parseFloat(params.laserBeamMm) || 0.20;

      // 1. 激光切割机木模板割缝参数 (木模板割缝比刀身宽 0.01mm 产生过盈配合紧密夹持)
      const targetKerfWidth = blade.mm + 0.01;
      const camOffset = (targetKerfWidth - laserBeam) / 2.0;

      // 2. 压痕底模 (Creasing Matrix) 槽宽与槽深
      let matrixDepth = 0;
      let matrixWidth = 0;
      let bendDeduction = 0;

      if (matType === 'corrugated') {
        matrixDepth = caliper * 0.55; // 瓦楞受力预压实深度
        matrixWidth = 2.0 * caliper + blade.mm;
        bendDeduction = caliper * 1.0; // 90° 弯曲扣减
      } else if (matType === 'greyboard') {
        matrixDepth = caliper * 0.90; // V-Groove 开槽深度
        matrixWidth = caliper * 1.414; // 90° V槽开口宽
        bendDeduction = caliper * 0.5;
      } else {
        // 卡纸标准 CITO 公式
        matrixDepth = caliper;
        matrixWidth = 1.3 * caliper + blade.mm;
        bendDeduction = caliper * 0.45;
      }

      return {
        bladeThickMm: blade.mm,
        targetKerfMm: Number(targetKerfWidth.toFixed(3)),
        camBeamOffsetMm: Number(camOffset.toFixed(3)),
        matrixDepthMm: Number(matrixDepth.toFixed(2)),
        matrixWidthMm: Number(matrixWidth.toFixed(2)),
        bendDeductionMm: Number(bendDeduction.toFixed(2)),
        recommendation: `推荐规格: 槽深 ${matrixDepth.toFixed(2)}mm × 槽宽 ${matrixWidth.toFixed(2)}mm (CITO/Channel 工业压痕条)`
      };
    }
  };

  // 3. 工业级交互式数显电子卡尺模块 (Interactive CAD Digital Caliper)
  class CadDigitalCaliper {
    constructor(canvas, stateRef, getDimensionsFn, onRepaintFn, onChangeFn) {
      this.canvas = canvas;
      this.state = stateRef;
      this.getDimensions = getDimensionsFn;
      this.repaint = onRepaintFn;
      this.onChange = onChangeFn;

      this.isActive = false;      // 是否激活测距工具
      this.isMeasuring = false;   // 正在拉线
      this.startPt = null;        // { screenX, screenY, worldX, worldY, mmX, mmY }
      this.endPt = null;          // 当前测量终点
      this.fixedRecords = [];     // 固化的测量标注 [{ p1, p2, dist, dx, dy, note, hudBounds }]
      this.maxRecords = 3;        // 最多保留3条对比记录

      this._bindEvents();
    }

    toggle(forceState) {
      this.isActive = (forceState !== undefined) ? forceState : !this.isActive;
      this.canvas.style.cursor = this.isActive ? 'crosshair' : '';
      if (!this.isActive) {
        this.isMeasuring = false;
      }
      this.repaint();
      this._notifyChange();
      return this.isActive;
    }

    clear() {
      const hadRecords = this.fixedRecords.length > 0;
      this.fixedRecords = [];
      this.startPt = null;
      this.endPt = null;
      this.isMeasuring = false;
      this.repaint();
      this._notifyChange();
      return hadRecords;
    }

    removeAt(index) {
      if (index >= 0 && index < this.fixedRecords.length) {
        this.fixedRecords.splice(index, 1);
        this.repaint();
        this._notifyChange();
        return true;
      }
      return false;
    }

    removeLast() {
      if (this.fixedRecords.length > 0) {
        this.fixedRecords.shift();
        this.repaint();
        this._notifyChange();
        return true;
      }
      return false;
    }

    _notifyChange() {
      if (typeof this.onChange === 'function') {
        this.onChange(this.fixedRecords.length, this.isActive);
      }
    }

    // 屏幕像素坐标转工作台毫米物理坐标
    screenToPhysicalMm(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const worldPxX = (clientX - rect.left - rect.width / 2 - this.state.pan.x) / this.state.zoom;
      const worldPxY = (clientY - rect.top - rect.height / 2 - this.state.pan.y) / this.state.zoom;
      const scale = getScaleFactor(this.state.preset);
      return {
        screenX: clientX - rect.left,
        screenY: clientY - rect.top,
        worldX: worldPxX,
        worldY: worldPxY,
        mmX: worldPxX * scale,
        mmY: worldPxY * scale
      };
    }

    _bindEvents() {
      this.canvas.addEventListener('mousedown', (e) => {
        // 1. 优先检测是否点击了已有测距标注的 HUD 卡片/删除按钮 [✕]
        if (this.fixedRecords.length > 0 && e.button === 0) {
          const pt = this.screenToPhysicalMm(e.clientX, e.clientY);
          for (let i = 0; i < this.fixedRecords.length; i++) {
            const b = this.fixedRecords[i].hudBounds;
            if (b && pt.worldX >= b.minX && pt.worldX <= b.maxX &&
                pt.worldY >= b.minY && pt.worldY <= b.maxY) {
              e.stopPropagation();
              e.preventDefault();
              this.removeAt(i);
              return;
            }
          }
        }

        if (!this.isActive || e.button !== 0) return;
        e.stopPropagation();

        const pt = this.screenToPhysicalMm(e.clientX, e.clientY);
        this.startPt = pt;
        this.endPt = pt;
        this.isMeasuring = true;
        this.repaint();
      }, true);

      const win = typeof window !== 'undefined' ? window : null;

      if (win) {
        win.addEventListener('mousemove', (e) => {
          if (!this.isActive || !this.isMeasuring || !this.startPt) return;

          let curPt = this.screenToPhysicalMm(e.clientX, e.clientY);
          // 按住 Shift 键进行 0°/90°/45° 正交捕捉
          if (e.shiftKey) {
            const dx = Math.abs(curPt.worldX - this.startPt.worldX);
            const dy = Math.abs(curPt.worldY - this.startPt.worldY);
            if (dx > dy * 2) {
              curPt.worldY = this.startPt.worldY;
              curPt.mmY = this.startPt.mmY;
            } else if (dy > dx * 2) {
              curPt.worldX = this.startPt.worldX;
              curPt.mmX = this.startPt.mmX;
            }
          }
          this.endPt = curPt;
          this.repaint();
        }, true);

        win.addEventListener('mouseup', (e) => {
          if (!this.isActive || !this.isMeasuring) return;
          this.isMeasuring = false;

          if (this.startPt && this.endPt) {
            const dx = Math.abs(this.endPt.mmX - this.startPt.mmX);
            const dy = Math.abs(this.endPt.mmY - this.startPt.mmY);
            const dist = Math.hypot(dx, dy);

            // 仅记录移动超过 0.5mm 的有效测距
            if (dist >= 0.5) {
              const evalNote = this.evaluateTolerance(dx, dy, dist);
              this.fixedRecords.unshift({
                p1: { ...this.startPt },
                p2: { ...this.endPt },
                dx, dy, dist,
                note: evalNote,
                timestamp: Date.now()
              });
              if (this.fixedRecords.length > this.maxRecords) {
                this.fixedRecords.pop();
              }
              this._notifyChange();
            }
          }
          this.repaint();
        }, true);
      }

      // 双击画布快速清除当前所有卡尺标注（无论卡尺激活与否均生效）
      this.canvas.addEventListener('dblclick', (e) => {
        if (this.fixedRecords.length > 0 || this.isActive) {
          e.stopPropagation();
          this.clear();
        }
      });

      // 右键取消正在拉线或撤销上一条标注
      this.canvas.addEventListener('contextmenu', (e) => {
        if (this.isActive && (this.isMeasuring || this.fixedRecords.length > 0)) {
          e.preventDefault();
          e.stopPropagation();
          if (this.isMeasuring) {
            this.isMeasuring = false;
            this.startPt = null;
            this.endPt = null;
            this.repaint();
          } else {
            this.removeLast();
          }
        }
      });

      // 键盘快捷键监听：Delete / Backspace 撤销删除，Escape 取消
      if (win) {
        win.addEventListener('keydown', (e) => {
          if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;

          if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.fixedRecords.length > 0) {
              e.preventDefault();
              if (e.shiftKey) {
                this.clear();
              } else {
                this.removeLast();
              }
            }
          } else if (e.key === 'Escape') {
            if (this.isMeasuring) {
              e.preventDefault();
              this.isMeasuring = false;
              this.startPt = null;
              this.endPt = null;
              this.repaint();
            } else if (this.fixedRecords.length > 0 && this.isActive) {
              e.preventDefault();
              this.clear();
            }
          }
        });
      }
    }

    // 智能印前容差匹配评估
    evaluateTolerance(dx, dy, dist) {
      if (dist >= 2.8 && dist <= 3.2) return '标准 3.0mm 外扩出血间隙 (Bleed OK)';
      if (dist >= 4.8 && dist <= 5.2) return '标准 5.0mm 瓦楞出血间隙 (Bleed OK)';
      if (dx >= 14.0 && dx <= 21.0) return '标准自动糊盒粘口位宽度 (Glue Tab: 15~20mm)';
      if (dist >= 0.4 && dist <= 1.6) return '装配滑移配合净空 (Tuck/Lid Clearance)';
      if (dist >= 0.65 && dist <= 0.75) return '2pt 标准模切刀缝公差 (2pt Blade Kerf 0.71mm)';
      return null;
    }

    // 在 Canvas 2D 进行工业级数显卡尺与 HUD 渲染
    render(ctx) {
      if (!this.isActive && this.fixedRecords.length === 0) return;

      ctx.save();
      // 1. 先绘制固化历史标注 (淡青色)
      this.fixedRecords.forEach((rec, idx) => {
        const alpha = idx === 0 ? 0.9 : 0.55;
        rec.hudBounds = this.drawCaliperLine(ctx, rec.p1, rec.p2, rec.dx, rec.dy, rec.dist, rec.note, alpha, false);
      });

      // 2. 绘制当前正在拖拽拉线的动态卡尺 (高亮琥珀色/荧光青)
      if (this.isMeasuring && this.startPt && this.endPt) {
        const dx = Math.abs(this.endPt.mmX - this.startPt.mmX);
        const dy = Math.abs(this.endPt.mmY - this.startPt.mmY);
        const dist = Math.hypot(dx, dy);
        const note = this.evaluateTolerance(dx, dy, dist);
        this.drawCaliperLine(ctx, this.startPt, this.endPt, dx, dy, dist, note, 1.0, true);
      }

      ctx.restore();
    }

    drawCaliperLine(ctx, p1, p2, dx, dy, dist, note, alpha, isLive) {
      const x1 = p1.worldX;
      const y1 = p1.worldY;
      const x2 = p2.worldX;
      const y2 = p2.worldY;

      const mainColor = isLive ? '#06b6d4' : '#0891b2';
      const auxColor = isLive ? 'rgba(217, 119, 6, 0.75)' : 'rgba(71, 85, 105, 0.45)';

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. 直角正交投影三角形导线 (水平 ΔX 与垂直 ΔY 虚线)
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = auxColor;
      ctx.lineWidth = 1 / this.state.zoom;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // 2. 主测距射线 (Solid Cyan)
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1.8 / this.state.zoom;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // 3. 起止点端点卡爪标头 (Caliper Jaws Crosshairs)
      const jawLen = 8 / this.state.zoom;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const perp = angle + Math.PI / 2;

      [ { x: x1, y: y1 }, { x: x2, y: y2 } ].forEach(pt => {
        ctx.beginPath();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2 / this.state.zoom;
        ctx.moveTo(pt.x - Math.cos(perp) * jawLen, pt.y - Math.sin(perp) * jawLen);
        ctx.lineTo(pt.x + Math.cos(perp) * jawLen, pt.y + Math.sin(perp) * jawLen);
        ctx.stroke();

        ctx.fillStyle = '#0891b2';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5 / this.state.zoom, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4. 仿真 Mitutoyo 数显卡尺 HUD 表头
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const hudPad = 6 / this.state.zoom;
      const hudW = (note ? 210 : 155) / this.state.zoom;
      const hudH = (note ? 58 : 42) / this.state.zoom;
      const hudX = midX - hudW / 2;
      const hudY = midY - hudH - (12 / this.state.zoom);

      // 表头卡片背景 (浅玻璃磨砂质感 + 青色描边)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = isLive ? '#0891b2' : 'rgba(15, 23, 42, 0.25)';
      ctx.lineWidth = 1.2 / this.state.zoom;
      ctx.fillRect(hudX, hudY, hudW, hudH);
      ctx.strokeRect(hudX, hudY, hudW, hudH);

      // 主距离读数 (大字微米/毫米高精数显)
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `bold ${12 / this.state.zoom}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#0e7490';
      ctx.fillText(`L: ${dist.toFixed(2)} mm`, hudX + hudPad, hudY + hudPad);

      // 微米换算
      ctx.font = `${9 / this.state.zoom}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(`(${(dist * 1000).toFixed(0)} μm)`, hudX + (90 / this.state.zoom), hudY + hudPad + (2 / this.state.zoom));

      // 分解 ΔX 与 ΔY 读数
      ctx.font = `${9 / this.state.zoom}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#475569';
      ctx.fillText(`ΔX: ${dx.toFixed(2)}  ΔY: ${dy.toFixed(2)} mm`, hudX + hudPad, hudY + (18 / this.state.zoom) + hudPad);

      // 智能容差诊断条
      if (note) {
        ctx.font = `bold ${8.5 / this.state.zoom}px "JetBrains Mono", sans-serif`;
        ctx.fillStyle = '#059669';
        ctx.fillText(`✓ ${note}`, hudX + hudPad, hudY + (32 / this.state.zoom) + hudPad);
      }

      // 非拖拽实时测量状态下，在表头卡片右上角绘制显眼的删除关闭图标 [✕]
      if (!isLive) {
        const btnSize = 13 / this.state.zoom;
        const btnX = hudX + hudW - btnSize - (3 / this.state.zoom);
        const btnY = hudY + (3 / this.state.zoom);

        ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
        ctx.fillRect(btnX, btnY, btnSize, btnSize);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
        ctx.lineWidth = 1 / this.state.zoom;
        ctx.strokeRect(btnX, btnY, btnSize, btnSize);

        ctx.fillStyle = '#e11d48';
        ctx.font = `bold ${9 / this.state.zoom}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', btnX + btnSize / 2, btnY + btnSize / 2);
      }

      ctx.restore();

      return {
        minX: hudX,
        minY: hudY,
        maxX: hudX + hudW,
        maxY: hudY + hudH
      };
    }
  }

  return {
    CadDigitalCaliper,
    DieCuttingKerfEngine,
    getScaleFactor
  };
}));
