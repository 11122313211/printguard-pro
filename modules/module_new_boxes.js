/**
 * ============================================================================
 * PrintGuard Pro - Advanced Parametric Packaging Dieline & 3D Kinematics Core
 * ============================================================================
 * 
 * Classic Packaging Structures:
 * 1. Mailer Box / FEFCO 0427 (电商自锁飞机盒)
 *    - Self-locking roll-over side walls, bottom locking tabs, front tuck lid
 *      with circular arc locking ears.
 * 2. Rigid Lid & Base Box (精装天地盖硬盒)
 *    - Luxury gift / digital rigid box with Lid (天盖) + Base (地盒).
 *    - Industrial precision clearance fit: Lid inner clearance is +1.5mm larger
 *      than Base outer dimensions for smooth hydraulic sliding drop.
 *    - Dual 2D dielines: High-density greyboard with 90° V-Grooves + wrapped
 *      art paper with 15mm turn-in margins, 45° corner miter flaps & thumb notches.
 * 
 * Features:
 * - Pure Vanilla JavaScript implementation with ZERO external dependencies.
 * - Exact 2D dieline geometry point algorithms (CUT_CONTOUR, CREASE, V_GROOVE).
 * - Full AutoCAD R12 DXF & layered W3C SVG vector export.
 * - 3D dynamic folding kinematics & joint matrix transforms (0° flat to 90° closed / lift-off).
 * - 100% backward & forward compatible with PrintGuard Pro workbench contracts.
 * 
 * References:
 * - FEFCO / ESBO International Fibreboard Case Code (FEFCO 0427)
 * - DIN 55437 / ECMA Standards for Folding Cartons
 * - Open-source inspiration: Boxes.py, microsoft/maker.js
 * ============================================================================
 */

(function (global) {
  'use strict';

  // ==========================================================================
  // 1. PARAMETRIC PRESETS & SPECIFICATION REGISTRY
  // ==========================================================================

  const PRESET_SPECS = {
    // New Box 1: Mailer Box / FEFCO 0427 (电商自锁飞机盒)
    fefco0427: {
      type: 'fefco0427',
      aliases: ['mailer_box', 'fefco_0427', 'airplane_box'],
      nameZh: '电商自锁飞机盒 (FEFCO 0427)',
      nameEn: 'Roll-End Lock Mailer Box (FEFCO 0427)',
      category: 'E-commerce / Unboxing Packaging',
      // Internal box dimensions (mm)
      L: 220, // Length (length across front)
      W: 150, // Width / Depth (front to back)
      H: 60,  // Height (vertical depth)
      // Material & CAD parameters
      t: 2.0,       // Corrugated board thickness (E-flute caliper)
      earW: 16.0,   // Front tuck circular arc lock ear projection width
      earH: 22.0,   // Ear vertical height
      earR: 10.0,   // Circular arc lock radius
      wingW: 58.5,  // Lid side dust wing width (H - 1.5mm)
      tabW: 18.0,   // Side inner wall locking tab width
      tabH: 6.0,    // Tab protrusion depth into bottom slot
      slotW: 2.5,   // Bottom panel locking slot width
      slotL: 18.5,  // Bottom panel locking slot length
      substrate: '350g E坑特硬牛皮瓦楞纸板 (E-Flute Corrugated)',
      caliperMm: 2.0,
      glueW: 0,     // 100% Glue-free eco lock structure
      isGlueFree: true
    },

    // New Box 2: Rigid Lid & Base Box (精装天地盖硬盒)
    rigid_box: {
      type: 'rigid_box',
      aliases: ['rigid_lid_base', 'lid_and_base', 'rigid_setup'],
      nameZh: '精装天地盖硬盒 (Rigid Lid & Base)',
      nameEn: 'Premium Rigid Lid & Base Gift Box',
      category: 'Luxury / Digital Hardware Packaging',
      // Base Box (地盒) nominal dimensions (mm)
      baseL: 160.0, // Base inner/outer length
      baseW: 110.0, // Base inner/outer width
      baseH: 48.0,  // Base outer height
      // Industrial tolerance fit (Apple/Sony Standard)
      // Lid internal clearance is strictly +1.5mm larger than Base outer size
      clearanceMm: 1.5,
      // Lid Box (天盖) derived dimensions (mm)
      lidL: 161.5,  // 160.0 + 1.5mm clearance
      lidW: 111.5,  // 110.0 + 1.5mm clearance
      lidH: 42.0,   // Slightly shorter than Base to reveal 6mm bottom thumb rim
      // Manufacturing parameters
      boardThickness: 2.0, // 1200g High-density greyboard (灰板)
      turnIn: 15.0,        // 157g Art paper wrap turn-in margin (包边位)
      cornerMiterEar: 12.0,// 45° corner miter wrapping ear (包角飞边)
      thumbRadius: 9.0,    // Semi-circular thumb grip cutouts on lid sides
      substrate: '1200g 工业高密灰板 (2.0mm) + 157g 哑粉铜版面纸',
      caliperMm: 2.0,
      glueW: 15.0,  // Wrap paper turn-in gluing margin
      isGlueFree: false
    },

    // Workbench legacy presets (maintained for 100% backward compatibility)
    reverse_tuck: {
      type: 'reverse_tuck',
      aliases: ['rtc'],
      nameZh: '反插盒 (Reverse Tuck End)',
      nameEn: 'Reverse Tuck End Carton',
      totalW: 560,
      totalH: 360,
      glueW: 36,
      panelW: 125,
      panelH: 220,
      flapH: 70,
      substrate: '350g 单铜卡纸',
      caliperMm: 0.45
    },
    drawer_sleeve: {
      type: 'drawer_sleeve',
      aliases: ['sleeve'],
      nameZh: '抽拉套盒 (Sleeve & Drawer Tray)',
      nameEn: 'Sleeve & Drawer Carton',
      totalW: 580,
      totalH: 340,
      glueW: 34,
      panelW: 130,
      panelH: 260,
      flapH: 40,
      substrate: '400g 金银卡纸',
      caliperMm: 0.50
    },
    auto_lock: {
      type: 'auto_lock',
      aliases: ['snap_lock', 'crash_lock'],
      nameZh: '自动扣底盒 (Snap-Lock Bottom)',
      nameEn: 'Auto-Lock Bottom Carton',
      totalW: 560,
      totalH: 380,
      glueW: 38,
      panelW: 124,
      panelH: 210,
      flapH: 85,
      substrate: '350g 工业白卡纸',
      caliperMm: 0.45
    },
    label_roll: {
      type: 'label_roll',
      aliases: ['roll_label'],
      nameZh: '卷筒不干胶标签 (Prestige Roll Label)',
      nameEn: 'Roll Label',
      totalW: 520,
      totalH: 320,
      labelW: 220,
      labelH: 260,
      radius: 18,
      gap: 20,
      substrate: '80g 亮光铜版不干胶 + 格拉辛底纸',
      caliperMm: 0.15
    }
  };

  /**
   * Retrieves parametric dimensions and metadata for any box preset.
   * Seamlessly extends the PrintGuard Pro workbench getPresetDimensions() contract.
   * 
   * @param {string} presetName - Preset key (e.g. 'fefco0427', 'rigid_box', 'reverse_tuck')
   * @param {object} [customOverrides] - Optional custom dimension overrides
   * @returns {object} Comprehensive dimension specification
   */
  function getPresetDimensions(presetName, customOverrides) {
    const key = (presetName || 'reverse_tuck').toLowerCase();
    
    // Check aliases
    let specKey = key;
    for (const [k, v] of Object.entries(PRESET_SPECS)) {
      if (k === key || (v.aliases && v.aliases.includes(key))) {
        specKey = k;
        break;
      }
    }

    const baseSpec = PRESET_SPECS[specKey] || PRESET_SPECS.reverse_tuck;
    const merged = Object.assign({}, baseSpec, customOverrides || {});

    // Compute derived totalW & totalH for dynamic calculation
    if (specKey === 'fefco0427') {
      const L = merged.L || 220;
      const W = merged.W || 150;
      const H = merged.H || 60;
      const t = merged.t || 2.0;
      const tabH = merged.tabH || 6.0;

      // Side assembly width per side = Outer Wall (H) + Roll-over rim (t) + Inner Wall (H) + Tab (tabH)
      const sideAssemblyW = 2 * H + t + tabH;
      // Total blank unfolded width = Center spine (L) + 2 * Side Assemblies
      const totalW = L + 2 * sideAssemblyW;
      // Total blank unfolded height = Front Tuck (H) + Top Lid (W) + Rear Wall (H) + Bottom (W) + Front Wall (H)
      const totalH = 3 * H + 2 * W;

      merged.totalW = totalW;
      merged.totalH = totalH;
      merged.panelW = L;
      merged.panelH = W;
      merged.flapH = H;
      merged.glueW = 0;
      merged.sideAssemblyW = sideAssemblyW;
    } else if (specKey === 'rigid_box') {
      const baseL = merged.baseL || 160.0;
      const baseW = merged.baseW || 110.0;
      const baseH = merged.baseH || 48.0;
      const clearance = merged.clearanceMm || 1.5;
      const turnIn = merged.turnIn || 15.0;

      const lidL = baseL + clearance;
      const lidW = baseW + clearance;
      const lidH = merged.lidH || 42.0;

      merged.lidL = lidL;
      merged.lidW = lidW;

      // Unfolded Lid blank: (lidL + 2*lidH + 2*turnIn) x (lidW + 2*lidH + 2*turnIn)
      const lidBlankW = lidL + 2 * (lidH + turnIn);
      const lidBlankH = lidW + 2 * (lidH + turnIn);

      // Unfolded Base blank: (baseL + 2*baseH + 2*turnIn) x (baseW + 2*baseH + 2*turnIn)
      const baseBlankW = baseL + 2 * (baseH + turnIn);
      const baseBlankH = baseW + 2 * (baseH + turnIn);

      const layoutGap = 35.0; // Visual gap between Lid and Base on CAD sheet
      const totalW = lidBlankW + layoutGap + baseBlankW;
      const totalH = Math.max(lidBlankH, baseBlankH) + 20.0;

      merged.totalW = totalW;
      merged.totalH = totalH;
      merged.panelW = baseL;
      merged.panelH = baseW;
      merged.flapH = baseH;
      merged.glueW = turnIn;
      merged.lidBlankW = lidBlankW;
      merged.lidBlankH = lidBlankH;
      merged.baseBlankW = baseBlankW;
      merged.baseBlankH = baseBlankH;
      merged.layoutGap = layoutGap;
    }

    return merged;
  }

  // ==========================================================================
  // 2. 2D PARAMETRIC GEOMETRY GENERATORS (FEFCO 0427 & RIGID BOX)
  // ==========================================================================

  /**
   * Generates exact 2D dieline points and vectors for FEFCO 0427 Mailer Box.
   * 
   * Coordinate Origin (0,0) is placed at the Top-Left of the blank bounding box.
   * 
   * Layout Architecture:
   * - Vertical Central Spine (width L):
   *   [y0 .. y1]: Front Tuck Flap (前插舌) with curved locking tabs (ears)
   *   [y1 .. y2]: Top Lid (顶盖) with side dust wings
   *   [y2 .. y3]: Rear Wall (后背板) with rear corner flaps
   *   [y3 .. y4]: Bottom Panel (底板) with 4 locking slots
   *   [y4 .. y5]: Front Wall (前壁) with front corner flaps & front tuck slots
   * - Left & Right Symmetrical Assemblies:
   *   Outer Side Wall -> Roll-over double crease -> Inner Side Wall -> Self-locking Tabs
   * 
   * @param {object} dims - Dimensions from getPresetDimensions('fefco0427')
   * @returns {object} Dieline geometry model containing cut, crease, slots & annotations
   */
  function generateFefco0427Geometry(dims) {
    const L = dims.L || 220;
    const W = dims.W || 150;
    const H = dims.H || 60;
    const t = dims.t || 2.0;
    const earW = dims.earW || 16.0;
    const earH = dims.earH || 22.0;
    const wingW = dims.wingW || (H - 1.5);
    const tabW = dims.tabW || 18.0;
    const tabH = dims.tabH || 6.0;
    const slotW = dims.slotW || 2.5;
    const slotL = dims.slotL || 18.5;

    const sideAssemblyW = 2 * H + t + tabH;
    const xBL = sideAssemblyW; // Left spine boundary
    const xBR = xBL + L;       // Right spine boundary

    // Y milestones
    const y0 = 0;              // Top edge of front tuck flap
    const y1 = H;              // Tuck flap hinge -> Top Lid
    const y2 = y1 + W;         // Top Lid hinge -> Rear Wall
    const y3 = y2 + H;         // Rear Wall hinge -> Bottom Panel
    const y4 = y3 + W;         // Bottom Panel hinge -> Front Wall
    const y5 = y4 + H;         // Bottom edge of Front Wall

    // ------------------------------------------------------------------------
    // 2.1 CUT_CONTOUR Outer Perimeter (Clockwise Closed Polyline Loop)
    // ------------------------------------------------------------------------
    const outerContour = [];

    // --- 1. Top Edge of Front Tuck Flap ---
    outerContour.push([xBL + 10, y0]);
    outerContour.push([xBR - 10, y0]);
    outerContour.push([xBR, y0 + 10]); // Chamfer
    outerContour.push([xBR, y1 - earH]);

    // --- 2. Right Locking Ear (自锁圆弧插耳) ---
    // Smooth bezier-like circular arc approximation
    outerContour.push([xBR + earW * 0.45, y1 - earH * 0.85]);
    outerContour.push([xBR + earW * 0.90, y1 - earH * 0.55]);
    outerContour.push([xBR + earW, y1 - earH * 0.25]);
    outerContour.push([xBR + earW * 0.75, y1 - 2]);
    outerContour.push([xBR, y1]); // Connects to hinge point

    // --- 3. Right Lid Dust Wing (顶盖右侧插翼) ---
    // Smooth lead-in curve into side cavity
    outerContour.push([xBR + wingW * 0.60, y1 + 5]);
    outerContour.push([xBR + wingW, y1 + 16]);
    outerContour.push([xBR + wingW, y2 - 6]);
    outerContour.push([xBR + wingW - 6, y2]);
    outerContour.push([xBR, y2]); // Relief slit cut to spine

    // --- 4. Right Rear Corner Flap (后右防尘折翼) ---
    outerContour.push([xBR + (H - 2), y2 + 5]); // 45° lead-in cut
    outerContour.push([xBR + (H - 2), y3 - 5]);
    outerContour.push([xBR, y3]); // Relief cut to spine

    // --- 5. Right Side Assembly (外侧板 + 翻折中骨 + 内折板 + 自锁卡脚) ---
    // Outer side wall top edge
    outerContour.push([xBR + H, y3]);
    // 45° chamfer across roll-over gap
    outerContour.push([xBR + H + t, y3 + 4]);
    // Inner wall top tapered edge
    outerContour.push([xBR + 2 * H + t, y3 + 14]);

    // Inner wall right edge to Tab 1
    const tab1CenterY = y3 + 0.25 * W;
    const tab2CenterY = y3 + 0.75 * W;

    outerContour.push([xBR + 2 * H + t, tab1CenterY - tabW / 2]);
    // Tab 1 profile (rounded tab)
    outerContour.push([xBR + 2 * H + t + tabH, tab1CenterY - tabW / 2 + 2]);
    outerContour.push([xBR + 2 * H + t + tabH, tab1CenterY + tabW / 2 - 2]);
    outerContour.push([xBR + 2 * H + t, tab1CenterY + tabW / 2]);

    // Segment between Tab 1 and Tab 2
    outerContour.push([xBR + 2 * H + t, tab2CenterY - tabW / 2]);
    // Tab 2 profile
    outerContour.push([xBR + 2 * H + t + tabH, tab2CenterY - tabW / 2 + 2]);
    outerContour.push([xBR + 2 * H + t + tabH, tab2CenterY + tabW / 2 - 2]);
    outerContour.push([xBR + 2 * H + t, tab2CenterY + tabW / 2]);

    // Inner wall bottom tapered edge
    outerContour.push([xBR + 2 * H + t, y4 - 14]);
    outerContour.push([xBR + H + t, y4 - 4]);
    outerContour.push([xBR + H, y4]);
    outerContour.push([xBR, y4]); // Relief cut to spine

    // --- 6. Right Front Corner Flap (前右防尘折翼) ---
    outerContour.push([xBR + (H - 2), y4 + 5]);
    outerContour.push([xBR + (H - 2), y5 - 5]);
    outerContour.push([xBR, y5]);

    // --- 7. Bottom Edge of Front Wall ---
    outerContour.push([xBL, y5]);

    // --- 8. Left Front Corner Flap (前左防尘折翼) ---
    outerContour.push([xBL - (H - 2), y5 - 5]);
    outerContour.push([xBL - (H - 2), y4 + 5]);
    outerContour.push([xBL, y4]);

    // --- 9. Left Side Assembly (Symmetrical to Right Side) ---
    outerContour.push([xBL - H, y4]);
    outerContour.push([xBL - (H + t), y4 - 4]);
    outerContour.push([xBL - (2 * H + t), y4 - 14]);

    // Left Tab 2
    outerContour.push([xBL - (2 * H + t), tab2CenterY + tabW / 2]);
    outerContour.push([xBL - (2 * H + t + tabH), tab2CenterY + tabW / 2 - 2]);
    outerContour.push([xBL - (2 * H + t + tabH), tab2CenterY - tabW / 2 + 2]);
    outerContour.push([xBL - (2 * H + t), tab2CenterY - tabW / 2]);

    // Segment between Left Tab 2 and Tab 1
    outerContour.push([xBL - (2 * H + t), tab1CenterY + tabW / 2]);
    // Left Tab 1
    outerContour.push([xBL - (2 * H + t + tabH), tab1CenterY + tabW / 2 - 2]);
    outerContour.push([xBL - (2 * H + t + tabH), tab1CenterY - tabW / 2 + 2]);
    outerContour.push([xBL - (2 * H + t), tab1CenterY - tabW / 2]);

    // Left Inner wall top tapered edge
    outerContour.push([xBL - (2 * H + t), y3 + 14]);
    outerContour.push([xBL - (H + t), y3 + 4]);
    outerContour.push([xBL - H, y3]);
    outerContour.push([xBL, y3]);

    // --- 10. Left Rear Corner Flap (后左防尘折翼) ---
    outerContour.push([xBL - (H - 2), y3 - 5]);
    outerContour.push([xBL - (H - 2), y2 + 5]);
    outerContour.push([xBL, y2]);

    // --- 11. Left Lid Dust Wing (顶盖左侧插翼) ---
    outerContour.push([xBL - wingW + 6, y2]);
    outerContour.push([xBL - wingW, y2 - 6]);
    outerContour.push([xBL - wingW, y1 + 16]);
    outerContour.push([xBL - wingW * 0.60, y1 + 5]);
    outerContour.push([xBL, y1]);

    // --- 12. Left Locking Ear (左自锁圆弧插耳) ---
    outerContour.push([xBL - earW * 0.75, y1 - 2]);
    outerContour.push([xBL - earW, y1 - earH * 0.25]);
    outerContour.push([xBL - earW * 0.90, y1 - earH * 0.55]);
    outerContour.push([xBL - earW * 0.45, y1 - earH * 0.85]);
    outerContour.push([xBL, y1 - earH]);
    outerContour.push([xBL, y0 + 10]);
    outerContour.push([xBL + 10, y0]); // Closes back to start!

    // ------------------------------------------------------------------------
    // 2.2 CUT_CONTOUR Interior Locking Slots (卡槽内孔)
    // ------------------------------------------------------------------------
    const slots = [
      // Bottom panel left slots (2 slots for left inner wall tabs)
      { id: 'bot_slot_L1', x: xBL + 2, y: tab1CenterY - slotL / 2, w: slotW, h: slotL, name: '底板左上锁扣槽' },
      { id: 'bot_slot_L2', x: xBL + 2, y: tab2CenterY - slotL / 2, w: slotW, h: slotL, name: '底板左下锁扣槽' },
      // Bottom panel right slots (2 slots for right inner wall tabs)
      { id: 'bot_slot_R1', x: xBR - 2 - slotW, y: tab1CenterY - slotL / 2, w: slotW, h: slotL, name: '底板右上锁扣槽' },
      { id: 'bot_slot_R2', x: xBR - 2 - slotW, y: tab2CenterY - slotL / 2, w: slotW, h: slotL, name: '底板右下锁扣槽' },
      // Front wall slots (2 slots for lid front tuck locking ears)
      { id: 'front_slot_L', x: xBL + 14, y: y4 + 4, w: slotW, h: 18, name: '前板左插耳卡口' },
      { id: 'front_slot_R', x: xBR - 14 - slotW, y: y4 + 4, w: slotW, h: 18, name: '前板右插耳卡口' }
    ];

    // ------------------------------------------------------------------------
    // 2.3 CREASE Fold Lines (压痕折线)
    // ------------------------------------------------------------------------
    const creaseLines = [
      // Horizontal Creases across spine
      { x1: xBL, y1: y1, x2: xBR, y2: y1, name: '前翻舌压痕线 (Tuck Hinge)' },
      { x1: xBL, y1: y2, x2: xBR, y2: y2, name: '顶盖后背压痕线 (Lid Hinge)' },
      { x1: xBL, y1: y3, x2: xBR, y2: y3, name: '后背底板压痕线 (Rear-Bottom Hinge)' },
      { x1: xBL, y1: y4, x2: xBR, y2: y4, name: '底板前板压痕线 (Bottom-Front Hinge)' },

      // Vertical Creases along spine
      { x1: xBL, y1: y3, x2: xBL, y2: y4, name: '底板左侧板压痕线 (Left Base Hinge)' },
      { x1: xBR, y1: y3, x2: xBR, y2: y4, name: '底板右侧板压痕线 (Right Base Hinge)' },
      { x1: xBL, y1: y1, x2: xBL, y2: y2, name: '顶盖左侧插翼压痕线' },
      { x1: xBR, y1: y1, x2: xBR, y2: y2, name: '顶盖右侧插翼压痕线' },
      { x1: xBL, y1: y2, x2: xBL, y2: y3, name: '后壁左角折翼压痕线' },
      { x1: xBR, y1: y2, x2: xBR, y2: y3, name: '后壁右角折翼压痕线' },
      { x1: xBL, y1: y4, x2: xBL, y2: y5, name: '前壁左角折翼压痕线' },
      { x1: xBR, y1: y4, x2: xBR, y2: y5, name: '前壁右角折翼压痕线' },

      // Double Crease Roll-over Hinge (双压痕侧壁翻折中骨)
      // Left side double crease
      { x1: xBL - H, y1: y3 + 1, x2: xBL - H, y2: y4 - 1, name: '左侧板外翻压痕 1' },
      { x1: xBL - (H + t), y1: y3 + 3, x2: xBL - (H + t), y2: y4 - 3, name: '左侧板内折压痕 2' },
      // Right side double crease
      { x1: xBR + H, y1: y3 + 1, x2: xBR + H, y2: y4 - 1, name: '右侧板外翻压痕 1' },
      { x1: xBR + (H + t), y1: y3 + 3, x2: xBR + (H + t), y2: y4 - 3, name: '右侧板内折压痕 2' }
    ];

    // ------------------------------------------------------------------------
    // 2.4 Panel Zones for Texture Mapping and Inspection
    // ------------------------------------------------------------------------
    const panels = {
      tuck:   { x: xBL, y: y0, w: L, h: H, label: '前翻盖插舌 (Front Tuck Flap)' },
      top:    { x: xBL, y: y1, w: L, h: W, label: '顶盖上盖板 (Top Lid Panel)' },
      rear:   { x: xBL, y: y2, w: L, h: H, label: '后背板 (Rear Wall)' },
      bottom: { x: xBL, y: y3, w: L, h: W, label: '底面板 (Bottom Base)' },
      front:  { x: xBL, y: y4, w: L, h: H, label: '前壁板 (Front Wall)' },
      leftOuter:  { x: xBL - H, y: y3, w: H, h: W, label: '左外侧板 (Left Outer Wall)' },
      leftInner:  { x: xBL - (2 * H + t), y: y3, w: H, h: W, label: '左内折板 (Left Inner Wall)' },
      rightOuter: { x: xBR, y: y3, w: H, h: W, label: '右外侧板 (Right Outer Wall)' },
      rightInner: { x: xBR + H + t, y: y3, w: H, h: W, label: '右内折板 (Right Inner Wall)' }
    };

    return {
      boxType: 'fefco0427',
      bounds: {
        minX: 0,
        minY: 0,
        maxX: dims.totalW,
        maxY: dims.totalH,
        width: dims.totalW,
        height: dims.totalH
      },
      cutContour: outerContour,
      slots: slots,
      creaseLines: creaseLines,
      panels: panels,
      L: L, W: W, H: H, t: t
    };
  }

  /**
   * Generates exact 2D dieline points and vectors for Rigid Lid & Base Box.
   * 
   * Features:
   * - Industrial Tolerance Clearance Fit: Lid inner dimensions are strictly
   *   +1.5mm larger than Base outer dimensions.
   * - High-density greyboard core dieline with 90° V-Grooves and 4-corner notches.
   * - Wrapped art paper dieline with 15mm turn-in margins and 45° corner miter flaps.
   * - Semi-circular thumb grip cutouts on Lid.
   * 
   * @param {object} dims - Dimensions from getPresetDimensions('rigid_box')
   * @returns {object} Dieline geometry model containing Lid & Base structures
   */
  function generateRigidBoxGeometry(dims) {
    const baseL = dims.baseL || 160.0;
    const baseW = dims.baseW || 110.0;
    const baseH = dims.baseH || 48.0;
    const clearance = dims.clearanceMm || 1.5;
    const lidL = baseL + clearance;
    const lidW = baseW + clearance;
    const lidH = dims.lidH || 42.0;
    const turnIn = dims.turnIn || 15.0;
    const miterEar = dims.cornerMiterEar || 12.0;
    const thumbR = dims.thumbRadius || 9.0;

    const lidBlankW = dims.lidBlankW;
    const lidBlankH = dims.lidBlankH;
    const baseBlankW = dims.baseBlankW;
    const baseBlankH = dims.baseBlankH;
    const layoutGap = dims.layoutGap || 35.0;

    // Origins on CAD sheet
    const lidOx = 10.0;
    const lidOy = 10.0;
    const baseOx = lidOx + lidBlankW + layoutGap;
    const baseOy = 10.0;

    // Helper: generate 2D geometry for a rigid box component (Lid or Base)
    function buildComponentGeometry(ox, oy, L, W, H, isLid) {
      const flapTotal = H + turnIn; // Wall height + wrap paper turn-in

      // Centers
      const cx = ox + flapTotal;
      const cy = oy + flapTotal;

      // 1. Greyboard V-Groove folding lines (V-槽线, along central rectangle)
      const vGrooves = [
        { x1: cx, y1: cy, x2: cx + L, y2: cy, name: isLid ? '天盖顶部 V-Groove' : '地盒顶部 V-Groove' },
        { x1: cx, y1: cy + W, x2: cx + L, y2: cy + W, name: isLid ? '天盖底部 V-Groove' : '地盒底部 V-Groove' },
        { x1: cx, y1: cy, x2: cx, y2: cy + W, name: isLid ? '天盖左侧 V-Groove' : '地盒左侧 V-Groove' },
        { x1: cx + L, y1: cy, x2: cx + L, y2: cy + W, name: isLid ? '天盖右侧 V-Groove' : '地盒右侧 V-Groove' }
      ];

      // 2. Greyboard Core 4-corner notches (90°角切除线)
      const greyboardNotches = [
        // Top-Left corner notch (H x H square cut)
        { x: cx - H, y: cy - H, w: H, h: H },
        // Top-Right corner notch
        { x: cx + L, y: cy - H, w: H, h: H },
        // Bottom-Left corner notch
        { x: cx - H, y: cy + W, w: H, h: H },
        // Bottom-Right corner notch
        { x: cx + L, y: cy + W, w: H, h: H }
      ];

      // 3. Turn-in crease lines (where wrap paper folds over greyboard top edge)
      const turnInCreases = [
        { x1: cx, y1: cy - H, x2: cx + L, y2: cy - H, name: '顶部包边折线' },
        { x1: cx, y1: cy + W + H, x2: cx + L, y2: cy + W + H, name: '底部包边折线' },
        { x1: cx - H, y1: cy, x2: cx - H, y2: cy + W, name: '左侧包边折线' },
        { x1: cx + L + H, y1: cy, x2: cx + L + H, y2: cy + W, name: '右侧包边折线' }
      ];

      // 4. Wrapped Art Paper Outer Cut Contour with 45° corner miter flaps
      const wrapPaperContour = [];

      // Top Wall Edge (with Turn-in)
      wrapPaperContour.push([cx, cy - flapTotal]);
      wrapPaperContour.push([cx + L, cy - flapTotal]);

      // Top-Right Corner Miter Ear (45° 包角耳朵)
      wrapPaperContour.push([cx + L + turnIn, cy - flapTotal + turnIn]);
      wrapPaperContour.push([cx + L + flapTotal, cy - turnIn]);
      wrapPaperContour.push([cx + L + flapTotal, cy]);

      // Right Wall Edge
      wrapPaperContour.push([cx + L + flapTotal, cy + W]);

      // Bottom-Right Corner Miter Ear
      wrapPaperContour.push([cx + L + flapTotal, cy + W + turnIn]);
      wrapPaperContour.push([cx + L + turnIn, cy + W + flapTotal]);
      wrapPaperContour.push([cx + L, cy + W + flapTotal]);

      // Bottom Wall Edge
      wrapPaperContour.push([cx, cy + W + flapTotal]);

      // Bottom-Left Corner Miter Ear
      wrapPaperContour.push([cx - turnIn, cy + W + flapTotal]);
      wrapPaperContour.push([cx - flapTotal, cy + W + turnIn]);
      wrapPaperContour.push([cx - flapTotal, cy + W]);

      // Left Wall Edge
      wrapPaperContour.push([cx - flapTotal, cy]);

      // Top-Left Corner Miter Ear
      wrapPaperContour.push([cx - flapTotal, cy - turnIn]);
      wrapPaperContour.push([cx - turnIn, cy - flapTotal]);
      wrapPaperContour.push([cx, cy - flapTotal]); // Closed!

      // 5. Thumb Grips (抠手位: Lid left & right semi-circles)
      const thumbNotches = [];
      if (isLid) {
        thumbNotches.push({
          side: 'left',
          cx: cx - flapTotal,
          cy: cy + W / 2,
          r: thumbR
        });
        thumbNotches.push({
          side: 'right',
          cx: cx + L + flapTotal,
          cy: cy + W / 2,
          r: thumbR
        });
      }

      return {
        center: { x: cx, y: cy, w: L, h: W },
        vGrooves: vGrooves,
        turnInCreases: turnInCreases,
        greyboardNotches: greyboardNotches,
        wrapPaperContour: wrapPaperContour,
        thumbNotches: thumbNotches,
        ox: ox, oy: oy,
        totalW: L + 2 * flapTotal,
        totalH: W + 2 * flapTotal
      };
    }

    const lidGeom = buildComponentGeometry(lidOx, lidOy, lidL, lidW, lidH, true);
    const baseGeom = buildComponentGeometry(baseOx, baseOy, baseL, baseW, baseH, false);

    return {
      boxType: 'rigid_box',
      bounds: {
        minX: 0,
        minY: 0,
        maxX: dims.totalW,
        maxY: dims.totalH,
        width: dims.totalW,
        height: dims.totalH
      },
      clearanceMm: clearance,
      lid: lidGeom,
      base: baseGeom,
      annotations: [
        {
          type: 'tolerance_callout',
          text: `★ 工业公差闭合配合: 天盖内净空比地盒外径大 ${clearance.toFixed(1)}mm (顺畅抽拉吸阻体验)`,
          x: dims.totalW / 2,
          y: dims.totalH - 12
        },
        {
          type: 'label',
          text: `天盖展开图 (Lid Dieline): ${lidL.toFixed(1)} × ${lidW.toFixed(1)} × ${lidH.toFixed(1)} mm`,
          x: lidOx + lidBlankW / 2,
          y: lidOy + lidBlankH + 16
        },
        {
          type: 'label',
          text: `地盒展开图 (Base Dieline): ${baseL.toFixed(1)} × ${baseW.toFixed(1)} × ${baseH.toFixed(1)} mm`,
          x: baseOx + baseBlankW / 2,
          y: baseOy + baseBlankH + 16
        }
      ]
    };
  }

  // ==========================================================================
  // 3. EXPORT ENGINES: AUTOCAD R12 DXF & LAYERED W3C SVG
  // ==========================================================================

  /**
   * Generates production-ready AutoCAD R12 DXF string for parametric die-cutting.
   * 
   * Strict Layer Standard:
   * - CUT_CONTOUR: ACI Color 6 (Magenta), Continuous
   * - CREASE:      ACI Color 4 (Cyan), Dashed
   * - V_GROOVE:    ACI Color 1 (Red), Continuous
   * - ANNOTATIONS: ACI Color 7 (White), Continuous
   * 
   * @param {object} dims - Dimension spec from getPresetDimensions()
   * @returns {string} Standard DXF file content
   */
  function generateParametricDxf(dims) {
    const type = dims.type || 'fefco0427';
    const lines = [];

    function addLine(layer, x1, y1, x2, y2) {
      lines.push(
        "0\nLINE\n8\n" + layer +
        "\n10\n" + Number(x1).toFixed(3) +
        "\n20\n" + Number(y1).toFixed(3) +
        "\n30\n0.0\n11\n" + Number(x2).toFixed(3) +
        "\n21\n" + Number(y2).toFixed(3) +
        "\n31\n0.0"
      );
    }

    function addPolyline(layer, pts) {
      for (let i = 0; i < pts.length - 1; i++) {
        addLine(layer, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      }
    }

    if (type === 'fefco0427' || type === 'mailer_box') {
      const g = generateFefco0427Geometry(dims);

      // Outer CUT_CONTOUR
      addPolyline("CUT_CONTOUR", g.cutContour);

      // Interior Locking Slots
      g.slots.forEach(s => {
        addLine("CUT_CONTOUR", s.x, s.y, s.x + s.w, s.y);
        addLine("CUT_CONTOUR", s.x + s.w, s.y, s.x + s.w, s.y + s.h);
        addLine("CUT_CONTOUR", s.x + s.w, s.y + s.h, s.x, s.y + s.h);
        addLine("CUT_CONTOUR", s.x, s.y + s.h, s.x, s.y);
      });

      // CREASE fold lines
      g.creaseLines.forEach(c => {
        addLine("CREASE", c.x1, c.y1, c.x2, c.y2);
      });
    } else if (type === 'rigid_box' || type === 'rigid_lid_base') {
      const g = generateRigidBoxGeometry(dims);

      [g.lid, g.base].forEach(comp => {
        // Outer Wrap Paper CUT_CONTOUR
        addPolyline("CUT_CONTOUR", comp.wrapPaperContour);

        // Turn-in Creases
        comp.turnInCreases.forEach(c => {
          addLine("CREASE", c.x1, c.y1, c.x2, c.y2);
        });

        // Greyboard V_GROOVE lines
        comp.vGrooves.forEach(v => {
          addLine("V_GROOVE", v.x1, v.y1, v.x2, v.y2);
        });
      });
    } else {
      // Legacy fallback
      const gw = dims.glueW || 30;
      const pw = dims.panelW || 120;
      const ph = dims.panelH || 200;
      const fh = dims.flapH || 50;
      const totalW = gw + 4 * pw;

      addLine("CUT_CONTOUR", 0, ph, gw, ph + fh * 0.3);
      for (let i = 0; i < 4; i++) {
        const px = gw + i * pw;
        const flapTop = (type === 'reverse_tuck' && i === 1) ? (ph + fh) : (ph + fh * 0.7);
        addLine("CUT_CONTOUR", px, ph, px, flapTop);
        addLine("CUT_CONTOUR", px, flapTop, px + pw, flapTop);
        addLine("CUT_CONTOUR", px + pw, flapTop, px + pw, ph);
      }
      addLine("CUT_CONTOUR", totalW, ph, totalW, 0);
      for (let i = 3; i >= 0; i--) {
        const px = gw + i * pw;
        const flapBottom = (type === 'reverse_tuck' && i === 3) ? -fh : -fh * 0.7;
        addLine("CUT_CONTOUR", px + pw, 0, px + pw, flapBottom);
        addLine("CUT_CONTOUR", px + pw, flapBottom, px, flapBottom);
        addLine("CUT_CONTOUR", px, flapBottom, px, 0);
      }
      addLine("CUT_CONTOUR", gw, -fh * 0.3, 0, 0);
      addLine("CUT_CONTOUR", 0, 0, 0, ph);

      for (let i = 0; i <= 4; i++) {
        const px = gw + i * pw;
        addLine("CREASE", px, 0, px, ph);
      }
      addLine("CREASE", gw, ph, totalW, ph);
      addLine("CREASE", gw, 0, totalW, 0);
    }

    return [
      "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC",
      "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER",
      "0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS",
      "0\nLAYER\n2\nCUT_CONTOUR\n70\n0\n62\n6\n6\nCONTINUOUS",
      "0\nLAYER\n2\nCREASE\n70\n0\n62\n4\n6\nDASHED",
      "0\nLAYER\n2\nV_GROOVE\n70\n0\n62\n1\n6\nCONTINUOUS",
      "0\nLAYER\n2\nANNOTATIONS\n70\n0\n62\n7\n6\nCONTINUOUS",
      "0\nENDTAB\n0\nENDSEC",
      "0\nSECTION\n2\nENTITIES",
      ...lines,
      "0\nENDSEC\n0\nEOF"
    ].join("\n");
  }

  /**
   * Generates precision layered W3C SVG vector dieline with styling & metadata.
   * 
   * @param {object} dims - Dimension spec from getPresetDimensions()
   * @returns {string} W3C SVG XML document
   */
  function generateParametricSvg(dims) {
    const type = dims.type || 'fefco0427';
    const totalW = dims.totalW;
    const totalH = dims.totalH;

    let vGrooveSvg = '';
    let creaseSvg = '';
    let cutSvg = '';
    let annotationsSvg = '';

    if (type === 'fefco0427' || type === 'mailer_box') {
      const g = generateFefco0427Geometry(dims);

      // Outer CUT_CONTOUR path
      const pts = g.cutContour;
      let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
      for (let i = 1; i < pts.length; i++) {
        d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
      }
      d += 'Z';
      cutSvg += `<path d="${d}" />\n`;

      // Interior slots
      g.slots.forEach(s => {
        cutSvg += `    <rect x="${s.x.toFixed(2)}" y="${s.y.toFixed(2)}" width="${s.w.toFixed(2)}" height="${s.h.toFixed(2)}" rx="1" />\n`;
      });

      // Crease lines
      g.creaseLines.forEach(c => {
        creaseSvg += `    <line x1="${c.x1.toFixed(2)}" y1="${c.y1.toFixed(2)}" x2="${c.x2.toFixed(2)}" y2="${c.y2.toFixed(2)}" />\n`;
      });

      annotationsSvg += `    <text x="${totalW / 2}" y="${totalH - 8}" text-anchor="middle">FEFCO 0427 电商自锁飞机盒 (展开尺寸: ${totalW.toFixed(1)} × ${totalH.toFixed(1)} mm)</text>\n`;
    } else if (type === 'rigid_box' || type === 'rigid_lid_base') {
      const g = generateRigidBoxGeometry(dims);

      [g.lid, g.base].forEach(comp => {
        // Outer Wrap paper path
        const pts = comp.wrapPaperContour;
        let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
        for (let i = 1; i < pts.length; i++) {
          d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
        }
        d += 'Z';
        cutSvg += `    <path d="${d}" />\n`;

        // Turn-in creases
        comp.turnInCreases.forEach(c => {
          creaseSvg += `    <line x1="${c.x1.toFixed(2)}" y1="${c.y1.toFixed(2)}" x2="${c.x2.toFixed(2)}" y2="${c.y2.toFixed(2)}" />\n`;
        });

        // Greyboard V-Grooves
        comp.vGrooves.forEach(v => {
          vGrooveSvg += `    <line x1="${v.x1.toFixed(2)}" y1="${v.y1.toFixed(2)}" x2="${v.x2.toFixed(2)}" y2="${v.y2.toFixed(2)}" />\n`;
        });
      });

      annotationsSvg += `    <text x="${totalW / 2}" y="25" text-anchor="middle" font-weight="bold">精装天地盖硬盒 (Rigid Lid &amp; Base) - 工业闭合公差: +${g.clearanceMm} mm</text>\n`;
    } else {
      // Legacy fallback
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW + 20}" height="${totalH + 20}" viewBox="0 0 ${totalW + 20} ${totalH + 20}">
  <title>PrintGuard CAD Dieline - ${type}</title>
  <g id="CUT_CONTOUR" stroke="#ec4899" stroke-width="1.5" fill="none">
    <rect x="10" y="10" width="${totalW}" height="${totalH}" />
  </g>
</svg>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW + 20}" height="${totalH + 20}" viewBox="0 0 ${totalW + 20} ${totalH + 20}">
  <title>PrintGuard Pro CAD Dieline - ${type}</title>
  <desc>Parametric die-cutting vector exported by PrintGuard Pro</desc>
  <style>
    .cut { stroke: #ec4899; stroke-width: 1.5; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .crease { stroke: #06b6d4; stroke-width: 1.2; stroke-dasharray: 5,4; fill: none; }
    .vgroove { stroke: #ef4444; stroke-width: 1.4; stroke-dasharray: 8,3; fill: none; }
    .anno { font-family: 'JetBrains Mono', monospace; font-size: 11px; fill: #64748b; }
  </style>
  <rect x="0" y="0" width="${totalW + 20}" height="${totalH + 20}" fill="#0b0e17" />
  <g id="V_GROOVE" class="vgroove">
${vGrooveSvg}  </g>
  <g id="CREASE_FOLD" class="crease">
${creaseSvg}  </g>
  <g id="CUT_CONTOUR" class="cut">
${cutSvg}  </g>
  <g id="ANNOTATIONS" class="anno">
${annotationsSvg}  </g>
</svg>`;
  }

  // ==========================================================================
  // 4. 2D CANVAS RENDERING ADAPTER FOR PRINTGUARD WORKBENCH
  // ==========================================================================

  /**
   * Renders crease fold lines and V-grooves onto HTML5 2D Canvas context.
   */
  function drawCanvasCreaseLines(ctx, x, y, dims) {
    const type = dims.type || 'fefco0427';
    ctx.save();

    if (type === 'fefco0427' || type === 'mailer_box') {
      const g = generateFefco0427Geometry(dims);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);

      g.creaseLines.forEach(c => {
        ctx.beginPath();
        ctx.moveTo(x + c.x1, y + c.y1);
        ctx.lineTo(x + c.x2, y + c.y2);
        ctx.stroke();
      });
    } else if (type === 'rigid_box' || type === 'rigid_lid_base') {
      const g = generateRigidBoxGeometry(dims);

      // 1. Draw Turn-in Creases (Cyan Dashed)
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      [g.lid, g.base].forEach(comp => {
        comp.turnInCreases.forEach(c => {
          ctx.beginPath();
          ctx.moveTo(x + c.x1, y + c.y1);
          ctx.lineTo(x + c.x2, y + c.y2);
          ctx.stroke();
        });
      });

      // 2. Draw Greyboard V-Grooves (Red Heavy Dash)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([8, 4]);
      [g.lid, g.base].forEach(comp => {
        comp.vGrooves.forEach(v => {
          ctx.beginPath();
          ctx.moveTo(x + v.x1, y + v.y1);
          ctx.lineTo(x + v.x2, y + v.y2);
          ctx.stroke();
        });
      });
    }

    ctx.restore();
  }

  /**
   * Renders cut contour lines and interior locking slots onto HTML5 2D Canvas.
   */
  function drawCanvasCutContourLines(ctx, x, y, dims) {
    const type = dims.type || 'fefco0427';
    ctx.save();
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    if (type === 'fefco0427' || type === 'mailer_box') {
      const g = generateFefco0427Geometry(dims);

      // Outer Perimeter Path
      ctx.beginPath();
      const pts = g.cutContour;
      ctx.moveTo(x + pts[0][0], y + pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(x + pts[i][0], y + pts[i][1]);
      }
      ctx.closePath();
      ctx.stroke();

      // Interior Slots
      g.slots.forEach(s => {
        ctx.strokeRect(x + s.x, y + s.y, s.w, s.h);
      });
    } else if (type === 'rigid_box' || type === 'rigid_lid_base') {
      const g = generateRigidBoxGeometry(dims);

      [g.lid, g.base].forEach(comp => {
        // Outer Wrap Paper Contour
        ctx.beginPath();
        const pts = comp.wrapPaperContour;
        ctx.moveTo(x + pts[0][0], y + pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(x + pts[i][0], y + pts[i][1]);
        }
        ctx.closePath();
        ctx.stroke();

        // Thumb Cutouts
        if (comp.thumbNotches) {
          comp.thumbNotches.forEach(th => {
            ctx.beginPath();
            ctx.arc(x + th.cx, y + th.cy, th.r, 0, Math.PI * 2);
            ctx.stroke();
          });
        }
      });
    }

    ctx.restore();
  }

  /**
   * Renders engineering dimensions and tolerance annotations.
   */
  function drawCanvasEngineeringDimensions(ctx, x, y, dims) {
    const type = dims.type || 'fefco0427';
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.fillStyle = '#cbd5e1';
    ctx.lineWidth = 0.8;
    ctx.font = '10px JetBrains Mono, monospace';

    if (type === 'fefco0427' || type === 'mailer_box') {
      const g = generateFefco0427Geometry(dims);
      const dimY = y + dims.totalH + 20;

      // Bottom overall length dimension line
      ctx.beginPath();
      ctx.moveTo(x, dimY);
      ctx.lineTo(x + dims.totalW, dimY);
      ctx.moveTo(x + 5, dimY - 3); ctx.lineTo(x, dimY); ctx.lineTo(x + 5, dimY + 3);
      ctx.moveTo(x + dims.totalW - 5, dimY - 3); ctx.lineTo(x + dims.totalW, dimY); ctx.lineTo(x + dims.totalW - 5, dimY + 3);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillText(`展开总长 W = ${dims.totalW.toFixed(1)} mm | 主盒腔净尺寸: ${dims.L}×${dims.W}×${dims.H} mm (E坑 ${dims.t}mm)`, x + dims.totalW / 2, dimY - 5);
    } else if (type === 'rigid_box' || type === 'rigid_lid_base') {
      const g = generateRigidBoxGeometry(dims);
      const dimY = y + dims.totalH + 18;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.fillText(`★ 高端数码精装盒: 天盖内径 = 地盒外径 + ${g.clearanceMm.toFixed(1)}mm 工业公差 | 1200g灰板(2.0mm) + 15mm包边`, x + dims.totalW / 2, dimY);
    }

    ctx.restore();
  }

  // ==========================================================================
  // 5. 3D KINEMATICS, MESH BUILDER & DYNAMIC HINGE ENGINE
  // ==========================================================================

  /**
   * Calculates pure mathematical 3D kinematic joint matrices and bounding boxes
   * across fold angles (0° flat to 90° closed / lift-off).
   * 
   * Zero external dependencies (runs in Node.js unit tests or headless renderers).
   * 
   * @param {string} presetName - 'fefco0427' or 'rigid_box'
   * @param {number} foldAngleDeg - Current fold angle (0 to 90 degrees)
   * @returns {object} Kinematic state with transformation matrices & joint angles
   */
  function calculateKinematics(presetName, foldAngleDeg) {
    const angle = Math.max(0, Math.min(90, foldAngleDeg !== undefined ? foldAngleDeg : 90));
    const progress = angle / 90.0; // 0.0 (flat/open) -> 1.0 (assembled/closed)
    const rad = (angle * Math.PI) / 180.0;

    const dims = getPresetDimensions(presetName);

    if (dims.type === 'fefco0427' || dims.type === 'mailer_box') {
      // FEFCO 0427 folding mechanics:
      // 1. Bottom plate remains static at origin.
      // 2. Left and Right outer side walls fold up by progress * 90°.
      // 3. Left and Right inner side walls roll inward by progress * 180° around the top rim.
      // 4. Front wall folds up by progress * 90°.
      // 5. Rear wall folds up by progress * 90°.
      // 6. Top lid folds down over the box by progress * 90°.
      // 7. Front tuck flap folds down into front slot by progress * 90°.
      return {
        preset: 'fefco0427',
        foldAngleDeg: angle,
        progress: progress,
        joints: {
          bottom: { rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0 },
          leftOuterWall: { rx: 0, ry: 0, rz: progress * (Math.PI / 2) },
          leftInnerWallRoll: { rx: 0, ry: 0, rz: progress * Math.PI },
          rightOuterWall: { rx: 0, ry: 0, rz: -progress * (Math.PI / 2) },
          rightInnerWallRoll: { rx: 0, ry: 0, rz: -progress * Math.PI },
          frontWall: { rx: progress * (Math.PI / 2), ry: 0, rz: 0 },
          rearWall: { rx: -progress * (Math.PI / 2), ry: 0, rz: 0 },
          topLid: { rx: -progress * (Math.PI / 2), ry: 0, rz: 0 },
          frontTuck: { rx: -progress * (Math.PI / 2), ry: 0, rz: 0 }
        },
        isFullyClosed: angle === 90,
        isFullyFlat: angle === 0
      };
    } else if (dims.type === 'rigid_box' || dims.type === 'rigid_lid_base') {
      // Rigid Lid & Base dynamics:
      // 1. Base Box sits static at ground Y = 0.
      // 2. Lid Box translates vertically upward (Lift-off).
      //    At 90° (closed): Lid Y sits flush over Base (offset = 0).
      //    At 0° (fully open): Lid is lifted up by maxLift = 70mm above the Base.
      const maxLiftMm = 70.0;
      const liftOffsetY = (1.0 - progress) * maxLiftMm;
      const clearance = dims.clearanceMm || 1.5;

      return {
        preset: 'rigid_box',
        foldAngleDeg: angle,
        progress: progress,
        liftOffsetY: liftOffsetY,
        clearanceMm: clearance,
        base: { tx: 0, ty: 0, tz: 0, w: dims.baseL, d: dims.baseW, h: dims.baseH },
        lid: {
          tx: 0,
          ty: (dims.baseH - dims.lidH) + liftOffsetY,
          tz: 0,
          w: dims.lidL,
          d: dims.lidW,
          h: dims.lidH
        },
        isClosed: angle === 90,
        isLifted: liftOffsetY > 0
      };
    }

    return { preset: dims.type, foldAngleDeg: angle, progress: progress };
  }

  /**
   * Three.js 3D Mesh and Hierarchical Hinge Builder.
   * If THREE is available in the runtime environment (browser), creates
   * real Three.js Group/Mesh instances for PiP inspector.
   * 
   * If THREE is not available (Node.js test), returns an engineered mock
   * structure with matching joint graph.
   * 
   * @param {string} presetName - Preset key
   * @param {number} foldAngleDeg - Folding angle (0 to 90)
   * @param {object} [options] - Textures, materials, scene references
   * @returns {object} 3D box hierarchy
   */
  function build3DBoxStructure(presetName, foldAngleDeg, options) {
    const angle = foldAngleDeg !== undefined ? foldAngleDeg : 90;
    const dims = getPresetDimensions(presetName);
    const hasThree = typeof THREE !== 'undefined';

    if (!hasThree) {
      // Return mathematical model for Node.js test environment
      return {
        type: dims.type,
        foldAngleDeg: angle,
        kinematics: calculateKinematics(dims.type, angle),
        isThreeAvailable: false
      };
    }

    // --- THREE.js Live Runtime Builder ---
    const group = new THREE.Group();
    const panels = {};
    const materials = (options && options.materials) || {};

    const kraftMat = materials.inside || new THREE.MeshStandardMaterial({
      color: 0xf4eee4,
      roughness: 0.85,
      metalness: 0.05
    });

    const frontMat = materials.front || new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
      metalness: 0.1
    });

    const lidMat = materials.lid || new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.15
    });

    const bottomMat = materials.bottom || materials.back || kraftMat;

    if (dims.type === 'fefco0427' || dims.type === 'mailer_box') {
      const bw = dims.L * 0.25; // 3D units scale
      const bd = dims.W * 0.25;
      const bh = dims.H * 0.25;

      // 1. Bottom Panel (Static reference base)
      const botGeo = new THREE.BoxGeometry(bw, 0.4, bd);
      panels.bottom = new THREE.Mesh(botGeo, [kraftMat, kraftMat, kraftMat, bottomMat, kraftMat, kraftMat]);
      panels.bottom.position.set(0, 0, 0);
      group.add(panels.bottom);

      // 2. Rear Wall & Top Lid Hinge
      panels.rearHinge = new THREE.Group();
      panels.rearHinge.position.set(0, 0, -bd / 2);
      const rearGeo = new THREE.BoxGeometry(bw, bh, 0.4);
      panels.rear = new THREE.Mesh(rearGeo, kraftMat);
      panels.rear.position.set(0, bh / 2, 0);
      panels.rearHinge.add(panels.rear);

      // Top Lid Hinge
      panels.lidHinge = new THREE.Group();
      panels.lidHinge.position.set(0, bh, 0);
      const lidGeo = new THREE.BoxGeometry(bw, 0.4, bd);
      panels.lid = new THREE.Mesh(lidGeo, frontMat);
      panels.lid.position.set(0, 0, bd / 2);
      panels.lidHinge.add(panels.lid);

      // Front Tuck Flap Hinge
      panels.tuckHinge = new THREE.Group();
      panels.tuckHinge.position.set(0, 0, bd);
      const tuckGeo = new THREE.BoxGeometry(bw, bh, 0.4);
      panels.tuck = new THREE.Mesh(tuckGeo, kraftMat);
      panels.tuck.position.set(0, -bh / 2, 0);
      panels.tuckHinge.add(panels.tuck);

      panels.lidHinge.add(panels.tuckHinge);
      panels.rearHinge.add(panels.lidHinge);
      group.add(panels.rearHinge);

      // 3. Front Wall Hinge
      panels.frontHinge = new THREE.Group();
      panels.frontHinge.position.set(0, 0, bd / 2);
      const frontGeo = new THREE.BoxGeometry(bw, bh, 0.4);
      panels.front = new THREE.Mesh(frontGeo, kraftMat);
      panels.front.position.set(0, bh / 2, 0);
      panels.frontHinge.add(panels.front);
      group.add(panels.frontHinge);

      // 4. Left Outer & Inner Roll-over Side Walls
      panels.leftHinge = new THREE.Group();
      panels.leftHinge.position.set(-bw / 2, 0, 0);
      const leftOuterGeo = new THREE.BoxGeometry(0.4, bh, bd);
      panels.leftOuter = new THREE.Mesh(leftOuterGeo, kraftMat);
      panels.leftOuter.position.set(0, bh / 2, 0);
      panels.leftHinge.add(panels.leftOuter);

      panels.leftRollHinge = new THREE.Group();
      panels.leftRollHinge.position.set(0, bh, 0);
      const leftInnerGeo = new THREE.BoxGeometry(0.4, bh, bd);
      panels.leftInner = new THREE.Mesh(leftInnerGeo, kraftMat);
      panels.leftInner.position.set(0, -bh / 2, 0);
      panels.leftRollHinge.add(panels.leftInner);
      panels.leftHinge.add(panels.leftRollHinge);
      group.add(panels.leftHinge);

      // 5. Right Outer & Inner Roll-over Side Walls
      panels.rightHinge = new THREE.Group();
      panels.rightHinge.position.set(bw / 2, 0, 0);
      const rightOuterGeo = new THREE.BoxGeometry(0.4, bh, bd);
      panels.rightOuter = new THREE.Mesh(rightOuterGeo, kraftMat);
      panels.rightOuter.position.set(0, bh / 2, 0);
      panels.rightHinge.add(panels.rightOuter);

      panels.rightRollHinge = new THREE.Group();
      panels.rightRollHinge.position.set(0, bh, 0);
      const rightInnerGeo = new THREE.BoxGeometry(0.4, bh, bd);
      panels.rightInner = new THREE.Mesh(rightInnerGeo, kraftMat);
      panels.rightInner.position.set(0, -bh / 2, 0);
      panels.rightRollHinge.add(panels.rightInner);
      panels.rightHinge.add(panels.rightRollHinge);
      group.add(panels.rightHinge);

      // Semantic face naming for 2D/3D raycasting and highlighting
      panels.bottom.name = 'bottom';
      panels.rear.name = 'back';
      panels.lid.name = 'top';
      panels.tuck.name = 'tuck';
      panels.front.name = 'front';
      panels.leftOuter.name = 'left';
      panels.leftInner.name = 'leftInner';
      panels.rightOuter.name = 'right';
      panels.rightInner.name = 'rightInner';

      // Standard alias mapping
      panels.top = panels.lid;
      panels.back = panels.rear;
      panels.left = panels.leftOuter;
      panels.right = panels.rightOuter;

      // Apply initial folding rotation
      apply3DFoldAngle({ panels: panels, dims: dims }, angle);

    } else if (dims.type === 'rigid_box' || dims.type === 'rigid_lid_base') {
      const bw = dims.baseL * 0.25;
      const bd = dims.baseW * 0.25;
      const bh = dims.baseH * 0.25;
      const lw = dims.lidL * 0.25;
      const ld = dims.lidW * 0.25;
      const lh = dims.lidH * 0.25;

      // Base Box Assembly (Stationary at Y = 0)
      panels.baseBox = new THREE.Group();
      const baseBottom = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.5, bd), kraftMat);
      baseBottom.name = 'bottom';
      panels.baseBox.add(baseBottom);

      const baseWallFront = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.5), frontMat);
      baseWallFront.name = 'front';
      baseWallFront.position.set(0, bh / 2, bd / 2);
      panels.baseBox.add(baseWallFront);

      const baseWallBack = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.5), frontMat);
      baseWallBack.name = 'back';
      baseWallBack.position.set(0, bh / 2, -bd / 2);
      panels.baseBox.add(baseWallBack);

      const baseWallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, bh, bd), frontMat);
      baseWallLeft.name = 'left';
      baseWallLeft.position.set(-bw / 2, bh / 2, 0);
      panels.baseBox.add(baseWallLeft);

      const baseWallRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, bh, bd), frontMat);
      baseWallRight.name = 'right';
      baseWallRight.position.set(bw / 2, bh / 2, 0);
      panels.baseBox.add(baseWallRight);
      group.add(panels.baseBox);

      // Lid Box Assembly (Translates vertically for Lift-off)
      panels.lidBox = new THREE.Group();
      const lidTop = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.5, ld), lidMat);
      lidTop.name = 'top';
      lidTop.position.set(0, lh, 0);
      panels.lidBox.add(lidTop);

      const lidWallFront = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.5), lidMat);
      lidWallFront.name = 'lidFront';
      lidWallFront.position.set(0, lh / 2, ld / 2);
      panels.lidBox.add(lidWallFront);

      const lidWallBack = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.5), lidMat);
      lidWallBack.name = 'lidBack';
      lidWallBack.position.set(0, lh / 2, -ld / 2);
      panels.lidBox.add(lidWallBack);

      const lidWallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, lh, ld), lidMat);
      lidWallLeft.name = 'lidLeft';
      lidWallLeft.position.set(-lw / 2, lh / 2, 0);
      panels.lidBox.add(lidWallLeft);

      const lidWallRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, lh, ld), lidMat);
      lidWallRight.name = 'lidRight';
      lidWallRight.position.set(lw / 2, lh / 2, 0);
      panels.lidBox.add(lidWallRight);
      group.add(panels.lidBox);

      // Standard alias mapping for rigid box
      panels.bottom = baseBottom;
      panels.front = baseWallFront;
      panels.back = baseWallBack;
      panels.left = baseWallLeft;
      panels.right = baseWallRight;
      panels.top = lidTop;

      // Apply initial lift position
      apply3DFoldAngle({ panels: panels, dims: dims }, angle);
    }

    return {
      group: group,
      panels: panels,
      dims: dims,
      isThreeAvailable: true
    };
  }

  /**
   * Dynamically animates the 3D structure according to fold angle slider.
   * 
   * @param {object} box3DInstance - Return value from build3DBoxStructure()
   * @param {number} angleDeg - Fold angle 0 to 90 degrees
   */
  function apply3DFoldAngle(box3DInstance, angleDeg) {
    if (!box3DInstance || !box3DInstance.panels) return;
    const angle = Math.max(0, Math.min(90, angleDeg));
    const panels = box3DInstance.panels;
    const dims = box3DInstance.dims || {};

    const progress = angle / 90.0;
    const foldRad = ((90 - angle) * Math.PI) / 180.0;

    if (dims.type === 'fefco0427' || dims.type === 'mailer_box') {
      if (panels.rearHinge) panels.rearHinge.rotation.x = foldRad;
      if (panels.lidHinge) panels.lidHinge.rotation.x = -foldRad;
      if (panels.tuckHinge) panels.tuckHinge.rotation.x = -foldRad;
      if (panels.frontHinge) panels.frontHinge.rotation.x = -foldRad;
      if (panels.leftHinge) panels.leftHinge.rotation.z = -foldRad;
      if (panels.leftRollHinge) panels.leftRollHinge.rotation.z = (1.0 - progress) * Math.PI;
      if (panels.rightHinge) panels.rightHinge.rotation.z = foldRad;
      if (panels.rightRollHinge) panels.rightRollHinge.rotation.z = -(1.0 - progress) * Math.PI;
    } else if (dims.type === 'rigid_box' || dims.type === 'rigid_lid_base') {
      if (panels.lidBox) {
        // Closed position: resting at Y = baseH - lidH (in 3D scale)
        const bh = (dims.baseH || 48) * 0.25;
        const lh = (dims.lidH || 42) * 0.25;
        const closedY = bh - lh;
        const maxLift = 18.0; // 3D units lift
        const liftY = closedY + (1.0 - progress) * maxLift;
        panels.lidBox.position.y = liftY;
      }
    } else {
      // Legacy hinge fallback
      if (panels.topHinge && panels.bottomHinge) {
        panels.topHinge.rotation.x = -foldRad;
        panels.bottomHinge.rotation.x = foldRad;
      }
    }
  }

  // ==========================================================================
  // 6. COMPREHENSIVE AUTOMATED TEST RUNNER & VERIFICATION SUITE
  // ==========================================================================

  /**
   * Executes the complete test suite verifying mathematical correctness,
   * topology, tolerances, export syntax, and compatibility.
   * 
   * @returns {object} Test report with pass/fail counts
   */
  function runAllTests() {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      details: []
    };

    function assert(condition, message) {
      results.total++;
      if (condition) {
        results.passed++;
        results.details.push(`[PASS] ${message}`);
      } else {
        results.failed++;
        results.details.push(`[FAIL] ${message}`);
        console.error(`Assertion failed: ${message}`);
      }
    }

    console.log("------------------------------------------------------------");
    console.log("Running PrintGuard Pro New Boxes Parametric Verification...");
    console.log("------------------------------------------------------------");

    // ------------------------------------------------------------------------
    // TEST 1: Preset Dimensions Data Contract
    // ------------------------------------------------------------------------
    const fefco = getPresetDimensions('fefco0427');
    assert(fefco.type === 'fefco0427', "FEFCO 0427 type key matches");
    assert(fefco.totalW > 400 && fefco.totalH > 400, "FEFCO 0427 totalW & totalH dynamically calculated");
    assert(fefco.glueW === 0, "FEFCO 0427 is 100% glue-free self-locking");
    assert(fefco.caliperMm === 2.0, "FEFCO 0427 caliper is 2.0mm E-flute");

    const rigid = getPresetDimensions('rigid_box');
    assert(rigid.type === 'rigid_box', "Rigid Box type key matches");
    assert(rigid.clearanceMm === 1.5, "Rigid Box has 1.5mm precision clearance fit");
    assert(rigid.lidL === rigid.baseL + 1.5, "Rigid Box Lid Length = Base Length + 1.5mm");
    assert(rigid.lidW === rigid.baseW + 1.5, "Rigid Box Lid Width = Base Width + 1.5mm");
    assert(rigid.totalW > 500 && rigid.totalH > 200, "Rigid Box totalW & totalH dynamically calculated");

    // Legacy fallback check
    const rtc = getPresetDimensions('reverse_tuck');
    assert(rtc.totalW === 560 && rtc.totalH === 360, "Legacy reverse_tuck preset intact");

    // ------------------------------------------------------------------------
    // TEST 2: FEFCO 0427 2D Dieline Geometry & Topology
    // ------------------------------------------------------------------------
    const gFefco = generateFefco0427Geometry(fefco);
    assert(Array.isArray(gFefco.cutContour) && gFefco.cutContour.length >= 40, "FEFCO 0427 cut contour has >= 40 vertices");

    // Check closed loop
    const firstPt = gFefco.cutContour[0];
    const lastPt = gFefco.cutContour[gFefco.cutContour.length - 1];
    assert(firstPt[0] === lastPt[0] && firstPt[1] === lastPt[1], "FEFCO 0427 cut contour forms a mathematically closed loop");

    // Check locking slots count & positions
    assert(gFefco.slots.length === 6, "FEFCO 0427 contains exactly 6 precision locking slots (4 bottom + 2 front)");
    const botLeftSlot = gFefco.slots.find(s => s.id === 'bot_slot_L1');
    assert(botLeftSlot && botLeftSlot.w === fefco.slotW, "Bottom locking slot dimensions match specification");

    // Check crease lines count & symmetry
    assert(gFefco.creaseLines.length >= 14, "FEFCO 0427 contains full crease fold rules (>= 14 lines)");
    const rollOver1 = gFefco.creaseLines.find(c => c.name.includes('左侧板外翻压痕 1'));
    const rollOver2 = gFefco.creaseLines.find(c => c.name.includes('左侧板内折压痕 2'));
    assert(rollOver1 && rollOver2, "FEFCO 0427 contains double crease roll-over hinge");

    // ------------------------------------------------------------------------
    // TEST 3: FEFCO 0427 DXF & SVG Export Syntax
    // ------------------------------------------------------------------------
    const dxfFefco = generateParametricDxf(fefco);
    assert(dxfFefco.includes("0\nSECTION\n2\nHEADER"), "FEFCO 0427 DXF contains standard AC1009 header");
    assert(dxfFefco.includes("CUT_CONTOUR") && dxfFefco.includes("CREASE"), "FEFCO 0427 DXF contains CUT_CONTOUR and CREASE layers");
    assert(dxfFefco.endsWith("0\nEOF"), "FEFCO 0427 DXF ends with proper EOF tag");

    const svgFefco = generateParametricSvg(fefco);
    assert(svgFefco.includes("<svg") && svgFefco.includes("</svg>"), "FEFCO 0427 SVG is valid XML");
    assert(svgFefco.includes('id="CUT_CONTOUR"') && svgFefco.includes('id="CREASE_FOLD"'), "FEFCO 0427 SVG contains layered groups");

    // ------------------------------------------------------------------------
    // TEST 4: FEFCO 0427 3D Kinematics Transforms
    // ------------------------------------------------------------------------
    const kinFefcoFlat = calculateKinematics('fefco0427', 0);
    assert(kinFefcoFlat.isFullyFlat === true, "FEFCO 0427 at 0° is recognized as flat blank");
    assert(kinFefcoFlat.joints.leftOuterWall.rz === 0, "FEFCO 0427 at 0° has zero joint rotation");

    const kinFefcoClosed = calculateKinematics('fefco0427', 90);
    assert(kinFefcoClosed.isFullyClosed === true, "FEFCO 0427 at 90° is recognized as assembled");
    assert(Math.abs(kinFefcoClosed.joints.leftOuterWall.rz - Math.PI / 2) < 1e-4, "FEFCO 0427 outer wall folds 90°");
    assert(Math.abs(kinFefcoClosed.joints.leftInnerWallRoll.rz - Math.PI) < 1e-4, "FEFCO 0427 inner wall rolls 180° into locking slots");

    // ------------------------------------------------------------------------
    // TEST 5: Rigid Lid & Base 2D Geometry & Clearance Tolerance
    // ------------------------------------------------------------------------
    const gRigid = generateRigidBoxGeometry(rigid);
    assert(gRigid.clearanceMm === 1.5, "Rigid box geometry tolerance verified as 1.5mm");
    assert(gRigid.lid && gRigid.base, "Rigid box contains both Lid and Base components");

    // Check V-groove lines count
    assert(gRigid.lid.vGrooves.length === 4, "Lid contains 4 greyboard V-grooves");
    assert(gRigid.base.vGrooves.length === 4, "Base contains 4 greyboard V-grooves");

    // Check turn-in and wrap paper contour
    assert(gRigid.lid.turnInCreases.length === 4, "Lid contains 4 turn-in creases (15mm)");
    assert(gRigid.lid.wrapPaperContour.length >= 12, "Lid wrap paper has 45° corner miter ears");
    assert(gRigid.lid.thumbNotches.length === 2, "Lid contains 2 semi-circular thumb grip cutouts");

    // ------------------------------------------------------------------------
    // TEST 6: Rigid Lid & Base DXF & SVG Export Syntax
    // ------------------------------------------------------------------------
    const dxfRigid = generateParametricDxf(rigid);
    assert(dxfRigid.includes("V_GROOVE"), "Rigid Box DXF contains dedicated V_GROOVE layer");
    assert(dxfRigid.includes("CUT_CONTOUR") && dxfRigid.includes("CREASE"), "Rigid Box DXF contains cut and crease layers");

    const svgRigid = generateParametricSvg(rigid);
    assert(svgRigid.includes('id="V_GROOVE"'), "Rigid Box SVG contains V_GROOVE group");
    assert(svgRigid.includes("1.5 mm"), "Rigid Box SVG includes tolerance annotation");

    // ------------------------------------------------------------------------
    // TEST 7: Rigid Lid & Base 3D Lift-Off Kinematics
    // ------------------------------------------------------------------------
    const kinRigidClosed = calculateKinematics('rigid_box', 90);
    assert(kinRigidClosed.isClosed === true, "Rigid box at 90° is in closed position");
    assert(kinRigidClosed.liftOffsetY === 0, "Closed state lift offset is 0mm");

    const kinRigidLift = calculateKinematics('rigid_box', 0);
    assert(kinRigidLift.liftOffsetY === 70.0, "Fully open state lifts Lid by 70.0mm above Base");

    const kinRigidHalf = calculateKinematics('rigid_box', 45);
    assert(Math.abs(kinRigidHalf.liftOffsetY - 35.0) < 1e-4, "45° state lifts Lid smoothly by half (35.0mm)");

    // ------------------------------------------------------------------------
    // TEST 8: Three.js Builder & Dynamic Angle Application
    // ------------------------------------------------------------------------
    const mock3D = build3DBoxStructure('fefco0427', 90);
    assert(mock3D !== null, "build3DBoxStructure produces valid 3D instance");
    apply3DFoldAngle(mock3D, 45); // Should execute cleanly without error

    console.log("------------------------------------------------------------");
    console.log(`Test Results: ${results.passed} / ${results.total} passed (${((results.passed / results.total) * 100).toFixed(1)}%)`);
    if (results.failed === 0) {
      console.log("ALL TESTS PASSED WITH 100% SUCCESS!");
    } else {
      console.error(`${results.failed} tests failed!`);
    }
    console.log("------------------------------------------------------------");

    return results;
  }

  // ==========================================================================
  // 7. MODULE EXPORTS (NODE.JS COMMONJS + BROWSER GLOBAL)
  // ==========================================================================

  const api = {
    PRESET_SPECS: PRESET_SPECS,
    getPresetDimensions: getPresetDimensions,
    generateFefco0427Geometry: generateFefco0427Geometry,
    generateRigidBoxGeometry: generateRigidBoxGeometry,
    generateParametricDxf: generateParametricDxf,
    generateParametricSvg: generateParametricSvg,
    drawCanvasCreaseLines: drawCanvasCreaseLines,
    drawCanvasCutContourLines: drawCanvasCutContourLines,
    drawCanvasEngineeringDimensions: drawCanvasEngineeringDimensions,
    calculateKinematics: calculateKinematics,
    build3DBoxStructure: build3DBoxStructure,
    apply3DFoldAngle: apply3DFoldAngle,
    runAllTests: runAllTests
  };

  // Node.js CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  // Browser Global
  if (typeof window !== 'undefined') {
    window.PackagingWorkbenchBoxes = api;
  }

  // Auto-run tests if executed directly with `node module_new_boxes.js`
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const report = runAllTests();
    if (report.failed > 0) {
      process.exit(1);
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
