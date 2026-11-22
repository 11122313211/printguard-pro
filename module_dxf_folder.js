/* ====================================================================
 * PrintGuard Pro · DXF Folder — 任意刀线通用折叠引擎
 * --------------------------------------------------------------------
 * 输入刀线（cut+crease 线段，mm 坐标）→ 平面分割（面片提取）→
 * 折痕面邻接图 → BFS 铰链树 → 2D 仿射面框架 → 3D 递归折叠变换。
 * 纯逻辑层（segments/plan/worldTransforms）Node 可测，零依赖；
 * 渲染层 build3DScene 需浏览器 THREE（由 index.html 传入）。
 *
 * 算法参照：
 *   - Liu et al. 2007（平面模式最优设计，面邻接图生成树）
 *   - 平面直线图（PSLG）面提取：半边环游 + 有向面积过滤
 *   - edemaine/fold、Rabbit Ear（折纸数据结构先例）
 *
 * 自测：node module_dxf_folder.js
 * ==================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintGuardDxfFolder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================================================================
   * 1. 实体 → 线段（LINE / LWPOLYLINE / POLYLINE，bulge 圆弧扁平化）
   * ================================================================ */

  function flattenBulgeSegment(ax, ay, bx, by, bulge, cls, out) {
    /* bulge = tan(θ/4)，θ 为含弧圆心角；正=逆时针 */
    if (!bulge || Math.abs(bulge) < 1e-9) {
      out.push({ ax: ax, ay: ay, bx: bx, by: by, cls: cls });
      return;
    }
    var theta = 4 * Math.atan(bulge);
    var dx = bx - ax, dy = by - ay;
    var chord = Math.sqrt(dx * dx + dy * dy);
    if (chord < 1e-9) return;
    var r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    var midx = (ax + bx) / 2, midy = (ay + by) / 2;
    /* 弦中垂线上到圆心的偏移 */
    var h = r * Math.cos(theta / 2) * (theta > 0 ? 1 : -1);
    /* 垂直方向（弦方向的左法线） */
    var nx = -dy / chord, ny = dx / chord;
    var cx = midx + nx * h, cy = midy + ny * h;
    var a0 = Math.atan2(ay - cy, ax - cx);
    var steps = 10;
    for (var i = 1; i <= steps; i++) {
      var t0 = a0 + theta * (i - 1) / steps;
      var t1 = a0 + theta * i / steps;
      out.push({ ax: cx + r * Math.cos(t0), ay: cy + r * Math.sin(t0), bx: cx + r * Math.cos(t1), by: cy + r * Math.sin(t1), cls: cls });
    }
  }

  function segmentsFromEntities(entities, classHint) {
    /* classHint: 'crease'|'cut'，整批实体统一归类 */
    var out = [];
    for (var e = 0; e < entities.length; e++) {
      var ent = entities[e];
      if (!ent) continue;
      var type = ent.type || '';
      if (type === 'LINE') {
        out.push({ ax: ent.x1, ay: ent.y1, bx: ent.x2, by: ent.y2, cls: classHint });
      } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        var vs = ent.vertices || [];
        var isClosed = ent.isClosed === true || ent.closed === true; /* 解析器字段名为 isClosed */
        for (var v = 0; v + 1 < vs.length; v++) {
          flattenBulgeSegment(vs[v].x, vs[v].y, vs[v + 1].x, vs[v + 1].y, vs[v + 1].bulge || 0, classHint, out);
        }
        if (isClosed && vs.length > 2) {
          flattenBulgeSegment(vs[vs.length - 1].x, vs[vs.length - 1].y, vs[0].x, vs[0].y, vs[0].bulge || 0, classHint, out);
        }
      }
      /* ARC/CIRCLE（圆形盒底等）不参与折叠邻接（无共享折痕语义），忽略 */
    }
    return out;
  }

  /* ================================================================
   * 2. 线段求交与子段切分（PSLG 构建第一步）
   * ================================================================ */

  function segIntersectParams(s1, s2) {
    /* 返回 s1 上需要切分的参数 t（0..1）。
       覆盖两类：① 双内部穿越（十字交叉）；② T 型连接——s2 端点落在 s1 内部
       （折痕端点搭在切线上是刀模最常见的连接形态）。端点对端点由吸附合并。 */
    var ax = s1.ax, ay = s1.ay, bx = s1.bx, by = s1.by;
    var cx = s2.ax, cy = s2.ay, dx = s2.bx, dy = s2.by;
    var rX = bx - ax, rY = by - ay, sX = dx - cx, sY = dy - cy;
    var denom = rX * sY - rY * sX;
    if (Math.abs(denom) < 1e-12) return [];
    var t = ((cx - ax) * sY - (cy - ay) * sX) / denom;
    var u = ((cx - ax) * rY - (cy - ay) * rX) / denom;
    var EPS = 1e-9;
    var tInterior = t > EPS && t < 1 - EPS;
    var uInterior = u > EPS && u < 1 - EPS;
    var uOnSeg = u >= -EPS && u <= 1 + EPS;
    if (tInterior && uInterior) return [t];                          /* ① 十字 */
    if (tInterior && uOnSeg && !uInterior) return [t];               /* ② T 型 */
    return [];
  }

  function splitSegmentsAtIntersections(segs) {
    /* 每条段收集交点参数 → 切分为子段 */
    var n = segs.length;
    var params = [];
    for (var i = 0; i < n; i++) params.push([]);
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var boxA = segBox(segs[a]), boxB = segBox(segs[b]);
        if (!boxOverlap(boxA, boxB)) continue;
        var t1 = segIntersectParams(segs[a], segs[b]);
        var t2 = segIntersectParams(segs[b], segs[a]);
        for (var k = 0; k < t1.length; k++) params[a].push(t1[k]);
        for (var k2 = 0; k2 < t2.length; k2++) params[b].push(t2[k2]);
      }
    }
    var out = [];
    for (var s = 0; s < n; s++) {
      var seg = segs[s];
      var ts = params[s].sort(function (x, y) { return x - y; });
      var lastT = 0;
      var pushed = false;
      for (var t = 0; t < ts.length; t++) {
        if (ts[t] - lastT > 1e-9) {
          out.push(makeSubSeg(seg, lastT, ts[t], (lastT === 0)));
          lastT = ts[t];
          pushed = true;
        }
      }
      out.push(makeSubSeg(seg, lastT, 1, !pushed || lastT === 0 ? true : true));
    }
    return out;
  }

  function makeSubSeg(seg, t0, t1, keepCls) {
    var lerp = function (p, q, t) { return p + (q - p) * t; };
    return {
      ax: lerp(seg.ax, seg.bx, t0), ay: lerp(seg.ay, seg.by, t0),
      bx: lerp(seg.ax, seg.bx, t1), by: lerp(seg.ay, seg.by, t1),
      cls: seg.cls
    };
  }

  function segBox(s) {
    return {
      minX: Math.min(s.ax, s.bx), maxX: Math.max(s.ax, s.bx),
      minY: Math.min(s.ay, s.by), maxY: Math.max(s.ay, s.by)
    };
  }

  function boxOverlap(a, b) {
    return a.minX <= b.maxX + 1e-9 && b.minX <= a.maxX + 1e-9 &&
      a.minY <= b.maxY + 1e-9 && b.minY <= a.maxY + 1e-9;
  }

  /* ================================================================
   * 3. 平面图：节点吸附 + 邻接表 + 面提取（半边环游）
   * ================================================================ */

  function keyOf(x, y, eps) {
    return Math.round(x / eps) + '_' + Math.round(y / eps);
  }

  function pointOfKey(key, points) {
    /* 首次出现的精确坐标（吸附已在 key 层完成） */
    return points[key];
  }

  function buildPlanarGraph(subSegs, eps) {
    var points = {};   /* key -> {x,y} */
    var edges = [];    /* {u,v,cls}  u/v 为 key */
    var seen = {};     /* 去重：同一无向几何边只保留一次；crease 优先 */
    var deg = {};      /* key -> 度数 */

    function node(x, y) {
      var k = keyOf(x, y, eps);
      if (!points[k]) points[k] = { x: x, y: y };
      return k;
    }

    for (var i = 0; i < subSegs.length; i++) {
      var s = subSegs[i];
      if (Math.abs(s.ax - s.bx) < eps * 0.5 && Math.abs(s.ay - s.by) < eps * 0.5) continue; /* 退化段 */
      var u = node(s.ax, s.ay), v = node(s.bx, s.by);
      if (u === v) continue;
      var ek1 = u + '|' + v, ek2 = v + '|' + u;
      var existing = seen[ek1] || seen[ek2];
      if (existing) {
        /* 重复边：crease 语义优先保留（同序/逆序重复都要升级） */
        if (s.cls === 'crease' && existing.cls !== 'crease') existing.cls = 'crease';
        continue;
      }
      var edge = { u: u, v: v, cls: s.cls };
      seen[ek1] = edge;
      edges.push(edge);
      deg[u] = (deg[u] || 0) + 1;
      deg[v] = (deg[v] || 0) + 1;
    }

    /* 邻接表：每个节点的出边按角度排序（面环游需要） */
    var adj = {};
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e];
      (adj[ed.u] = adj[ed.u] || []).push({ to: ed.v, edge: ed });
      (adj[ed.v] = adj[ed.v] || []).push({ to: ed.u, edge: ed });
    }
    for (var nodeKey in adj) {
      if (!adj.hasOwnProperty(nodeKey)) continue;
      var p = points[nodeKey];
      adj[nodeKey].sort(function (a, b) {
        var pa = points[a.to], pb = points[b.to];
        return Math.atan2(pa.y - p.y, pa.x - p.x) - Math.atan2(pb.y - p.y, pb.x - p.x);
      });
    }
    return { points: points, edges: edges, adj: adj, deg: deg };
  }

  function findEdge(adj, u, v) {
    var outs = adj[u];
    if (!outs) return null;
    for (var i = 0; i < outs.length; i++) {
      if (outs[i].to === v) return outs[i].edge;
    }
    return null;
  }

  function extractFaces(graph) {
    /* 半边环游：从每条未用有向边出发，下一边取"背向角逆时针紧邻"的出边，
       环游回到起始有向边即闭合为一个面。每个有向边恰属一个面。 */
    var used = {};   /* 'u|v' -> true */
    var faces = [];
    var points = graph.points, adj = graph.adj;

    for (var ei = 0; ei < graph.edges.length; ei++) {
      var e0 = graph.edges[ei];
      var starts = [[e0.u, e0.v], [e0.v, e0.u]];
      for (var d = 0; d < starts.length; d++) {
        var su = starts[d][0], sv = starts[d][1];
        if (used[su + '|' + sv]) continue;

        var cycleKeys = [], cycleEdges = [];
        var u = su, v = sv, closed = false;
        for (var guard = 0; guard < 20000; guard++) {
          used[u + '|' + v] = true;
          cycleKeys.push(u);
          cycleEdges.push(findEdge(adj, u, v));

          var outs = adj[v] || [];
          var backAngle = Math.atan2(points[u].y - points[v].y, points[u].x - points[v].x);
          var best = null, bestDelta = Infinity;
          for (var oi = 0; oi < outs.length; oi++) {
            var c = outs[oi];
            var ang = Math.atan2(points[c.to].y - points[v].y, points[c.to].x - points[v].x);
            var delta = ang - backAngle;
            while (delta <= 1e-9) delta += Math.PI * 2;
            if (delta < bestDelta) { bestDelta = delta; best = c; }
          }
          if (!best) break;
          var nu = v, nv = best.to;
          if (nu === su && nv === sv) { closed = true; break; }
          u = nu; v = nv;
        }

        if (closed && cycleKeys.length >= 3) {
          faces.push({ keys: cycleKeys, edges: cycleEdges, sig: cycleKeys.join('>') });
        }
      }
    }

    /* 去重 + 内部面判定 + 定向 */
    var bySig = {};
    var unique = [];
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      if (!bySig[face.sig]) { bySig[face.sig] = true; unique.push(face); }
    }

    var polyFaces = [];
    for (var g = 0; g < unique.length; g++) {
      var fc = unique[g];
      var poly = [];
      for (var k = 0; k < fc.keys.length; k++) {
        var pt = points[fc.keys[k]];
        poly.push([pt.x, pt.y]);
      }
      var area2 = signedArea2(poly);
      if (Math.abs(area2) < 2e-1) continue;           /* 细碎退化面丢弃 */
      polyFaces.push({ poly: poly, edges: fc.edges, area: Math.abs(area2) / 2, areaSign: area2 });
    }
    return polyFaces;
  }

  function signedArea2(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return s;
  }

  /* ================================================================
   * 4. 折痕邻接 + BFS 铰链树 + 2D 面框架
   * ================================================================ */

  function faceContainsEdge(face, uKey, vKey) {
    var k1 = uKey + '|' + vKey, k2 = vKey + '|' + uKey;
    for (var i = 0; i < face.edges.length; i++) {
      var e = face.edges[i];
      if (!e) continue;
      if ((e.u + '|' + e.v) === k1 || (e.u + '|' + e.v) === k2) return e;
    }
    return null;
  }

  function computeHinges(faces, edges, eps) {
    /* 每条折叠语义边（crease 压痕 / perf 齿刀半断）若被两个面共享 → 铰链 */
    var hinges = [];
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (e.cls !== 'crease' && e.cls !== 'perf') continue;
      var owner1 = null, owner2 = null;
      for (var f = 0; f < faces.length; f++) {
        if (faceContainsEdge(faces[f], e.u, e.v)) {
          if (owner1 === null) owner1 = f;
          else if (owner2 === null) { owner2 = f; break; }
        }
      }
      if (owner1 !== null && owner2 !== null && owner1 !== owner2) {
        hinges.push({ id: 'h' + i, u: e.u, v: e.v, cls: e.cls, f1: owner1, f2: owner2 });
      }
    }
    return hinges;
  }

  function frameFor(origin, dirx, diry) {
    /* world→local 仿射：先平移再旋转 -angle；返回 {a,b,c,d,e,f}
       x' = cos·(x-ox) + sin·(y-oy) ; y' = -sin·(x-ox) + cos·(y-oy) */
    var len = Math.sqrt(dirx * dirx + diry * diry) || 1;
    var cx = dirx / len, cy = diry / len;
    return { ox: origin[0], oy: origin[1], a: cx, b: -cy, c: cy, d: cx, e: 0, f: 0 };
  }

  function applyFrame(fr, x, y) {
    var dx = x - fr.ox, dy = y - fr.oy;
    return [fr.a * dx + fr.c * dy, fr.b * dx + fr.d * dy];
  }

  function frameLocalToWorld(fr, x, y) {
    /* 逆变换（local→world） */
    var lx = x, ly = y;
    var wx = fr.ox + fr.a * lx - fr.b * ly;
    var wy = fr.oy + fr.c * lx + fr.d * ly;
    return [wx, wy];
  }

  function childPerpSum(fr, polyWorld) {
    var perpSum = 0;
    for (var i = 0; i < polyWorld.length; i++) {
      perpSum += applyFrame(fr, polyWorld[i][0], polyWorld[i][1])[1];
    }
    return perpSum;
  }

  function buildFoldPlan(segments, options) {
    options = options || {};
    var eps = options.snapEps || 0.05;          /* mm 吸附 */
    var minFaceArea = options.minFaceArea || 4; /* mm² */

    if (!segments || !segments.length) {
      return { ok: false, error: 'no-segments', faces: [], hinges: [] };
    }

    var subSegs = splitSegmentsAtIntersections(segments);
    var graph = buildPlanarGraph(subSegs, eps);
    var facesRaw = extractFaces(graph);

    /* 面积过滤 */
    var areaFiltered = [];
    for (var i = 0; i < facesRaw.length; i++) {
      if (facesRaw[i].area >= minFaceArea) areaFiltered.push(facesRaw[i]);
    }
    if (!areaFiltered.length) {
      return { ok: false, error: 'no-faces', faces: [], hinges: [] };
    }

    /* 内部面判定：环游规则下内部面与外部面方向相反。
       主判据 = 计数多数（连通刀模的内部面恒多于外部面）；
       并列时 = 该组最大面较小者为内部（外部面必含其内部面，面积不小于之）。 */
    var stat = { 1: { count: 0, maxArea: 0 }, '-1': { count: 0, maxArea: 0 } };
    for (var s = 0; s < areaFiltered.length; s++) {
      var sign = areaFiltered[s].areaSign > 0 ? 1 : -1;
      stat[sign].count++;
      stat[sign].maxArea = Math.max(stat[sign].maxArea, areaFiltered[s].area);
    }
    var posSign = stat[1], negSign = stat['-1'];
    var interiorSign;
    if (posSign.count === 0 && negSign.count === 0) {
      return { ok: false, error: 'no-faces', faces: [], hinges: [] };
    } else if (negSign.count === 0) interiorSign = 1;
    else if (posSign.count === 0) interiorSign = -1;
    else if (posSign.count !== negSign.count) {
      interiorSign = posSign.count > negSign.count ? 1 : -1;
    } else {
      interiorSign = posSign.maxArea <= negSign.maxArea ? 1 : -1;
    }
    var facesData = [];
    for (var i2 = 0; i2 < areaFiltered.length; i2++) {
      var sg = areaFiltered[i2].areaSign > 0 ? 1 : -1;
      if (sg === interiorSign) facesData.push(areaFiltered[i2]);
    }
    if (!facesData.length) {
      return { ok: false, error: 'no-faces', faces: [], hinges: [] };
    }

    /* 铰链 */
    var hinges = computeHinges(facesData, graph.edges, eps);

    /* 面对象化 */
    var faces = [];
    for (var f = 0; f < facesData.length; f++) {
      var fd = facesData[f];
      faces.push({
        id: 'f' + f,
        poly: fd.poly,                 /* 世界 mm 多边形 */
        localPoly: null,               /* 各自面框架内的多边形 */
        frame: null,                   /* world→local 仿射 */
        parent: null,                  /* 父面 id */
        hingeId: null,                 /* 与父相连的铰链 */
        depth: null,
        area: fd.area,
        edges: fd.edges
      });
    }

    /* 根面 = 最大面积面 */
    var rootIdx = 0;
    for (var r = 0; r < faces.length; r++) {
      if (faces[r].area > faces[rootIdx].area) rootIdx = r;
    }
    faces[rootIdx].frame = { ox: 0, oy: 0, a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    faces[rootIdx].localPoly = faces[rootIdx].poly;
    faces[rootIdx].parent = null;
    faces[rootIdx].hingeId = null;
    faces[rootIdx].depth = 0;

    /* BFS 挂树 */
    var visited = {};
    visited[rootIdx] = true;
    var queue = [rootIdx];
    var hingesOut = [];
    var hingeUsed = {};
    while (queue.length) {
      var cur = queue.shift();
      for (var h = 0; h < hinges.length; h++) {
        var hg = hinges[h];
        if (hingeUsed[hg.id]) continue;
        var other = null;
        if (hg.f1 === cur && !visited[hg.f2]) other = hg.f2;
        else if (hg.f2 === cur && !visited[hg.f1]) other = hg.f1;
        if (other === null) continue;

        /* 铰链几何（世界坐标）。子面框架：铰链 a→b 方向为局部 +X；
           若子面在 -Y 侧，改用 b→a 方向（原点换铰链另一端），并同步交换
           hinge 的 a/b，使 3D 构建时的枢轴/转角与面框架始终一致。 */
        var pa = graph.points[hg.u], pb = graph.points[hg.v];
        var childPoly = facesData[other].poly;
        var frA = frameFor([pa.x, pa.y], pb.x - pa.x, pb.y - pa.y);
        var chosenA, chosenB, frame;
        if (childPerpSum(frA, childPoly) < 0) {
          chosenA = [pb.x, pb.y]; chosenB = [pa.x, pa.y];
          frame = frameFor(chosenA, chosenB[0] - chosenA[0], chosenB[1] - chosenA[1]);
        } else {
          chosenA = [pa.x, pa.y]; chosenB = [pb.x, pb.y];
          frame = frA;
        }

        faces[other].frame = frame;
        var lp = [];
        for (var q = 0; q < childPoly.length; q++) {
          lp.push(applyFrame(frame, childPoly[q][0], childPoly[q][1]));
        }
        faces[other].localPoly = lp;
        faces[other].parent = faces[cur].id;
        faces[other].hingeId = hg.id;
        faces[other].depth = faces[cur].depth + 1;

        hingeUsed[hg.id] = true;
        visited[other] = true;
        hingesOut.push({
          id: hg.id,
          cls: hg.cls,   /* 语义随 segment 传播：perf（齿刀）铰链可配置独立折叠角 */
          a: chosenA, b: chosenB,
          parentFace: faces[cur].id, childFace: faces[other].id
        });
        queue.push(other);
      }
    }

    /* 未连入树的面（孤立面片）保留但标记 */
    for (var u2 = 0; u2 < faces.length; u2++) {
      if (faces[u2].depth === null) faces[u2].depth = -1;
    }

    var bounds = computeSegBounds(segments);
    return {
      ok: true,
      faces: faces,
      hinges: hingesOut,
      rootId: faces[rootIdx].id,
      bounds: bounds,
      widthMm: bounds.maxX - bounds.minX,
      heightMm: bounds.maxY - bounds.minY,
      truncated: !!options.truncated,
      stats: {
        faceCount: faces.length,
        hingeCount: hingesOut.length,
        orphanFaces: faces.filter(function (x) { return x.depth === -1; }).length,
        segmentCount: segments.length
      }
    };
  }

  function computeSegBounds(segs) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
      minY = Math.min(minY, s.ay, s.by); maxY = Math.max(maxY, s.ay, s.by);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /* ================================================================
   * 5. 折叠运动学（纯逻辑，Node 可测）：3D 世界变换
   * ================================================================ */
  /* 4x4 矩阵（列主序数组，THREE 约定）最小实现 */

  function mat4Identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  function mat4Mul(A, B) {
    var O = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        O[c * 4 + r] = A[0 * 4 + r] * B[c * 4 + 0] + A[1 * 4 + r] * B[c * 4 + 1] +
          A[2 * 4 + r] * B[c * 4 + 2] + A[3 * 4 + r] * B[c * 4 + 3];
      }
    }
    return O;
  }
  function mat4Apply(M, x, y, z) {
    return [
      M[0] * x + M[4] * y + M[8] * z + M[12],
      M[1] * x + M[5] * y + M[9] * z + M[13],
      M[2] * x + M[6] * y + M[10] * z + M[14]
    ];
  }
  function mat4T(x, y, z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  }
  function mat4Rz(t) {
    var c = Math.cos(t), s = Math.sin(t);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  function mat4Rx(t) {
    var c = Math.cos(t), s = Math.sin(t);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  }

  function hingeAngleDeg(hinge, angleDeg, options) {
    /* 铰链目标角映射：perf（齿刀/半断线）铰链在配置了 perfAngleDeg（number）时
       固定取该角度（不随 foldAngleDeg 变），其余铰链（crease 等）跟随主折叠角；
       未配置 perfAngleDeg 时与旧版行为完全一致 */
    if (hinge && hinge.cls === 'perf' && options && typeof options.perfAngleDeg === 'number') {
      return options.perfAngleDeg;
    }
    return angleDeg || 0;
  }

  function worldTransforms(plan, angleDeg, options) {
    /* 返回 { faceId → { matrix, worldPoly: [[x,y,z],...] } }
       约定：mm 世界系（x 右，y 上/下视输入约定，z 出平面），
       折叠绕铰链轴 +θ（统一向 +z 侧折，朝相机方向成型，与预设盒视觉一致；
       各铰链角度经 hingeAngleDeg 按 cls 语义取值） */
    var byId = {};
    for (var i = 0; i < plan.faces.length; i++) byId[plan.faces[i].id] = plan.faces[i];
    var hingeById = {};
    for (var h = 0; h < plan.hinges.length; h++) hingeById[plan.hinges[h].id] = plan.hinges[h];

    var out = {};
    var order = plan.faces.slice().sort(function (a, b) { return (a.depth < 0 ? 1e9 : a.depth) - (b.depth < 0 ? 1e9 : b.depth); });

    for (var f = 0; f < order.length; f++) {
      var face = order[f];
      var M;
      if (face.parent === null) {
        M = mat4Identity();
      } else if (face.depth >= 0) {
        var parent = byId[face.parent];
        var hinge = hingeById[face.hingeId];
        var pM = out[parent.id].matrix;
        /* 铰链 a 点在父面框架内的坐标 */
        var aLocal = applyFrame(parent.frame, hinge.a[0], hinge.a[1]);
        var bLocal = applyFrame(parent.frame, hinge.b[0], hinge.b[1]);
        var ang = Math.atan2(bLocal[1] - aLocal[1], bLocal[0] - aLocal[0]);
        var thetaH = hingeAngleDeg(hinge, angleDeg, options) * Math.PI / 180;
        M = mat4Mul(pM, mat4Mul(mat4T(aLocal[0], aLocal[1], 0), mat4Mul(mat4Rz(ang), mat4Rx(thetaH))));
      } else {
        M = mat4Identity(); /* 孤立面：平铺 */
      }
      var wp = [];
      for (var v = 0; v < face.localPoly.length; v++) {
        wp.push(mat4Apply(M, face.localPoly[v][0], face.localPoly[v][1], 0));
      }
      out[face.id] = { matrix: M, worldPoly: wp, depth: face.depth };
    }
    return out;
  }

  /* ================================================================
   * 6. THREE 场景构建（浏览器；纯逻辑结果 → 层级 Group）
   * ================================================================ */

  function build3DScene(plan, options) {
    if (typeof THREE === 'undefined') throw new Error('THREE 未加载');
    options = options || {};
    var scale = options.scale || (30 / Math.max(plan.widthMm, plan.heightMm) || 1);
    var texture = options.texture || null;      /* 图稿 THREE.Texture（整版映射） */
    var baseColor = options.faceColor || 0xd8c6a2; /* 卡纸色 */
    var edgeColor = options.edgeColor || 0x8a7a5c;

    var faceById = {};
    plan.faces.forEach(function (f) { faceById[f.id] = f; });
    var hingeById = {};
    plan.hinges.forEach(function (h) { hingeById[h.id] = h; });

    var rootGroup = new THREE.Group();
    var swings = [];
    var swingHinge = [];   /* 与 swings 平行：各 swing 对应的铰链（setFold 按语义取角） */
    var panels = [];
    var disposables = [];

    function makeMaterial(face) {
      if (texture) {
        var m = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
        disposables.push(m);
        return m;
      }
      var mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
      disposables.push(mat);
      return mat;
    }

    /* UV：面世界坐标 → 图稿 bounds 归一化（v 翻转适配图像自上而下） */
    function setUVs(geo, face) {
      if (!texture) return;
      var b = plan.bounds;
      var w = Math.max(b.maxX - b.minX, 1e-6), h = Math.max(b.maxY - b.minY, 1e-6);
      var uvArr = [];
      for (var i = 0; i < face.poly.length; i++) {
        uvArr.push((face.poly[i][0] - b.minX) / w);
        uvArr.push(1 - (face.poly[i][1] - b.minY) / h);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvArr), 2));
    }

    function buildFace(face) {
      /* 面网格在其自身面框架内构建（localPoly） */
      var shape = new THREE.Shape();
      for (var i = 0; i < face.localPoly.length; i++) {
        var p = face.localPoly[i];
        if (i === 0) shape.moveTo(p[0] * scale, p[1] * scale);
        else shape.lineTo(p[0] * scale, p[1] * scale);
      }
      shape.closePath();
      var geo = new THREE.ShapeGeometry(shape);
      setUVs(geo, face);
      disposables.push(geo);
      var mesh = new THREE.Mesh(geo, makeMaterial(face));
      /* 纸厚度感：微小的挤出感用双面材质即可，MVP 不加厚度体 */

      var faceGroup = new THREE.Group();
      faceGroup.name = 'face_' + face.id;
      faceGroup.add(mesh);
      panels.push({ id: face.id, group: faceGroup, mesh: mesh });
      return faceGroup;
    }

    /* 层级：root faceGroup 直接挂；每个子面 = 父面下 pivot(位置+转角) → swing(折叠角) → 子面组 */
    var groupById = {};
    var order = plan.faces.slice().sort(function (a, b) { return (a.depth < 0 ? 1e9 : a.depth) - (b.depth < 0 ? 1e9 : b.depth); });

    for (var i = 0; i < order.length; i++) {
      var face = order[i];
      var faceGroup = buildFace(face);
      groupById[face.id] = faceGroup;

      if (face.parent === null) {
        rootGroup.add(faceGroup);
      } else if (face.depth >= 0) {
        var parentGroup = groupById[face.parent];
        var hinge = hingeById[face.hingeId];
        var parentFace = faceById[face.parent];
        var aLocal = applyFrame(parentFace.frame, hinge.a[0], hinge.a[1]);
        var bLocal = applyFrame(parentFace.frame, hinge.b[0], hinge.b[1]);
        var ang = Math.atan2(bLocal[1] - aLocal[1], bLocal[0] - aLocal[0]);

        var pivot = new THREE.Group();
        pivot.position.set(aLocal[0] * scale, aLocal[1] * scale, 0);
        pivot.rotation.z = ang;
        var swing = new THREE.Group();
        swing.rotation.x = (options.foldAngleDeg || 0) * Math.PI / 180;
        pivot.add(swing);
        swing.add(faceGroup);
        parentGroup.add(pivot);
        swings.push(swing);
        swingHinge.push(hinge);
      } else {
        /* 孤立面：平铺在旁 */
        faceGroup.position.x = (plan.widthMm * scale) * 1.15;
        rootGroup.add(faceGroup);
      }
    }

    function setFold(angleDeg) {
      /* perf 铰链保持配置的 perfAngleDeg（若提供），其余铰链跟随主折叠角；
         负号沿用既有约定（THREE rotation.x 与 mm 系折叠方向相反） */
      for (var s = 0; s < swings.length; s++) {
        swings[s].rotation.x = -hingeAngleDeg(swingHinge[s], angleDeg, options) * Math.PI / 180;
      }
    }
    setFold(options.foldAngleDeg || 0);

    function dispose() {
      for (var d = 0; d < disposables.length; d++) {
        if (disposables[d] && disposables[d].dispose) disposables[d].dispose();
      }
    }

    return { group: rootGroup, panels: panels, swings: swings, setFold: setFold, dispose: dispose, plan: plan };
  }

  /* ================================================================
   * 7. 便捷入口：parsedDXF（PrintGuardDxf.parseDxfString 结果）→ plan
   * ================================================================ */
  function planFromParsedDxf(parsed, options) {
    options = options || {};
    var norm = parsed.getNormalizedEntities({
      origin: 'bottom-left',
      scaleToMm: true,
      flipY: !!options.flipY
    });
    var creaseSegs = segmentsFromEntities(norm.entities.filter(function (e) { return e.classification === 'crease'; }), 'crease');
    var cutSegs = segmentsFromEntities(norm.entities.filter(function (e) { return e.classification === 'cut'; }), 'cut');
    var segments = creaseSegs.concat(cutSegs);
    var plan = buildFoldPlan(segments, options);
    plan.sourceUnits = parsed.units ? parsed.units.name : '';
    return plan;
  }

  /* ================================================================
   * 8. 自测（node module_dxf_folder.js）
   * ================================================================ */
  function runSelfTest() {
    var passed = 0, failed = 0;
    function T(name, fn) {
      try {
        fn();
        passed++;
        console.log('  \u2713 ' + name);
      } catch (e) {
        failed++;
        console.log('  \u2717 ' + name + ' — ' + (e && e.message ? e.message : e));
      }
    }
    function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
    function near(a, b, eps, msg) {
      if (Math.abs(a - b) > (eps || 1e-6)) throw new Error((msg || 'near') + ': ' + a + ' vs ' + b);
    }

    /* ---- T1: 实体转线段 ---- */
    T('segmentsFromEntities: LINE/POLYLINE/bulge', function () {
      var segs = segmentsFromEntities([
        { type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'LWPOLYLINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, bulge: 1 }] }
      ], 'crease');
      assert(segs.length >= 3, '至少 LINE+直段+弧段');
      var arcLen = 0;
      for (var i = 0; i < segs.length; i++) {
        var dx = segs[i].bx - segs[i].ax, dy = segs[i].by - segs[i].ay;
        arcLen += Math.sqrt(dx * dx + dy * dy);
      }
      assert(arcLen > 1, '弧段采样有长度');
    });

    /* ---- T2: 凸巴刀线（底面 + 四壁，树形邻接）——旗舰正确性测试 ---- */
    function plusSegments() {
      var s = [];
      var D = 50; /* 壁深 */
      /* 底面 100x100 + 四臂 50 深；外边界（cut）12 段 */
      s.push({ ax: 0, ay: 0, bx: 100, by: 0, cls: 'cut' });          /* 南臂底 */
      s.push({ ax: 100, ay: 0, bx: 100, by: 100, cls: 'cut' });      /* 东臂外缘 */
      s.push({ ax: 100, ay: 100, bx: 0, by: 100, cls: 'cut' });      /* 北臂外缘 */
      s.push({ ax: 0, ay: 100, bx: 0, by: 0, cls: 'cut' });          /* 西臂外缘 */
      /* 南臂（y -50..0）边界 */
      s.push({ ax: 0, ay: 0, bx: 0, by: -D, cls: 'cut' });
      s.push({ ax: 0, ay: -D, bx: 100, by: -D, cls: 'cut' });
      s.push({ ax: 100, ay: -D, bx: 100, by: 0, cls: 'cut' });
      /* 北臂（y 100..150）边界 */
      s.push({ ax: 0, ay: 100, bx: 0, by: 100 + D, cls: 'cut' });
      s.push({ ax: 0, ay: 100 + D, bx: 100, by: 100 + D, cls: 'cut' });
      s.push({ ax: 100, ay: 100 + D, bx: 100, by: 100, cls: 'cut' });
      /* 西臂（x -50..0）边界 */
      s.push({ ax: 0, ay: 0, bx: -D, by: 0, cls: 'cut' });
      s.push({ ax: -D, ay: 0, bx: -D, by: 100, cls: 'cut' });
      s.push({ ax: -D, ay: 100, bx: 0, by: 100, cls: 'cut' });
      /* 东臂（x 100..150）边界 */
      s.push({ ax: 100, ay: 0, bx: 100 + D, by: 0, cls: 'cut' });
      s.push({ ax: 100 + D, ay: 0, bx: 100 + D, by: 100, cls: 'cut' });
      s.push({ ax: 100 + D, ay: 100, bx: 100, by: 100, cls: 'cut' });
      /* 四条壁折痕（crease） */
      s.push({ ax: 0, ay: 0, bx: 100, by: 0, cls: 'crease' });
      s.push({ ax: 0, ay: 100, bx: 100, by: 100, cls: 'crease' });
      s.push({ ax: 0, ay: 0, bx: 0, by: 100, cls: 'crease' });
      s.push({ ax: 100, ay: 0, bx: 100, by: 100, cls: 'crease' });
      return s;
    }
    var planPlus = null;
    T('buildFoldPlan: 凸巴刀线（底+四壁）→ 5 面 4 铰链树', function () {
      planPlus = buildFoldPlan(plusSegments(), {});
      assert(planPlus.ok, 'plan ok');
      assert(planPlus.stats.faceCount === 5, '面数=5，实际 ' + planPlus.stats.faceCount);
      assert(planPlus.stats.hingeCount === 4, '铰链数=4，实际 ' + planPlus.stats.hingeCount);
      assert(planPlus.stats.orphanFaces === 0, '无孤立面');
      var root = planPlus.faces.filter(function (f) { return f.parent === null; })[0];
      assert(root && root.area > 9900, '根面为底板 10000mm²，实际 ' + root.area);
      var depths = planPlus.faces.map(function (f) { return f.depth; }).sort();
      assert(depths[0] === 0 && depths[1] === 1 && depths[4] === 1, '树深：根0 + 四壁1');
    });

    T('worldTransforms: 0° 全部共面', function () {
      var wt = worldTransforms(planPlus, 0);
      for (var id in wt) {
        for (var v = 0; v < wt[id].worldPoly.length; v++) {
          near(wt[id].worldPoly[v][2], 0, 1e-6, '0°时 z=0');
        }
      }
    });

    T('worldTransforms: 90° 四壁竖直 + 相邻壁角点闭合', function () {
      var wt = worldTransforms(planPlus, 90);
      var walls = planPlus.faces.filter(function (f) { return f.depth === 1; });
      assert(walls.length === 4, '四壁');
      for (var i = 0; i < walls.length; i++) {
        var n = faceNormal(wt[walls[i].id].worldPoly);
        near(Math.abs(n[2]), 0, 1e-6, '壁法向水平（竖直壁）');
      }
      /* 角点闭合：北壁 (100,100,+50) 与东壁 (100,100,+50) 重合 */
      function findPt(poly, x, y) {
        for (var k = 0; k < poly.length; k++) {
          if (Math.abs(poly[k][0] - x) < 0.5 && Math.abs(poly[k][1] - y) < 0.5) return poly[k];
        }
        return null;
      }
      var ptsN = null, ptsE = null;
      for (var w = 0; w < walls.length; w++) {
        var wp = wt[walls[w].id].worldPoly;
        var pFar = null;
        for (var k2 = 0; k2 < wp.length; k2++) {
          if (Math.abs(wp[k2][2] - 50) < 0.6) { pFar = wp[k2]; break; }
        }
        if (!pFar) continue;
        if (Math.abs(pFar[1] - 100) < 0.6 && Math.abs(pFar[0] - 100) < 0.6) { ptsN = pFar; }
        if (Math.abs(pFar[0] - 100) < 0.6 && Math.abs(pFar[1] - 100) < 0.6) { ptsE = ptsE || pFar; }
      }
      assert(ptsN && ptsE, '找到北/东壁远角点');
      var dx = ptsN[0] - ptsE[0], dy = ptsN[1] - ptsE[1], dz = ptsN[2] - ptsE[2];
      near(Math.sqrt(dx * dx + dy * dy + dz * dz), 0, 0.5, '北/东壁远角重合');
    });

    /* ---- T2b: 十字刀线（面邻接成环）→ 生成树性质 ---- */
    T('buildFoldPlan: 十字环状刀线 → 4 面 3 树铰链（优雅降级）', function () {
      var s = [];
      s.push({ ax: 0, ay: 0, bx: 100, by: 0, cls: 'cut' });
      s.push({ ax: 100, ay: 0, bx: 100, by: 100, cls: 'cut' });
      s.push({ ax: 100, ay: 100, bx: 0, by: 100, cls: 'cut' });
      s.push({ ax: 0, ay: 100, bx: 0, by: 0, cls: 'cut' });
      s.push({ ax: 50, ay: 0, bx: 50, by: 100, cls: 'crease' });
      s.push({ ax: 0, ay: 50, bx: 100, by: 50, cls: 'crease' });
      var plan = buildFoldPlan(s, {});
      assert(plan.ok, 'plan ok');
      assert(plan.stats.faceCount === 4, '面数=4，实际 ' + plan.stats.faceCount);
      /* 面邻接为 4-环：生成树 3 铰链（第 4 条冗余，几何闭合由环自身完成） */
      assert(plan.stats.hingeCount === 3, '树铰链=3，实际 ' + plan.stats.hingeCount);
      assert(plan.stats.orphanFaces === 0, '无孤立面');
    });

    function faceNormal(poly) {
      var a = poly[0], b = poly[1], c = poly[2];
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return [nx / len, ny / len, nz / len];
    }

    /* ---- T3: 四壁条带 → 方管成型 ---- */
    T('buildFoldPlan: 条带刀线 → 方管（树深/法向/深度）', function () {
      var s = [];
      var W = 30, H = 100;
      s.push({ ax: 0, ay: 0, bx: W * 4, by: 0, cls: 'cut' });
      s.push({ ax: W * 4, ay: 0, bx: W * 4, by: H, cls: 'cut' });
      s.push({ ax: W * 4, ay: H, bx: 0, by: H, cls: 'cut' });
      s.push({ ax: 0, ay: H, bx: 0, by: 0, cls: 'cut' });
      for (var x = W; x < W * 4; x += W) {
        s.push({ ax: x, ay: 0, bx: x, by: H, cls: 'crease' });
      }
      var plan = buildFoldPlan(s, {});
      assert(plan.ok, 'plan ok');
      assert(plan.stats.faceCount === 4, '4 面，实际 ' + plan.stats.faceCount);
      var depths = plan.faces.map(function (f) { return f.depth; }).sort();
      assert(depths[0] === 0 && depths[3] === 3, '树深 0..3 递增');
      var wt = worldTransforms(plan, 90);
      /* 方管：根平铺 z=0，depth1 竖直，depth2 平铺 z=-W，depth3 竖直 */
      var zMin = Infinity, zMax = -Infinity;
      for (var id in wt) {
        for (var v = 0; v < wt[id].worldPoly.length; v++) {
          zMin = Math.min(zMin, wt[id].worldPoly[v][2]);
          zMax = Math.max(zMax, wt[id].worldPoly[v][2]);
        }
      }
      near(zMin, 0, 1e-6, '最低点 z=0');
      near(zMax, W, 0.5, '方管深度 = 壁宽 ' + W);
      var byDepth = {};
      plan.faces.forEach(function (f) { byDepth[f.depth] = f; });
      near(Math.abs(faceNormal(wt[byDepth[1].id].worldPoly)[2]), 0, 1e-6, 'depth1 竖直');
      near(Math.abs(faceNormal(wt[byDepth[2].id].worldPoly)[2]), 1, 1e-6, 'depth2 水平（管顶）');
      near(Math.abs(faceNormal(wt[byDepth[3].id].worldPoly)[2]), 0, 1e-6, 'depth3 竖直');
    });

    /* ---- T4: 解析器 → 折叠引擎全链路（合成 DXF）---- */
    T('planFromParsedDxf: DXF 解析 → 折叠计划全链路', function () {
      var PGD = null;
      try { PGD = require('./module_dxf_parser.js'); } catch (e) { PGD = null; }
      if (!PGD) { console.log('    (跳过: module_dxf_parser 不可用)'); return; }
      var dxf = [
        '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        /* 100x100 边界 cut */
        '0', 'LWPOLYLINE', '8', 'CUT', '90', '4', '70', '1',
        '10', '0', '20', '0', '10', '100', '20', '0', '10', '100', '20', '100', '10', '0', '20', '100',
        /* 十字 crease */
        '0', 'LWPOLYLINE', '8', 'CREASE', '90', '2', '70', '0', '10', '50', '20', '0', '10', '50', '20', '100',
        '0', 'LWPOLYLINE', '8', 'CREASE', '90', '2', '70', '0', '10', '0', '20', '50', '10', '100', '20', '50',
        '0', 'ENDSEC', '0', 'EOF'
      ].join('\n');
      var parsed = PGD.parseDxfString(dxf);
      var plan = planFromParsedDxf(parsed, {});
      assert(plan.ok, 'plan ok');
      assert(plan.stats.faceCount === 4, '面数=4，实际 ' + plan.stats.faceCount);
      assert(plan.stats.hingeCount === 3, '树铰链=3，实际 ' + plan.stats.hingeCount);
      assert(plan.widthMm > 90 && plan.widthMm < 110, '宽度 100mm');
    });

    /* ---- T5: 退化输入 ---- */
    T('退化输入: 无折痕/空段不崩溃', function () {
      var p1 = buildFoldPlan([], {});
      assert(p1.ok === false, '空段 → ok=false');
      var p2 = buildFoldPlan([{ ax: 0, ay: 0, bx: 50, by: 0, cls: 'crease' }], {});
      assert(p2.ok === false || p2.stats.faceCount === 0, '单段无面或 0 面');
    });

    /* ---- T6: perf 语义铰链（齿刀/半断线）→ 独立折叠角 ---- */
    function faceZRange(poly) {
      var zMin = Infinity, zMax = -Infinity;
      for (var v = 0; v < poly.length; v++) {
        zMin = Math.min(zMin, poly[v][2]);
        zMax = Math.max(zMax, poly[v][2]);
      }
      return [zMin, zMax];
    }
    function plusSegmentsPerf() {
      /* 复用凸巴刀线：南壁折痕改为 perf 语义。y=0 处 cut 与 crease 几何重合
         （去重规则 crease 优先），改 perf 后需移除该重合 cut 段，边才能保留 perf */
      var s = plusSegments().filter(function (seg) {
        return !(seg.cls === 'cut' && seg.ax === 0 && seg.ay === 0 && seg.bx === 100 && seg.by === 0);
      });
      for (var i = 0; i < s.length; i++) {
        if (s[i].cls === 'crease' && s[i].ax === 0 && s[i].ay === 0 && s[i].bx === 100 && s[i].by === 0) {
          s[i] = { ax: s[i].ax, ay: s[i].ay, bx: s[i].bx, by: s[i].by, cls: 'perf' };
        }
      }
      return s;
    }
    function perfWallChild(plan) {
      var perfH = plan.hinges.filter(function (h) { return h.cls === 'perf'; })[0];
      return plan.faces.filter(function (f) { return f.hingeId === perfH.id; })[0];
    }

    T('perf 铰链: perfAngleDeg=0 → perf 面共面、crease 面立起', function () {
      var plan = buildFoldPlan(plusSegmentsPerf(), {});
      assert(plan.ok, 'plan ok');
      assert(plan.stats.faceCount === 5 && plan.stats.hingeCount === 4, '5 面 4 铰链（perf 折痕仍参与折叠树）');
      assert(plan.stats.orphanFaces === 0, '南壁经 perf 铰链连入树，无孤立面');
      var perfH = plan.hinges.filter(function (h) { return h.cls === 'perf'; });
      var creaseH = plan.hinges.filter(function (h) { return h.cls === 'crease'; });
      assert(perfH.length === 1 && creaseH.length === 3,
        'cls 传播到 hinge：1 perf + 3 crease，实际 ' + perfH.length + '/' + creaseH.length);
      var wt = worldTransforms(plan, 90, { perfAngleDeg: 0 });
      var root = plan.faces.filter(function (f) { return f.parent === null; })[0];
      assert(root && root.area > 9900, '根面为底板');
      /* perf 相连面：与根面保持共面（z 恒 0，世界坐标不因折叠改变） */
      var perfChild = perfWallChild(plan);
      assert(perfChild.parent === root.id, 'perf 铰链连接根面与南壁');
      var zr = faceZRange(wt[perfChild.id].worldPoly);
      near(zr[0], 0, 1e-6, 'perf 面最低 z=0');
      near(zr[1], 0, 1e-6, 'perfAngleDeg=0 → perf 面平展不折叠');
      /* crease 相连面：照常 90° 立起（远边 z≈壁深 50） */
      var stoodUp = 0;
      for (var c = 0; c < creaseH.length; c++) {
        var child = plan.faces.filter(function (f) { return f.hingeId === creaseH[c].id; })[0];
        var zr2 = faceZRange(wt[child.id].worldPoly);
        near(zr2[0], 0, 1e-6, 'crease 面铰链侧 z=0');
        near(zr2[1], 50, 0.5, 'crease 面立起远边 z=50');
        stoodUp++;
      }
      assert(stoodUp === 3, '三条 crease 壁全部立起');
    });

    T('perf 铰链: 未传 perfAngleDeg → 与旧版一致（perf 跟随 foldAngleDeg）', function () {
      var plan = buildFoldPlan(plusSegmentsPerf(), {});
      var wtA = worldTransforms(plan, 90);
      var wtB = worldTransforms(plan, 90, {});
      /* 显式对照：不传 options 与传空 options 逐点等价 */
      for (var id in wtA) {
        for (var v = 0; v < wtA[id].worldPoly.length; v++) {
          var p = wtA[id].worldPoly[v], q = wtB[id].worldPoly[v];
          near((p[0] - q[0]) + (p[1] - q[1]) + (p[2] - q[2]), 0, 1e-9, '空 options 与旧调用等价');
        }
      }
      /* perf 面不固定角度 → 跟随 90° 主角立起（旧版统一角度行为） */
      var perfChild = perfWallChild(plan);
      var zr = faceZRange(wtA[perfChild.id].worldPoly);
      near(zr[0], 0, 1e-6, 'perf 面铰链侧 z=0');
      near(zr[1], 50, 0.5, '未配置 perfAngleDeg → perf 面跟随 foldAngleDeg=90 立起');
    });

    T('perf 铰链: perfAngleDeg=45 → perf 面 45°、crease 面仍 90°', function () {
      var plan = buildFoldPlan(plusSegmentsPerf(), {});
      var wt = worldTransforms(plan, 90, { perfAngleDeg: 45 });
      var perfChild = perfWallChild(plan);
      var zr = faceZRange(wt[perfChild.id].worldPoly);
      near(zr[0], 0, 1e-6, 'perf 面铰链侧 z=0');
      near(zr[1], 50 * Math.SQRT1_2, 0.5, 'perf 面远边 z=50·sin45°');
      near(Math.abs(faceNormal(wt[perfChild.id].worldPoly)[2]), Math.SQRT1_2, 1e-6, 'perf 面法向倾角 45°');
      var creaseH = plan.hinges.filter(function (h) { return h.cls === 'crease'; });
      for (var c = 0; c < creaseH.length; c++) {
        var child = plan.faces.filter(function (f) { return f.hingeId === creaseH[c].id; })[0];
        near(faceZRange(wt[child.id].worldPoly)[1], 50, 0.5, 'crease 面仍随主角 90° 立起');
      }
    });

    console.log('\n============================================================');
    console.log(' DXF Folder 自测: ' + passed + ' 通过, ' + failed + ' 失败');
    console.log('============================================================');
    if (failed > 0) process.exit(1);
  }

  if (typeof module !== 'undefined' && module.exports && typeof require !== 'undefined' &&
    typeof require.main !== 'undefined' && require.main === module) {
    runSelfTest();
  }

  return {
    segmentsFromEntities: segmentsFromEntities,
    buildFoldPlan: buildFoldPlan,
    worldTransforms: worldTransforms,
    build3DScene: build3DScene,
    planFromParsedDxf: planFromParsedDxf,
    /* 内部函数导出（测试/高级用法） */
    _internal: {
      splitSegmentsAtIntersections: splitSegmentsAtIntersections,
      buildPlanarGraph: buildPlanarGraph,
      extractFaces: extractFaces,
      computeHinges: computeHinges,
      signedArea2: signedArea2,
      flattenBulgeSegment: flattenBulgeSegment
    }
  };
});
