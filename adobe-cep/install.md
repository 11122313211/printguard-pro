# PrintGuard 提取 · CEP 面板（阶段 2 插件）

Adobe Illustrator 内常驻面板，一键提取当前文档（刀线 DXF + 图稿 PNG + 转曲/色彩预检）并推送工作台。

## 安装（PlayerDebugMode 开发模式，免签名）

1. **启用 CEP 开发模式**（每次 AI 大版本升级后需重做）：
   - Windows：注册表 `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`（2023-2026 版本对应 CSXS.9~.11，可多个都建）新建字符串值 `PlayerDebugMode` = `1`
2. **拷贝面板**：将整个 `adobe-cep` 文件夹拷到 CEP 扩展目录：
   - `C:\Users\<用户名>\AppData\Roaming\Adobe\CEP\extensions\com.printguard.ingest\`
   （保留 `CSXS/manifest.xml`、`index.html`、`js/csinterface.js`、`host.jsx` 的目录结构）
3. 重启 Illustrator → 菜单 **窗口 > 扩展 > PrintGuard 提取**
4. 面板按钮「提取并发送到工作台」→ 草稿写入 `ingest_drop/` → 自动打开浏览器 `#ingest=latest` 完成应用

## 配置

- `host.jsx`（加载器）第 12 行：`$.evalFile(new File('E:/包装印刷工作台/adobe/host.jsx'))` — 工作台迁移时改此路径
- 面板连接状态每 10 秒探测 `http://127.0.0.1:8787/api/ping`

## 原理与维护

- `host.jsx` 是**加载器**（`$.evalFile` 载入权威桥接库 `adobe/host.jsx`，单一事实来源，无副本）
- 面板 `index.html` 为 Chromium 环境：`fetch` 需要服务端 CORS（`server.py` 已开 `*`）
- 大载荷（PNG base64）走 drop 文件目录而非 HTTP，规避 ExtendScript/evalScript 大字符串传输限制

## 分发（可选，后置）

正式分发需 ZXP 签名打包（ZXPSignCmd），本期先用 PlayerDebugMode 本机使用。
