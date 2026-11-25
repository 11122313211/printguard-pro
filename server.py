# -*- coding: utf-8 -*-
"""====================================================================
 PrintGuard Pro · Ingest Server — 本地接收服务
--------------------------------------------------------------------
 职责（纯标准库，零第三方依赖）：
   1. 静态托管工作台页面（替代裸 python -m http.server）
   2. POST /api/ingest          接收 Illustrator 插件(CEP 面板)推送的草稿
   3. ingest_drop/ 目录监视      接收 host.jsx 脚本(ExtendScript 无 HTTP 客户端)落盘的草稿
   4. GET  /api/drafts|/api/draft/<id>  供工作台前端消费
   5. GET  /api/ping            健康检查（CEP 面板连接状态用）

 草稿 = 插件提取的文档信息包（JSON）：doc 元数据 / checks 字段 /
 dxf 字符串 / artworkDataUrl 图稿 dataURL。服务端原样存储不解释。

 启动：python server.py  （默认 127.0.0.1:8787，--port 可改）
===================================================================="""
import argparse
import base64
import errno
import io
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:  # Windows 控制台中文输出兜底
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DRAFT_DIR = ROOT / "ingest_drafts"
DROP_DIR = ROOT / "ingest_drop"
DROP_DONE = DROP_DIR / "_done"
MAX_BODY = 64 * 1024 * 1024          # PNG dataURL 可能很大
DRAFT_KEEP = 50                       # 磁盘上最多保留的草稿数
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_FNAME_RE = re.compile(r"^[A-Za-z0-9._-]+\.json$")

_LOCK = threading.Lock()
_DRAFTS = {}                          # id -> draft dict（内存索引，落盘为准）


# ------------------------------------------------------------------
# 草稿存储 — 文件名先经白名单正则取令牌，resolve() 后校验仍处
# DRAFT_DIR 之内（规范+边界双保险），才进行读写
# ------------------------------------------------------------------
def _safe_draft_file(draft_id):
    """把 id 清洗成合法令牌并返回受 DRAFT_DIR 边界约束的文件 Path。"""
    m = _ID_RE.match(str(draft_id or ""))
    if not m:
        raise ValueError("非法草稿 id（仅允许 [a-z0-9-]）")
    path = (DRAFT_DIR / (m.group(0) + ".json")).resolve()
    if not str(path).startswith(str(DRAFT_DIR.resolve()) + os.sep):
        raise ValueError("路径越界")
    return path


def _scan_disk():
    """启动时从磁盘恢复草稿索引。"""
    if not DRAFT_DIR.is_dir():
        DRAFT_DIR.mkdir(parents=True, exist_ok=True)
        return
    ranked = []
    for entry in sorted(DRAFT_DIR.iterdir()):
        token = _FNAME_RE.match(entry.name)
        if not token:
            continue
        try:
            draft = json.loads((DRAFT_DIR / token.group(0)).read_text(encoding="utf-8"))
            _DRAFTS[draft["id"]] = draft
            ranked.append((draft.get("createdAt", 0), token.group(0)))
        except Exception as exc:
            print("[ingest] 跳过损坏草稿 %s: %s" % (entry.name, exc))
    ranked.sort(reverse=True)
    for _, fname in ranked[DRAFT_KEEP:]:
        token = _FNAME_RE.match(fname)
        if token:
            try:
                (DRAFT_DIR / token.group(0)).unlink()
            except OSError:
                pass


def save_draft(draft):
    path = _safe_draft_file(draft.get("id"))
    with _LOCK:
        _DRAFTS[path.stem] = draft
        DRAFT_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
        # 只保留最新 DRAFT_KEEP 份
        ranked = sorted(_DRAFTS.values(), key=lambda d: d.get("createdAt", 0), reverse=True)
        for old in ranked[DRAFT_KEEP:]:
            old_id = str(old.get("id") or "")
            if _ID_RE.match(old_id):
                try:
                    _safe_draft_file(old_id).unlink()
                except OSError:
                    pass
            _DRAFTS.pop(old_id, None)
    return path.stem


def draft_summary(draft):
    doc = draft.get("doc") or {}
    checks = draft.get("checks") or {}
    return {
        "id": draft["id"],
        "createdAt": draft.get("createdAt"),
        "source": draft.get("source"),
        "name": doc.get("name", ""),
        "colorSpace": doc.get("colorSpace", ""),
        "widthMm": doc.get("widthMm"),
        "heightMm": doc.get("heightMm"),
        "liveTextCount": checks.get("liveTextCount"),
        "hasDxf": bool(draft.get("dxf")),
        "hasArtwork": bool(draft.get("artworkDataUrl")),
    }


# ------------------------------------------------------------------
# drop 目录监视线程（host.jsx 脚本通道）
# ------------------------------------------------------------------
def watch_drop_folder(interval=1.0):
    DROP_DIR.mkdir(parents=True, exist_ok=True)
    DROP_DONE.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            for entry in sorted(DROP_DIR.iterdir()):
                token = _FNAME_RE.match(entry.name)
                if not token:
                    continue
                src = DROP_DIR / token.group(0)
                try:
                    draft = json.loads(src.read_text(encoding="utf-8"))
                    if not isinstance(draft, dict) or draft.get("app") != "PrintGuardIngest":
                        raise ValueError("不是 PrintGuardIngest 草稿")
                    if "id" not in draft:
                        draft["id"] = time.strftime("%Y%m%d-%H%M%S", time.localtime()) + "-" + uuid.uuid4().hex[:6]
                    if "createdAt" not in draft:
                        draft["createdAt"] = int(time.time() * 1000)
                    draft.setdefault("source", "illustrator-script")
                    save_draft(draft)
                    shutil.move(str(src), str(DROP_DONE / token.group(0)))
                    print("[ingest] drop 草稿已入库: %s (%s)" % (draft["id"], (draft.get("doc") or {}).get("name", "?")))
                except Exception as exc:
                    print("[ingest] drop 文件无效 %s: %s" % (entry.name, exc))
                    try:
                        shutil.move(str(src), str(DROP_DONE / ("invalid_" + token.group(0))))
                    except OSError:
                        pass
        except Exception as exc:
            print("[ingest] drop 监视异常: %s" % exc)
        time.sleep(interval)


def _pdf_render_available():
    try:
        import pypdfium2  # noqa: F401
        return True
    except Exception:
        return False


def render_pdf_bytes(pdf_bytes, page_index=0, dpi=200, max_dim=2200):
    """使用 pypdfium2 将真实 PDF 页面光栅化为 PNG，并提取真实物理毫米尺寸（pt -> mm）。"""
    import pypdfium2 as pdfium
    if not pdf_bytes or not pdf_bytes.lstrip().startswith(b"%PDF"):
        raise ValueError("上传的文件不是有效的 PDF 文档")
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        page_count = len(doc)
        if page_count <= 0:
            raise ValueError("PDF 文档不包含任何页面")
        idx = max(0, min(int(page_index or 0), page_count - 1))
        page = doc[idx]
        try:
            w_pt, h_pt = page.get_size()
            width_mm = round(float(w_pt) * 25.4 / 72.0, 2)
            height_mm = round(float(h_pt) * 25.4 / 72.0, 2)
            # 按目标 DPI 缩放并限制最大像素边长，兼顾清晰度与浏览器纹理显存
            scale = max(0.5, min(float(dpi or 200) / 72.0, 4.5))
            if max(w_pt, h_pt) * scale > max_dim:
                scale = max_dim / max(w_pt, h_pt, 1.0)
            bitmap = page.render(scale=scale)
            try:
                pil_img = bitmap.to_pil()
                if pil_img.mode not in ("RGB", "RGBA"):
                    pil_img = pil_img.convert("RGB")
                buf = io.BytesIO()
                pil_img.save(buf, format="PNG", optimize=True)
                png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                return {
                    "ok": True,
                    "pageCount": page_count,
                    "pageIndex": idx,
                    "widthMm": width_mm,
                    "heightMm": height_mm,
                    "pixelWidth": pil_img.width,
                    "pixelHeight": pil_img.height,
                    "dpi": round(scale * 72.0),
                    "dataUrl": "data:image/png;base64," + png_b64,
                }
            finally:
                try:
                    bitmap.close()
                except Exception:
                    pass
        finally:
            try:
                page.close()
            except Exception:
                pass
    finally:
        try:
            doc.close()
        except Exception:
            pass


# ------------------------------------------------------------------
# HTTP Handler
# ------------------------------------------------------------------
class IngestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---- CORS（CEP 面板从 file:// 源发起 fetch）----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/ping":
            self._json(200, {"ok": True, "service": "printguard-ingest", "drafts": len(_DRAFTS),
                             "pdfRenderSupported": _pdf_render_available(),
                             "serverTime": int(time.time() * 1000)})
            return
        if path == "/api/drafts":
            with _LOCK:
                keys = sorted(_DRAFTS, key=lambda k: _DRAFTS[k].get("createdAt", 0), reverse=True)
                items = [draft_summary(_DRAFTS[k]) for k in keys]
            self._json(200, {"drafts": items})
            return
        m = re.match(r"^/api/draft/([a-z0-9-]+)$", path)
        if m:
            with _LOCK:
                draft = _DRAFTS.get(m.group(1))
            if draft is None:
                self._json(404, {"error": "草稿不存在或已清理"})
            else:
                self._json(200, draft)
            return
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/index.html")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path == "/api/render-pdf":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_BODY:
                self._json(400, {"error": "PDF 请求体为空或超过 %dMB 上限" % (MAX_BODY // 1048576)})
                return
            raw = self.rfile.read(length)
            qs = urllib.parse.parse_qs(parsed.query)
            page_idx = int((qs.get("page") or ["0"])[0] or 0)
            dpi = int((qs.get("dpi") or ["200"])[0] or 200)
            ctype = (self.headers.get("Content-Type") or "").lower()
            try:
                if "application/json" in ctype:
                    payload = json.loads(raw.decode("utf-8"))
                    b64 = str(payload.get("pdfBase64") or "")
                    if "," in b64:
                        b64 = b64.split(",", 1)[1]
                    pdf_bytes = base64.b64decode(b64)
                    if "page" in payload:
                        page_idx = int(payload.get("page") or 0)
                    if "dpi" in payload:
                        dpi = int(payload.get("dpi") or 200)
                else:
                    pdf_bytes = raw
                result = render_pdf_bytes(pdf_bytes, page_index=page_idx, dpi=dpi)
                self._json(200, result)
            except ImportError:
                self._json(501, {"error": "本机未安装 pypdfium2，无法在服务端渲染 PDF"})
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:
                self._json(500, {"error": "PDF 渲染失败: %s" % exc})
            return

        if path != "/api/ingest":
            self._json(404, {"error": "未知接口，仅支持 POST /api/ingest 或 POST /api/render-pdf"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"error": "请求体为空或超过 %dMB 上限" % (MAX_BODY // 1048576)})
            return
        raw = self.rfile.read(length)
        try:
            draft = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            self._json(400, {"error": "JSON 解析失败: %s" % exc})
            return
        if not isinstance(draft, dict) or draft.get("app") != "PrintGuardIngest":
            self._json(400, {"error": "payload.app 必须为 PrintGuardIngest"})
            return
        if "id" in draft:
            _safe_draft_file(draft["id"])  # id 白名单校验（异常直接 400）
        draft.setdefault("id", time.strftime("%Y%m%d-%H%M%S", time.localtime()) + "-" + uuid.uuid4().hex[:6])
        draft.setdefault("createdAt", int(time.time() * 1000))
        draft.setdefault("source", "illustrator-cep")
        saved_id = save_draft(draft)
        doc = draft.get("doc") or {}
        print("[ingest] 收到草稿 %s — %s (%sx%s mm, %s)" % (
            saved_id, doc.get("name", "?"), doc.get("widthMm", "?"),
            doc.get("heightMm", "?"), doc.get("colorSpace", "?")))
        host = self.headers.get("Host") or ("127.0.0.1:%d" % self.server.server_port)
        self._json(200, {"ok": True, "id": saved_id,
                         "openUrl": "http://%s/index.html#ingest=%s" % (host, saved_id)})

    def log_message(self, fmt, *args):  # 静态请求不刷屏，仅记录非成功状态
        try:
            status = args[1] if len(args) >= 2 else ""
            if status and not str(status).startswith(("200", "204", "302", "304")):
                sys.stderr.write("[http] " + (fmt % args) + "\n")
        except Exception:
            pass


class IngestServer(ThreadingHTTPServer):
    # Windows: SO_REUSEADDR 语义是"允许抢占"，必须改用 SO_EXCLUSIVEADDRUSE
    # 才能拒绝第二个绑定者；非 Windows 保持默认（EADDRINUSE 天然生效）。
    allow_reuse_address = (os.name != 'nt')

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description="PrintGuard Pro ingest server")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    _scan_disk()
    threading.Thread(target=watch_drop_folder, daemon=True).start()

    try:
        server = IngestServer((args.host, args.port), IngestHandler)
    except OSError as err:
        winerr = getattr(err, "winerror", None)
        if winerr == 10048 or err.errno == errno.EADDRINUSE:
            # Windows WinError 10048 / POSIX EADDRINUSE —— 端口已被占用
            print("[ingest] 端口 %d 已被占用 —— 可能已有一个 server.py 在运行（这正是工作台正在连接的那个）。"
                  % args.port, file=sys.stderr)
        elif winerr == 10013:
            # Windows WinError 10013 (WSAEACCES) —— 被其他程序独占或权限不足
            print("[ingest] 端口 %d 被其他程序占用（或权限不足，如 Hyper-V 保留段）。"
                  % args.port, file=sys.stderr)
        else:
            print("[ingest] 监听失败: %s" % err, file=sys.stderr)
        print("换端口启动: python server.py --port 8788", file=sys.stderr)
        sys.exit(1)
    print("=" * 62)
    print(" PrintGuard Pro Ingest Server")
    print("   监听   : %s:%d" % (args.host, args.port))
    print("   工作台 : http://%s:%d/index.html" % (args.host, args.port))
    print("   草稿数 : %d（磁盘 %s）" % (len(_DRAFTS), DRAFT_DIR))
    print("   drop   : %s" % DROP_DIR)
    print("   接口   : POST /api/ingest · GET /api/drafts · GET /api/ping")
    print("   Ctrl+C 停止")
    print("=" * 62)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] 已停止")


if __name__ == "__main__":
    main()
