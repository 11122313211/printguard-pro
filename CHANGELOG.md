# 更新日志（Changelog）

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

## [Unreleased]

### 新增（Added）
- **仓库开源与 CI 基础设施**：补充标准 MIT 许可证（`LICENSE`）、GitHub Actions 单元测试工作流（`.github/workflows/ci.yml`，Ubuntu + Node.js 20）、`.editorconfig` 统一代码格式规范与 `CHANGELOG.md`，并在 `README.md` 顶部补充实时 CI 与 MIT License 徽章。

---

## [2026-11-25] 2D/3D 单源统一、真实 PDF 软打样与跨项目闭环

### 新增（Added）
- **右侧可缩放双联停靠工作台与 D50 色准渲染（`55e955c`）**：实现 2D/3D 严格单源主控母版（`2.5× masterSheetCanvas`）、真实 PDF 200 DPI 无损渲染（`POST /api/render-pdf`）、FOGRA39 像素级软打样对照、`D50色准 / 展厅光影` 双模切换、防穿插结构避让与居中柔焦接触 AO 阴影。
- **Color Workshop 桥接与 CIP3 损耗学习（`9f67db3`）**：新增工艺护照指纹校验门禁与专色色域 $\Delta E_{00}$ 核验（`modules/module_workshop_bridge.js`），以及 CIP3 损耗率预测与实际损耗 EMA（$\alpha=0.35$）偏差自学习（`modules/module_waste_predictor.js`）。
- **预检人话解释层与分级门禁（`59f69b5`）**：新增离线规则三段式通俗解释（问题 / 印出后果 / 修改建议）、安全自动修正与必须人工确认分级，并预留可插拔防篡改 LLM 接口（`modules/module_preflight_explainer.js`）。
- **统一自测脚本与依赖清单（`9fceedf`）**：收口核心算法模块至 `modules/`，补充可选依赖清单 `requirements.txt` 与一键运行 10 组套件的 `scripts/run-tests.mjs`。
- **文档与高清预览图（`0dfa480`）**：全面重写 `README.md`，补充高清工作台与 3D 背面联动实机预览图、Mermaid 系统架构图与模块能力矩阵。

---

## [2026-11-22] Illustrator 桥接、任意刀线通用 3D 折叠与预检真值化

### 新增（Added）
- **Illustrator 桥接插件与通用 3D 折叠引擎（`db47240`）**：新增 ExtendScript 脚本（`adobe/`）、CEP 扩展面板（`adobe-cep/`）、本地接收服务（`server.py`）与任意刀线通用 3D 铰链折叠引擎（`modules/module_dxf_folder.js`），支持悬浮面板视口自适应。
- **多轮自迭代与浏览器探针体系（`3e14635`、`5baf8ca`）**：落地预检报告实测 $\Delta E_{00}$ / TAC 真值化、恢复横幅参数级变更感知、服务健壮性加固、HUD 首帧真实初值、快照轻量化、折叠 `perf` 语义角、导入面板自动刷新及 7 组浏览器端自动化回归探针（`probes/`）。

---

## [2026-11-01] 初始版本

### 新增（Added）
- **PrintGuard Pro 工业级印前预检与工程打样工作台（`525cd89`）**：发布零构建单页打样工作台，内置条码与 BWR 条宽补偿、DXF 刀模解析、CIEDE2000 色彩科学评测、参数化盒型库（RTC / 飞机盒 / 天地盖等）、CIP3 墨区耗墨估算、数显卡尺与模切刀缝计算，以及 IndexedDB 本地工程持久化。
