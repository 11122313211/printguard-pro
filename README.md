# PrintGuard Pro - 工业级印前预检与工程打样交互工作台
> ISO 12647-2 / Esko Studio Visualizer Bridge v4.0 工业级数字化印前工程单页 Web 应用程序

---

## 🌟 项目简介 (Project Overview)

**PrintGuard Pro** 是一套专为现代包装印刷工业打造的高级印前预检（Preflight Audit）、工程刀模展开（Parametric CAD Dielines）、印刷物理光学仿真与 3D 纸盒铰链成型打样工作台。界面采用 **Linear / Raycast / macOS Big Sur** 风格的清透浅玻璃设计系统，严格遵循 **ISO 12647-2** 色彩质量控制标准、**ISO 15930-7 (PDF/X-4)** 印前数据规范以及 **GWG (Ghent Workgroup)** 包装预检技术准则。

本项目采用纯前端单页架构（SPA），零构建步骤，零外部 npm 运行时依赖，开箱即用，双击 `index.html` 即可在任意现代浏览器中直接运行。

---

## 🚀 核心工业特性与开源引擎赋能 (Core Features & Open-Source Modules)

### 1. 包装工业条码引擎与印前条宽补偿 (BWR - Bar Width Reduction)
> 参考开源项目：[`metafloor/bwip-js`](https://github.com/metafloor/bwip-js)
* **核心模块**：[`module_barcode_bwr.js`](file:///e:/包装印刷工作台/module_barcode_bwr.js)
* **支持制式**：
  - **EAN-13**：零售商品条码，支持 Modulo 10 权值 3/1 校验码自动计算、标准 L/G/R 奇偶校验表、长护线条（Guard Bars）与 HRI 分段数字排版；
  - **GS1-128 / Code 128**：物流与追溯条码，支持 Code Set B 字符集与 Modulo 103 校验。
* **高精 BWR 印前条宽补偿算法**：
  - 印刷受压时油墨会自然向外扩散渗透（Dot Gain / Ink Bleed），BWR 是高端制版必备补偿；
  - 支持用户设定 `0.000mm ~ 0.050mm` 补偿量，条线两侧等距向内收缩、白空对称放宽；
  - **100% 节距不变性（Pitch Invariance）**：确保条码整体物理跨度及模块周期恒定不变。
* **GS1 静区（Quiet Zone）合规预检**：
  - 自动核验条码左右两侧是否满足 GS1 标准（EAN-13 左侧 11 模块 / 右侧 7 模块，$\ge 2.54\text{mm}$），静区不足时即时触发警告。
* **双通道渲染**：支持 Canvas 2D 毫秒级抗锯齿渲染与分层矢量 SVG 导出。

---

### 2. 外部 AutoCAD / ArtiosCAD 真实 DXF 刀模逆向解析与图层分类
> 参考开源项目：[`gdsestimating/dxf-parser`](https://github.com/gdsestimating/dxf-parser)
* **核心模块**：[`module_dxf_parser.js`](file:///e:/包装印刷工作台/module_dxf_parser.js)
* **解析能力**：
  - 支持标准 ASCII DXF（AutoCAD R12 至最新版，兼容 ArtiosCAD、Kongsberg 包装刀模）；
  - 支持几何实体：`LINE`、`LWPOLYLINE` / `POLYLINE`、`ARC`、`CIRCLE` 以及 `BLOCKS` / `INSERT` 图块嵌套展开；
  - **Bulge 凸度几何反解**：精确求解 ArtiosCAD 多段线连续圆弧弧长、象限极值点与包围盒。
* **智能图层语义分类引擎**：
  - **裁切刀线（Cut Contour）**：智能识别 `CUT`, `CUT_CONTOUR`, `DIE`, `THRU`, `PERIMETER` 等图层；
  - **压痕折线（Crease Fold）**：智能识别 `CREASE`, `FOLD`, `SCORE`, `PERF` 等图层；
  - **工程标注（Dimensions & Guides）**：自动分层隔离尺寸与文字图层。
* **自适应坐标归一化与单位映射**：
  - 读取 `$INSUNITS` 自动换算毫米物理尺寸（Inches 自动乘以 25.4mm）；
  - 几何包围盒自动居中对齐，自适应缩放映射至 2D 工作台与 3D UV 空间。

---

### 3. 色彩科学与 CIEDE2000 ($\Delta E_{00}$) 工业色差评测
> 参考开源项目：[`culori/culori`](https://github.com/culori/culori)
* **核心模块**：[`module_ciede2000.js`](file:///e:/包装印刷工作台/module_ciede2000.js)
* **完整色彩空间转换体系**：
  - $\text{sRGB} \leftrightarrow \text{Linear RGB} \leftrightarrow \text{CIE 1931 XYZ} \leftrightarrow \text{CIE } L^*a^*b^* \leftrightarrow \text{CIE } L^*C^*h^*$；
  - Bradford 色适应变换矩阵（D65 显示白点 $\leftrightarrow$ D50 印刷标准白点）；
  - 工业 CMYK 经验网点阶调混色模型（TVI 网点扩大率与叠印系数计算）。
* **严格实现 CIEDE2000 色差公式 (ISO/CIE 11664-6:2014)**：
  - 包含七次幂色相差异加权系数 $G$、非对称明度 $S_L$、彩度 $S_C$、色相 $S_H$ 加权函数；
  - 精确计算椭圆旋转项 $R_T$ 解决青蓝色系区域的色相倾斜效应；
  - 通过 Sharma et al. (2005) 全部 34 组工业测试向量验证（最大误差 $< 4.95 \times 10^{-5}$）。
* **ISO 12647-2 / Fogra39 工业品质等级判定**：
  - $\Delta E_{00} \le 1.5$：**优秀 (PASS)**
  - $1.5 < \Delta E_{00} \le 2.5$：**商业允收 (Commercial Tolerance)**
  - $\Delta E_{00} > 2.5$：**超标偏色 (FAIL)**
* **Densitometer HUD 实时色度探针**：页面加载即以真实计算值初始化 ΔE/TAC 读数（非静态占位），此后鼠标在画布上移动时持续实时取样 CMYK/TAC 并计算显示对应 CIELAB 坐标与 Fogra39 色差评级。

---

### 4. 参数化盒型库与 3D 铰链动力学折叠
> 参考开源项目：[`Boxes.py`](https://github.com/florianfesti/boxes)、[`microsoft/maker.js`](https://github.com/microsoft/maker.js)
* **核心模块**：[`module_new_boxes.js`](file:///e:/包装印刷工作台/module_new_boxes.js)
* **新增 2 款国际经典盒型**：
  - **电商自锁飞机盒 (Roll-End Lock Mailer Box / FEFCO 0427)**：
    * 展开尺寸 $476 \times 480\text{ mm}$，350g E坑特硬牛皮瓦楞；
    * 100% 环保免胶（Glue-Free）双自锁圆弧舌扣结构，双层折入侧壁与底板卡口；
    * 3D 动力学折叠模型：底板固定，侧板内折 90°，顶盖弧形扣合。
  - **精装天地盖硬盒 (Rigid Lid & Base Box)**：
    * 展开尺寸 $591.5 \times 266\text{ mm}$，1200g 工业高密灰板 + 157g 哑粉铜版面纸；
    * 工业闭合装配公差：天盖内净空比地盒外径严格保证 $+1.5\text{ mm}$ 抽拉顺畅公差；
    * 包含灰板 90° V-Groove 开槽折线与铜版纸 15mm 包边角（Turn-in）；
    * 3D 动力学天盖缓升抽拉打开（Lift-Off）开盒演示。
* **现有盒型库完整保持**：
  - 管式反插盒 (RTC)
  - 抽屉滑盒 (Sleeve Tray)
  - 自动锁底盒 (Snap-Lock)
  - 卷筒圆角标签 (Roll Label)

---

### 5. VS Code / Linear 风格侧边导航抽屉 (Activity Dock & Flyout Drawer)
* **左侧 56px 窄边活动图标停靠栏 (Activity Dock)**：
  - 结构参数、印前体检、分色陷印、图层条码、3D 视口、**本地工程库**等 6 大功能图标（快捷键 `1 / 2 / 3 / 5 / 6 / 7`，`0 / 4 / 9` 为 3D 折叠角）；
  - 鼠标悬停（Hover）向右平滑滑出 320px 玻璃拟态配置抽屉；
  - 支持固定停靠（Pin Dock，`[`）锁定侧边栏，满足复杂工程参数连续调校；
  - 点击外部或工作台画布自动收起，最大化保障主视口设计区域；
  - 支持 URL hash 深链直达面板：`index.html#panel=preflight` 等。

---

### 6. 印刷物理光学仿真与综合印前体检 (Preflight Compliance Engine)
* **印刷走纸微振动与露白仿真**：0.00mm ~ 0.50mm 物理多版微偏移，纯黑镂空时复现刺眼生纸白缝（White Flashing）。
* **纯黑直压 (Overprint Black)**：一键绑定 $K100$ 叠印，底层色保留，彻底杜绝套印露白。
* **智能陷印补漏白 (Trapping Engine)**：0.00mm（无陷印）、0.08mm（胶印标准）、0.15mm（瓦楞包装）。
* **7 通道工业分色检视器**：CMYK 4 色 + 烫金箔 + 局部光油 + CutContour 专色刀模线，支持全彩打样与单色 CTP 金属菲林切换。
* **红外 TAC 热力透视与一键 UCR 降墨**：峰值墨量从 340% 一键平滑压制到 280% 安全限值。
* **一键文字纯矢量转曲**：彻底消除缺字体印刷事故。
* **糊盒粘胶位 15mm 自动脱墨**：确保热熔胶与水性胶牢固附着。
* **双模预检报告输出与「人话解释层」**：
  - 核心解释模块：[`module_preflight_explainer.js`](file:///e:/包装印刷工作台/module_preflight_explainer.js)（零依赖离线规则模板引擎，预留可插拔 LLM 适配接口 `registerLlmProvider` / `explainReportAsync` / `createOpenAICompatibleProvider`）；
  - 交互式网页模态框体检评级 + 符合 ISO 12647-2 工业标准的机读格式化 JSON 报告导出（附带 `human_explanations` 字段）；报告中的 ΔE₀₀ 峰值、TAC 峰值（解除管线钳制的实测值）、GS1 静区/BWR 均由打样画布与检测引擎实时计算，画布跨域受限或引擎缺失时按 N/A + 跳过 (SKIP) 优雅降级，无任何硬编码演示值；
  - 每条预检结论自动生成「是什么问题 → 不改印出来会怎样 → 建议怎么改」三段式通俗解释，并严格区分**「可安全自动修正」**（纯黑直压、UCR 控墨、糊盒粘口除墨）与**「必须人工/客户确认」**（RGB 转色、未转曲活字、ΔE₀₀ 偏色、GS1 条码静区不足等）两类处置权限——LLM 接口仅允许润色人话文案，严禁篡改门禁状态与处置分级，异常时自动回退规则模板。

---

### 7. 本地工程库与自动保存 (Projects & Persistence)
> 核心模块：[`js/app-store.js`](file:///e:/包装印刷工作台/js/app-store.js)（存储层）+ [`js/app-ui.js`](file:///e:/包装印刷工作台/js/app-ui.js)（项目管理 UI）
* **双后端本地存储**：优先 IndexedDB（`printguard-pro` 数据库）；IndexedDB 打开失败/挂起（部分浏览器的 file:// 场景）时 2.5s 超时自动降级 localStorage，配额溢出时自动剥离大附件重试。
* **透明自动保存**：全局 `state` 由 Proxy 包装，任何非易变字段写入即触发脏标记，3 秒防抖落盘，`beforeunload/pagehide` 兜底 flush；画布自动生成 JPEG 缩略图随快照保存。
* **完整附件持久化**：上传的设计稿（原始 dataURL）与导入的 DXF 刀模（原始文本）一并入快照；恢复时自动重放导入管线（重建 Image 对象、重新解析 DXF、同步全部横幅/徽章/面板控件）。
* **项目管理面板（Dock 第 6 个图标）**：多工程保存 / 载入 / 重命名 / 删除 / 缩略图预览，显示当前存储后端状态。
* **`.printguard` 工程文件**：单文件 JSON 格式（含应用标识与版本号）导出/导入，支持跨设备交换与归档。
* **启动恢复**：检测到上次工作区快照时弹出玻璃恢复横幅，一键「恢复 / 忽略」；`snapshotHasContent(snap, baseSnap)` 将快照与全新默认状态逐字段对账（17 个内容字段，排除 zoom/pan 视图状态，设计稿/DXF 大字段单独短路判定），出血/陷印/直压黑/条码/图层等参数级变更在刷新后同样会弹出恢复横幅（旧版 5 字段启发式会漏掉这些，被误报为「数据丢失」）。
* **初始化安全**：存储层所有读写先等初始化完成（IndexedDB 打开窗口期的早期调用自动排队而非静默丢失）；初始化幂等，避免重复连接。
* **撤销 / 重做**：`Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`）快照式命令栈（限深 30 步，连续变更自动批合并）；撤销只回滚参数状态，设计稿与 DXF 资产保留当前版本；恢复横幅 / 载入工程 / 导入工程文件作为撤销断点重置栈。

---

### 8. 清透浅玻璃设计系统 (Light Frosted Glass Design System)
> 核心文件：[`css/design-system.css`](file:///e:/包装印刷工作台/css/design-system.css)
* **视觉语言**：macOS Big Sur / iOS 质感的白色磨砂玻璃浮层（`backdrop-filter: blur + saturate`、1px 内发光描边、柔和冷调彩影、极淡噪点纹理）悬浮于浅色极光渐变背景之上；**全界面纯玻璃拟态统一**——打样画布区为透明画布 + 浅玻璃工程网格，标尺/密度计 HUD/3D 视口/警示条均为浅玻璃，无深色区块。
* **设计令牌**：全部颜色/模糊/阴影/圆 radius 以 CSS 自定义属性定义（`--glass-*`），Tailwind 品牌令牌（`brand*`/`cad*`）同步重定义为浅底加深版。
* **组件类体系**：`.glass-header / .glass-dock / .glass-drawer / .glass-card / .glass-btn(-primary) / .glass-input / .glass-select / .glass-slider / .glass-pill / .glass-modal / .glass-hud / .glass-tooltip / .glass-toast / .glass-pip`，替代旧版复制粘贴的卡片类串与 20+ 个 `!important` 堆积。
* **字体真实加载**：Inter + JetBrains Mono 经 Google Fonts 引入（旧版仅声明未加载）。
* **表单控件浅色化**：`color-scheme: light` 强制原生 select/input/滚动条遵循浅色主题。

---

### 9. 数显卡尺与模切刀缝工艺计算 (Caliper & Die-Cutting Kerf)
> 核心模块：[`module_caliper_kerf.js`](file:///e:/包装印刷工作台/module_caliper_kerf.js)
* **交互式数显卡尺**：画布上点击两点即可测量物理毫米距离（快捷键 `M`），支持多条测线管理与 `Delete` 清空。
* **CITO 压痕底模计算**：按模切刀规格（1.5pt~4.0pt）与卡纸/瓦楞材质厚度，输出压痕线槽宽/槽深、折弯扣除（Bend Deduction）与激光割缝 CAM 补偿。

---

### 10. CIP3/PPF 墨区估算 (Ink Zone Estimator)
> 核心模块：[`module_ink_estimator.js`](file:///e:/包装印刷工作台/module_ink_estimator.js)
* **32 墨区实测**：对打样画布逐像素取样，按印刷机墨键分区聚合 CMYK 覆盖率；
* **耗墨量测算**：基于墨膜厚度 1.1μm、油墨密度 1.05 g/cm³ 与 8% 工艺损耗，输出四色公斤级耗墨预估，随预检报告展示。

---

### 11. Adobe Illustrator 桥接与任意刀线通用折叠 (AI Bridge & Universal Dieline Folder)
> 核心模块：[`adobe/host.jsx`](file:///e:/包装印刷工作台/adobe/host.jsx)（提取桥接）+ [`module_dxf_folder.js`](file:///e:/包装印刷工作台/module_dxf_folder.js)（通用折叠引擎）+ [`server.py`](file:///e:/包装印刷工作台/server.py)（ingest 服务）
* **Illustrator 一键提取**（文件>脚本 或 CEP 面板）：
  * 文档元数据 / 色彩模式 / 画板尺寸(mm) / 图层清单 / 活动文字与字体清单（转曲检查）/ 专色色板；
  * 按图层命名分类刀线（CUT/DIE/刀线 → CUT；CREASE/FOLD/压痕 → CREASE），贝塞尔扁平化后合成 mm 单位 DXF——工作台零改动复用整个 DXF 解析器与图层语义分类；
  * 活动画板 PNG 导出（100ppi）随草稿推送。
* **ingest 接收服务**（`python server.py`，纯标准库零依赖）：
  * `POST /api/ingest`（CEP 面板通道，CORS 全开）+ `ingest_drop/` 目录监视（脚本通道）；
  * `GET /api/drafts · /api/draft/<id> · /api/ping`，草稿磁盘持久化（保留最新 50 份，重启自动恢复）；
  * **端口健壮性**：Windows 下 `SO_EXCLUSIVEADDRUSE` 防双实例静默同绑 8787；端口被占用时输出友好中文提示并给出 `--port 8788` 换端口出路，不抛 traceback。
* **工作台消费**：dock 第 8 图标「外部导入 / AI 插件」面板；深链 `#ingest=<id>`（或 `#ingest=latest`）自动应用草稿；服务在线时草稿列表每 30s 自动轮询刷新，已应用草稿带「已应用 ✓」徽章并防重复应用；预检映射（RGB 警示 / 转曲检查 / 刀线图层清单）面板内直读；无服务器时可手动导入 ingest JSON。
* **任意刀线通用折叠引擎**（对标 Liu et al. 2007 面邻接图生成树算法）：
  * 刀线段求交切分（含 T 型连接）→ 平面图半边环游提取面片 → 折痕邻接 → BFS 铰链树（最大面为根）→ 2D 面框架 → 3D 递归折叠运动学；
  * 铰链按语义分类（crease 压痕 / perf 齿刀半断线），`perfAngleDeg` 可为 perf 铰链配置固定折叠角（未配置时与旧版行为完全一致，向后兼容）；
  * 纯逻辑层 Node 可测（含凸巴刀线 90° 相邻壁角点闭合断言与 perf 铰链语义角断言，自测 11 项），渲染层复用现有 THREE 运行时，折叠失败优雅回退通用盒模型；
  * 折叠角 0°~90° 由现有 3D 面板滑杆统一驱动。
* **技术栈现状**（2026-11）：UXP 在 Illustrator 未公开（仅 NDA 预发布），CEP 面板 2028-12 前完全可用——故阶段 1 采用 ExtendScript 脚本、阶段 2 采用 CEP 面板（`adobe-cep/`，PlayerDebugMode 免签安装），UXP 迁移待 Adobe GA 后评估。

#### 使用要求（用户需要准备什么）

| 准备项 | 必需性 | 说明 |
|---|---|---|
| **刀线图层**（命名含 `CUT` / `DIE` / `THRU` / `PERIMETER` / `刀线` / `刀模` / `裁切`） | ✅ 折叠必需 | 裁切轮廓；无此图层时提取仍可用，但 3D 折叠不可用 |
| **折线/压痕图层**（命名含 `CREASE` / `FOLD` / `SCORE` / `PERF` / `压痕` / `折线` / `折痕`） | ✅ 折叠必需 | 折痕是折叠铰链的**唯一来源**；只有刀线没有折线时，引擎构建不出铰链树，3D 视口回退为通用盒模型（不按用户刀线折叠） |
| 设计图稿（普通图文层，无需特殊命名） | ⭕ 可选 | 作为 3D 折叠体的整体贴图；缺省时面片为卡纸底色。PNG 超过 10MB 自动放弃图稿（刀线仍保留） |
| 运行 `python server.py` | ⭕ 可选 | 提供自动推送与 `#ingest=latest` 自动应用；不运行时走「手动导入模式」（见下） |

* 活动文字与专色**不阻塞**提取——仅作为预检提示（未转曲警示 / 专色清单）显示在工作台面板；
* 刀线/折线内的贝塞尔曲线自动扁平化为折线段（每段 10 采样），圆角盒型无需手工转直；
* 粘舌/提手等附加面板同样按面片提取，铰链树自动挂接。

#### 两种运行模式（服务进程说明）

| 模式 | 常驻进程 | 体验 |
|---|---|---|
| **自动模式** | `python server.py` 一个 Python 进程（约 20~30 MB 内存） | 提取后自动打开浏览器并应用草稿；工作台由服务托管（`http://127.0.0.1:8787/index.html`） |
| **手动模式** | 无任何常驻进程 | 提取对话框选「仅导出草稿」（草稿落在 `ingest_drop/`，持久保存）；双击 `index.html` 打开工作台 →「外部导入」面板 →「导入 ingest JSON」选择草稿文件应用 |

* 不想常驻服务时选手动模式即可；草稿文件不依赖服务存活，server 下次启动会自动把 `ingest_drop/` 里的遗留草稿入库；
* 端口占用冲突时服务会给出友好中文提示，按提示用 `python server.py --port 8788` 换端口，并同步修改 `adobe/host.jsx` 顶部 `CFG.SERVER_URL`（CEP 面板还需改 `adobe-cep/index.html` 的 `SERVER`）。

---

## 🛠️ 文件结构 (File Architecture)

```
e:\包装印刷工作台\
├── index.html                  # PrintGuard Pro 主工作台单页应用 (UI/Canvas 2D/Three.js 3D)
├── css/
│   └── design-system.css       # 清透浅玻璃设计系统 (设计令牌 + 玻璃组件类)
├── js/
│   ├── app-store.js            # 持久化存储层 (IndexedDB+localStorage 双后端/自动保存/工程文件)
│   ├── app-ui.js               # 项目管理面板 UI (工程列表/导入导出/恢复横幅)
│   └── app-ingest.js           # 外部导入管线 (AI 插件草稿消费/预检映射/手动 JSON 导入)
├── module_barcode_bwr.js       # 模块 1: 包装工业条码生成与印前 BWR 补偿核心模块
├── module_dxf_parser.js        # 模块 2: AutoCAD/ArtiosCAD 真实 DXF 刀模逆向解析与图层分类引擎
├── module_ciede2000.js         # 模块 3: 色彩科学核心库与 CIEDE2000 (ΔE₀₀) 工业色差评测模块
├── module_new_boxes.js         # 模块 4: FEFCO 0427 飞机盒与精装天地盖参数化展开与 3D 动力学模型
├── module_ink_estimator.js     # 模块 5: CIP3/PPF 32 墨区分析与四色耗墨量估算
├── module_caliper_kerf.js      # 模块 6: 数显卡尺与模切刀缝/CITO 压痕工艺计算
├── module_dxf_folder.js        # 模块 7: 任意刀线通用折叠引擎 (面邻接图/铰链树/3D 运动学)
├── module_preflight_explainer.js # 模块 8: 预检报告「人话解释层」与安全自动/人工确认分级引擎（预留 LLM 接口）
├── server.py                   # ingest 接收服务 (静态托管 + POST /api/ingest + drop 目录监视)
├── adobe/
│   ├── host.jsx                # Illustrator 桥接库 (文档提取/合成 DXF/草稿落盘/ScriptUI)
│   └── PrintGuard提取.jsx      # 脚本菜单入口 (evalFile host.jsx 后调 openDialog)
├── adobe-cep/                  # 阶段2 CEP 面板包 (manifest/面板/加载器, 见 install.md)
├── ingest_drafts/ · ingest_drop/  # ingest 服务运行时数据 (gitignore)
├── docs/
│   └── 架构判别报告.md          # 架构现状判别、底层缺失清单与演化路线图
├── backup/                     # (本地开发产物，不入库) 重绘前的原始备份与验证截图
└── README.md                   # 工业规范说明书与项目技术文档
```

---

## 💻 快速运行与测试 (Quick Start & Testing)

### 1. 运行工作台
直接在文件资源管理器中**双击 `index.html`**，或通过任意本地 HTTP 静态服务器访问。无任何构建打包步骤。

> 注：Tailwind CSS 与 Three.js 经 CDN 加载，离线首次打开需联网（离线支持见 `docs/架构判别报告.md` 路线图）。

### 2. 运行自动化测试套件
在终端中执行以下命令，验证各个模块与整体系统集成健康度：

```powershell
# 1. 运行条码与 BWR 单元测试 (41 项通过)
node module_barcode_bwr.js

# 2. 运行 DXF 刀模解析与分类测试 (79 项通过)
node module_dxf_parser.js

# 3. 运行色彩科学与 CIEDE2000 测试向量 (34 组 Sharma 向量 100% 匹配)
node module_ciede2000.js

# 4. 运行新增盒型参数化与动力学测试 (42 项通过)
node module_new_boxes.js

# 5. 运行持久化存储层测试 (序列化/工程文件往返 11 项)
node js/app-store.js

# 6. 运行通用折叠引擎测试 (面片提取/铰链树/90° 角点闭合/perf 铰链语义角 11 项)
node module_dxf_folder.js

# 7. 运行预检「人话解释层」与 LLM 适配防篡改自测 (13 项通过)
node module_preflight_explainer.js
```

### 3. 启动 Illustrator 桥接（AI 插件链路）

```powershell
# 启动 ingest 接收服务（兼静态托管工作台，默认 127.0.0.1:8787，--port 可换）
python server.py
```

* **脚本模式（阶段 1）**：将 `adobe/host.jsx` 与 `adobe/PrintGuard提取.jsx` 拷入
  `<Illustrator 安装目录>\Presets\zh_CN\Scripts\`，重启 AI → 文件 > 脚本 > PrintGuard提取；
* **面板模式（阶段 2）**：按 [`adobe-cep/install.md`](adobe-cep/install.md) 启用 PlayerDebugMode 并拷入 CEP 扩展目录；
* 提取后自动打开 `http://127.0.0.1:8787/index.html#ingest=latest`，工作台「外部导入」面板自动应用草稿并进入折叠演示；
* **使用前准备**：文档中需有命名规范的刀线图层与折线/压痕图层（折叠必需），设计图稿可选——详见上文「使用要求」表；不运行服务时的手动导入模式见「两种运行模式」。
